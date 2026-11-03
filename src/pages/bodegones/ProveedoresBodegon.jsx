import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Building2, Plus, Pencil, Trash2, Check, X, Info, FileText, ClipboardList } from "lucide-react";
import {
  loadExternalSuppliers, saveExternalSupplier, deleteExternalSupplier,
} from "@/api/externalSuppliersStore";
import { getDistribucionMode } from "@/api/distribucionMode";

export default function ProveedoresBodegon() {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [newName,   setNewName]   = useState("");
  const [editId,    setEditId]    = useState(null);
  const [editName,  setEditName]  = useState("");

  const [mode, setMode] = useState(null); // "api" | "local"
  const reload = useCallback(async () => {
    setMode(await getDistribucionMode());
    setSuppliers(await loadExternalSuppliers());
  }, []);
  useEffect(() => { reload().catch(err => toast({ description: err.message, variant: "destructive", duration: 4000 })); }, [reload, toast]);

  const run = async (fn, okMsg) => {
    try {
      const out = await fn();
      const msg = out?.deactivated ? "Tenía facturas: no se borró, se desactivó y ya no aparece en la lista." : okMsg;
      if (msg) toast({ description: msg, duration: out?.deactivated ? 5000 : 2000 });
      await reload();
      return true;
    } catch (err) {
      toast({ description: err.message, variant: "destructive", duration: 4000 });
      return false;
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    if (await run(() => saveExternalSupplier({ name: newName }), "Proveedor agregado")) setNewName("");
  };

  const rename = async (id) => {
    if (await run(() => saveExternalSupplier({ id, name: editName }), "Nombre actualizado")) setEditId(null);
  };

  const remove = (s) => {
    if (!window.confirm(`¿Eliminar el proveedor "${s.name}"? Si ya tiene facturas se desactivará en lugar de borrarse (las facturas no se afectan).`)) return;
    run(() => deleteExternalSupplier(s.id), "Proveedor eliminado");
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Building2 size={20} className="text-primary" />
          Proveedores Bodegón
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Proveedores externos cuyas facturas se distribuyen en Distribución Externos (por ejemplo SM23M).
        </p>
      </div>

      {mode === "local" && <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          Provisional: el servidor aún no tiene los proveedores externos, así que la lista se guarda solo en este navegador.
          Un proveedor nuevo carga sus facturas en modo manual; el lector de PDF existe solo para SM23M.
        </span>
      </div>}

      <Card className="p-3">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Nombre del proveedor externo"
            className="h-9"
          />
          <Button onClick={add} disabled={!newName.trim()} className="gap-1.5">
            <Plus size={14} /> Agregar
          </Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {suppliers.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0">
            {editId === s.id ? (
              <>
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") rename(s.id); if (e.key === "Escape") setEditId(null); }}
                  className="h-8 flex-1"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => rename(s.id)} title="Guardar"><Check size={14} /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)} title="Cancelar"><X size={14} /></Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <Badge variant="outline" className="text-[10px] gap-1">
                  {s.parser ? <><FileText size={10} /> PDF + manual</> : <><ClipboardList size={10} /> Solo manual</>}
                </Badge>
                <Button size="icon" variant="ghost" className="h-8 w-8" title="Renombrar"
                  onClick={() => { setEditId(s.id); setEditName(s.name); }}><Pencil size={13} /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Eliminar"
                  onClick={() => remove(s)}><Trash2 size={13} /></Button>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
