import React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Barra de filtros compacta: una sola franja que se parte en varias líneas solo si hace falta. */
export function FilterBar({ children, className }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl border border-border bg-card/60 px-3 py-2 shadow-sm", className)}>
      {children}
    </div>
  );
}

/** Un filtro con icono en lugar de rótulo de texto; `label` aparece al pasar el cursor por el icono. */
export function FilterField({ icon: Icon, label, children, className }) {
  return (
    <div className={cn("flex items-start gap-1.5 min-w-0", className)}>
      <span title={label} className="shrink-0 h-8 inline-flex items-center text-muted-foreground" aria-label={label}><Icon size={15} /></span>
      {children}
    </div>
  );
}

/** Buscador estrecho con botón para borrar. */
export function FilterSearch({ value, onChange, placeholder = "Buscar…", className }) {
  return (
    <div className={cn("relative w-[190px] shrink-0", className)}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-7 text-xs shadow-sm transition-all duration-200 placeholder:text-muted-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/25"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Borrar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
