import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, ChevronRight, ChevronDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getInvoice, listInvoiceEvents, priceHistoryForInvoice } from "@/api/externalInvoicesStore";

const fmtTs = (iso) => {
  try { return new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
};
const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

const TYPE_DOT = {
  carga: "bg-emerald-500", edicion: "bg-sky-500", propuesta: "bg-violet-500",
  script: "bg-amber-500", ejecucion: "bg-emerald-600", anulacion: "bg-rose-500", restauracion: "bg-emerald-500",
};

function EventItem({ ev }) {
  const [open, setOpen] = useState(false);
  const has = ev.detail?.length > 0;
  return (
    <li className="relative pl-5 pb-3 border-l border-border/60 ml-1.5 last:pb-0">
      <span className={cn("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full", TYPE_DOT[ev.type] ?? "bg-muted-foreground")} />
      <button
        className="flex items-start gap-1 text-left text-xs w-full disabled:cursor-default"
        disabled={!has} onClick={() => setOpen(o => !o)}
      >
        {has ? (open ? <ChevronDown size={12} className="mt-0.5 shrink-0" /> : <ChevronRight size={12} className="mt-0.5 shrink-0" />) : null}
        <span className="font-medium">{ev.summary}</span>
      </button>
      <p className="text-[10px] text-muted-foreground">{fmtTs(ev.ts)}{ev.user ? ` · ${ev.user}` : ""}</p>
      {open && has && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {ev.detail.map((d, i) => (
            <li key={i}>
              <span className="text-foreground/80">{d.producto}</span> · {d.campo}: {String(d.antes ?? "")} → <strong>{String(d.despues)}</strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Historial de operaciones y de precios de una factura. */
export default function InvoiceHistoryDialog({ invoiceId, open, onOpenChange }) {
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [events,  setEvents]  = useState([]);
  const [prices,  setPrices]  = useState(new Map());

  useEffect(() => {
    if (!open || !invoiceId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const inv = await getInvoice(invoiceId);
      const [evs, pr] = await Promise.all([listInvoiceEvents(invoiceId), inv ? priceHistoryForInvoice(inv) : new Map()]);
      if (!alive) return;
      setInvoice(inv); setEvents(evs); setPrices(pr);
    })().finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [open, invoiceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Historial · factura {invoice ? `#${invoice.numero}` : ""}
            {invoice && <span className="ml-2 text-xs font-normal text-muted-foreground">ID {invoice.id} · {invoice.supplierName}</span>}
          </DialogTitle>
          <DialogDescription>Operaciones hechas en la factura y evolución del precio por caja de sus productos.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <Tabs defaultValue="ops" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="w-fit">
              <TabsTrigger value="ops">Operaciones ({events.length})</TabsTrigger>
              <TabsTrigger value="prices">Precios</TabsTrigger>
            </TabsList>

            <TabsContent value="ops" className="flex-1 overflow-auto pr-1">
              {!events.length
                ? <p className="text-sm text-muted-foreground py-6 text-center">Sin operaciones registradas.</p>
                : <ul className="pt-2">{events.map(ev => <EventItem key={ev.id} ev={ev} />)}</ul>}
            </TabsContent>

            <TabsContent value="prices" className="flex-1 overflow-auto">
              {!invoice?.rows?.length ? null : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                      <th className="text-left py-1.5 pr-2">Producto</th>
                      <th className="text-right py-1.5 px-2 w-24">Esta factura</th>
                      <th className="text-right py-1.5 px-2 w-24">Anterior</th>
                      <th className="text-left py-1.5 pl-3">Facturas anteriores del proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.rows.map(r => {
                      const hist = prices.get(r.id) ?? [];
                      const last = hist[hist.length - 1];
                      const diff = last && last.precioCaja ? ((r.precioCaja - last.precioCaja) / last.precioCaja) * 100 : null;
                      return (
                        <tr key={r.id} className="border-b border-border/30 align-top">
                          <td className="py-1.5 pr-2">{r.nombre}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-medium">{money(r.precioCaja)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {last ? (
                              <span className="inline-flex items-center gap-1 justify-end">
                                {money(last.precioCaja)}
                                {diff != null && Math.abs(diff) >= 0.01 && (
                                  <span className={cn("inline-flex items-center text-[10px]", diff > 0 ? "text-rose-600" : "text-emerald-600")}>
                                    {diff > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{Math.abs(diff).toFixed(1)}%
                                  </span>
                                )}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 pl-3 text-muted-foreground">
                            {hist.length
                              ? hist.slice().reverse().map(h => `${h.fecha} (#${h.numero}) ${money(h.precioCaja)}`).join(" · ")
                              : "Primera vez que aparece"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
