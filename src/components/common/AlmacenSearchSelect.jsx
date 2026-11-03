import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const MAX_SHOWN = 150;

/**
 * Selector de varios almacenes con búsqueda mientras se escribe (igual que el de suministrador,
 * pero con selección múltiple). Escribe parte del nombre o del código ("593", "1053", "SUB")
 * y marca los que quieras; el panel se queda abierto para marcar varios.
 */
export default function AlmacenSearchSelect({ label, options, value, onChange, placeholder, loading, disabled, size = "md" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (opt) => onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);

  return (
    <div className="space-y-1.5" ref={ref}>
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="relative">
        <div className={`flex items-center ${size === "sm" ? "h-8 text-xs" : "h-9 text-sm"} border rounded-md bg-background overflow-hidden transition-colors ${open ? "border-primary ring-1 ring-ring" : "border-input"} ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
          <Search size={13} className="ml-2.5 text-muted-foreground shrink-0" />
          <input
            className="flex-1 px-2 h-full outline-none bg-transparent placeholder:text-muted-foreground"
            placeholder={loading ? "Cargando almacenes..." : placeholder ?? "Buscar almacén..."}
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && filtered.length === 1) { e.preventDefault(); toggle(filtered[0]); setSearch(""); }
            }}
            disabled={loading || disabled}
          />
          {search && (
            <button onClick={() => setSearch("")} className="px-1.5 hover:text-destructive shrink-0" title="Borrar búsqueda"><X size={11} /></button>
          )}
          <ChevronDown size={12} className={`mr-2 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>

        {open && (
          <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Sin coincidencias</div>
            ) : (
              <>
                {value.length > 0 && (
                  <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-muted-foreground italic border-b border-border/50"
                    onClick={() => onChange([])}>
                    Limpiar selección ({value.length})
                  </button>
                )}
                {filtered.slice(0, MAX_SHOWN).map(o => (
                  <label key={o} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer text-xs select-none">
                    <Checkbox checked={value.includes(o)} onCheckedChange={() => toggle(o)} />
                    <span className="truncate">{o}</span>
                  </label>
                ))}
                {filtered.length > MAX_SHOWN && (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/50">
                    Mostrando {MAX_SHOWN} de {filtered.length} — escribe más para filtrar
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.map(v => (
            <Badge key={v} variant="secondary" className="text-[10px] gap-1 pl-2 pr-1">
              <span className="truncate max-w-[160px]">{v}</span>
              <button onClick={() => onChange(value.filter(x => x !== v))} className="ml-0.5 hover:text-destructive rounded-sm"><X size={10} /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
