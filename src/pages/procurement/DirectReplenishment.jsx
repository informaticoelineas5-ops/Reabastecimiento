import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAlmacenes } from "@/api/externalSupabaseClient";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import { getUserPreferences, SELECTABLE_INDICES, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";
import { computeIndiceAvg } from "@/api/salesIndicesClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2, PackageX, Warehouse, ChevronDown, X, FileSpreadsheet, TrendingUp, ArrowUp, ArrowDown, ArrowUpDown, Building2, Tag } from "lucide-react";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import ColumnChooser from "@/components/common/ColumnChooser";
import { useColumnLayout } from "@/hooks/useColumnLayout";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import AlmacenSearchSelect from "@/components/common/AlmacenSearchSelect";
import TablePager from "@/components/common/TablePager";
import SearchSelect from "@/components/common/SearchSelect";
import { FilterBar, FilterField } from "@/components/common/FilterBar";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";

// Secciones de la tabla: separador grueso de color + fondo suave
const SEC_STOCK = {
  div:  "border-l-4 border-l-sky-400 dark:border-l-sky-500",
  col:  "bg-sky-50 dark:bg-sky-950",
  hdr:  "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400",
  cell: "bg-sky-50/30 dark:bg-sky-950/15",
};
const SEC_NIVELES = {
  div:  "border-l-4 border-l-violet-400 dark:border-l-violet-500",
  col:  "bg-violet-50 dark:bg-violet-950",
  hdr:  "bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-400",
  cell: "bg-violet-50/30 dark:bg-violet-950/15",
};
const SEC_SUGERIDO = {
  div:  "border-l-4 border-l-emerald-400 dark:border-l-emerald-500",
  col:  "bg-emerald-50 dark:bg-emerald-950",
  hdr:  "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
  cell: "bg-emerald-50/40 dark:bg-emerald-950/20",
};

// Combobox de suministrador con búsqueda mientras se escribe
function SuministradorCombobox({ value, onChange, options, loading }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, search]);

  const displayValue = value || search;

  return (
    <div ref={containerRef} className="relative">
      <div className={`flex items-center h-8 border rounded-md bg-background text-xs overflow-hidden transition-colors ${open ? "border-primary ring-1 ring-ring" : "border-input"}`}>
        <Search size={12} className="ml-2 text-muted-foreground shrink-0" />
        <input
          className="flex-1 px-2 h-full outline-none bg-transparent placeholder:text-muted-foreground"
          placeholder={loading ? "Cargando suministradores..." : "Buscar suministrador..."}
          value={value ? value : search}
          onChange={e => {
            if (value) onChange("");
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={loading}
        />
        {(value || search) && (
          <button
            onClick={() => { onChange(""); setSearch(""); }}
            className="px-1.5 hover:text-destructive shrink-0"
            title="Limpiar"
          >
            <X size={11} />
          </button>
        )}
        <ChevronDown size={11} className={`mr-2 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
      {open && !value && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-52 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</div>
          ) : (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-muted-foreground italic border-b border-border/50"
                onClick={() => { onChange(""); setSearch(""); setOpen(false); }}
              >
                Todos los suministradores ({options.length})
              </button>
              {filtered.slice(0, 150).map(o => (
                <button
                  key={o}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                  onClick={() => { onChange(o); setSearch(""); setOpen(false); }}
                >
                  {o}
                </button>
              ))}
              {filtered.length > 150 && (
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/50">
                  Mostrando 150 de {filtered.length} — escribe más para filtrar
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Columnas de la tabla: el usuario elige cuáles ve y en qué orden ──────────────
const SECTIONS = {
  producto: { label: "Producto",         hdr: "bg-slate-50 dark:bg-slate-900 text-slate-500", col: "bg-muted", cell: "", div: "" },
  stock:    { label: "Stock y ventas",   hdr: SEC_STOCK.hdr,    col: SEC_STOCK.col,    cell: SEC_STOCK.cell,    div: SEC_STOCK.div },
  niveles:  { label: "Niveles de stock", hdr: SEC_NIVELES.hdr,  col: SEC_NIVELES.col,  cell: SEC_NIVELES.cell,  div: SEC_NIVELES.div },
  pedido:   { label: "Pedido",           hdr: SEC_SUGERIDO.hdr, col: SEC_SUGERIDO.col, cell: SEC_SUGERIDO.cell, div: SEC_SUGERIDO.div },
};

// label/title pueden ser funciones de ctx = { diasMin, diasMax }; tdClass/tdTitle/content reciben (fila, ctx + { i, urgente })
const COLUMNS = [
  {
    id: "num", label: "#", section: "producto",
    tdClass: (r, c) => cn("text-muted-foreground text-[11px] tabular-nums", c.urgente && "border-l-4 border-l-destructive"),
    tdTitle: (r, c) => c.urgente ? `Urgente: cubre ${r.cobDias} días (menos de ${c.diasMin}) y tiene sugerido ${r.sugerido}` : undefined,
    content: (r, c) => c.i + 1,
  },
  { id: "codigo", label: "Código", section: "producto", sortKey: "codigo", tdClass: () => "font-mono", content: r => r.codigo || "—" },
  { id: "id_online", label: "ID Tienda", section: "producto", sortKey: "id_online", tdClass: () => "font-mono text-muted-foreground", content: r => r.id_online ?? "—" },
  {
    id: "nombre", label: "Nombre", section: "producto", sortKey: "nombre",
    title: "Pasa el cursor sobre el nombre para ver las imágenes del producto",
    tdClass: () => "min-w-[220px] max-w-[300px]",
    content: r => <ProductImageHover name={r.nombre} codigo={r.codigo} images={(r.fotos ?? []).map(f => f?.foto ?? f).filter(Boolean)} />,
  },
  { id: "proveedor", label: "Almacén", section: "producto", sortKey: "proveedor", tdClass: () => "text-muted-foreground whitespace-nowrap", content: r => r.proveedor || "—" },
  {
    id: "suministrador", label: "Suministrador", section: "producto", sortKey: "suministrador",
    tdClass: () => "text-muted-foreground whitespace-nowrap max-w-[150px] truncate", tdTitle: r => r.suministrador,
    content: r => r.suministrador || "—",
  },
  {
    id: "estadoAnuncio", label: "Estado anuncio", section: "producto", sortKey: "estadoAnuncio",
    tdClass: () => "text-[10px] text-muted-foreground whitespace-nowrap max-w-[140px] truncate", tdTitle: r => r.estadoAnuncio,
    content: r => r.estadoAnuncio || "—",
  },
  {
    id: "categoria_online", label: "Cat.", section: "producto", sortKey: "categoria_online",
    content: r => r.categoria_online
      ? <Badge variant="outline" className="text-[10px] whitespace-nowrap">{r.categoria_online}</Badge>
      : <span className="text-muted-foreground/50">—</span>,
  },
  {
    id: "cantidad", label: "Stock", section: "stock", sortKey: "cantidad", num: true,
    title: "Existencia física actual en el almacén",
    tdClass: () => "text-center font-semibold",
    content: r => <span className={r.cantidad <= 0 ? "text-destructive" : r.cantidad <= 5 ? "text-warning" : ""}>{r.cantidad ?? 0}</span>,
  },
  {
    id: "reserved_qty", label: "Reserv.", section: "stock", sortKey: "reserved_qty", num: true,
    title: "Unidades reservadas (salidas pendientes de procesar)",
    tdClass: () => "text-center text-muted-foreground", content: r => r.reserved_qty ?? 0,
  },
  {
    id: "cobDias", label: "Cob.(días)", section: "stock", sortKey: "cobDias", num: true,
    title: c => `Cobertura: días que aguanta el stock al ritmo de ventas actual (Stock ÷ I.AVG). Rojo = menos de ${c.diasMin} días`,
    tdClass: () => "text-right font-mono",
    content: (r, c) => r.cobDias != null
      ? <span className={r.cobDias < c.diasMin ? "text-destructive font-semibold" : r.cobDias < c.diasMax ? "text-warning" : "text-muted-foreground"}>{r.cobDias}</span>
      : <span className="text-muted-foreground/40">—</span>,
  },
  {
    id: "indiceAvg", label: "I.AVG", section: "stock", sortKey: "indiceAvg", num: true,
    title: "Índice promedio de ventas diarias (promedio de los índices seleccionados)",
    tdClass: () => "text-right font-mono",
    content: r => r.indiceAvg != null ? <span className="text-primary">{r.indiceAvg.toFixed(3)}</span> : <span className="text-muted-foreground/40">—</span>,
  },
  {
    id: "categoriaVentas", label: "Cat.V", section: "stock", sortKey: "categoriaVentas",
    title: "Categoría de ventas (A = mayor rotación, B = media, C = baja)",
    tdClass: () => "text-center",
    content: r => r.categoriaVentas ? (
      <Badge className={`text-[10px] ${
        r.categoriaVentas === "A" ? "bg-chart-2/15 text-chart-2" :
        r.categoriaVentas === "B" ? "bg-chart-3/15 text-chart-3" :
        r.categoriaVentas === "C" ? "bg-info/15 text-info" :
        "bg-muted text-muted-foreground"
      }`}>{r.categoriaVentas}</Badge>
    ) : <span className="text-muted-foreground/40">—</span>,
  },
  {
    id: "sMin", label: c => `S.Mín.(${c.diasMin}d)`, section: "niveles", sortKey: "sMin", num: true,
    title: c => `Stock mínimo recomendado = I.AVG × ${c.diasMin} días`,
    tdClass: () => "text-right font-mono text-muted-foreground",
    content: r => r.sMin != null ? r.sMin : <span className="opacity-30">—</span>,
  },
  {
    id: "sIdeal", label: c => `S.Ideal(${c.diasMax}d)`, section: "niveles", sortKey: "sIdeal", num: true,
    title: c => `Stock ideal o de seguridad = I.AVG × ${c.diasMax} días`,
    tdClass: () => "text-right font-mono text-muted-foreground",
    content: r => r.sIdeal != null ? r.sIdeal : <span className="opacity-30">—</span>,
  },
  {
    id: "sugerido", label: "Sugerido", section: "pedido", sortKey: "sugerido", num: true,
    title: "Cantidad a pedir para llegar al stock ideal: max(0, S.Ideal − Stock)",
    tdClass: () => "text-right font-mono font-semibold",
    content: r => r.sugerido != null
      ? r.sugerido > 0 ? <span className="text-primary">{r.sugerido}</span> : <span className="text-muted-foreground/40">0</span>
      : <span className="opacity-30">—</span>,
  },
];
const COLUMNS_BY_ID = Object.fromEntries(COLUMNS.map(c => [c.id, c]));
const DEFAULT_ORDER = COLUMNS.map(c => c.id);
const colText = (v, ctx) => typeof v === "function" ? v(ctx) : v;

export default function DirectReplenishment() {
  const [selectedAlmacenes, setSelectedAlmacenes] = useState([]);
  const [selectedSuministrador, setSelectedSuministrador] = useState("");
  const [selectedEstado, setSelectedEstado] = useState("");
  const [selectedIndices, setSelectedIndices] = useState(DEFAULT_SELECTED_INDICES);
  const [showIndicesPanel, setShowIndicesPanel] = useState(false);
  const [search, setSearch] = useState("");
  const [aspecto, setAspecto] = useState("todos"); // todos | urgentes | rango | sugerido
  const [diasMin, setDiasMin] = useState(30);
  const [diasMax, setDiasMax] = useState(90);
  const [sort, setSort] = useState({ key: null, dir: "asc" }); // clic en el encabezado: asc → desc → sin orden
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);    // cada fila trae una imagen: pintar miles a la vez las hace tardar
  // ── Columnas visibles y su orden (preferencia personal, se guarda por usuario) ─────
  const { user } = useProcurementUser();
  const { order: colOrder, hidden: colHidden, change: changeLayout } =
    useColumnLayout("reab-directo-columnas", user?.email ?? "", DEFAULT_ORDER);

  const ctxBase = useMemo(() => ({ diasMin, diasMax }), [diasMin, diasMax]);
  const visibleCols = useMemo(
    () => colOrder.map(id => COLUMNS_BY_ID[id]).filter(c => c && !colHidden.has(c.id)),
    [colOrder, colHidden]);
  const colGroups = useMemo(() => {
    const g = [];
    visibleCols.forEach((c, i) => {
      const last = g[g.length - 1];
      if (last && last.section === c.section) last.n++;
      else g.push({ section: c.section, n: 1, startIdx: i });
    });
    return g;
  }, [visibleCols]);
  const groupStarts = useMemo(() => new Set(colGroups.map(g => g.startIdx)), [colGroups]);

  const prefsAppliedRef = useRef(false);

  // Preferencias del usuario
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (userPrefs === undefined || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;
    if (userPrefs?.selected_indices?.length) setSelectedIndices(userPrefs.selected_indices);
    const prefs = userPrefs?.almacenes?.length
      ? userPrefs.almacenes
      : userPrefs?.almacen ? [userPrefs.almacen] : [];
    if (prefs.length) setSelectedAlmacenes(prefs);
  }, [userPrefs]);

  // Almacenes disponibles
  const { data: allAlmacenes = [] } = useQuery({
    queryKey: ["almacenes-list"],
    queryFn: fetchAlmacenes,
    staleTime: 30 * 60 * 1000,
  });

  // Productos, índices de ventas y estado de anuncio: una sola carga (reporte indg_ap_sub),
  // compartida con Alertas y Catálogo. Llega por páginas: la tabla se va llenando.
  const indg = useIndgAlmacenes(selectedAlmacenes, selectedAlmacenes.length > 0);
  const { products: productsMap, salesMap } = indg;
  const loadingProducts = indg.loading && productsMap.size === 0;
  const loadingIndices = indg.loading;

  const SIN_ESTADO = "(Sin estado)";
  const estadosDisponibles = useMemo(() => {
    const set = new Set();
    for (const p of productsMap.values()) set.add(p.estadoAnuncio || SIN_ESTADO);
    return [...set].sort((a, b) => (a === SIN_ESTADO) - (b === SIN_ESTADO) || a.localeCompare(b));
  }, [productsMap]);

  // Suministradores únicos (derivado de los productos cargados)
  const suministradoresDisponibles = useMemo(() => {
    const set = new Set();
    for (const p of productsMap.values()) {
      if (p.suministrador) set.add(String(p.suministrador));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [productsMap]);

  // Filas combinadas: producto + índice + cálculo de reabastecimiento directo
  const rows = useMemo(() => {
    const all = Array.from(productsMap.values());
    return all
      .filter(p => !selectedSuministrador || p.suministrador === selectedSuministrador)
      .filter(p => !selectedEstado || (p.estadoAnuncio || SIN_ESTADO) === selectedEstado)
      .map(p => {
        const idOnlineKey = String(p.id_online ?? "").trim();
        const idx = salesMap.get(idOnlineKey);
        const indiceAvg = idx ? computeIndiceAvg(idx, selectedIndices) : null;
        const stock = p.cantidad ?? 0;
        const sMin = indiceAvg != null ? parseFloat((indiceAvg * diasMin).toFixed(1)) : null;
        const sIdeal = indiceAvg != null ? parseFloat((indiceAvg * diasMax).toFixed(1)) : null;
        const sugerido = (sIdeal != null && stock != null) ? Math.max(0, Math.ceil(sIdeal - stock)) : null;
        const cobDias = (indiceAvg != null && indiceAvg > 0 && stock != null)
          ? parseFloat((stock / indiceAvg).toFixed(1))
          : null;
        return { ...p, indiceAvg, categoriaVentas: idx?.categoriaVentas, sMin, sIdeal, sugerido, cobDias };
      });
  }, [productsMap, salesMap, selectedSuministrador, selectedEstado, selectedIndices, diasMin, diasMax]);

  // Los tres aspectos de urgencia (los mismos contadores del pie de la tabla)
  const esUrgente    = (r) => r.cobDias != null && r.cobDias < diasMin;
  const esEnRango    = (r) => r.cobDias != null && r.cobDias >= diasMin && r.cobDias < diasMax;
  const esConSugerido = (r) => r.sugerido != null && r.sugerido > 0;

  // Filtro de búsqueda
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.nombre || "").toLowerCase().includes(q) ||
      (r.codigo || "").toLowerCase().includes(q) ||
      String(r.id_online || "").includes(q)
    );
  }, [rows, search]);

  // Contadores sobre lo que deja la búsqueda
  const conteo = useMemo(() => ({
    urgentes: searched.filter(esUrgente).length,
    rango:    searched.filter(esEnRango).length,
    sugerido: searched.filter(esConSugerido).length,
  }), [searched, diasMin, diasMax]);

  // Filtro por aspecto (uno a la vez)
  const filtered = useMemo(() => {
    if (aspecto === "urgentes") return searched.filter(esUrgente);
    if (aspecto === "rango")    return searched.filter(esEnRango);
    if (aspecto === "sugerido") return searched.filter(esConSugerido);
    return searched;
  }, [searched, aspecto, diasMin, diasMax]);

  const toggleSort = (key, numeric) => setSort(prev => {
    if (prev.key !== key) return { key, dir: numeric ? "desc" : "asc" };
    const first = numeric ? "desc" : "asc";
    return prev.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : { key: null, dir: "asc" };
  });

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const xe = x == null || x === "", ye = y == null || y === "";
      if (xe && ye) return 0;
      if (xe) return 1;
      if (ye) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * mul;
      return String(x).localeCompare(String(y), "es") * mul;
    });
  }, [filtered, sort]);

  // Al cambiar filtros, búsqueda, orden o tamaño de página se vuelve a la primera página
  useEffect(() => { setPage(0); }, [selectedAlmacenes, selectedSuministrador, selectedEstado, search, aspecto, diasMin, diasMax, sort, pageSize]);

  const isLoading = loadingProducts;
  const withSugerido = useMemo(() => rows.filter(r => r.sugerido != null && r.sugerido > 0).length, [rows]);

  // Exportar a Excel
  const handleExportExcel = () => {
    const data = sorted.map((r, i) => ({
      "Imagen": (r.fotos ?? []).map(f => f?.foto ?? f).find(Boolean) ?? "",
      "#": i + 1,
      "Código": r.codigo || "",
      "ID Tienda": r.id_online ?? "",
      "Nombre": r.nombre || "",
      "Almacén": r.proveedor || "",
      "Suministrador": r.suministrador || "",
      "Estado anuncio": r.estadoAnuncio || "",
      "Categoría": r.categoria_online || "",
      "Stock Actual": r.cantidad ?? 0,
      "Reservado": r.reserved_qty ?? 0,
      [`Cob.(días)`]: r.cobDias ?? "",
      "I.AVG": r.indiceAvg != null ? parseFloat(r.indiceAvg.toFixed(3)) : "",
      "Cat. Ventas": r.categoriaVentas || "",
      [`S.Mín (${diasMin}d)`]: r.sMin ?? "",
      [`S.Ideal (${diasMax}d)`]: r.sIdeal ?? "",
      "Sugerido": r.sugerido ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 40 }, { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 25 },
      { wch: 18 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reab Directo");
    XLSX.writeFile(wb, `reab_directo_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <PackageX size={20} className="text-warning" />
            Reabastecimiento Directo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inventario propio de almacenes con propuestas de reabastecimiento e índices de ventas.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ColumnChooser columns={COLUMNS} sections={SECTIONS} order={colOrder} hidden={colHidden} defaultOrder={DEFAULT_ORDER} ctx={ctxBase} onChange={changeLayout} />
          {sorted.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1.5 shrink-0">
              <FileSpreadsheet size={14} className="text-green-600" />
              Excel
            </Button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <FilterBar>
        <FilterField icon={Warehouse} label="Almacenes (varios)">
          {allAlmacenes.length === 0 ? (
            <Skeleton className="h-8 w-[300px]" />
          ) : (
            <div className="w-[300px]">
              <AlmacenSearchSelect
                value={selectedAlmacenes}
                onChange={setSelectedAlmacenes}
                options={allAlmacenes}
                placeholder="Almacenes: nombre o código (593, 1053…)"
                size="sm"
              />
            </div>
          )}
        </FilterField>

        <FilterField icon={Building2} label="Suministrador">
          <div className="w-[220px]">
            <SuministradorCombobox
              value={selectedSuministrador}
              onChange={setSelectedSuministrador}
              options={suministradoresDisponibles}
              loading={loadingProducts && selectedAlmacenes.length > 0}
            />
          </div>
        </FilterField>

        <FilterField icon={Tag} label="Estado de anuncio">
          <SearchSelect
            value={selectedEstado}
            onChange={setSelectedEstado}
            options={estadosDisponibles}
            allValue="" allLabel="Todos los estados"
            placeholder="Estado anuncio" size="sm" className="w-[180px]"
            disabled={selectedAlmacenes.length === 0}
          />
        </FilterField>

        <button
          type="button"
          onClick={() => setShowIndicesPanel(o => !o)}
          title={loadingIndices ? "Cargando índices…" : `Índices de venta usados para el I.AVG (${selectedIndices.length} seleccionados)`}
          className={cn("h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-all duration-200",
            showIndicesPanel ? "bg-primary/10 border-primary/40 text-primary" : "bg-background border-input hover:border-primary/40 hover:bg-primary/5")}
        >
          <TrendingUp size={13} /> Índices
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{selectedIndices.length}</Badge>
          {loadingIndices && <Loader2 size={11} className="animate-spin" />}
        </button>
      </FilterBar>

      {showIndicesPanel && (
        <Card className="p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold flex items-center gap-2"><TrendingUp size={13} className="text-muted-foreground" /> Índices (I.AVG)</p>
            <button onClick={() => setShowIndicesPanel(false)} className="text-[11px] text-primary hover:underline">Cerrar</button>
          </div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {SELECTABLE_INDICES.map(({ key, short, label }) => (
              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                <Checkbox
                  checked={selectedIndices.includes(key)}
                  onCheckedChange={checked =>
                    setSelectedIndices(prev => checked ? [...prev, key] : prev.filter(k => k !== key))
                  }
                />
                <span className="font-mono text-primary text-[11px]">{short}</span>
                <span className="text-muted-foreground truncate">{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {salesMap.size > 0 ? `${salesMap.size.toLocaleString()} productos con índices cargados` : selectedAlmacenes.length === 0 ? "Selecciona almacenes primero" : "Sin índices"}
          </p>
        </Card>
      )}

      {/* Resumen + buscador */}
      {selectedAlmacenes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {isLoading ? (
              <Skeleton className="h-5 w-52" />
            ) : (
              <>
                <span className="text-sm">
                  <span className="font-semibold text-base text-foreground">{filtered.length.toLocaleString()}</span>
                  <span className="text-muted-foreground ml-1">productos</span>
                </span>
                {selectedSuministrador && (
                  <Badge variant="outline" className="text-xs">{selectedSuministrador}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  · <span className="text-warning font-medium">{withSugerido}</span> necesitan reabasto
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Configuración de días */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground shrink-0">S.Mín:</span>
              <select
                value={diasMin}
                onChange={e => setDiasMin(Number(e.target.value))}
                className="h-7 border border-input rounded px-1.5 text-xs bg-background"
              >
                {[7, 15, 20, 30, 45, 60].map(d => <option key={d} value={d}>{d} días</option>)}
              </select>
              <span className="text-muted-foreground shrink-0">S.Ideal:</span>
              <select
                value={diasMax}
                onChange={e => setDiasMax(Number(e.target.value))}
                className="h-7 border border-input rounded px-1.5 text-xs bg-background"
              >
                {[30, 45, 60, 90, 120, 180].map(d => <option key={d} value={d}>{d} días</option>)}
              </select>
            </div>
            {/* Filtro por aspecto */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground shrink-0">Mostrar:</span>
              <div className="flex rounded-md border border-input overflow-hidden">
                {[
                  { id: "todos",    label: "Todos",                    n: null },
                  { id: "urgentes", label: `Urgentes (<${diasMin}d)`,  n: conteo.urgentes },
                  { id: "rango",    label: "En rango",                 n: conteo.rango },
                  { id: "sugerido", label: "Con sugerido >0",          n: conteo.sugerido },
                ].map(({ id, label, n }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAspecto(id)}
                    title={
                      id === "urgentes" ? `Cobertura menor que ${diasMin} días` :
                      id === "rango"    ? `Cobertura entre ${diasMin} y ${diasMax} días` :
                      id === "sugerido" ? "Productos con cantidad sugerida mayor que cero" : undefined
                    }
                    className={cn(
                      "px-2.5 h-8 text-[11px] font-medium whitespace-nowrap transition-colors border-l border-input first:border-l-0",
                      aspecto === id ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                    {n != null && <span className="ml-1 tabular-nums opacity-80">{n.toLocaleString()}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, código o ID..."
                className="w-full pl-8 h-8 text-xs border border-input rounded-md bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabla */}
      {selectedAlmacenes.length === 0 ? (
        <Card className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
          <Warehouse size={40} className="opacity-20" />
          <p className="text-sm font-medium">Selecciona al menos un almacén para ver productos.</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-sm">Cargando productos y propuestas de reabastecimiento...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <PackageX size={36} className="opacity-20" />
              <p className="text-sm font-medium">
                {search ? `Sin resultados para "${search}"` : "Sin productos para los filtros seleccionados"}
              </p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-background">
                  {/* Fila de secciones (agrupa las columnas visibles consecutivas de una misma sección) */}
                  <tr>
                    {colGroups.map(g => {
                      const sec = SECTIONS[g.section];
                      return (
                        <th key={g.startIdx} colSpan={g.n}
                          className={cn("px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border/60",
                            g.section === "producto" ? "text-left" : "text-center", sec.hdr, sec.div)}>
                          {sec.label}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Fila de columnas */}
                  <tr className="border-b border-border">
                    {visibleCols.map((col, ci) => {
                      const sec = SECTIONS[col.section];
                      const active = col.sortKey && sort.key === col.sortKey;
                      const title = colText(col.title, ctxBase);
                      return (
                        <th
                          key={col.id}
                          title={col.sortKey ? `${title ? title + ". " : ""}Clic para ordenar` : title}
                          onClick={col.sortKey ? () => toggleSort(col.sortKey, col.num) : undefined}
                          className={cn(
                            "px-3 py-2 text-left font-medium whitespace-nowrap select-none",
                            sec.col, groupStarts.has(ci) && sec.div,
                            col.sortKey ? "cursor-pointer hover:text-foreground" : title && "cursor-help",
                            active ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {colText(col.label, ctxBase)}
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
                  {sorted.slice(page * pageSize, (page + 1) * pageSize).map((r, i) => {
                    const urgente = r.sugerido > 0 && r.cobDias != null && r.cobDias < diasMin;
                    const ctx = { ...ctxBase, i: page * pageSize + i, urgente };
                    return (
                      <tr key={r.id_online ?? `row-${i}`} className={cn("border-b border-border/50 hover:bg-muted/30", urgente && "bg-destructive/5")}>
                        {visibleCols.map((col, ci) => {
                          const sec = SECTIONS[col.section];
                          return (
                            <td key={col.id}
                              title={col.tdTitle?.(r, ctx)}
                              className={cn("px-3 py-1.5", sec.cell, groupStarts.has(ci) && sec.div, col.tdClass?.(r, ctx))}>
                              {col.content(r, ctx)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && sorted.length > 0 && (
            <>
            <TablePager page={page} pageSize={pageSize} total={sorted.length} onPage={setPage} onPageSize={setPageSize} />
            <div className="px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-1">
              <span>
                {sorted.length} de {rows.length} productos
                {selectedSuministrador ? ` · ${selectedSuministrador}` : ""}
                {search ? ` · "${search}"` : ""}
              </span>
              <span>
                <span className="text-destructive font-medium">{conteo.urgentes}</span> urgentes (&lt;{diasMin}d)
                {" · "}
                <span className="text-warning font-medium">{conteo.rango}</span> en rango
                {" · "}
                <span className="text-primary font-medium">{conteo.sugerido}</span> con sugerido &gt;0
              </span>
            </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
