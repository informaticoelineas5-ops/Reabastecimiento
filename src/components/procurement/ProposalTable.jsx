import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Info, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { fetchSalesIndices } from "@/api/salesIndicesClient";

const DIAS_MIN_OPTIONS = [7, 15, 30, 45, 60];
const DIAS_MAX_OPTIONS = [45, 60, 90, 120];

function ceilToMultiple(value, multiple) {
  if (!multiple || multiple <= 1) return Math.ceil(value);
  return Math.ceil(value / multiple) * multiple;
}

function calcEstadoStock(ef, stockMin, stockMax, indice) {
  if (!indice || indice === 0) return "SIN VENTAS";
  if (ef === 0)       return "AGOTADO";
  if (ef <= stockMin) return "DÉFICIT";
  if (ef > stockMax)  return "EXCESO";
  return "GARANTIZADO";
}

const ESTADO_STYLES = {
  "AGOTADO":    "bg-red-100 text-red-700 border-red-200",
  "DÉFICIT":    "bg-orange-100 text-orange-700 border-orange-200",
  "GARANTIZADO":"bg-green-100 text-green-700 border-green-200",
  "EXCESO":     "bg-blue-100 text-blue-600 border-blue-200",
  "SIN VENTAS": "bg-gray-100 text-gray-500 border-gray-200",
};

function getSuggestedStyle(qty) {
  if (qty > 0) return "bg-teal-50 text-teal-700 border border-teal-200 font-bold";
  if (qty < 0) return "bg-red-50 text-red-600 border border-red-200 font-bold";
  return "text-muted-foreground";
}

function getWarnings(qty, minQty, packMultiple) {
  const w = [];
  if (qty > 0 && qty < minQty) w.push(`Mín: ${minQty}`);
  if (packMultiple > 1 && qty > 0 && qty % packMultiple !== 0) w.push(`Múlt: ${packMultiple}`);
  return w;
}

// Muestra solo el número entre paréntesis del almacén, excepto excepciones conocidas
const ALMACEN_FULL_NAMES = ["latino", "mérida", "merida", "insumos"];
function formatAlmacen(name) {
  if (!name || name === "—") return name;
  if (ALMACEN_FULL_NAMES.some(k => name.toLowerCase().includes(k))) return name;
  const m = name.match(/\((\d+)\)/);
  return m ? m[1] : name;
}

