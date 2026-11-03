import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, CheckCircle2, AlertCircle, Tag } from "lucide-react";

export default function OfferUpdateSummaryModal({ open, onClose, summary }) {
  if (!summary) return null;

  const { inserted, updated, unchanged, notInNew, totalExtracted, invalidRows } = summary;
  const priceUpdated = updated.filter((u) => "offered_cost" in u.changes);
  const nameUpdated  = updated.filter((u) => !("offered_cost" in u.changes) && "supplier_product_name" in u.changes);
  const otherUpdated = updated.filter((u) => !("offered_cost" in u.changes) && !("supplier_product_name" in u.changes));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-500" />
            Importación completada
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard icon={<Plus size={15} />}         label="Nuevos"       count={inserted.length} color="blue"  />
            <SummaryCard icon={<TrendingUp size={15} />}   label="Actualizados" count={updated.length}  color="amber" />
            <SummaryCard icon={<CheckCircle2 size={15} />} label="Sin cambios"  count={unchanged}       color="green" />
            <SummaryCard icon={<AlertCircle size={15} />}  label="No en nueva"  count={notInNew.length} color="muted" />
          </div>

          {/* File stats */}
          {totalExtracted != null && (
            <p className="text-xs text-muted-foreground text-center -mt-1">
              {totalExtracted} filas leídas del archivo
              {invalidRows > 0 && (
                <span className="ml-1 font-semibold text-orange-600">
                  · {invalidRows} ignorada{invalidRows !== 1 ? "s" : ""} (sin nombre ni código)
                </span>
              )}
            </p>
          )}

          {/* New items */}
          {inserted.length > 0 && (
            <Section title="Productos nuevos agregados" accent="blue">
              {inserted.slice(0, 25).map((item, i) => (
                <ItemRow
                  key={i}
                  name={item.supplier_product_name}
                  code={item.supplier_product_code}
                  right={item.offered_cost != null ? `$${Number(item.offered_cost).toFixed(2)}` : "—"}
                />
              ))}
              {inserted.length > 25 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">…y {inserted.length - 25} más</p>
              )}
            </Section>
          )}

          {/* Price updates */}
          {priceUpdated.length > 0 && (
            <Section title="Precio actualizado" accent="amber">
              {priceUpdated.slice(0, 25).map((u, i) => (
                <ItemRow
                  key={i}
                  name={u.newItem.supplier_product_name}
                  code={u.newItem.supplier_product_code}
                  right={
                    <span className="tabular-nums">
                      <span className="line-through text-muted-foreground">
                        ${Number(u.oldItem.offered_cost ?? 0).toFixed(2)}
                      </span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="font-semibold text-amber-700">
                        ${Number(u.changes.offered_cost).toFixed(2)}
                      </span>
                    </span>
                  }
                />
              ))}
              {priceUpdated.length > 25 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">…y {priceUpdated.length - 25} más</p>
              )}
            </Section>
          )}

          {/* Name updates */}
          {nameUpdated.length > 0 && (
            <Section title="Nombre actualizado" accent="purple">
              {nameUpdated.slice(0, 15).map((u, i) => (
                <ItemRow
                  key={i}
                  name={u.oldItem.supplier_product_name}
                  code={u.newItem.supplier_product_code}
                  right={
                    <span className="text-xs text-purple-700 max-w-[160px] truncate block">
                      → {u.changes.supplier_product_name}
                    </span>
                  }
                />
              ))}
              {nameUpdated.length > 15 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">…y {nameUpdated.length - 15} más</p>
              )}
            </Section>
          )}

          {/* Other field updates */}
          {otherUpdated.length > 0 && (
            <Section title="Otros campos actualizados" accent="gray">
              {otherUpdated.slice(0, 10).map((u, i) => (
                <ItemRow
                  key={i}
                  name={u.newItem.supplier_product_name}
                  code={u.newItem.supplier_product_code}
                  right={
                    <span className="text-xs text-muted-foreground">
                      {Object.keys(u.changes).join(", ")}
                    </span>
                  }
                />
              ))}
            </Section>
          )}

          {/* Not in new — informative only */}
          {notInNew.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              <Tag size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">
                  {notInNew.length} producto{notInNew.length !== 1 ? "s" : ""} no aparece{notInNew.length === 1 ? "" : "n"} en esta importación
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Se conservan en la oferta sin modificación.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button onClick={onClose}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ icon, label, count, color }) {
  const styles = {
    blue:  "bg-blue-50 border-blue-200 text-blue-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    muted: "bg-muted border-border text-muted-foreground",
  };
  return (
    <div className={`border rounded-lg p-3 text-center ${styles[color]}`}>
      <div className="flex justify-center mb-1 opacity-70">{icon}</div>
      <p className="text-2xl font-bold leading-none">{count}</p>
      <p className="text-xs mt-1 opacity-80">{label}</p>
    </div>
  );
}

function Section({ title, children, accent }) {
  const bar = {
    blue:   "border-l-blue-400",
    amber:  "border-l-amber-400",
    purple: "border-l-purple-400",
    gray:   "border-l-border",
  };
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className={`border border-border rounded-lg overflow-hidden divide-y divide-border/50 border-l-2 ${bar[accent] ?? ""}`}>
        {children}
      </div>
    </div>
  );
}

function ItemRow({ name, code, right }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-foreground">{name}</p>
        {code && <p className="text-xs text-muted-foreground">{code}</p>}
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </div>
  );
}
