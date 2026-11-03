/**
 * Historial de un producto para el detalle de Alertas.
 *  - Ventas: reporte general de ventas de Elineas (rdp), filtrado por producto y almacén.
 *  - Existencias: fotos de inventario (`/inventory-snapshots`) de la API de REAB, si existen para ese producto.
 */
import { fetchRdpSalesForProduct } from "./elineasApiClient";
import { reabRequest } from "./reabApiClient";
import { getEstadoStock } from "@/utils/stockStatus";

const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / DAY));

/** Ventas del producto en un almacén: por mes (últimos N meses), fecha de la última venta y unidades de los últimos 30 días. */
export async function fetchSalesHistory({ idTienda, almacenKey }, months = 12) {
  const from = new Date(); from.setMonth(from.getMonth() - (months - 1)); from.setDate(1);
  const fromDate = from.toISOString().slice(0, 10);
  const rows = await fetchRdpSalesForProduct(idTienda, almacenKey, fromDate);

  const byMonth = new Map();
  const cursor = new Date(from);
  for (let i = 0; i < months; i++) { byMonth.set(cursor.toISOString().slice(0, 7), 0); cursor.setMonth(cursor.getMonth() + 1); }

  let lastSale = null, last30 = 0;
  const limit30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  for (const r of rows) {
    const d = (r.reportDate ?? "").slice(0, 10);
    const q = parseFloat(r.cantidad) || 0;
    if (!d || q <= 0) continue;
    const m = d.slice(0, 7);
    if (byMonth.has(m)) byMonth.set(m, byMonth.get(m) + q);
    if (!lastSale || d > lastSale) lastSale = d;
    if (d >= limit30) last30 += q;
  }
  return { months: [...byMonth].map(([mes, qty]) => ({ mes, qty: Math.round(qty * 100) / 100 })), lastSale, last30, hasData: rows.length > 0 };
}

/** Fotos de existencias del producto (más antiguas primero). Devuelve [] si no hay historial guardado. */
export async function fetchStockSnapshots(idTienda) {
  if (!idTienda) return [];
  try {
    const res = await reabRequest("GET", "/inventory-snapshots", {
      params: {
        offer_external_id: idTienda, sortBy: "snapshot_at", sortOrder: "desc", pageSize: 200, count: "none",
        fields: "snapshot_at,existencia_fisica,stock_reserva",
      },
    });
    return (res.data ?? [])
      .map(s => ({ fecha: s.snapshot_at, cantidad: (Number(s.existencia_fisica) || 0) + (Number(s.stock_reserva) || 0) }))
      .filter(s => s.fecha)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  } catch (err) {
    console.warn("[historial] no se pudieron leer las fotos de inventario:", err.message);
    return [];
  }
}

/**
 * Desde cuándo está el producto en su estado actual, según las fotos de existencias.
 * Para Déficit/Exceso se aplica el ritmo de ventas ACTUAL a las existencias de cada fecha.
 * Devuelve { fecha, dias, alMenos } o null si no se puede saber. `alMenos` = ya era así en la foto más antigua.
 */
export function estadoDesde(snapshots, tipo, prom) {
  const objetivo = { AGOTADO: "AGOTADO", "DÉFICIT": "DÉFICIT", EXCESO: "EXCESO", SIN_VENTAS: "SIN_VENTAS" }[tipo];
  if (!objetivo || !snapshots.length) return null;
  const clasif = (s) => getEstadoStock(s.cantidad, prom);
  if (clasif(snapshots[snapshots.length - 1]) !== objetivo) return null;   // la última foto ya no coincide con el estado actual
  let i = snapshots.length - 1;
  while (i > 0 && clasif(snapshots[i - 1]) === objetivo) i--;
  return { fecha: snapshots[i].fecha, dias: daysAgo(snapshots[i].fecha), alMenos: i === 0 };
}
