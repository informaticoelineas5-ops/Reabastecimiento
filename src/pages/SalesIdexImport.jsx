import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TrendingUp, Settings, Save, CheckCircle2, ChevronDown, X, Search, HelpCircle, BarChart2, Calendar, FileSpreadsheet, Loader2, RefreshCw, Warehouse, Building2 } from "lucide-react";
import { FilterBar, FilterField } from "@/components/common/FilterBar";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { fetchSalesIndicesAlmacenStream, computeIndiceAvg, almacenesSinClave } from "@/api/salesIndicesClient";
import AlmacenSearchSelect from "@/components/common/AlmacenSearchSelect";
import SearchSelect from "@/components/common/SearchSelect";
import {
  SELECTABLE_INDICES,
  DEFAULT_SELECTED_INDICES,
  getUserPreferences,
  saveUserPreferences,
} from "@/api/userPreferencesClient";
import { fetchAlmacenes, fetchProductsForAlmacen } from "@/api/externalSupabaseClient";
import { fetchVdLatestForDateRange } from "@/api/elineasApiClient";
import IndicesHelpModal from "@/components/IndicesHelpModal";
import * as XLSX from "xlsx";

const INDEX_GROUPS = (() => {
  const groups = {};
  for (const idx of SELECTABLE_INDICES) {
    const g = idx.group ?? "Ventas";
    if (!groups[g]) groups[g] = [];
    groups[g].push(idx);
  }
  return Object.entries(groups);
})();

// ── Componentes reutilizables ────────────────────────────────────────────────

