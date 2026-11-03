import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import SearchSelect from "@/components/common/SearchSelect";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Download, Package, Loader2, Warehouse, Building2 } from "lucide-react";
import { FilterField } from "@/components/common/FilterBar";
import CatalogFilters from "../components/catalog/CatalogFilter";
import CatalogTable from "../components/catalog/CatalogTable";
import ExportPDF from "../components/catalog/ExportPDF";
import ExportExcel from "../components/catalog/ExportExcel";
import OfferDetail from "@/pages/OfferDetail";
import { fetchIndgPaginated, fetchIndgAll } from "@/api/indgApSubClient";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import { computeIndiceAvg, calcCategoria } from "@/api/salesIndicesClient";
import { getUserPreferences, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";

const PAGE_SIZE = 50;

// Mapea campos UI → columnas reales en la tabla external `products`
const SORT_MAP = {
  offer_external_id: "id_online",
  existencia_fisica:  "cantidad",
  stock_reserva:      "reserved_qty",
};

// Normaliza un producto externo al formato que espera CatalogTable
function normalizeProduct(p, selectedKeys = []) {
  const indices = p.indices ?? null;
  const indiceAvg = computeIndiceAvg(indices, selectedKeys);
  return {
    ...p,
    offer_external_id: p.id_online,
    existencia_fisica:  p.cantidad     ?? 0,
    stock_reserva:      p.reserved_qty ?? 0,
    stock_tienda:       0,
    fotos: Array.isArray(p.fotos) ? p.fotos.map(f => f.foto).filter(Boolean) : [],
    indices,
    indiceAvg,
    categoriaVentas: calcCategoria(indiceAvg),
    estadoAnuncio: !p.id_online
      ? ((p.cantidad ?? 0) > 0 ? 'SIN ID EF>0' : 'SIN ID EF=0')
      : (p.estadoAnuncio ?? null),
  };
}

function buildServerQuery(filters, almacenes, suministradores, almacenFilter, sortField, sortDir, page) {
  const conditions   = {};
  const extraFilters = [];

  // Almacén filter: specific filter takes precedence, else use all configured
  if (almacenFilter && almacenFilter !== "all") {
    conditions.proveedor = almacenFilter;
  } else if (almacenes.length === 1) {
    conditions.proveedor = almacenes[0];
  } else if (almacenes.length > 1) {
    conditions.proveedor = almacenes;
  }

  // Suministrador filter: specific filter takes precedence, else use configured list
  if (filters.suministrador !== "all") {
    conditions.suministrador = filters.suministrador;
  } else if (suministradores.length > 0) {
    if (suministradores.length === 1) conditions.suministrador = suministradores[0];
    else conditions.suministrador = suministradores;
  }

  if (filters.revision === "yes")   conditions.revision = true;
  if (filters.revision === "no")    conditions.revision = false;
  if (filters.usa_catalogo === "yes")     conditions.usa_catalogo = true;
  if (filters.usa_catalogo === "no")      conditions.usa_catalogo = false;
  if (filters.has_catalog_diff === "yes") conditions.has_catalog_diff = true;
  if (filters.has_catalog_diff === "no")  conditions.has_catalog_diff = false;

  if (filters.categoria_online !== "all") conditions.categoria_online = filters.categoria_online;

  // stock_status applied client-side (API does not support range filters)

  const search = filters.search?.trim()
    ? { text: filters.search, columns: ["nombre", "codigo"] }
    : null;

  const dbField = SORT_MAP[sortField] || sortField;

  return {
    conditions,
    search,
    extraFilters,
    orderBy: sortDir === "desc" ? `-${dbField}` : dbField,
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
}

export default function Catalog() {
  const [almacenFilter, setAlmacenFilter] = useState("all");
  const [filters, setFilters] = useState({
    search: "", revision: "all", estado_anuncio: "all",
    usa_catalogo: "all", has_catalog_diff: "all", categoria_online: "all",
    suministrador: "all", stock_status: "all",
  });
  const [sortField, setSortField] = useState("nombre");
  const [sortDir,   setSortDir]   = useState("asc");
  const [page, setPage]           = useState(0);
  const [exporting, setExporting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toolbarEl, setToolbarEl] = useState(null);   // hueco de la franja de filtros donde se pinta el selector de columnas

  // Preferencias del usuario vía React Query (se invalida desde SalesIndexConfig al guardar)
  const { data: userPrefs } = useQuery({
    queryKey:  ["user-preferences"],
    queryFn:   getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  // Índices seleccionados: siempre reflejan las prefs guardadas
  const selectedIndices = userPrefs?.selected_indices?.length
    ? userPrefs.selected_indices
    : DEFAULT_SELECTED_INDICES;

  // Derive configured almacenes and suministradores from user prefs
  const configuredAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  const configuredSuministradores = userPrefs?.suministradores ?? [];

  const q = buildServerQuery(filters, configuredAlmacenes, configuredSuministradores, almacenFilter, sortField, sortDir, page);

  // Cuando stock_status o estado_anuncio están activos, necesitamos todos los productos
  // para filtrar y paginar correctamente del lado del cliente (Option B)
  const clientFilterActive = filters.stock_status !== "all" || filters.estado_anuncio !== "all";

  // Consulta paginada normal (sin filtros de cliente)
  const { data: result = { data: [], total: 0 }, isLoading: loadingPaginated, isFetching: fetchingPaginated, error: errorPaginated } = useQuery({
    queryKey:  ["ext-catalog", q],
    queryFn:   () => fetchIndgPaginated(q.conditions, {
      search:       q.search,
      extraFilters: q.extraFilters,
      orderBy:      q.orderBy,
      limit:        q.limit,
      offset:       q.offset,
    }),
    keepPreviousData: true,
    enabled: !clientFilterActive && configuredAlmacenes.length > 0,
  });

  // Consulta de todos los productos (cuando filtros de cliente están activos)
  const { data: fullProducts = [], isLoading: loadingFull, isFetching: fetchingFull, error: errorFull } = useQuery({
    queryKey:  ["ext-catalog-all", q.conditions, q.search, q.orderBy],
    queryFn:   () => fetchIndgAll(q.conditions, { search: q.search, orderBy: q.orderBy }),
    enabled:   clientFilterActive && configuredAlmacenes.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const loadError  = clientFilterActive ? errorFull : errorPaginated;
  const isLoading  = clientFilterActive ? loadingFull       : loadingPaginated;
  const isFetching = clientFilterActive ? fetchingFull      : fetchingPaginated;

  // Cada fila del catálogo ya trae sus índices y su estado de anuncio (reporte indg_ap_sub).
  // Para las listas de los filtros (suministradores, estados) se usa la carga completa de los almacenes,
  // que comparten Alertas y Reab Directo; llega en segundo plano y no frena la tabla.
  const indg = useIndgAlmacenes(configuredAlmacenes, configuredAlmacenes.length > 0);
  const loadingLists = indg.loading;

  const suministradoresFiltro = useMemo(() => {
    const set = new Set();
    indg.products.forEach(p => {
      if (almacenFilter !== "all" && p.almacenSel !== almacenFilter) return;
      if (p.suministrador) set.add(p.suministrador);
    });
    return [...set].sort((x, y) => x.localeCompare(y));
  }, [indg.products, almacenFilter]);

  // If there are configured suministradores, only show those in the filter dropdown
  const suministradoresParaFiltro = configuredSuministradores.length > 0
    ? configuredSuministradores
    : suministradoresFiltro;

  // En modo client-filter: partimos de todos los productos descargados
  // En modo normal: partimos de la página del servidor
  const rawProducts = clientFilterActive
    ? fullProducts
    : (result.data ?? []);

  const allOffers = rawProducts.map(p => normalizeProduct(p, selectedIndices));

  // Filtros de cliente (stock y estado) — en modo normal estos filtros están en "all" por definición
  const filteredOffers = allOffers.filter(p => {
    if (filters.estado_anuncio !== "all" && p.estadoAnuncio !== filters.estado_anuncio) return false;
    if (filters.stock_status === "in_stock"    && (p.cantidad ?? 0) <= 0) return false;
    if (filters.stock_status === "no_stock"    && (p.cantidad ?? 0) >  0) return false;
    if (filters.stock_status === "reserva_only" && ((p.reserved_qty ?? 0) <= 0 || (p.cantidad ?? 0) > 0)) return false;
    return true;
  });

  // En modo client-filter: paginamos localmente sobre el resultado filtrado
  // En modo normal: el servidor ya nos da la página correcta
  const total = clientFilterActive ? filteredOffers.length : (result.total ?? 0);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const offers = clientFilterActive
    ? filteredOffers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : filteredOffers;

  // Unique estadoAnuncio values from the full apMap (not just current page)
  const availableEstados = React.useMemo(() => {
    const seen = new Set();
    indg.apMap.forEach(estado => { if (estado) seen.add(estado); });
    rawProducts.forEach(p => { if (p.estadoAnuncio) seen.add(p.estadoAnuncio); });
    seen.add('SIN ID EF>0');
    seen.add('SIN ID EF=0');
    return [...seen].sort();
  }, [indg.apMap, rawProducts]);

  // Resetear página al cambiar entre modo paginado-servidor y modo client-filter
  const prevClientFilterRef = React.useRef(clientFilterActive);
  React.useEffect(() => {
    if (prevClientFilterRef.current !== clientFilterActive) {
      setPage(0);
      prevClientFilterRef.current = clientFilterActive;
    }
  }, [clientFilterActive]);

  const handleFiltersChange = (f) => { setFilters(f); setPage(0); };
  const handleSort = (field, dir) => { setSortField(field); setSortDir(dir); setPage(0); };

  // Effective almacen label for export filename
  const exportAlmacenLabel = almacenFilter !== "all"
    ? almacenFilter
    : configuredAlmacenes.length === 1
      ? configuredAlmacenes[0]
      : `${configuredAlmacenes.length}_almacenes`;

  const exportCSV = async () => {
    setExporting(true);
    try {
      const all = await fetchIndgAll(q.conditions, { search: q.search, orderBy: q.orderBy });
      const norm = all.map(p => normalizeProduct(p, selectedIndices));
      const indexHeaders = selectedIndices;
      const headers = ["codigo", "nombre", "suministrador", "proveedor", "offer_external_id",
                       "precio", "existencia_fisica", "stock_reserva", "estadoAnuncio", "revision",
                       "indiceAvg", "categoriaVentas", ...indexHeaders];
      const rows = norm.map(o => headers.map(h => {
        if (selectedIndices.includes(h)) return JSON.stringify(o.indices?.[h] ?? "");
        return JSON.stringify(o[h] ?? "");
      }).join(","));
      const csv  = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `catalogo_${(exportAlmacenLabel || "").replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  // Show CTA if no almacenes configured yet
  if (userPrefs !== undefined && configuredAlmacenes.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <Warehouse size={48} className="text-muted-foreground opacity-30" />
        <h2 className="text-lg font-semibold">No tienes almacenes configurados</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Configura tus almacenes en Índices de Ventas para poder ver el catálogo.
        </p>
        <Link to="/SalesIndexImport">
          <Button size="sm">Ir a Índices de Ventas</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Catálogo</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {isFetching && <Loader2 size={10} className="animate-spin" />}
              {configuredAlmacenes.length > 0
                ? `${total.toLocaleString()} productos`
                : "Configura tus almacenes"}
            </p>
            {clientFilterActive && loadingFull && (
              <p className="text-[10px] flex items-center gap-1 mt-0.5 text-muted-foreground">
                <Loader2 size={9} className="animate-spin" />
                Descargando productos para filtrar...
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={exportCSV}
            disabled={exporting || configuredAlmacenes.length === 0}
          >
            {exporting
              ? <><Loader2 size={13} className="animate-spin mr-1.5" />Exportando...</>
              : <><Download size={14} className="mr-1.5" />CSV</>
            }
          </Button>
          <ExportExcel offers={offers} filters={filters} />
          <ExportPDF   offers={offers} filters={filters} />
        </div>
      </div>

      {/* Listas de los filtros (suministradores y estados): llegan en segundo plano */}
      {loadingLists && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin text-primary shrink-0" />
          <span className="font-medium text-foreground">Cargando listas de filtros</span>
          <span className="ml-auto text-[10px]">Suministradores y estados de anuncio aparecerán al terminar</span>
        </div>
      )}

      {configuredAlmacenes.length > 0 ? (
        <>
          {/* Filtros */}
          <CatalogFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            availableEstados={availableEstados}
            trailing={<div ref={setToolbarEl} className="ml-auto" />}
            leading={
              <>
                <FilterField icon={Warehouse} label="Almacén">
                  <SearchSelect
                    value={almacenFilter}
                    onChange={v => { setAlmacenFilter(v); setPage(0); }}
                    options={configuredAlmacenes}
                    allValue="all" allLabel={`Todos mis almacenes (${configuredAlmacenes.length})`}
                    placeholder="Almacén" size="sm" className="w-[210px]"
                  />
                </FilterField>
                {suministradoresParaFiltro.length > 0 && (
                  <FilterField icon={Building2} label="Suministrador">
                    <SearchSelect
                      value={filters.suministrador || "all"}
                      onChange={v => handleFiltersChange({ ...filters, suministrador: v })}
                      options={suministradoresParaFiltro}
                      allValue="all" allLabel="Todos los suministradores"
                      placeholder="Suministrador" size="sm" className="w-[210px]"
                    />
                  </FilterField>
                )}
              </>
            }
          />

          {loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              No se pudo cargar el catálogo: {loadError.message}
            </div>
          )}

          {/* Tabla */}
          {isLoading && !offers.length ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <CatalogTable
              offers={offers}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onSelectProduct={setSelectedProduct}
              toolbarEl={toolbarEl}
            />
          )}

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} de {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  disabled={page === 0 || isFetching}
                  onClick={() => setPage(p => p - 1)}
                >
                  Anterior
                </Button>
                <Badge variant="secondary" className="px-3 py-1">
                  {page + 1} / {totalPages}
                </Badge>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= totalPages - 1 || isFetching}
                  onClick={() => setPage(p => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Configura tus almacenes en Índices de Ventas para ver el catálogo</p>
        </div>
      )}

      {/* Product Detail Modal */}
      <Dialog open={!!selectedProduct} onOpenChange={(open) => { if (!open) setSelectedProduct(null); }}>
        <DialogContent
          className="p-0 gap-0 overflow-hidden"
          style={{ maxWidth: "min(1100px, 95vw)", width: "95vw", maxHeight: "93vh", display: "flex", flexDirection: "column" }}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Detalle del producto</DialogTitle>
          <div className="flex-1 overflow-y-auto">
            {selectedProduct && (
              <OfferDetail
                productId={
                  selectedProduct.id_online != null
                    ? String(selectedProduct.id_online)
                    : String(selectedProduct.id)
                }
                onClose={() => setSelectedProduct(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
