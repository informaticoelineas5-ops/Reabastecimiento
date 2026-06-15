import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Save, AlertTriangle } from "lucide-react";

export default function EditOrderDialog({ open, onClose, order, items }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [orderForm, setOrderForm] = useState({});
  const [itemForms, setItemForms] = useState([]);

  useEffect(() => {
    if (order) {
      setOrderForm({
        supplier_name: order.supplier_name || "",
        currency:      order.currency || "USD",
        exchange_rate: order.exchange_rate || 1,
      });
    }
  }, [order]);

  useEffect(() => {
    if (items) {
      setItemForms(items.map(i => ({
        id:                    i.id,
        product_name:          i.product_name || "",
        internal_product_code: i.internal_product_code || "",
        final_qty:             i.final_qty ?? 0,
        unit_cost:             i.unit_cost ?? 0,
        status:                i.status || "included",
      })));
    }
  }, [items]);

  const updateItem = (id, field, value) => {
    setItemForms(prev => prev.map(it => {
      if (it.id !== id) return it;
      const updated = { ...it, [field]: value };
      if (field === "final_qty" || field === "unit_cost") {
        updated.subtotal = (parseFloat(updated.final_qty) || 0) * (parseFloat(updated.unit_cost) || 0);
      }
      return updated;
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    // Save order header
    await base44.entities.PurchaseOrder.update(order.id, {
      supplier_name:  orderForm.supplier_name,
      currency:       orderForm.currency,
      exchange_rate:  parseFloat(orderForm.exchange_rate) || 1,
    });

    // Save each item
    await Promise.all(itemForms.map(it =>
      base44.entities.PurchaseOrderItem.update(it.id, {
        product_name:          it.product_name,
        internal_product_code: it.internal_product_code,
        final_qty:             parseFloat(it.final_qty) || 0,
        unit_cost:             parseFloat(it.unit_cost) || 0,
        status:                it.status,
      })
    ));

    queryClient.invalidateQueries({ queryKey: ["purchase-order", order.id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-order-items", order.id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    setSaving(false);
    toast({ title: "Pedido actualizado correctamente" });
    onClose();
  };

  const F = ({ label, value, onChange, type = "text", className = "" }) => (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Pedido #{order?.id?.slice(-6)?.toUpperCase()}</DialogTitle>
        </DialogHeader>

        {/* Order Header */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Datos del Pedido</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <F label="Proveedor *" value={orderForm.supplier_name || ""} onChange={v => setOrderForm(p => ({ ...p, supplier_name: v }))} className="col-span-2 md:col-span-1" />
            <F label="Moneda" value={orderForm.currency || ""} onChange={v => setOrderForm(p => ({ ...p, currency: v }))} />
            <F label="Tasa de cambio" value={orderForm.exchange_rate || ""} onChange={v => setOrderForm(p => ({ ...p, exchange_rate: v }))} type="number" />
          </div>
        </div>

        {/* Items */}
        <div className="space-y-3 mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Líneas del Pedido ({itemForms.length})</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    {["Código", "Producto", "Cantidad", "Precio unit.", "Subtotal", "Estado"].map(h => (
                      <th key={h} className="px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemForms.map((it, idx) => {
                    const subtotal = (parseFloat(it.final_qty) || 0) * (parseFloat(it.unit_cost) || 0);
                    return (
                      <tr key={it.id} className={`border-b border-border/50 ${it.status === "excluded" ? "opacity-50 bg-muted/20" : idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-2 py-1.5">
                          <Input value={it.internal_product_code} onChange={e => updateItem(it.id, "internal_product_code", e.target.value)} className="h-6 text-xs w-24 font-mono" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={it.product_name} onChange={e => updateItem(it.id, "product_name", e.target.value)} className="h-6 text-xs min-w-[160px]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input type="number" value={it.final_qty} onChange={e => updateItem(it.id, "final_qty", e.target.value)} className="h-6 text-xs w-20 text-center" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input type="number" value={it.unit_cost} onChange={e => updateItem(it.id, "unit_cost", e.target.value)} className="h-6 text-xs w-24" />
                        </td>
                        <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                          {subtotal.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={it.status}
                            onChange={e => updateItem(it.id, "status", e.target.value)}
                            className="h-6 text-xs border border-input rounded px-1 bg-background"
                          >
                            <option value="included">Incluido</option>
                            <option value="excluded">Excluido</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 border-t-2 border-border">
                    <td colSpan={3} className="px-2 py-2 text-right text-xs font-semibold">Total estimado:</td>
                    <td className="px-2 py-2 font-bold text-sm">
                      {orderForm.currency || "USD"} {itemForms.filter(i => i.status !== "excluded").reduce((s, i) => s + (parseFloat(i.final_qty) || 0) * (parseFloat(i.unit_cost) || 0), 0).toFixed(2)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle size={11} className="text-warning" />
            Los cambios aquí serán guardados inmediatamente. Ajuste cantidades y precios antes de aprobar.
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={13} className="mr-1.5" />
            {saving ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}