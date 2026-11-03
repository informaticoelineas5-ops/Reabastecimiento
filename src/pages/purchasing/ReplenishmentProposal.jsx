import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { finalizePurchaseOrder } from "@/api/reabApiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Zap, ShoppingCart, AlertTriangle, CheckCircle, XCircle, Minus } from "lucide-react";

const STATUS_COLORS = {
  pendiente: "bg-gray-100 text-gray-600",
  sugerido: "bg-blue-100 text-blue-700",
  aprobado: "bg-green-100 text-green-700",
  ajustado_manual: "bg-yellow-100 text-yellow-700",
  descartado: "bg-red-100 text-red-600",
  enviado_pedido: "bg-purple-100 text-purple-700",
};

function roundToMultiple(qty, multiple) {
  if (!multiple || multiple <= 1) return qty;
  return Math.ceil(qty / multiple) * multiple;
}

export default function ReplenishmentProposal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const offerId = params.get("offer_id");

  const [user, setUser] = useState(null);
  const [lines, setLines] = useState([]);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const { data: offer } = useQuery({
    queryKey: ["supplier-offer", offerId],
    queryFn: () => base44.entities.SupplierOffer.filter({ id: offerId }),
    select: d => d[0], enabled: !!offerId,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["offer-matches", offerId],
    queryFn: () => base44.entities.SupplierOfferItemMatch.filter({ offer_id: offerId }, "-created_date", 500),
    enabled: !!offerId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["offer-items", offerId],
    queryFn: () => base44.entities.SupplierOfferItem.filter({ offer_id: offerId }, "row_index", 500),
    enabled: !!offerId,
  });

  const { data: internalOffers = [] } = useQuery({
    queryKey: ["offers-for-proposal"],
    queryFn: () => base44.entities.Offer.list("-updated_date", 500),
  });

  const { data: existingProposal = [] } = useQuery({
    queryKey: ["proposal-items", offerId],
    queryFn: () => base44.entities.ReplenishmentProposalItem.filter({ offer_id: offerId }, "-created_date", 500),
    enabled: !!offerId,
  });

  const itemMap = useMemo(() => {
    const m = {};
    items.forEach(i => { m[i.id] = i; });
    return m;
  }, [items]);

  const internalOfferMap = useMemo(() => {
    const m = {};
    internalOffers.forEach(io => { m[io.id] = io; });
    return m;
  }, [internalOffers]);

  // Initialize lines from existing proposal or generate new
  useEffect(() => {
    if (existingProposal.length > 0 && !generated) {
      setLines(existingProposal.map(p => ({ ...p, _dirty: false })));
      setGenerated(true);
    }
  }, [existingProposal]);

  const generateProposal = async () => {
    if (matches.length === 0) {
      toast({ title: "No hay productos asociados. Asocia primero.", variant: "destructive" }); return;
    }
    setGenerating(true);

    // Count how many internal products share each offer_item_id (for pack detection)
    const matchesPerItem = {};
    matches.forEach(m => { matchesPerItem[m.offer_item_id] = (matchesPerItem[m.offer_item_id] || 0) + 1; });

    const newLines = matches.map(match => {
      const offerItem     = itemMap[match.offer_item_id];
      const internalOffer = internalOfferMap[match.internal_product_id];

      const currentStock = internalOffer?.existencia_fisica || 0;
      const minimumStock = internalOffer?.store_min_kontrol || 0;
      const idealStock   = Math.max(minimumStock * 2, minimumStock + 10);
      const need         = Math.max(0, idealStock - currentStock);
      const suggested    = offerItem ? roundToMultiple(Math.max(need, offerItem.min_qty || 1), offerItem.pack_multiple || 1) : need;
      const isPackItem   = (matchesPerItem[match.offer_item_id] || 1) > 1;

      return {
        offer_id: offerId,
        offer_item_id: match.offer_item_id,
        match_id: match.id,
        imported_by: user?.email,
        internal_product_id: match.internal_product_id,
        internal_product_codigo: match.internal_product_codigo,
        internal_product_nombre: match.internal_product_nombre,
        supplier_product_code: offerItem?.supplier_product_code || null,
        supplier_product_name: offerItem?.supplier_product_name || null,
        is_pack_item: isPackItem,
        current_stock: currentStock,
        minimum_stock: minimumStock,
        ideal_stock: idealStock,
        estimated_demand: 0,
        suggested_qty: suggested,
        final_qty: suggested,
        offered_cost: offerItem?.offered_cost || 0,
        currency: offerItem?.currency || offer?.default_currency || "USD",
        min_qty: offerItem?.min_qty || 1,
        pack_multiple: offerItem?.pack_multiple || 1,
        selection_status: suggested > 0 ? "sugerido" : "pendiente",
        _dirty: true,
      };
    });

    setLines(newLines);
    setGenerated(true);
    setGenerating(false);
  };

  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const updated = [...prev];
      const line = { ...updated[idx], [field]: value, _dirty: true };
      if (field === "final_qty") {
        const v = parseFloat(value) || 0;
        if (v === 0) line.selection_status = "descartado";
        else if (v !== line.suggested_qty) line.selection_status = "ajustado_manual";
        else line.selection_status = "aprobado";
        line.decided_by = user?.email;
        line.decided_at = new Date().toISOString();
      }
      updated[idx] = line;
      return updated;
    });
  };

  const toggleDiscard = (idx) => {
    setLines(prev => {
      const updated = [...prev];
      const line = { ...updated[idx], _dirty: true };
      line.selection_status = line.selection_status === "descartado" ? "aprobado" : "descartado";
      if (line.selection_status === "descartado") line.final_qty = 0;
      else line.final_qty = line.suggested_qty;
      updated[idx] = line;
      return updated;
    });
  };

  const validateLine = (line) => {
    const warnings = [];
    if (line.final_qty > 0 && line.min_qty > 1 && line.final_qty < line.min_qty)
      warnings.push(`Mínimo de compra: ${line.min_qty}`);
    if (line.final_qty > 0 && line.pack_multiple > 1 && line.final_qty % line.pack_multiple !== 0)
      warnings.push(`Múltiplo de compra: ${line.pack_multiple} (próximo: ${roundToMultiple(line.final_qty, line.pack_multiple)})`);
    return warnings;
  };

  const saveProposal = async () => {
    setSaving(true);
    for (const line of lines) {
      if (!line._dirty) continue;
      if (line.id) {
        await base44.entities.ReplenishmentProposalItem.update(line.id, {
          final_qty: line.final_qty,
          selection_status: line.selection_status,
          manual_override_reason: line.manual_override_reason,
          decided_by: user?.email,
          decided_at: new Date().toISOString(),
        });
      } else {
        const { _dirty, ...data } = line;
        await base44.entities.ReplenishmentProposalItem.create({ ...data, decided_by: user?.email, decided_at: new Date().toISOString() });
      }
    }
    queryClient.invalidateQueries(["proposal-items", offerId]);
    setSaving(false);
    toast({ title: "Propuesta guardada correctamente" });
  };

  const generatePO = async () => {
    const selectedLines = lines.filter(l => l.selection_status !== "descartado" && l.final_qty > 0);
    if (selectedLines.length === 0) { toast({ title: "No hay líneas seleccionadas para pedir", variant: "destructive" }); return; }

    setSaving(true);
    const total = selectedLines.reduce((sum, l) => sum + (l.final_qty * (l.offered_cost || 0)), 0);
    const po = await base44.entities.PurchaseOrder.create({
      order_number: `PO-${Date.now()}`,
      supplier_name: offer?.supplier_name,
      offer_id: offerId,
      offer_name: offer?.offer_name,
      created_by: user?.email,
      status: "borrador",
      total_amount: total,
      currency: offer?.default_currency || "USD",
      exchange_rate: offer?.exchange_rate || 1,
      total_amount_base: total * (offer?.exchange_rate || 1),
    });

    await base44.entities.PurchaseOrderItem.bulkCreate(
      selectedLines.map(l => ({
        purchase_order_id: po.id,
        offer_item_id: l.offer_item_id,
        internal_product_id: l.internal_product_id,
        internal_product_code: l.internal_product_codigo,
        product_name: l.internal_product_nombre || l.supplier_product_name || l.supplier_product_code || "Producto",
        supplier_product_code: l.supplier_product_code || null,
        supplier_product_name: l.supplier_product_name || null,
        unit_cost: l.offered_cost || 0,
        currency: l.currency,
        final_qty: l.final_qty,
        suggested_qty: l.suggested_qty,
        current_stock: l.current_stock,
        min_qty: l.min_qty,
        pack_multiple: l.pack_multiple,
        status: "included",
      }))
    );

    await finalizePurchaseOrder(po.id, "borrador");

    // Update proposal items status
    for (const l of selectedLines) {
      if (l.id) await base44.entities.ReplenishmentProposalItem.update(l.id, { selection_status: "enviado_pedido", purchase_order_id: po.id });
    }

    setSaving(false);
    toast({ title: `Pedido generado: ${selectedLines.length} líneas, total ${total.toFixed(2)} ${offer?.default_currency}` });
    navigate(`/PurchaseOrders`);
  };

  const selectedCount = lines.filter(l => l.selection_status !== "descartado" && l.final_qty > 0).length;
  const total = lines.filter(l => l.selection_status !== "descartado" && l.final_qty > 0)
    .reduce((s, l) => s + (l.final_qty * (l.offered_cost || 0)), 0);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1300px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/OfferDetail?id=${offerId}`)}>
          <ArrowLeft size={15} />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Propuesta de Reabastecimiento</h1>
          <p className="text-xs text-muted-foreground">{offer?.offer_name} — {offer?.supplier_name}</p>
        </div>
        <div className="flex gap-2 items-center">
          {!generated && (
            <Button onClick={generateProposal} disabled={generating}>
              <Zap size={13} className="mr-1" /> {generating ? "Generando..." : "Generar Propuesta"}
            </Button>
          )}
          {generated && (
            <>
              <Button variant="outline" onClick={saveProposal} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
              <Button onClick={generatePO} disabled={saving || selectedCount === 0}>
                <ShoppingCart size={13} className="mr-1" /> Generar Pedido ({selectedCount})
              </Button>
            </>
          )}
        </div>
      </div>

      {generated && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3"><p className="text-xs text-muted-foreground">Total líneas</p><p className="text-2xl font-bold">{lines.length}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">Seleccionadas</p><p className="text-2xl font-bold text-green-600">{selectedCount}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">Descartadas</p><p className="text-2xl font-bold text-red-500">{lines.filter(l => l.selection_status === "descartado").length}</p></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">Total estimado</p><p className="text-xl font-bold">{total.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">{offer?.default_currency}</span></p></Card>
        </div>
      )}

      {!generated && (
        <Card className="p-10 text-center">
          <Zap size={32} className="mx-auto mb-3 text-primary/40" />
          <p className="text-sm text-muted-foreground mb-2">Genera la propuesta automática basada en el stock actual y las asociaciones realizadas.</p>
          <p className="text-xs text-muted-foreground">{matches.length} productos asociados disponibles</p>
        </Card>
      )}

      {generated && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Producto</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Cód. Proveedor</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Stock</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Mín</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Ideal</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-blue-600">Sugerido</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Min/Múlt</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Precio</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-green-700">Cantidad Final ✏️</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Subtotal</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">Estado</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const warnings = validateLine(line);
                  const isDiscarded = line.selection_status === "descartado";
                  const subtotal = line.final_qty * (line.offered_cost || 0);
                  return (
                    <tr key={idx} className={`border-t border-border ${isDiscarded ? "opacity-40" : ""} ${line.is_pack_item ? "bg-blue-50/30 dark:bg-blue-900/10" : ""}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{line.internal_product_codigo}</span>
                          {line.is_pack_item && (
                            <span className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-1 py-0.5 rounded font-medium flex-shrink-0">PACK</span>
                          )}
                        </div>
                        <div className="text-muted-foreground truncate max-w-[160px]">{line.internal_product_nombre}</div>
                      </td>
                      <td className="px-3 py-2">
                        {line.supplier_product_code
                          ? <span className="font-mono text-xs text-muted-foreground">{line.supplier_product_code}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{line.current_stock}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{line.minimum_stock}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{line.ideal_stock}</td>
                      <td className="px-3 py-2 text-right text-blue-600 font-semibold">{line.suggested_qty}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{line.min_qty} / ×{line.pack_multiple}</td>
                      <td className="px-3 py-2 text-right">{line.offered_cost > 0 ? `${line.offered_cost} ${line.currency}` : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min="0"
                            className={`w-24 h-7 text-right text-sm font-semibold ${line.final_qty !== line.suggested_qty ? "border-yellow-400" : ""}`}
                            value={line.final_qty}
                            onChange={e => updateLine(idx, "final_qty", parseFloat(e.target.value) || 0)}
                            disabled={isDiscarded}
                          />
                          {warnings.map((w, wi) => (
                            <div key={wi} className="flex items-center gap-1 text-orange-600">
                              <AlertTriangle size={10} />
                              <span className="text-[10px]">{w}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{isDiscarded ? "—" : `${subtotal.toFixed(2)}`}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[line.selection_status] || ""}`}>
                          {line.selection_status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="sm" onClick={() => toggleDiscard(idx)} className="h-6 w-6 p-0">
                          {isDiscarded ? <CheckCircle size={13} className="text-green-500" /> : <Minus size={13} className="text-red-500" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}