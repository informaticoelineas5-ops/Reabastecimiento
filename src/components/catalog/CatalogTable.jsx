import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ImageOff } from "lucide-react";
import { SELECTABLE_INDICES } from "@/api/userPreferencesClient";

function getEstadoStyle(estado) {
  if (!estado) return 'bg-muted/50 text-muted-foreground';
  const v = estado.toLowerCase();
  if (v === 'activo' || v === 'activado' || v === 'active') return 'bg-chart-2/15 text-chart-2';
  if (v === 'pausado' || v === 'paused' || v === 'pausa')   return 'bg-warning/10 text-warning';
  if (v === 'cerrado' || v === 'closed')                    return 'bg-destructive/10 text-destructive';
  if (v.includes('inactivo') || v.includes('inactive') || v.includes('desactivado')) return 'bg-yellow-500/10 text-yellow-600';
  if (v === 'sin id ef>0') return 'bg-orange-500/10 text-orange-600';
  if (v === 'sin id ef=0') return 'bg-muted/60 text-muted-foreground';
  return 'bg-muted/50 text-muted-foreground';
}

export default function CatalogTable({ offers, sortField, sortDir, onSort, selectedIndices = [] }) {
  const activeIndices = SELECTABLE_INDICES.filter(i => selectedIndices.includes(i.key));

  const handleSort = (field) => {
    if (sortField === field) {
      onSort(field, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSort(field, "asc");
    }
  };

  const SortHeader = ({ field, children, className }) => (
    <TableHead
      className={`cursor-pointer hover:text-foreground select-none text-xs ${className || ""}`}
      onClick={() => handleSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </span>
    </TableHead>
  );

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10 text-xs">Foto</TableHead>
              <SortHeader field="codigo">Código</SortHeader>
              <SortHeader field="nombre" className="min-w-[200px]">Nombre</SortHeader>
              <SortHeader field="marca">Marca</SortHeader>
              <TableHead className="text-xs">Proveedor</TableHead>
              <SortHeader field="offer_external_id">Oferta ID</SortHeader>
              <SortHeader field="precio">Precio</SortHeader>
              <SortHeader field="existencia_fisica">Exist.</SortHeader>
              <TableHead className="text-xs">Reserva</TableHead>
              <TableHead className="text-xs">Tienda</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Rev.</TableHead>
              {activeIndices.map(({ key, short, label }) => (
                <TableHead key={key} className="text-xs text-right" title={label}>{short}</TableHead>
              ))}
              <TableHead className="text-xs text-right" title="Índice AVG">I.AVG</TableHead>
              <TableHead className="text-xs" title="Categoría por Ventas">Cat.V</TableHead>
              <TableHead className="text-xs w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.map((offer) => (
              <TableRow key={offer.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="p-2">
                  {offer.fotos?.[0] ? (
                    <img src={offer.fotos[0]} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                      <ImageOff size={12} className="text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs font-mono font-medium">{offer.codigo}</TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{offer.nombre}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{offer.marca || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{offer.proveedor || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{offer.offer_external_id}</TableCell>
                <TableCell className="text-xs font-medium">${offer.precio?.toFixed(2) || "0.00"}</TableCell>
                <TableCell className={`text-xs font-bold ${offer.existencia_fisica === 0 ? "text-destructive" : "text-foreground"}`}>
                  {offer.existencia_fisica ?? 0}
                </TableCell>
                <TableCell className="text-xs">{offer.stock_reserva ?? 0}</TableCell>
                <TableCell className="text-xs">{offer.stock_tienda ?? 0}</TableCell>
                <TableCell>
                  {offer.estadoAnuncio
                    ? <Badge className={`text-[10px] ${getEstadoStyle(offer.estadoAnuncio)}`}>{offer.estadoAnuncio}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </TableCell>
                <TableCell className="text-xs">
                  {offer.revision && <Badge className="bg-warning/10 text-warning text-[10px]">Sí</Badge>}
                </TableCell>
                {activeIndices.map(({ key }) => (
                  <TableCell key={key} className="text-xs text-right font-mono">
                    {offer.indices?.[key] != null ? Number(offer.indices[key]).toFixed(3) : '—'}
                  </TableCell>
                ))}
                <TableCell className="text-xs text-right font-mono">
                  {offer.indiceAvg != null ? offer.indiceAvg.toFixed(3) : '—'}
                </TableCell>
                <TableCell className="text-xs font-medium text-center">
                  {offer.categoriaVentas != null
                    ? <Badge className={`text-[10px] ${offer.categoriaVentas === 'A' ? 'bg-chart-2/15 text-chart-2' : offer.categoriaVentas === 'B' ? 'bg-chart-3/15 text-chart-3' : offer.categoriaVentas === 'C' ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground'}`}>{offer.categoriaVentas}</Badge>
                    : '—'
                  }
                </TableCell>
                <TableCell className="p-1">
                  <Link
                    to={createPageUrl("OfferDetail") + `?id=${offer.id}`}
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink size={14} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {offers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9 + activeIndices.length + 2} className="text-center text-muted-foreground py-12 text-sm">
                  No se encontraron ofertas con los filtros seleccionados
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
