import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { ShoppingBag, Truck, ClipboardList, AlertCircle, Clock, CheckCircle2, Package, TrendingUp } from "lucide-react";
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
    <Card className="p-4 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Ofertas importadas" value={stats.totalOffers} icon={Truck} color="primary" />
        <KpiCard title="Ofertas vigentes" value={stats.vigentes} icon={CheckCircle2} color="success" />
        <KpiCard title="Ofertas vencidas" value={stats.vencidas} icon={Clock} color="warning" />
        <KpiCard title="Asociaciones pendientes" value={stats.pendingMatch} icon={AlertCircle} color="destructive" />
        <KpiCard title="Pedidos generados" value={stats.totalOrders} icon={ClipboardList} color="info" />
        <KpiCard title="Pedidos en borrador" value={stats.draftOrders} icon={Package} color="warning" />
        <KpiCard title="Monto total pedidos" value={`${stats.currency} ${stats.totalAmount.toFixed(0)}`} icon={TrendingUp} color="success" subtitle="Pedidos activos" />
        <KpiCard title="Proveedores activos" value={Object.keys(bySupplier).length} icon={ShoppingBag} color="primary" />
      </div>

      {/* By supplier */}
      {Object.keys(bySupplier).length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Ofertas por Proveedor</h3>
          <div className="space-y-2">
            {Object.entries(bySupplier).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-48 truncate">{name}</span>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${(count / stats.totalOffers) * 100}%` }} />
                </div>
                <Badge variant="secondary" className="text-xs">{count}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Predictive Alerts */}

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