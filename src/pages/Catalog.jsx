import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Package, Loader2, Warehouse } from "lucide-react";
import CatalogFilters from "../components/catalog/CatalogFilter";
import CatalogTable from "../components/catalog/CatalogTable";
import ExportPDF from "../components/catalog/ExportPDF";
import ExportExcel from "../components/catalog/ExportExcel";
import { fetchExtCatalogPaginated, fetchExtSuministradoresMulti, fetchApGlobalIndex } from "@/api/externalSupabaseClient";
import { fetchSalesIndices } from "@/api/salesIndicesClient";
import { getUserPreferences, DEFAULT_SELECTED_INDICES } from "@/api/userPreferencesClient";

const PAGE_SIZE = 50;

// Mapea campos UI → columnas reales en la tabla external `products`
const SORT_MAP = {
  offer_external_id: "id_online",
  existencia_fisica:  "cantidad",
  stock_reserva:      "reserved_qty",
};

// Normaliza un producto externo al formato que espera CatalogTable
function normalizeProduct(p, salesMap, apGlobalMap) {
  const indices = salesMap?.get(String(p.id_online)) ?? null;
  return {
    ...p,
    offer_external_id: p.id_online,
    existencia_fisica:  p.cantidad     ?? 0,
    stock_reserva:      p.reserved_qty ?? 0,
    stock_tienda:       0,
    fotos: Array.isArray(p.fotos) ? p.fotos.map(f => f.foto).filter(Boolean) : [],
    indices,
    indiceAvg:       indices?.indiceAvg       ?? null,
    categoriaVentas: indices?.categoriaVentas ?? null,
    estadoAnuncio: !p.id_online
      ? ((p.cantidad ?? 0) > 0 ? 'SIN ID EF>0' : 'SIN ID EF=0')
      : (apGlobalMap?.get(String(p.id_online)) ?? null),
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

  if (filters.stock_status === "in_stock")
    extraFilters.push({ type: "gt",  column: "cantidad",     value: 0 });
  if (filters.stock_status === "no_stock")
    extraFilters.push({ type: "lte", column: "cantidad",     value: 0 });
  if (filters.stock_status === "reserva_only") {
    extraFilters.push({ type: "gt",  column: "reserved_qty", value: 0 });
    extraFilters.push({ type: "lte", column: "cantidad",     value: 0 });
  }

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

  // Consulta principal paginada
  const { data: result = { data: [], total: 0 }, isLoading, isFetching } = useQuery({
    queryKey:  ["ext-catalog", q],
    queryFn:   () => fetchExtCatalogPaginated(q.conditions, {
      search:       q.search,
      extraFilters: q.extraFilters,
      orderBy:      q.orderBy,
      limit:        q.limit,
      offset:       q.offset,
    }),
    keepPreviousData: true,
    enabled: configuredAlmacenes.length > 0,
  });

  // Índices de ventas (carga única, ~19k productos)
  const { data: salesMap = new Map(), isLoading: loadingIndices } = useQuery({
    queryKey:  ["sales-indices-db"],
    queryFn:   fetchSalesIndices,
    staleTime: 30 * 60 * 1000,
  });

  // Estados de anuncio desde apGlobalV2
  const { data: apGlobalIndex = null, isLoading: loadingApGlobal } = useQuery({
    queryKey:  ["apglobal-index-v2"],
    queryFn:   fetchApGlobalIndex,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Suministradores disponibles para el filtro: si hay suministradores configurados, usarlos;
  // de lo contrario, buscar los del almacén activo
  const effectiveAlmacenesForSumi = almacenFilter !== "all"
    ? [almacenFilter]
    : configuredAlmacenes;

  const { data: suministradoresFiltro = [] } = useQuery({
    queryKey: ["ext-sumi-multi", effectiveAlmacenesForSumi],
    queryFn:  () => fetchExtSuministradoresMulti(effectiveAlmacenesForSumi),
    staleTime: 5 * 60 * 1000,
    enabled: effectiveAlmacenesForSumi.length > 0,
  });

  // If there are configured suministradores, only show those in the filter dropdown
  const suministradoresParaFiltro = configuredSuministradores.length > 0
    ? configuredSuministradores
    : suministradoresFiltro;

  const apMap = apGlobalIndex?.map ?? null;

  const allOffers = (result.data ?? []).map(p => normalizeProduct(p, salesMap, apMap));
  const offers = filters.estado_anuncio === "all"
    ? allOffers
    : allOffers.filter(p => p.estadoAnuncio === filters.estado_anuncio);
  const total      = result.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
      const { data: all } = await fetchExtCatalogPaginated(q.conditions, {
        search: q.search, extraFilters: q.extraFilters, orderBy: q.orderBy,
        limit: 100_000, offset: 0,
      });
      const norm = all.map(p => normalizeProduct(p, salesMap, apMap));
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
            {(loadingIndices || loadingApGlobal) && (
              <p className="text-[10px] flex items-center gap-1 mt-0.5 text-muted-foreground">
                <Loader2 size={9} className="animate-spin" />
                {loadingIndices && loadingApGlobal
                  ? "Cargando índices y estados..."
                  : loadingIndices
                    ? "Cargando índices de venta..."
                    : "Cargando estados de anuncio..."
                }
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

      {/* Filtro por almacén (de los configurados) */}
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border flex-wrap">
        <Warehouse size={16} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium shrink-0">Ver almacén:</span>
        <Select value={almacenFilter} onValueChange={v => { setAlmacenFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[280px] h-9 bg-background">
            <SelectValue placeholder="Selecciona almacén..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos mis almacenes ({configuredAlmacenes.length})</SelectItem>
            {configuredAlmacenes.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        {configuredAlmacenes.length === 0 && (
          <Link to="/SalesIndexImport" className="text-xs text-warning underline">
            Configura tus almacenes en Índices de Ventas
          </Link>
        )}
        {configuredAlmacenes.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {total.toLocaleString()} productos
          </Badge>
        )}
      </div>

      {/* Barra de carga de datos secundarios */}
      {(loadingIndices || loadingApGlobal) && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin text-primary shrink-0" />
          <span className="font-medium text-foreground">Cargando datos adicionales</span>
          <span className="text-muted-foreground">—</span>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={loadingIndices ? "text-muted-foreground" : "text-chart-2"}>
              {loadingIndices ? "⏳ Índices de venta" : "✓ Índices"}
            </span>
            <span className={loadingApGlobal ? "text-muted-foreground" : "text-chart-2"}>
              {loadingApGlobal ? "⏳ Estados de anuncio" : "✓ Estados"}
            </span>
          </div>
          <span className="ml-auto text-[10px]">Las columnas de índices y estado aparecerán al terminar</span>
        </div>
      )}

      {configuredAlmacenes.length > 0 ? (
        <>
          {/* Filtros */}
          <CatalogFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            suministradores={suministradoresParaFiltro}
          />

          {/* Tabla */}
          {isLoading && !offers.length ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <CatalogTable
              offers={offers}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              selectedIndices={selectedIndices}
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
    </div>
  );
}
