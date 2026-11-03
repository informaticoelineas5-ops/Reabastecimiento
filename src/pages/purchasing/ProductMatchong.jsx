import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Search, Check, X, Zap, Plus } from "lucide-react";

function similarity(a = "", b = "") {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 70;
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  const common = wordsA.filter(w => w.length > 2 && wordsB.some(wb => wb.includes(w) || w.includes(wb)));
  return Math.min(60, Math.round((common.length / Math.max(wordsA.length, 1)) * 100));
}

export default function ProductMatching() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const offerId = params.get("offer_id");

  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState({});   // itemId → string | undefined
  const [saving, setSaving] = useState({});

  React.useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const { data: offer } = useQuery({
    queryKey: ["supplier-offer", offerId],
    queryFn: () => base44.entities.SupplierOffer.filter({ id: offerId }),
    select: d => d[0], enabled: !!offerId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["offer-items", offerId],
    queryFn: () => base44.entities.SupplierOfferItem.filter({ offer_id: offerId }, "row_index", 500),
    enabled: !!offerId,
  });

  const { data: matches = [], refetch: refetchMatches } = useQuery({
    queryKey: ["offer-matches", offerId],
    queryFn: () => base44.entities.SupplierOfferItemMatch.filter({ offer_id: offerId }, "-created_date", 1000),
    enabled: !!offerId,
  });

  const { data: internalOffers = [] } = useQuery({
    queryKey: ["offers-for-matching"],
    queryFn: () => base44.entities.Offer.list("-updated_date", 500),
  });

  // Map<offer_item_id, match[]>  — allows multiple matches per item
  const matchedMap = useMemo(() => {
    const m = {};
    matches.forEach(match => {
      if (!m[match.offer_item_id]) m[match.offer_item_id] = [];
      m[match.offer_item_id].push(match);
    });
    return m;
  }, [matches]);

  // Auto-suggestions only for items with 0 current matches
  const autoSuggestions = useMemo(() => {
    const suggestions = {};
    items.forEach(item => {
      if ((matchedMap[item.id]?.length || 0) > 0) return;
      let best = null, bestScore = 0;
      internalOffers.forEach(io => {
        const codeScore = item.supplier_product_code && io.codigo &&
          item.supplier_product_code.toLowerCase() === io.codigo.toLowerCase() ? 90 : 0;
        const nameScore = similarity(item.supplier_product_name, io.nombre);
        const score = Math.max(codeScore, nameScore);
        if (score > bestScore && score >= 40) { bestScore = score; best = io; }
      });
      if (best) suggestions[item.id] = { product: best, confidence: bestScore };
    });
    return suggestions;
  }, [items, internalOffers, matchedMap]);

  // Always creates a new match (allows multiple per item)
  const handleAddMatch = async (item, product, matchType = "manual", confidence = 100) => {
    // Prevent duplicating the same internal product on the same offer item
    const existing = matchedMap[item.id] || [];
    if (existing.some(m => m.internal_product_id === product.id)) {
      toast({ title: "Ya asociado", description: `${product.codigo} ya está asociado a este ítem.`, variant: "destructive" });
      return;
    }
    setSaving(s => ({ ...s, [item.id]: true }));
    await base44.entities.SupplierOfferItemMatch.create({
      offer_item_id: item.id,
      offer_id: offerId,
      imported_by: user?.email,
      internal_product_id: product.id,
      internal_product_codigo: product.codigo,
      internal_product_nombre: product.nombre,
      match_type: matchType,
      match_confidence: confidence,
      confirmed_by: user?.email,
      confirmed_at: new Date().toISOString(),
    });
    await refetchMatches();
    setSaving(s => ({ ...s, [item.id]: false }));
    toast({ title: `Asociado: ${product.codigo} — ${product.nombre?.slice(0, 40)}` });
  };

  // Removes a specific match by its own ID
  const handleRemoveMatch = async (matchId, itemId) => {
    await base44.entities.SupplierOfferItemMatch.delete(matchId);
    await refetchMatches();
  };

  const applyAllSuggestions = async () => {
    setSaving({ _all: true });
    for (const [itemId, sugg] of Object.entries(autoSuggestions)) {
      const item = items.find(i => i.id === itemId);
      if (item) await handleAddMatch(item, sugg.product, "auto_nombre", sugg.confidence);
    }
    setSaving({});
    toast({ title: `${Object.keys(autoSuggestions).length} asociaciones automáticas aplicadas` });
  };

  const openSearch = (itemId) => setSearchQuery(q => ({ ...q, [itemId]: "" }));
  const closeSearch = (itemId) => setSearchQuery(q => { const n = { ...q }; delete n[itemId]; return n; });

  const filteredProducts = (itemId) => {
    const q = (searchQuery[itemId] || "").toLowerCase();
    const alreadyIds = new Set((matchedMap[itemId] || []).map(m => m.internal_product_id));
    let pool = q
      ? internalOffers.filter(p =>
          (p.codigo || "").toLowerCase().includes(q) || (p.nombre || "").toLowerCase().includes(q)
        ).slice(0, 10)
      : internalOffers.slice(0, 8);
    return pool.filter(p => !alreadyIds.has(p.id));
  };

  const totalMatched = items.filter(item => (matchedMap[item.id]?.length || 0) > 0).length;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/OfferDetail?id=${offerId}`)}>
          <ArrowLeft size={15} />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Asociación de Productos</h1>
          <p className="text-xs text-muted-foreground">{offer?.offer_name} — {offer?.supplier_name}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {totalMatched} / {items.length} ítems asociados
        </div>
        {Object.keys(autoSuggestions).length > 0 && (
          <Button variant="outline" size="sm" onClick={applyAllSuggestions} disabled={!!saving._all}>
            <Zap size={13} className="mr-1 text-yellow-500" />
            {saving._all ? "Aplicando..." : `Aplicar ${Object.keys(autoSuggestions).length} sugerencias`}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {items.map(item => {
          const currentMatches = matchedMap[item.id] || [];
          const hasMatches     = currentMatches.length > 0;
          const suggestion     = autoSuggestions[item.id];
          const isSearchOpen   = searchQuery[item.id] !== undefined;
          const isSaving       = saving[item.id];

          return (
            <Card
              key={item.id}
              className={`p-4 transition-colors ${hasMatches
                ? "border-green-200 dark:border-green-800"
                : "border-yellow-200 dark:border-yellow-800"}`}
            >
              <div className="flex flex-col md:flex-row gap-4">
                {/* ── Info del ítem del proveedor ── */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{item.supplier_product_name}</span>
                    {item.supplier_product_code && (
                      <span className="text-xs text-muted-foreground font-mono">[{item.supplier_product_code}]</span>
                    )}
                    {currentMatches.length > 1 && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
                        Pack ×{currentMatches.length}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {item.format && <span>{item.format}</span>}
                    {item.offered_cost > 0 && (
                      <span className="font-medium text-foreground">{item.offered_cost} {item.currency}</span>
                    )}
                    <span>Mín: {item.min_qty || 1} | ×{item.pack_multiple || 1}</span>
                    {item.availability && <span>{item.availability}</span>}
                  </div>
                </div>

                {/* ── Área de asociaciones ── */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Chips de matches existentes */}
                  {currentMatches.map(match => (
                    <div key={match.id} className="flex items-center gap-2">
                      <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2 min-w-0">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {match.internal_product_codigo} — {match.internal_product_nombre}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {match.match_type} {match.match_confidence ? `(${match.match_confidence}%)` : ""}
                          </div>
                        </div>
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 w-6 p-0 flex-shrink-0 hover:bg-red-100 hover:text-red-600"
                          onClick={() => handleRemoveMatch(match.id, item.id)}
                        >
                          <X size={13} />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Auto-sugerencia (solo cuando no hay matches todavía) */}
                  {!hasMatches && suggestion && !isSearchOpen && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-blue-600 dark:text-blue-400">
                          Sugerencia ({suggestion.confidence}%)
                        </div>
                        <div className="text-sm font-medium">
                          {suggestion.product.codigo} — {suggestion.product.nombre?.slice(0, 40)}
                        </div>
                      </div>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => handleAddMatch(item, suggestion.product, "auto_nombre", suggestion.confidence)}
                        disabled={isSaving}
                      >
                        <Check size={13} />
                      </Button>
                    </div>
                  )}

                  {/* Buscador — se muestra cuando está abierto */}
                  {isSearchOpen ? (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-8 h-8 text-xs"
                          placeholder="Buscar producto interno..."
                          autoFocus
                          value={searchQuery[item.id]}
                          onChange={e => setSearchQuery(q => ({ ...q, [item.id]: e.target.value }))}
                        />
                      </div>
                      <div className="bg-card border border-border rounded-lg max-h-40 overflow-y-auto">
                        {filteredProducts(item.id).map(p => (
                          <button
                            key={p.id}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-xs border-b border-border last:border-0 flex items-center justify-between gap-2"
                            onClick={() => {
                              handleAddMatch(item, p, "manual", 100);
                              closeSearch(item.id);
                            }}
                          >
                            <span><strong>{p.codigo}</strong> — {p.nombre?.slice(0, 50)}</span>
                            <span className="text-muted-foreground flex-shrink-0">{p.existencia_fisica ?? 0} u.</span>
                          </button>
                        ))}
                        {filteredProducts(item.id).length === 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</div>
                        )}
                      </div>
                      <Button
                        variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground"
                        onClick={() => closeSearch(item.id)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    /* Botón para abrir buscador */
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-xs gap-1.5 w-full"
                      onClick={() => openSearch(item.id)}
                      disabled={isSaving}
                    >
                      <Plus size={12} />
                      {hasMatches ? "Agregar otro producto" : "Asociar producto..."}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {items.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Esta oferta no tiene líneas importadas.</p>
        </Card>
      )}
    </div>
  );
}
