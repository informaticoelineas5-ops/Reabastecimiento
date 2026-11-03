import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHANGELOG, CURRENT_VERSION } from "@/data/changelog";
import { Sparkles, Wrench, Bug, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

const TYPE_CONFIG = {
  new:     { label: "Nuevo",   icon: Sparkles, cls: "bg-primary/10 text-primary border-primary/30" },
  improve: { label: "Mejora",  icon: Wrench,   cls: "bg-info/10 text-info border-info/30" },
  fix:     { label: "Correc.", icon: Bug,       cls: "bg-success/10 text-success border-success/30" },
};

function ReleaseBlock({ release, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const newCount     = release.changes.filter(c => c.type === "new").length;
  const improveCount = release.changes.filter(c => c.type === "improve").length;
  const fixCount     = release.changes.filter(c => c.type === "fix").length;

  return (
    <div className={`rounded-xl border ${defaultOpen ? "border-primary/30 bg-primary/3" : "border-border bg-muted/20"}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${defaultOpen ? "text-primary" : "text-foreground"}`}>
                v{release.version}
              </span>
              <span className="text-xs text-muted-foreground">{release.date}</span>
              {defaultOpen && (
                <Badge className="text-[10px] bg-primary/10 text-primary border-primary/30 border">Actual</Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[280px]">{release.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {newCount > 0 && <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">{newCount} nuevo{newCount > 1 ? "s" : ""}</span>}
          {improveCount > 0 && <span className="text-[10px] bg-info/10 text-info rounded px-1.5 py-0.5">{improveCount} mejora{improveCount > 1 ? "s" : ""}</span>}
          {fixCount > 0 && <span className="text-[10px] bg-success/10 text-success rounded px-1.5 py-0.5">{fixCount} correc.</span>}
          {open ? <ChevronUp size={14} className="text-muted-foreground ml-1" /> : <ChevronDown size={14} className="text-muted-foreground ml-1" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-1.5 border-t border-border/50 pt-3">
          {release.changes.map((change, i) => {
            const cfg = TYPE_CONFIG[change.type] || TYPE_CONFIG.improve;
            const Icon = cfg.icon;
            return (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <Badge variant="outline" className={`text-[10px] flex items-center gap-1 shrink-0 mt-0.5 py-0.5 px-1.5 border ${cfg.cls}`}>
                  <Icon size={9} /> {cfg.label}
                </Badge>
                <span className="text-sm leading-snug">{change.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WhatsNewModal({ open, onClose }) {
  const current = CHANGELOG[0];
  const previous = CHANGELOG.slice(1);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden"
        style={{ maxWidth: "min(600px, 95vw)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-primary to-primary/70 px-6 py-5 text-white shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
              <RefreshCw size={20} className="text-white" />
            </div>
            <div>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide">ELINEAS · Reabastecimiento</p>
              <h2 className="text-xl font-bold text-white leading-tight">¡Novedades de la versión {CURRENT_VERSION}!</h2>
            </div>
          </div>
          <p className="text-sm text-white/80 mt-1">{current?.title}</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Current release */}
          {current && <ReleaseBlock release={current} defaultOpen={true} />}

          {/* Previous releases */}
          {previous.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground font-medium pt-1">Versiones anteriores</p>
              {previous.map(r => (
                <ReleaseBlock key={r.version} release={r} defaultOpen={false} />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Este resumen solo aparece una vez por actualización.
          </p>
          <Button onClick={onClose} className="shrink-0">
            <Sparkles size={14} className="mr-1.5" /> Entendido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
