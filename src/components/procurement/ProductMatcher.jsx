import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Check, Link2, X, Loader2 } from "lucide-react";
import { searchCatalogProducts } from "@/api/externalSupabaseClient";

export default function ProductMatcher({ offerItem, existingMatch, onMatched }) {
  const [search, setSearch] = useState(
    existingMatch ? "" : (offerItem.supplier_product_name || offerItem.supplier_product_code || "").slice(0, 30)
  );
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const trimmedSearch = search.trim();

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["catalog-search", trimmedSearch],
    queryFn: () => searchCatalogProducts(trimmedSearch, 10),
    enabled: trimmedSearch.length >= 2,
    staleTime: 60000,
  });

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const payload = {
      offer_item_id:         offerItem.id,
      offer_id:              offerItem.offer_id,
      internal_offer_id:     String(selected.id_online),
      internal_product_code: selected.codigo || String(selected.id_online),
      internal_product_name: selected.nombre,
      match_type:            "manual",
      match_confidence:      100,
      confirmed_at:          new Date().toISOString(),
      status:                "confirmed",
    };
    if (existingMatch) {
      await base44.entities.OfferItemMatch.update(existingMatch.id, payload);
    } else {
      await base44.entities.OfferItemMatch.create(payload);
    }
    queryClient.invalidateQueries({ queryKey: ["offer-matches"] });
    setSaving(false);
    setSelected(null);
    setSearch("");
    onMatched?.(selected);
  };

  const handleRemove = async () => {
    if (!existingMatch) return;
    await base44.entities.OfferItemMatch.update(existingMatch.id, { status: "rejected" });
    queryClient.invalidateQueries({ queryKey: ["offer-matches"] });
    onMatched?.(null);
  };

  return (
    <div className="space-y-2">
      {existingMatch && existingMatch.status === "confirmed" && (
        <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <Check size={12} className="text-success" />
            <span className="font-mono text-primary font-semibold">{existingMatch.internal_product_code}</span>
            <span className="text-muted-foreground truncate max-w-[140px]">{existingMatch.internal_product_name}</span>
          </div>
          <button onClick={handleRemove} className="text-muted-foreground hover:text-destructive transition-colors">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
          placeholder="Buscar en todo el catálogo..."
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
              className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted text-xs transition-colors ${selected?.id_online === o.id_online ? "bg-primary/10" : ""}`}
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-primary font-semibold">{o.codigo || String(o.id_online)}</span>
                  <span className="text-foreground truncate max-w-[150px]">{o.nombre}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{o.proveedor} · {o.suministrador}</span>
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
    </div>
  );
}
