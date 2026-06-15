import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, Package, Link2, ShoppingCart, CheckCircle2, Clock, AlertCircle, Search, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import OfferImporter from "@/components/procurement/OfferImporter";
import ProductMatcher from "@/components/procurement/ProductMatcher";
import ProposalTable from "@/components/procurement/ProposalTable";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { getUserPreferences } from "@/api/userPreferencesClient";
import { fetchProductsForAlmacen, fetchProductsByIdOnlines } from "@/api/externalSupabaseClient";

const STATUS_OPTS = ["draft","imported","partially_matched","fully_matched","ordered","expired","archived"];
const STATUS_LABELS = { draft:"Borrador", imported:"Importada", partially_matched:"Asoc. parcial", fully_matched:"Asociada completa", ordered:"Con pedido", expired:"Vencida", archived:"Archivada" };

export default function SupplierOfferDetail() {
  const params = new URLSearchParams(window.location.search);
  const navigate = useNavigate();
  const id = window.location.pathname.split("/").pop();
  const { isAdmin } = useProcurementUser();
  const queryClient = useQueryClient();
  const [matchingSearch, setMatchingSearch] = useState("");

  const { data: offer, isLoading: loadingOffer } = useQuery({
    queryKey: ["supplier-offer", id],
    queryFn: () => base44.entities.SupplierOffer.filter({ id }),
    select: d => d[0],
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["offer-items", id],
    queryFn: () => base44.entities.SupplierOfferItem.filter({ offer_id: id }, "row_number", 500),
    enabled: !!id,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["offer-matches", id],
    queryFn: () => base44.entities.OfferItemMatch.filter({ offer_id: id }, "-created_date", 500),
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
  const { data: productsMap = new Map(), isLoading: loadingProducts } = useQuery({
    queryKey: ["ext-products-for-matching", userAlmacenes],
    queryFn: async () => {
      if (!userAlmacenes.length) return new Map();
      const maps = await Promise.all(userAlmacenes.map(a => fetchProductsForAlmacen(a)));
      const merged = new Map();
      maps.forEach(m => m.forEach((v, k) => merged.set(k, v)));
      return merged;
    },
    enabled: userAlmacenes.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  // Derivar confirmados antes de los early returns (matches defaultea a [])
  const confirmedMatches = matches.filter(m => m.status === "confirmed");
  const matchedIdOnlines = confirmedMatches.map(m => m.internal_offer_id).filter(Boolean);

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

  const pendingItems = items.filter(item => !confirmedMatches.find(m => m.offer_item_id === item.id));
  const matchPct = items.length > 0 ? Math.round((confirmedMatches.length / items.length) * 100) : 0;
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
          <p className="text-xl font-bold text-success">{confirmedMatches.length}</p>
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
              : `(${confirmedMatches.length}/${items.length})`
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
            <OfferImporter offer={offer} onImported={() => queryClient.invalidateQueries({ queryKey: ["offer-items", id] })} />
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
                      {["#", "Código Proveedor", "Nombre", "Formato", "Unidad", "Precio", "Mín", "Múltiplo", "Disponibilidad", "Entrega (días)", "Estado"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/80 backdrop-blur-sm z-10">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">Sin ítems. Importa un archivo desde la pestaña <strong>Importar</strong>.</td></tr>
                    ) : items.map((item) => {
                      const match = confirmedMatches.find(m => m.offer_item_id === item.id);
                      return (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground">{item.row_number}</td>
                          <td className="px-3 py-2 font-mono">{item.supplier_product_code || "—"}</td>
                          <td className="px-3 py-2 max-w-[200px]"><span className="truncate block">{item.supplier_product_name}</span></td>
                          <td className="px-3 py-2">{item.format || "—"}</td>
                          <td className="px-3 py-2">{item.unit || "—"}</td>
                          <td className="px-3 py-2 font-semibold">{item.currency || offer.default_currency || "USD"} {item.offered_cost?.toFixed(2) || "—"}</td>
                          <td className="px-3 py-2">{item.min_qty || 1}</td>
                          <td className="px-3 py-2">{item.pack_multiple || 1}</td>
                          <td className="px-3 py-2">{item.availability || "—"}</td>
                          <td className="px-3 py-2">{item.lead_time_days || "—"}</td>
                          <td className="px-3 py-2">
                            {match ? (
                              <Badge variant="outline" className="text-[10px] text-success border-success">{match.internal_product_code}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin asociar</Badge>
                            )}
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Asociar ítems con productos del catálogo</h3>
              <Badge variant="secondary" className="text-xs">{confirmedMatches.length}/{items.length} asociados</Badge>
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
                  <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
                  <input
                    value={matchingSearch}
                    onChange={e => setMatchingSearch(e.target.value)}
                    placeholder={`Filtrar entre ${items.length} ítems por nombre o código...`}
                    className="w-full pl-8 h-8 text-xs border border-input rounded-md bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {items
                    .filter(item => {
                      const q = matchingSearch.toLowerCase().trim();
                      if (!q) return true;
                      return (item.supplier_product_name || "").toLowerCase().includes(q) ||
                             (item.supplier_product_code || "").toLowerCase().includes(q);
                    })
                    .map((item) => {
                      const match = matches.find(m => m.offer_item_id === item.id && m.status === "confirmed");
                      return (
                        <div key={item.id} className="border border-border rounded-lg p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                {match ? <CheckCircle2 size={13} className="text-success shrink-0" /> : <AlertCircle size={13} className="text-warning shrink-0" />}
                                <span className="text-xs font-semibold">{item.supplier_product_name}</span>
                                {item.supplier_product_code && <Badge variant="secondary" className="text-[10px]">{item.supplier_product_code}</Badge>}
                              </div>
                              <p className="text-[10px] text-muted-foreground ml-5">{item.currency || offer.default_currency || "USD"} {item.offered_cost?.toFixed(2)} · Mín: {item.min_qty} · Múlt: {item.pack_multiple}</p>
                            </div>
                          </div>
                          <ProductMatcher
                            offerItem={item}
                            existingMatch={match}
                            onMatched={() => queryClient.invalidateQueries({ queryKey: ["offer-matches", id] })}
                          />
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
                onOrderCreated={() => {}}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}