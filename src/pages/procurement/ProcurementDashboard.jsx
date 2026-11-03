import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { ShoppingBag, Truck, ClipboardList, AlertCircle, Clock, CheckCircle2, Package, TrendingUp, Calendar, ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";

function KpiCard({ title, value, icon: Icon, color = "primary", subtitle }) {
  const colors = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };
  return (
    <Card className="group p-4 flex items-center gap-4 hover-lift">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
    </Card>
  );
}

export default function ProcurementDashboard() {
  const { user, isLoading: loadingUser, isAdmin, getOwnerFilter } = useProcurementUser();

  const filter = getOwnerFilter();

  const { data: offers = [], isLoading: loadingOffers } = useQuery({
    queryKey: ["supplier-offers-dash", filter],
    queryFn: () => filter ? base44.entities.SupplierOffer.filter(filter) : base44.entities.SupplierOffer.list("-created_date", 500),
    enabled: !loadingUser,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["purchase-orders-dash", filter],
    queryFn: () => filter ? base44.entities.PurchaseOrder.filter(filter) : base44.entities.PurchaseOrder.list("-created_date", 200),
    enabled: !loadingUser,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["offer-matches-dash", filter],
    queryFn: () => filter ? base44.entities.OfferItemMatch.filter(filter) : base44.entities.OfferItemMatch.list("-created_date", 1000),
    enabled: !loadingUser,
  });

  const today = new Date().toISOString().slice(0, 10);

  const stats = {
    totalOffers: offers.length,
    vigentes: offers.filter(o => o.status !== "expired" && o.status !== "archived" && (!o.valid_until || o.valid_until >= today)).length,
    vencidas: offers.filter(o => o.valid_until && o.valid_until < today).length,
    pendingMatch: matches.filter(m => m.status === "pending").length,
    totalOrders: orders.length,
    draftOrders: orders.filter(o => o.status === "draft").length,
    totalAmount: orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + (o.total_amount || 0), 0),
    currency: offers[0]?.default_currency || "USD",
  };

  if (loadingUser || loadingOffers || loadingOrders) {
    return <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">{Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>;
  }

  // Group by supplier for chart
  const bySupplier = offers.reduce((acc, o) => {
    acc[o.supplier_name] = (acc[o.supplier_name] || 0) + 1;
    return acc;
  }, {});

  // Status breakdown per supplier
  const supplierStatusMap = offers.reduce((acc, o) => {
    if (!acc[o.supplier_name]) acc[o.supplier_name] = { draft: 0, imported: 0, partially_matched: 0, fully_matched: 0, ordered: 0, expired: 0, archived: 0, total: 0 };
    acc[o.supplier_name][o.status] = (acc[o.supplier_name][o.status] || 0) + 1;
    acc[o.supplier_name].total += 1;
    return acc;
  }, {});

  // Link orders to offers
  const ordersByOfferId = orders.reduce((acc, ord) => {
    if (ord.offer_id) acc[ord.offer_id] = ord;
    return acc;
  }, {});

  // Recent offers sorted by created_date desc
  const recentOffers = [...offers].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")).slice(0, 20);

  const STATUS_INFO = {
    draft:             { label: "Borrador",       cls: "bg-muted text-muted-foreground" },
    imported:          { label: "Importada",      cls: "bg-info/10 text-info border-info/30" },
    partially_matched: { label: "Asoc. parcial",  cls: "bg-warning/10 text-warning border-warning/30" },
    fully_matched:     { label: "Asociada",       cls: "bg-success/10 text-success border-success/30" },
    ordered:           { label: "Con pedido",     cls: "bg-primary/10 text-primary border-primary/30" },
    expired:           { label: "Vencida",        cls: "bg-destructive/10 text-destructive border-destructive/30" },
    archived:          { label: "Archivada",      cls: "bg-muted/60 text-muted-foreground" },
  };

  const ORDER_STATUS = {
    pendiente_revision: { label: "Pendiente rev.", cls: "bg-warning/10 text-warning" },
    aprobado:           { label: "Aprobado",       cls: "bg-success/10 text-success" },
    rechazado:          { label: "Rechazado",      cls: "bg-destructive/10 text-destructive" },
    cancelado:          { label: "Cancelado",      cls: "bg-muted text-muted-foreground" },
    draft:              { label: "Borrador",       cls: "bg-muted text-muted-foreground" },
  };

  function fmtDate(d) {
    if (!d) return "—";
    try { return format(parseISO(d), "dd MMM yy", { locale: es }); } catch { return d.slice(0, 10); }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard de Reabastecimiento</h1>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Vista global — todos los comerciales" : `Tu gestión — ${user?.full_name || user?.email}`}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">{new Date().toLocaleDateString("es-ES")}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
        <KpiCard title="Ofertas importadas" value={stats.totalOffers} icon={Truck} color="primary" />
        <KpiCard title="Ofertas vigentes" value={stats.vigentes} icon={CheckCircle2} color="success" />
        <KpiCard title="Ofertas vencidas" value={stats.vencidas} icon={Clock} color="warning" />
        <KpiCard title="Asociaciones pendientes" value={stats.pendingMatch} icon={AlertCircle} color="destructive" />
        <KpiCard title="Pedidos generados" value={stats.totalOrders} icon={ClipboardList} color="info" />
        <KpiCard title="Pedidos en borrador" value={stats.draftOrders} icon={Package} color="warning" />
        <KpiCard title="Monto total pedidos" value={`${stats.currency} ${stats.totalAmount.toFixed(0)}`} icon={TrendingUp} color="success" subtitle="Pedidos activos" />
        <KpiCard title="Proveedores activos" value={Object.keys(bySupplier).length} icon={ShoppingBag} color="primary" />
      </div>

      {/* Estado por proveedor */}
      {Object.keys(supplierStatusMap).length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Truck size={14} className="text-primary" /> Estado de Ofertas por Proveedor
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Proveedor</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Total</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Importadas</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Asoc. parcial</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Asociadas</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Con pedido</th>
                  <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Vencidas</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(supplierStatusMap).sort((a, b) => b[1].total - a[1].total).map(([name, s]) => (
                  <tr key={name} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium truncate max-w-[180px]">{name}</td>
                    <td className="py-2 px-2 text-center font-semibold">{s.total}</td>
                    <td className="py-2 px-2 text-center">{s.imported || 0}</td>
                    <td className="py-2 px-2 text-center text-warning font-medium">{s.partially_matched || 0}</td>
                    <td className="py-2 px-2 text-center text-success font-medium">{s.fully_matched || 0}</td>
                    <td className="py-2 px-2 text-center text-primary font-medium">{s.ordered || 0}</td>
                    <td className="py-2 px-2 text-center text-destructive">{s.expired || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detalle de ofertas recientes con estado en el tiempo */}
      {recentOffers.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Calendar size={14} className="text-primary" /> Seguimiento de Ofertas — Estado en el Tiempo
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {["Proveedor", "Oferta", "Creada", "Vigencia", "Ítems", "Estado Oferta", "Pedido", "Estado Pedido", "Monto", ""].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOffers.map((o) => {
                  const info = STATUS_INFO[o.status] || { label: o.status, cls: "bg-muted text-muted-foreground" };
                  const order = ordersByOfferId[o.id];
                  const ordInfo = order ? (ORDER_STATUS[order.status] || { label: order.status, cls: "bg-muted text-muted-foreground" }) : null;
                  const isExpired = o.valid_until && o.valid_until < today;
                  return (
                    <tr key={o.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium max-w-[120px] truncate">{o.supplier_name}</td>
                      <td className="py-2 px-2 max-w-[150px] truncate" title={o.offer_name}>{o.offer_name}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{fmtDate(o.created_date)}</td>
                      <td className={`py-2 px-2 whitespace-nowrap ${isExpired ? "text-destructive" : "text-muted-foreground"}`}>
                        {o.valid_from && o.valid_until ? `${fmtDate(o.valid_from)} → ${fmtDate(o.valid_until)}` : fmtDate(o.valid_until || o.valid_from)}
                      </td>
                      <td className="py-2 px-2 text-center">{o.valid_rows || "—"}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className={`text-[10px] border ${info.cls}`}>{info.label}</Badge>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{order ? fmtDate(order.created_date) : "—"}</td>
                      <td className="py-2 px-2">
                        {ordInfo ? (
                          <Badge variant="outline" className={`text-[10px] border ${ordInfo.cls}`}>{ordInfo.label}</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                        {order?.total_amount ? `${order.currency || "USD"} ${Number(order.total_amount).toFixed(0)}` : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Link to={`/procurement/SupplierOfferDetail/${o.id}`}>
                          <ArrowRight size={13} className="text-muted-foreground hover:text-primary transition-colors" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Quick Links */}
      <div className="flex flex-wrap gap-2">
        <Link to="/procurement/SupplierOffers">
          <Badge variant="outline" className="cursor-pointer hover:bg-primary/5 py-1.5 px-3 text-xs">
            <Truck size={11} className="mr-1" /> Ver Ofertas
          </Badge>
        </Link>
        <Link to="/procurement/PurchaseOrders">
          <Badge variant="outline" className="cursor-pointer hover:bg-primary/5 py-1.5 px-3 text-xs">
            <ClipboardList size={11} className="mr-1" /> Ver Pedidos
          </Badge>
        </Link>
      </div>
    </div>
  );
}