import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ClipboardList, AlertTriangle, Rocket } from "lucide-react";

const USER_KEY = "reab_tkc_username";

/**
 * Confirmación para ejecutar un objetivo de la factura en TKC (Ajuste AA o transferencia).
 * Pide la cuenta de TKC de quien ejecuta: el documento queda a su nombre y el servidor no guarda la contraseña.
 * La contraseña vive solo en este diálogo: se borra al cerrarlo.
 */
export default function TkcExecuteDialog({ open, onOpenChange, label, pending, modified, running, onRun, onCopyScript }) {
  const [username, setUsername] = useState(() => { try { return localStorage.getItem(USER_KEY) ?? ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [confirmModified, setConfirmModified] = useState(false);

  useEffect(() => { if (!open) { setPassword(""); setConfirmModified(false); } }, [open]);

  const canRun = !running && username.trim() && password && (pending > 0 || (modified > 0 && confirmModified));

  const run = () => {
    try { localStorage.setItem(USER_KEY, username.trim()); } catch { /* opcional */ }
    onRun({ credentials: { username: username.trim(), password }, confirmModified });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ejecutar en TKC · {label}</DialogTitle>
          <DialogDescription>
            Se monta <strong>un documento</strong> en TKC con los ítems pendientes. Queda «editado»: confirmarlo en TKC es otro paso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>
            <strong className="tabular-nums">{pending}</strong> ítem(s) pendientes de ejecutar.
          </p>
          {modified > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 p-2.5 text-xs cursor-pointer">
              <Checkbox checked={confirmModified} onCheckedChange={(v) => setConfirmModified(!!v)} className="mt-0.5" />
              <span>
                <AlertTriangle className="inline h-3.5 w-3.5 text-amber-600 mr-1" />
                {modified} ítem(s) cambiaron de cantidad después de ejecutarse. No se reenvían solos: marca esta casilla para enviar
                <strong> solo la diferencia</strong> (si la cantidad subió).
              </span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">Usuario de TKC</span>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className="h-8" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">Contraseña de TKC</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-8"
                onKeyDown={(e) => { if (e.key === "Enter" && canRun) run(); }} />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            La cuenta se envía solo con esta petición, sellada, y no se guarda ni se registra. Si lo prefieres, puedes copiar el script y ejecutarlo a mano.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onCopyScript} disabled={running || !pending} className="gap-1.5 sm:mr-auto">
            <ClipboardList className="h-3.5 w-3.5" /> Copiar script
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={running}>Cancelar</Button>
          <Button size="sm" onClick={run} disabled={!canRun} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            Ejecutar en TKC
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
