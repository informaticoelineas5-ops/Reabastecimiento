import React, { useState, useMemo, useEffect } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, Package, Link2, ShoppingCart, CheckCircle2, Clock, AlertCircle, Search, Loader2, History, Sparkles, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import OfferImporter from "@/components/procurement/OfferImporter";
import ProductMatcher from "@/components/procurement/ProductMatcher";
import ProposalTable from "@/components/procurement/ProposalTable";
import PriceHistoryModal from "@/components/procurement/PriceHistoryModal";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { getUserPreferences } from "@/api/userPreferencesClient";
import { fetchProductsByIdOnlines } from "@/api/externalSupabaseClient";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";

const STATUS_OPTS = ["draft","imported","partially_matched","fully_matched","ordered","expired","archived"];
const STATUS_LABELS = { draft:"Borrador", imported:"Importada", partially_matched:"Asoc. parcial", fully_matched:"Asociada completa", ordered:"Con pedido", expired:"Vencida", archived:"Archivada" };

export default function SupplierOfferDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { isAdmin } = useProcurementUser();
  const queryClient = useQueryClient();
  const [matchingSearch, setMatchingSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showOnlyUnmatched, setShowOnlyUnmatched] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(matchingSearch.trim()), 400);
    return () => clearTimeout(t);
  }, [matchingSearch]);

  const { data: offer, isLoading: loadingOffer } = useQuery({
    queryKey: ["supplier-offer", id],
    queryFn: () => base44.entities.SupplierOffer.filter({ id }),
    select: d => d[0],
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["offer-items-all", id],
    queryFn: async () => {
      const PAGE = 200; // MAX_PAGE_SIZE de la REAB API
      let all = [];
      let offset = 0;
      while (true) {
        const { data, total } = await base44.entities.SupplierOfferItem.filterPaginated(
          { offer_id: id },
          { orderBy: 'row_number', limit: PAGE, offset }
        );
        all = all.concat(data);
        offset += PAGE;
        if (all.length >= total || data.length < PAGE) break;
      }
      return all;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["offer-matches", id],
    queryFn: () => base44.entities.OfferItemMatch.filter({ offer_id: id }, "-created_date", 5000),
    enabled: !!id,
  });

  // Almacenes configurados por el usuario
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });
  const userAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  // Todos los productos del catálogo (ELINEAS_DB) para los almacenes del usuario
  // Una sola carga (reporte indg_ap_sub), compartida con el resto de vistas; se espera a que termine para casar productos
  const indgProducts = useIndgAlmacenes(userAlmacenes, userAlmacenes.length > 0);
  const productsMap = indgProducts.products;
  const loadingProducts = userAlmacenes.length > 0 && !indgProducts.finished && !indgProducts.error;

  // Búsqueda client-side: filtra en memoria sobre los items ya cargados — instantánea, sin llamadas al servidor
  const trimmedSearch = debouncedSearch;
  const searchEnabled = trimmedSearch.length >= 2;
  const isSearching = loadingItems;
  const searchResults = useMemo(() => {
    if (!searchEnabled || items.length === 0) return [];
    const q = trimmedSearch.toLowerCase();
    return items.filter(item =>
      (item.supplier_product_name || "").toLowerCase().includes(q) ||
      (item.supplier_product_code || "").toLowerCase().includes(q)
    );
  }, [items, trimmedSearch, searchEnabled]);

  // Derivar confirmados antes de los early returns (matches defaultea a [])
  const confirmedMatches = matches.filter(m => m.status === "confirmed");
  const matchedIdOnlines = confirmedMatches.map(m => m.internal_offer_id).filter(Boolean);

  // Map<offer_item_id, match[]> — permite múltiples matches por ítem
  const matchesByItemId = useMemo(() => {
    const map = new Map();
    confirmedMatches.forEach(m => {
      if (!map.has(m.offer_item_id)) map.set(m.offer_item_id, []);
      map.get(m.offer_item_id).push(m);
    });
    return map;
  }, [confirmedMatches]);

  // Ítems únicos que tienen al menos 1 match (para los contadores del header)
  const matchedItemIds = useMemo(() => new Set(confirmedMatches.map(m => m.offer_item_id)), [confirmedMatches]);

  // Fetch por id_online exacto — garantiza stock correcto sin importar el almacén
  const { data: matchedProductsList = [] } = useQuery({
    queryKey: ["matched-products-by-id", [...matchedIdOnlines].sort().join(",")],
    queryFn: () => fetchProductsByIdOnlines(matchedIdOnlines),
    enabled: matchedIdOnlines.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Mapa fusionado: productsMap del usuario + productos específicos de los matches
  const mergedProductsMap = useMemo(() => {
    const merged = new Map(productsMap);
    matchedProductsList.forEach(p => {
      if (p.id_online != null) merged.set(String(p.id_online), p);
    });
    return merged;
  }, [productsMap, matchedProductsList]);

  if (loadingOffer) return <div className="p-6 space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-[400px] w-full" /></div>;
  if (!offer) return <div className="p-6 text-muted-foreground">Oferta no encontrada.</div>;

  const pendingItems = items.filter(item => !matchedItemIds.has(item.id) && !item.is_new_product);
  const newItems     = items.filter(item => item.is_new_product && !matchedItemIds.has(item.id));
  const matchPct = items.length > 0 ? Math.round(((matchedItemIds.size + newItems.length) / items.length) * 100) : 0;

  const toggleNewProduct = async (item) => {
    const newVal = !item.is_new_product;
    await base44.entities.SupplierOfferItem.update(item.id, { is_new_product: newVal });
    queryClient.invalidateQueries({ queryKey: ["offer-items-all", id] });
  };
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = offer.valid_until && offer.valid_until < today;

  const updateStatus = async (status) => {
    await base44.entities.SupplierOffer.update(offer.id, { status });
    queryClient.invalidateQueries({ queryKey: ["supplier-offer", id] });
    queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/procurement/SupplierOffers" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft size={13} /> Volver a Ofertas
          </Link>
          <h1 className="text-xl font-bold">{offer.offer_name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">{offer.supplier_name}</span>
            <Badge variant="secondary" className="text-xs">{STATUS_LABELS[offer.status] || offer.status}</Badge>
            {isExpired && <Badge variant="outline" className="text-xs text-warning border-warning">Vencida</Badge>}
            <Badge variant="outline" className="text-xs">{offer.default_currency || "USD"}{offer.exchange_rate && offer.exchange_rate !== 1 ? ` · TC: ${offer.exchange_rate}` : ""}</Badge>
          </div>
        </div>
        {isAdmin && (
          <Select value={offer.status} onValueChange={updateStatus}>
            <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_OPTS.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      {/* Progress summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-primary">{items.length}</p>
          <p className="text-xs text-muted-foreground">Ítems importados</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-success">{matchedItemIds.size}</p>
          <p className="text-xs text-muted-foreground">Asociados ({matchPct}%)</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-warning">{pendingItems.length}</p>
          <p className="text-xs text-muted-foreground">Pendientes</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold">{offer.valid_until ? format(new Date(offer.valid_until), "dd MMM", { locale: es }) : "—"}</p>
          <p className="text-xs text-muted-foreground">Vence</p>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={items.length === 0 ? "import" : "items"}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="import" className="text-xs"><Upload size={13} className="mr-1" /> Importar</TabsTrigger>
          <TabsTrigger value="items" className="text-xs">
            <Package size={13} className="mr-1" />
            Ítems{" "}
            {loadingItems
              ? <Loader2 size={11} className="animate-spin ml-0.5" />
              : `(${items.length})`
            }
          </TabsTrigger>
          <TabsTrigger value="matching" className="text-xs">
            <Link2 size={13} className="mr-1" />
            Asociación{" "}
            {loadingItems
              ? <Loader2 size={11} className="animate-spin ml-0.5" />
              : `(${matchedItemIds.size}/${items.length})`
            }
          </TabsTrigger>
          <TabsTrigger value="proposal" className="text-xs"><ShoppingCart size={13} className="mr-1" /> Propuesta & Pedido</TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import">
          <Card className="p-6">
            <h3 className="text-sm font-semibold mb-4">Importar archivo de oferta</h3>
            {items.length > 0 && (
              <div className="mb-4 p-3 bg-warning/10 border border-warning/20 rounded-lg text-xs text-warning">
                Esta oferta ya tiene {items.length} ítems importados. Una nueva importación <strong>agregará</strong> filas adicionales sin borrar las existentes.
              </div>
            )}
            <OfferImporter offer={offer} onImported={() => queryClient.invalidateQueries({ queryKey: ["offer-items-all", id] })} />
          </Card>
        </TabsContent>

        {/* Items Tab */}
        <TabsContent value="items">
          <Card className="p-4">
            {loadingItems ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="text-sm">Cargando ítems de la oferta...</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-[65vh]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {["#", "Código Proveedor", "Nombre", "Formato", "Unidad", "Precio", "Mín", "Múltiplo", "Disponibilidad", "Entrega (días)", "Estado", ""].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/80 backdrop-blur-sm z-10">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">Sin ítems. Importa un archivo desde la pestaña <strong>Importar</strong>.</td></tr>
                    ) : items.map((item) => {
                      const itemMatches = matchesByItemId.get(item.id) || [];
                      return (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground">{item.row_number}</td>
                          <td className="px-3 py-2 font-mono">{item.supplier_product_code || "—"}</td>
                          <td className="px-3 py-2 min-w-[180px] max-w-[260px]"><span className="block text-wrap break-words">{item.supplier_product_name}</span></td>
                          <td className="px-3 py-2">{item.format || "—"}</td>
                          <td className="px-3 py-2">{item.unit || "—"}</td>
                          <td className="px-3 py-2 font-semibold">{item.currency || offer.default_currency || "USD"} {item.offered_cost?.toFixed(2) || "—"}</td>
                          <td className="px-3 py-2">{item.min_qty || 1}</td>
                          <td className="px-3 py-2">{item.pack_multiple || 1}</td>
                          <td className="px-3 py-2">{item.availability || "—"}</td>
                          <td className="px-3 py-2">{item.lead_time_days || "—"}</td>
                          <td className="px-3 py-2 min-w-[160px]">
                            {itemMatches.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {itemMatches.map(m => (
                                  <Badge key={m.id} variant="outline" className="text-[10px] text-success border-success w-fit">
                                    ✓ {m.internal_product_code || m.internal_offer_id || "Asociado"}
                                  </Badge>
                                ))}
                                {itemMatches.length > 1 && (
                                  <span className="text-[10px] text-blue-600 font-medium">Pack ×{itemMatches.length}</span>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin asociar</Badge>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => setHistoryItem(item)}
                              title="Ver historial de precios"
                              className="text-muted-foreground hover:text-primary transition-colors p-1 rounded"
                            >
                              <History size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Matching Tab */}
        <TabsContent value="matching">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold">Asociar ítems con productos del catálogo</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOnlyUnmatched(v => !v)}
                  className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                    showOnlyUnmatched
                      ? "bg-warning/15 border-warning/40 text-warning font-semibold"
                      : "border-border text-muted-foreground hover:border-warning/40 hover:text-warning"
                  }`}
                >
                  {showOnlyUnmatched ? `Solo pendientes (${pendingItems.length})` : `Pendientes: ${pendingItems.length}`}
                </button>
                <Badge variant="secondary" className="text-xs">{matchedItemIds.size}/{items.length} asociados</Badge>
              </div>
            </div>
            {loadingItems ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="text-sm">Cargando ítems de la oferta...</p>
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Importa ítems primero desde la pestaña <strong>Importar</strong>.</p>
            ) : (
              <>
                {/* Buscador de ítems */}
                <div className="relative">
                  {isSearching
                    ? <Loader2 size={13} className="absolute left-2.5 top-2 text-muted-foreground animate-spin" />
                    : <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
                  }
                  <input
                    value={matchingSearch}
                    onChange={e => setMatchingSearch(e.target.value)}
                    placeholder={`Buscar en todos los ítems por nombre o código...`}
                    className="w-full pl-8 h-8 text-xs border border-input rounded-md bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {searchEnabled && (
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    {isSearching ? "Buscando en toda la oferta..." : `${searchResults.length} resultado${searchResults.length !== 1 ? "s" : ""} en toda la oferta`}
                  </p>
                )}
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {(searchEnabled ? searchResults : items)
                    .filter(item => {
                      if (showOnlyUnmatched) {
                        if (matchedItemIds.has(item.id)) return false;
                      }
                      if (!searchEnabled) {
                        const q = trimmedSearch.toLowerCase();
                        if (!q) return true;
                        return (item.supplier_product_name || "").toLowerCase().includes(q) ||
                               (item.supplier_product_code || "").toLowerCase().includes(q);
                      }
                      return true;
                    })
                    .map((item) => {
                      const itemMatches = matchesByItemId.get(item.id) || [];
                      const hasMatch    = itemMatches.length > 0;
                      const isNew       = !!item.is_new_product && !hasMatch;
                      return (
                        <div key={item.id} className={`border rounded-lg p-3 space-y-2 ${isNew ? "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10" : "border-border"}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {hasMatch
                                  ? <CheckCircle2 size={13} className="text-success shrink-0" />
                                  : isNew
                                    ? <Sparkles size={13} className="text-amber-500 shrink-0" />
                                    : <AlertCircle size={13} className="text-warning shrink-0" />
                                }
                                <span className="text-xs font-semibold">{item.supplier_product_name}</span>
                                {item.supplier_product_code && <Badge variant="secondary" className="text-[10px]">{item.supplier_product_code}</Badge>}
                                {isNew && (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">
                                    NUEVO
                                  </span>
                                )}
                                {itemMatches.length > 1 && (
                                  <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
                                    Pack ×{itemMatches.length}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground ml-5">{item.currency || offer.default_currency || "USD"} {item.offered_cost?.toFixed(2)} · Mín: {item.min_qty} · Múlt: {item.pack_multiple}</p>
                            </div>
                            {/* Botón marcar/desmarcar como Nuevo — solo para ítems sin match */}
                            {!hasMatch && (
                              <button
                                onClick={() => toggleNewProduct(item)}
                                className={`ml-2 flex-shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                  isNew
                                    ? "border-amber-400 text-amber-700 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                                    : "border-border text-muted-foreground hover:border-amber-400 hover:text-amber-600"
                                }`}
                              >
                                {isNew ? <><X size={9} /> Desmarcar</> : <><Sparkles size={9} /> Marcar como Nuevo</>}
                              </button>
                            )}
                          </div>
                          {/* ProductMatcher solo para ítems que no están marcados como Nuevo */}
                          {!isNew && (
                            <ProductMatcher
                              offerItem={item}
                              existingMatches={itemMatches}
                              onMatched={() => queryClient.invalidateQueries({ queryKey: ["offer-matches", id] })}
                            />
                          )}
                          {isNew && (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 ml-5">
                              Este ítem aparecerá en la Propuesta de Compra como Producto Nuevo — el comercial define la cantidad.
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        {/* Proposal Tab */}
        <TabsContent value="proposal">
          <Card className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold">Propuesta de Compra y Decisión Manual</h3>
              <p className="text-xs text-muted-foreground mt-1">
                El sistema sugiere cantidades basadas en stock mínimo y existencia actual. Tú decides la cantidad final.
              </p>
            </div>
            {loadingItems ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="text-sm">Cargando ítems del pedido...</p>
              </div>
            ) : loadingProducts && userAlmacenes.length > 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
                <Loader2 size={24} className="animate-spin text-primary" />
                <p className="text-sm">Cargando datos del catálogo y stock...</p>
                <p className="text-xs">Esto puede tardar unos segundos la primera vez</p>
              </div>
            ) : (
              <ProposalTable
                offer={offer}
                matches={confirmedMatches}
                offerItems={items}
                internalOffers={mergedProductsMap}
                newItems={newItems}
                onOrderCreated={() => {}}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <PriceHistoryModal
        open={!!historyItem}
        onClose={() => setHistoryItem(null)}
        item={historyItem}
      />
    </div>
  );
}