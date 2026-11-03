import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, ShoppingCart, Info, Warehouse } from "lucide-react";
import { Link } from "react-router-dom";
import { getUserPreferences } from "@/api/userPreferencesClient";
import { fetchProductsForAlmacen } from "@/api/externalSupabaseClient";

// ABC classification within each category (no cross-category comparison)
function classifyABC(products) {
  // Group by category
  const byCat = {};
  for (const p of products) {
    const cat = p.categoria_online || "Sin categoría";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(p);
  }
  const result = {};
  for (const [cat, items] of Object.entries(byCat)) {
    const sorted = [...items].sort((a, b) => b.avg_monthly - a.avg_monthly);
    const n = sorted.length;
    sorted.forEach((item, i) => {
      const rank = i / n;
      result[item.tienda_internal_id] = rank < 0.2 ? "A" : rank < 0.5 ? "B" : "C";
    });
  }
  return result;
}

export default function SalesAlertsPanel({ limit = 30 }) {
  const { data: salesRaw = [] } = useQuery({
    queryKey: ["sales-index"],
    queryFn: () => base44.entities.SalesIndex.list("-periodo_fecha", 5000),
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers-all-alerts"],
    queryFn: () => base44.entities.Offer.list("-updated_date", 2000),
  });

  // Almacenes configurados por el comercial (misma fuente que Alerts.jsx / Dashboard.jsx)
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn:  getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });
  const userAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  const { data: almacenProductsMap = new Map(), isLoading: loadingAlmacenProducts } = useQuery({
    queryKey: ["products-for-almacen-sales-alerts", userAlmacenes],
    queryFn: async () => {
      if (!userAlmacenes.length) return new Map();
      const maps = await Promise.all(userAlmacenes.map(a => fetchProductsForAlmacen(a)));
      const merged = new Map();
      maps.forEach(m => m.forEach((v, k) => merged.set(k, v)));
      return merged;
    },
    staleTime: 10 * 60 * 1000,
    enabled: userAlmacenes.length > 0,
  });

  // Aggregate SalesIndex across all periods per product, filtrado por almacén del comercial
  const aggregated = useMemo(() => {
    const scoped = userAlmacenes.length > 0 && almacenProductsMap.size > 0;
    const map = {};
    for (const s of salesRaw) {
      const id = s.tienda_internal_id;
      if (scoped && !almacenProductsMap.has(String(id))) continue;
      if (!map[id]) {
        map[id] = {
          tienda_internal_id: id,
          nombre: s.nombre,
          categoria_online: s.categoria_online,
          suministrador: s.suministrador,
          total_cantidad: 0,
          total_ordenes: 0,
          periods: new Set(),
        };
      }
      map[id].total_cantidad += s.total_cantidad || 0;
      map[id].total_ordenes += s.total_ordenes || 0;
      map[id].periods.add(s.periodo_fecha);
    }
    // Compute avg_monthly velocity
    return Object.values(map).map(p => ({
      ...p,
      num_periods: p.periods.size,
      avg_monthly: p.periods.size > 0 ? p.total_cantidad / p.periods.size : 0,
    }));
  }, [salesRaw, userAlmacenes, almacenProductsMap]);

  // Cross with Offer (current stock) by tienda_internal_id
  const alerts = useMemo(() => {
    if (aggregated.length === 0 || offers.length === 0) return [];

    const offerByTienda = {};
    for (const o of offers) {
      if (o.tienda_internal_id) offerByTienda[o.tienda_internal_id] = o;
    }

    const abcMap = classifyABC(aggregated);

    const results = [];
    for (const p of aggregated) {
      const offer = offerByTienda[p.tienda_internal_id];
      if (!offer) continue;

      const currentStock = (offer.existencia_fisica || 0) + (offer.stock_reserva || 0);
      const avgMonthly = p.avg_monthly;
      if (avgMonthly <= 0) continue;

      // Stock min = 1.5x avg monthly (safety buffer)
      // Stock max = 3x avg monthly
      const stockMin = Math.ceil(avgMonthly * 1.5);
      const stockMax = Math.ceil(avgMonthly * 3);
      const suggestedQty = Math.max(0, stockMax - currentStock);
      const abc = abcMap[p.tienda_internal_id] || "C";
      const daysLeft = avgMonthly > 0 ? Math.round((currentStock / avgMonthly) * 30) : 999;

      const urgency = currentStock <= 0 ? "critical"
        : currentStock < stockMin * 0.5 ? "high"
        : currentStock < stockMin ? "medium"
        : null;

      if (urgency) {
        results.push({
          tienda_internal_id: p.tienda_internal_id,
          nombre: p.nombre,
          categoria_online: p.categoria_online,
          currentStock,
          stockMin,
          stockMax,
          avgMonthly: Math.round(avgMonthly * 10) / 10,
          suggestedQty,
          daysLeft,
          urgency,
          abc,
          offer,
        });
      }
    }

    return results.sort((a, b) => {
      const priority = { critical: 0, high: 1, medium: 2 };
      return (priority[a.urgency] - priority[b.urgency]) || (a.daysLeft - b.daysLeft);
    });
  }, [aggregated, offers]);

  if (userAlmacenes.length > 0 && loadingAlmacenProducts) {
    return (
      <div className="bg-muted/40 border border-border rounded-xl p-4 text-center text-xs text-muted-foreground">
        Cargando productos de tus almacenes...
      </div>
    );
  }

  if (salesRaw.length === 0) {
    return (
      <div className="bg-muted/40 border border-border rounded-xl p-4 text-center text-xs text-muted-foreground">
        <Info size={14} className="inline mr-1" />
        Sin datos de índices de ventas. <Link to="/SalesIndexImport" className="underline text-primary">Importar índices</Link>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-success/5 border border-success/20 rounded-xl p-4 text-center text-xs text-success">
        <TrendingUp size={14} className="inline mr-1" />
        No hay alertas de stock — todos los productos con historial de ventas tienen stock suficiente.
      </div>
    );
  }

  const urgencyConfig = {
    critical: { label: "CRÍTICO", bg: "bg-destructive/10", border: "border-destructive/30", text: "text-destructive", badge: "destructive" },
    high: { label: "ALTO", bg: "bg-warning/10", border: "border-warning/30", text: "text-warning", badge: "outline" },
    medium: { label: "MEDIO", bg: "bg-primary/5", border: "border-primary/20", text: "text-primary", badge: "secondary" },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning" />
            Alertas Predictivas de Stock
            <Badge variant="destructive" className="text-[10px]">{alerts.length} productos</Badge>
          </h3>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
            {userAlmacenes.length > 0 ? (
              <><Warehouse size={10} />{userAlmacenes.length === 1 ? userAlmacenes[0] : `${userAlmacenes.length} almacenes`}</>
            ) : (
              <span className="text-warning">Todos los almacenes (configura en Índices de Ventas)</span>
            )}
          </p>
        </div>
        <Link to="/SalesRanking" className="text-xs text-primary underline">Ver ranking completo</Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/60 border-b border-border">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Urgencia</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Producto</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Categoría</th>
              <th className="px-3 py-2 text-center font-medium text-muted-foreground">Clase</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Stock actual</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Stock mín.</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Venta/mes</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Días restantes</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Sugerido comprar</th>
            </tr>
          </thead>
          <tbody>
            {alerts.slice(0, limit).map((a) => {
              const cfg = urgencyConfig[a.urgency];
              return (
                <tr key={a.tienda_internal_id} className={`border-b border-border/50 last:border-0 ${cfg.bg}`}>
                  <td className="px-3 py-2">
                    <span className={`font-bold text-[10px] ${cfg.text}`}>{cfg.label}</span>
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <p className="font-medium truncate">{a.nombre}</p>
                    <p className="text-muted-foreground text-[10px]">{a.tienda_internal_id}</p>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{a.categoria_online}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={a.abc === "A" ? "default" : a.abc === "B" ? "secondary" : "outline"} className="text-[10px]">
                      {a.abc}
                    </Badge>
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${a.currentStock === 0 ? "text-destructive" : ""}`}>
                    {a.currentStock}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{a.stockMin}</td>
                  <td className="px-3 py-2 text-right">{a.avgMonthly}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${a.daysLeft <= 7 ? "text-destructive" : a.daysLeft <= 15 ? "text-warning" : ""}`}>
                    {a.daysLeft >= 999 ? "∞" : `${a.daysLeft}d`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex items-center justify-end gap-1 text-primary font-bold">
                      <ShoppingCart size={10} /> {a.suggestedQty}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {alerts.length > limit && (
        <p className="text-xs text-muted-foreground text-center">Mostrando {limit} de {alerts.length} alertas. <Link to="/SalesRanking" className="underline text-primary">Ver todas</Link></p>
      )}
    </div>
  );
}