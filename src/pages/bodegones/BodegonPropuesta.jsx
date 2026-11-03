import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Clock, Plus, X,
  ShoppingCart, ChevronDown, ChevronRight,
  FileSpreadsheet, Search, SlidersHorizontal, Bookmark, BookmarkPlus, Trash2, Undo2, Check,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { fetchProductsForAlmacen, fetchAlmacenes } from "@/api/externalSupabaseClient";
import { fetchBodegonProductOrigins, fetchOfferStockByCodes } from "@/api/reabApiClient";
import { cn } from "@/lib/utils";
import {
  fetchSalesIndicesAlmacenStream,
  computeIndiceAvg,
} from "@/api/salesIndicesClient";
import {
  SELECTABLE_INDICES,
  DEFAULT_SELECTED_INDICES,
} from "@/api/userPreferencesClient";
import * as XLSX from "xlsx";
import { listExternalProductOrigins } from "@/api/externalInvoicesStore";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import ColumnChooser from "@/components/common/ColumnChooser";
import { useColumnLayout } from "@/hooks/useColumnLayout";
import { listSavedViews, saveSavedView, deleteSavedView, getSavedViewsMode } from "@/api/savedViewsStore";
import { roleInfo } from "@/utils/bodegonRoles";
import { BODEGON_CONFIG } from "./propuestaConfig";

// ── Constantes ────────────────────────────────────────────────────────────────

const EMPTY = Object.freeze({});
const EMPTY_MAP = new Map();

// ── Condiciones numéricas de filtro (las arma cada usuario) ──────────────────────
const COND_FIELDS = [
  { key: "cobDias",      label: "Cobertura (días)" },
  { key: "propIdeal",    label: "Prop. Ideal" },
  { key: "existOrigen",  label: "Exist. Origen",          soloInterno: true },
  { key: "tiendaOrigen", label: "Cant. en tienda origen", soloInterno: true },
  { key: "stock1053",    label: "Stock del bodegón" },
  { key: "indiceAvg",    label: "I.AVG" },
  { key: "uc",           label: "U/C" },
];
const COND_OPS = [
  { key: "<",       label: "menor que" },
  { key: "<=",      label: "menor o igual a" },
  { key: ">",       label: "mayor que" },
  { key: ">=",      label: "mayor o igual a" },
  { key: "=",       label: "igual a" },
  { key: "between", label: "entre" },
];
const OP_SYMBOL = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "=": "=", between: "entre" };

let condSeq = 0;
const newCondition = (field = "cobDias", op = "<", value = "", value2 = "") => ({ id: `c${Date.now().toString(36)}${++condSeq}`, field, op, value, value2 });

// Una condición sin valor todavía no filtra (para poder armarla sin vaciar la tabla)
const condCompleta = (c) => c.value !== "" && !Number.isNaN(parseFloat(c.value));

// Un dato vacío nunca cumple una condición. Los productos de origen externo no tienen existencia
// ni stock en tienda del origen: esas condiciones no les aplican.
function cumpleCondicion(c, p) {
  if (!condCompleta(c)) return true;
  const meta = COND_FIELDS.find(f => f.key === c.field);
  if (meta?.soloInterno && esExterno(p)) return true;
  const v = p[c.field];
  if (v == null) return false;
  const a = parseFloat(c.value);
  switch (c.op) {
    case "<":  return v < a;
    case "<=": return v <= a;
    case ">":  return v > a;
    case ">=": return v >= a;
    case "=":  return v === a;
    case "between": {
      const b = parseFloat(c.value2);
      if (Number.isNaN(b)) return v >= a;
      return v >= Math.min(a, b) && v <= Math.max(a, b);
    }
    default: return true;
  }
}

// Secciones de la tabla (separadores gruesos de color + fondo suave)
const SEC_PRODUCTO = {
  hdr: "bg-slate-50 dark:bg-slate-900/60 text-slate-500",
};
const SEC_PROPUESTA = {
  div:  "border-l-4 border-l-sky-400 dark:border-l-sky-500",
  hdr:  "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  cell: "bg-sky-50/40 dark:bg-sky-950/20",
};
const SEC_SCRIPT = {
  div:  "border-l-4 border-l-emerald-400 dark:border-l-emerald-500",
  hdr:  "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  cell: "bg-emerald-50/40 dark:bg-emerald-950/20",
};

// ── Columnas de la tabla: secciones y orden original (el usuario puede cambiarlo) ──
const SECTIONS_P = {
  producto:  { label: "Producto y stock",       hdr: SEC_PRODUCTO.hdr,  col: "bg-muted",                           cell: "",                div: "" },
  propuesta: { label: "Propuesta y revisión", hdr: SEC_PROPUESTA.hdr, col: "bg-sky-50 dark:bg-sky-950",          cell: SEC_PROPUESTA.cell, div: SEC_PROPUESTA.div },
  script:    { label: "Script",                 hdr: SEC_SCRIPT.hdr,    col: "bg-emerald-50 dark:bg-emerald-950",  cell: SEC_SCRIPT.cell,    div: SEC_SCRIPT.div },
};
const P_DEFAULT_ORDER = [
  "bodegon", "origen", "estado", "categoriaVentas", "codigo", "nombre", "suministrador", "stock1053", "uc",
  "indiceAvg", "cobDias", "existOrigen", "propIdeal", "revCardista", "script",
];
const ESTADO_RANK = { AGOTADO: 0, DEFICIT: 1, AGOT_SV: 2, SIN_VENTAS: 3, GARANTIZADO: 4, EXCESO: 5 };

// Los datos se consideran frescos 5 min y se conservan 30 min al salir de la vista:
// al volver se muestran al instante y se revalidan en segundo plano.
const CACHE = { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 };

const ESTADO_META = {
  AGOTADO:     { label: "AGOTADO",     cls: "bg-red-50 text-red-700 border-red-200" },
  DEFICIT:     { label: "DÉFICIT",     cls: "bg-orange-50 text-orange-700 border-orange-200" },
  GARANTIZADO: { label: "GARANTIZADO", cls: "bg-green-50 text-green-700 border-green-200" },
  EXCESO:      { label: "EXCESO",      cls: "bg-blue-50 text-blue-700 border-blue-200" },
  SIN_VENTAS:  { label: "SIN VENTAS",  cls: "bg-gray-100 text-gray-600 border-gray-300" },
  AGOT_SV:     { label: "AGOT. SV.",   cls: "bg-amber-50 text-amber-800 border-amber-300" },
};

const CLASIF_META = {
  A: "bg-red-50 text-red-700",
  B: "bg-orange-50 text-orange-700",
  C: "bg-amber-50 text-amber-800",
  D: "bg-gray-100 text-gray-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcEstado(stock, indiceAvg, cobDias, cobThreshold) {
  const s = stock ?? 0;
  if (s === 0 && !indiceAvg) return "AGOT_SV";
  if (s === 0) return "AGOTADO";
  if (!indiceAvg) return "SIN_VENTAS";
  if (cobDias < cobThreshold) return "DEFICIT";
  if (cobDias > cobThreshold * 3) return "EXCESO";
  return "GARANTIZADO";
}

function origenText(p) {
  if (p.origenType === "warehouse") return p.origenId;
  if (p.origenType === "externo") return p.externo?.supplierName ?? "Externo";
  if (p.origenType === "other") return p.origenLabel;
  return "Sin origen";
}

// Reabastecimiento Interno = el producto sale de otro almacén/bodegón (origen confiable en
// /bodegon-product-origin). Externo = se compra a un proveedor externo (hoy solo SM23M), y ese
// origen sale de las facturas externas ya cargadas, no de /bodegon-product-origin.
const esInterno = (p) => p.origenType === "warehouse" || p.origenType === "other";
const esExterno = (p) => p.origenType === "externo";

