import React, { useEffect, useRef, useState } from "react";
import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const text = (v, ctx) => (typeof v === "function" ? v(ctx) : v);

/**
 * Selector de columnas de una tabla: marcar para mostrar/ocultar y arrastrar para ordenar.
 *   columns:  [{ id, label | (ctx) => label, section }]
 *   sections: { [section]: { label, hdr } }   (hdr = clases de color del rótulo)
 *   order / hidden (Set) / onChange(order, hidden) · defaultOrder para "Restablecer"
 */
export default function ColumnChooser({ columns, sections, order, hidden, defaultOrder, ctx, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const byId = Object.fromEntries(columns.map(c => [c.id, c]));
  const total = order.length;
  const visibles = total - hidden.size;

  const onDragEnd = (res) => {
    if (!res.destination || res.destination.index === res.source.index) return;
    const next = [...order];
    const [moved] = next.splice(res.source.index, 1);
    next.splice(res.destination.index, 0, moved);
    onChange(next, hidden);
  };
  const toggle = (id) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id);
    else if (total - h.size > 1) h.add(id); // siempre queda al menos una columna
    onChange(order, h);
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setOpen(o => !o)} title="Elegir y ordenar las columnas de la tabla">
        <Columns3 size={13} />
        Columnas
        <span className="text-[10px] text-muted-foreground tabular-nums">{visibles}/{total}</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-lg shadow-lg">
          <p className="px-3 pt-2.5 pb-1.5 text-[11px] text-muted-foreground">Marca las que quieres ver y arrástralas para ordenarlas.</p>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="columnas">
              {(prov) => (
                <div ref={prov.innerRef} {...prov.droppableProps} className="max-h-[55vh] overflow-y-auto px-1.5 pb-1">
                  {order.map((id, index) => {
                    const col = byId[id];
                    if (!col) return null;
                    const sec = sections[col.section];
                    return (
                      <Draggable key={id} draggableId={id} index={index}>
                        {(p, snap) => (
                          <div
                            ref={p.innerRef} {...p.draggableProps}
                            className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-xs select-none bg-popover", snap.isDragging ? "shadow-lg ring-1 ring-primary/40" : "hover:bg-accent")}
                          >
                            <span {...p.dragHandleProps} className="cursor-grab text-muted-foreground/60 hover:text-foreground" title="Arrastra para ordenar">
                              <GripVertical size={14} />
                            </span>
                            <Checkbox checked={!hidden.has(id)} onCheckedChange={() => toggle(id)} />
                            <span className={cn("flex-1 truncate", hidden.has(id) && "text-muted-foreground line-through")}>{text(col.label, ctx)}</span>
                            {sec && <span className={cn("text-[9px] px-1.5 py-0.5 rounded", sec.hdr)}>{sec.label}</span>}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {prov.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/60">
            <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange(order, new Set())}>Mostrar todas</button>
            <button className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => onChange(defaultOrder, new Set())}>
              <RotateCcw size={11} /> Restablecer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
