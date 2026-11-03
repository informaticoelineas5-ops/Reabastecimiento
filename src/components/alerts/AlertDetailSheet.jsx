import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, ReferenceLine,
} from "recharts";
import { Clock, History as HistoryIcon, BarChart3, Info } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import ImageGallery from "@/components/common/ImageGallery";
import { fetchSalesHistory, fetchStockSnapshots, estadoDesde, daysAgo } from "@/api/productHistoryClient";
import { STOCK_DEFICIT_DAYS, STOCK_EXCESO_DAYS } from "@/utils/stockStatus";
import { extractAlmacenKey } from "@/api/salesIndicesClient";

// Oculto mientras no haya historial de existencias guardado en el backend (ver PEDIDO_BACKEND_HISTORIAL_STOCK.md)
const MOSTRAR_DESDE_CUANDO = false;

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const fmtMes = (ym) => `${MESES[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(2, 4)}`;
const fmtFecha = (iso) => { try { return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; } };

function Kpi({ label, value, sub, cls }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-bold tabular-nums ${cls ?? ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Barra de cobertura: rojo < 15 d · verde 15–60 d · azul > 60 d, con un marcador en la cobertura actual
function CoverageGauge({ dias }) {
  const MAX = 120;
  const pos = dias == null ? null : Math.min(Math.max(dias, 0), MAX) / MAX * 100;
  return (
    <div className="space-y-1">
      <div className="relative h-3 rounded-full overflow-hidden flex">
        <div className="bg-red-400/70" style={{ width: `${(STOCK_DEFICIT_DAYS / MAX) * 100}%` }} />
        <div className="bg-emerald-400/70" style={{ width: `${((STOCK_EXCESO_DAYS - STOCK_DEFICIT_DAYS) / MAX) * 100}%` }} />
        <div className="bg-blue-400/70 flex-1" />
        {pos != null && <div className="absolute top-0 bottom-0 w-1 bg-foreground rounded" style={{ left: `calc(${pos}% - 2px)` }} />}
      </div>
      <div className="relative h-3 text-[9px] text-muted-foreground">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(STOCK_DEFICIT_DAYS / MAX) * 100}%` }}>{STOCK_DEFICIT_DAYS} d</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(STOCK_EXCESO_DAYS / MAX) * 100}%` }}>{STOCK_EXCESO_DAYS} d</span>
        <span className="absolute right-0">{MAX}+ d</span>
      </div>
    </div>
  );
}

function explain(a) {
  const dias = a.dias != null ? Math.round(a.dias) : null;
  switch (a.tipo) {
    case "AGOTADO":    return "Sin existencia en el almacén.";
    case "DÉFICIT":    return `Cubre ${dias} días de venta, por debajo del mínimo de ${STOCK_DEFICIT_DAYS} días (ritmo actual: ${a.prom.toFixed(3)} u/día).`;
    case "EXCESO": {
      const sobrante = Math.max(0, Math.round(a.cantidad - a.prom * STOCK_EXCESO_DAYS));
      return `Cubre ${dias} días de venta, por encima de ${STOCK_EXCESO_DAYS} días. Sobrante estimado: ${sobrante.toLocaleString()} u.`;
    }
    case "SIN_VENTAS": return "Tiene existencia pero no registra ventas.";
    case "MUERTO":     return `Anuncio "${a.estadoAnuncio}" con ${a.cantidad.toLocaleString()} unidades en existencia.`;
    default:           return "";
  }
}

