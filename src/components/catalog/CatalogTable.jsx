import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ImageOff, HelpCircle, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import SmartImg from "@/components/common/SmartImg";
import { productImageUrl } from "@/utils/productImage";
import IndicesHelpModal from "@/components/IndicesHelpModal";
import ColumnChooser from "@/components/common/ColumnChooser";
import { useColumnLayout } from "@/hooks/useColumnLayout";
import { useProcurementUser } from "@/hooks/useProcurementUser";

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

// Columnas de la tabla (el usuario elige cuáles ve y en qué orden). Los índices de venta no se muestran uno a uno:
// solo el promedio (I.AVG) y la categoría, que ya se calculan con los índices seleccionados en Índices de Ventas.
const BASE_BEFORE = [
  { id: "foto",              label: "Foto" },
  { id: "codigo",            label: "Código" },
  { id: "nombre",            label: "Nombre" },
  { id: "marca",             label: "Marca" },
  { id: "proveedor",         label: "Proveedor" },
  { id: "offer_external_id", label: "Oferta ID" },
  { id: "precio",            label: "Precio" },
  { id: "existencia_fisica", label: "Exist." },
  { id: "reserva",           label: "Reserva" },
  { id: "tienda",            label: "Tienda" },
  { id: "estado",            label: "Estado" },
  { id: "rev",               label: "Rev." },
];
const BASE_AFTER = [
  { id: "iavg", label: "I.AVG" },
  { id: "catv", label: "Cat.V" },
];
const DEFAULT_ORDER = [...BASE_BEFORE, ...BASE_AFTER].map(c => c.id);
const NUMERIC_SORT = new Set(["precio", "existencia_fisica"]);   // la primera vez se ordenan de mayor a menor

