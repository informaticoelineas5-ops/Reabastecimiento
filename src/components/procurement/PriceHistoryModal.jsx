import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, History } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

async function fetchPriceHistory(itemId) {
  return base44.entities.OfferItemPriceHistory.filter(
    { offer_item_id: itemId },
    '-changed_at',
    50
  );
}

export default function PriceHistoryModal({ open, onClose, item }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ["price-history", item?.id],
    queryFn: () => fetchPriceHistory(item.id),
    enabled: open && !!item?.id,
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History size={16} className="text-primary" />
            Historial de precios
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {item.supplier_product_code && (
              <span className="font-mono mr-2">{item.supplier_product_code}</span>
            )}
            {item.supplier_product_name}
          </p>
        </DialogHeader>

        {/* Precio actual */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">Precio actual</span>
          <span className="text-lg font-bold text-primary">
            {item.offered_cost != null ? `${item.offered_cost.toFixed(2)}` : "—"}
          </span>
        </div>

        {/* Historial */}
        <div className="space-y-1 max-h-[340px] overflow-auto pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              <History size={28} className="mx-auto mb-2 opacity-30" />
              Sin cambios de precio registrados.
              <p className="text-xs mt-1">Los cambios se registran automáticamente al importar un archivo actualizado.</p>
            </div>
          ) : (
            history.map((row, idx) => {
              const diff = row.new_cost - (row.old_cost ?? row.new_cost);
              const pct = row.old_cost ? ((diff / row.old_cost) * 100).toFixed(1) : null;
              const up = diff > 0;
              const down = diff < 0;

              return (
                <div
                  key={row.id ?? idx}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/60 bg-background"
                >
                  {/* Icono de tendencia */}
                  <div className={`flex-shrink-0 ${up ? "text-destructive" : down ? "text-success" : "text-muted-foreground"}`}>
                    {up ? <TrendingUp size={15} /> : down ? <TrendingDown size={15} /> : <Minus size={15} />}
                  </div>

                  {/* Precios */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      {row.old_cost != null && (
                        <>
                          <span className="text-muted-foreground line-through text-xs">
                            {row.old_cost.toFixed(2)}
                          </span>
                          <span className="text-muted-foreground text-xs">→</span>
                        </>
                      )}
                      <span className={`font-semibold ${up ? "text-destructive" : down ? "text-success" : ""}`}>
                        {row.new_cost.toFixed(2)}
                      </span>
                      {pct !== null && diff !== 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          up ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                        }`}>
                          {up ? "+" : ""}{pct}%
                        </span>
                      )}
                    </div>
                    {row.imported_by && (
                      <p className="text-[10px] text-muted-foreground truncate">por {row.imported_by}</p>
                    )}
                  </div>

                  {/* Fecha */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(row.changed_at), "dd MMM yyyy", { locale: es })}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">
                      {format(new Date(row.changed_at), "HH:mm")}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
