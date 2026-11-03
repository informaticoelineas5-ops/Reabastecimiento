import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterBar, FilterField, FilterSearch } from "@/components/common/FilterBar";
import { ListFilter } from "lucide-react";
import { ClipboardList, ExternalLink, Truck, Package, DollarSign, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { useToast } from "@/components/ui/use-toast";

const STATUS_CONFIG = {
  borrador:              { label: "Borrador",           className: "bg-gray-100 text-gray-600 border-gray-200",            borderL: "border-l-gray-300" },
  pendiente_revision:    { label: "Pendiente Revisión", className: "bg-amber-100 text-amber-700 border-amber-200",         borderL: "border-l-amber-400" },
  confirmado:            { label: "Confirmado",         className: "bg-emerald-100 text-emerald-700 border-emerald-200",   borderL: "border-l-emerald-500" },
  enviado:               { label: "Enviado",            className: "bg-blue-100 text-blue-700 border-blue-200",            borderL: "border-l-blue-500" },
  en_transito:           { label: "En Tránsito",        className: "bg-sky-100 text-sky-700 border-sky-200",               borderL: "border-l-sky-500" },
  pagado:                { label: "Pagado",             className: "bg-violet-100 text-violet-700 border-violet-200",      borderL: "border-l-violet-500" },
  parcialmente_recibido: { label: "Recibido parcial",   className: "bg-teal-100 text-teal-700 border-teal-200",            borderL: "border-l-teal-400" },
  recibido:              { label: "Recibido",           className: "bg-green-100 text-green-800 border-green-200",         borderL: "border-l-green-600" },
  cancelado:             { label: "Cancelado",          className: "bg-red-100 text-red-700 border-red-200",               borderL: "border-l-red-400" },
};

const APPROVAL_CONFIG = {
  pending_ic:     { label: "En revisión IC",    cls: "bg-purple-100 text-purple-700 border-purple-200" },
  pending_review: { label: "Pend. Revisor",     cls: "bg-amber-100 text-amber-700 border-amber-200" },
  approved:       { label: "Aprobado",          cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

export default function PurchaseOrders() {
  const { isLoading: loadingUser, isAdmin, user, getOwnerFilter } = useProcurementUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Determina si el usuario puede eliminar un pedido específico
  const canDelete = (order) => {
    if (isAdmin) return true;
    if (!user) return false;
    return order.created_by === user.email &&
      ["pendiente_revision", "borrador"].includes(order.status);
  };

  const handleDelete = async (order) => {
    setDeleting(true);
    try {
      // Eliminar ítems primero, luego el pedido
      const items = await base44.entities.PurchaseOrderItem.filter({ purchase_order_id: order.id });
      if (items?.length) {
        await Promise.all(items.map(it => base44.entities.PurchaseOrderItem.delete(it.id)));
      }
      await base44.entities.PurchaseOrder.delete(order.id);
      if (order.offer_id) {
        await base44.entities.SupplierOffer.update(order.offer_id, { status: "fully_matched" });
        queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
      }
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Pedido eliminado", description: `Pedido #${order.id.slice(-6).toUpperCase()} eliminado correctamente.` });
    } catch (err) {
      toast({ title: "Error al eliminar", description: err?.message ?? "No se pudo eliminar el pedido.", variant: "destructive" });
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const filter = getOwnerFilter();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["purchase-orders", filter],
    queryFn: () => filter ? base44.entities.PurchaseOrder.filter(filter, "-created_date", 200) : base44.entities.PurchaseOrder.list("-created_date", 200),
    enabled: !loadingUser,
  });

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const ms = !q || (o.supplier_name || "").toLowerCase().includes(q) || (o.offer_name || "").toLowerCase().includes(q);
    const mst = statusFilter === "all" || o.status === statusFilter;
    return ms && mst;
  });

  const totalAmount = filtered.filter(o => o.status !== "cancelled").reduce((s, o) => s + (o.total_amount || 0), 0);

  if (loadingUser || isLoading) return <div className="p-6 space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardList size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Pedidos de Compra</h1>
            <p className="text-xs text-muted-foreground">{filtered.length} pedido(s){isAdmin ? " — vista global" : ""}</p>
          </div>
        </div>
      </div>

      {/* Mini stats */}
      {orders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Total",          value: orders.length,                                                             cls: "text-foreground" },
            { label: "Pend. revisión", value: orders.filter(o => o.status === "pendiente_revision").length,              cls: "text-warning" },
            { label: "Confirmados",    value: orders.filter(o => o.status === "confirmado").length,                      cls: "text-success" },
            { label: "Enviados",       value: orders.filter(o => o.status === "enviado").length,                         cls: "text-info" },
            { label: "Recibidos",      value: orders.filter(o => o.status === "recibido" || o.status === "parcialmente_recibido").length, cls: "text-primary" },
            { label: "Monto total",    value: `${totalAmount.toFixed(0)}`, cls: "text-success" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex items-center gap-1.5 bg-muted/60 border border-border/50 rounded-lg px-3 py-1.5 text-xs">
              <span className={`font-bold text-sm ${cls}`}>{value}</span>
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Proveedor u oferta…" className="w-[240px]" />
        <FilterField icon={ListFilter} label="Estado del pedido">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterField>
      </FilterBar>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-12 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <ClipboardList size={22} className="text-muted-foreground opacity-60" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {search || statusFilter !== "all" ? "Sin resultados" : "Aún no tienes pedidos"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {search || statusFilter !== "all"
                  ? "Intenta con otros filtros de búsqueda o estado."
                  : "Genera tu primer pedido de compra desde una oferta de proveedor."}
              </p>
            </div>
            {!(search || statusFilter !== "all") && (
              <Link to="/procurement/SupplierOffers">
                <Button size="sm" variant="outline">Ver ofertas de proveedor</Button>
              </Link>
            )}
          </Card>
        ) : filtered.map(order => {
          const status = STATUS_CONFIG[order.status] || { label: order.status, className: "bg-gray-100 text-gray-600 border-gray-200", borderL: "border-l-gray-300" };
          return (
            <Card key={order.id} className={`p-4 hover:shadow-md transition-shadow border-l-4 ${status.borderL}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">Pedido #{order.id.slice(-6).toUpperCase()}</span>
                    <Badge className={`text-[10px] border ${status.className}`}>{status.label}</Badge>
                    {APPROVAL_CONFIG[order.approval_status] && (
                      <Badge className={`text-[10px] border ${APPROVAL_CONFIG[order.approval_status].cls}`}>
                        {APPROVAL_CONFIG[order.approval_status].label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Truck size={11} /> {order.supplier_name}</span>
                    <span className="flex items-center gap-1"><Package size={11} /> {order.total_items || 0} ítems</span>
                    <span className="flex items-center gap-1"><DollarSign size={11} /> {order.currency || "USD"} {(order.total_amount || 0).toFixed(2)}</span>
                    {(order.created_at || order.created_date) && (
                      <span>{format(new Date(order.created_at || order.created_date), "dd MMM yyyy", { locale: es })}</span>
                    )}
                    {isAdmin && <span className="text-[10px] italic">por: {order.created_by}</span>}
                  </div>
                  {order.offer_name && <p className="text-[10px] text-muted-foreground">Oferta: {order.offer_name}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {canDelete(order) && (
                    confirmDeleteId === order.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-destructive font-medium">¿Eliminar?</span>
                        <Button
                          size="sm" variant="destructive"
                          disabled={deleting}
                          onClick={() => handleDelete(order)}
                          className="h-7 px-2 text-xs"
                        >
                          {deleting ? "..." : "Sí"}
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-7 px-2 text-xs"
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setConfirmDeleteId(order.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Eliminar pedido"
                      >
                        <Trash2 size={14} />
                      </Button>
                    )
                  )}
                  <Link to={`/procurement/PurchaseOrderDetail/${order.id}`}>
                    <Button size="sm" variant="outline">
                      <ExternalLink size={13} className="mr-1.5" /> Ver detalle
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}