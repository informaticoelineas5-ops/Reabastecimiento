import React, { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchSelect from "@/components/common/SearchSelect";
import ColumnChooser from "@/components/common/ColumnChooser";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import AlertDetailSheet from "@/components/alerts/AlertDetailSheet";
import { useColumnLayout } from "@/hooks/useColumnLayout";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { nextSort, sortRows } from "@/utils/tableSort";
import { getEstadoStock } from "@/utils/stockStatus";
import { getUserPreferences } from "@/api/userPreferencesClient";
import TablePager from "@/components/common/TablePager";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import {
  AlertTriangle, AlertCircle, Info, ShieldAlert, Warehouse, TrendingDown, Package,
  ArrowUp, ArrowDown, ArrowUpDown, X, Building2, Tag,
} from "lucide-react";
import { FilterBar, FilterField, FilterSearch } from "@/components/common/FilterBar";

const ALERT_CONFIG = {
  AGOTADO:    { label: "Agotado",           icon: AlertCircle,   severity: "critical", cls: "text-destructive",     badge: "bg-destructive/10 text-destructive border-destructive/20"     },
  DÉFICIT:    { label: "Déficit de stock",  icon: AlertTriangle, severity: "warning",  cls: "text-amber-500",       badge: "bg-amber-500/10 text-amber-600 border-amber-500/20"           },
  MUERTO:     { label: "Muerto con stock",  icon: Package,       severity: "warning",  cls: "text-amber-500",       badge: "bg-amber-500/10 text-amber-600 border-amber-500/20"           },
  EXCESO:     { label: "Exceso de stock",   icon: TrendingDown,  severity: "info",     cls: "text-blue-500",        badge: "bg-blue-500/10 text-blue-600 border-blue-500/20"              },
  SIN_VENTAS: { label: "Stock sin ventas",  icon: Info,          severity: "info",     cls: "text-muted-foreground",badge: "bg-muted/50 text-muted-foreground border-border"               },
};
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const TIPO_ORDER = Object.keys(ALERT_CONFIG);

// Columnas de la tabla (el usuario elige cuáles ve y en qué orden)
const COLUMN_META = [
  { id: "alerta",        label: "Alerta" },
  { id: "producto",      label: "Producto" },
  { id: "categoria",     label: "Categoría" },
  { id: "suministrador", label: "Suministrador" },
  { id: "almacen",       label: "Almacén" },
  { id: "estadoAnuncio", label: "Estado anuncio" },
  { id: "existencia",    label: "Existencia" },
  { id: "prom",          label: "P.>0 (venta diaria)" },
  { id: "cobertura",     label: "Cobertura" },
];
const DEFAULT_ORDER = COLUMN_META.map(c => c.id);

const SIN_ESTADO = "(Sin estado)";
const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function isMuerto(estadoAnuncio) {
  if (!estadoAnuncio) return false;
  const v = estadoAnuncio.toLowerCase();
  return v.includes("muerto") || v.includes("dead") || v.includes("desactivado");
}

export default function Alerts() {
  const [filterType,    setFilterType]    = useState("all");
  const [filterAlmacen, setFilterAlmacen] = useState("all");
  const [filterSup,     setFilterSup]     = useState("all");
  const [filterEstado,  setFilterEstado]  = useState("all");
  const [search,        setSearch]        = useState("");
  const [page,          setPage]          = useState(0);
  const [pageSize,      setPageSize]      = useState(50);    // cada fila trae una imagen: pintar miles a la vez las hace tardar
  const [sort, setSort]                   = useState({ key: null, dir: "asc" });
  const [selected, setSelected]           = useState(null);   // alerta abierta en el panel de detalle
  const { user } = useProcurementUser();
  const { order: colOrder, hidden: colHidden, change: changeLayout } =
    useColumnLayout("alertas-columnas", user?.email ?? "", DEFAULT_ORDER);

  // Preferencias
  const { data: userPrefs } = useQuery({
    queryKey:  ["user-preferences"],
    queryFn:   getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });
  const userAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  // Productos, índices y estado de anuncio: una sola carga (reporte indg_ap_sub), compartida con Reab Directo y Catálogo
  const indg = useIndgAlmacenes(userAlmacenes, !!userPrefs);
  const { salesMap, loading: loadingProducts } = indg;
  const productsFinished = indg.finished;
  const productsMap = useMemo(() => {
    const m = new Map();
    indg.products.forEach((p, id) => m.set(id, { ...p, proveedor: p.almacenSel ?? p.proveedor }));
    return m;
  }, [indg.products]);

  // productsFinished empieza en false; useIndgAlmacenes lo pone en true al terminar (o al leer la caché)
  const isLoading = !userPrefs || (userAlmacenes.length > 0 && !productsFinished && productsMap.size === 0);

  // Genera alertas desde productos + índices
  const alerts = useMemo(() => {
    const result = [];
    for (const [id, p] of productsMap.entries()) {
      const cantidad      = (p.cantidad ?? 0) + (p.reserved_qty ?? 0);
      const idx           = salesMap.get(String(id));
      const prom          = idx?.prom_ventas_diario_mayor_0 ?? 0;
      const estado        = getEstadoStock(cantidad, prom);
      const estadoAnuncio = p.estadoAnuncio ?? null;
      const muerto        = isMuerto(estadoAnuncio);
      const dias          = prom > 0 ? cantidad / prom : null;

      if (estado === "AGOTADO")           result.push({ id, p, tipo: "AGOTADO",    cantidad, prom, dias: 0,   estadoAnuncio });
      if (estado === "DÉFICIT")           result.push({ id, p, tipo: "DÉFICIT",    cantidad, prom, dias,      estadoAnuncio });
      if (muerto && cantidad > 0)         result.push({ id, p, tipo: "MUERTO",     cantidad, prom, dias,      estadoAnuncio });
      if (estado === "EXCESO" && !muerto) result.push({ id, p, tipo: "EXCESO",     cantidad, prom, dias,      estadoAnuncio });
      if (estado === "SIN_VENTAS" && !muerto) result.push({ id, p, tipo: "SIN_VENTAS", cantidad, prom, dias: null, estadoAnuncio });
    }
    return result.sort((a, b) => {
      const sa = ALERT_CONFIG[a.tipo]?.severity ?? "info";
      const sb = ALERT_CONFIG[b.tipo]?.severity ?? "info";
      return (SEVERITY_ORDER[sa] - SEVERITY_ORDER[sb]) || ((a.dias ?? 999) - (b.dias ?? 999));
    });
  }, [productsMap, salesMap]);

  const counts = useMemo(() => {
    const c = {};
    for (const a of alerts) c[a.tipo] = (c[a.tipo] ?? 0) + 1;
    return c;
  }, [alerts]);

  // Suministradores presentes en las alertas (para el filtro con búsqueda)
  const suministradores = useMemo(
    () => [...new Set(alerts.map(a => String(a.p.suministrador ?? "").trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y)),
    [alerts]);

  // Estados de anuncio presentes en las alertas
  const estadosAnuncio = useMemo(() => {
    const set = new Set(alerts.map(a => a.estadoAnuncio || SIN_ESTADO));
    return [...set].sort((x, y) => (x === SIN_ESTADO) - (y === SIN_ESTADO) || x.localeCompare(y));
  }, [alerts]);

  const filtered = useMemo(() => {
    let list = alerts;
    const q = norm(search).trim();
    if (q) list = list.filter(a => norm(`${a.id} ${a.p.codigo} ${a.p.nombre}`).includes(q));
    if (filterEstado  !== "all") list = list.filter(a => (a.estadoAnuncio || SIN_ESTADO) === filterEstado);
    if (filterType    !== "all") list = list.filter(a => a.tipo === filterType);
    if (filterAlmacen !== "all") list = list.filter(a => a.p.proveedor === filterAlmacen);
    if (filterSup     !== "all") list = list.filter(a => String(a.p.suministrador ?? "").trim() === filterSup);
    return list;
  }, [alerts, filterType, filterAlmacen, filterSup, filterEstado, search]);

  // Orden por columna (null = el orden original: gravedad y luego cobertura)
  const sortValue = (a, key) => {
    switch (key) {
      case "alerta":        return (SEVERITY_ORDER[ALERT_CONFIG[a.tipo]?.severity ?? "info"] * 10) + TIPO_ORDER.indexOf(a.tipo);
      case "producto":      return a.p.nombre;
      case "categoria":     return a.p.categoria_online;
      case "suministrador": return a.p.suministrador;
      case "almacen":       return a.p.proveedor;
      case "estadoAnuncio": return a.estadoAnuncio;
      case "existencia":    return a.cantidad;
      case "prom":          return a.prom > 0 ? a.prom : null;
      case "cobertura":     return a.dias;
      default:              return null;
    }
  };
  const rows = useMemo(() => sortRows(filtered, sort, sortValue), [filtered, sort]);

  const hayFiltros = filterType !== "all" || filterAlmacen !== "all" || filterSup !== "all" || filterEstado !== "all" || search.trim() !== "";
  const limpiar = () => { setFilterType("all"); setFilterAlmacen("all"); setFilterSup("all"); setFilterEstado("all"); setSearch(""); };

  // Al cambiar filtros, búsqueda, orden o tamaño de página se vuelve a la primera página
  useEffect(() => { setPage(0); }, [filterType, filterAlmacen, filterSup, filterEstado, search, sort, pageSize]);

  // Definición de cada columna: encabezado y celda
  const columns = [
    {
      id: "alerta", label: "Alerta", th: "w-32", sortKey: "alerta", num: true,
      content: (a) => { const cfg = ALERT_CONFIG[a.tipo]; const Icon = cfg.icon; return (
        <span className={`flex items-center gap-1 font-semibold text-[10px] ${cfg.cls}`}><Icon size={11} /> {cfg.label}</span>
      ); },
    },
    {
      id: "producto", label: "Producto", th: "min-w-[220px]", sortKey: "producto",
      content: (a) => (
        <ProductImageHover
          singleImage
          codigo={a.p.codigo}
          name={a.p.nombre}
          images={(a.p.fotos ?? []).map(f => f?.foto ?? f).filter(Boolean)}
          subtitle={<p className="text-muted-foreground text-[10px]">{a.p.codigo} · {a.id}</p>}
        />
      ),
    },
    { id: "categoria", label: "Categoría", sortKey: "categoria", td: "text-muted-foreground max-w-[130px] truncate", content: (a) => a.p.categoria_online || "—" },
    { id: "suministrador", label: "Suministrador", sortKey: "suministrador", td: "text-muted-foreground max-w-[150px] truncate", tdTitle: (a) => a.p.suministrador, content: (a) => a.p.suministrador || "—" },
    { id: "almacen", label: "Almacén", sortKey: "almacen", when: () => userAlmacenes.length > 1, td: "text-muted-foreground text-[10px] max-w-[130px] truncate", content: (a) => a.p.proveedor },
    {
      id: "estadoAnuncio", label: "Estado anuncio", sortKey: "estadoAnuncio", td: "text-[10px] text-muted-foreground max-w-[140px] truncate",
      content: (a) => a.estadoAnuncio || "—",
    },
    {
      id: "existencia", label: "Existencia", align: "right", sortKey: "existencia", num: true,
      tdExtra: (a) => `font-bold ${a.cantidad === 0 ? "text-destructive" : ""}`, content: (a) => a.cantidad,
    },
    {
      id: "prom", label: "P.>0", title: "Promedio diario >0", align: "right", sortKey: "prom", num: true,
      td: "font-mono text-muted-foreground", content: (a) => a.prom > 0 ? a.prom.toFixed(3) : "—",
    },
    {
      id: "cobertura", label: "Cobertura", align: "right", sortKey: "cobertura", num: true, td: "font-semibold",
      content: (a) => a.dias != null ? (a.dias < 0.5 ? "<1d" : `${Math.round(a.dias)}d`) : "—",
    },
  ];
  const columnsById = Object.fromEntries(columns.map(c => [c.id, c]));
  const visibleCols = colOrder.map(id => columnsById[id]).filter(c => c && !colHidden.has(c.id) && (!c.when || c.when()));

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center">
          <ShieldAlert size={18} className="text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Centro de Alertas</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {alerts.length} alertas · {productsMap.size.toLocaleString()} productos revisados
            {userAlmacenes.length > 0 && (
              <><span>·</span>
              <Warehouse size={10} className="inline" />
              <span className="font-medium text-foreground">
                {userAlmacenes.length === 1 ? userAlmacenes[0] : `${userAlmacenes.length} almacenes`}
              </span></>
            )}
            {loadingProducts   && <span className="animate-pulse text-muted-foreground/60">· cargando productos...</span>}
          </p>
        </div>
      </div>

      {/* Chips de resumen por tipo */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(ALERT_CONFIG).map(([tipo, cfg]) => {
            const count = counts[tipo] ?? 0;
            if (!count) return null;
            return (
              <button
                key={tipo}
                onClick={() => setFilterType(tipo === filterType ? "all" : tipo)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${cfg.badge} ${filterType === tipo ? "ring-2 ring-offset-1 ring-current font-bold" : "opacity-80 hover:opacity-100"}`}
              >
                {count} {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Filtros */}
      <FilterBar>
        <FilterField icon={ShieldAlert} label="Tipo de alerta">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {Object.entries(ALERT_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        {userAlmacenes.length > 1 && (
          <FilterField icon={Warehouse} label="Almacén">
            <SearchSelect
              value={filterAlmacen}
              onChange={setFilterAlmacen}
              options={userAlmacenes}
              allValue="all" allLabel="Todos los almacenes"
              placeholder="Almacén" size="sm" className="w-[190px]"
            />
          </FilterField>
        )}

        {suministradores.length > 0 && (
          <FilterField icon={Building2} label="Suministrador">
            <SearchSelect
              value={filterSup}
              onChange={setFilterSup}
              options={suministradores}
              allValue="all" allLabel="Todos los suministradores"
              placeholder="Suministrador" size="sm" className="w-[190px]"
            />
          </FilterField>
        )}

        {estadosAnuncio.length > 0 && (
          <FilterField icon={Tag} label="Estado de anuncio">
            <SearchSelect
              value={filterEstado}
              onChange={setFilterEstado}
              options={estadosAnuncio}
              allValue="all" allLabel="Todos los estados de anuncio"
              placeholder="Estado anuncio" size="sm" className="w-[170px]"
            />
          </FilterField>
        )}

        <FilterSearch value={search} onChange={setSearch} placeholder="Id, código o nombre…" className="w-[200px]" />

        {hayFiltros && (
          <button type="button" onClick={limpiar} title="Quitar todos los filtros"
            className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors">
            <X size={13} /> Limpiar
          </button>
        )}

        <span className="h-8 inline-flex items-center text-xs text-muted-foreground tabular-nums">{filtered.length.toLocaleString()} productos</span>

        <div className="ml-auto">
          <ColumnChooser columns={columns} sections={{}} order={colOrder} hidden={colHidden} defaultOrder={DEFAULT_ORDER} onChange={changeLayout} />
        </div>
      </FilterBar>

      {indg.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar los productos: {indg.error.message}
        </div>
      )}

      {/* Contenido */}
      {!userAlmacenes.length ? (
        <Card className="p-10 text-center text-muted-foreground space-y-2">
          <Warehouse size={32} className="mx-auto opacity-30" />
          <p className="text-sm">Configura tus almacenes en Índices de Ventas para ver alertas</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <ShieldAlert size={22} className="text-muted-foreground opacity-50" />
          </div>
          <p className="text-sm font-medium">
            {hayFiltros ? "Sin resultados" : "Sin alertas activas"}
          </p>
          <p className="text-xs text-muted-foreground">
            {hayFiltros
              ? "No hay alertas con los filtros aplicados."
              : loadingProducts
                ? "Calculando cobertura de inventario..."
                : "Todos los productos tienen su inventario en orden."}
          </p>
          {hayFiltros && (
            <Button size="sm" variant="outline" onClick={limpiar}>
              Limpiar filtros
            </Button>
          )}
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                {visibleCols.map((col) => {
                  const active = col.sortKey && sort.key === col.sortKey;
                  return (
                    <th key={col.id}
                      title={col.sortKey ? `${col.title ? col.title + ". " : ""}Clic para ordenar` : col.title}
                      onClick={col.sortKey ? () => setSort(prev => nextSort(prev, col.sortKey, col.num)) : undefined}
                      className={`px-3 py-2 font-medium select-none ${col.align === "right" ? "text-right" : "text-left"} ${col.th ?? ""} ${col.sortKey ? "cursor-pointer hover:text-foreground" : ""} ${active ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.sortKey && (active
                          ? (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                          : <ArrowUpDown size={10} className="opacity-30" />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * pageSize, (page + 1) * pageSize).map((a) => (
                <tr key={`${a.id}-${a.tipo}`}
                  onClick={() => setSelected(a)}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer"
                  title="Clic para ver el detalle"
                >
                  {visibleCols.map((col) => (
                    <td key={col.id}
                      title={col.tdTitle?.(a)}
                      className={`px-3 py-2 ${col.align === "right" ? "text-right" : ""} ${col.td ?? ""} ${col.tdExtra?.(a) ?? ""}`}>
                      {col.content(a)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={setPageSize} />
        </div>
      )}

      <AlertDetailSheet alert={selected} cfg={selected ? ALERT_CONFIG[selected.tipo] : null} onClose={() => setSelected(null)} />
    </div>
  );
}
