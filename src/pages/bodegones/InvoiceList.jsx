import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, Pencil, History, FileText, Ban, RotateCcw, Trash2, Loader2, FileSearch, FilePlus2, Info, Hash, Building2, ListFilter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listInvoices, getInvoicePdf, setInvoiceStatus, deleteInvoice,
  getStorageMode,
} from "@/api/externalInvoicesStore";
import InvoiceHistoryDialog from "./InvoiceHistoryDialog";
import SearchSelect from "@/components/common/SearchSelect";
import { FilterBar, FilterField, FilterSearch } from "@/components/common/FilterBar";

const fmtMoney = (n) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const fmtTs = (iso) => { try { return new Date(iso).toLocaleDateString("es"); } catch { return ""; } };

const EXEC_LABELS = { aa: "AA", t1201: "1201", w1882: "1882", z1883: "1883" };

// Estado de ejecución: Completa · avance parcial · Sin ejecutar · — (aún sin distribución)
function execBadge(exec) {
  if (!exec) return <span className="text-muted-foreground/40">—</span>;
  const keys = Object.keys(EXEC_LABELS);
  const total = keys.reduce((s, k) => s + (exec[k]?.total ?? 0), 0);
  const done  = keys.reduce((s, k) => s + (exec[k]?.done ?? 0), 0);
  if (!total) return <span className="text-muted-foreground/40">—</span>;
  const detail = keys.filter(k => exec[k]?.total).map(k => `${EXEC_LABELS[k]} ${exec[k].done}/${exec[k].total}`).join(" · ");
  if (exec.complete) return <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700" title={detail}>Completa</Badge>;
  if (!done) return <Badge variant="outline" className="text-[10px] text-muted-foreground" title={detail}>Sin ejecutar</Badge>;
  return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 tabular-nums" title={detail}>Parcial {done}/{total}</Badge>;
}

const ICON_BTN = "h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none";

/**
 * Lista de facturas de Distribución Externos.
 * Acciones: Editar, Historial, Ver documento, Anular/Restaurar y Eliminar (solo admin).
 */
