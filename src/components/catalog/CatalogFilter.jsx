import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X, Filter } from "lucide-react";

export default function CatalogFilters({ filters, onFiltersChange, suministradores = [] }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clear = () => {
    onFiltersChange({
      search: "", revision: "all", estado_anuncio: "all",
      usa_catalogo: "all", has_catalog_diff: "all", categoria_online: "all",
      suministrador: "all", stock_status: "all",
    });
  };

  const hasActiveFilters = Object.entries(filters).some(
    ([k, v]) => v && v !== "" && v !== "all"
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nombre, marca..."
            value={filters.search || ""}
            onChange={(e) => update("search", e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Select value={filters.stock_status || "all"} onValueChange={(v) => update("stock_status", v)}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Stock" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo Stock</SelectItem>
            <SelectItem value="in_stock">Con Stock</SelectItem>
            <SelectItem value="no_stock">Sin Stock</SelectItem>
            <SelectItem value="reserva_only">Solo Reserva</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.estado_anuncio || "all"} onValueChange={(v) => update("estado_anuncio", v)}>
          <SelectTrigger className="w-[185px] h-9">
            <SelectValue placeholder="Estado anuncio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="Activo">Activo</SelectItem>
            <SelectItem value="Pausado">Pausado</SelectItem>
            <SelectItem value="Cerrado">Cerrado</SelectItem>
            <SelectItem value="Inactivo">Inactivo</SelectItem>
            <SelectItem value="SIN ID EF>0">Sin ID — EF &gt; 0</SelectItem>
            <SelectItem value="SIN ID EF=0">Sin ID — EF = 0</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} className="h-9">
          <Filter size={14} className="mr-1" />
          Más filtros
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clear} className="h-9 text-destructive">
            <X size={14} className="mr-1" />
            Limpiar
          </Button>
        )}
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg">
          <Select value={filters.revision || "all"} onValueChange={(v) => update("revision", v)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Revisión" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Revisión: Todas</SelectItem>
              <SelectItem value="yes">En revisión</SelectItem>
              <SelectItem value="no">Sin revisión</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.usa_catalogo || "all"} onValueChange={(v) => update("usa_catalogo", v)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Catálogo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Catálogo: Todas</SelectItem>
              <SelectItem value="yes">Con catálogo</SelectItem>
              <SelectItem value="no">Sin catálogo</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.has_catalog_diff || "all"} onValueChange={(v) => update("has_catalog_diff", v)}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Diff catálogo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Diff: Todas</SelectItem>
              <SelectItem value="yes">Con diferencias</SelectItem>
              <SelectItem value="no">Sin diferencias</SelectItem>
            </SelectContent>
          </Select>

          {suministradores.length > 0 && (
            <Select value={filters.suministrador || "all"} onValueChange={(v) => update("suministrador", v)}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="Suministrador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los suministradores</SelectItem>
                {suministradores.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}