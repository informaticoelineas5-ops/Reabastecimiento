import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ClipboardPaste, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// "1,234.50" · "1.234,50" · "$12" · "12,5" → número
function toNumber(raw) {
  let s = String(raw ?? "").replace(/[$\s]/g, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

let seq = 0;
const blank = () => ({ key: `m${++seq}`, nombre: "", uc: "", cajas: "", precio: "" });

const CELL = cn(
  "h-7 text-xs px-1.5 bg-transparent border-0 shadow-none rounded",
  "focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:bg-background",
);

/**
 * Formulario de factura manual (para cuando el proveedor manda solo los datos, sin PDF).
 * onSubmit({ meta: { numero, fecha, total }, products }) devuelve las filas con la misma forma que el lector de PDF.
 */
export default function ManualInvoiceForm({ supplier, extractUC, onSubmit }) {
  const [numero, setNumero] = useState("");
  const [fecha,  setFecha]  = useState(() => new Date().toISOString().slice(0, 10));
  const [items,  setItems]  = useState(() => Array.from({ length: 5 }, blank));
  const [paste,  setPaste]  = useState("");
  const [error,  setError]  = useState("");

  const setCell = (key, field, val) =>
    setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: val } : i));

  const filled = useMemo(() => items.filter(i => i.nombre.trim()), [items]);
  const total  = useMemo(
    () => filled.reduce((s, i) => s + toNumber(i.cajas) * toNumber(i.precio), 0),
    [filled],
  );

  // Pegar desde Excel: columnas Nombre · Cajas · Precio por caja · U/C (opcional)
  const applyPaste = () => {
    const parsed = paste.split(/\r?\n/)
      .map(l => l.split("\t"))
      .filter(c => c[0]?.trim())
      .map(c => ({ key: `m${++seq}`, nombre: c[0].trim(), cajas: c[1]?.trim() ?? "", precio: c[2]?.trim() ?? "", uc: c[3]?.trim() ?? "" }));
    if (!parsed.length) { setError("No se reconoció ninguna fila. Copia las celdas desde Excel (nombre, cajas, precio, U/C)."); return; }
    setError("");
    setItems(prev => [...prev.filter(i => i.nombre.trim()), ...parsed]);
    setPaste("");
  };

  const submit = () => {
    if (!numero.trim()) { setError("El número de factura es obligatorio: sirve para reconocer la misma factura después."); return; }
    if (!filled.length) { setError("Agrega al menos un producto."); return; }
    const bad = filled.find(i => toNumber(i.cajas) <= 0);
    if (bad) { setError(`"${bad.nombre}": indica las cajas (mayor que 0).`); return; }
    setError("");
    const stamp = Date.now();
    const products = filled.map((i, n) => {
      const nombre = i.nombre.trim();
      const cajas  = toNumber(i.cajas);
      const uc     = Math.max(1, Math.round(toNumber(i.uc)) || extractUC(nombre));
      return {
        id: `${stamp}-${n}`, nombre, nombreFactura: nombre, uc,
        cajasFactura: cajas, cajasRecib: cajas, precioCaja: toNumber(i.precio),
        cod: "", preCod: "", nuevo: false, creado: false,
        r1053: 0, t1201: 0, w1882: 0, z1883: 0,
      };
    });
    onSubmit({ meta: { numero: numero.trim(), fecha, total: Math.round(total * 100) / 100 }, products });
  };

  return (
    <div className="w-full max-w-4xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Proveedor</span>
          <Input value={supplier?.name ?? ""} readOnly className="h-8 bg-muted/40" />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Número de factura *</span>
          <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej. 123456" className="h-8" />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted-foreground">Fecha</span>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8" />
        </label>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 text-left w-8">#</th>
              <th className="px-2 py-1.5 text-left">Nombre del producto</th>
              <th className="px-2 py-1.5 text-center w-20" title="Unidades por caja. Si lo dejas vacío se toma del nombre, por ejemplo (24 x 355 ml).">U/C</th>
              <th className="px-2 py-1.5 text-center w-20">Cajas</th>
              <th className="px-2 py-1.5 text-right w-24">Precio/caja</th>
              <th className="px-2 py-1.5 text-right w-24">Importe</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.key} className="border-t border-border/40">
                <td className="px-2 text-muted-foreground/60 tabular-nums">{n + 1}</td>
                <td><Input value={i.nombre} onChange={(e) => setCell(i.key, "nombre", e.target.value)} className={cn(CELL, "w-full")} /></td>
                <td><Input value={i.uc} inputMode="numeric" onChange={(e) => setCell(i.key, "uc", e.target.value)} className={cn(CELL, "text-center")} placeholder={i.nombre ? String(extractUC(i.nombre)) : ""} /></td>
                <td><Input value={i.cajas} inputMode="decimal" onChange={(e) => setCell(i.key, "cajas", e.target.value)} className={cn(CELL, "text-center")} /></td>
                <td><Input value={i.precio} inputMode="decimal" onChange={(e) => setCell(i.key, "precio", e.target.value)} className={cn(CELL, "text-right")} /></td>
                <td className="px-2 text-right tabular-nums text-muted-foreground">
                  {i.nombre.trim() ? (toNumber(i.cajas) * toNumber(i.precio)).toFixed(2) : ""}
                </td>
                <td>
                  <button className="p-1 text-muted-foreground/50 hover:text-destructive" title="Quitar fila"
                    onClick={() => setItems(prev => prev.length > 1 ? prev.filter(x => x.key !== i.key) : [blank()])}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/20">
              <td colSpan={5} className="px-2 py-1.5 text-right font-medium">Total ({filled.length} productos)</td>
              <td className="px-2 py-1.5 text-right font-bold tabular-nums">{total.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setItems(prev => [...prev, blank()])}>
          <Plus size={12} /> Agregar fila
        </Button>
      </div>

      <details className="rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer font-medium flex items-center gap-1.5 w-fit">
          <ClipboardPaste size={13} /> Pegar desde Excel
        </summary>
        <p className="text-muted-foreground mt-2">
          Copia las celdas en este orden: <strong>Nombre · Cajas · Precio por caja · U/C</strong> (U/C es opcional) y pégalas aquí.
        </p>
        <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} className="mt-2 text-xs font-mono" />
        <Button size="sm" className="h-7 text-xs mt-2" onClick={applyPaste} disabled={!paste.trim()}>Agregar filas pegadas</Button>
      </details>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button onClick={submit} className="gap-1.5">
          Cargar a la distribución <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}
