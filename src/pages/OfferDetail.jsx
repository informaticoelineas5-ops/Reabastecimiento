import React from "react";
import { base44 } from "@/api/base44Client";
import { fetchExtProductById, fetchExtProductByIdOnline } from "@/api/externalSupabaseClient";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Package, Tag, Warehouse, AlertTriangle, Clock,
  DollarSign, BarChart3, CheckCircle, XCircle, TrendingUp, TrendingDown,
  Minus, History, RefreshCw,
} from "lucide-react";
import OfferStatusBadge from "../components/catalog/OfferStatusBadge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

function DetailRow({ label, value, highlight }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium text-right max-w-[60%] ${highlight ? "text-primary" : ""}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function BoolBadge({ value, trueLabel = "Sí", falseLabel = "No" }) {
  return value ? (
    <Badge className="bg-accent/10 text-accent text-[10px]">
      <CheckCircle size={10} className="mr-1" />{trueLabel}
    </Badge>
  ) : (
    <Badge className="bg-muted text-muted-foreground text-[10px]">
      <XCircle size={10} className="mr-1" />{falseLabel}
    </Badge>
  );
}

function DiffCell({ prev, curr, fmt = (v) => v, invert = false }) {
  if (prev == null) return <span className="text-muted-foreground">—</span>;
  const diff = curr - prev;
  if (diff === 0) return (
    <span className="text-muted-foreground flex items-center gap-0.5 justify-end">
      <Minus size={10} /> 0
    </span>
  );
  const isPositive = invert ? diff < 0 : diff > 0;
  return (
    <span className={`flex items-center gap-0.5 justify-end font-medium ${isPositive ? "text-success" : "text-destructive"}`}>
      {diff > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {diff > 0 ? "+" : ""}{fmt(diff)}
    </span>
  );
}

const STATUS_HINT_MAP = {
  dead:     { label: "Eliminado",   cls: "bg-destructive/10 text-destructive" },
  disabled: { label: "Desactivado", cls: "bg-warning/10 text-warning" },
  inactive: { label: "Inactivo",    cls: "bg-muted text-muted-foreground" },
};

export default function OfferDetail({ productId: propProductId, onClose }) {
  const hashSearch = window.location.hash.includes("?")
    ? window.location.hash.split("?")[1]
    : "";
  const productId = propProductId ?? new URLSearchParams(hashSearch).get("id");

  // Si el id parece un UUID (viene del Catálogo) → busca por products.id
  // Si parece un id numérico/externo (viene de Alertas via offer_external_id) → busca por products.id_online
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId ?? "");

  // ── Producto desde Supabase externo ────────────────────────
  const { data: raw, isLoading } = useQuery({
    queryKey: ["ext-product", productId],
    queryFn:  () => isUUID
      ? fetchExtProductById(productId)
      : fetchExtProductByIdOnline(productId),
    enabled:  !!productId,
  });

  // Normaliza campos del external al formato que espera el componente
  const p = raw ? {
    ...raw,
    offer_external_id: raw.id_online,
    existencia_fisica:  raw.cantidad     ?? 0,
    stock_reserva:      raw.reserved_qty ?? 0,
    fotos: Array.isArray(raw.fotos) ? raw.fotos.map(f => f.foto).filter(Boolean) : [],
  } : null;

  // ── Snapshots desde main Supabase (por offer_external_id) ──
  const { data: snapshots = [] } = useQuery({
    queryKey: ["snapshots-ext", raw?.id_online],
    queryFn:  () => base44.entities.InventorySnapshot.filter(
      { offer_external_id: String(raw.id_online) },
      "-snapshot_at",
      200
    ),
    enabled: !!raw?.id_online,
  });

  // ── Loading / not found ─────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-[340px]" />
          <Skeleton className="h-[340px]" />
          <Skeleton className="h-[340px]" />
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Producto no encontrado</p>
        {onClose ? (
          <Button variant="outline" className="mt-4" onClick={onClose}>Volver al catálogo</Button>
        ) : (
          <Link to={createPageUrl("Catalog")}>
            <Button variant="outline" className="mt-4">Volver al catálogo</Button>
          </Link>
        )}
      </div>
    );
  }

  const ef = p.existencia_fisica;
  const sr = p.stock_reserva;

  // ── Alertas ─────────────────────────────────────────────────
  const alerts = [];
  if (!p.is_dead && ef === 0)  alerts.push({ text: "Producto activo sin stock", severity: "critical" });
  if (p.is_dead  && ef > 0)   alerts.push({ text: "Producto eliminado con stock remanente", severity: "warning" });
  if (sr > 0     && ef === 0) alerts.push({ text: "Reserva > 0 pero existencia = 0", severity: "warning" });
  if (p.revision)             alerts.push({ text: "Revisión pendiente", severity: "info" });
  if (p.has_catalog_diff)     alerts.push({ text: "Diferencia de catálogo detectada", severity: "info" });
  if (p.en_promocion)         alerts.push({ text: `En promoción: $${p.precio_oferta?.toFixed(2) ?? "—"}`, severity: "info" });

  // ── Chart data ──────────────────────────────────────────────
  const chartData = [...snapshots].reverse().map((s) => ({
    date:      s.snapshot_at ? format(new Date(s.snapshot_at), "dd/MM HH:mm") : "",
    existencia: s.existencia_fisica || 0,
    reserva:    s.stock_reserva    || 0,
    tienda:     s.stock_tienda     || 0,
    precio:     s.precio           || 0,
  }));

  // ── Audit rows ──────────────────────────────────────────────
  const auditRows = snapshots.map((s, idx) => {
    const prev = snapshots[idx + 1];
    const changes = [];
    if (prev) {
      if ((s.precio || 0)           !== (prev.precio || 0))           changes.push("Precio");
      if ((s.existencia_fisica || 0) !== (prev.existencia_fisica || 0)) changes.push("Existencia");
      if ((s.stock_reserva || 0)    !== (prev.stock_reserva || 0))    changes.push("Reserva");
      if ((s.stock_tienda || 0)     !== (prev.stock_tienda || 0))     changes.push("Tienda");
    }
    return { snapshot: s, prev, changes };
  });

  const statusHint = STATUS_HINT_MAP[p.offer_status_hint];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        {onClose ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <ArrowLeft size={16} />
          </Button>
        ) : (
          <Link to={createPageUrl("Catalog")}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft size={16} />
            </Button>
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold truncate">{p.nombre}</h1>
            <OfferStatusBadge offer={p} />
            {statusHint && (
              <Badge className={`text-[10px] ${statusHint.cls}`}>{statusHint.label}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Código: {p.codigo} · ID Externo: {p.id_online ?? "—"}</span>
            {p.last_synced_at && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                <RefreshCw size={9} />
                Sinc. {formatDistanceToNow(new Date(p.last_synced_at), { locale: es, addSuffix: true })}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Alertas ── */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.map((a, i) => (
            <Badge key={i} className={`text-xs ${
              a.severity === "critical" ? "bg-destructive/10 text-destructive border-destructive/20" :
              a.severity === "warning"  ? "bg-warning/10 text-warning border-warning/20" :
              "bg-info/10 text-info border-info/20"
            }`}>
              <AlertTriangle size={10} className="mr-1" />{a.text}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Fotos ── */}
      {p.fotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {p.fotos.map((url, i) => (
            <img key={i} src={url} alt={`Foto ${i + 1}`}
              className="h-24 w-24 rounded-lg object-cover flex-shrink-0 border border-border" />
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info"      className="gap-1.5"><Package  size={13} /> Info</TabsTrigger>
          <TabsTrigger value="graficos"  className="gap-1.5"><BarChart3 size={13} /> Gráficos</TabsTrigger>
          <TabsTrigger value="auditoria" className="gap-1.5">
            <History size={13} /> Auditoría
            {snapshots.length > 0 && (
              <span className="ml-1 bg-primary/15 text-primary text-[10px] px-1.5 rounded-full font-semibold">
                {snapshots.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ═══ INFO ═══ */}
        <TabsContent value="info" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Producto */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Package size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Producto</h3>
              </div>
              <DetailRow label="Código"        value={p.codigo}          highlight />
              <DetailRow label="Nombre"         value={p.nombre} />
              <DetailRow label="Marca"          value={p.marca} />
              <DetailRow label="Suministrador"  value={p.suministrador} />
              <DetailRow label="Cat. Online"    value={p.categoria_online} />
              <DetailRow label="Cat. Almacén"   value={p.categoria_almacen} />
              <DetailRow label="Unidad Medida"  value={p.unidad_medida} />
              <DetailRow label="Unidad Compra"  value={p.unidad_compra} />
              <DetailRow label="Peso"           value={p.peso != null ? `${p.peso} lb` : null} />
              <DetailRow label="Almacén"        value={p.proveedor} />
            </Card>

            {/* Oferta */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Oferta</h3>
              </div>
              <DetailRow label="ID Externo"    value={p.id_online}                                              highlight />
              <DetailRow label="Precio costo"  value={p.precio     != null ? `$${p.precio.toFixed(2)}`     : null} />
              <DetailRow label="Precio tienda" value={p.precio_venta != null ? `$${p.precio_venta.toFixed(2)}` : null} />
              {p.en_promocion && (
                <DetailRow label="Precio oferta" value={p.precio_oferta != null ? `$${p.precio_oferta.toFixed(2)}` : null} />
              )}
              <DetailRow label="Clasificación" value={p.clasificacion} />
              <DetailRow label="Canal"         value={p.canal} />
              <DetailRow label="Min Kontrol"   value={p.store_min_kontrol} />
              <div className="flex flex-wrap gap-1.5 mt-3">
                <BoolBadge value={p.is_dead}         trueLabel="Dead"          falseLabel="Viva" />
                <BoolBadge value={p.revision}        trueLabel="En revisión"   falseLabel="Sin revisión" />
                <BoolBadge value={p.usa_catalogo}    trueLabel="Catálogo"      falseLabel="Sin catálogo" />
                <BoolBadge value={p.has_catalog_diff} trueLabel="Diff"         falseLabel="Sin diff" />
                {p.en_promocion && (
                  <Badge className="bg-warning/10 text-warning text-[10px]">En promoción</Badge>
                )}
              </div>
            </Card>

            {/* Inventario */}
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Inventario</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className={`text-xl font-bold ${ef === 0 ? "text-destructive" : ""}`}>{ef}</p>
                  <p className="text-[10px] text-muted-foreground">Existencia</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-xl font-bold">{sr}</p>
                  <p className="text-[10px] text-muted-foreground">Reserva</p>
                </div>
              </div>
              <DetailRow label="Kontrol"            value={p.kontrol} />
              <DetailRow label="Controla existencia" value={p.controla_existencia ? "Sí" : "No"} />
              <div className="flex flex-wrap gap-1.5 mt-3">
                <BoolBadge value={p.is_active_store}     trueLabel="Activo tienda"    falseLabel="Inactivo tienda" />
                <BoolBadge value={p.is_restocking_store} trueLabel="Reabasteciendo"   falseLabel="Sin reabastecer" />
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ GRÁFICOS ═══ */}
        <TabsContent value="graficos" className="mt-4">
          {chartData.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              Sin datos de historial disponibles.
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-primary" /> Evolución Stock
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="existencia" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Existencia" />
                    <Line type="monotone" dataKey="reserva"    stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} name="Reserva" />
                    <Line type="monotone" dataKey="tienda"     stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} name="Tienda" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <DollarSign size={14} className="text-primary" /> Evolución Precio
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="precio" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} name="Precio" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ═══ AUDITORÍA ═══ */}
        <TabsContent value="auditoria" className="mt-4">
          {snapshots.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              <History size={24} className="mx-auto mb-2 opacity-30" />
              No hay snapshots de auditoría para este producto.
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total snapshots", value: snapshots.length },
                  { label: "Primer registro",  value: format(new Date(snapshots[snapshots.length - 1].snapshot_at), "dd/MM/yyyy") },
                  { label: "Último registro",  value: format(new Date(snapshots[0].snapshot_at), "dd/MM/yyyy HH:mm") },
                  { label: "Precio actual",    value: `$${(snapshots[0]?.precio || 0).toFixed(2)}` },
                ].map((stat) => (
                  <Card key={stat.label} className="p-3 text-center">
                    <p className="text-base font-bold">{stat.value}</p>
                    <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                  </Card>
                ))}
              </div>

              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-primary" /> Registro detallado de cambios
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-left  font-semibold">Fecha importación</th>
                        <th className="py-2 text-right font-semibold">Existencia</th>
                        <th className="py-2 text-right font-semibold">Δ Exist.</th>
                        <th className="py-2 text-right font-semibold">Reserva</th>
                        <th className="py-2 text-right font-semibold">Δ Reserva</th>
                        <th className="py-2 text-right font-semibold">Tienda</th>
                        <th className="py-2 text-right font-semibold">Δ Tienda</th>
                        <th className="py-2 text-right font-semibold">Precio</th>
                        <th className="py-2 text-right font-semibold">Δ Precio</th>
                        <th className="py-2 text-center font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map(({ snapshot: s, prev, changes }) => {
                        const ok = (s.existencia_fisica || 0) === (s.stock_reserva || 0) + (s.stock_tienda || 0);
                        return (
                          <tr key={s.id} className={`border-b border-border/50 hover:bg-muted/30 ${changes.length > 0 ? "bg-primary/2" : ""}`}>
                            <td className="py-2 font-mono">
                              {s.snapshot_at ? format(new Date(s.snapshot_at), "dd/MM/yyyy HH:mm") : "—"}
                              {changes.length > 0 && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 bg-primary/10 text-primary px-1 rounded text-[9px]">
                                  {changes.length} cambio{changes.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right font-medium">{s.existencia_fisica ?? "—"}</td>
                            <td className="py-2 text-right">
                              <DiffCell prev={prev?.existencia_fisica} curr={s.existencia_fisica} />
                            </td>
                            <td className="py-2 text-right">{s.stock_reserva ?? "—"}</td>
                            <td className="py-2 text-right">
                              <DiffCell prev={prev?.stock_reserva} curr={s.stock_reserva} />
                            </td>
                            <td className="py-2 text-right">{s.stock_tienda ?? "—"}</td>
                            <td className="py-2 text-right">
                              <DiffCell prev={prev?.stock_tienda} curr={s.stock_tienda} />
                            </td>
                            <td className="py-2 text-right">${(s.precio || 0).toFixed(2)}</td>
                            <td className="py-2 text-right">
                              <DiffCell prev={prev?.precio} curr={s.precio} fmt={(v) => `$${Math.abs(v).toFixed(2)}`} />
                            </td>
                            <td className="py-2 text-center">
                              {ok
                                ? <CheckCircle size={12} className="inline text-success" />
                                : <AlertTriangle size={12} className="inline text-destructive" title={`${s.existencia_fisica} ≠ ${s.stock_reserva} + ${s.stock_tienda}`} />
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
