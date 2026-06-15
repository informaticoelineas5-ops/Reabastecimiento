import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Truck, ClipboardList, CheckCircle2, Clock, AlertTriangle,
  ShoppingBag, TrendingUp, Package, RefreshCw, XCircle,
  Send, ArchiveX
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

const STATUS_LABEL = {
  borrador:              "Borrador",
  pendiente_revision:    "Pend. Revisión",
  confirmado:            "Confirmado",
  enviado:               "Enviado",
  parcialmente_recibido: "Recibido parcial",
  recibido:              "Recibido",
  cancelado:             "Cancelado",
};
const STATUS_COLOR = {
  borrador:              "#6b7280",
  pendiente_revision:    "#f59e0b",
  confirmado:            "#10b981",
  enviado:               "#3b82f6",
  parcialmente_recibido: "#14b8a6",
  recibido:              "#22c55e",
  cancelado:             "#ef4444",
};
const OFFER_STATUS_LABEL = {
  draft:              "Borrador",
  imported:           "Importada",
  partially_matched:  "Asoc. parcial",
  fully_matched:      "Asoc. completa",
  ordered:            "Con pedido",
  expired:            "Vencida",
  archived:           "Archivada",
};

function KpiCard({ title, value, icon: Icon, colorClass = "bg-primary/10 text-primary", subtitle }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground truncate">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { isAdmin, getOwnerFilter, isLoading: loadingUser } = useProcurementUser();
  const ownerFilter = getOwnerFilter();
  const today = new Date().toISOString().slice(0, 10);

  const { data: offers = [], isLoading: loadingOffers } = useQuery({
    queryKey: ["dash-offers", ownerFilter],
    queryFn: () => ownerFilter
      ? base44.entities.SupplierOffer.filter(ownerFilter, "-created_date", 500)
      : base44.entities.SupplierOffer.list("-created_date", 500),
    enabled: !loadingUser,
    staleTime: 2 * 60 * 1000,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["dash-orders", ownerFilter],
    queryFn: () => ownerFilter
      ? base44.entities.PurchaseOrder.filter(ownerFilter, "-created_date", 200)
      : base44.entities.PurchaseOrder.list("-created_date", 200),
    enabled: !loadingUser,
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = loadingUser || loadingOffers || loadingOrders;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  // ── Offer KPIs ──
  const totalOffers   = offers.length;
  const vigentes      = offers.filter(o => o.status !== "expired" && o.status !== "archived" && (!o.valid_until || o.valid_until >= today)).length;
  const vencidas      = offers.filter(o => o.valid_until && o.valid_until < today && o.status !== "archived").length;
  const withOrder     = offers.filter(o => o.status === "ordered").length;
  const pendingMatch  = offers.filter(o => o.status === "imported" || o.status === "partially_matched").length;

  // ── Order KPIs ──
  const totalOrders      = orders.length;
  const pendingRevision  = orders.filter(o => o.status === "pendiente_revision").length;
  const confirmed        = orders.filter(o => o.status === "confirmado").length;
  const received         = orders.filter(o => o.status === "recibido" || o.status === "parcialmente_recibido").length;
  const cancelled        = orders.filter(o => o.status === "cancelado").length;
  const totalAmount      = orders
    .filter(o => !["cancelado"].includes(o.status))
    .reduce((s, o) => s + (o.total_amount || 0), 0);
  const mainCurrency = orders[0]?.currency || offers[0]?.default_currency || "USD";

  // ── Charts ──
  const ordersByStatus = Object.entries(
    orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {})
  ).map(([status, count]) => ({
    name:  STATUS_LABEL[status] || status,
    value: count,
    color: STATUS_COLOR[status] || "#6b7280",
  }));

  const offersBySupplier = Object.entries(
    offers.reduce((acc, o) => { acc[o.supplier_name || "—"] = (acc[o.supplier_name || "—"] || 0) + 1; return acc; }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // ── Recent orders ──
  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Vista global — todos los comerciales" : "Tu gestión"}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {new Date().toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
        </Badge>
      </div>

      {/* Alertas rápidas */}
      {(pendingRevision > 0 || pendingMatch > 0) && (
        <div className="flex flex-wrap gap-2">
          {pendingRevision > 0 && (
            <Link to="/procurement/PurchaseOrders">
              <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-lg px-3 py-2 hover:bg-amber-500/15 transition-colors cursor-pointer">
                <AlertTriangle size={13} />
                <span><strong>{pendingRevision}</strong> pedido(s) esperando aprobación</span>
              </div>
            </Link>
          )}
          {pendingMatch > 0 && (
            <Link to="/procurement/SupplierOffers">
              <div className="flex items-center gap-2 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-600 rounded-lg px-3 py-2 hover:bg-blue-500/15 transition-colors cursor-pointer">
                <Package size={13} />
                <span><strong>{pendingMatch}</strong> oferta(s) con asociación pendiente</span>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* KPIs Ofertas */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Ofertas de Proveedor</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard title="Total importadas"       value={totalOffers}    icon={Truck}        colorClass="bg-primary/10 text-primary" />
          <KpiCard title="Vigentes"               value={vigentes}       icon={CheckCircle2} colorClass="bg-emerald-500/10 text-emerald-600" />
          <KpiCard title="Pend. asociación"       value={pendingMatch}   icon={RefreshCw}    colorClass="bg-blue-500/10 text-blue-600" />
          <KpiCard title="Con pedido generado"    value={withOrder}      icon={ShoppingBag}  colorClass="bg-teal-500/10 text-teal-600" />
          <KpiCard title="Vencidas sin archivar"  value={vencidas}       icon={ArchiveX}     colorClass="bg-orange-500/10 text-orange-600" />
        </div>
      </div>

      {/* KPIs Pedidos */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Pedidos de Compra</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard title="Total pedidos"      value={totalOrders}     icon={ClipboardList}  colorClass="bg-primary/10 text-primary" />
          <KpiCard title="Pend. aprobación"   value={pendingRevision} icon={Clock}          colorClass="bg-amber-500/10 text-amber-600" />
          <KpiCard title="Confirmados"        value={confirmed}       icon={CheckCircle2}   colorClass="bg-emerald-500/10 text-emerald-600" />
          <KpiCard title="Recibidos"          value={received}        icon={Send}           colorClass="bg-teal-500/10 text-teal-600" />
          <KpiCard
            title="Monto total activo"
            value={`${mainCurrency} ${totalAmount.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            icon={TrendingUp}
            colorClass="bg-green-500/10 text-green-600"
            subtitle="excluye cancelados"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Orders by status */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Pedidos por estado</h3>
          {ordersByStatus.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={ordersByStatus} cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={3} dataKey="value">
                    {ordersByStatus.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {ordersByStatus.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-muted-foreground">{d.name}: <strong className="text-foreground">{d.value}</strong></span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[170px] flex items-center justify-center text-muted-foreground text-sm">Sin pedidos aún</div>
          )}
        </Card>

        {/* Offers by supplier */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Ofertas por proveedor</h3>
          {offersBySupplier.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={offersBySupplier} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="0" tick={{ fontSize: 10 }} width={110} tickFormatter={v => v.length > 14 ? v.slice(0, 13) + "…" : v} />
                <Tooltip formatter={(v) => [v, "Ofertas"]} labelFormatter={l => l} />
                <Bar dataKey="1" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[170px] flex items-center justify-center text-muted-foreground text-sm">Sin ofertas importadas</div>
          )}
        </Card>
      </div>

      {/* Recent orders */}
      {recentOrders.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Pedidos recientes</h3>
            <Link to="/procurement/PurchaseOrders">
              <Badge variant="outline" className="text-xs cursor-pointer hover:bg-primary/5">Ver todos</Badge>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Pedido", "Proveedor", "Productos", "Total", "Estado", "Fecha"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map(o => (
                  <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <Link to={`/procurement/PurchaseOrderDetail/${o.id}`} className="font-mono text-primary hover:underline font-semibold">
                        #{o.id.slice(-6).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[150px]"><span className="truncate block">{o.supplier_name}</span></td>
                    <td className="px-3 py-2 text-center">{o.total_items || "—"}</td>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {o.currency || "USD"} {(o.total_amount || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: `${STATUS_COLOR[o.status]}20`, color: STATUS_COLOR[o.status] }}
                      >
                        {STATUS_LABEL[o.status] || o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {o.created_at ? format(new Date(o.created_at), "dd MMM", { locale: es }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pb-2">
        <Link to="/procurement/SupplierOffers">
          <Badge variant="outline" className="cursor-pointer hover:bg-primary/5 py-1.5 px-3 text-xs">
            <Truck size={11} className="mr-1" /> Ofertas Proveedor
          </Badge>
        </Link>
        <Link to="/procurement/PurchaseOrders">
          <Badge variant="outline" className="cursor-pointer hover:bg-primary/5 py-1.5 px-3 text-xs">
            <ClipboardList size={11} className="mr-1" /> Pedidos de Compra
          </Badge>
        </Link>
        <Link to="/SalesRanking">
          <Badge variant="outline" className="cursor-pointer hover:bg-primary/5 py-1.5 px-3 text-xs">
            <TrendingUp size={11} className="mr-1" /> Ranking de Ventas
          </Badge>
        </Link>
      </div>
    </div>
  );
}