/** Panel lateral con el detalle de una alerta: imagen, estado, desde cuándo y gráficos. */
export default function AlertDetailSheet({ alert: a, cfg, onClose }) {
  const open = !!a;
  const idTienda = a?.id;

  const stockQ = useQuery({
    queryKey: ["alert-stock-history", idTienda],
    queryFn: () => fetchStockSnapshots(idTienda),
    enabled: open, staleTime: 10 * 60 * 1000,
  });
  // Ventas del producto en el almacén de la alerta (la misma base de los índices de venta)
  const almacenKey = a?.p?.almacenKey ?? extractAlmacenKey(a?.p?.proveedor);
  const salesQ = useQuery({
    queryKey: ["alert-sales-history", idTienda, almacenKey],
    queryFn: () => fetchSalesHistory({ idTienda, almacenKey }, 12),
    enabled: open && !!idTienda && !!almacenKey, staleTime: 10 * 60 * 1000, retry: false,
  });

  const desde = useMemo(() => (a && stockQ.data ? estadoDesde(stockQ.data, a.tipo, a.prom) : null), [a, stockQ.data]);
  const images = useMemo(() => (a?.p?.fotos ?? []).map(f => f?.foto ?? f).filter(Boolean), [a]);
  const Icon = cfg?.icon;

  const stockSeries = (stockQ.data ?? []).map(s => ({ fecha: s.fecha.slice(0, 10), cantidad: s.cantidad }));
  const hasStockHistory = stockSeries.length >= 2;
  const sales = salesQ.data;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {a && (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2">
                {cfg && (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                    {Icon && <Icon size={12} />} {cfg.label}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground font-mono">{a.p.codigo} · {a.id}</span>
              </div>
              <SheetTitle className="text-base leading-snug">{a.p.nombre}</SheetTitle>
              <SheetDescription className="text-xs">
                {[a.p.proveedor, a.p.suministrador, a.p.categoria_online].filter(Boolean).join(" · ") || "—"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <ImageGallery images={images} name={a.p.nombre} codigo={a.p.codigo} />

              {/* Cifras */}
              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Existencia" value={a.cantidad.toLocaleString()} cls={a.cantidad === 0 ? "text-destructive" : ""}
                  sub={a.p.reserved_qty ? `${(a.p.cantidad ?? 0).toLocaleString()} + ${a.p.reserved_qty.toLocaleString()} reserv.` : undefined} />
                <Kpi label="Venta diaria (P.>0)" value={a.prom > 0 ? a.prom.toFixed(3) : "—"} />
                <Kpi label="Cobertura" value={a.dias != null ? (a.dias < 0.5 ? "<1 d" : `${Math.round(a.dias)} d`) : "—"} />
              </div>

              {/* Estado actual */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Info size={13} /> Por qué está en alerta</h3>
                <p className="text-sm">{explain(a)}</p>
                {a.prom > 0 && <CoverageGauge dias={a.dias} />}
              </section>

              {/* Desde cuándo */}
              {MOSTRAR_DESDE_CUANDO && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Clock size={13} /> Desde cuándo</h3>
                {stockQ.isLoading ? <Skeleton className="h-10 w-full" /> : desde ? (
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <p className="text-sm font-semibold">
                      {desde.alMenos ? "Al menos desde " : "Desde "}{fmtFecha(desde.fecha)}
                      <span className="ml-2 text-muted-foreground font-normal">· hace {desde.dias} {desde.dias === 1 ? "día" : "días"}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Según las fotos de inventario guardadas{desde.alMenos ? " (no hay fotos anteriores a esa fecha)" : ""}.
                      {(a.tipo === "DÉFICIT" || a.tipo === "EXCESO") && " Se aplica el ritmo de ventas actual a las existencias de cada fecha."}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 space-y-1">
                    <p className="text-sm text-muted-foreground">
                      No hay historial de existencias guardado para este producto, así que no se puede saber desde cuándo está así.
                    </p>
                    {a.tipo === "AGOTADO" && sales?.lastSale && (
                      <p className="text-xs">
                        <span className="font-medium">Última venta:</span> {fmtFecha(sales.lastSale)} (hace {daysAgo(sales.lastSale)} días).
                        <span className="text-muted-foreground"> Es solo una referencia: el producto pudo agotarse antes o después de esa venta.</span>
                      </p>
                    )}
                  </div>
                )}
              </section>
              )}

              {/* Gráfico de existencias */}
              {hasStockHistory && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><HistoryIcon size={13} /> Existencia en el tiempo</h3>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stockSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="fecha" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v) => [v.toLocaleString(), "Existencia"]} labelFormatter={fmtFecha} />
                        {a.prom > 0 && <ReferenceLine y={a.prom * STOCK_DEFICIT_DAYS} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: `mín. ${STOCK_DEFICIT_DAYS} d`, fontSize: 9, fill: "#f59e0b", position: "insideTopRight" }} />}
                        {a.prom > 0 && <ReferenceLine y={a.prom * STOCK_EXCESO_DAYS} stroke="#3b82f6" strokeDasharray="4 3" label={{ value: `${STOCK_EXCESO_DAYS} d`, fontSize: 9, fill: "#3b82f6", position: "insideTopRight" }} />}
                        <Area type="stepAfter" dataKey="cantidad" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Gráfico de ventas */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><BarChart3 size={13} /> Ventas por mes (últimos 12 meses)</h3>
                {salesQ.isLoading ? <Skeleton className="h-44 w-full" /> : salesQ.isError ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                    No se pudo cargar el historial de ventas de este producto: {salesQ.error?.message}
                  </p>
                ) : !sales?.hasData ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                    Sin ventas registradas en este almacén en los últimos 12 meses.
                  </p>
                ) : (
                  <>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sales.months} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="mes" tick={{ fontSize: 10 }} tickFormatter={fmtMes} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v) => [v.toLocaleString(), "Unidades"]} labelFormatter={fmtMes} />
                          <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Últimos 30 días: <strong className="text-foreground">{sales.last30.toLocaleString()}</strong> u
                      {sales.lastSale && <> · última venta: {fmtFecha(sales.lastSale)}</>}
                      . Ventas del almacén {almacenKey}; fuente: reporte general de ventas.
                    </p>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