// Clave de origen para el filtro por almacén de origen
const origenKey = (p) =>
  p.origenType === "warehouse" ? `wh:${p.origenId}`
  : p.origenType === "externo" ? `ext:${p.externo?.supplierName ?? ""}`
  : p.origenType === "other"   ? `other:${p.origenLabel}`
  : "none";

function fmt1(n) { return n != null ? n.toFixed(1) : "—"; }
function fmtN(n) { return n != null ? n.toLocaleString() : "—"; }


// ── Componente principal ──────────────────────────────────────────────────────

// `config` decide para qué almacenes y con qué columnas funciona (Bodegones por defecto; FF en ff/FFPropuesta).
export default function BodegonPropuesta({ config = BODEGON_CONFIG }) {
  const { toast } = useToast();
  const keys = useMemo(() => config.almacenes.map(a => a.key), [config]);
  const labelOf = (k) => config.almacenes.find(a => a.key === k)?.label ?? k;
  const columnOrder = useMemo(
    () => P_DEFAULT_ORDER.filter(id => id !== "script" || config.showScript),
    [config],
  );
  const HeaderIcon = config.icon;
  const { user } = useProcurementUser();

  // Roles: solo el cardista (y admin/supervisor) revisa las cantidades y genera el pedido.
  const { isAdmin, isCardista } = roleInfo(user);
  const permitidos = keys;
  const canRevisar    = isAdmin || isCardista;   // columna Rev. Cardista
  const canGenerarBT  = isAdmin || isCardista;

  // Bodegón que se está revisando ("todos" = todos los que el usuario puede ver, juntos)
  const [bodegon, setBodegon] = useState(config.defaultAlmacen);
  useEffect(() => {
    if (!permitidos.length) return;
    const ok = bodegon === "todos" ? permitidos.length > 1 : permitidos.includes(bodegon);
    if (!ok) setBodegon(permitidos[0]);
  }, [bodegon, permitidos]);
  const bodegonesSel = useMemo(
    () => (bodegon === "todos" ? permitidos : [bodegon]).filter(b => permitidos.includes(b)),
    [bodegon, permitidos]
  );

  // ── Datos en tiempo real ────────────────────────────────────────────────────

  // Lista de almacenes para resolver el proveedor key de ap-latest
  const { data: almacenesList = [] } = useQuery({
    queryKey: ["ext-almacenes"],
    queryFn: fetchAlmacenes,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  // Proveedor key de ap-latest de cada bodegón (el código debe ir aislado: 1053 ≠ 21053)
  const provKeyOf = (b) => almacenesList.find(a => new RegExp(`(?<!\\d)${b}(?!\\d)`).test(a)) ?? null;
  const provKeys = bodegonesSel.map(provKeyOf);

  // Productos de cada bodegón elegido (ap-latest)
  const prodQs = useQueries({
    queries: bodegonesSel.map((b, i) => ({
      queryKey: ["direct-products", [provKeys[i]]],
      queryFn: () => fetchProductsForAlmacen(provKeys[i]),
      enabled: !!provKeys[i],
      ...CACHE,
    })),
  });

  // Origen de cada producto (endpoint propio): código → { origin_store_id, origin_type }
  const originQs = useQueries({
    queries: bodegonesSel.map(b => ({
      queryKey: ["bodegon-product-origins", b],
      queryFn: async () => {
        const records = await fetchBodegonProductOrigins(b);
        return new Map(records.map(r => [String(r.product_code ?? "").trim(), r]));
      },
      ...CACHE,
    })),
  });
  const originsError = originQs.some(q => q.isError);

  // Índices de ventas de cada bodegón elegido
  const salesQs = useQueries({
    queries: bodegonesSel.map(b => ({
      queryKey: ["sales-indices-almacen", b],
      queryFn: () => fetchSalesIndicesAlmacenStream([b]),
      ...CACHE,
    })),
  });

  // Datos de cada bodegón juntos (se recalcula solo cuando llega algún dato nuevo)
  const dataSig = [prodQs, originQs, salesQs].map(qs => qs.map(q => q.dataUpdatedAt).join(",")).join("|");
  const bodegonData = useMemo(() => bodegonesSel.map((b, i) => ({
    b,
    products: prodQs[i]?.data ?? EMPTY_MAP,
    origins:  originQs[i]?.data ?? EMPTY_MAP,
    sales:    salesQs[i]?.data ?? EMPTY_MAP,
  })), [bodegonesSel, dataSig]);

  // Almacenes de origen realmente usados por los productos (solo tipo warehouse)
  const originWarehouseKeys = useMemo(() => {
    const keys = new Set();
    for (const d of bodegonData) {
      for (const r of d.origins.values()) {
        if (r.origin_type === "warehouse" && r.origin_store_id) keys.add(String(r.origin_store_id));
      }
    }
    return [...keys].sort();
  }, [bodegonData]);

  // Existencias en esos almacenes: storeId → Map(código → producto)
  const { data: originStockByStore = new Map(), isFetched: originStockFetched } = useQuery({
    queryKey: ["origin-warehouse-stock", originWarehouseKeys.join("|"), almacenesList.length],
    queryFn: async () => {
      const result = new Map();
      await Promise.all(originWarehouseKeys.map(async (key) => {
        const provKey = almacenesList.find(a => new RegExp(`(?<!\\d)${key}(?!\\d)`).test(a));
        if (!provKey) return;
        const products = await fetchProductsForAlmacen(provKey);
        const byCode = new Map();
        for (const product of products.values()) {
          const cod = String(product.codigo ?? "").trim();
          if (cod) byCode.set(cod, product);
        }
        result.set(key, byCode);
      }));
      return result;
    },
    enabled: originWarehouseKeys.length > 0 && almacenesList.length > 0,
    ...CACHE,
  });

  // Origen EXTERNO (SM23M y otros): productos comprados según las facturas externas cargadas.
  // Provisional: sale del almacenamiento local de facturas hasta que el backend lo entregue.
  const { data: externalOrigins = new Map() } = useQuery({
    queryKey: ["external-product-origins"],
    queryFn: listExternalProductOrigins,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  // ── Estado UI ───────────────────────────────────────────────────────────────

  // Panel de índices: slots (array de keys, puede ser null para slot vacío)
  const [indexSlots, setIndexSlots] = useState(DEFAULT_SELECTED_INDICES.slice(0, 3));
  const selectedIndices = useMemo(() => indexSlots.filter(Boolean), [indexSlots]);

  const addSlot = () => setIndexSlots(s => [...s, null]);
  const removeSlot = (i) => setIndexSlots(s => s.filter((_, idx) => idx !== i));
  const setSlot = (i, key) => setIndexSlots(s => { const n = [...s]; n[i] = key || null; return n; });

  // Condiciones numéricas que arma el usuario (Cobertura < 20, Prop. Ideal > 1, …)
  const [conditions, setConditions] = useState([]);
  const addCondition = () => setConditions(cs => [...cs, newCondition()]);
  const updateCondition = (id, patch) => setConditions(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c));
  const removeCondition = (id) => setConditions(cs => cs.filter(c => c.id !== id));
  // Cobertura objetivo: define el estado (DÉFICIT/EXCESO) y la Prop. Ideal
  const [cobThreshold, setCobThreshold] = useState(15);
  // Filtros por categoría — Sets vacíos = mostrar todos
  const [filtEstados, setFiltEstados] = useState(new Set());
  const [filtCats, setFiltCats] = useState(new Set());
  // Búsqueda
  const [search, setSearch] = useState("");
  // Origen: almacenes/proveedores de origen concretos (los internos y los externos, como SM23M)
  const [origenSel, setOrigenSel] = useState(new Set());   // claves de origenKey(); vacío = todos

  // Orden de la tabla (null = el orden original: estado y luego I.AVG)
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  // ── Vistas guardadas (conjuntos de filtros por usuario) ─────────────────────
  const userKey = user?.email ?? user?.id ?? "";
  const [savedViews, setSavedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [viewsLocal, setViewsLocal] = useState(false);   // true = el backend aún no tiene el recurso
  const [viewsError, setViewsError] = useState("");
  const reloadViews = useCallback(async () => {
    try {
      setSavedViews(await listSavedViews(userKey, config.id));
      setViewsLocal(getSavedViewsMode() === "local");
      setViewsError("");
    } catch (err) {
      setSavedViews([]);
      setViewsError(err.message);
    }
  }, [userKey]);
  useEffect(() => { reloadViews(); }, [reloadViews]);

  const currentConfig = useMemo(() => ({
    bodegon, sort, cobThreshold,
    // Las condiciones se guardan sin su id interno
    conditions:  conditions.map(({ field, op, value, value2 }) => ({ field, op, value, value2 })),
    origenSel:  [...origenSel].sort(),
    filtEstados: [...filtEstados].sort(),
    filtCats:    [...filtCats].sort(),
    search,
    indexSlots,
  }), [bodegon, sort, cobThreshold, conditions, origenSel, filtEstados, filtCats, search, indexSlots]);

  const applyConfig = useCallback((c) => {
    // Vistas guardadas antes de quitar el "Filtro Oreste" lo traen como modo: se convierte en sus condiciones
    const legacyOreste = c.viewMode === "oreste" && !c.conditions
      ? [newCondition("cobDias", "<", "20"), newCondition("existOrigen", ">", "1"), newCondition("propIdeal", ">", "1"), newCondition("tiendaOrigen", ">", "1")]
      : null;
    setConditions(legacyOreste ?? (c.conditions ?? []).map(x => newCondition(x.field, x.op, x.value, x.value2)));
    setBodegon(c.bodegon === "todos" || keys.includes(c.bodegon) ? c.bodegon : config.defaultAlmacen);
    setSort(c.sort ?? { key: null, dir: "asc" });
    setCobThreshold(c.cobThreshold ?? 15);
    setOrigenSel(new Set(c.origenSel ?? []));
    setFiltEstados(new Set(c.filtEstados ?? []));
    setFiltCats(new Set(c.filtCats ?? []));
    setSearch(c.search ?? "");
    if (Array.isArray(c.indexSlots) && c.indexSlots.length) setIndexSlots(c.indexSlots);
  }, [keys, config.defaultAlmacen]);

  const activeView = savedViews.find(v => v.id === activeViewId) ?? null;
  // La BD puede devolver el JSON con las claves en otro orden: se compara con claves ordenadas
  const stable = (o) => JSON.stringify(o, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  const viewDirty  = !!activeView && stable(activeView.config) !== stable(currentConfig);

  const handleSaveView = async (existing) => {
    const name = existing ? existing.name : (window.prompt("Nombre para esta vista de filtros:") ?? "").trim();
    if (!name) return;
    try {
      const saved = await saveSavedView(userKey, config.id, { id: existing?.id, name, config: currentConfig });
      await reloadViews();
      setActiveViewId(saved.id);
      toast({ description: existing ? `Vista "${name}" actualizada` : `Vista "${name}" guardada`, duration: 2500 });
    } catch (err) {
      toast({ description: err.message, variant: "destructive", duration: 4000 });
    }
  };
  const handleDeleteView = async (v) => {
    if (!window.confirm(`¿Eliminar la vista "${v.name}"?`)) return;
    try {
      await deleteSavedView(userKey, config.id, v.id);
      await reloadViews();
      if (activeViewId === v.id) setActiveViewId(null);
    } catch (err) {
      toast({ description: `No se pudo eliminar: ${err.message}`, variant: "destructive", duration: 4000 });
    }
  };

  // Columnas editables (solo en sesión — pendiente persistir en API). Se guardan por bodegón:
  // lo que se escribe en el 1053 no se mezcla con el 1201.
  const [revAll, setRevAll] = useState({});     // { [bodegón]: { [codigo]: string } }
  const setIn = (setAll) => (p, value) => setAll(prev => ({ ...prev, [p.bodegon]: { ...(prev[p.bodegon] ?? EMPTY), [p.codigo]: value } }));
  const clearIn = (setAll) => (p) => setAll(prev => { const n = { ...(prev[p.bodegon] ?? EMPTY) }; delete n[p.codigo]; return { ...prev, [p.bodegon]: n }; });
  const setRev = setIn(setRevAll), clearRev = clearIn(setRevAll);

  // Columnas visibles y su orden (preferencia personal, se guarda por usuario)
  const { order: colOrder, hidden: colHidden, change: changeLayout } =
    useColumnLayout(`${config.id}-columnas`, userKey, columnOrder);

  const changeBodegon = (b) => { setBodegon(b); setOrigenSel(new Set()); };

  // Historial local de pedidos
  const [historial, setHistorial] = useState([]);
  const [showHistorial, setShowHistorial] = useState(false);

  // ── Filas computadas ────────────────────────────────────────────────────────

  const rows = useMemo(() => {
    const result = [];
    for (const { b: bodegonRow, products, origins: originsByCode, sales: salesMap } of bodegonData) {
    const seenCodigos = new Set(); // evita duplicados cuando el mismo código aparece bajo distintos idOnline
    for (const p of products.values()) {
      const codigo = String(p.codigo ?? "").trim();
      if (!codigo || seenCodigos.has(codigo)) continue;
      seenCodigos.add(codigo);
      const idOnlineKey = String(p.id_online ?? "").trim();
      if (!idOnlineKey || idOnlineKey === "0") continue; // sin idTienda → no está en BD Reab

      // Sales index entry (keyed by idTienda = id_online)
      const idx = salesMap.get(idOnlineKey) ?? salesMap.get(codigo);
      const indiceAvg = idx ? computeIndiceAvg(idx, selectedIndices) : null;

      const stock1053 = p.cantidad ?? 0;
      const cobDias   = (indiceAvg && indiceAvg > 0)
        ? parseFloat((stock1053 / indiceAvg).toFixed(1))
        : null;
      const estado = calcEstado(stock1053, indiceAvg, cobDias, cobThreshold);

      // Propuesta Ideal: unidades necesarias para cobrir el umbral
      const propIdeal = (indiceAvg != null && indiceAvg > 0)
        ? Math.max(0, Math.ceil(indiceAvg * cobThreshold - stock1053))
        : null;

      // Origen según el endpoint /bodegon-product-origin (sin registro → Sin origen)
      // El origen "SM23 M." de /bodegon-product-origin NO es confiable: se ignora. Los demás sí.
      // Si el producto no tiene un origen confiable pero se ha comprado a un proveedor externo
      // (facturas externas cargadas), su origen es Externo.
      const originRec = originsByCode.get(codigo);
      const rawType   = String(originRec?.origin_type ?? "").toLowerCase();
      const externo   = externalOrigins.get(codigo) ?? null;
      const trusted   = originRec && rawType !== "sin-origen" && !rawType.includes("sm23");
      const origenType = trusted
        ? (rawType === "warehouse" ? "warehouse" : "other")
        : externo ? "externo" : "sin-origen";
      const origenId     = trusted && originRec?.origin_store_id != null ? String(originRec.origin_store_id) : null;
      const origenLabel  = trusted ? (originRec?.origin_type ?? "") : "";
      const originProduct = origenType === "warehouse" ? originStockByStore.get(origenId)?.get(codigo) : null;
      const existOrigen  = originProduct?.cantidad ?? null;
      const tiendaOrigen = null; // se completa con stock_tienda de la tabla de ofertas (stock_tienda se completa al filtrar)

      result.push({
        bodegon: bodegonRow,
        codigo,
        id_online: idOnlineKey,
        nombre: p.nombre ?? "",
        fotos: (p.fotos ?? []).map(x => x?.foto ?? x).filter(Boolean),
        suministrador: p.suministrador ?? idx?.suministrador ?? "",
        stock1053,
        reservado: p.reservado ?? p.reserved ?? null,
        uc: p.unidades_por_caja ?? p.uc ?? null,
        categoriaVentas: idx?.categoriaVentas ?? null,
        clasificacion: p.clasificacion ?? p.familia ?? p.grupo ?? "",
        indiceAvg,
        cobDias,
        estado,
        propIdeal,
        origenId,
        origenType,
        origenLabel,
        externo,   // datos de la última factura externa en que se compró (o null)
        existOrigen,
        tiendaOrigen,
      });
    }
    }
    // Orden: AGOTADO primero, luego DEFICIT, luego por I.AVG desc
    const ORDEN_ESTADO = { AGOTADO: 0, DEFICIT: 1, AGOT_SV: 2, SIN_VENTAS: 3, GARANTIZADO: 4, EXCESO: 5 };
    result.sort((a, b) => {
      const dEstado = (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9);
      if (dEstado !== 0) return dEstado;
      return (b.indiceAvg ?? 0) - (a.indiceAvg ?? 0);
    });
    return result;
  }, [bodegonData, originStockByStore, externalOrigins, selectedIndices, cobThreshold]);

  // ── Filtrado ────────────────────────────────────────────────────────────────
  // Todos los filtros son independientes y se combinan: tipo/almacén de origen, estado, categoría,
  // búsqueda y las condiciones numéricas que arma cada usuario.

  const condsActivas = useMemo(() => conditions.filter(condCompleta), [conditions]);
  const condsTienda  = useMemo(() => condsActivas.filter(c => c.field === "tiendaOrigen"), [condsActivas]);
  const condsOtras   = useMemo(() => condsActivas.filter(c => c.field !== "tiendaOrigen"), [condsActivas]);
  const usaExistOrigen = condsActivas.some(c => c.field === "existOrigen");

  // Todo menos las condiciones sobre "Cant. en tienda origen" (ese dato se consulta aparte)
  const rowsBase = useMemo(() => {
    let list = rows;
    if (origenSel.size > 0) list = list.filter(p => origenSel.has(origenKey(p)));
    if (filtEstados.size > 0) list = list.filter(p => filtEstados.has(p.estado));
    if (filtCats.size > 0) list = list.filter(p => filtCats.has(p.categoriaVentas));
    for (const c of condsOtras) list = list.filter(p => cumpleCondicion(c, p));
    if (search.trim()) {
      const q = search.trim();
      const ql = q.toLowerCase();
      list = list.filter(p =>
        p.codigo === q ||
        p.id_online === q ||
        p.nombre.toLowerCase().includes(ql) ||
        (p.externo?.invoiceName ?? "").toLowerCase().includes(ql)
      );
    }
    return list;
  }, [rows, origenSel, filtEstados, filtCats, condsOtras, search]);

  // "Cant. en tienda" del almacén de origen: ap-latest no trae ese dato; está en la tabla de ofertas
  // (stock_tienda). Solo se consulta si hay una condición sobre él, y solo para los productos de
  // origen interno que ya cumplen el resto de los filtros.
  const tiendaCandidatos = useMemo(
    () => condsTienda.length ? rowsBase.filter(p => p.origenType === "warehouse") : [],
    [rowsBase, condsTienda]
  );
  const tiendaProveedores = useMemo(
    () => [...new Set(tiendaCandidatos.map(p => p.origenId))].sort(),
    [tiendaCandidatos]
  );
  const tiendaCodigos = useMemo(() => tiendaCandidatos.map(p => p.codigo), [tiendaCandidatos]);

  const { data: offerStock = new Map(), isFetched: tiendaFetched } = useQuery({
    queryKey: ["origin-offer-stock", tiendaProveedores.join("|"), tiendaCodigos.join(",")],
    queryFn: async () => {
      try {
        return await fetchOfferStockByCodes(tiendaProveedores, tiendaCodigos);
      } catch (err) {
        console.error("[tienda origen] no se pudo consultar stock_tienda en /offers:", err.message);
        return new Map();
      }
    },
    enabled: tiendaCodigos.length > 0,
    ...CACHE,
  });

  // Si ningún candidato encontró su stock_tienda, esa condición no se puede evaluar y se omite
  const tiendaDisponible = useMemo(
    () => tiendaCandidatos.some(p => offerStock.has(`${p.origenId}|${p.codigo}`)),
    [tiendaCandidatos, offerStock]
  );
  const tiendaSinDatos = condsTienda.length > 0 && tiendaCodigos.length > 0 && tiendaFetched && !tiendaDisponible;

  // Hasta que terminen las consultas que una condición necesita no se evalúa, para no mostrar
  // "sin resultados" mientras todavía cargan.
  const originStockPending = originWarehouseKeys.length > 0 && !originStockFetched;
  const tiendaPending      = tiendaCodigos.length > 0 && !tiendaFetched;
  const datosPendientes    = (usaExistOrigen && originStockPending) || (condsTienda.length > 0 && tiendaPending);

  // Opciones del filtro de origen (según lo que hay en los datos)
  const origenOptions = useMemo(() => {
    const seen = new Map();
    for (const p of rows) {
      const key = origenKey(p);
      if (seen.has(key)) continue;
      seen.set(key, key === "none" ? "Sin origen"
        : esExterno(p) ? `${p.externo?.supplierName} (externo)`
        : p.origenType === "warehouse" ? String(p.origenId)
        : (p.origenLabel || "Otro"));
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "es", { numeric: true })).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filtered = useMemo(() => {
    if (datosPendientes) return [];
    let list = condsTienda.length
      ? rowsBase.map(p => {
          const rec = offerStock.get(`${p.origenId}|${p.codigo}`);
          return rec ? { ...p, tiendaOrigen: rec.tienda ?? null } : p;
        })
      : rowsBase;
    if (tiendaDisponible) for (const c of condsTienda) list = list.filter(p => cumpleCondicion(c, p));
    return list;
  }, [rowsBase, datosPendientes, condsTienda, tiendaDisponible, offerStock]);

  // Chips de filtros activos (la búsqueda ya se ve en su campo)
  const chipsActivos = useMemo(() => {
    const chips = [];
    if (origenSel.size > 0) {
      const names = [...origenSel].map(k => origenOptions.find(o => o.value === k)?.label ?? k.replace(/^(wh|ext|other):/, ""));
      chips.push({ key: "origen", label: `Origen: ${names.join(", ")}`, onRemove: () => setOrigenSel(new Set()) });
    }
    if (filtEstados.size > 0) chips.push({ key: "estado", label: `Estado: ${[...filtEstados].map(k => ESTADO_META[k]?.label ?? k).join(", ")}`, onRemove: () => setFiltEstados(new Set()) });
    if (filtCats.size > 0) chips.push({ key: "cats", label: `Cat. ${[...filtCats].sort().join(", ")}`, onRemove: () => setFiltCats(new Set()) });
    for (const c of conditions) {
      const meta = COND_FIELDS.find(f => f.key === c.field);
      const val = condCompleta(c) ? (c.op === "between" && c.value2 !== "" ? `${c.value} y ${c.value2}` : c.value) : "…";
      chips.push({ key: c.id, label: `${meta?.label} ${OP_SYMBOL[c.op]} ${val}`, incompleto: !condCompleta(c), onRemove: () => removeCondition(c.id) });
    }
    return chips;
     
  }, [origenSel, origenOptions, filtEstados, filtCats, conditions]);
  const filtrosActivos = chipsActivos.length;

  // Hay algún filtro activo (para mostrar "Limpiar filtros")
  const hayFiltros = condsActivas.length > 0 || origenSel.size > 0
    || filtEstados.size > 0 || filtCats.size > 0 || search.trim() !== "";
  const limpiarFiltros = () => {
    setConditions([]); setOrigenSel(new Set());
    setFiltEstados(new Set()); setFiltCats(new Set()); setSearch("");
  };

  // ── Cantidades de Rev. Cardista ─────────────────────────────────────────────
  // Por defecto repiten la Prop. Ideal; solo se guarda lo que el usuario cambia. Aprobación INV
  // parte de lo que quedó en Rev. Cardista (que a su vez parte de la Prop. Ideal).
  const revDe      = (p) => revAll[p.bodegon]?.[p.codigo];
  const cantRev    = (p) => revDe(p) !== undefined ? revDe(p) : (p.propIdeal ?? "");
  const cantNum    = (p) => parseInt(cantRev(p)) || 0;
  const revEditada   = (p) => revDe(p) !== undefined && String(revDe(p)) !== String(p.propIdeal ?? "");

  // ── KPIs ────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => ({
    total:     filtered.length,
    agotados:  filtered.filter(p => p.estado === "AGOTADO").length,
    deficit:   filtered.filter(p => p.estado === "DEFICIT").length,
    sinUC:     filtered.filter(p => p.uc == null).length,
    conCant:  filtered.filter(p => cantNum(p) > 0).length,
   
  }), [filtered, revAll]);

  // ── Orden por columna (clic en el encabezado: mayor→menor, menor→mayor, sin orden) ──
  const toggleSort = (key, numeric) => setSort(prev => {
    if (prev.key !== key) return { key, dir: numeric ? "desc" : "asc" };
    const first = numeric ? "desc" : "asc";
    return prev.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : { key: null, dir: "asc" };
  });
  const sortValue = (p, key) => {
    switch (key) {
      case "bodegon":     return p.bodegon;
      case "origen":      return origenText(p);
      case "estado":      return ESTADO_RANK[p.estado] ?? 9;
      case "revCardista": return parseInt(cantRev(p)) || 0;
      default:            return p[key];
    }
  };
  const sortedRows = useMemo(() => {
    if (!sort.key) return filtered;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      const xe = x == null || x === "", ye = y == null || y === "";
      if (xe && ye) return 0;
      if (xe) return 1;
      if (ye) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * mul;
      return String(x).localeCompare(String(y), "es", { numeric: true }) * mul;
    });
   
  }, [filtered, sort, revAll]);

  // ── Definición de las columnas (cada una sabe pintar su encabezado y su celda) ──
  const columnsAll = [
    {
      id: "bodegon", label: config.noun, section: "producto", align: "center", sortKey: "bodegon", td: "px-2 py-1.5 whitespace-nowrap",
      content: (p) => <span className="font-mono text-[11px] font-semibold">{labelOf(p.bodegon)}</span>,
    },
    {
      id: "origen", label: "Origen", section: "producto", align: "center", sortKey: "origen", td: "px-2 py-1.5 whitespace-nowrap",
      content: (p) => p.origenType === "warehouse"
        ? <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border">{p.origenId}</span>
        : p.origenType === "externo"
          ? (
            <span
              className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/50 px-1.5 py-0.5 rounded"
              title={`Comprado a ${p.externo?.supplierName} · factura #${p.externo?.invoiceNumber} (${p.externo?.invoiceDate}) · ${p.externo?.timesBought} vez/veces`}
            >
              {p.externo?.supplierName}
            </span>
          )
          : p.origenType === "other"
            ? <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border" title={p.origenLabel}>{p.origenId ?? p.origenLabel}</span>
            : <span className="text-[10px] text-muted-foreground/60 italic">Sin origen</span>,
    },
    {
      id: "estado", label: "Estado", section: "producto", align: "left", sortKey: "estado", td: "px-2.5 py-1.5 whitespace-nowrap",
      content: (p) => {
        const em = ESTADO_META[p.estado] ?? {};
        return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${em.cls}`}>{em.label}</span>;
      },
    },
    {
      id: "categoriaVentas", label: "Cat.", section: "producto", align: "center", sortKey: "categoriaVentas", td: "px-2 py-1.5",
      content: (p) => p.categoriaVentas
        ? <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold ${CLASIF_META[p.categoriaVentas] ?? "bg-muted text-muted-foreground"}`}>{p.categoriaVentas}</span>
        : <span className="text-muted-foreground/30">—</span>,
    },
    {
      id: "codigo", label: "Cód. TKC", section: "producto", align: "left", sortKey: "codigo",
      td: "px-2.5 py-1.5 font-mono text-[11px] text-primary whitespace-nowrap", content: (p) => p.codigo,
    },
    {
      id: "nombre", label: "Nombre", section: "producto", align: "left", sortKey: "nombre", td: "px-2.5 py-1.5 min-w-[200px] max-w-[300px]",
      tdTitle: (p) => p.externo ? `En la factura de ${p.externo.supplierName}: ${p.externo.invoiceName}` : undefined,
      content: (p) => (
        <ProductImageHover
          name={p.nombre}
          images={p.fotos}
          subtitle={esExterno(p) && p.externo?.invoiceName ? (
            <div className="text-[10px] text-violet-700 dark:text-violet-300 flex items-center gap-1">
              <span className="shrink-0 font-semibold uppercase tracking-wide opacity-70">Factura:</span>
              <span className="break-words">{p.externo.invoiceName}</span>
            </div>
          ) : null}
        />
      ),
    },
    {
      id: "suministrador", label: "Suministrador", section: "producto", align: "left", sortKey: "suministrador",
      td: "px-2.5 py-1.5 text-muted-foreground max-w-[120px] truncate", tdTitle: (p) => p.suministrador, content: (p) => p.suministrador || "—",
    },
    {
      id: "stock1053", label: bodegon === "todos" ? config.stockHeader : `Stock ${labelOf(bodegon)}`, section: "producto", align: "right", sortKey: "stock1053", num: true,
      td: "px-2.5 py-1.5 tabular-nums font-semibold", content: (p) => p.stock1053,
    },
    {
      id: "uc", label: "U/C", section: "producto", align: "right", sortKey: "uc", num: true, td: "px-2.5 py-1.5 tabular-nums",
      content: (p) => p.uc == null ? <span className="text-red-600 font-bold text-[10px]">falta</span> : p.uc,
    },
    {
      id: "indiceAvg", label: "I.AVG", section: "producto", align: "right", sortKey: "indiceAvg", num: true, td: "px-2.5 py-1.5 tabular-nums font-mono",
      content: (p) => p.indiceAvg != null ? p.indiceAvg.toFixed(3) : <span className="text-muted-foreground/40">—</span>,
    },
    {
      id: "cobDias", label: "Cob.(días)", section: "producto", align: "right", sortKey: "cobDias", num: true,
      td: "px-2.5 py-1.5 tabular-nums font-semibold",
      tdExtra: (p) => p.cobDias != null && p.cobDias < cobThreshold ? "text-destructive" : "",
      content: (p) => p.cobDias != null ? `${p.cobDias}d` : <span className="text-muted-foreground/40">—</span>,
    },
    {
      id: "existOrigen", label: "Exist. Origen", section: "producto", align: "right", sortKey: "existOrigen", num: true, td: "px-2.5 py-1.5 tabular-nums",
      content: (p) => p.existOrigen != null ? <span className="font-semibold text-emerald-700">{p.existOrigen}</span> : <span className="text-muted-foreground/30">—</span>,
    },
    {
      id: "propIdeal", label: "Prop. Ideal", section: "propuesta", align: "right", sortKey: "propIdeal", num: true,
      td: "px-2.5 py-1.5 tabular-nums font-bold text-primary",
      content: (p) => p.propIdeal != null ? p.propIdeal : <span className="text-muted-foreground/30 font-normal">—</span>,
    },
    {
      id: "revCardista", label: "Rev. Cardista", section: "propuesta", align: "center", sortKey: "revCardista", num: true, td: "px-2 py-1",
      content: (p) => canRevisar ? (
        <div className="flex items-center justify-center gap-0.5">
          <Input
            type="number"
            min="0"
            value={cantRev(p)}
            onChange={e => setRev(p, e.target.value)}
            placeholder="cant."
            title={revEditada(p) ? `Modificada (Prop. Ideal: ${p.propIdeal ?? "—"})` : "Repite la Prop. Ideal; puedes cambiarla"}
            className={cn("h-6 w-16 text-center text-[11px] px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", revEditada(p) && "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20")}
          />
          {revEditada(p) && (
            <button className="text-muted-foreground hover:text-foreground" title="Volver a la Prop. Ideal"
              onClick={() => clearRev(p)}>
              <Undo2 size={11} />
            </button>
          )}
        </div>
      ) : <span className="text-muted-foreground text-[11px]">{cantRev(p) !== "" ? cantRev(p) : "—"}</span>,
    },
    {
      id: "script", label: "Para script", section: "script", align: "left", td: "px-2.5 py-1.5",
      content: (p) => cantNum(p) > 0
        ? <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">{p.codigo}*{cantNum(p)}</span>
        : <span className="text-muted-foreground/30">—</span>,
    },
  ];
  const columns = columnsAll.filter(c => c.id !== "script" || config.showScript);
  const columnsById = Object.fromEntries(columns.map(c => [c.id, c]));
  // La columna Bodegón solo aparece al ver varios juntos, y va primero
  const visibleCols = colOrder.map(id => columnsById[id])
    .filter(c => c && !colHidden.has(c.id) && (c.id !== "bodegon" || bodegon === "todos"))
    .sort((a, b) => (a.id === "bodegon" ? -1 : b.id === "bodegon" ? 1 : 0));
  const colGroups = [];
  visibleCols.forEach((c, i) => {
    const last = colGroups[colGroups.length - 1];
    if (last && last.section === c.section) last.n++;
    else colGroups.push({ section: c.section, n: 1, startIdx: i });
  });
  const groupStarts = new Set(colGroups.map(g => g.startIdx));
  const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

  // ── Generar Pedido BT ───────────────────────────────────────────────────────

  const handleGenerarPedido = useCallback(() => {
    const items = filtered
      .filter(p => cantNum(p) > 0)
      .map(p => ({
        bodegon: p.bodegon,
        codigo: p.codigo,
        nombre: p.nombre,
        cantidad: cantNum(p),
        uc: p.uc,
        revisor: cantRev(p),
        sinCambios: !revEditada(p),
        script: `${p.codigo}*${cantNum(p)}`,
      }))
      .filter(it => it.cantidad > 0);

    if (!items.length) {
      toast({ description: "No hay productos con cantidad para el pedido.", variant: "destructive", duration: 3000 });
      return;
    }
    // Las cantidades se rellenan solas con la Prop. Ideal: se confirma antes de generar el pedido
    const sinCambios = items.filter(it => it.sinCambios).length;
    if (!window.confirm(
      `Se generará el pedido con ${items.length} producto(s).\n` +
      (sinCambios ? `${sinCambios} llevan la cantidad de la Prop. Ideal sin modificar.\n` : "") +
      "¿Continuar?",
    )) return;

    // Un pedido por bodegón (con "Todos" salen varios)
    const fecha = new Date().toLocaleString("es-CU");
    const porBodegon = [...new Set(items.map(it => it.bodegon))].map((b, i) => {
      const its = items.filter(it => it.bodegon === b);
      return {
        id: Date.now() + i,
        bodegon: b,
        fecha,
        usuario: user?.email ?? user?.name ?? "—",
        items: its,
        script: its.map(it => it.script).join("\n"),
        total: its.reduce((s, it) => s + it.cantidad, 0),
      };
    });
    const registro = { total: items.reduce((s, it) => s + it.cantidad, 0), fecha };

    setHistorial(prev => [...porBodegon, ...prev]);
    // TODO: POST al endpoint de "Bajar de Tienda" cuando el backend lo provea
    // for (const r of porBodegon) await postBajarDeTienda(r);

    toast({
      title: `Pedido BT generado — ${items.length} productos${porBodegon.length > 1 ? ` en ${porBodegon.length} bodegones` : ""}`,
      description: `${registro.total} unidades totales · ${registro.fecha}`,
      duration: 4000,
    });
   
  }, [filtered, revAll, user, toast]);

  // ── Exportar ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const data = filtered.map(p => ({
      [config.noun]:      labelOf(p.bodegon),
      "Origen":          origenText(p),
      "Estado":          ESTADO_META[p.estado]?.label ?? p.estado,
      "Cat. Ventas":      p.categoriaVentas ?? "",
      "Clasif. General": p.clasificacion,
      "Tipo":            esExterno(p) ? "Externo" : esInterno(p) ? "Interno" : "Sin origen",
      "Cód. TKC":        p.codigo,
      "Nombre":          p.nombre,
      "Nombre en factura": p.externo?.invoiceName ?? "",
      "Suministrador":   p.suministrador,
      "I.AVG":           p.indiceAvg != null ? parseFloat(p.indiceAvg.toFixed(4)) : "",
      "Cob.(días)":      p.cobDias ?? "",
      [config.stockHeader]: p.stock1053,
      "Exist. Origen":   p.existOrigen ?? "",
      "Prop. Ideal":     p.propIdeal ?? "",
      "Rev. Cardista":   cantRev(p),
      ...(config.showScript ? { "Para script": cantNum(p) > 0 ? `${p.codigo}*${cantNum(p)}` : "" } : {}),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.sheetName);
    XLSX.writeFile(wb, `${config.exportName}_${bodegon}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // ── Loading ─────────────────────────────────────────────────────────────────

  const isLoading = (provKeys.some(k => !k) || [...prodQs, ...originQs, ...salesQs].some(q => q.isLoading) || datosPendientes);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b">
        <HeaderIcon className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">{config.title}</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-muted-foreground">{config.noun}:</span>
            <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
              {(permitidos.length > 1 ? ["todos", ...permitidos] : permitidos).map(b => (
                <button key={b}
                  className={`px-2.5 py-0.5 font-mono font-medium transition-colors ${bodegon === b ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                  title={b === "todos" ? undefined : config.almacenes.find(a => a.key === b)?.title}
                  onClick={() => changeBodegon(b)}
                >
                  {b === "todos" ? "Todos" : labelOf(b)}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">· origen según cada producto</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {originsError && (
            <span className="text-xs text-destructive">No se pudo cargar el origen de los productos</span>
          )}
          {isLoading && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Cargando...
            </span>
          )}
          <Badge variant="outline" className="text-xs">{rows.length.toLocaleString()} productos</Badge>
        </div>
      </div>

      {/* ── Panel de Índices ────────────────────────────────────────────────── */}
      <div className="px-5 py-2.5 bg-muted/30 border-b">
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pt-2 shrink-0">Índices de Venta</span>
          <div className="flex flex-wrap gap-2 flex-1 min-w-0">
            {indexSlots.map((key, i) => (
              <div key={i} className="flex items-center gap-1">
                <Select value={key ?? "__none__"} onValueChange={v => setSlot(i, v === "__none__" ? null : v)}>
                  <SelectTrigger className="h-7 w-52 text-xs">
                    <SelectValue placeholder="Seleccionar índice..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ninguno —</SelectItem>
                    {SELECTABLE_INDICES.map(s => (
                      <SelectItem key={s.key} value={s.key} disabled={indexSlots.includes(s.key) && key !== s.key}>
                        <span className="font-mono text-primary mr-1.5">{s.short}</span>{s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {indexSlots.length > 1 && (
                  <button onClick={() => removeSlot(i)} className="text-muted-foreground hover:text-destructive">
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {indexSlots.length < SELECTABLE_INDICES.length && (
              <button onClick={addSlot} className="h-7 px-2 text-xs flex items-center gap-1 border border-dashed rounded-md text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                <Plus size={12} /> Agregar
              </button>
            )}
          </div>
          <div
            className="flex items-center gap-1.5 shrink-0 pt-1"
            title="Cobertura objetivo en días: define el estado (DÉFICIT/EXCESO) y calcula la Prop. Ideal. No filtra filas; para eso usa Filtros → Condiciones."
          >
            <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">Cob. umbral:</span>
            <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
              {[5, 10, 15].map(d => (
                <button key={d}
                  className={`px-2.5 py-1 font-medium transition-colors ${cobThreshold === d ? "bg-amber-500 text-white" : "bg-background text-muted-foreground hover:bg-accent"}`}
                  onClick={() => setCobThreshold(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pt-1">
            <span className="text-[10px] text-muted-foreground font-medium">I.AVG =</span>
            <span className="text-xs font-bold text-emerald-700">promedio de {selectedIndices.length} índice(s)</span>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="px-5 py-2 border-b bg-background flex items-center gap-2 flex-wrap">

        {/* Búsqueda */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar código, nombre..."
            className="h-7 text-xs w-60 pl-7"
          />
        </div>

        {/* Todos los demás filtros, en un solo panel */}
        <FiltersPanel
          count={filtrosActivos}
          origenOptions={origenOptions} origenSel={origenSel} onOrigenSel={setOrigenSel}
          filtEstados={filtEstados} onEstados={setFiltEstados}
          filtCats={filtCats} onCats={setFiltCats}
          conditions={conditions} onAdd={addCondition} onUpdate={updateCondition} onRemove={removeCondition}
          tiendaSinDatos={tiendaSinDatos}
          onClear={limpiarFiltros} canClear={hayFiltros}
        />

        {rows.length > 0 && filtered.length !== rows.length && (
          <span className="text-[11px] text-muted-foreground">
            {filtered.length.toLocaleString()} de {rows.length.toLocaleString()}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ColumnChooser columns={columns} sections={SECTIONS_P} order={colOrder} hidden={colHidden} defaultOrder={columnOrder} onChange={changeLayout} />
          <SavedViewsMenu
            views={savedViews}
            activeView={activeView}
            dirty={viewDirty}
            local={viewsLocal}
            error={viewsError}
            onApply={(v) => { applyConfig(v.config); setActiveViewId(v.id); }}
            onSaveNew={() => handleSaveView(null)}
            onUpdate={() => activeView && handleSaveView(activeView)}
            onDelete={handleDeleteView}
            onClear={() => setActiveViewId(null)}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExport}>
            <FileSpreadsheet size={12} className="text-green-600" /> Excel
          </Button>
          {config.showGenerar && canGenerarBT && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleGenerarPedido}
              disabled={kpis.conCant === 0}
            >
              <ShoppingCart size={12} />
              Generar Pedido BT
              {kpis.conCant > 0 && (
                <Badge className="ml-1 bg-white/20 text-white text-[10px] px-1.5">{kpis.conCant}</Badge>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ── Filtros activos (solo si hay alguno) ────────────────────────────── */}
      {chipsActivos.length > 0 && (
        <div className="px-5 py-1.5 border-b bg-muted/20 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">Filtros</span>
          {chipsActivos.map(ch => (
            <span key={ch.key}
              className={cn("inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-[11px]",
                ch.incompleto ? "border-dashed border-muted-foreground/40 text-muted-foreground" : "border-primary/40 bg-primary/5 text-foreground")}
            >
              {ch.label}
              <button onClick={ch.onRemove} className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive" title="Quitar este filtro">
                <X size={11} />
              </button>
            </span>
          ))}
          <button onClick={limpiarFiltros} className="text-[11px] text-muted-foreground hover:text-destructive hover:underline ml-1">
            Limpiar todo
          </button>
          {tiendaSinDatos && (
            <span className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1 ml-2">
              <AlertTriangle size={11} /> "Cant. en tienda origen": el servidor no devolvió ese dato, la condición no se aplicó.
            </span>
          )}
        </div>
      )}


      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="px-5 py-1.5 border-b bg-muted/20 flex items-center gap-5 flex-wrap text-xs">
        <KPIChip label="productos" value={kpis.total} dotCls="bg-muted-foreground" />
        <KPIChip label="agotados"  value={kpis.agotados}  dotCls="bg-red-500" />
        <KPIChip label="déficit"   value={kpis.deficit}   dotCls="bg-orange-500" />
        {kpis.sinUC > 0 && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-0.5 text-[11px]">
            <AlertTriangle className="h-3 w-3" />{kpis.sinUC} sin U/C
          </span>
        )}
        {config.showGenerar && kpis.conCant > 0 && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-primary bg-primary/10 border border-primary/30 rounded-full px-3 py-0.5 text-[11px]">
            <ShoppingCart className="h-3 w-3" />{kpis.conCant} con cantidad para el pedido
          </span>
        )}
        {rows.length > 0 && filtered.length !== rows.length && (
          <span className="text-[10px] text-muted-foreground ml-auto text-right">
            Mostrando {filtered.length.toLocaleString()} de {rows.length.toLocaleString()} productos
          </span>
        )}
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────────── */}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-background">
            {/* Fila de secciones (agrupa las columnas visibles consecutivas de una misma sección) */}
            <tr>
              {colGroups.map(g => {
                const sec = SECTIONS_P[g.section];
                return (
                  <th key={g.startIdx} colSpan={g.n}
                    className={cn("px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border/60 select-text",
                      g.section === "producto" ? "text-left" : "text-center", sec.hdr, sec.div)}>
                    {sec.label}
                  </th>
                );
              })}
            </tr>
            {/* Fila de columnas */}
            <tr>
              {visibleCols.map((col, ci) => {
                const sec = SECTIONS_P[col.section];
                const active = col.sortKey && sort.key === col.sortKey;
                return (
                  <th key={col.id}
                    title={col.sortKey ? "Clic para ordenar (mayor↔menor)" : undefined}
                    onClick={col.sortKey ? () => toggleSort(col.sortKey, col.num) : undefined}
                    className={cn(
                      "px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap border-b border-border/80 select-none",
                      ALIGN[col.align], sec.col, groupStarts.has(ci) && sec.div,
                      col.sortKey && "cursor-pointer hover:text-foreground",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
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
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="text-center py-16 text-sm text-muted-foreground">
                  {isLoading
                    ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Cargando datos {bodegon === "todos" ? config.loadingAll : `${config.loadingOne} ${labelOf(bodegon)}`}...</span>
                    : "Sin productos para los filtros seleccionados."}
                </td>
              </tr>
            )}
            {sortedRows.map((p) => {
              const cobUrgente = p.cobDias != null && p.cobDias < cobThreshold;
              const ctx = { cobUrgente };
              return (
                <tr key={`${p.bodegon}|${p.codigo}`}
                  className={`border-b border-border/40 hover:bg-muted/20 transition-colors last:border-0
                    ${cobUrgente && p.estado !== "GARANTIZADO" ? "bg-destructive/[0.03]" : ""}`}
                >
                  {visibleCols.map((col, ci) => {
                    const sec = SECTIONS_P[col.section];
                    return (
                      <td key={col.id}
                        title={col.tdTitle?.(p, ctx)}
                        className={cn(col.td, ALIGN[col.align], sec.cell, groupStarts.has(ci) && sec.div, col.tdExtra?.(p, ctx))}>
                        {col.content(p, ctx)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Historial de Pedidos ─────────────────────────────────────────────── */}
      {config.showGenerar && historial.length > 0 && (
        <div className="border-t border-border bg-muted/20">
          <button
            className="w-full px-5 py-2 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowHistorial(v => !v)}
          >
            <Clock size={13} />
            Historial de Pedidos BT ({historial.length})
            {showHistorial ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
          </button>
          {showHistorial && (
            <div className="px-5 pb-4 space-y-3 max-h-60 overflow-y-auto">
              {historial.map(reg => (
                <div key={reg.id} className="bg-card border border-border rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{reg.fecha}</span>
                    <span className="text-muted-foreground">{reg.usuario}</span>
                    <Badge variant="secondary" className="text-[10px]">{reg.items.length} productos · {reg.total} u.</Badge>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground bg-muted/50 rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap break-all">
                    {reg.script}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Botón "Filtros" con un panel que reúne origen, estado, categoría y condiciones numéricas
function FiltersPanel({
  count, origenOptions, origenSel, onOrigenSel,
  filtEstados, onEstados, filtCats, onCats,
  conditions, onAdd, onUpdate, onRemove, tiendaSinDatos, onClear, canClear,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (set, onChange, value) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next);
  };

  const Section = ({ title, hint, children }) => (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground" title={hint}>{title}</p>
      {children}
    </div>
  );
  const Chip = ({ active, onClick, children, title }) => (
    <button type="button" onClick={onClick} title={title}
      className={cn("px-2.5 py-1 rounded-full border text-[11px] transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:bg-accent")}>
      {children}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn("h-7 px-2.5 text-xs flex items-center gap-1.5 border rounded-md bg-background hover:bg-accent transition-colors",
          count > 0 ? "border-primary/50 text-foreground font-medium" : "border-border text-muted-foreground")}
      >
        <SlidersHorizontal size={12} />
        Filtros
        {count > 0 && <span className="bg-primary text-primary-foreground text-[9px] rounded-full px-1.5 font-bold leading-4">{count}</span>}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg w-[min(640px,92vw)] max-h-[72vh] overflow-y-auto p-4 space-y-4">

          <Section title="Origen" hint="Almacén de origen del producto, o proveedor externo (hoy SM23M, según las facturas externas cargadas). Se pueden combinar varios.">
            {origenOptions.length === 0
              ? <p className="text-[11px] text-muted-foreground">Sin datos de origen todavía.</p>
              : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                  <Chip active={origenSel.size === 0} onClick={() => onOrigenSel(new Set())}>Todos</Chip>
                  {origenOptions.map(o => (
                    <Chip key={o.value} active={origenSel.has(o.value)} onClick={() => toggle(origenSel, onOrigenSel, o.value)}>{o.label}</Chip>
                  ))}
                </div>
              )}
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Estado">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ESTADO_META).map(([k, v]) => (
                  <Chip key={k} active={filtEstados.has(k)} onClick={() => toggle(filtEstados, onEstados, k)}>{v.label}</Chip>
                ))}
              </div>
            </Section>
            <Section title="Categoría de ventas">
              <div className="flex flex-wrap gap-1.5">
                {["A", "B", "C", "D"].map(c => (
                  <Chip key={c} active={filtCats.has(c)} onClick={() => toggle(filtCats, onCats, c)}>Cat. {c}</Chip>
                ))}
              </div>
            </Section>
          </div>

          <Section title="Condiciones" hint="Reglas numéricas; se aplican todas a la vez.">
            <div className="space-y-1.5">
              {conditions.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Sin condiciones. Agrega una para filtrar por cobertura, Prop. Ideal, existencia en el origen…
                </p>
              )}
              {conditions.map(c => {
                const meta = COND_FIELDS.find(f => f.key === c.field);
                return (
                  <div key={c.id}
                    className={cn("flex items-center gap-1 flex-wrap rounded-md border bg-muted/30 pl-1 pr-0.5 py-0.5 w-fit max-w-full", condCompleta(c) ? "border-primary/40" : "border-dashed border-muted-foreground/40")}
                    title={meta?.soloInterno ? "Esta condición solo aplica a productos de origen interno; los externos no se filtran por ella." : undefined}
                  >
                    <select value={c.field} onChange={e => onUpdate(c.id, { field: e.target.value })}
                      className="h-6 text-[11px] bg-transparent border-0 focus:outline-none cursor-pointer">
                      {COND_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <select value={c.op} onChange={e => onUpdate(c.id, { op: e.target.value })}
                      className="h-6 text-[11px] bg-transparent border-0 focus:outline-none cursor-pointer text-primary font-semibold">
                      {COND_OPS.map(o => <option key={o.key} value={o.key}>{OP_SYMBOL[o.key]} {o.label}</option>)}
                    </select>
                    <Input type="number" value={c.value} onChange={e => onUpdate(c.id, { value: e.target.value })} placeholder="valor"
                      className="h-6 w-16 text-center text-[11px] px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                    {c.op === "between" && (
                      <>
                        <span className="text-[10px] text-muted-foreground">y</span>
                        <Input type="number" value={c.value2} onChange={e => onUpdate(c.id, { value2: e.target.value })} placeholder="valor"
                          className="h-6 w-16 text-center text-[11px] px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                      </>
                    )}
                    <button onClick={() => onRemove(c.id)} className="p-1 text-muted-foreground hover:text-destructive" title="Quitar condición">
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <button onClick={onAdd}
                className="h-7 px-2 text-xs flex items-center gap-1 border border-dashed rounded-md text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                <Plus size={12} /> Agregar condición
              </button>
              {tiendaSinDatos && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={11} /> "Cant. en tienda origen": el servidor no devolvió ese dato, la condición no se aplicó.
                </p>
              )}
            </div>
          </Section>

          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <button onClick={onClear} disabled={!canClear}
              className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:pointer-events-none">
              Limpiar todos los filtros
            </button>
            <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>Listo</Button>
          </div>
        </div>
      )}
    </div>
  );
}


// Menú de vistas guardadas: aplicar, guardar los filtros actuales, actualizar o eliminar una vista
function SavedViewsMenu({ views, activeView, dirty, local, error, onApply, onSaveNew, onUpdate, onDelete, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "h-7 px-2.5 text-xs flex items-center gap-1.5 border rounded-md bg-background hover:bg-accent transition-colors",
          activeView ? "border-violet-400 text-violet-700 dark:text-violet-300" : "border-border text-muted-foreground",
        )}
        title="Guarda un conjunto de filtros para volver a usarlo sin configurarlo otra vez"
      >
        <Bookmark size={12} className={activeView ? "fill-current" : ""} />
        <span className="max-w-[150px] truncate">{activeView ? `${activeView.name}${dirty ? " •" : ""}` : "Mis vistas"}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md w-72 py-1">
          {local && (
            <p className="mx-2 mb-1 mt-1 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-800 dark:text-amber-300">
              El backend aún no tiene este recurso: tus vistas se guardan solo en este navegador. Cuando esté disponible se subirán solas a la base de datos.
            </p>
          )}
          {error && (
            <p className="mx-2 mb-1 mt-1 rounded border border-red-300 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 text-[10px] text-red-700 dark:text-red-300">
              No se pudieron cargar tus vistas: {error}
            </p>
          )}
          {views.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              Aún no tienes vistas guardadas. Configura los filtros y guárdalos con el botón de abajo.
            </p>
          ) : views.map(v => (
            <div key={v.id} className="group flex items-center hover:bg-accent">
              <button
                className="flex-1 min-w-0 text-left px-3 py-1.5 text-xs flex items-center gap-2"
                onClick={() => { onApply(v); setOpen(false); }}
              >
                {activeView?.id === v.id ? <Check size={12} className="text-violet-600 shrink-0" /> : <span className="w-3 shrink-0" />}
                <span className="truncate">{v.name}</span>
              </button>
              <button
                className="px-2 py-1.5 text-muted-foreground hover:text-destructive"
                title="Eliminar vista"
                onClick={() => onDelete(v)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="border-t border-border/50 my-1" />
          {activeView && dirty && (
            <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
              onClick={() => { onUpdate(); setOpen(false); }}>
              <Undo2 size={12} className="rotate-180" /> Actualizar «{activeView.name}» con los filtros actuales
            </button>
          )}
          <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
            onClick={() => { onSaveNew(); setOpen(false); }}>
            <BookmarkPlus size={12} /> Guardar filtros actuales como nueva vista…
          </button>
          {activeView && (
            <button className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => { onClear(); setOpen(false); }}>
              Dejar de usar la vista activa
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KPIChip({ label, value, dotCls }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
      <span className="font-bold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
