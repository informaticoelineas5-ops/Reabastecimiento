import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getUserPreferences } from "@/api/userPreferencesClient";
import { fetchProductsForAlmacen } from "@/api/externalSupabaseClient";
import {
  AlertTriangle, AlertCircle, Info, ExternalLink, ShieldAlert, Warehouse
} from "lucide-react";

const ALERT_TYPES = {
  inconsistency:    { label: "Inconsistencia inventario",  icon: AlertCircle,  severity: "critical" },
  active_no_stock:  { label: "Oferta activa sin stock",    icon: AlertTriangle, severity: "critical" },
  dead_with_stock:  { label: "Oferta eliminada con stock", icon: AlertTriangle, severity: "warning"  },
  reserva_no_tienda:{ label: "Reserva > 0, Tienda = 0",   icon: AlertTriangle, severity: "warning"  },
  revision_pending: { label: "Revisión pendiente",         icon: Info,          severity: "info"     },
  catalog_diff:     { label: "Diferencia de catálogo",     icon: Info,          severity: "info"     },
  cantidad_mismatch:{ label: "Cantidad ≠ Existencia",      icon: AlertTriangle, severity: "warning"  },
  kontrol_mismatch: { label: "Kontrol ≠ Stock tienda",     icon: AlertTriangle, severity: "warning"  },
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

const severityStyles = {
  critical: {
    card:   "bg-destructive/5 border-destructive/20",
    text:   "text-destructive",
    badge:  "bg-destructive/10 text-destructive border-destructive/20",
  },
  warning: {
    card:   "bg-warning/5 border-warning/20",
    text:   "text-warning",
    badge:  "bg-warning/10 text-warning border-warning/20",
  },
  info: {
    card:   "bg-info/5 border-info/20",
    text:   "text-info",
    badge:  "bg-info/10 text-info border-info/20",
  },
};

export default function Alerts() {
  const [filterType, setFilterType]         = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");

  // Almacén del usuario (misma fuente que Catálogo y Ranking)
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn:  getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });
  const userAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  const { data: allOffers = [], isLoading: loadingOffers } = useQuery({
    queryKey: ["offers-alerts"],
    queryFn:  () => base44.entities.Offer.list("-updated_date", 5000),
  });

  // Productos de los almacenes del usuario desde ELINEAS_DB
  const { data: almacenProductsMap = new Map(), isLoading: loadingProducts } = useQuery({
    queryKey: ["products-for-almacen-alerts", userAlmacenes],
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

  const isLoading = loadingOffers || (userAlmacenes.length > 0 && loadingProducts);

  // Filtrar offers de REAB cuyo offer_external_id coincida con un producto del almacén
  const offers = useMemo(() => {
    if (!userAlmacenes.length || almacenProductsMap.size === 0) return allOffers;
    return allOffers.filter(o => {
      const extId = String(o.offer_external_id ?? o.tienda_internal_id ?? "");
      return extId && almacenProductsMap.has(extId);
    });
  }, [allOffers, userAlmacenes, almacenProductsMap]);

  // Genera lista plana de alertas
  const alerts = useMemo(() => {
    const result = [];
    offers.forEach((o) => {
      const ef = o.existencia_fisica || 0;
      const sr = o.stock_reserva    || 0;
      const st = o.stock_tienda     || 0;

      if (ef !== sr + st)
        result.push({ type: "inconsistency",     offer: o, detail: `${ef} ≠ ${sr} + ${st}` });
      if (!o.is_dead && ef === 0)
        result.push({ type: "active_no_stock",   offer: o, detail: "Existencia = 0" });
      if (o.is_dead && ef > 0)
        result.push({ type: "dead_with_stock",   offer: o, detail: `Existencia: ${ef}` });
      if (sr > 0 && st === 0)
        result.push({ type: "reserva_no_tienda", offer: o, detail: `Reserva: ${sr}` });
      if (o.revision)
        result.push({ type: "revision_pending",  offer: o, detail: "Pendiente de aprobación" });
      if (o.has_catalog_diff)
        result.push({ type: "catalog_diff",      offer: o, detail: "Diferencias detectadas" });
      if (o.cantidad_reporte1 != null && o.cantidad_reporte1 !== ef)
        result.push({ type: "cantidad_mismatch", offer: o, detail: `R1: ${o.cantidad_reporte1} ≠ ${ef}` });
      if (o.kontrol_reporte1 != null && o.kontrol_reporte1 !== st)
        result.push({ type: "kontrol_mismatch",  offer: o, detail: `R1: ${o.kontrol_reporte1} ≠ ${st}` });
    });
    return result;
  }, [offers]);

  // Agrupa alertas por producto — un producto puede tener varios tipos de alerta
  const grouped = useMemo(() => {
    const map = new Map();
    alerts.forEach(alert => {
      const key = alert.offer.id;
      if (!map.has(key)) map.set(key, { offer: alert.offer, items: [] });
      map.get(key).items.push(alert);
    });
    return [...map.values()]
      .map(g => ({
        ...g,
        maxSeverity: g.items.reduce((max, a) => {
          const sev = ALERT_TYPES[a.type]?.severity ?? "info";
          return SEVERITY_ORDER[sev] < SEVERITY_ORDER[max] ? sev : max;
        }, "info"),
      }))
      .sort((a, b) => SEVERITY_ORDER[a.maxSeverity] - SEVERITY_ORDER[b.maxSeverity]);
  }, [alerts]);

  // Filtrado sobre grupos
  const filteredGroups = useMemo(() =>
    grouped.filter(g => {
      if (filterType !== "all" && !g.items.some(a => a.type === filterType)) return false;
      if (filterSeverity !== "all" && !g.items.some(a => ALERT_TYPES[a.type]?.severity === filterSeverity)) return false;
      return true;
    }),
  [grouped, filterType, filterSeverity]);

  // Conteos para el resumen (por tipo de alerta, no por producto)
  const summary = {};
  alerts.forEach(a => { summary[a.type] = (summary[a.type] || 0) + 1; });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center">
          <ShieldAlert size={18} className="text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Centro de Alertas</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {alerts.length} alertas en {grouped.length} productos · {offers.length} ofertas revisadas
            {userAlmacenes.length > 0 && (
              <><span>·</span>
              <Warehouse size={10} className="inline" />
              <span className="font-medium text-foreground">{userAlmacenes.length === 1 ? userAlmacenes[0] : `${userAlmacenes.length} almacenes`}</span></>
            )}
            {!userAlmacenes.length && <span className="text-warning">· Todos los almacenes (configura en Índices de Ventas)</span>}
          </p>
        </div>
      </div>

      {/* Resumen clicable por tipo */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(summary).map(([type, count]) => {
          const config = ALERT_TYPES[type];
          if (!config) return null;
          const sty = severityStyles[config.severity];
          return (
            <Badge
              key={type}
              variant="outline"
              className={`cursor-pointer text-xs py-1 px-2 ${sty.badge} ${filterType === type ? "ring-2 ring-offset-1 ring-current" : ""}`}
              onClick={() => setFilterType(type === filterType ? "all" : type)}
            >
              {config.label}: {count}
            </Badge>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[220px] h-8 text-xs">
            <SelectValue placeholder="Tipo de alerta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(ALERT_TYPES).map(([key, config]) => (
              <SelectItem key={key} value={key}>{config.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Severidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="critical">Crítica</SelectItem>
            <SelectItem value="warning">Advertencia</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground self-center ml-1">
          {filteredGroups.length} productos
        </p>
      </div>

      {/* Lista agrupada por producto */}
      <div className="space-y-2">
        {filteredGroups.map((group) => {
          const sty = severityStyles[group.maxSeverity];
          const MaxIcon = ALERT_TYPES[group.items.find(a =>
            ALERT_TYPES[a.type]?.severity === group.maxSeverity
          )?.type]?.icon ?? AlertCircle;

          return (
            <Card key={group.offer.id} className={`p-3 border ${sty.card}`}>
              <div className="flex items-start gap-3">
                <MaxIcon size={16} className={`flex-shrink-0 mt-0.5 ${sty.text}`} />
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* Nombre del producto */}
                  <p className="text-xs">
                    <span className={`font-mono font-semibold ${sty.text}`}>{group.offer.codigo}</span>
                    {" · "}
                    <span className="font-medium">{group.offer.nombre}</span>
                  </p>
                  {/* Badges de alertas */}
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((alert, j) => {
                      const config = ALERT_TYPES[alert.type];
                      const alertSty = severityStyles[config.severity];
                      return (
                        <Badge
                          key={j}
                          variant="outline"
                          className={`text-[10px] ${alertSty.badge}`}
                        >
                          {config.label} · {alert.detail}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <Link to={createPageUrl("OfferDetail") + `?id=${group.offer.offer_external_id || group.offer.id}`}>
                  <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                    <ExternalLink size={12} />
                  </Button>
                </Link>
              </div>
            </Card>
          );
        })}

        {filteredGroups.length === 0 && (
          <Card className="p-12 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <ShieldAlert size={22} className="text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {filterType !== "all" || filterSeverity !== "all" ? "Sin resultados" : "Sin alertas activas"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {filterType !== "all" || filterSeverity !== "all"
                  ? "No se encontraron alertas con los filtros seleccionados."
                  : "Todos los productos tienen su inventario en orden."}
              </p>
            </div>
            {(filterType !== "all" || filterSeverity !== "all") && (
              <Button size="sm" variant="outline" onClick={() => { setFilterType("all"); setFilterSeverity("all"); }}>
                Limpiar filtros
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