export default function ProposalTable({ offer, matches, offerItems, internalOffers, onOrderCreated }) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const { user }    = useProcurementUser();

  const [diasMin, setDiasMin] = useState(30);
  const [diasMax, setDiasMax] = useState(90);
  const [creating, setCreating] = useState(false);

  const { data: salesMap = new Map(), isFetching: loadingSales } = useQuery({
    queryKey:  ["sales-indices-db"],
    queryFn:   fetchSalesIndices,
    staleTime: 30 * 60 * 1000,
  });

  const rows = useMemo(() => {
    return matches
      .filter((m) => m.status === "confirmed")
      .map((match) => {
        const item     = offerItems.find((i) => i.id === match.offer_item_id);
        const internal = internalOffers.get
          ? internalOffers.get(String(match.internal_offer_id))
          : internalOffers.find?.((o) => o.id === match.internal_offer_id);

        const ef        = internal?.cantidad ?? internal?.existencia_fisica ?? 0;
        const extId     = String(match.internal_offer_id ?? "");
        const salesData = extId ? salesMap.get(extId) : null;
        const indice    = salesData?.indiceAvg ?? 0;

        const minQty       = item?.min_qty      ?? 1;
        const packMultiple = item?.pack_multiple ?? 1;
        const upc          = packMultiple > 1 ? packMultiple : 1;

        const stockMin = indice > 0 ? ceilToMultiple(indice * diasMin, upc) : 0;
        const stockMax = indice > 0 ? ceilToMultiple(indice * diasMax, upc) : 0;

        const estadoStock = calcEstadoStock(ef, stockMin, stockMax, indice);

        // Propuesta sin clamp — permite negativo (exceso) igual que el Excel
        let suggestedQty = 0;
        if (indice > 0) {
          const rawTarget = indice * diasMax;
          const rawDiff   = ef < rawTarget ? rawTarget - ef : stockMax - ef;
          suggestedQty    = ceilToMultiple(rawDiff, upc);
        }

        return {
          matchId:       match.id,
          itemId:        match.offer_item_id,
          supplierCode:  item?.supplier_product_code || "—",
          idTienda:      match.internal_offer_id || "—",
          code:          match.internal_product_code || "—",
          name:          match.internal_product_name || item?.supplier_product_name || "",
          almacen:       internal?.proveedor || "—",
          unitCost:      item?.offered_cost ?? 0,
          precioCosto:   internal?.precio ?? null,
          currency:      item?.currency || offer.default_currency || "USD",
          minQty,
          packMultiple,
          currentStock:  ef,
          indice,
          stockMin,
          stockMax,
          estadoStock,
          suggestedQty,
        };
      });
  }, [matches, offerItems, internalOffers, offer, diasMin, diasMax, salesMap]);

  const [decisions, setDecisions] = useState({});

  useMemo(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        if (!next[r.matchId]) {
          next[r.matchId] = { finalQty: Math.max(0, r.suggestedQty), included: true };
        }
      });
      return next;
    });
  }, [rows.length]);

  const update = (matchId, field, value) =>
    setDecisions((prev) => ({ ...prev, [matchId]: { ...prev[matchId], [field]: value } }));

  const includedRows = rows.filter(
    (r) => decisions[r.matchId]?.included && (decisions[r.matchId]?.finalQty || 0) > 0
  );
  const totalAmount = includedRows.reduce(
    (sum, r) => sum + (decisions[r.matchId]?.finalQty || 0) * r.unitCost, 0
  );

  const handleCreate = async () => {
    if (includedRows.length === 0) {
      toast({ title: "Sin productos", description: "Selecciona al menos un producto con cantidad > 0.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const order = await base44.entities.PurchaseOrder.create({
        supplier_name: offer.supplier_name,
        offer_id:      offer.id,
        offer_name:    offer.offer_name,
        status:        "pendiente_revision",
        currency:      offer.default_currency || "USD",
        exchange_rate: offer.exchange_rate || 1,
        total_amount:  totalAmount,
        total_items:   includedRows.length,
        created_by:    user?.email || "",
      });

      const orderItems = includedRows.map((r) => {
        const d = decisions[r.matchId];
        return {
          purchase_order_id:     order.id,
          order_id:              order.id,
          cantidad:              d.finalQty,
          precio_unitario:       r.unitCost,
          offer_item_id:         r.itemId,
          internal_offer_id:     r.idTienda,
          internal_product_code: r.code,
          product_name:          r.name,
          unit_cost:             r.unitCost,
          currency:              r.currency,
          min_qty:               r.minQty,
          pack_multiple:         r.packMultiple,
          current_stock:         r.currentStock,
          suggested_qty:         r.suggestedQty,
          final_qty:             d.finalQty,
          status:                "included",
        };
      });

      await base44.entities.PurchaseOrderItem.bulkCreate(orderItems);
      await base44.entities.SupplierOffer.update(offer.id, { status: "ordered" });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });

      toast({ title: "Pedido generado", description: `Pedido creado con ${includedRows.length} productos.` });
      onOrderCreated?.();
      navigate(`/procurement/PurchaseOrderDetail/${order.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-muted-foreground text-sm space-y-2">
        <Info size={24} className="mx-auto opacity-40" />
        <p>No hay productos asociados confirmados todavía.</p>
        <p className="text-xs">Ve a la pestaña <strong>Asociación</strong> y confirma los productos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Banner de carga de índices */}
      {loadingSales && (
        <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/15 rounded-lg px-3 py-2 text-muted-foreground">
          <Loader2 size={13} className="animate-spin text-primary flex-shrink-0" />
          <span>Cargando índices de ventas — los valores de propuesta se actualizarán al terminar...</span>
        </div>
      )}

      {/* Controles de días + resumen */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-1.5 border">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Stock mín:</span>
          <Select value={String(diasMin)} onValueChange={(v) => setDiasMin(Number(v))}>
            <SelectTrigger className="h-7 w-16 text-xs border-0 bg-transparent p-0 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIAS_MIN_OPTIONS.map((d) => <SelectItem key={d} value={String(d)}>{d} días</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-1.5 border">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Stock máx:</span>
          <Select value={String(diasMax)} onValueChange={(v) => setDiasMax(Number(v))}>
            <SelectTrigger className="h-7 w-16 text-xs border-0 bg-transparent p-0 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIAS_MAX_OPTIONS.map((d) => <SelectItem key={d} value={String(d)}>{d} días</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-6 bg-border" />

        <div className="bg-primary/10 rounded-lg px-4 py-1.5">
          <p className="text-base font-bold text-primary leading-none">{includedRows.length}</p>
          <p className="text-[10px] text-muted-foreground">Seleccionados</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-1.5">
          <p className="text-base font-bold text-green-700 leading-none">
            {offer.default_currency || "USD"} {totalAmount.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground">Total estimado</p>
        </div>
        {offer.exchange_rate && offer.exchange_rate !== 1 && (
          <div className="bg-muted rounded-lg px-4 py-1.5">
            <p className="text-base font-bold leading-none">{(totalAmount * offer.exchange_rate).toFixed(2)} CUP</p>
            <p className="text-[10px] text-muted-foreground">TC: {offer.exchange_rate}</p>
          </div>
        )}

        <Badge variant="outline" className="ml-auto text-xs">
          <Sparkles size={11} className="mr-1 text-primary" />
          Sugerido = fórmula · Final = tu decisión
        </Badge>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs" style={{ minWidth: "1100px" }}>
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground w-7">✓</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">COD PROV</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">ID Tienda</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Cód. Prod. TKC</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground min-w-[130px]">Nombre TKC</th>
              <th className="px-2 py-2.5 text-center font-medium text-muted-foreground whitespace-nowrap">No. Almacén</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground">Stock</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground" title="Índice promedio ventas diarias">I.AVG</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground" title={`Stock Mínimo (${diasMin} días)`}>S.Mín</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground" title={`Stock Máximo (${diasMax} días)`}>S.Máx</th>
              <th className="px-2 py-2.5 text-center font-medium text-muted-foreground">Estado</th>
              <th className="px-2 py-2.5 text-right font-medium text-blue-500">Prop. Pedido</th>
              <th className="px-2 py-2.5 text-center font-medium text-primary">Cant. Final ✍</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">💰 P. Oferta Prov.</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">💰 P. Costo TKC</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = decisions[r.matchId] || { finalQty: Math.max(0, r.suggestedQty), included: true };
              const warnings   = getWarnings(d.finalQty || 0, r.minQty, r.packMultiple);
              const isOverride = (d.finalQty || 0) !== Math.max(0, r.suggestedQty);
              const subtotal   = (d.finalQty || 0) * r.unitCost;
              const estadoStyle = ESTADO_STYLES[r.estadoStock] ?? "bg-gray-100 text-gray-500 border-gray-200";
              const sugStyle    = getSuggestedStyle(r.suggestedQty);

              return (
                <tr
                  key={r.matchId}
                  className={`border-b border-border/50 last:border-0 transition-opacity ${!d.included ? "opacity-40" : ""}`}
                >
                  <td className="px-2 py-2.5">
                    <input type="checkbox" checked={!!d.included}
                      onChange={(e) => update(r.matchId, "included", e.target.checked)}
                      className="rounded" />
                  </td>
                  <td className="px-2 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{r.supplierCode}</td>
                  <td className="px-2 py-2.5 font-mono text-xs whitespace-nowrap">{r.idTienda}</td>
                  <td className="px-2 py-2.5 font-mono text-primary font-semibold whitespace-nowrap">{r.code}</td>
                  <td className="px-2 py-2.5 max-w-[160px]" title={r.name}>
                    <p className="font-medium truncate">{r.name}</p>
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground whitespace-nowrap text-center" title={r.almacen}>
                    <span className="text-[10px]">{formatAlmacen(r.almacen)}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold">{r.currentStock}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-muted-foreground">
                    {r.indice > 0 ? r.indice.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-muted-foreground">{r.stockMin || "—"}</td>
                  <td className="px-2 py-2.5 text-right text-muted-foreground">{r.stockMax || "—"}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Badge className={`text-[10px] px-1.5 py-0 border ${estadoStyle}`}>
                      {r.estadoStock}
                    </Badge>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] ${sugStyle}`}>
                      {r.suggestedQty}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <Input
                        type="number" min={0}
                        value={d.finalQty ?? ""}
                        onChange={(e) => update(r.matchId, "finalQty", parseInt(e.target.value) || 0)}
                        disabled={!d.included}
                        className={`h-7 w-20 text-center text-xs ${warnings.length ? "border-orange-400" : ""} ${isOverride ? "border-primary bg-primary/5 font-bold" : ""}`}
                      />
                      {warnings.map((w, i) => (
                        <span key={i} className="text-orange-500 text-[10px]">{w}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                    {r.currency} {r.unitCost.toFixed(2)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                    {r.precioCosto != null ? `${r.currency} ${Number(r.precioCosto).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    {r.currency} {subtotal.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button onClick={handleCreate} disabled={creating || includedRows.length === 0} className="w-full">
        <ShoppingCart size={15} className="mr-2" />
        {creating
          ? "Generando pedido..."
          : `Generar Pedido — ${includedRows.length} productos · ${offer.default_currency || "USD"} ${totalAmount.toFixed(2)}`
        }
      </Button>
    </div>
  );
}