export default function InvoiceList({ suppliers, user, isAdmin, onOpen, onNew }) {
  const { toast } = useToast();
  const [items,   setItems]   = useState(null);
  const [fId,     setFId]     = useState("");
  const [fNumero, setFNumero] = useState("");
  const [fProv,   setFProv]   = useState("");
  const [fEstado, setFEstado] = useState("activa");
  const [historyId, setHistoryId] = useState(null);
  const [mode, setMode] = useState(null);           // "api" | "local"

  const reload = useCallback(async () => {
    try { setItems(await listInvoices()); }
    catch (err) { setItems([]); toast({ description: err.message, variant: "destructive", duration: 4000 }); }
  }, [toast]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    getStorageMode().then(setMode).catch(() => {});
  }, []);

  const filtered = useMemo(() => (items ?? []).filter(i =>
    (!fId     || String(i.id).includes(fId.trim())) &&
    (!fNumero || String(i.numero).toLowerCase().includes(fNumero.trim().toLowerCase())) &&
    (!fProv   || i.supplierId === fProv) &&
    (fEstado === "todas" || i.status === fEstado),
  ), [items, fId, fNumero, fProv, fEstado]);

  const verDocumento = async (inv) => {
    const blob = await getInvoicePdf(inv.id);
    if (!blob) { toast({ description: "Esta factura no tiene documento asociado.", duration: 3000 }); return; }
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  };

  const run = async (fn, okMsg) => {
    try { await fn(); toast({ description: okMsg, duration: 2000 }); await reload(); }
    catch (err) { toast({ description: err.message, variant: "destructive", duration: 4000 }); }
  };

  const anular = (inv) => {
    const reason = window.prompt(`Anular la factura #${inv.numero}. Se conserva con su historial.\nMotivo (opcional):`);
    if (reason === null) return;
    run(() => setInvoiceStatus(inv.id, "anulada", user?.email, reason.trim()), "Factura anulada");
  };
  const restaurar = (inv) => run(() => setInvoiceStatus(inv.id, "activa", user?.email), "Factura restaurada");
  const eliminar = (inv) => {
    if (!window.confirm(`¿Eliminar DEFINITIVAMENTE la factura #${inv.numero} (ID ${inv.id}) con su documento e historial? No se puede deshacer.`)) return;
    run(() => deleteInvoice(inv.id), "Factura eliminada");
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        {mode === "local" && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>Provisional: el servidor aún no tiene Distribución Externos, así que las facturas se guardan solo en este navegador (no se comparten con otros usuarios ni equipos).</span>
          </div>
        )}
        <FilterBar>
          <FilterField icon={Hash} label="ID de la factura">
            <input value={fId} onChange={(e) => setFId(e.target.value.replace(/D/g, ""))} placeholder="ID"
              className="h-8 w-20 rounded-md border border-input bg-transparent px-2.5 text-xs shadow-sm transition-all duration-200 placeholder:text-muted-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/25" />
          </FilterField>
          <FilterSearch value={fNumero} onChange={setFNumero} placeholder="Nº de factura…" />
          <FilterField icon={Building2} label="Proveedor">
            <SearchSelect
              value={fProv}
              onChange={setFProv}
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
              allValue="" allLabel="Todos"
              placeholder="Todos" size="sm" className="w-44"
            />
          </FilterField>
          <FilterField icon={ListFilter} label="Estado">
            <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs w-32 shadow-sm">
              <option value="activa">Activas</option>
              <option value="anulada">Anuladas</option>
              <option value="todas">Todas</option>
            </select>
          </FilterField>
          <div className="ml-auto">
            <Button size="sm" className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" onClick={onNew}>
              <Plus className="h-3.5 w-3.5" /> Nueva factura
            </Button>
          </div>
        </FilterBar>

        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left w-16">ID</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Nº factura</th>
                <th className="px-3 py-2 text-left w-24">Fecha</th>
                <th className="px-3 py-2 text-center w-24">Nº productos</th>
                <th className="px-3 py-2 text-center w-24" title="Productos con código TKC asociado">Con código</th>
                <th className="px-3 py-2 text-center w-28" title="Ítems con check de ejecución (Ajuste AA + transferencias)">Ajustes</th>
                <th className="px-3 py-2 text-right w-28">Total importe</th>
                <th className="px-3 py-2 text-left w-24">Estado</th>
                <th className="px-3 py-2 text-right w-44">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items === null && (
                <tr><td colSpan={10} className="py-10 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Cargando…</td></tr>
              )}
              {items !== null && !filtered.length && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <FileSearch className="h-8 w-8 mx-auto mb-2 opacity-25" />
                    {items.length ? "Ninguna factura coincide con los filtros." : (
                      <>
                        <p>Aún no hay facturas cargadas.</p>
                        <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={onNew}><FilePlus2 className="h-3.5 w-3.5" /> Cargar la primera</Button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map(inv => {
                const anulada = inv.status === "anulada";
                return (
                  <tr key={inv.id} className={cn("border-t border-border/40 hover:bg-accent/20", anulada && "opacity-60")}>
                    <td className="px-3 py-2 font-mono tabular-nums">{inv.id}</td>
                    <td className="px-3 py-2 font-medium">{inv.supplierName}</td>
                    <td className="px-3 py-2 font-mono">{inv.numero}{inv.source === "manual" && <span className="ml-1.5 text-[9px] text-muted-foreground">manual</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.fecha || fmtTs(inv.createdAt)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{inv.nProductos}</td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      <span className={inv.nConCodigo === inv.nProductos ? "text-emerald-600" : "text-amber-600"}>{inv.nConCodigo}/{inv.nProductos}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{execBadge(inv.exec)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(inv.total)}</td>
                    <td className="px-3 py-2">
                      {anulada
                        ? <Badge variant="outline" className="text-[10px] border-rose-300 text-rose-600" title={inv.annulReason || ""}>Anulada</Badge>
                        : <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">Activa</Badge>}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <button className={ICON_BTN} title={anulada ? "Restaura la factura para poder editarla" : "Editar"} disabled={anulada} onClick={() => onOpen(inv.id)}><Pencil size={13} /></button>
                      <button className={ICON_BTN} title="Historial" onClick={() => setHistoryId(inv.id)}><History size={13} /></button>
                      <button className={ICON_BTN} title={inv.hasPdf ? "Ver documento asociado" : "Sin documento (carga manual)"} disabled={!inv.hasPdf} onClick={() => verDocumento(inv)}><FileText size={13} /></button>
                      {anulada
                        ? <button className={ICON_BTN} title="Restaurar" onClick={() => restaurar(inv)}><RotateCcw size={13} /></button>
                        : <button className={ICON_BTN} title="Anular (se conserva con su historial)" onClick={() => anular(inv)}><Ban size={13} /></button>}
                      {isAdmin && (
                        <button className={cn(ICON_BTN, "hover:text-destructive")} title="Eliminar definitivamente (solo admin)" onClick={() => eliminar(inv)}><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {items !== null && items.length > 0 && (
          <p className="text-[11px] text-muted-foreground">Mostrando {filtered.length} de {items.length} facturas.</p>
        )}
      </div>

      <InvoiceHistoryDialog invoiceId={historyId} open={historyId != null} onOpenChange={(o) => { if (!o) setHistoryId(null); }} />
    </div>
  );
}
