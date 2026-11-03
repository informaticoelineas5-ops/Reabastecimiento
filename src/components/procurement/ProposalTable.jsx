import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { finalizePurchaseOrder } from "@/api/reabApiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Info, Sparkles, Loader2, HelpCircle, Star } from "lucide-react";
import IndicesHelpModal from "@/components/IndicesHelpModal";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { fetchSalesIndicesByIds, computeIndiceAvg } from "@/api/salesIndicesClient";
import { getUserPreferences, SELECTABLE_INDICES, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";

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

export default function ProposalTable({ offer, matches, offerItems, internalOffers, newItems = [], onOrderCreated }) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const { user }    = useProcurementUser();

  const [diasMin, setDiasMin] = useState(30);
  const [diasMax, setDiasMax] = useState(90);
  const [creating, setCreating] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const offerIds = useMemo(() =>
    [...new Set(matches.map(m => m.internal_offer_id).filter(Boolean).map(String))],
    [matches]
  );

  const { data: salesMap = new Map(), isFetching: loadingSales } = useQuery({
    queryKey:  ["sales-indices-db", offerIds],
    queryFn:   () => fetchSalesIndicesByIds(offerIds),
    staleTime: 30 * 60 * 1000,
    enabled:   offerIds.length > 0,
  });

  const { data: userPrefs } = useQuery({
    queryKey:  ["user-preferences"],
    queryFn:   getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const selectedIndices = useMemo(() => {
    const keys = userPrefs?.selected_indices?.length
      ? userPrefs.selected_indices
      : DEFAULT_SELECTED_INDICES;
    return keys.map(k => SELECTABLE_INDICES.find(i => i.key === k)).filter(Boolean);
  }, [userPrefs]);

  const selectedKeys = useMemo(
    () => selectedIndices.map(i => i.key),
    [selectedIndices]
  );

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
        const indice    = computeIndiceAvg(salesData, selectedKeys) ?? 0;

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
          supplierName:  item?.supplier_product_name || "",
          idTienda:      match.internal_offer_id || "—",
          code:          match.internal_product_code || "—",
          name:          match.internal_product_name || item?.supplier_product_name || "",
          foto:          internal?.fotos?.[0]?.foto ?? null,
          salesData,
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
  }, [matches, offerItems, internalOffers, offer, diasMin, diasMax, salesMap, selectedKeys]);

  const [decisions, setDecisions] = useState({});
  const [newDecisions, setNewDecisions] = useState({});

  useEffect(() => {
    setNewDecisions(prev => {
      const next = { ...prev };
      newItems.forEach(item => {
        if (!next[item.id]) next[item.id] = { finalQty: item.min_qty || 1, included: true };
      });
      return next;
    });
  }, [newItems]);

  useEffect(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        if (!next[r.matchId]) {
          next[r.matchId] = { finalQty: Math.max(0, r.suggestedQty), included: true };
        }
      });
      return next;
    });
  }, [rows]);

  const update = (matchId, field, value) =>
    setDecisions((prev) => ({ ...prev, [matchId]: { ...prev[matchId], [field]: value } }));

  const includedRows = rows.filter(
    (r) => decisions[r.matchId]?.included && (decisions[r.matchId]?.finalQty || 0) > 0
  );
  const includedNewItems = newItems.filter(
    (item) => newDecisions[item.id]?.included && (newDecisions[item.id]?.finalQty || 0) > 0
  );
  const totalAmount =
    includedRows.reduce((sum, r) => sum + (decisions[r.matchId]?.finalQty || 0) * r.unitCost, 0) +
    includedNewItems.reduce((sum, item) => sum + (newDecisions[item.id]?.finalQty || 0) * (item.offered_cost || 0), 0);

  const handleCreate = async () => {
    if (includedRows.length === 0 && includedNewItems.length === 0) {
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
        total_items:   includedRows.length + includedNewItems.length,
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
          supplier_product_code: r.supplierCode !== "—" ? r.supplierCode : null,
          product_name:          r.supplierName || r.name,
          supplier_product_name: r.supplierName || null,
          unit_cost:             r.unitCost,
          currency:              r.currency,
          min_qty:               r.minQty,
          pack_multiple:         r.packMultiple,
          current_stock:         r.currentStock,
          suggested_qty:         r.suggestedQty,
          final_qty:             d.finalQty,
          status:                "included",
          is_new_product:        false,
        };
      });

      // Productos Nuevos — sin asociación interna, cantidad decidida por el comercial
      const newOrderItems = includedNewItems.map((item) => {
        const d = newDecisions[item.id];
        return {
          purchase_order_id:     order.id,
          order_id:              order.id,
          cantidad:              d.finalQty,
          precio_unitario:       item.offered_cost || 0,
          offer_item_id:         item.id,
          internal_offer_id:     null,
          internal_product_code: null,
          supplier_product_code: item.supplier_product_code || null,
          product_name:          item.supplier_product_name || item.supplier_product_code || "Producto Nuevo",
          supplier_product_name: item.supplier_product_name || null,
          unit_cost:             item.offered_cost || 0,
          currency:              item.currency || offer.default_currency || "USD",
          min_qty:               item.min_qty || 1,
          pack_multiple:         item.pack_multiple || 1,
          current_stock:         0,
          suggested_qty:         0,
          final_qty:             d.finalQty,
          status:                "included",
          is_new_product:        true,
        };
      });

      await base44.entities.PurchaseOrderItem.bulkCreate([...orderItems, ...newOrderItems]);
      await finalizePurchaseOrder(order.id, "pendiente_revision");
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

      {/* Popup foto fijo — escapa del overflow-x del contenedor de tabla */}
      {photoPreview && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: photoPreview.x, top: photoPreview.y }}
        >
          <div className="bg-white rounded-xl shadow-2xl border border-border p-1.5">
            <img src={photoPreview.url} alt={photoPreview.name} className="h-40 w-40 object-contain rounded-lg" />
          </div>
        </div>
      )}

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

      {/* Guía de índices */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowHelp(true)}
          className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
        >
          <HelpCircle size={11} />
          ¿Qué significan los índices?
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto overflow-y-auto rounded-lg border border-border" style={{ maxHeight: "52vh" }}>
        <table className="w-full text-xs" style={{ minWidth: "1100px" }}>
          <thead>
            <tr className="bg-muted/50 border-b border-border sticky top-0 z-10">
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground w-7 bg-muted/80">
                <input
                  type="checkbox"
                  className="rounded"
                  title={rows.every(r => decisions[r.matchId]?.included) ? "Desmarcar todos" : "Marcar todos"}
                  checked={rows.length > 0 && rows.every(r => decisions[r.matchId]?.included)}
                  ref={el => {
                    if (el) el.indeterminate = rows.some(r => decisions[r.matchId]?.included) && !rows.every(r => decisions[r.matchId]?.included);
                  }}
                  onChange={e => {
                    const val = e.target.checked;
                    setDecisions(prev => {
                      const next = { ...prev };
                      rows.forEach(r => { next[r.matchId] = { ...next[r.matchId], included: val }; });
                      return next;
                    });
                  }}
                />
              </th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap bg-muted/80">COD PROV</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap bg-muted/80">ID Tienda</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap bg-muted/80">Cód. Prod. TKC</th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-foreground min-w-[130px] bg-muted/80">Nombre TKC</th>
              <th className="px-2 py-2.5 text-center font-medium text-muted-foreground whitespace-nowrap bg-muted/80">No. Almacén</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground bg-muted/80">Stock</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground bg-muted/80" title="Índice promedio ventas diarias (fórmula)">I.AVG</th>
              {selectedIndices.map(idx => (
                <th key={idx.key} className="px-2 py-2.5 text-right font-medium text-violet-500 bg-muted/80 whitespace-nowrap" title={idx.label}>
                  {idx.short}
                </th>
              ))}
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground bg-muted/80" title={`Stock Mínimo (${diasMin} días)`}>S.Mín</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground bg-muted/80" title={`Stock Máximo (${diasMax} días)`}>S.Máx</th>
              <th className="px-2 py-2.5 text-center font-medium text-muted-foreground bg-muted/80">Estado</th>
              <th className="px-2 py-2.5 text-right font-medium text-blue-500 bg-muted/80">Prop. Pedido</th>
              <th className="px-2 py-2.5 text-center font-medium text-primary bg-muted/80">Cant. Final ✍</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-muted/80">💰 P. Oferta Prov.</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-muted/80">💰 P. Costo TKC</th>
              <th className="px-2 py-2.5 text-right font-medium text-muted-foreground bg-muted/80">Subtotal</th>
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
                  <td className="px-2 py-2.5 min-w-[200px] max-w-[300px]">
                    <div className="flex items-start gap-1.5">
                      {r.foto && (
                        <img
                          src={r.foto}
                          alt=""
                          className="h-6 w-6 rounded object-cover cursor-zoom-in border border-border/50 flex-shrink-0 mt-0.5"
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPhotoPreview({ url: r.foto, name: r.name, x: rect.right + 8, y: rect.top });
                          }}
                          onMouseLeave={() => setPhotoPreview(null)}
                        />
                      )}
                      <p className="font-medium text-wrap break-words" title={r.name}>{r.name}</p>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground whitespace-nowrap text-center" title={r.almacen}>
                    <span className="text-[10px]">{formatAlmacen(r.almacen)}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold">{r.currentStock}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-muted-foreground">
                    {r.indice > 0 ? (r.indice >= 1 ? Math.round(r.indice) : r.indice.toFixed(3)) : "—"}
                  </td>
                  {selectedIndices.map(idx => {
                    const val = r.salesData?.[idx.key] ?? null;
                    return (
                      <td key={idx.key} className="px-2 py-2.5 text-right font-mono text-violet-600 text-[11px]">
                        {val != null ? (val >= 1 ? Math.round(val) : val.toFixed(3)) : "—"}
                      </td>
                    );
                  })}
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

      {/* ── Bloque Productos Nuevos ── */}
      {newItems.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 flex items-center gap-2 border-b border-amber-200 dark:border-amber-700">
            <Star size={13} className="text-amber-600 dark:text-amber-400 fill-amber-400" />
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Productos Nuevos — sin asociación interna
            </span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">
              · Cantidad a criterio del comercial · Sin stock ni índices
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-amber-50/60 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800">
                  <th className="px-3 py-2 w-7">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={newItems.length > 0 && newItems.every(i => newDecisions[i.id]?.included)}
                      onChange={e => {
                        const val = e.target.checked;
                        setNewDecisions(prev => {
                          const next = { ...prev };
                          newItems.forEach(i => { next[i.id] = { ...next[i.id], included: val }; });
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Cód. Proveedor</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[200px]">Nombre del Producto</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Precio Unit.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Mín.</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Múlt.</th>
                  <th className="px-3 py-2 text-center font-medium text-primary">Cant. Final ✍</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {newItems.map((item) => {
                  const d = newDecisions[item.id] || { finalQty: item.min_qty || 1, included: true };
                  const warnings = getWarnings(d.finalQty || 0, item.min_qty || 1, item.pack_multiple || 1);
                  const subtotal = (d.finalQty || 0) * (item.offered_cost || 0);
                  const currency = item.currency || offer.default_currency || "USD";
                  return (
                    <tr key={item.id} className={`border-b border-amber-100 dark:border-amber-900/30 last:border-0 transition-opacity ${!d.included ? "opacity-40" : ""}`}>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={!!d.included}
                          onChange={e => setNewDecisions(prev => ({ ...prev, [item.id]: { ...prev[item.id], included: e.target.checked } }))}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                        {item.supplier_product_code || "—"}
                      </td>
                      <td className="px-3 py-2.5 font-medium max-w-[300px]">
                        <span className="block text-wrap break-words">{item.supplier_product_name || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {currency} {(item.offered_cost || 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{item.min_qty || 1}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{item.pack_multiple || 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-center gap-0.5">
                          <Input
                            type="number" min={0}
                            value={d.finalQty ?? ""}
                            onChange={e => setNewDecisions(prev => ({ ...prev, [item.id]: { ...prev[item.id], finalQty: parseInt(e.target.value) || 0 } }))}
                            disabled={!d.included}
                            className={`h-7 w-20 text-center text-xs ${warnings.length ? "border-orange-400" : "border-amber-300 focus:border-amber-500"}`}
                          />
                          {warnings.map((w, i) => (
                            <span key={i} className="text-orange-500 text-[10px]">{w}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                        {currency} {subtotal.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {includedNewItems.length > 0 && (
                <tfoot>
                  <tr className="border-t border-amber-200 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10">
                    <td colSpan={7} className="px-3 py-2 text-right text-xs font-semibold text-amber-700 dark:text-amber-400">
                      Subtotal Productos Nuevos:
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-xs text-amber-700 dark:text-amber-400">
                      {offer.default_currency || "USD"} {includedNewItems.reduce((s, i) => s + (newDecisions[i.id]?.finalQty || 0) * (i.offered_cost || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm pt-2 pb-1 border-t border-border -mx-1 px-1">
        <Button onClick={handleCreate} disabled={creating || (includedRows.length === 0 && includedNewItems.length === 0)} className="w-full">
          <ShoppingCart size={15} className="mr-2" />
          {creating
            ? "Generando pedido..."
            : `Generar Pedido — ${includedRows.length + includedNewItems.length} productos · ${offer.default_currency || "USD"} ${totalAmount.toFixed(2)}`
          }
        </Button>
      </div>

      <IndicesHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
