import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Printer, AlertTriangle, CheckCircle2, Package, Truck, FileDown, Edit3, Trash2, FileText, ClipboardCheck, Check, X, Upload, RefreshCw } from "lucide-react";
import { generatePurchaseOrderPDF } from "@/components/procurement/PurchaseOrderPDF";
import EditOrderDialog from "@/components/procurement/EditOrderDialog";
import SupplierConfirmationImporter from "@/components/procurement/SupplierConfirmationImporter";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { useToast } from "@/components/ui/use-toast";

const STATUS_CONFIG = {
  borrador:              { label: "Borrador",             className: "bg-gray-100 text-gray-600 border-gray-200" },
  pendiente_revision:    { label: "Pendiente de Revisión", className: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmado:            { label: "Confirmado",           className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enviado:               { label: "Enviado",              className: "bg-blue-100 text-blue-700 border-blue-200" },
  parcialmente_recibido: { label: "Recibido parcial",     className: "bg-teal-100 text-teal-700 border-teal-200" },
  recibido:              { label: "Recibido",             className: "bg-green-100 text-green-800 border-green-200" },
  cancelado:             { label: "Cancelado",            className: "bg-red-100 text-red-700 border-red-200" },
};

const DIFF_BADGE = {
  accepted: { label: "Aceptado",  cls: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Rechazado", cls: "bg-red-100 text-red-600 border-red-200" },
  pending:  { label: "Pendiente", cls: "bg-amber-100 text-amber-600 border-amber-200" },
};

export default function PurchaseOrderDetail() {
  const id = window.location.pathname.split("/").pop();
  const { isAdmin, user } = useProcurementUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localDecisions, setLocalDecisions] = useState({});
  const [savingDecisions, setSavingDecisions] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const { data: order, isLoading: loadingOrder } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ id }),
    select: d => d[0],
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["purchase-order-items", id],
    queryFn: () => base44.entities.PurchaseOrderItem.filter({ purchase_order_id: id }, "product_name", 200),
    enabled: !!id,
  });

  // Sync local decisions when items load or change
  useEffect(() => {
    if (!items.length) return;
    setLocalDecisions(prev => {
      const next = { ...prev };
      items.forEach(item => {
        if (!next[item.id]) {
          next[item.id] = item.acceptance_status || "pending";
        }
      });
      return next;
    });
  }, [items]);

  if (loadingOrder || loadingItems) return <div className="p-6 space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-[400px] w-full" /></div>;
  if (!order) return <div className="p-6 text-muted-foreground">Pedido no encontrado.</div>;

  const totalAmount    = items.reduce((s, i) => s + (i.subtotal || 0), 0);
  const manualOverrides = items.filter(i => i.suggested_qty !== i.final_qty);
  const confirmedItems  = items.filter(i => i.confirmed_qty != null);
  const hasConfirmation = confirmedItems.length > 0;
  const allDecided      = confirmedItems.length > 0 && confirmedItems.every(i => (localDecisions[i.id] || "pending") !== "pending");

  const canApprove       = isAdmin && order.status === "pendiente_revision";
  const canSubmitForReview = !isAdmin && order.status === "borrador";
  const canDelete        = isAdmin || (user && order.created_by === user.email && ["pendiente_revision", "borrador"].includes(order.status));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (items?.length) {
        await Promise.all(items.map(it => base44.entities.PurchaseOrderItem.delete(it.id)));
      }
      await base44.entities.PurchaseOrder.delete(order.id);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Pedido eliminado", description: `Pedido #${order.id.slice(-6).toUpperCase()} eliminado.` });
      navigate("/procurement/PurchaseOrders");
    } catch (err) {
      toast({ title: "Error al eliminar", description: err?.message ?? "No se pudo eliminar.", variant: "destructive" });
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const updateStatus = async (status, extra = {}) => {
    const update = { status, ...extra };
    if (status === "confirmado") {
      update.confirmed_at = new Date().toISOString();
      update.confirmed_by = user?.email;
    }
    await base44.entities.PurchaseOrder.update(order.id, update);
    queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  const handleSaveDecisions = async () => {
    setSavingDecisions(true);
    try {
      await Promise.all(
        confirmedItems.map(item =>
          base44.entities.PurchaseOrderItem.update(item.id, {
            acceptance_status: localDecisions[item.id] || "pending",
          })
        )
      );
      const allAccepted  = confirmedItems.every(i => (localDecisions[i.id]) === "accepted");
      const someRejected = confirmedItems.some(i => (localDecisions[i.id]) === "rejected");
      const newConfStatus = allAccepted ? "reviewed_accepted" : someRejected ? "reviewed_partial" : "imported";
      await base44.entities.PurchaseOrder.update(order.id, { confirmation_status: newConfStatus });
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      toast({ title: "Decisiones guardadas", description: `${confirmedItems.length} ítem(s) actualizados.` });
    } catch (err) {
      toast({ title: "Error al guardar", description: err?.message, variant: "destructive" });
    } finally {
      setSavingDecisions(false);
    }
  };

  const handleResetConfirmation = async () => {
    setSavingDecisions(true);
    try {
      await Promise.all(
        items.map(item =>
          base44.entities.PurchaseOrderItem.update(item.id, {
            confirmed_qty:     null,
            acceptance_status: "pending",
          })
        )
      );
      await base44.entities.PurchaseOrder.update(order.id, { confirmation_status: "pending" });
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      setLocalDecisions({});
      setResetConfirm(false);
      toast({ title: "Confirmación eliminada", description: "Puedes importar una nueva confirmación del proveedor." });
    } catch (err) {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    } finally {
      setSavingDecisions(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/procurement/PurchaseOrders" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft size={13} /> Volver a Pedidos
          </Link>
          <h1 className="text-xl font-bold">Pedido #{order.id.slice(-6).toUpperCase()}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground flex items-center gap-1"><Truck size={13} /> {order.supplier_name}</span>
            <Badge className={`text-[10px] border ${STATUS_CONFIG[order.status]?.className || "bg-gray-100 text-gray-600 border-gray-200"}`}>{STATUS_CONFIG[order.status]?.label || order.status}</Badge>
            <Badge variant="outline" className="text-xs">{order.currency || "USD"}{order.exchange_rate && order.exchange_rate !== 1 ? ` · TC: ${order.exchange_rate}` : ""}</Badge>
            {hasConfirmation && (
              <Badge className="text-[10px] border bg-blue-50 text-blue-700 border-blue-200">
                <ClipboardCheck size={10} className="mr-1" />
                Confirmación {allDecided ? "revisada" : "recibida"}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-start flex-wrap">
          {canSubmitForReview && (
            <Button size="sm" onClick={() => updateStatus("pendiente_revision")}>
              Enviar a Revisión
            </Button>
          )}
          {canApprove && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                <Edit3 size={13} className="mr-1.5" /> Editar Pedido
              </Button>
              <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground" onClick={() => updateStatus("confirmado")}>
                ✓ Aprobar Pedido
              </Button>
              <Button size="sm" variant="destructive" onClick={() => updateStatus("cancelado", { rejection_reason: "Rechazado por supervisor" })}>
                ✗ Rechazar
              </Button>
            </>
          )}
          {isAdmin && !canApprove && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
                <Edit3 size={13} className="mr-1.5" /> Editar
              </Button>
              <Select value={order.status} onValueChange={updateStatus}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => generatePurchaseOrderPDF(order, items)}>
            <FileDown size={13} className="mr-1.5" /> Descargar PDF
          </Button>

          {canDelete && (
            <>
              <div className="w-px h-8 bg-border self-center" />
              {confirmDelete ? (
                <div className="flex items-center gap-1.5 bg-destructive/5 border border-destructive/20 rounded-md px-2 py-1">
                  <span className="text-xs text-destructive font-medium">¿Eliminar pedido?</span>
                  <Button size="sm" variant="destructive" disabled={deleting} onClick={handleDelete} className="h-7 px-3 text-xs">
                    {deleting ? "Eliminando..." : "Confirmar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} className="h-7 px-2 text-xs">Cancelar</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 size={13} className="mr-1.5" /> Eliminar
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-primary">{items.length}</p>
          <p className="text-xs text-muted-foreground">Productos</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-success">{order.currency || "USD"} {totalAmount.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-warning">{manualOverrides.length}</p>
          <p className="text-xs text-muted-foreground">Ajustes manuales</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-sm font-bold">{order.created_at ? format(new Date(order.created_at), "dd MMM yyyy", { locale: es }) : "—"}</p>
          <p className="text-xs text-muted-foreground">Creado</p>
          {isAdmin && <p className="text-[10px] text-muted-foreground">por {order.created_by}</p>}
        </Card>
      </div>

      {/* Offer reference */}
      {order.offer_id && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Package size={13} />
          Originado desde oferta:{" "}
          <Link to={`/procurement/SupplierOfferDetail/${order.offer_id}`} className="text-primary hover:underline font-medium">
            {order.offer_name}
          </Link>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines" className="text-xs">
            <FileText size={13} className="mr-1" /> Líneas del Pedido ({items.length})
          </TabsTrigger>
          <TabsTrigger value="confirmation" className="text-xs">
            <ClipboardCheck size={13} className="mr-1" />
            Confirmación Proveedor
            {hasConfirmation && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${allDecided ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {allDecided ? "Revisada" : `${confirmedItems.length} ítem(s)`}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Lines Tab ── */}
        <TabsContent value="lines">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Líneas del Pedido</h3>
              {manualOverrides.length > 0 && (
                <Badge variant="outline" className="text-xs text-warning border-warning">
                  <AlertTriangle size={10} className="mr-1" /> {manualOverrides.length} ajuste(s) manual(es)
                </Badge>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {["Código", "Producto", "Unidad", "Stock actual", "Sugerido", "Cant. Final", "Precio unit.", "Subtotal", "Ajuste"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const isOverride = item.suggested_qty !== item.final_qty;
                    return (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-mono text-primary font-semibold">{item.internal_product_code || "—"}</td>
                        <td className="px-3 py-2.5 max-w-[180px]">
                          <p className="font-medium truncate">{item.product_name}</p>
                          {item.supplier_product_name !== item.product_name && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.supplier_product_name}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">{item.unit || "—"}</td>
                        <td className="px-3 py-2.5">{item.current_stock ?? "—"}</td>
                        <td className="px-3 py-2.5 text-blue-500">{item.suggested_qty ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <span className={`font-bold ${isOverride ? "text-primary" : ""}`}>{item.final_qty}</span>
                            {isOverride && <CheckCircle2 size={11} className="text-primary" />}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{item.currency || order.currency} {(item.unit_cost || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 font-semibold">{item.currency || order.currency} {(item.subtotal || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground italic">{item.override_reason || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={7} className="px-3 py-2.5 text-right font-semibold text-sm">Total:</td>
                    <td className="px-3 py-2.5 font-bold text-sm">{order.currency || "USD"} {totalAmount.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {order.notes && (
            <Card className="p-4 mt-3">
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Observaciones</h3>
              <p className="text-sm">{order.notes}</p>
            </Card>
          )}
        </TabsContent>

        {/* ── Confirmation Tab ── */}
        <TabsContent value="confirmation">
          <Card className="p-4 space-y-4">
            {!hasConfirmation ? (
              /* ── No confirmation yet ── */
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Confirmación del Proveedor</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sube el archivo que el proveedor envió con las cantidades confirmadas.
                    Puede ser Excel, CSV o PDF.
                  </p>
                </div>
                <SupplierConfirmationImporter
                  orderId={order.id}
                  orderItems={items}
                  onImported={() => {
                    queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
                    queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
                  }}
                />
              </div>
            ) : (
              /* ── Diff table ── */
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Diferencias con la confirmación del proveedor</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Revisa cada ítem y decide si aceptas la cantidad confirmada por el proveedor.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline"
                      className="text-xs"
                      onClick={() => {
                        const next = {};
                        confirmedItems.forEach(i => { next[i.id] = "accepted"; });
                        setLocalDecisions(prev => ({ ...prev, ...next }));
                      }}
                    >
                      <Check size={12} className="mr-1" /> Aceptar todo
                    </Button>
                    {resetConfirm ? (
                      <div className="flex items-center gap-1 bg-destructive/5 border border-destructive/20 rounded-md px-2 py-1">
                        <span className="text-xs text-destructive font-medium">¿Eliminar confirmación?</span>
                        <Button size="sm" variant="destructive" disabled={savingDecisions} onClick={handleResetConfirmation} className="h-6 px-2 text-xs">Sí</Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetConfirm(false)} className="h-6 px-1 text-xs">No</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="text-xs text-muted-foreground" onClick={() => setResetConfirm(true)}>
                        <Upload size={12} className="mr-1" /> Importar nueva
                      </Button>
                    )}
                  </div>
                </div>

                {/* Summary badges */}
                <div className="flex gap-2 flex-wrap text-xs">
                  <span className="px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200">
                    {confirmedItems.filter(i => (localDecisions[i.id] || "pending") === "accepted").length} aceptados
                  </span>
                  <span className="px-2 py-1 rounded bg-red-50 text-red-600 border border-red-200">
                    {confirmedItems.filter(i => (localDecisions[i.id] || "pending") === "rejected").length} rechazados
                  </span>
                  <span className="px-2 py-1 rounded bg-amber-50 text-amber-600 border border-amber-200">
                    {confirmedItems.filter(i => (localDecisions[i.id] || "pending") === "pending").length} pendientes
                  </span>
                </div>

                {/* Diff table */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs" style={{ minWidth: "700px" }}>
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Producto</th>
                        <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Cant. Pedida</th>
                        <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Cant. Confirmada</th>
                        <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Diferencia</th>
                        <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Estado</th>
                        <th className="px-3 py-2.5 text-center font-medium text-primary">Decisión</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const hasConf = item.confirmed_qty != null;
                        const diff    = hasConf ? item.confirmed_qty - item.final_qty : null;
                        const pct     = hasConf && item.final_qty ? Math.round((item.confirmed_qty / item.final_qty) * 100) : null;
                        const dec     = localDecisions[item.id] || "pending";
                        const dbConf  = DIFF_BADGE[dec] ?? DIFF_BADGE.pending;

                        return (
                          <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2.5 max-w-[200px]">
                              <p className="font-medium truncate">{item.product_name}</p>
                              <p className="text-[10px] font-mono text-muted-foreground">{item.internal_product_code || "—"}</p>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">{item.final_qty}</td>
                            <td className="px-3 py-2.5 text-right">
                              {hasConf ? (
                                <span className={`font-bold ${diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "text-foreground"}`}>
                                  {item.confirmed_qty}
                                </span>
                              ) : (
                                <span className="text-muted-foreground italic">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {diff != null ? (
                                <span className={`font-semibold ${diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "text-muted-foreground"}`}>
                                  {diff > 0 ? "+" : ""}{diff}
                                  {pct != null && diff !== 0 && <span className="text-[10px] font-normal ml-1">({pct}%)</span>}
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {!hasConf ? (
                                <span className="text-[10px] text-muted-foreground italic">Sin confirmar</span>
                              ) : diff === 0 ? (
                                <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Sin cambio</Badge>
                              ) : diff < 0 ? (
                                <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-600 border-red-200">↓ Reducida</Badge>
                              ) : (
                                <Badge className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 border-blue-200">↑ Aumentada</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {!hasConf ? (
                                <span className="text-[10px] text-muted-foreground text-center block">—</span>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setLocalDecisions(prev => ({ ...prev, [item.id]: "accepted" }))}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border ${dec === "accepted" ? "bg-green-500 text-white border-green-600" : "border-border text-muted-foreground hover:border-green-400 hover:text-green-600"}`}
                                  >
                                    <Check size={10} /> Acepto
                                  </button>
                                  <button
                                    onClick={() => setLocalDecisions(prev => ({ ...prev, [item.id]: "rejected" }))}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border ${dec === "rejected" ? "bg-red-500 text-white border-red-600" : "border-border text-muted-foreground hover:border-red-400 hover:text-red-600"}`}
                                  >
                                    <X size={10} /> Rechazo
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Button
                  onClick={handleSaveDecisions}
                  disabled={savingDecisions || !allDecided}
                  className="w-full"
                >
                  <RefreshCw size={14} className={`mr-2 ${savingDecisions ? "animate-spin" : ""}`} />
                  {savingDecisions ? "Guardando..." : allDecided ? "Guardar Decisiones" : `Guardar (faltan ${confirmedItems.filter(i => (localDecisions[i.id] || "pending") === "pending").length} por decidir)`}
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <EditOrderDialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        order={order}
        items={items}
      />
    </div>
  );
}
