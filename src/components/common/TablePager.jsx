import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SIZES = [50, 100, 200, 500];

/** Pie de tabla con paginado: rango visible, Anterior/Siguiente y filas por página. `page` empieza en 0. */
export default function TablePager({ page, pageSize, total, onPage, onPageSize, className = "" }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className={`flex items-center justify-between flex-wrap gap-2 px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground ${className}`}>
      <span>Mostrando {from.toLocaleString()}–{to.toLocaleString()} de {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SIZES.map(n => <SelectItem key={n} value={String(n)}>{n} por página</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 0} onClick={() => onPage(page - 1)}>Anterior</Button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
