import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterBar, FilterField, FilterSearch } from "@/components/common/FilterBar";
import { X, Boxes, Tag } from "lucide-react";

// `leading`: filtros que pone la pantalla al inicio de la misma franja (almacén, suministrador)
export default function CatalogFilters({ filters, onFiltersChange, availableEstados = [], leading = null, trailing = null }) {
  const update = (key, value) => onFiltersChange({ ...filters, [key]: value });

  const clear = () => {
    onFiltersChange({
      search: "", revision: "all", estado_anuncio: "all",
      usa_catalogo: "all", has_catalog_diff: "all", categoria_online: "all",
      suministrador: "all", stock_status: "all",
    });
  };

  const hasActiveFilters = Object.entries(filters).some(([, v]) => v && v !== "" && v !== "all");

  return (
    <FilterBar>
      {leading}

      <FilterSearch
        value={filters.search || ""}
        onChange={(v) => update("search", v)}
        placeholder="Código, nombre o marca…"
        className="w-[200px]"
      />

      <FilterField icon={Boxes} label="Stock">
        <Select value={filters.stock_status || "all"} onValueChange={(v) => update("stock_status", v)}>
          <SelectTrigger className="w-[125px] h-8 text-xs"><SelectValue placeholder="Stock" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo stock</SelectItem>
            <SelectItem value="in_stock">Con stock</SelectItem>
            <SelectItem value="no_stock">Sin stock</SelectItem>
            <SelectItem value="reserva_only">Solo reserva</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField icon={Tag} label="Estado de anuncio">
        <Select value={filters.estado_anuncio || "all"} onValueChange={(v) => update("estado_anuncio", v)}>
          <SelectTrigger className="w-[165px] h-8 text-xs"><SelectValue placeholder="Estado anuncio" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {availableEstados.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>

      {hasActiveFilters && (
        <button type="button" onClick={clear} title="Quitar todos los filtros"
          className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors">
          <X size={13} /> Limpiar
        </button>
      )}

      {trailing}
    </FilterBar>
  );
}