// Combobox de búsqueda mientras se escribe (igual que DirectReplenishment)
function SuministradorCombobox({ label, value, onChange, options, loading, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, search]);
  return (
    <div className="space-y-1.5" ref={ref}>
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="relative">
        <div className={`flex items-center h-8 border rounded-md bg-background text-xs overflow-hidden transition-colors ${open ? "border-primary ring-1 ring-ring" : "border-input"} ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
          <Search size={13} className="ml-2.5 text-muted-foreground shrink-0" />
          <input
            className="flex-1 px-2 h-full outline-none bg-transparent placeholder:text-muted-foreground"
            placeholder={loading ? "Cargando..." : placeholder ?? "Buscar suministrador..."}
            value={value || search}
            onChange={e => { if (value) onChange(""); setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            disabled={loading || disabled}
          />
          {(value || search) && (
            <button onClick={() => { onChange(""); setSearch(""); }} className="px-1.5 hover:text-destructive shrink-0"><X size={11} /></button>
          )}
          <ChevronDown size={12} className={`mr-2 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        {open && !value && (
          <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-52 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</div>
            ) : (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-muted-foreground italic border-b border-border/50"
                  onClick={() => { onChange(""); setSearch(""); setOpen(false); }}>
                  Todos los suministradores ({options.length})
                </button>
                {filtered.slice(0, 150).map(o => (
                  <button key={o} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                    onClick={() => { onChange(o); setSearch(""); setOpen(false); }}>
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
      {value && <Badge variant="secondary" className="text-xs">{value}</Badge>}
    </div>
  );
}

// ── Helpers de fecha ─────────────────────────────────────────────────────────

// "Ene 26"
function fmtMonth(ym) {
  const [y, m] = ym.split("-");
  const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${MESES[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// Todos los YYYY-MM entre dos fechas (inclusive)
function getAllMonthsInRange(from, to) {
  const months = [];
  const d = new Date(from.slice(0, 7) + "-01T00:00:00");
  const end = new Date(to.slice(0, 7) + "-01T00:00:00");
  while (d <= end) {
    months.push(d.toISOString().slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

// ── Agregaciones VD ──────────────────────────────────────────────────────────

function aggregateMonthly(rows, nombreByCodigo, fromDate, toDate) {
  const allMonths = getAllMonthsInRange(fromDate, toDate);
  const byCode = {};
  for (const r of rows) {
    const month = (r.sellDate ?? "").slice(0, 7);
    if (!month) continue;
    if (!byCode[r.codigo]) byCode[r.codigo] = { codigo: r.codigo, nombre: nombreByCodigo?.get(r.codigo) ?? "", totalQty: 0, totalImporte: 0, porMes: {} };
    const qty = parseFloat(r.quantity) || 0;
    const imp = parseFloat(r.finalPrice) || 0;
    byCode[r.codigo].totalQty += qty;
    byCode[r.codigo].totalImporte += imp;
    byCode[r.codigo].porMes[month] = (byCode[r.codigo].porMes[month] || 0) + qty;
  }
  const tabla = Object.values(byCode).sort((a, b) => b.totalQty - a.totalQty);
  return { meses: allMonths, tabla };
}

function aggregateAnual(rows, nombreByCodigo, fromDate, toDate) {
  const fromYear = fromDate.slice(0, 4);
  const toYear = toDate.slice(0, 4);
  const allAnios = [];
  for (let y = parseInt(fromYear); y <= parseInt(toYear); y++) allAnios.push(String(y));
  const byCode = {};
  for (const r of rows) {
    const year = (r.sellDate ?? "").slice(0, 4);
    if (!year) continue;
    if (!byCode[r.codigo]) byCode[r.codigo] = { codigo: r.codigo, nombre: nombreByCodigo?.get(r.codigo) ?? "", totalQty: 0, porAnio: {} };
    const qty = parseFloat(r.quantity) || 0;
    byCode[r.codigo].totalQty += qty;
    byCode[r.codigo].porAnio[year] = (byCode[r.codigo].porAnio[year] || 0) + qty;
  }
  const tabla = Object.values(byCode).sort((a, b) => b.totalQty - a.totalQty);
  return { anios: allAnios, tabla };
}

function getDiarioRows(rows, nombreByCodigo) {
  return rows.map(r => ({
    sellDate: r.sellDate ?? "",
    codigo: r.codigo,
    nombre: nombreByCodigo?.get(r.codigo) ?? "",
    quantity: parseFloat(r.quantity) || 0,
    finalPrice: parseFloat(r.finalPrice) || 0,
  })).sort((a, b) => b.sellDate.localeCompare(a.sellDate) || b.quantity - a.quantity);
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function SalesIndexConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedAlmacenes, setSelectedAlmacenes] = useState([]);
  const [selectedSuministrador, setSelectedSuministrador] = useState(""); // single value typeahead
  const [showIndicesPanel, setShowIndicesPanel] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(DEFAULT_SELECTED_INDICES);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [prefsApplied, setPrefsApplied] = useState(false);

  const [viewMode, setViewMode] = useState("indices");
  const [previewSuministrador, setPreviewSuministrador] = useState("all"); // tabla header filter

  // VD state
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const [vdDateFrom, setVdDateFrom] = useState(firstOfMonth);
  const [vdDateTo, setVdDateTo] = useState(today);
  const [vdAggMode, setVdAggMode] = useState("mensual");
  const [vdRows, setVdRows] = useState([]);
  const [vdLoading, setVdLoading] = useState(false);
  const [vdLoaded, setVdLoaded] = useState(false);
  const [vdProgress, setVdProgress] = useState({ loaded: 0, total: null });
  const vdAbortRef = useRef(false);

  const initializedRef = useRef(false);
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (userPrefs === undefined) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (userPrefs?.selected_indices?.length) setSelectedIndices(userPrefs.selected_indices);
    if (userPrefs?.almacenes?.length) setSelectedAlmacenes(userPrefs.almacenes);
    else if (userPrefs?.almacen) setSelectedAlmacenes([userPrefs.almacen]);
    // suministradores preference → load first one as single value
    if (userPrefs?.suministradores?.length) setSelectedSuministrador(userPrefs.suministradores[0]);
    else if (userPrefs?.suministrador) setSelectedSuministrador(userPrefs.suministrador);
    setPrefsApplied(true);
  }, [userPrefs]);

  const { data: almacenes = [], isLoading: loadingAlmacenes } = useQuery({
    queryKey: ["ext-almacenes"],
    queryFn: fetchAlmacenes,
    staleTime: 10 * 60 * 1000,
  });

  // Productos para lookup nombre (cache compartida)
  const { data: productsMap = new Map() } = useQuery({
    queryKey: ["direct-products", selectedAlmacenes],
    queryFn: async () => {
      if (!selectedAlmacenes.length) return new Map();
      const maps = await Promise.all(selectedAlmacenes.map(a => fetchProductsForAlmacen(a)));
      const merged = new Map();
      maps.forEach(m => m.forEach((v, k) => merged.set(k, v)));
      return merged;
    },
    enabled: selectedAlmacenes.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // codigo → nombre (para VD)
  const nombreByCodigo = useMemo(() => {
    const m = new Map();
    for (const p of productsMap.values()) {
      if (p.codigo && p.nombre) m.set(String(p.codigo).trim(), p.nombre);
    }
    return m;
  }, [productsMap]);

  // idTienda → { nombre, codigo } (para tabla Índices)
  const nombreByIdTienda = useMemo(() => {
    const m = new Map();
    for (const p of productsMap.values()) {
      const id = String(p.id_online ?? "").trim();
      if (id && p.nombre) m.set(id, { nombre: p.nombre, codigo: p.codigo ?? "" });
    }
    return m;
  }, [productsMap]);

  // ── Índices de ventas ────────────────────────────────────────────────────────
  const [salesMap, setSalesMap] = useState(new Map());
  const [loadingSales, setLoadingSales] = useState(true);
  const [salesError, setSalesError] = useState("");

  const suministradoresDisponibles = useMemo(() => {
    const set = new Set();
    for (const entry of salesMap.values()) {
      if (entry.suministrador != null) set.add(String(entry.suministrador).trim());
    }
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [salesMap]);

  const almacenesCacheKey = useMemo(() => [...selectedAlmacenes].sort().join("|"), [selectedAlmacenes]);

  useEffect(() => { setPreviewSuministrador("all"); }, [almacenesCacheKey]);

  // Los índices solo se cargan cuando hay al menos un almacén seleccionado
  useEffect(() => {
    if (!prefsApplied) return;
    setSalesError("");
    if (!selectedAlmacenes.length) {
      setSalesMap(new Map());
      setLoadingSales(false);
      return;
    }
    const queryKey = ["sales-indices-db", almacenesCacheKey];
    const cached = queryClient.getQueryData(queryKey);
    if (cached) { setSalesMap(cached); setLoadingSales(false); return; }
    let cancelled = false;
    setLoadingSales(true);
    setSalesMap(new Map());
    fetchSalesIndicesAlmacenStream(selectedAlmacenes, (partial) => { if (!cancelled) setSalesMap(partial); })
      .then((fullMap) => {
        if (!cancelled) { setLoadingSales(false); queryClient.setQueryData(queryKey, fullMap); }
      })
      .catch((err) => {
        if (!cancelled) { setLoadingSales(false); setSalesError(err.message); }
      });
    return () => { cancelled = true; };
  }, [almacenesCacheKey, prefsApplied]);

  const sinClave = useMemo(() => almacenesSinClave(selectedAlmacenes), [selectedAlmacenes]);
  const sinAlmacen = selectedAlmacenes.length === 0;

  const [idxPage, setIdxPage] = useState(0);
  const [search, setSearch] = useState("");

  const allSortedRows = useMemo(() => {
    const rows = [];
    if (!selectedAlmacenes.length) return rows;
    for (const [id, entry] of salesMap.entries()) {
      // Filtro por suministrador del panel config (single value)
      if (selectedSuministrador && String(entry.suministrador ?? "").trim() !== selectedSuministrador) continue;
      // Filtro por suministrador del dropdown de la tabla
      if (previewSuministrador !== "all" && String(entry.suministrador ?? "").trim() !== previewSuministrador) continue;
      const indiceAvg = computeIndiceAvg(entry, selectedIndices);
      const prod = nombreByIdTienda.get(String(id).trim());
      rows.push({ id_tienda: id, ...entry, indiceAvg, nombre: prod?.nombre ?? "", codigo: prod?.codigo ?? "" });
    }
    rows.sort((a, b) => {
      if (a.indiceAvg == null && b.indiceAvg == null) return 0;
      if (a.indiceAvg == null) return 1;
      if (b.indiceAvg == null) return -1;
      return b.indiceAvg - a.indiceAvg;
    });
    return rows;
  }, [salesMap, selectedAlmacenes, selectedIndices, selectedSuministrador, previewSuministrador, nombreByIdTienda]);

  const tableRows = useMemo(() => allSortedRows.slice(0, 200), [allSortedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tableRows;
    return tableRows.filter(row =>
      String(row.id_tienda).includes(q) ||
      (row.nombre || "").toLowerCase().includes(q) ||
      (row.codigo || "").toLowerCase().includes(q) ||
      (row.suministrador || "").toLowerCase().includes(q)
    );
  }, [tableRows, search]);

  useEffect(() => { setIdxPage(0); }, [salesMap, search, selectedSuministrador]);

  const IDX_PAGE_SIZE = 100;
  const idxTotalPages = Math.ceil(filteredRows.length / IDX_PAGE_SIZE);
  const idxPageRows = filteredRows.slice(idxPage * IDX_PAGE_SIZE, (idxPage + 1) * IDX_PAGE_SIZE);
  const totalProducts = allSortedRows.length;

  const handleToggleIndex = (key) =>
    setSelectedIndices(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveUserPreferences({
        almacenes: selectedAlmacenes,
        suministradores: selectedSuministrador ? [selectedSuministrador] : [],
        suministrador: selectedSuministrador || null,
        selected_indices: selectedIndices,
      });
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      toast({ title: "Configuración guardada", duration: 3000 });
    } catch (err) {
      toast({ title: "Error al guardar", description: err?.message, variant: "destructive", duration: 4000 });
    } finally {
      setSaving(false);
    }
  };

  // Exportar Índices
  const handleExportIndices = () => {
    const data = filteredRows.map(row => {
      const base = { "ID Tienda": row.id_tienda, "Código": row.codigo, "Nombre": row.nombre, "Suministrador": row.suministrador ?? "", "Cat.V": row.categoriaVentas ?? "", "I.AVG": row.indiceAvg != null ? parseFloat(row.indiceAvg.toFixed(4)) : "" };
      for (const { key, short } of SELECTABLE_INDICES) {
        base[short] = row[key] != null ? parseFloat(Number(row[key]).toFixed(4)) : "";
      }
      return base;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Índices");
    XLSX.writeFile(wb, `indices_ventas_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // VD: cargar datos
  const handleLoadVd = useCallback(async () => {
    vdAbortRef.current = false;
    setVdLoading(true);
    setVdLoaded(false);
    setVdRows([]);
    setVdProgress({ loaded: 0, total: null });
    try {
      const rows = await fetchVdLatestForDateRange(vdDateFrom, vdDateTo, (loaded, total) => {
        if (!vdAbortRef.current) setVdProgress({ loaded, total });
      });
      if (!vdAbortRef.current) { setVdRows(rows); setVdLoaded(true); }
    } catch (err) {
      toast({ title: "Error cargando Ventas Directas", description: err?.message, variant: "destructive", duration: 4000 });
    } finally {
      setVdLoading(false);
    }
  }, [vdDateFrom, vdDateTo, toast]);

  // Agregaciones (pasan el rango de fechas para mostrar todos los meses aunque estén vacíos)
  const { meses, tabla: tablaMensual } = useMemo(
    () => vdAggMode === "mensual" && vdLoaded
      ? aggregateMonthly(vdRows, nombreByCodigo, vdDateFrom, vdDateTo)
      : { meses: [], tabla: [] },
    [vdRows, vdAggMode, vdLoaded, nombreByCodigo, vdDateFrom, vdDateTo]
  );
  const { anios, tabla: tablaAnual } = useMemo(
    () => vdAggMode === "anual" && vdLoaded
      ? aggregateAnual(vdRows, nombreByCodigo, vdDateFrom, vdDateTo)
      : { anios: [], tabla: [] },
    [vdRows, vdAggMode, vdLoaded, nombreByCodigo, vdDateFrom, vdDateTo]
  );
  const diarioRows = useMemo(
    () => vdAggMode === "diario" && vdLoaded ? getDiarioRows(vdRows, nombreByCodigo) : [],
    [vdRows, vdAggMode, vdLoaded, nombreByCodigo]
  );

  const totalVdQty = useMemo(() => vdRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0), [vdRows]);
  const totalVdImporte = useMemo(() => vdRows.reduce((s, r) => s + (parseFloat(r.finalPrice) || 0), 0), [vdRows]);

  const handleExportVd = () => {
    let data, sheetName;
    if (vdAggMode === "mensual") {
      sheetName = "VD Mensual";
      data = tablaMensual.map(r => {
        const row = { "Código": r.codigo, "Nombre": r.nombre, "Total Qty": r.totalQty, "Total Importe": parseFloat(r.totalImporte.toFixed(2)) };
        for (const m of meses) row[fmtMonth(m)] = r.porMes[m] ?? 0;
        return row;
      });
    } else if (vdAggMode === "anual") {
      sheetName = "VD Anual";
      data = tablaAnual.map(r => {
        const row = { "Código": r.codigo, "Nombre": r.nombre, "Total Qty": r.totalQty };
        for (const a of anios) row[a] = r.porAnio[a] ?? 0;
        return row;
      });
    } else {
      sheetName = "VD Diario";
      data = diarioRows.map(r => ({ "Fecha": r.sellDate, "Código": r.codigo, "Nombre": r.nombre, "Cantidad": r.quantity, "Importe": r.finalPrice }));
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `vd_${vdAggMode}_${vdDateFrom}_${vdDateTo}.xlsx`);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              Configuración de Índices de Ventas
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personaliza almacenes, suministrador e índices visibles en el Catálogo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs flex items-center gap-1.5">
            {sinAlmacen
              ? "Selecciona un almacén"
              : loadingSales
                ? <><div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />Cargando índices...</>
                : `${totalProducts.toLocaleString()} productos en índices`}
          </Badge>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <><CheckCircle2 size={14} className="mr-1.5 animate-pulse" />Guardando...</> : <><Save size={14} className="mr-1.5" />Guardar</>}
          </Button>
        </div>
      </div>

      {/* Configuración: una franja con iconos */}
      <FilterBar>
        <FilterField icon={Warehouse} label="Almacenes que gestionas (aparecen en el Catálogo y el Ranking de Ventas)">
          <div className="w-[330px]">
            <AlmacenSearchSelect
              options={almacenes}
              value={selectedAlmacenes}
              onChange={setSelectedAlmacenes}
              loading={loadingAlmacenes}
              placeholder="Almacenes: nombre o código (593, 1053…)"
              size="sm"
            />
          </div>
        </FilterField>

        <FilterField icon={Building2} label="Suministrador (opcional)">
          <div className="w-[240px]">
            <SuministradorCombobox
              value={selectedSuministrador}
              onChange={setSelectedSuministrador}
              options={suministradoresDisponibles}
              loading={loadingSales && selectedAlmacenes.length > 0}
              disabled={selectedAlmacenes.length === 0}
              placeholder={selectedAlmacenes.length === 0 ? "Selecciona almacenes primero" : "Todos los suministradores"}
            />
          </div>
        </FilterField>

        <button
          type="button"
          onClick={() => setShowIndicesPanel(o => !o)}
          title="Índices que se muestran en el Catálogo y con los que se calcula el I.AVG"
          className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-all duration-200 ${showIndicesPanel ? "bg-primary/10 border-primary/40 text-primary" : "bg-background border-input hover:border-primary/40 hover:bg-primary/5"}`}
        >
          <TrendingUp size={13} /> Índices visibles
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{selectedIndices.length} / {SELECTABLE_INDICES.length}</Badge>
          <ChevronDown size={12} className={`transition-transform ${showIndicesPanel ? "rotate-180" : ""}`} />
        </button>

        <span className="h-8 inline-flex items-center text-[11px] text-muted-foreground">
          {selectedAlmacenes.length === 0 ? "" : loadingSales ? "Cargando suministradores…" : `${suministradoresDisponibles.length} suministradores`}
        </span>
      </FilterBar>

      {sinClave.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 -mt-2">
          No se pudo identificar el código de: {sinClave.join(", ")}. Sus índices no se cargan.
        </p>
      )}

      {showIndicesPanel && (
        <div className="bg-card border border-border rounded-xl p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Índices visibles en Catálogo</h2>
            <Button variant="outline" size="sm" onClick={() => setShowHelp(true)} className="h-6 px-2 text-[11px] gap-1">
              <HelpCircle size={11} />Ver guía
            </Button>
          </div>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {INDEX_GROUPS.map(([groupName, indices]) => (
              <div key={groupName}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 pb-1 border-b border-border/40">{groupName}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {indices.map(({ key, label, short }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Checkbox id={`idx-${key}`} checked={selectedIndices.includes(key)} onCheckedChange={() => handleToggleIndex(key)} />
                      <Label htmlFor={`idx-${key}`} className="text-xs cursor-pointer leading-tight" title={label}>
                        <span className="font-mono text-primary mr-1">{short}</span>
                        <span className="text-muted-foreground">{label}</span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center text-xs bg-muted/30 rounded-lg px-3 py-2.5 border border-border/50">
        <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] shrink-0">Índices:</span>
        {[
          { short: "P.>0", cls: "text-primary", desc: "Ventas/día en días con movimiento (índice principal)" },
          { short: "P.≥½", cls: "text-muted-foreground", desc: "Ventas/día en días de alta venta" },
          { short: "P.1m", cls: "text-muted-foreground", desc: "Ventas/día últimos 30 días" },
          { short: "I.AVG", cls: "text-emerald-700", desc: "= promedio de índices seleccionados · base para calcular cuánto pedir" },
        ].map(({ short, cls, desc }) => (
          <span key={short} className="flex items-center gap-1.5 shrink-0">
            <code className={`font-bold font-mono text-[11px] ${cls}`}>{short}</code>
            <span className="text-muted-foreground text-[11px]">{desc}</span>
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setShowHelp(true)} className="ml-auto h-6 px-2 text-[11px] shrink-0">Ver guía completa →</Button>
      </div>

      {/* Tabla de vista previa + tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col gap-2">
          {/* Tabs + controles superiores */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold">
                {sinAlmacen
                  ? "Vista previa"
                  : loadingSales
                    ? <span className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />Vista previa — Cargando...</span>
                    : `Vista previa — Top ${tableRows.length}`}
              </h2>
              <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
                <button className={`px-2.5 py-1 font-medium transition-colors ${viewMode === "indices" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                  onClick={() => setViewMode("indices")}>Índices</button>
                <button className={`px-2.5 py-1 font-medium transition-colors flex items-center gap-1 ${viewMode === "ventas-directas" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                  onClick={() => setViewMode("ventas-directas")}>
                  <BarChart2 size={11} />Ventas Directas
                </button>
              </div>
            </div>
            {viewMode === "indices" && (
              <div className="flex items-center gap-2">
                {allSortedRows.length > 200 && <span className="text-xs text-muted-foreground">Mostrando 200 de {allSortedRows.length.toLocaleString()}</span>}
                {filteredRows.length > 0 && (
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={handleExportIndices}>
                    <FileSpreadsheet size={13} className="text-green-600" />Excel
                  </Button>
                )}
                {idxTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={idxPage === 0} onClick={() => setIdxPage(p => p - 1)}>← Ant.</Button>
                    <span className="text-xs text-muted-foreground px-1">{idxPage + 1}/{idxTotalPages}</span>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={idxPage >= idxTotalPages - 1} onClick={() => setIdxPage(p => p + 1)}>Sig. →</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Buscador + filtro suministrador tabla (solo Índices) */}
          {viewMode === "indices" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por ID Tienda, nombre, código o suministrador..." className="h-7 pl-7 text-xs" />
              </div>
              {suministradoresDisponibles.length > 0 && !selectedSuministrador && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0">Ver solo:</span>
                  <SearchSelect
                    value={previewSuministrador}
                    onChange={v => { setPreviewSuministrador(v); setIdxPage(0); }}
                    options={suministradoresDisponibles}
                    allValue="all" allLabel="Todos los suministradores"
                    placeholder="Todos" size="xs" className="w-[220px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Controles Ventas Directas */}
          {viewMode === "ventas-directas" && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-1.5">
                <Calendar size={13} className="text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0">Desde:</span>
                <Input type="date" value={vdDateFrom} onChange={e => setVdDateFrom(e.target.value)} className="h-7 text-xs w-[140px]" />
                <span className="text-xs text-muted-foreground shrink-0">Hasta:</span>
                <Input type="date" value={vdDateTo} onChange={e => setVdDateTo(e.target.value)} className="h-7 text-xs w-[140px]" />
              </div>
              <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
                {["diario","mensual","anual"].map(m => (
                  <button key={m} className={`px-2.5 py-1 font-medium capitalize transition-colors ${vdAggMode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                    onClick={() => setVdAggMode(m)}>{m}</button>
                ))}
              </div>
              <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleLoadVd} disabled={vdLoading}>
                {vdLoading ? <><Loader2 size={12} className="animate-spin" />Cargando...</> : <><RefreshCw size={12} />Cargar datos</>}
              </Button>
              {vdLoaded && vdRows.length > 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExportVd}>
                  <FileSpreadsheet size={12} className="text-green-600" />Excel
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground/70 ml-auto">* Ventas Directas es un reporte general de la empresa (no filtra por almacén)</span>
            </div>
          )}
        </div>

        {/* ── Tab Índices ────────────────────────────────────────────────────── */}
        {viewMode === "indices" && (
          <>
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-muted border-b border-border">
                    <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted z-30 whitespace-nowrap">ID Tienda</th>
                    <th className="px-3 py-2 text-left font-medium bg-muted min-w-[160px]">Nombre</th>
                    <th className="px-3 py-2 text-left font-medium bg-muted whitespace-nowrap">Suministrador</th>
                    <th className="px-3 py-2 text-center font-medium bg-muted">Cat.V</th>
                    <th className="px-3 py-2 text-right font-medium bg-muted">I.AVG</th>
                    {SELECTABLE_INDICES.map(({ key, short, label }) => (
                      <th key={key} className={`px-3 py-2 text-right font-medium whitespace-nowrap transition-opacity ${selectedIndices.includes(key) ? "opacity-100" : "opacity-30"}`} title={label}>
                        {short}{selectedIndices.includes(key) && <span className="ml-0.5 text-chart-2">✓</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {idxPageRows.map(row => (
                    <tr key={row.id_tienda} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-1.5 font-mono text-primary sticky left-0 bg-card z-10 whitespace-nowrap">{row.id_tienda}</td>
                      <td className="px-3 py-1.5 max-w-[200px] truncate text-foreground" title={row.nombre}>{row.nombre || <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap max-w-[130px] truncate" title={row.suministrador}>{row.suministrador || <span className="opacity-40">—</span>}</td>
                      <td className="px-3 py-1.5 text-center">
                        {row.categoriaVentas != null ? (
                          <Badge className={`text-[10px] ${row.categoriaVentas === "A" ? "bg-chart-2/15 text-chart-2" : row.categoriaVentas === "B" ? "bg-chart-3/15 text-chart-3" : row.categoriaVentas === "C" ? "bg-info/15 text-info" : "bg-muted text-muted-foreground"}`}>{row.categoriaVentas}</Badge>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{row.indiceAvg != null ? row.indiceAvg.toFixed(3) : "—"}</td>
                      {SELECTABLE_INDICES.map(({ key }) => (
                        <td key={key} className={`px-3 py-1.5 text-right font-mono transition-opacity ${selectedIndices.includes(key) ? "opacity-100" : "opacity-30"}`}>
                          {row[key] != null ? Number(row[key]).toFixed(3) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {tableRows.length === 0 && (
                    <tr>
                      <td colSpan={5 + SELECTABLE_INDICES.length} className="text-center text-muted-foreground py-12">
                        {sinAlmacen
                          ? "Selecciona al menos un almacén para ver sus índices de ventas."
                          : loadingSales
                            ? <div className="flex items-center justify-center gap-2"><div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /><span>Cargando índices de ventas...</span></div>
                            : salesError
                              ? <span className="text-destructive">No se pudieron cargar los índices: {salesError}</span>
                              : "No hay datos de índices para los almacenes seleccionados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
              <span>
                {search.trim()
                  ? `${filteredRows.length} resultado(s) para "${search.trim()}"`
                  : selectedSuministrador
                    ? `Suministrador: ${selectedSuministrador} · ${filteredRows.length} producto(s)`
                    : `Top 200 por I.AVG${allSortedRows.length > 200 ? ` · Total: ${allSortedRows.length.toLocaleString()} productos` : ""}`}
              </span>
              {idxTotalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={idxPage === 0} onClick={() => setIdxPage(p => p - 1)}>← Ant.</Button>
                  <span className="text-xs px-1">Pág. {idxPage + 1} / {idxTotalPages}</span>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={idxPage >= idxTotalPages - 1} onClick={() => setIdxPage(p => p + 1)}>Sig. →</Button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Tab Ventas Directas ───────────────────────────────────────────── */}
        {viewMode === "ventas-directas" && (
          <div className="min-h-[300px]">
            {!vdLoaded && !vdLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <BarChart2 size={36} className="opacity-20" />
                <p className="text-sm font-medium">Selecciona el período y haz clic en "Cargar datos"</p>
              </div>
            )}
            {vdLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
                <Loader2 size={28} className="animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-sm font-medium">Cargando Ventas Directas...</p>
                  {vdProgress.total != null
                    ? <p className="text-xs mt-1">{vdProgress.loaded.toLocaleString()} / {vdProgress.total.toLocaleString()} filas</p>
                    : <p className="text-xs mt-1">{vdProgress.loaded.toLocaleString()} filas cargadas</p>}
                </div>
              </div>
            )}
            {vdLoaded && !vdLoading && (
              <>
                <div className="px-4 py-3 bg-muted/30 border-b border-border flex flex-wrap gap-4 text-xs">
                  <span><span className="font-semibold text-foreground">{vdRows.length.toLocaleString()}</span> <span className="text-muted-foreground">transacciones</span></span>
                  <span><span className="font-semibold text-foreground">{totalVdQty.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> <span className="text-muted-foreground">unidades</span></span>
                  <span><span className="font-semibold text-foreground">{totalVdImporte.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> <span className="text-muted-foreground">CUP importe total</span></span>
                  <span className="text-muted-foreground">{vdDateFrom} → {vdDateTo}</span>
                </div>
                {vdRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                    <BarChart2 size={32} className="opacity-20" />
                    <p className="text-sm">Sin datos de Ventas Directas para el período seleccionado.</p>
                  </div>
                ) : vdAggMode === "diario" ? (
                  <div className="overflow-auto max-h-[480px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted border-b border-border">
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Fecha</th>
                          <th className="px-3 py-2 text-left font-medium">Código</th>
                          <th className="px-3 py-2 text-left font-medium min-w-[180px]">Nombre</th>
                          <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                          <th className="px-3 py-2 text-right font-medium">Importe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diarioRows.slice(0, 500).map((r, i) => (
                          <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-3 py-1.5 font-mono text-muted-foreground whitespace-nowrap">{r.sellDate}</td>
                            <td className="px-3 py-1.5 font-mono">{r.codigo}</td>
                            <td className="px-3 py-1.5 max-w-[220px] truncate" title={r.nombre}>{r.nombre || <span className="text-muted-foreground/40">—</span>}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold">{r.quantity.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.finalPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                        {diarioRows.length > 500 && (
                          <tr><td colSpan={5} className="px-3 py-2 text-center text-xs text-muted-foreground border-t border-border">Mostrando 500 de {diarioRows.length.toLocaleString()} filas. Exporta a Excel para ver todas.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : vdAggMode === "mensual" ? (
                  <div className="overflow-auto max-h-[480px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted border-b border-border">
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap sticky left-0 bg-muted z-20">Código</th>
                          <th className="px-3 py-2 text-left font-medium min-w-[160px] bg-muted">Nombre</th>
                          <th className="px-3 py-2 text-right font-medium bg-muted whitespace-nowrap">Total</th>
                          {meses.map(m => (
                            <th key={m} className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmtMonth(m)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tablaMensual.map(r => (
                          <tr key={r.codigo} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-3 py-1.5 font-mono sticky left-0 bg-card z-10 whitespace-nowrap">{r.codigo}</td>
                            <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.nombre}>{r.nombre || <span className="text-muted-foreground/40">—</span>}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-primary">{r.totalQty.toLocaleString()}</td>
                            {meses.map(m => (
                              <td key={m} className={`px-3 py-1.5 text-right font-mono ${r.porMes[m] ? "text-foreground" : "text-muted-foreground/30"}`}>
                                {r.porMes[m] ? r.porMes[m].toLocaleString() : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[480px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted border-b border-border">
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap sticky left-0 bg-muted z-20">Código</th>
                          <th className="px-3 py-2 text-left font-medium min-w-[160px] bg-muted">Nombre</th>
                          <th className="px-3 py-2 text-right font-medium bg-muted whitespace-nowrap">Total</th>
                          {anios.map(a => <th key={a} className="px-3 py-2 text-right font-medium whitespace-nowrap">{a}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {tablaAnual.map(r => (
                          <tr key={r.codigo} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-3 py-1.5 font-mono sticky left-0 bg-card z-10 whitespace-nowrap">{r.codigo}</td>
                            <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.nombre}>{r.nombre || <span className="text-muted-foreground/40">—</span>}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-primary">{r.totalQty.toLocaleString()}</td>
                            {anios.map(a => (
                              <td key={a} className={`px-3 py-1.5 text-right font-mono ${r.porAnio[a] ? "text-foreground" : "text-muted-foreground/30"}`}>
                                {r.porAnio[a] ? r.porAnio[a].toLocaleString() : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <IndicesHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