export default function CatalogTable({ offers, sortField, sortDir, onSort, onSelectProduct, toolbarEl = null }) {
  const [showHelp, setShowHelp] = useState(false);
  const { user } = useProcurementUser();
  const { order, hidden, change } = useColumnLayout("catalogo-columnas", user?.email ?? "", DEFAULT_ORDER);

  const handleSort = (field) => {
    if (sortField === field) onSort(field, sortDir === "asc" ? "desc" : "asc");
    else onSort(field, NUMERIC_SORT.has(field) ? "desc" : "asc");
  };

  // Definición de cada columna: encabezado y celda
  const columns = useMemo(() => [
    {
      id: "foto", label: "Foto", th: "w-10",
      td: "p-2",
      content: (o) => o.fotos?.[0]
        ? <SmartImg src={productImageUrl(o.codigo, "sm")} fallback={o.fotos[0]} loading="lazy" decoding="async" className="h-8 w-8 rounded object-cover" />
        : <div className="h-8 w-8 rounded bg-muted flex items-center justify-center"><ImageOff size={12} className="text-muted-foreground" /></div>,
    },
    { id: "codigo", label: "Código", sortKey: "codigo", td: "font-mono font-medium", content: (o) => o.codigo },
    { id: "nombre", label: "Nombre", sortKey: "nombre", th: "min-w-[200px]", td: "max-w-[200px] truncate", content: (o) => o.nombre },
    { id: "marca", label: "Marca", sortKey: "marca", td: "text-muted-foreground", content: (o) => o.marca || "—" },
    { id: "proveedor", label: "Proveedor", td: "text-muted-foreground", content: (o) => o.proveedor || "—" },
    { id: "offer_external_id", label: "Oferta ID", sortKey: "offer_external_id", td: "font-mono", content: (o) => o.offer_external_id },
    { id: "precio", label: "Precio", sortKey: "precio", td: "font-medium", content: (o) => `$${o.precio?.toFixed(2) || "0.00"}` },
    {
      id: "existencia_fisica", label: "Exist.", sortKey: "existencia_fisica",
      td: "font-bold", tdExtra: (o) => (o.existencia_fisica === 0 ? "text-destructive" : "text-foreground"),
      content: (o) => o.existencia_fisica ?? 0,
    },
    { id: "reserva", label: "Reserva", content: (o) => o.stock_reserva ?? 0 },
    { id: "tienda", label: "Tienda", content: (o) => o.stock_tienda ?? 0 },
    {
      id: "estado", label: "Estado", td: "",
      content: (o) => o.estadoAnuncio
        ? <Badge className={`text-[10px] ${getEstadoStyle(o.estadoAnuncio)}`}>{o.estadoAnuncio}</Badge>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    { id: "rev", label: "Rev.", content: (o) => (o.revision ? <Badge className="bg-warning/10 text-warning text-[10px]">Sí</Badge> : null) },
    {
      id: "iavg", label: "I.AVG", title: "Índice AVG", right: true, td: "font-mono",
      thExtra: () => (
        <button onClick={(e) => { e.stopPropagation(); setShowHelp(true); }} className="text-muted-foreground/40 hover:text-primary transition-colors" tabIndex={-1} title="¿Qué significan los índices?">
          <HelpCircle size={11} />
        </button>
      ),
      content: (o) => (o.indiceAvg != null ? o.indiceAvg.toFixed(3) : "—"),
    },
    {
      id: "catv", label: "Cat.V", title: "Categoría por Ventas", td: "font-medium text-center",
      content: (o) => (o.categoriaVentas != null
        ? <Badge className={`text-[10px] ${o.categoriaVentas === 'A' ? 'bg-chart-2/15 text-chart-2' : o.categoriaVentas === 'B' ? 'bg-chart-3/15 text-chart-3' : o.categoriaVentas === 'C' ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground'}`}>{o.categoriaVentas}</Badge>
        : '—'),
    },
  ], []);

  // Solo las columnas disponibles (los índices no seleccionados no existen) entran al selector
  const available = useMemo(() => new Set(columns.filter(c => c.available !== false).map(c => c.id)), [columns]);
  const availableColumns = useMemo(() => columns.filter(c => available.has(c.id)), [columns, available]);
  const availableOrder = useMemo(() => order.filter(id => available.has(id)), [order, available]);
  // Al reordenar solo se mueven las disponibles; las demás conservan su sitio
  const onLayoutChange = (newAvailOrder, newHidden) => {
    let k = 0;
    change(order.map(id => (available.has(id) ? newAvailOrder[k++] : id)), newHidden);
  };

  const byId = useMemo(() => Object.fromEntries(columns.map(c => [c.id, c])), [columns]);
  const visibleCols = availableOrder.map(id => byId[id]).filter(c => c && !hidden.has(c.id));

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      {/* El selector de columnas va en la franja de filtros de la pantalla (toolbarEl); si no hay, queda sobre la tabla */}
      {(() => {
        const chooser = <ColumnChooser columns={availableColumns} sections={{}} order={availableOrder} hidden={hidden} defaultOrder={DEFAULT_ORDER.filter(id => available.has(id))} onChange={onLayoutChange} />;
        return toolbarEl
          ? createPortal(chooser, toolbarEl)
          : <div className="flex items-center justify-end px-3 py-2 border-b bg-muted/20">{chooser}</div>;
      })()}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {visibleCols.map((col) => {
                const active = col.sortKey && sortField === col.sortKey;
                return (
                  <TableHead
                    key={col.id}
                    title={col.title}
                    onClick={col.sortKey ? () => handleSort(col.sortKey) : undefined}
                    className={`text-xs ${col.right ? "text-right" : ""} ${col.th ?? ""} ${col.sortKey ? "cursor-pointer hover:text-foreground select-none" : ""} ${active ? "text-foreground" : ""}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.right ? "justify-end" : ""}`}>
                      {col.label}
                      {col.sortKey && (active
                        ? (sortDir === "asc" ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />)
                        : <ArrowUpDown size={10} className="opacity-30" />)}
                      {col.thExtra?.()}
                    </span>
                  </TableHead>
                );
              })}
              <TableHead className="text-xs w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.map((offer) => (
              <TableRow key={offer.id} className="hover:bg-muted/30 transition-colors">
                {visibleCols.map((col) => (
                  <TableCell key={col.id} className={`text-xs ${col.right ? "text-right" : ""} ${col.td ?? ""} ${col.tdExtra?.(offer) ?? ""}`}>
                    {col.content(offer)}
                  </TableCell>
                ))}
                <TableCell className="p-1">
                  <button
                    onClick={() => onSelectProduct?.(offer)}
                    className="text-primary hover:text-primary/80 p-1 rounded transition-colors"
                    title="Ver detalle"
                  >
                    <ExternalLink size={14} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
            {offers.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleCols.length + 1} className="text-center text-muted-foreground py-12 text-sm">
                  No se encontraron ofertas con los filtros seleccionados
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <IndicesHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
