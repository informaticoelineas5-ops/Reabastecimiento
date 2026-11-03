import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, AlertTriangle, CheckCircle2, Package, Truck, FileDown, Edit3, Trash2, FileText, ClipboardCheck, Check, X, Upload, RefreshCw, Send, ShieldCheck, DollarSign, PlaneTakeoff, CreditCard, PackageCheck, CalendarClock, Save, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generatePurchaseOrderPDF, generateConfirmationPDF } from "@/components/procurement/PurchaseOrderPDF";
import EditOrderDialog from "@/components/procurement/EditOrderDialog";
import SupplierConfirmationImporter from "@/components/procurement/SupplierConfirmationImporter";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { useToast } from "@/components/ui/use-toast";

const STATUS_CONFIG = {
  borrador:              { label: "Borrador",              className: "bg-gray-100 text-gray-600 border-gray-200" },
  pendiente_revision:    { label: "Pendiente de Revisión", className: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmado:            { label: "Confirmado",            className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enviado:               { label: "Enviado al Proveedor",   className: "bg-blue-100 text-blue-700 border-blue-200" },
  en_transito:           { label: "En Tránsito",           className: "bg-sky-100 text-sky-700 border-sky-200" },
  pagado:                { label: "Pagado",                className: "bg-violet-100 text-violet-700 border-violet-200" },
  parcialmente_recibido: { label: "Recibido parcial",      className: "bg-teal-100 text-teal-700 border-teal-200" },
  recibido:              { label: "Recibido",              className: "bg-green-100 text-green-800 border-green-200" },
  cancelado:             { label: "Cancelado",             className: "bg-red-100 text-red-700 border-red-200" },
};

const FLOW_STEPS = [
  { key: "borrador",           label: "Borrador" },
  { key: "pendiente_revision", label: "Revisión" },
  { key: "confirmado",         label: "Confirmado" },
  { key: "enviado",            label: "Enviado" },
  { key: "en_transito",        label: "En Tránsito" },
  { key: "pagado",             label: "Pagado" },
  { key: "recibido",           label: "Recibido" },
];

const APPROVAL_CONFIG = {
  draft:          null,
  pending_ic:     { label: "En revisión IC",      cls: "bg-purple-100 text-purple-700 border-purple-200" },
  pending_review: { label: "Pendiente Revisor",   cls: "bg-amber-100 text-amber-700 border-amber-200" },
  approved:       { label: "Aprobado",            cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const DIFF_BADGE = {
  accepted: { label: "Aceptado",  cls: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Rechazado", cls: "bg-red-100 text-red-600 border-red-200" },
  pending:  { label: "Pendiente", cls: "bg-amber-100 text-amber-600 border-amber-200" },
};

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { isAdmin, isComercial, isAnalista, isRevisor, user } = useProcurementUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [showEdit, setShowEdit]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]         = useState(false);
  const [localDecisions, setLocalDecisions] = useState({});
  const [savingDecisions, setSavingDecisions] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [qtyEdits, setQtyEdits]         = useState({});
  const [transitioning, setTransitioning] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paidQtyEdits, setPaidQtyEdits] = useState({});
  const [paymentRef, setPaymentRef]     = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [keyDates, setKeyDates]         = useState({ fecha_limite_pago: "", fecha_estimada_llegada: "" });
  const [savingDates, setSavingDates]   = useState(false);
  const [showSupplierView, setShowSupplierView] = useState(false);

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

  useEffect(() => {
    if (!items.length) return;
    setLocalDecisions(prev => {
      const next = { ...prev };
      items.forEach(item => {
        if (!next[item.id]) next[item.id] = item.acceptance_status || "pending";
      });
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (!order) return;
    setKeyDates({
      fecha_limite_pago:      order.fecha_limite_pago      || "",
      fecha_estimada_llegada: order.fecha_estimada_llegada || "",
    });
  }, [order]);

  // ── Supplier-grouped view (for multi-match / pack items) ─────
  // Must be before early returns to comply with Rules of Hooks
  const supplierGroups = useMemo(() => {
    const groups = new Map();
    items.forEach(item => {
      const key = item.offer_item_id || item.id;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          supplier_product_code: item.supplier_product_code,
          supplier_product_name: item.supplier_product_name,
          unit_cost: item.unit_cost || 0,
          currency: item.currency || order?.currency,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    });
    return [...groups.values()];
  }, [items, order]);
  const hasPackItems = supplierGroups.some(g => g.items.length > 1);

  if (loadingOrder || loadingItems) return <div className="p-6 space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-[400px] w-full" /></div>;
  if (!order) return <div className="p-6 text-muted-foreground">Pedido no encontrado.</div>;

  const approvalStatus   = order.approval_status || "draft";
  const totalAmount      = items.reduce((s, i) => s + (i.subtotal || 0), 0);
  const manualOverrides  = items.filter(i => i.suggested_qty !== i.final_qty);
  const confirmedItems   = items.filter(i => i.confirmed_qty != null);
  const hasConfirmation  = confirmedItems.length > 0;
  const allDecided       = confirmedItems.length > 0 && confirmedItems.every(i => (localDecisions[i.id] || "pending") !== "pending");
  const hasQtyEdits      = Object.keys(qtyEdits).length > 0;

  // ── Permission flags ─────────────────────────────────────────
  const canDelete       = isAdmin || (user && order.created_by === user.email && ["borrador"].includes(order.status) && approvalStatus === "draft");
  // Comercial marca manualmente cuando ya envió el PDF al proveedor
  const canMarkEnviado  = (isAdmin || isComercial) && order.status === "confirmado" && approvalStatus === "approved";
  // En Tránsito solo disponible desde "enviado" y después de que la confirmación del proveedor haya sido revisada
  // Admin puede omitir el requisito de confirmación revisada como override
  const canMarkTransito = (isAdmin || isComercial || isAnalista) && order.status === "enviado" &&
    (isAdmin || order.confirmation_status?.startsWith("reviewed"));
  const canMarkPagado    = (isAdmin || isComercial || isAnalista) && order.status === "en_transito";
  const canMarkRecibido  = (isAdmin || isComercial || isAnalista) && order.status === "pagado";

  // Comercial: send to IC (or skip to revisor)
  const canSendToIC       = isComercial && approvalStatus === "draft";

  // Analista: edit qtys and forward to revisor
  const canEditAsAnalista = isAnalista && approvalStatus === "pending_ic";

  // Revisor: edit qtys and approve (accepts from both pending_ic and pending_review)
  const canEditAsRevisor  = isRevisor && ["pending_ic", "pending_review"].includes(approvalStatus);
  // Admin can approve/edit from any pending state (bypasses the role flow)
  const canApproveOrder   = (isRevisor && ["pending_ic", "pending_review"].includes(approvalStatus)) || (isAdmin && approvalStatus !== "approved");

  // Revisor y admin siempre; comercial solo tras aprobación; analista no descarga
  const canDownload = isAdmin || isRevisor || (isComercial && approvalStatus === "approved");

  // Confirmación del proveedor: solo editable mientras el pedido está en "enviado al proveedor"
  const canEditConfirmation = (isAdmin || isComercial) && order.status === "enviado";

  const canEditQty = canEditAsAnalista || canEditAsRevisor || (isAdmin && approvalStatus !== "approved");

  // ── Helpers ──────────────────────────────────────────────────
  const updateApproval = async (newApproval, extra = {}) => {
    const payload = { approval_status: newApproval, ...extra };
    await base44.entities.PurchaseOrder.update(order.id, payload);
    queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  const saveQtyEdits = async () => {
    if (!hasQtyEdits) return;
    await Promise.all(
      Object.entries(qtyEdits).map(([itemId, newQty]) =>
        base44.entities.PurchaseOrderItem.update(itemId, { final_qty: newQty })
      )
    );
    const newTotal = items.reduce((s, i) => s + (qtyEdits[i.id] != null ? qtyEdits[i.id] * (i.unit_cost || 0) : (i.subtotal || 0)), 0);
    await base44.entities.PurchaseOrder.update(order.id, { total_amount: newTotal });
    queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
    setQtyEdits({});
  };

  const handleSendToIC = async () => {
    setTransitioning(true);
    try {
      await updateApproval("pending_ic");
      toast({ title: "Pedido enviado a IC", description: "El equipo de Inteligencia Comercial puede revisarlo ahora." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleSendToRevisor = async () => {
    setTransitioning(true);
    try {
      await saveQtyEdits();
      await updateApproval("pending_review", { ic_reviewed_by: user?.email, ic_reviewed_at: new Date().toISOString() });
      toast({ title: "Pedido enviado a Revisor", description: "El Revisor puede aprobarlo ahora." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleApprove = async () => {
    setTransitioning(true);
    try {
      await saveQtyEdits();
      await updateApproval("approved", {
        approved_by: user?.email,
        approved_at: new Date().toISOString(),
        comercial_notified: false,
        status: "confirmado",
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.email,
      });
      toast({ title: "Pedido aprobado", description: "El Comercial recibirá una notificación para descargarlo." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (items?.length) await Promise.all(items.map(it => base44.entities.PurchaseOrderItem.delete(it.id)));
      await base44.entities.PurchaseOrder.delete(order.id);
      if (order.offer_id) {
        await base44.entities.SupplierOffer.update(order.offer_id, { status: "fully_matched" });
        queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
      }
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
    if (status === "confirmado") { update.confirmed_at = new Date().toISOString(); update.confirmed_by = user?.email; }
    await base44.entities.PurchaseOrder.update(order.id, update);
    queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  const handleSaveDecisions = async () => {
    setSavingDecisions(true);
    try {
      await Promise.all(
        confirmedItems.map(item =>
          base44.entities.PurchaseOrderItem.update(item.id, { acceptance_status: localDecisions[item.id] || "pending" })
        )
      );
      const allAccepted  = confirmedItems.every(i => localDecisions[i.id] === "accepted");
      const someRejected = confirmedItems.some(i => localDecisions[i.id] === "rejected");
      const newConfStatus = allAccepted ? "reviewed_accepted" : someRejected ? "reviewed_partial" : "imported";
      await base44.entities.PurchaseOrder.update(order.id, { confirmation_status: newConfStatus });
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      toast({ title: "Decisiones guardadas", description: `${confirmedItems.length} ítem(s) actualizados.` });
    } catch (err) {
      toast({ title: "Error al guardar", description: err?.message, variant: "destructive" });
    } finally { setSavingDecisions(false); }
  };

  const handleMarkEnviado = async () => {
    setTransitioning(true);
    try {
      await updateStatus("enviado");
      toast({ title: "Pedido enviado al proveedor", description: "Sube la confirmación del proveedor cuando la recibas para avanzar al siguiente paso." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleMarkTransito = async () => {
    setTransitioning(true);
    try {
      await updateStatus("en_transito");
      toast({ title: "Pedido en tránsito", description: "El pedido ha sido marcado como En Tránsito." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleMarkRecibido = async () => {
    setTransitioning(true);
    try {
      await updateStatus("recibido");
      toast({ title: "¡Pedido recibido!", description: "La mercancía ha sido confirmada como recibida en almacén." });
    } catch (err) {
      toast({ title: "No se pudo actualizar el pedido", description: err?.message, variant: "destructive" });
    } finally { setTransitioning(false); }
  };

  const handleSavePayment = async () => {
    setSavingPayment(true);
    try {
      await Promise.all(
        items.map(item => {
          const paidQty = paidQtyEdits[item.id] ?? item.final_qty;
          return base44.entities.PurchaseOrderItem.update(item.id, { paid_qty: paidQty });
        })
      );
      await base44.entities.PurchaseOrder.update(order.id, {
        status:             "pagado",
        paid_at:            new Date().toISOString(),
        paid_by:            user?.email,
        payment_reference:  paymentRef || null,
      });
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setShowPaymentModal(false);
      setPaidQtyEdits({});
      setPaymentRef("");
      toast({ title: "¡Pedido registrado como Pagado!", description: "Las cantidades reales han sido guardadas correctamente." });
    } catch (err) {
      toast({ title: "Error al guardar pago", description: err?.message, variant: "destructive" });
    } finally { setSavingPayment(false); }
  };

  const handleSaveKeyDates = async () => {
    setSavingDates(true);
    try {
      await base44.entities.PurchaseOrder.update(order.id, {
        fecha_limite_pago:      keyDates.fecha_limite_pago || null,
        fecha_estimada_llegada: keyDates.fecha_estimada_llegada || null,
      });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Fechas clave guardadas" });
    } catch (err) {
      toast({ title: "Error al guardar fechas", description: err?.message, variant: "destructive" });
    } finally { setSavingDates(false); }
  };

  const handleResetConfirmation = async () => {
    setSavingDecisions(true);
    try {
      await Promise.all(items.map(item =>
        base44.entities.PurchaseOrderItem.update(item.id, { confirmed_qty: null, acceptance_status: "pending" })
      ));
      await base44.entities.PurchaseOrder.update(order.id, { confirmation_status: "pending" });
      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      setLocalDecisions({});
      setResetConfirm(false);
      toast({ title: "Confirmación eliminada", description: "Puedes importar una nueva confirmación del proveedor." });
    } catch (err) {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    } finally { setSavingDecisions(false); }
  };

  const approvalBadge = APPROVAL_CONFIG[approvalStatus];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/procurement/PurchaseOrders" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft size={13} /> Volver a Pedidos
          </Link>
          <h1 className="text-xl font-bold">Pedido #{order.id.slice(-6).toUpperCase()}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground flex items-center gap-1"><Truck size={13} /> {order.supplier_name}</span>
            <Badge className={`text-[10px] border ${STATUS_CONFIG[order.status]?.className || "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {STATUS_CONFIG[order.status]?.label || order.status}
            </Badge>
            {approvalBadge && (
              <Badge className={`text-[10px] border ${approvalBadge.cls}`}>
                {approvalBadge.label}
              </Badge>
            )}
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
          {/* ── Comercial actions ── */}
          {canSendToIC && (
            <>
              <Button size="sm" variant="outline" disabled={transitioning} onClick={handleSendToIC}>
                <Send size={13} className="mr-1.5" /> Enviar a IC
              </Button>
              <Button size="sm" disabled={transitioning} onClick={handleSendToRevisor}>
                <Send size={13} className="mr-1.5" /> Enviar directo a Revisor
              </Button>
            </>
          )}

          {/* ── Editar pedido: admin + analista + revisor en estados editables ── */}
          {(isAdmin || canEditQty) && (
            <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}>
              <Edit3 size={13} className="mr-1.5" /> Editar
            </Button>
          )}

          {/* ── Analista actions ── */}
          {canEditAsAnalista && (
            <Button size="sm" onClick={handleSendToRevisor} disabled={transitioning} className="bg-purple-600 hover:bg-purple-700 text-white">
              {transitioning ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <Send size={13} className="mr-1.5" />}
              {hasQtyEdits ? "Guardar y enviar a Revisor" : "Enviar a Revisor"}
            </Button>
          )}

          {/* ── Revisor / Admin: aprobar ── */}
          {canApproveOrder && (
            <Button size="sm" onClick={handleApprove} disabled={transitioning} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {transitioning ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <ShieldCheck size={13} className="mr-1.5" />}
              {hasQtyEdits ? "Guardar y aprobar pedido" : "Aprobar pedido"}
            </Button>
          )}

          {/* ── Marcar como Enviado al Proveedor ── */}
          {canMarkEnviado && (
            <Button size="sm" variant="outline" disabled={transitioning} onClick={handleMarkEnviado}>
              {transitioning ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <Send size={13} className="mr-1.5" />}
              Marcar como Enviado
            </Button>
          )}

          {/* ── En Tránsito (solo tras confirmación del proveedor revisada) ── */}
          {canMarkTransito && (
            <Button size="sm" variant="outline" disabled={transitioning} onClick={handleMarkTransito}>
              {transitioning ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <PlaneTakeoff size={13} className="mr-1.5" />}
              Marcar En Tránsito
            </Button>
          )}

          {/* ── Pagado ── */}
          {canMarkPagado && (
            <Button size="sm" disabled={transitioning} onClick={() => { setPaidQtyEdits({}); setPaymentRef(""); setShowPaymentModal(true); }} className="bg-violet-600 hover:bg-violet-700 text-white">
              <CreditCard size={13} className="mr-1.5" /> Registrar Pago
            </Button>
          )}

          {/* ── Recibido ── */}
          {canMarkRecibido && (
            <Button size="sm" variant="outline" disabled={transitioning} onClick={handleMarkRecibido}>
              {transitioning ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <PackageCheck size={13} className="mr-1.5" />}
              Marcar como Recibido
            </Button>
          )}

          {/* ── Download ── */}
          {canDownload && (
            <Button
              size="sm" variant="outline"
              onClick={() => {
                const hasReviewed = order.confirmation_status?.startsWith("reviewed");
                if (hasReviewed) generateConfirmationPDF(order, items);
                else generatePurchaseOrderPDF(order, items);
              }}
            >
              <FileDown size={13} className="mr-1.5" />
              {order.confirmation_status?.startsWith("reviewed") ? "Descargar Confirmación" : "Descargar Pedido PDF"}
            </Button>
          )}

          {/* ── Selector de estado (solo admin) ── */}
          {isAdmin && (
            <Select value={order.status} onValueChange={updateStatus}>
              <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          )}

          {/* ── Delete ── */}
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

      {/* Approval info strip */}
      {approvalStatus === "approved" && order.approved_by && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          <ShieldCheck size={14} />
          Aprobado por <strong>{order.approved_by}</strong>
          {order.approved_at && <> el {format(new Date(order.approved_at), "dd MMM yyyy HH:mm", { locale: es })}</>}
        </div>
      )}

      {/* ── Stepper de flujo ── */}
      {order.status !== "cancelado" && (
        <div className="flex items-center gap-0 overflow-x-auto py-1">
          {FLOW_STEPS.map((step, idx) => {
            const stepIdx    = FLOW_STEPS.findIndex(s => s.key === order.status);
            const isDone     = idx < stepIdx;
            const isCurrent  = idx === stepIdx;
            const isNext     = idx > stepIdx;
            return (
              <React.Fragment key={step.key}>
                <div className={`flex flex-col items-center flex-shrink-0 ${idx === 0 ? "" : ""}`}>
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${
                    isDone    ? "bg-primary border-primary text-white" :
                    isCurrent ? "bg-primary/15 border-primary text-primary" :
                                "bg-muted border-border text-muted-foreground"
                  }`}>
                    {isDone ? <Check size={10} /> : idx + 1}
                  </div>
                  <span className={`text-[9px] mt-0.5 whitespace-nowrap font-medium ${isCurrent ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                </div>
                {idx < FLOW_STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 min-w-[16px] mx-1 mb-3.5 rounded ${isDone ? "bg-primary" : "bg-border"}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Strip de pago */}
      {order.status === "pagado" && order.paid_at && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-800">
          <DollarSign size={14} />
          Pago registrado por <strong>{order.paid_by}</strong>
          {order.paid_at && <> el {format(new Date(order.paid_at), "dd MMM yyyy HH:mm", { locale: es })}</>}
          {order.payment_reference && <> · Ref: <strong>{order.payment_reference}</strong></>}
        </div>
      )}

      {/* Status banner for comercial when pending approval */}
      {isComercial && ["pending_ic", "pending_review"].includes(approvalStatus) && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <AlertTriangle size={14} />
          {approvalStatus === "pending_ic"
            ? "Este pedido está siendo revisado por el equipo de Inteligencia Comercial."
            : "Este pedido está en revisión final. Recibirás una notificación cuando sea aprobado."}
        </div>
      )}

      {/* Banner: esperando confirmación del proveedor */}
      {isComercial && order.status === "enviado" && !order.confirmation_status?.startsWith("reviewed") && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
          <Truck size={14} />
          Pedido enviado al proveedor. Cuando recibas su confirmación, súbela en la pestaña <strong className="mx-1">Confirmación Proveedor</strong> para continuar.
        </div>
      )}

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
          {(isAdmin || isAnalista || isRevisor) && <p className="text-[10px] text-muted-foreground">por {order.created_by}</p>}
        </Card>
      </div>

      {/* Fechas clave — alimentan la agenda "Hoy" del Dashboard */}
      {!["recibido", "cancelado"].includes(order.status) && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CalendarClock size={14} className="text-primary" /> Fechas clave
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1.5"><CreditCard size={12} /> Fecha límite de pago</Label>
              <Input
                type="date"
                value={keyDates.fecha_limite_pago}
                onChange={e => setKeyDates(p => ({ ...p, fecha_limite_pago: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1.5"><PlaneTakeoff size={12} /> Fecha estimada de llegada</Label>
              <Input
                type="date"
                value={keyDates.fecha_estimada_llegada}
                onChange={e => setKeyDates(p => ({ ...p, fecha_estimada_llegada: e.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button
              size="sm"
              disabled={savingDates ||
                (keyDates.fecha_limite_pago === (order.fecha_limite_pago || "") &&
                 keyDates.fecha_estimada_llegada === (order.fecha_estimada_llegada || ""))}
              onClick={handleSaveKeyDates}
            >
              <Save size={13} className="mr-1.5" />
              {savingDates ? "Guardando..." : "Guardar fechas"}
            </Button>
          </div>
        </Card>
      )}

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
          {["pagado", "recibido", "parcialmente_recibido"].includes(order.status) && (
            <TabsTrigger value="pago" className="text-xs">
              <DollarSign size={13} className="mr-1" /> Cantidades Pagadas
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Lines Tab ── */}
        <TabsContent value="lines">
          <Card className="p-4">
            {canEditQty && (
              <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Edit3 size={13} className="text-primary" />
                  <span>
                    {isAnalista ? "Revisa y ajusta las cantidades finales antes de enviar al Revisor." : "Revisa y ajusta las cantidades finales antes de aprobar."}
                  </span>
                </div>
                {hasQtyEdits && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary">
                    {Object.keys(qtyEdits).length} cantidad(es) modificada(s) — se guardarán al continuar
                  </Badge>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {hasPackItems ? "Detalle por Producto Interno" : "Líneas del Pedido"}
              </h3>
              <div className="flex items-center gap-2">
                {manualOverrides.length > 0 && (
                  <Badge variant="outline" className="text-xs text-warning border-warning">
                    <AlertTriangle size={10} className="mr-1" /> {manualOverrides.length} ajuste(s) manual(es)
                  </Badge>
                )}
                {hasPackItems && (
                  <button
                    onClick={() => setShowSupplierView(v => !v)}
                    className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-800 transition-colors"
                  >
                    <Package size={11} />
                    Vista proveedor
                    {showSupplierView ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </button>
                )}
              </div>
            </div>

            {/* ── Vista Proveedor (toggle) ── */}
            {hasPackItems && showSupplierView && (
              <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Cód. Proveedor</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nombre Proveedor</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cant. Total</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Precio Unit.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Subtotal</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-[10px]">Productos internos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierGroups.map(group => {
                        const totalQty = group.items.reduce((s, i) => {
                          const eq = qtyEdits[i.id];
                          return s + (eq != null ? eq : (i.final_qty || 0));
                        }, 0);
                        const subtotal = totalQty * group.unit_cost;
                        const isMulti  = group.items.length > 1;
                        return (
                          <tr key={group.key} className={`border-b border-border/50 last:border-0 ${isMulti ? "bg-blue-50/40 dark:bg-blue-900/10" : ""}`}>
                            <td className="px-3 py-2.5 font-mono font-semibold text-primary">
                              {group.supplier_product_code || "—"}
                            </td>
                            <td className="px-3 py-2.5 max-w-[200px]">
                              <p className="font-medium truncate">{group.supplier_product_name || "—"}</p>
                              {isMulti && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1 py-0.5 rounded font-medium">
                                  Pack ×{group.items.length}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-bold text-lg">{totalQty}</td>
                            <td className="px-3 py-2.5 text-right">{group.currency} {group.unit_cost.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold">{group.currency} {subtotal.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-muted-foreground max-w-[220px]">
                              {group.items.map(i => {
                                const q = qtyEdits[i.id] ?? i.final_qty ?? 0;
                                return (
                                  <div key={i.id} className="truncate text-[10px]">
                                    {i.internal_product_codigo || i.internal_product_code} × {q}
                                  </div>
                                );
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/30">
                        <td colSpan={4} className="px-3 py-2 text-right font-semibold text-sm">Total al proveedor:</td>
                        <td className="px-3 py-2 font-bold text-sm">
                          {order.currency || "USD"} {supplierGroups.reduce((s, g) => {
                            const totalQty = g.items.reduce((ss, i) => ss + (qtyEdits[i.id] ?? i.final_qty ?? 0), 0);
                            return s + totalQty * g.unit_cost;
                          }, 0).toFixed(2)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {["Cód. Proveedor", "Producto", "Unidad", "Stock actual", "Sugerido", "Cant. Final", "Precio unit.", "Subtotal", "Ajuste"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const isOverride    = item.suggested_qty !== item.final_qty;
                    const editedQty     = qtyEdits[item.id];
                    const displayQty    = editedQty != null ? editedQty : item.final_qty;
                    const displaySub    = editedQty != null ? editedQty * (item.unit_cost || 0) : (item.subtotal || 0);
                    const packMultiple  = item.pack_multiple ?? 1;
                    const minQty        = item.min_qty ?? 1;
                    const multWarn      = packMultiple > 1 && (displayQty || 0) > 0 && (displayQty || 0) % packMultiple !== 0;
                    const minWarn       = (displayQty || 0) > 0 && (displayQty || 0) < minQty;
                    const hasWarn       = multWarn || minWarn;
                    return (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-mono text-primary font-semibold">
                          {item.supplier_product_code || item.internal_product_code || "—"}
                          {item.supplier_product_code && item.internal_product_code && (
                            <p className="text-[10px] font-mono text-muted-foreground font-normal">{item.internal_product_code}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 max-w-[180px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-medium truncate">{item.product_name}</p>
                            {item.is_new_product && (
                              <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded font-semibold shrink-0">NUEVO</span>
                            )}
                          </div>
                          {item.supplier_product_name && item.supplier_product_name !== item.product_name && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.supplier_product_name}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">{item.unit || "—"}</td>
                        <td className="px-3 py-2.5">{item.current_stock ?? "—"}</td>
                        <td className="px-3 py-2.5 text-blue-500">{item.suggested_qty ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          {canEditQty ? (
                            <div className="flex flex-col gap-0.5">
                              <input
                                type="number"
                                min={0}
                                step={packMultiple > 1 ? packMultiple : 1}
                                value={displayQty ?? ""}
                                onFocus={e => e.target.select()}
                                onChange={e => {
                                  const raw = e.target.value;
                                  if (raw === "") {
                                    setQtyEdits(prev => ({ ...prev, [item.id]: 0 }));
                                    return;
                                  }
                                  const v = parseInt(raw, 10);
                                  if (!isNaN(v) && v >= 0) {
                                    setQtyEdits(prev => {
                                      const next = { ...prev };
                                      if (v === (item.final_qty ?? 0)) {
                                        delete next[item.id];
                                      } else {
                                        next[item.id] = v;
                                      }
                                      return next;
                                    });
                                  }
                                }}
                                className={`w-20 h-7 px-2 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary ${hasWarn ? "border-orange-400" : "border-input"}`}
                              />
                              {multWarn && <span className="text-orange-500 text-[10px]">Múlt: {packMultiple}</span>}
                              {minWarn  && <span className="text-orange-500 text-[10px]">Mín: {minQty}</span>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className={`font-bold ${isOverride ? "text-primary" : ""}`}>{displayQty}</span>
                              {isOverride && <CheckCircle2 size={11} className="text-primary" />}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">{item.currency || order.currency} {(item.unit_cost || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 font-semibold">{item.currency || order.currency} {displaySub.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground italic">{item.override_reason || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={7} className="px-3 py-2.5 text-right font-semibold text-sm">Total:</td>
                    <td className="px-3 py-2.5 font-bold text-sm">
                      {order.currency || "USD"} {items.reduce((s, i) => {
                        const eq = qtyEdits[i.id];
                        return s + (eq != null ? eq * (i.unit_cost || 0) : (i.subtotal || 0));
                      }, 0).toFixed(2)}
                    </td>
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
            {/* Only comercial (after approval) or admin can interact with confirmation */}
            {!isComercial && !isAdmin ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <ClipboardCheck size={28} className="mx-auto mb-2 opacity-30" />
                La confirmación del proveedor es gestionada por el Comercial.
              </div>
            ) : !hasConfirmation ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Confirmación del Proveedor</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sube el archivo que el proveedor envió con las cantidades confirmadas.
                  </p>
                </div>
                {canEditConfirmation ? (
                  <SupplierConfirmationImporter
                    orderId={order.id}
                    orderItems={items}
                    onImported={() => {
                      queryClient.invalidateQueries({ queryKey: ["purchase-order-items", id] });
                      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
                    }}
                  />
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    {approvalStatus !== "approved"
                      ? "Disponible una vez que el pedido sea aprobado."
                      : "La confirmación solo se puede subir mientras el pedido está en estado «Enviado al Proveedor»."}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Diferencias con la confirmación del proveedor</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Revisa cada ítem y decide si aceptas la cantidad confirmada.</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    {canEditConfirmation ? (
                      <>
                        <Button size="sm" variant="outline" className="text-xs"
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
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-muted-foreground/60" />
                        Confirmación cerrada · solo lectura
                      </span>
                    )}
                  </div>
                </div>

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
                              ) : <span className="text-muted-foreground italic">—</span>}
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
                              {!hasConf ? <span className="text-[10px] text-muted-foreground italic">Sin confirmar</span>
                                : diff === 0 ? <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Sin cambio</Badge>
                                : diff < 0 ? <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-600 border-red-200">↓ Reducida</Badge>
                                : <Badge className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 border-blue-200">↑ Aumentada</Badge>}
                            </td>
                            <td className="px-3 py-2.5">
                              {!hasConf
                                ? <span className="text-[10px] text-muted-foreground text-center block">—</span>
                                : canEditConfirmation
                                  ? (
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
                                  )
                                  : (
                                    <div className="text-center">
                                      {dec === "accepted" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">Aceptado</span>}
                                      {dec === "rejected" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Rechazado</span>}
                                      {dec === "pending"  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 font-medium">Pendiente</span>}
                                    </div>
                                  )
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {canEditConfirmation && (
                  <Button
                    onClick={handleSaveDecisions}
                    disabled={savingDecisions || !allDecided}
                    className="w-full"
                  >
                    <RefreshCw size={14} className={`mr-2 ${savingDecisions ? "animate-spin" : ""}`} />
                    {savingDecisions ? "Guardando..." : allDecided ? "Guardar Decisiones" : `Guardar (faltan ${confirmedItems.filter(i => (localDecisions[i.id] || "pending") === "pending").length} por decidir)`}
                  </Button>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Pago Tab ── */}
        <TabsContent value="pago">
          <Card className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <DollarSign size={14} className="text-violet-600" /> Cantidades Reales Pagadas
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comparación entre lo pedido y lo que efectivamente fue pagado.
              </p>
            </div>
            {order.paid_at && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <CreditCard size={12} className="text-violet-500" />
                Registrado por <strong>{order.paid_by}</strong> · {format(new Date(order.paid_at), "dd MMM yyyy HH:mm", { locale: es })}
                {order.payment_reference && <> · Ref: <strong className="text-foreground">{order.payment_reference}</strong></>}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Producto</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Cant. Pedida</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Cant. Pagada</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Diferencia</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Subtotal Pagado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const paid = item.paid_qty ?? item.final_qty;
                    const diff = paid - item.final_qty;
                    return (
                      <tr key={item.id} className={`border-b border-border/50 last:border-0 hover:bg-muted/20 ${diff !== 0 ? "bg-amber-50/40" : ""}`}>
                        <td className="px-3 py-2.5 max-w-[200px]">
                          <p className="font-medium truncate">{item.product_name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{item.internal_product_code || "—"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right">{item.final_qty}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-bold ${diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "text-foreground"}`}>{paid}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {diff !== 0 ? (
                            <span className={`font-semibold ${diff < 0 ? "text-destructive" : "text-success"}`}>
                              {diff > 0 ? "+" : ""}{diff}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {item.currency || order.currency} {(paid * (item.unit_cost || 0)).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={4} className="px-3 py-2.5 text-right font-semibold text-sm">Total pagado:</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-violet-700">
                      {order.currency || "USD"} {items.reduce((s, i) => s + ((i.paid_qty ?? i.final_qty) * (i.unit_cost || 0)), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <EditOrderDialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        order={order}
        items={items}
      />

      {/* ── Modal Registrar Pago ── */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent style={{ maxWidth: "min(700px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard size={16} className="text-violet-600" /> Registrar Pago del Pedido
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Referencia / N° de Factura</Label>
              <Input
                placeholder="Ej: FAC-2026-0341, Transferencia #..."
                value={paymentRef}
                onChange={e => setPaymentRef(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Cantidades reales pagadas por ítem</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Si la cantidad pagada difiere de la pedida, corrige el valor. Las diferencias quedan registradas para control de facturación.
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Producto</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Cant. Pedida</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground whitespace-nowrap">Cant. Pagada Real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const edited       = paidQtyEdits[item.id];
                      const display      = edited ?? item.final_qty;
                      const changed      = edited != null && edited !== item.final_qty;
                      const packMultiple = item.pack_multiple ?? 1;
                      const minQty       = item.min_qty ?? 1;
                      const multWarn     = packMultiple > 1 && (display || 0) > 0 && (display || 0) % packMultiple !== 0;
                      const minWarn      = (display || 0) > 0 && (display || 0) < minQty;
                      const hasWarn      = multWarn || minWarn;
                      return (
                        <tr key={item.id} className={`border-b border-border/50 last:border-0 ${changed ? "bg-amber-50/60" : ""}`}>
                          <td className="px-3 py-2 max-w-[200px]">
                            <p className="font-medium truncate">{item.product_name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{item.supplier_product_code || item.internal_product_code || "—"}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{item.final_qty}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-0.5 items-center">
                              <input
                                type="number"
                                min={0}
                                step={packMultiple > 1 ? packMultiple : 1}
                                value={display}
                                onFocus={e => e.target.select()}
                                onChange={e => {
                                  const raw = e.target.value;
                                  if (raw === "") return;
                                  const v = parseInt(raw, 10);
                                  if (!isNaN(v) && v >= 0) {
                                    setPaidQtyEdits(prev => {
                                      const next = { ...prev };
                                      if (v === item.final_qty) delete next[item.id];
                                      else next[item.id] = v;
                                      return next;
                                    });
                                  }
                                }}
                                className={`w-24 h-7 px-2 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary block ${hasWarn ? "border-orange-400" : changed ? "border-amber-400 bg-amber-50" : "border-input"}`}
                              />
                              {multWarn && <span className="text-orange-500 text-[10px]">Múlt: {packMultiple}</span>}
                              {minWarn  && <span className="text-orange-500 text-[10px]">Mín: {minQty}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {Object.keys(paidQtyEdits).length > 0 && (
                <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                  <AlertTriangle size={11} /> {Object.keys(paidQtyEdits).length} ítem(s) con cantidad diferente a la pedida — quedarán registradas las discrepancias.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-3 border-t border-border mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowPaymentModal(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleSavePayment} disabled={savingPayment} className="bg-violet-600 hover:bg-violet-700 text-white">
              {savingPayment
                ? <><RefreshCw size={13} className="mr-1.5 animate-spin" /> Guardando...</>
                : <><DollarSign size={13} className="mr-1.5" /> Confirmar Pago</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
