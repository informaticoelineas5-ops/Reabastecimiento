import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { computeIndiceAvg, calcCategoria } from "@/api/salesIndicesClient";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import { getUserPreferences, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchSelect from "@/components/common/SearchSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Warehouse, HelpCircle, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Building2, Tag, Boxes, Layers, Award, X } from "lucide-react";
import { FilterBar, FilterField, FilterSearch } from "@/components/common/FilterBar";
import ColumnChooser from "@/components/common/ColumnChooser";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import { useColumnLayout } from "@/hooks/useColumnLayout";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { nextSort, sortRows } from "@/utils/tableSort";
import IndicesHelpModal from "@/components/IndicesHelpModal";

const PAGE_SIZE = 100;

// Umbrales de cobertura (días) para estado de stock
const STOCK_DEFICIT_DAYS    = 15;
const STOCK_EXCESO_DAYS     = 60;

function getEstadoStock(existencia, promDiario) {
  if (existencia === 0) return "AGOTADO";
  if (!promDiario || promDiario === 0) return "EXCESO"; // stock sin ventas = exceso
  const cobertura = existencia / promDiario;
  if (cobertura < STOCK_DEFICIT_DAYS)  return "DÉFICIT";
  if (cobertura <= STOCK_EXCESO_DAYS)  return "GARANTIZADO";
  return "EXCESO";
}

const STOCK_STYLE = {
  AGOTADO:     "bg-red-100 text-red-700 border-red-200",
  DÉFICIT:     "bg-amber-100 text-amber-700 border-amber-200",
  GARANTIZADO: "bg-emerald-100 text-emerald-700 border-emerald-200",
  EXCESO:      "bg-blue-100 text-blue-700 border-blue-200",
};

function getAnuncioStyle(estado) {
  if (!estado) return "bg-muted/50 text-muted-foreground border-border";
  const v = estado.toLowerCase();
  if (v.includes("activado") || v === "activo") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (v.includes("desactivado") || v.includes("muerto")) return "bg-red-100 text-red-600 border-red-200";
  if (v.includes("pausado"))  return "bg-amber-100 text-amber-700 border-amber-200";
  if (v.includes("sin id"))   return "bg-orange-100 text-orange-600 border-orange-200";
  return "bg-muted/60 text-muted-foreground border-border";
}

// Columnas de la tabla (el usuario elige cuáles ve y en qué orden)
const COLUMN_META = [
  { id: "num",           label: "#" },
  { id: "catV",          label: "Cat.V" },
  { id: "producto",      label: "Producto" },
  { id: "categoria",     label: "Categoría" },
  { id: "suministrador", label: "Suministrador" },
  { id: "almacen",       label: "Almacén" },
  { id: "estAnuncio",    label: "Est. Anuncio" },
  { id: "estStock",      label: "Est. Stock" },
  { id: "p0",            label: "P.>0" },
  { id: "pHalf",         label: "P.≥½" },
  { id: "p1m",           label: "P.1m" },
  { id: "iavg",          label: "I.AVG" },
  { id: "exist",         label: "Exist." },
];
const DEFAULT_ORDER = COLUMN_META.map(c => c.id);
const STOCK_RANK = { AGOTADO: 0, "DÉFICIT": 1, GARANTIZADO: 2, EXCESO: 3 };

export default function SalesRanking() {
  const [almacenFilter, setAlmacenFilter] = useState("all");
  const [search, setSearch]               = useState("");
  const [catFilter, setCatFilter]         = useState("");
  const [catVFilter, setCatVFilter]       = useState("");
  const [anuncioFilter, setAnuncioFilter] = useState("all");
  const [stockFilter, setStockFilter]     = useState("all");
  const [supFilter, setSupFilter]         = useState("all");
  const [sort, setSort]                   = useState({ key: null, dir: "asc" });
  const [page, setPage]                   = useState(0);
  const { user } = useProcurementUser();
  const { order: colOrder, hidden: colHidden, change: changeLayout } =
    useColumnLayout("ranking-columnas", user?.email ?? "", DEFAULT_ORDER);
  const [showHelp, setShowHelp]           = useState(false);

  // Preferencias del usuario
  const { data: userPrefs, isLoading: loadingPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn:  getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const configuredAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  // Productos, existencias, índices de venta y estado de anuncio: una sola carga (reporte indg_ap_sub),
  // compartida con Alertas, Reab. Directo, Catálogo y Dashboard. La tabla aparece con la primera página.
  const indg = useIndgAlmacenes(configuredAlmacenes, !!userPrefs);
  const salesMap = indg.salesMap;
  const loadingProducts = indg.loading;
  const loadingIndices = false;
  const loadingApMap = false;
  const productsMap = useMemo(() => {
    const m = new Map();
    indg.products.forEach((p, id) => m.set(id, { ...p, proveedor: p.almacenSel ?? p.proveedor }));
    return m;
  }, [indg.products]);

  // Skeleton hasta que lleguen los primeros productos; índices llenan la tabla en segundo plano
  const isLoading = loadingPrefs || (productsMap.size === 0 && loadingProducts);

  const selectedKeys = useMemo(
    () => userPrefs?.selected_indices?.length ? userPrefs.selected_indices : DEFAULT_SELECTED_INDICES,
    [userPrefs]
  );

  // Join: productos enriquecidos con índices + estado de anuncio + estado de stock
  const ranked = useMemo(() => {
    return [...productsMap.entries()]
      .map(([id, p]) => {
        const idx        = salesMap.get(String(id)) ?? p.indices;
        const existencia = (p.cantidad ?? 0) + (p.reserved_qty ?? 0);
        const promDiario = idx?.prom_ventas_diario_mayor_0 ?? 0;
        const indiceAvg  = computeIndiceAvg(idx, selectedKeys);
        return {
          id_tienda:         id,
          nombre:            p.nombre,
          codigo:            p.codigo,
          categoria_online:  p.categoria_online,
          suministrador:     p.suministrador,
          fotos:             (p.fotos ?? []).map(x => x?.foto ?? x).filter(Boolean),
          proveedor:         p.proveedor,
          existencia_fisica: existencia,
          estadoAnuncio:     p.estadoAnuncio ?? "Sin estado",
          estadoStock:       getEstadoStock(existencia, promDiario),
          ...(idx ?? {}),
          indiceAvg,
          categoriaVentas: calcCategoria(indiceAvg),
        };
      })
      .sort((a, b) => (b.prom_ventas_diario_mayor_0 ?? 0) - (a.prom_ventas_diario_mayor_0 ?? 0));
  }, [productsMap, salesMap, selectedKeys]);

  // Valores únicos de estado de anuncio para el filtro (orden alfabético)
  const anuncioStates = useMemo(() =>
    [...new Set(ranked.map(p => p.estadoAnuncio).filter(Boolean))].sort(),
  [ranked]);

  // Suministradores únicos (para el filtro con búsqueda)
  const suministradores = useMemo(() =>
    [...new Set(ranked.map(p => String(p.suministrador ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  [ranked]);

  // Categorías únicas del conjunto completo
  const categories = useMemo(() =>
    [...new Set(ranked.map(p => p.categoria_online).filter(Boolean))].sort(),
  [ranked]);

  // Filtros: almacén + categoría + Cat.V + estado anuncio + estado stock + búsqueda
  const filtered = useMemo(() => {
    let list = ranked;
    if (almacenFilter !== "all") list = list.filter(p => p.proveedor === almacenFilter);
    if (catFilter)               list = list.filter(p => p.categoria_online === catFilter);
    if (catVFilter)              list = list.filter(p => p.categoriaVentas === catVFilter);
    if (anuncioFilter !== "all") list = list.filter(p => p.estadoAnuncio === anuncioFilter);
    if (stockFilter !== "all")   list = list.filter(p => p.estadoStock === stockFilter);
    if (supFilter !== "all")     list = list.filter(p => String(p.suministrador ?? "").trim() === supFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.nombre?.toLowerCase().includes(q) ||
        p.codigo?.toLowerCase().includes(q) ||
        String(p.id_tienda).includes(q)
      );
    }
    return list;
  }, [ranked, almacenFilter, catFilter, catVFilter, anuncioFilter, stockFilter, supFilter, search]);

  // Orden por columna (null = el orden original: P.>0 de mayor a menor)
  const sortValue = (p, key) => {
    switch (key) {
      case "catV":          return p.categoriaVentas;
      case "producto":      return p.nombre;
      case "categoria":     return p.categoria_online;
      case "suministrador": return p.suministrador;
      case "almacen":       return p.proveedor;
      case "estAnuncio":    return p.estadoAnuncio;
      case "estStock":      return STOCK_RANK[p.estadoStock] ?? 9;
      case "p0":            return p.prom_ventas_diario_mayor_0;
      case "pHalf":         return p.prom_ventas_diario_top_max_2;
      case "p1m":           return p.prom_ventas_diario_ult_1_mes;
      case "iavg":          return p.indiceAvg;
      case "exist":         return p.existencia_fisica;
      default:              return null;
    }
  };
  const sortedFiltered = useMemo(() => sortRows(filtered, sort, sortValue), [filtered, sort]);

  // Mini-stats de stock para la leyenda
  const stockCounts = useMemo(() => {
    const base = anuncioFilter !== "all"
      ? ranked.filter(p => p.estadoAnuncio === anuncioFilter)
      : ranked;
    return {
      AGOTADO:     base.filter(p => p.estadoStock === "AGOTADO").length,
      DÉFICIT:     base.filter(p => p.estadoStock === "DÉFICIT").length,
      GARANTIZADO: base.filter(p => p.estadoStock === "GARANTIZADO").length,
      EXCESO:      base.filter(p => p.estadoStock === "EXCESO").length,
    };
  }, [ranked, anuncioFilter]);

  const handleAlmacenChange = (v) => {
    setAlmacenFilter(v);
    setCatFilter("");
    setSearch("");
    setPage(0);
  };

  const resetFilters = () => {
    setCatFilter(""); setCatVFilter(""); setAnuncioFilter("all");
    setStockFilter("all"); setSupFilter("all"); setSearch(""); setPage(0);
  };

  const hasSecondaryFilters = catFilter || catVFilter || anuncioFilter !== "all" || stockFilter !== "all" || supFilter !== "all" || search;

  // Definición de cada columna: encabezado y celda
  const CATV_STYLE = (c) =>
    c === "A" ? "bg-emerald-600 text-white" : c === "B" ? "bg-emerald-100 text-emerald-800" :
    c === "C" ? "bg-yellow-100 text-yellow-700" : c === "D" ? "bg-gray-100 text-gray-500" : "";
  const columns = [
    { id: "num", label: "#", th: "text-center w-10", td: "text-center text-muted-foreground", content: (p, i) => i + 1 },
    {
      id: "catV", label: "Cat.V", th: "text-center w-14 text-emerald-700", td: "text-center", sortKey: "catV",
      content: (p) => p.categoriaVentas ? <Badge className={`text-[10px] ${CATV_STYLE(p.categoriaVentas)}`}>{p.categoriaVentas}</Badge> : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "producto", label: "Producto", th: "min-w-[240px]", sortKey: "producto", td: "max-w-[300px]",
      content: (p) => (
        <ProductImageHover
          singleImage
          name={p.nombre || "—"}
          images={p.fotos}
          subtitle={<p className="text-muted-foreground text-[10px]">{p.codigo} · {p.id_tienda}</p>}
        />
      ),
    },
    { id: "categoria", label: "Categoría", sortKey: "categoria", td: "text-muted-foreground max-w-[130px] truncate", content: (p) => p.categoria_online || "—" },
    { id: "suministrador", label: "Suministrador", sortKey: "suministrador", td: "text-muted-foreground max-w-[150px] truncate", tdTitle: (p) => p.suministrador, content: (p) => p.suministrador || "—" },
    { id: "almacen", label: "Almacén", sortKey: "almacen", when: () => configuredAlmacenes.length > 1 && almacenFilter === "all", td: "text-muted-foreground max-w-[130px] truncate text-[10px]", content: (p) => p.proveedor },
    {
      id: "estAnuncio", label: "Est. Anuncio", th: "min-w-[120px]", sortKey: "estAnuncio",
      content: (p) => loadingApMap
        ? <span className="text-[10px] text-muted-foreground animate-pulse">Cargando...</span>
        : p.estadoAnuncio
          ? <Badge variant="outline" className={`text-[10px] border ${getAnuncioStyle(p.estadoAnuncio)} whitespace-nowrap`}>{p.estadoAnuncio}</Badge>
          : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "estStock", label: "Est. Stock", th: "w-28", sortKey: "estStock",
      content: (p) => <Badge variant="outline" className={`text-[10px] border ${STOCK_STYLE[p.estadoStock] ?? "bg-muted/50 text-muted-foreground border-border"} whitespace-nowrap`}>{p.estadoStock}</Badge>,
    },
    {
      id: "p0", label: "P.>0", title: "Promedio diario >0", align: "right", th: "text-primary", sortKey: "p0", num: true, td: "font-bold text-primary",
      thExtra: () => (
        <button onClick={(e) => { e.stopPropagation(); setShowHelp(true); }} className="text-primary/40 hover:text-primary transition-colors" tabIndex={-1}>
          <HelpCircle size={11} />
        </button>
      ),
      content: (p) => p.prom_ventas_diario_mayor_0 != null ? p.prom_ventas_diario_mayor_0.toFixed(3) : "—",
    },
    { id: "pHalf", label: "P.≥½", title: "Promedio ≥ max/2", align: "right", sortKey: "pHalf", num: true, td: "font-mono text-muted-foreground", content: (p) => p.prom_ventas_diario_top_max_2 != null ? p.prom_ventas_diario_top_max_2.toFixed(3) : "—" },
    { id: "p1m", label: "P.1m", title: "Promedio Últ. 1 mes", align: "right", sortKey: "p1m", num: true, td: "font-mono text-muted-foreground", content: (p) => p.prom_ventas_diario_ult_1_mes != null ? p.prom_ventas_diario_ult_1_mes.toFixed(3) : "—" },
    { id: "iavg", label: "I.AVG", title: "Índice AVG", align: "right", sortKey: "iavg", num: true, td: "font-mono", content: (p) => p.indiceAvg != null ? p.indiceAvg.toFixed(3) : "—" },
    { id: "exist", label: "Exist.", align: "right", sortKey: "exist", num: true, td: "font-semibold", tdExtra: (p) => p.existencia_fisica === 0 ? "text-destructive" : "", content: (p) => p.existencia_fisica },
  ];
  const columnsById = Object.fromEntries(columns.map(c => [c.id, c]));
  const visibleCols = colOrder.map(id => columnsById[id]).filter(c => c && !colHidden.has(c.id) && (!c.when || c.when()));

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ranking de Ventas</h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              {isLoading
                ? "Cargando..."
                : loadingProducts
                  ? <><Loader2 size={11} className="animate-spin shrink-0" />{ranked.length.toLocaleString()} productos cargados, cargando más...</>
                  : loadingIndices
                    ? <><Loader2 size={11} className="animate-spin shrink-0" />{ranked.length.toLocaleString()} productos · calculando índices...</>
                    : `${ranked.length.toLocaleString()} productos · ordenados por Prom. Diario >0`
              }
            </p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <FilterBar>
        <FilterField icon={Warehouse} label="Almacén">
          {configuredAlmacenes.length > 0 ? (
            <SearchSelect
              value={almacenFilter}
              onChange={handleAlmacenChange}
              options={configuredAlmacenes}
              allValue="all" allLabel={`Todos mis almacenes (${configuredAlmacenes.length})`}
              placeholder="Almacén" size="sm" className="w-[210px]"
            />
          ) : (
            <Link to="/SalesIndexImport" className="text-xs text-warning underline">
              Configura tus almacenes en Índices de Ventas
            </Link>
          )}
        </FilterField>

        {!isLoading && ranked.length > 0 && (
          <>
            {suministradores.length > 0 && (
              <FilterField icon={Building2} label="Suministrador">
                <SearchSelect
                  value={supFilter}
                  onChange={v => { setSupFilter(v); setPage(0); }}
                  options={suministradores}
                  allValue="all" allLabel="Todos los suministradores"
                  placeholder="Suministrador" size="sm" className="w-[200px]"
                />
              </FilterField>
            )}

            <FilterSearch value={search} onChange={v => { setSearch(v); setPage(0); }} placeholder="Buscar producto…" />

            <FilterField icon={Layers} label="Categoría">
              <Select value={catFilter || "all"} onValueChange={v => { setCatFilter(v === "all" ? "" : v); setPage(0); }}>
                <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue placeholder="Todas las categorías" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField icon={Award} label="Categoría de ventas (Cat.V)">
              <Select value={catVFilter || "all"} onValueChange={v => { setCatVFilter(v === "all" ? "" : v); setPage(0); }}>
                <SelectTrigger className="h-8 text-xs w-[105px]"><SelectValue placeholder="Cat.V" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Cat.V</SelectItem>
                  <SelectItem value="A">A — Top 20%</SelectItem>
                  <SelectItem value="B">B — 20–50%</SelectItem>
                  <SelectItem value="C">C — 50–80%</SelectItem>
                  <SelectItem value="D">D — Últimos 20%</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField icon={Tag} label="Estado de anuncio">
              <Select value={anuncioFilter} onValueChange={v => { setAnuncioFilter(v); setPage(0); }}>
                <SelectTrigger className="h-8 text-xs w-[165px]"><SelectValue placeholder="Estado anuncio" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados anuncio</SelectItem>
                  {anuncioStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField icon={Boxes} label="Estado de stock">
              <Select value={stockFilter} onValueChange={v => { setStockFilter(v); setPage(0); }}>
                <SelectTrigger className="h-8 text-xs w-[135px]"><SelectValue placeholder="Est. stock" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los stocks</SelectItem>
                  <SelectItem value="AGOTADO">🔴 Agotado</SelectItem>
                  <SelectItem value="DÉFICIT">🟠 Déficit (&lt;{STOCK_DEFICIT_DAYS}d)</SelectItem>
                  <SelectItem value="GARANTIZADO">🟢 Garantizado</SelectItem>
                  <SelectItem value="EXCESO">🔵 Exceso (&gt;{STOCK_EXCESO_DAYS}d)</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            {hasSecondaryFilters && (
              <button type="button" onClick={resetFilters} title="Quitar todos los filtros"
                className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors">
                <X size={13} /> Limpiar
              </button>
            )}
          </>
        )}
      </FilterBar>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      )}

      {/* Sin almacenes configurados */}
      {!isLoading && configuredAlmacenes.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Configura tus almacenes en Índices de Ventas</p>
          <Link to="/SalesIndexImport">
            <Button size="sm" className="mt-3">Ir a configuración</Button>
          </Link>
        </div>
      )}

      {/* Sin datos */}
      {!isLoading && configuredAlmacenes.length > 0 && ranked.length === 0 && (
        <div className="p-10 text-center space-y-2">
          <TrendingUp size={32} className="mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm font-medium">Sin datos de ranking</p>
          <p className="text-xs text-muted-foreground">No se encontraron productos con índices de venta.</p>
        </div>
      )}

      {/* Leyendas + Tabla */}
      {!isLoading && ranked.length > 0 && (
        <>
          {/* Leyenda Cat.V */}
          <div className="flex gap-4 text-xs flex-wrap items-center">
            <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Cat.V</span>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-emerald-600 text-white">A</Badge> Top 20%</div>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-emerald-100 text-emerald-800">B</Badge> 20–50%</div>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-yellow-100 text-yellow-700">C</Badge> 50–80%</div>
            <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">D</Badge> Últimos 20%</div>
            <span className="text-muted-foreground ml-2 text-[10px]">· Sin Cat.V = sin ventas registradas</span>
          </div>

          {/* Mini-stats de stock */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mr-1">Est. Stock</span>
            {[
              { key: "AGOTADO",     label: "Agotado",     cls: STOCK_STYLE.AGOTADO },
              { key: "DÉFICIT",     label: `Déficit <${STOCK_DEFICIT_DAYS}d`, cls: STOCK_STYLE.DÉFICIT },
              { key: "GARANTIZADO", label: "Garantizado", cls: STOCK_STYLE.GARANTIZADO },
              { key: "EXCESO",      label: `Exceso >${STOCK_EXCESO_DAYS}d`,  cls: STOCK_STYLE.EXCESO },
            ].map(({ key, label, cls }) => (
              <button
                key={key}
                onClick={() => { setStockFilter(stockFilter === key ? "all" : key); setPage(0); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${cls} ${stockFilter === key ? "ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100"}`}
              >
                <span className="font-bold font-variant-numeric">{stockCounts[key].toLocaleString()}</span>
                {label}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground">· Cobertura = Existencia ÷ P.&gt;0</span>
            <div className="ml-auto">
              <ColumnChooser columns={columns} sections={{}} order={colOrder} hidden={colHidden} defaultOrder={DEFAULT_ORDER} onChange={changeLayout} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  {visibleCols.map((col) => {
                    const active = col.sortKey && sort.key === col.sortKey;
                    return (
                      <th key={col.id}
                        title={col.sortKey ? `${col.title ? col.title + ". " : ""}Clic para ordenar` : col.title}
                        onClick={col.sortKey ? () => { setSort(prev => nextSort(prev, col.sortKey, col.num)); setPage(0); } : undefined}
                        className={`px-3 py-2 font-medium select-none ${col.align === "right" ? "text-right" : "text-left"} ${col.th ?? "text-muted-foreground"} ${col.sortKey ? "cursor-pointer hover:text-foreground" : ""}`}
                      >
                        <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
                          {col.label}
                          {col.sortKey && (active
                            ? (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                            : <ArrowUpDown size={10} className="opacity-30" />)}
                          {col.thExtra?.()}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p, i) => {
                  const globalIdx = page * PAGE_SIZE + i;
                  return (
                    <tr key={`${p.id_tienda}-${p.proveedor}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      {visibleCols.map((col) => (
                        <td key={col.id}
                          title={col.tdTitle?.(p)}
                          className={`px-3 py-2 ${col.align === "right" ? "text-right" : ""} ${col.td ?? ""} ${col.tdExtra?.(p) ?? ""}`}>
                          {col.content(p, globalIdx)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {(() => {
            const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
            const from = page * PAGE_SIZE + 1;
            const to   = Math.min((page + 1) * PAGE_SIZE, filtered.length);
            return (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {from.toLocaleString()}–{to.toLocaleString()} de {filtered.length.toLocaleString()}
                  {filtered.length !== ranked.length && ` filtrados (${ranked.length.toLocaleString()} total)`}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      Anterior
                    </Button>
                    <Badge variant="secondary" className="px-3 py-1">
                      {page + 1} / {totalPages}
                    </Badge>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      Siguiente
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
      <IndicesHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
