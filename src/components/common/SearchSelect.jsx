import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 150;
const SIZES = {
  xs: "h-7 text-xs",
  sm: "h-8 text-xs",
  md: "h-9 text-sm",
};

/**
 * Selector de UNA opción con búsqueda mientras se escribe (para almacenes, suministradores, proveedores…).
 * Sustituye al <Select> normal: al hacer clic se puede escribir para filtrar la lista y elegir.
 *
 *   options:   ["A", "B"]  o  [{ value, label }]
 *   allValue:  si se pasa, la primera opción es "Todos" y devuelve ese valor (p. ej. "all" o "")
 *   allLabel:  texto de esa opción ("Todos los almacenes")
 *   value:     valor elegido (allValue o "" = nada elegido → se muestra el placeholder/allLabel)
 */
export default function SearchSelect({
  value, onChange, options = [], allValue, allLabel = "Todos", placeholder = "Seleccionar…",
  className, size = "sm", disabled = false, loading = false, clearable = false, emptyText = "Sin coincidencias",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const opts = useMemo(
    () => options.map(o => (typeof o === "string" ? { value: o, label: o } : o)),
    [options],
  );
  const hasAll = allValue !== undefined;
  const isAll = hasAll && value === allValue;
  const selected = opts.find(o => o.value === value);
  const shownLabel = isAll ? allLabel : (selected?.label ?? "");

  const q = search.toLowerCase().trim();
  const filtered = useMemo(
    () => (q ? opts.filter(o => String(o.label).toLowerCase().includes(q)) : opts),
    [opts, q],
  );
  const showAllRow = hasAll && (!q || String(allLabel).toLowerCase().includes(q));

  const pick = (v) => { onChange(v); setOpen(false); setSearch(""); };
  const canClear = clearable && value !== undefined && value !== "" && !isAll;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div className={cn(
        "flex items-center border rounded-md bg-background overflow-hidden transition-colors",
        SIZES[size] ?? SIZES.sm,
        open ? "border-primary ring-1 ring-ring" : "border-input",
        disabled && "opacity-50 pointer-events-none",
      )}>
        <Search size={12} className="ml-2 text-muted-foreground shrink-0" />
        <input
          className="flex-1 min-w-0 px-2 h-full outline-none bg-transparent placeholder:text-foreground/80 text-inherit"
          // Cerrado: muestra lo elegido. Abierto: se escribe, y lo elegido queda como pista (placeholder).
          value={open ? search : shownLabel}
          placeholder={open ? (shownLabel || placeholder) : placeholder}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setSearch(""); }}
          onKeyDown={e => {
            if (e.key === "Escape") { setOpen(false); setSearch(""); e.currentTarget.blur(); }
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length > 0 && q) pick(filtered[0].value);
              else if (showAllRow && !q) pick(allValue);
            }
          }}
          disabled={disabled || loading}
        />
        {canClear && (
          <button type="button" onClick={() => pick(hasAll ? allValue : "")} className="px-1 hover:text-destructive shrink-0" title="Quitar selección">
            <X size={11} />
          </button>
        )}
        <ChevronDown size={11} className={cn("mr-2 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full w-max max-w-[420px] bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto text-xs">
          {loading ? (
            <div className="px-3 py-2 text-muted-foreground">Cargando…</div>
          ) : (
            <>
              {showAllRow && (
                <button type="button"
                  className={cn("w-full text-left px-3 py-1.5 hover:bg-accent italic text-muted-foreground border-b border-border/50", isAll && "bg-accent/60 font-medium not-italic text-foreground")}
                  onClick={() => pick(allValue)}>
                  {allLabel}
                </button>
              )}
              {filtered.length === 0 && !showAllRow && <div className="px-3 py-2 text-muted-foreground">{emptyText}</div>}
              {filtered.slice(0, MAX_SHOWN).map(o => (
                <button key={String(o.value)} type="button"
                  className={cn("w-full text-left px-3 py-1.5 hover:bg-accent", o.value === value && "bg-accent/60 font-medium")}
                  onClick={() => pick(o.value)}>
                  {o.label}
                </button>
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
  );
}
