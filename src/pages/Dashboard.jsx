import React, { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  AlertTriangle, Clock, Warehouse, Search, X, PackageX, ClipboardList, FileClock, ChevronRight,
  Info, CheckCircle2, Hourglass, Flame, ExternalLink,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import SearchSelect from "@/components/common/SearchSelect";
import TablePager from "@/components/common/TablePager";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import { getUserPreferences, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";
import { computeIndiceAvg } from "@/api/salesIndicesClient";
import { cn } from "@/lib/utils";

// ── Prioridad de reposición ────────────────────────────────────────────────────
// Cobertura (días) = stock ÷ índice de venta diaria (I.AVG con los índices elegidos por el usuario:
// el mismo cálculo de Reab. Directo). Un producto está en la franja más urgente que le corresponde.
const TIER_RANK = { agotado: 0, t7: 1, t30: 2, t45: 3, t60: 4, ok: 5, sin_ventas: 6 };
const HORIZONS = [
  { id: "agotado", label: "Agotados",  hint: "sin stock y con ventas", tone: "red" },
  { id: 7,         label: "≤ 7 días",  hint: "se agotan en una semana", tone: "orange" },
  { id: 30,        label: "≤ 30 días", hint: "reponer este mes",        tone: "amber" },
  { id: 45,        label: "≤ 45 días", hint: "planificar",              tone: "yellow" },
  { id: 60,        label: "≤ 60 días", hint: "en el radar",             tone: "sky" },
];
const HORIZON_RANK = { agotado: 0, 7: 1, 30: 2, 45: 3, 60: 4 };
const TONE = {
  red:    { text: "text-red-500",    ring: "ring-red-500/60",    border: "border-red-500/30",    bg: "from-red-500/10",    chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",       bar: "bg-red-500" },
  orange: { text: "text-orange-500", ring: "ring-orange-500/60", border: "border-orange-500/30", bg: "from-orange-500/10", chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30", bar: "bg-orange-500" },
  amber:  { text: "text-amber-500",  ring: "ring-amber-500/60",  border: "border-amber-500/30",  bg: "from-amber-500/10",  chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",   bar: "bg-amber-400" },
  yellow: { text: "text-yellow-500", ring: "ring-yellow-500/60", border: "border-yellow-500/30", bg: "from-yellow-500/10", chip: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30", bar: "bg-yellow-300" },
  sky:    { text: "text-sky-500",    ring: "ring-sky-500/60",    border: "border-sky-500/30",    bg: "from-sky-500/10",    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",          bar: "bg-sky-400" },
  green:  { text: "text-emerald-500", ring: "ring-emerald-500/60", border: "border-emerald-500/30", bg: "from-emerald-500/10", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", bar: "bg-emerald-500" },
  slate:  { text: "text-slate-400",  ring: "ring-slate-400/60",  border: "border-slate-400/30",  bg: "from-slate-400/10",  chip: "bg-muted text-muted-foreground border-border", bar: "bg-slate-400" },
};
const TIER_TONE = { agotado: "red", t7: "orange", t30: "amber", t45: "yellow", t60: "sky", ok: "green", sin_ventas: "slate" };
const TIER_LABEL = { agotado: "Agotado", t7: "≤ 7 d", t30: "8–30 d", t45: "31–45 d", t60: "46–60 d", ok: "> 60 d", sin_ventas: "Sin ventas" };
const TIER_ORDER = ["agotado", "t7", "t30", "t45", "t60", "ok", "sin_ventas"];

function tierOf(stock, avg) {
  if (!avg || avg <= 0) return "sin_ventas";
  if (stock <= 0) return "agotado";
  const cob = stock / avg;
  if (cob <= 7)  return "t7";
  if (cob <= 30) return "t30";
  if (cob <= 45) return "t45";
  if (cob <= 60) return "t60";
  return "ok";
}

// Productos que no se reponen: anuncio desactivado o muerto
const isInactivo = (estado) => /desactivado|muerto|dead/i.test(String(estado ?? ""));

// ── Pedidos ────────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  borrador: "Borrador", pendiente_revision: "En revisión", revision: "En revisión", confirmado: "Confirmado",
  enviado: "Enviado", pagado: "Pagado", en_transito: "En tránsito",
  parcialmente_recibido: "Recibido parcial", recibido: "Recibido", cancelado: "Cancelado",
};
const FINAL_STATUS = ["recibido", "cancelado"];
const DRAFT_STATUS = ["borrador", "pendiente_revision", "revision"];
const STALE_DAYS = 7;   // una propuesta sin avanzar más de esto se considera vieja
const daysSince = (date) => (date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) : null);

function pedidoEstado(info) {
  if (!info) return { kind: "none" };
  if (info.enCurso) {
    const age = daysSince(info.enCurso.date);
    const vieja = DRAFT_STATUS.includes(info.enCurso.order.status) && age > STALE_DAYS;
    return { kind: vieja ? "vieja" : "curso", entry: info.enCurso, age };
  }
  return { kind: "previo", entry: info.last, age: daysSince(info.last.date) };
}

function PedidoBadge({ est }) {
  if (est.kind === "none") {
    return <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">Sin pedido</span>;
  }
  const o = est.entry.order;
  const label = STATUS_LABEL[o.status] ?? o.status;
  const link = `/procurement/PurchaseOrderDetail/${o.id}`;
  if (est.kind === "vieja") {
    return (
      <Link to={link} title="Propuesta sin enviar desde hace tiempo: revisa si las cantidades siguen siendo válidas"
        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20 transition-colors">
        <Clock size={10} /> Propuesta vieja · {label} · {est.age} d
      </Link>
    );
  }
  if (est.kind === "curso") {
    return (
      <Link to={link} className="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/20 transition-colors">
        En curso · {label}
      </Link>
    );
  }
  return (
    <Link to={link} className="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border-border hover:bg-muted/70 transition-colors">
      Último: {label} · hace {est.age} d
    </Link>
  );
}

// ── Tarjeta de horizonte ───────────────────────────────────────────────────────
function HorizonCard({ h, count, total, active, onClick, loading }) {
  const t = TONE[h.tone];
  const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group text-left rounded-xl border bg-gradient-to-br to-transparent p-4 transition-all duration-200 hover-lift focus-visible:outline-none focus-visible:ring-2",
        t.border, t.bg, t.ring.replace("ring-", "focus-visible:ring-"),
        active && cn("ring-2 ring-offset-1 ring-offset-background shadow-md", t.ring),
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{h.label}</span>
        {active && <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", t.bar)} />}
      </div>
      {loading ? <Skeleton className="h-8 w-16 mt-2" /> : (
        <p className={cn("mt-1 text-3xl font-bold tabular-nums leading-none", t.text)}>{count.toLocaleString()}</p>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{h.hint}</p>
      {!loading && <p className="text-[10px] text-muted-foreground/70">{pct}% de los productos</p>}
    </button>
  );
}

const MODAL_CFG = {
  none:  { title: "Sin pedido en curso",              icon: PackageX,      tone: "text-red-500",
           desc: "Productos de esta franja que no están en ningún pedido vivo. Si ya tuvieron uno, se indica el último." },
  vieja: { title: "En propuestas sin avanzar",         icon: FileClock,     tone: "text-amber-500",
           desc: `Pedidos en borrador o revisión con más de ${STALE_DAYS} días, con los productos de cada uno que ya necesitan reposición.` },
  curso: { title: "Cubiertos por un pedido en curso",  icon: ClipboardList, tone: "text-sky-500",
           desc: "Pedidos vivos que ya incluyen estos productos." },
};
const MODAL_MAX_ROWS = 200;

function ProductoFila({ r, extra }) {
  const tone = TONE[TIER_TONE[r.tier]];
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <ProductImageHover
          singleImage codigo={r.p.codigo} name={r.p.nombre} thumbClass="h-8 w-8"
          images={(r.p.fotos ?? []).map(f => f?.foto ?? f).filter(Boolean)}
          subtitle={<p className="text-muted-foreground text-[10px]">{r.p.codigo} · {r.p.id_online}{r.almacen ? ` · ${r.almacen}` : ""}</p>}
        />
      </div>
      <div className="text-right shrink-0 w-14">
        <p className="text-[10px] text-muted-foreground">Stock</p>
        <p className={cn("text-xs font-bold tabular-nums", r.stock <= 0 && "text-destructive")}>{r.stock}</p>
      </div>
      <div className="text-right shrink-0 w-16">
        <p className="text-[10px] text-muted-foreground">Cobertura</p>
        <p className="text-xs font-semibold tabular-nums">{r.cob == null ? "—" : r.cob < 0.5 ? "<1 d" : `${Math.round(r.cob)} d`}</p>
      </div>
      <span className={cn("hidden sm:inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold shrink-0", tone.chip)}>{TIER_LABEL[r.tier]}</span>
      {extra}
    </div>
  );
}

function PedidoDetalleDialog({ kind, rows, cursoGroups, horizonLabel, onClose }) {
  const cfg = kind ? MODAL_CFG[kind] : null;
  const list = useMemo(() => {
    if (!kind) return [];
    return rows
      .filter(r => (kind === "none" ? (r.pedido.kind === "none" || r.pedido.kind === "previo") : r.pedido.kind === kind))
      .sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || ((a.cob ?? 0) - (b.cob ?? 0)) || ((b.avg ?? 0) - (a.avg ?? 0)));
  }, [kind, rows]);

  // Para vieja y curso: agrupado por pedido
  const groups = useMemo(() => {
    if (kind !== "vieja" && kind !== "curso") return [];
    const map = new Map();
    for (const r of list) {
      const o = r.pedido.entry.order;
      if (!map.has(o.id)) map.set(o.id, { order: o, age: daysSince(o.created_at), items: [] });
      map.get(o.id).items.push(r);
    }
    return [...map.values()].sort((a, b) => b.age - a.age);
  }, [kind, list]);

  const isCurso = kind === "curso";
  const cursoTotal = useMemo(() => cursoGroups.reduce((n, g) => n + g.items.length, 0), [cursoGroups]);
  const total = isCurso ? cursoTotal : list.length;

  const Icon = cfg?.icon;
  return (
    <Dialog open={!!kind} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {cfg && (
          <>
            <DialogHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Icon size={16} className={cfg.tone} /> {cfg.title}
                <Badge variant="secondary" className="text-[10px]">{total.toLocaleString()} productos</Badge>
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isCurso ? "Todos los pedidos vivos con sus productos. Los marcados “fuera de la franja” aún no necesitan reposición, no tienen ventas o están desactivados." : cfg.desc}{" "}<span className="text-foreground/70">Franja: {horizonLabel.toLowerCase()}.</span>
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {total === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No hay productos en esta situación.</p>}

              {kind === "vieja" && groups.map(({ order: o, age, items }) => (
                <div key={o.id} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {o.supplier_name || "—"} <span className="font-mono text-xs text-muted-foreground">#{String(o.id).slice(-6).toUpperCase()}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {STATUS_LABEL[o.status] ?? o.status} · creado hace {age} {age === 1 ? "día" : "días"} · {items.length} producto{items.length !== 1 ? "s" : ""} en esta franja
                      </p>
                    </div>
                    <Link to={`/procurement/PurchaseOrderDetail/${o.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors">
                      Abrir pedido <ExternalLink size={11} />
                    </Link>
                  </div>
                  {items.map(r => (
                    <ProductoFila key={`${r.key}|${r.almacen}`} r={r}
                      extra={
                        <div className="text-right shrink-0 w-14">
                          <p className="text-[10px] text-muted-foreground">En pedido</p>
                          <p className="text-xs font-bold tabular-nums text-primary">{r.pedido.entry.qty ?? "—"}</p>
                        </div>
                      } />
                  ))}
                </div>
              ))}

              {isCurso && cursoGroups.map(({ order: o, age, items }) => (
                <div key={o.id} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {o.supplier_name || "—"} <span className="font-mono text-xs text-muted-foreground">#{String(o.id).slice(-6).toUpperCase()}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {STATUS_LABEL[o.status] ?? o.status} · creado hace {age} {age === 1 ? "día" : "días"} · {items.length} producto{items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Link to={`/procurement/PurchaseOrderDetail/${o.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors">
                      Abrir pedido <ExternalLink size={11} />
                    </Link>
                  </div>
                  {items.map(({ it, r, enFranja }) => r ? (
                    <ProductoFila key={it.id ?? `${r.key}|${r.almacen}`} r={r}
                      extra={
                        <>
                          {!enFranja && <span className="hidden md:inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground shrink-0">fuera de la franja</span>}
                          <div className="text-right shrink-0 w-14">
                            <p className="text-[10px] text-muted-foreground">En pedido</p>
                            <p className="text-xs font-bold tabular-nums text-primary">{it.final_qty ?? "—"}</p>
                          </div>
                        </>
                      } />
                  ) : (
                    <div key={it.id} className="flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{it.product_name || it.supplier_product_name || "—"}</p>
                        <p className="text-[10px] text-muted-foreground">{it.internal_product_code || "sin código"} · desactivado o muerto en tu almacén: no entra en las franjas de reposición</p>
                      </div>
                      <div className="text-right shrink-0 w-14">
                        <p className="text-[10px] text-muted-foreground">En pedido</p>
                        <p className="text-xs font-bold tabular-nums text-primary">{it.final_qty ?? "—"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {kind === "none" && (
                <div className="rounded-lg border border-border overflow-hidden">
                  {list.slice(0, MODAL_MAX_ROWS).map(r => (
                    <ProductoFila key={`${r.key}|${r.almacen}`} r={r}
                      extra={<div className="shrink-0 hidden md:block"><PedidoBadge est={r.pedido} /></div>} />
                  ))}
                </div>
              )}
              {kind === "none" && list.length > MODAL_MAX_ROWS && (
                <p className="text-center text-[11px] text-muted-foreground">
                  Mostrando los {MODAL_MAX_ROWS} más urgentes de {list.length.toLocaleString()}. El resto está en la tabla “Productos a reabastecer”.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const { getOwnerFilter, isLoading: loadingUser } = useProcurementUser();
  const ownerFilter = getOwnerFilter();

  // ── Preferencias, almacenes e índices elegidos ──
  const { data: userPrefs } = useQuery({ queryKey: ["user-preferences"], queryFn: getUserPreferences, staleTime: 5 * 60 * 1000 });
  const almacenes = userPrefs?.almacenes?.length ? userPrefs.almacenes : (userPrefs?.almacen ? [userPrefs.almacen] : []);
  const selectedIndices = userPrefs?.selected_indices?.length ? userPrefs.selected_indices : DEFAULT_SELECTED_INDICES;

  // Productos, existencias, índices y estado de anuncio: una sola carga compartida con Alertas, Reab. Directo y Catálogo
  const indg = useIndgAlmacenes(almacenes, !!userPrefs);
  const loadingProducts = indg.loading && indg.products.size === 0;

  // ── Pedidos y sus líneas ──
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["dash-orders", ownerFilter],
    queryFn: () => ownerFilter
      ? base44.entities.PurchaseOrder.filter(ownerFilter, "-created_date", 200)
      : base44.entities.PurchaseOrder.list("-created_date", 200),
    enabled: !loadingUser,
    staleTime: 2 * 60 * 1000,
  });
  const { data: orderItems = [] } = useQuery({
    queryKey: ["dash-order-items", orders.map(o => o.id).join(",")],
    queryFn: async () => {
      const pages = await Promise.all([0, 200, 400, 600, 800, 1000, 1200, 1400]
        .map(off => base44.entities.PurchaseOrderItem.list("-created_at", 200, off).catch(() => [])));
      return pages.flat();
    },
    enabled: orders.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  // ── Filtros de la pantalla ──
  const [detalle, setDetalle] = useState(null);   // "none" | "vieja" | "curso": tarjeta cuyo detalle se muestra en el modal
  const [almacenSel, setAlmacenSel] = useState("all");
  const [horizon, setHorizon] = useState(30);
  const [soloSinCubrir, setSoloSinCubrir] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  useEffect(() => { setPage(0); }, [almacenSel, horizon, soloSinCubrir, search, pageSize]);

  // ── Último pedido de cada producto (por código) ──
  const pedidoByCode = useMemo(() => {
    const orderById = new Map(orders.map(o => [o.id, o]));
    const byCode = new Map();
    for (const it of orderItems) {
      const o = orderById.get(it.purchase_order_id);
      const code = String(it.internal_product_code ?? "").trim();
      if (!o || !code || o.status === "cancelado") continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({ order: o, date: o.created_at, qty: it.final_qty });
    }
    const out = new Map();
    for (const [code, list] of byCode) {
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      out.set(code, { last: list[0], enCurso: list.find(e => !FINAL_STATUS.includes(e.order.status)) ?? null });
    }
    return out;
  }, [orders, orderItems]);

  // ── Productos con su prioridad ──
  const { rows, inactivos } = useMemo(() => {
    const out = [];
    let inactivos = 0;
    indg.products.forEach((p, key) => {
      if (isInactivo(p.estadoAnuncio)) { inactivos++; return; }
      const idx = indg.salesMap.get(String(p.id_online ?? key)) ?? p.indices ?? null;
      const avg = computeIndiceAvg(idx, selectedIndices);
      const stock = p.cantidad ?? 0;
      const tier = tierOf(stock, avg);
      out.push({
        key, p, almacen: p.almacenSel ?? p.proveedor ?? "—", stock, avg, tier,
        cob: avg > 0 ? stock / avg : null,
        pedido: pedidoEstado(pedidoByCode.get(String(p.codigo ?? "").trim())),
      });
    });
    return { rows: out, inactivos };
  }, [indg.products, indg.salesMap, selectedIndices, pedidoByCode]);

  const scoped = useMemo(() => (almacenSel === "all" ? rows : rows.filter(r => r.almacen === almacenSel)), [rows, almacenSel]);
  const inHorizon = (r, h) => TIER_RANK[r.tier] <= HORIZON_RANK[h];

  // Acumulado por horizonte (agotados incluidos): "cuántos hay que reponer dentro de N días"
  const horizonCounts = useMemo(
    () => Object.fromEntries(HORIZONS.map(h => [h.id, scoped.filter(r => inHorizon(r, h.id)).length])),
    [scoped]);

  // Situación de pedidos de lo que hay que reponer en el horizonte elegido
  const target = useMemo(() => scoped.filter(r => inHorizon(r, horizon)), [scoped, horizon]);
  const pedidoStats = useMemo(() => ({
    none:  target.filter(r => r.pedido.kind === "none" || r.pedido.kind === "previo").length,
    curso: target.filter(r => r.pedido.kind === "curso").length,
    vieja: target.filter(r => r.pedido.kind === "vieja").length,
  }), [target]);

  // Tabla de productos
  const q = search.trim().toLowerCase();
  const tableRows = useMemo(() => {
    let list = target;
    if (soloSinCubrir) list = list.filter(r => r.pedido.kind === "none" || r.pedido.kind === "previo" || r.pedido.kind === "vieja");
    if (q) list = list.filter(r => `${r.p.codigo} ${r.p.id_online} ${r.p.nombre}`.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || ((a.cob ?? 0) - (b.cob ?? 0)) || ((b.avg ?? 0) - (a.avg ?? 0)));
  }, [target, soloSinCubrir, q]);

  // Estado por almacén
  const byAlmacen = useMemo(() => {
    const map = new Map(almacenes.map(a => [a, Object.fromEntries(TIER_ORDER.map(t => [t, 0]))]));
    for (const r of rows) {
      const row = map.get(r.almacen);
      if (row) row[r.tier]++;
    }
    return [...map].map(([almacen, c]) => ({ almacen, c, total: TIER_ORDER.reduce((s, t) => s + c[t], 0) }));
  }, [rows, almacenes]);

  // Propuestas viejas sin avanzar y cuántos de sus productos ya necesitan reposición
  const rowByCode = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const code = String(r.p.codigo ?? "").trim();
      if (code && !m.has(code)) m.set(code, r);
    }
    return m;
  }, [rows]);
  const itemsByOrder = useMemo(() => {
    const m = new Map();
    for (const it of orderItems) {
      if (!m.has(it.purchase_order_id)) m.set(it.purchase_order_id, []);
      m.get(it.purchase_order_id).push(it);
    }
    return m;
  }, [orderItems]);

  const propiosByCode = useMemo(() => {
    const m = new Map();
    indg.products.forEach(p => {
      const code = String(p.codigo ?? "").trim();
      if (!code) return;
      if (!m.has(code)) m.set(code, new Set());
      m.get(code).add(p.almacenSel ?? p.proveedor);
    });
    return m;
  }, [indg.products]);
  const esPropio = (code) => {
    const set = propiosByCode.get(code);
    return !!set && (almacenSel === "all" || set.has(almacenSel));
  };

  const propuestasViejas = useMemo(() => {
    return orders
      .filter(o => DRAFT_STATUS.includes(o.status) && daysSince(o.created_at) > STALE_DAYS)
      .map(o => {
        const items = (itemsByOrder.get(o.id) ?? []).filter(it => esPropio(String(it.internal_product_code ?? "").trim()));
        const needs = items.filter(it => {
          const r = rowByCode.get(String(it.internal_product_code ?? "").trim());
          return r && TIER_RANK[r.tier] <= HORIZON_RANK[30];
        }).length;
        return { o, age: daysSince(o.created_at), total: items.length, needs };
      })
      .sort((a, b) => b.age - a.age);
  }, [orders, itemsByOrder, rowByCode, propiosByCode, almacenSel]);

  // Pedidos en curso (vivos y no estancados) con TODOS sus productos, estén o no en la franja elegida
  const cursoGroups = useMemo(() => {
    return orders
      .filter(o => !FINAL_STATUS.includes(o.status) && !(DRAFT_STATUS.includes(o.status) && daysSince(o.created_at) > STALE_DAYS))
      .map(o => {
        const items = [];
        for (const it of itemsByOrder.get(o.id) ?? []) {
          const code = String(it.internal_product_code ?? "").trim();
          if (!esPropio(code)) continue;   // solo líneas de productos de TUS almacenes
          const r = rowByCode.get(code) ?? null;   // null = producto desactivado o muerto en tu almacén
          items.push({ it, r, enFranja: !!r && TIER_RANK[r.tier] <= HORIZON_RANK[horizon] });
        }
        return { order: o, age: daysSince(o.created_at), items };
      })
      .filter(g => g.items.length > 0)
      .sort((a, b) => b.age - a.age);
  }, [orders, itemsByOrder, rowByCode, propiosByCode, almacenSel, horizon]);
  const cursoFuera = useMemo(() => {
    const codes = new Set();
    for (const g of cursoGroups) for (const x of g.items) if (!x.enFranja) codes.add(String(x.it.internal_product_code ?? x.it.id));
    return codes.size;
  }, [cursoGroups]);

  // Pedidos por estado (resumen compacto)
  const orderCounts = useMemo(() => {
    const c = {};
    for (const o of orders) if (o.status !== "cancelado") c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);
  const statusChips = [
    { label: "Borrador",    n: orderCounts.borrador ?? 0 },
    { label: "En revisión", n: (orderCounts.pendiente_revision ?? 0) + (orderCounts.revision ?? 0) },
    { label: "Confirmado",  n: orderCounts.confirmado ?? 0 },
    { label: "Enviado",     n: orderCounts.enviado ?? 0 },
    { label: "Pagado",      n: orderCounts.pagado ?? 0 },
    { label: "En tránsito", n: orderCounts.en_transito ?? 0 },
  ].filter(c => c.n > 0);

  const activeHorizon = HORIZONS.find(h => h.id === horizon);
  const hayAlmacenes = almacenes.length > 0;

  if (loadingUser || loadingOrders) {
    return (
      <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-bold">Panel de Reabastecimiento</h1>
            <p className="text-xs text-muted-foreground">
              {hayAlmacenes
                ? <>{scoped.length.toLocaleString()} productos activos{inactivos > 0 && <> · {inactivos.toLocaleString()} desactivados o muertos no se cuentan</>}</>
                : "Configura tus almacenes para ver la situación de tu inventario"}
              {indg.loading && !loadingProducts && <span className="ml-2 animate-pulse">· cargando…</span>}
            </p>
          </div>
          {almacenes.length > 1 && (
            <SearchSelect
              value={almacenSel} onChange={setAlmacenSel} options={almacenes}
              allValue="all" allLabel={`Todos mis almacenes (${almacenes.length})`}
              placeholder="Todos mis almacenes" size="md" className="w-[290px]"
            />
          )}
        </div>
        <Badge variant="outline" className="text-xs">
          {new Date().toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
        </Badge>
      </div>

      {!hayAlmacenes ? (
        <Card className="p-4 border-dashed">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Warehouse size={18} className="shrink-0 opacity-50" />
            <div>
              <p className="text-sm font-medium">Sin almacenes configurados</p>
              <p className="text-xs mt-0.5">
                Configura tus almacenes en <Link to="/SalesIndexImport" className="text-primary underline">Índices de Ventas</Link> para ver
                qué productos hay que reponer y cuándo.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {indg.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              No se pudieron cargar los productos: {indg.error.message}
            </div>
          )}

          {/* ¿Cuándo hay que reponer? */}
          <div>
            <div className="flex items-end justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">¿Qué hay que reabastecer y cuándo?</p>
                <p className="text-[11px] text-muted-foreground/80">Productos que se agotan dentro de… (cada franja incluye las anteriores). Pulsa una para ver el detalle.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 stagger">
              {HORIZONS.map(h => (
                <HorizonCard key={h.id} h={h} count={horizonCounts[h.id] ?? 0} total={scoped.length}
                  active={horizon === h.id} onClick={() => setHorizon(h.id)} loading={loadingProducts} />
              ))}
            </div>
          </div>

          {/* Situación de esos productos frente a los pedidos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button type="button" onClick={() => setDetalle("none")} className="group text-left rounded-xl border bg-card text-card-foreground shadow-sm p-4 flex items-center gap-3 hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"><PackageX size={18} /></div>
              <div>
                <p className="text-2xl font-bold tabular-nums leading-tight">{pedidoStats.none.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">sin pedido en curso · {activeHorizon.label.toLowerCase()}</p>
              </div>
              <ChevronRight size={16} className="ml-auto shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5" />
            </button>
            <button type="button" onClick={() => setDetalle("vieja")} className="group text-left rounded-xl border bg-card text-card-foreground shadow-sm p-4 flex items-center gap-3 hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"><FileClock size={18} /></div>
              <div>
                <p className="text-2xl font-bold tabular-nums leading-tight">{pedidoStats.vieja.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">en una propuesta de más de {STALE_DAYS} días sin avanzar</p>
              </div>
              <ChevronRight size={16} className="ml-auto shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5" />
            </button>
            <button type="button" onClick={() => setDetalle("curso")} className="group text-left rounded-xl border bg-card text-card-foreground shadow-sm p-4 flex items-center gap-3 hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <div className="h-10 w-10 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"><ClipboardList size={18} /></div>
              <div>
                <p className="text-2xl font-bold tabular-nums leading-tight">{pedidoStats.curso.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">ya cubiertos por un pedido en curso</p>
                {cursoFuera > 0 && <p className="text-[11px] text-sky-500 mt-0.5">+{cursoFuera} en pedidos en curso, fuera de esta franja</p>}
              </div>
              <ChevronRight size={16} className="ml-auto shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5" />
            </button>
          </div>

          {/* Propuestas viejas */}
          {propuestasViejas.length > 0 && (
            <Card className="p-4 border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center"><Hourglass size={14} /></div>
                  <div>
                    <h3 className="text-sm font-semibold">Propuestas sin avanzar</h3>
                    <p className="text-[11px] text-muted-foreground">Llevan más de {STALE_DAYS} días en borrador o revisión: las cantidades pueden haber quedado cortas.</p>
                  </div>
                </div>
                <Link to="/procurement/PurchaseOrders" className="text-xs text-primary hover:underline flex items-center gap-0.5">Ver pedidos <ChevronRight size={12} /></Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {propuestasViejas.slice(0, 6).map(({ o, age, total, needs }) => (
                  <Link key={o.id} to={`/procurement/PurchaseOrderDetail/${o.id}`}
                    className="group rounded-lg border border-border bg-card px-3 py-2.5 hover:border-amber-500/50 hover:shadow-md transition-all duration-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold truncate">{o.supplier_name || "—"}</span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{String(o.id).slice(-6).toUpperCase()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 text-amber-500 font-semibold"><Clock size={11} /> hace {age} d</span>
                      <span>· {STATUS_LABEL[o.status] ?? o.status}</span>
                    </div>
                    <p className={cn("mt-1 text-[11px]", needs > 0 ? "text-red-500 font-medium" : "text-muted-foreground")}>
                      {total === 0 ? "Sin líneas cargadas" : needs > 0
                        ? <>{needs} de {total} productos ya necesitan reposición (≤ 30 d)</>
                        : <>{total} productos · ninguno urgente todavía</>}
                    </p>
                  </Link>
                ))}
              </div>
              {propuestasViejas.length > 6 && <p className="mt-2 text-[11px] text-muted-foreground">+{propuestasViejas.length - 6} propuestas más</p>}
            </Card>
          )}

          {/* Productos a reabastecer: altura acotada; la lista se desplaza por dentro y el paginado queda siempre visible */}
          <Card className="overflow-hidden flex flex-col max-h-[calc(100vh-6.5rem)]">
            <div className="p-4 pb-3 flex flex-wrap items-center gap-3 border-b border-border shrink-0">
              <div className="mr-auto">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Flame size={15} className={TONE[activeHorizon.tone].text} />
                  Productos a reabastecer · {activeHorizon.label.toLowerCase()}
                </h3>
                <p className="text-[11px] text-muted-foreground">Ordenados por urgencia. La columna Pedido dice si ya hay algo en camino.</p>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por id, código o nombre" className="h-8 w-[240px] pl-7 pr-7 text-xs" />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSoloSinCubrir(v => !v)}
                className={cn("h-8 px-3 rounded-md border text-xs font-medium transition-all duration-200 flex items-center gap-1.5",
                  soloSinCubrir ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30" : "bg-background hover:border-primary/40 hover:bg-primary/5")}
              >
                <AlertTriangle size={12} /> Solo sin cubrir
              </button>
              <Link to="/procurement/DirectReplenishment" className="text-xs text-primary hover:underline flex items-center gap-0.5">Reab. Directo <ChevronRight size={12} /></Link>
            </div>

            {loadingProducts ? (
              <div className="p-4 space-y-2">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : tableRows.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <CheckCircle2 size={28} className="mx-auto text-emerald-500 opacity-70" />
                <p className="text-sm font-medium text-foreground">{q || soloSinCubrir ? "Sin resultados con estos filtros" : "Nada que reponer en este horizonte"}</p>
                {!q && !soloSinCubrir && <p className="text-xs">Ningún producto activo se agota dentro de ese plazo.</p>}
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-left font-medium min-w-[240px]">Producto</th>
                        {almacenes.length > 1 && <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-left font-medium">Almacén</th>}
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-right font-medium">Stock</th>
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-right font-medium" title="Índice de venta diaria (I.AVG)">Venta diaria</th>
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-right font-medium">Cobertura</th>
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-left font-medium">Prioridad</th>
                        <th className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))] px-3 py-2 text-left font-medium">Pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.slice(page * pageSize, (page + 1) * pageSize).map(r => {
                        const tone = TONE[TIER_TONE[r.tier]];
                        return (
                          <tr key={`${r.key}|${r.almacen}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2">
                              <ProductImageHover
                                singleImage codigo={r.p.codigo} name={r.p.nombre}
                                images={(r.p.fotos ?? []).map(f => f?.foto ?? f).filter(Boolean)}
                                subtitle={<p className="text-muted-foreground text-[10px]">{r.p.codigo} · {r.p.id_online}</p>}
                              />
                            </td>
                            {almacenes.length > 1 && <td className="px-3 py-2 text-muted-foreground text-[10px] max-w-[150px] truncate" title={r.almacen}>{r.almacen}</td>}
                            <td className={cn("px-3 py-2 text-right font-bold tabular-nums", r.stock <= 0 && "text-destructive")}>{r.stock}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.avg > 0 ? r.avg.toFixed(2) : "—"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {r.cob == null ? "—" : r.cob < 0.5 ? "<1 d" : `${Math.round(r.cob)} d`}
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold", tone.chip)}>{TIER_LABEL[r.tier]}</span>
                            </td>
                            <td className="px-3 py-2"><PedidoBadge est={r.pedido} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TablePager className="shrink-0" page={page} pageSize={pageSize} total={tableRows.length} onPage={setPage} onPageSize={setPageSize} />
              </div>
            )}
          </Card>

          {/* Estado por almacén */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Warehouse size={14} className="text-primary" /> Situación por almacén</h3>
              <span className="text-[11px] text-muted-foreground">{almacenes.length} almacén{almacenes.length !== 1 ? "es" : ""}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="px-4 py-2 text-left font-medium">Almacén</th>
                    <th className="px-3 py-2 text-left font-medium min-w-[220px]">Distribución por cobertura</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    {TIER_ORDER.map(t => <th key={t} className={cn("px-3 py-2 text-right font-medium", TONE[TIER_TONE[t]].text)}>{TIER_LABEL[t]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {byAlmacen.map(({ almacen, c, total }) => (
                    <tr key={almacen}
                      onClick={() => setAlmacenSel(almacenSel === almacen ? "all" : almacen)}
                      className={cn("border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 transition-colors", almacenSel === almacen && "bg-primary/5")}
                      title="Clic para filtrar el panel por este almacén">
                      <td className="px-4 py-2.5 font-semibold max-w-[220px] truncate">{almacen}</td>
                      <td className="px-3 py-2.5">
                        {total > 0 ? (
                          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            {TIER_ORDER.filter(t => c[t] > 0).map(t => (
                              <div key={t} className={cn("h-full transition-all duration-500", TONE[TIER_TONE[t]].bar)}
                                style={{ width: `${(c[t] / total) * 100}%` }} title={`${TIER_LABEL[t]}: ${c[t]}`} />
                            ))}
                          </div>
                        ) : <span className="text-muted-foreground">{indg.loading ? "cargando…" : "sin productos"}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums">{total.toLocaleString()}</td>
                      {TIER_ORDER.map(t => (
                        <td key={t} className={cn("px-3 py-2.5 text-right tabular-nums", c[t] > 0 ? TONE[TIER_TONE[t]].text : "text-muted-foreground/40")}>{c[t].toLocaleString()}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border bg-muted/30 text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>Cobertura = stock ÷ índice de venta diaria (I.AVG con los índices que elegiste en Índices de Ventas). “Sin ventas” = productos sin índice de venta.</span>
            </div>
          </Card>

          {/* Pedidos en curso */}
          {statusChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">Pedidos</span>
              {statusChips.map(s => (
                <Link key={s.label} to="/procurement/PurchaseOrders">
                  <Badge variant="outline" className="cursor-pointer py-1 px-2.5 text-xs gap-1.5 hover:border-primary/40 hover:bg-primary/5 transition-all">
                    {s.label} <strong className="text-foreground">{s.n}</strong>
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <PedidoDetalleDialog kind={detalle} rows={target} cursoGroups={cursoGroups} horizonLabel={activeHorizon.label} onClose={() => setDetalle(null)} />
    </div>
  );
}
