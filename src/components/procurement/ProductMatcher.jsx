import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Check, Link2, X, Loader2, ImageOff, Plus } from "lucide-react";
import { searchCatalogProducts } from "@/api/externalSupabaseClient";
import { useToast } from "@/components/ui/use-toast";

// Receives existingMatches (array) — one item can be associated to many products
export default function ProductMatcher({ offerItem, existingMatches = [], onMatched }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(existingMatches.length === 0);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const trimmedSearch = search.trim();

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["catalog-search", trimmedSearch],
    queryFn:  () => searchCatalogProducts(trimmedSearch, 10),
    enabled:  trimmedSearch.length >= 2,
    staleTime: 60000,
  });

  const handleSave = async () => {
    if (!selected) return;
    // Guard: prevent associating the same internal product twice to the same offer item
    const alreadyLinked = existingMatches.some(
      m => String(m.internal_offer_id) === String(selected.id_online)
    );
    if (alreadyLinked) {
      toast({ title: "Ya asociado", description: `${selected.codigo || selected.id_online} ya está vinculado a este ítem.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    await base44.entities.OfferItemMatch.create({
      offer_item_id:         offerItem.id,
      offer_id:              offerItem.offer_id,
      internal_offer_id:     String(selected.id_online),
      internal_product_code: selected.codigo || String(selected.id_online),
      internal_product_name: selected.nombre,
      match_type:            "manual",
      match_confidence:      100,
      confirmed_at:          new Date().toISOString(),
      status:                "confirmed",
    });
    queryClient.invalidateQueries({ queryKey: ["offer-matches"] });
    setSaving(false);
    setSelected(null);
    setSearch("");
    setSearchOpen(false);
    onMatched?.(selected);
  };

  const handleRemove = async (matchId) => {
    await base44.entities.OfferItemMatch.update(matchId, { status: "rejected" });
    queryClient.invalidateQueries({ queryKey: ["offer-matches"] });
    onMatched?.(null);
  };

  return (
    <div className="space-y-1.5">
      {/* Chips de todas las asociaciones existentes */}
      {existingMatches.map(match => (
        <div key={match.id} className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Check size={12} className="text-success flex-shrink-0" />
            <span className="font-mono text-primary font-semibold flex-shrink-0">{match.internal_product_code}</span>
            <span className="text-muted-foreground truncate">{match.internal_product_name}</span>
          </div>
          <button
            onClick={() => handleRemove(match.id)}
            className="text-muted-foreground hover:text-destructive transition-colors ml-2 flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {/* Buscador — visible cuando no hay matches o cuando el usuario abre "Agregar otro" */}
      {searchOpen ? (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
            <Input
              value={search}
              autoFocus
              onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              onFocus={() => {
                if (!search && existingMatches.length === 0) {
                  const suggestedName = (offerItem.supplier_product_name || offerItem.supplier_product_code || "").slice(0, 30);
                  if (suggestedName) setSearch(suggestedName);
                }
              }}
              placeholder={existingMatches.length > 0 ? "Buscar producto a agregar..." : "Buscar en todo el catálogo..."}
              className="pl-8 h-7 text-xs pr-8"
            />
            {isFetching && (
              <Loader2 size={12} className="absolute right-2.5 top-2 text-muted-foreground animate-spin" />
            )}
          </div>

          {trimmedSearch.length >= 2 && suggestions.length > 0 && (
            <div className="border border-border rounded-md overflow-hidden max-h-52 overflow-y-auto bg-card shadow-sm">
              {suggestions.map((o) => (
                <div
                  key={String(o.id_online)}
                  onClick={() => setSelected(o)}
                  className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted text-xs transition-colors ${selected?.id_online === o.id_online ? "bg-primary/10" : ""}`}
                >
                  <div className="flex-shrink-0 h-10 w-10 rounded overflow-hidden border border-border/50 bg-muted flex items-center justify-center">
                    {o.fotos?.[0]?.foto ? (
                      <img src={o.fotos[0].foto} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff size={12} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-primary font-semibold shrink-0">{o.codigo || String(o.id_online)}</span>
                      <span className="text-foreground truncate">{o.nombre}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate">{o.proveedor} · {o.suministrador}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] ${(o.cantidad ?? 0) > 0 ? "text-success" : "text-muted-foreground"}`}>
                      {o.cantidad ?? 0} u.
                    </span>
                    {selected?.id_online === o.id_online && <Check size={11} className="text-primary" />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {trimmedSearch.length >= 2 && !isFetching && suggestions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1">Sin resultados en el catálogo.</p>
          )}

          {selected && (
            <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave} disabled={saving}>
              <Link2 size={12} className="mr-1.5" />
              {saving ? "Guardando..." : `Asociar — ${selected.codigo || String(selected.id_online)} · ${selected.nombre?.slice(0, 25)}`}
            </Button>
          )}

          {existingMatches.length > 0 && (
            <button
              onClick={() => { setSearchOpen(false); setSearch(""); setSelected(null); }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          )}
        </div>
      ) : (
        /* Botón para agregar otra asociación */
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-1 py-0.5"
        >
          <Plus size={12} />
          Agregar otro producto
        </button>
      )}
    </div>
  );
}
