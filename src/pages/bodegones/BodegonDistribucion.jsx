import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { getRawTextItems } from "@/utils/pdfParser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { FileText, ArrowRightLeft, Loader2, X,
  History, TrendingUp, Search,
  ClipboardList, Send as SendIcon, Download, AlertTriangle, Check, List, CheckCircle2, Circle, PartyPopper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchCatalogProducts, fetchProductInBodegones, fetchProductsByIdOnlines, searchProductsByCodeSuffix,
  findProductByCode,
} from "@/api/externalSupabaseClient";
import { fetchSalesIndexByIdTienda, computeIndiceAvg } from "@/api/salesIndicesClient";
import * as XLSX from "xlsx";
import ManualInvoiceForm from "./ManualInvoiceForm";
import SearchSelect from "@/components/common/SearchSelect";
import ProductImageHover from "@/components/procurement/ProductImageHover";
import InvoiceList from "./InvoiceList";
import InvoiceHistoryDialog from "./InvoiceHistoryDialog";
import { loadExternalSuppliers } from "@/api/externalSuppliersStore";
import {
  createInvoice, getInvoice, saveInvoice, addInvoiceEvent, getInvoicePdf,
  priceHistoryForInvoice, diffRows,
  executeInvoice, reconcileInvoiceExecutions, resolveInvoiceExecutions,
} from "@/api/externalInvoicesStore";
import { getDistribucionMode } from "@/api/distribucionMode";
import TkcExecuteDialog from "./TkcExecuteDialog";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { fetchSm23Associations, saveSm23Associations } from "@/api/sm23Client";

// ── U/C extraction ────────────────────────────────────────────────────────────
function extractUC(name) {
  const nxm = name.match(/\((\d+)\s*[xX×]/);
  if (nxm) return parseInt(nxm[1]);
  const uMatch = name.match(/\((\d+)\s*[Uu]\)/);
  if (uMatch) {
    const n = parseInt(uMatch[1]);
    return n > 20 ? n : 1;
  }
  return 1;
}

// ── Mayorista23 PDF parser ─────────────────────────────────────────────────────
// Cada producto se ancla en su fila numérica: [cantidad] [precio] [importe] con
// cantidad × precio ≈ importe. Se evalúa fila por fila, así funciona aunque cada
// página del PDF tenga las columnas en otra posición X. La descripción es el texto
// a la izquierda de la cantidad, dentro de la banda vertical de ese producto.
// La lista termina en la fila "Total Productos (USD)".

const NUM_RE   = /^\$?\d[\d,]*\.\d{2}$/;
const INT_RE   = /^\d{1,4}$/;
const toNum    = (s) => parseFloat((s ?? "").replace(/[$,]/g, ""));
const DESC_CAP = 24;   // máx. distancia vertical (pt) de una línea de descripción a su fila numérica
const LINE_TOL = 3;    // tolerancia (pt) para considerar dos items en la misma línea

// items: ordenados por y desc. Devuelve filas [{p, y, items(ordenados por x)}].
function groupRows(items) {
  const rows = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && last.p === it.p && Math.abs(last.y - it.y) <= LINE_TOL) last.items.push(it);
    else rows.push({ p: it.p, y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

function parseMayorista23Items(rawItems) {
  const rows = groupRows(rawItems);

  const stopIdx  = rows.findIndex(r => /total\s+productos/i.test(r.items.map(i => i.t).join(" ")));
  const listRows = stopIdx >= 0 ? rows.slice(0, stopIdx) : rows;
  let invoiceTotal = null;
  if (stopIdx >= 0) {
    const nums = rows[stopIdx].items.filter(i => NUM_RE.test(i.t));
    if (nums.length) invoiceTotal = toNum(nums[nums.length - 1].t);
  }

  const anchors = [];
  for (const row of listRows) {
    const nums = row.items.filter(i => NUM_RE.test(i.t));
    if (nums.length < 2) continue;
    const totalIt = nums[nums.length - 1];
    const unitIt  = nums[nums.length - 2];
    const qtyIt   = [...row.items].reverse().find(i => INT_RE.test(i.t) && i.x < unitIt.x);
    if (!qtyIt) continue;
    const total = toNum(totalIt.t);
    const unit  = toNum(unitIt.t);
    const qty   = parseInt(qtyIt.t, 10);
    if (!qty || !unit || Math.abs(qty * unit - total) > Math.max(0.06, total * 0.005)) {
      console.log(`[parser] fila p${row.p} descartada: ${qtyIt.t} × ${unitIt.t} ≠ ${totalIt.t}`);
      continue;
    }
    anchors.push({ p: row.p, y: row.y, qty, unit, total, qtyX: qtyIt.x });
  }

  const products = [];
  let sumImportes = 0;

  anchors.forEach((a, i) => {
    const prev = anchors[i - 1]?.p === a.p ? anchors[i - 1] : null;
    const next = anchors[i + 1]?.p === a.p ? anchors[i + 1] : null;
    const top    = Math.min(prev ? (prev.y + a.y) / 2 : Infinity,  a.y + DESC_CAP);
    const bottom = Math.max(next ? (next.y + a.y) / 2 : -Infinity, a.y - DESC_CAP);

    const descItems = rawItems.filter(it =>
      it.p === a.p && it.x < a.qtyX - 4 && it.y <= top && it.y > bottom,
    );
    const nombre = groupRows(descItems)
      .map(r => r.items.map(it => it.t).join(" "))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (nombre.length < 4) {
      console.log(`[parser] ancla p${a.p} (importe ${a.total}) descartada: sin descripción`);
      return;
    }

    sumImportes += a.total;
    products.push({
      id:           `${Date.now()}-${products.length}`,
      nombre,
      nombreFactura: nombre, // nombre original de la factura: es la clave de la asociación (no se edita)
      uc:           extractUC(nombre),
      cajasFactura: a.qty,
      cajasRecib:   a.qty,
      precioCaja:   a.unit,
      cod:          "",
      preCod:       "",
      nuevo:        false,
      creado:       false,
      r1053:        0,
      t1201:        0,
      w1882:        0,
      z1883:        0,
    });
  });

  sumImportes = Math.round(sumImportes * 100) / 100;
  console.log(`[parser] filas=${rows.length} anclas=${anchors.length} productos=${products.length} | suma importes=${sumImportes} | total factura=${invoiceTotal}`);

  const firstY     = anchors[0]?.y ?? 0;
  const headerFlat = rawItems.filter(it => it.y > firstY).map(it => it.t).join(" ");

  return { products, headerFlat, invoiceTotal, sumImportes };
}

function extractInvoiceMeta(headerFlat) {
  const orderM = headerFlat.match(/(?:orden|order|pedido|no\.?|num\.?)\s*[#:]*\s*(\d{5,12})/i);
  const dateM  = headerFlat.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
  const totalM = headerFlat.match(/total\D*\$?\s*([\d,]+\.?\d*)/i);
  return {
    numero: orderM?.[1] ?? "",
    fecha:  dateM?.[1]  ?? "",
    total:  totalM ? toNum(totalM[1]) : null,
  };
}

// ── Distribution proposal ─────────────────────────────────────────────────────
const BODEGON_KEYS = ["1053", "1201", "1882", "1883"];
const KEY_TO_FIELD = { "1053": "r1053", "1201": "t1201", "1882": "w1882", "1883": "z1883" };

// IDs de almacén en el sistema Elineas para cada bodegón
const BODEGON_ALMACEN_IDS = { "1053": "797", "1201": "1012", "1882": "1825", "1883": "1826" };

// Extrae la clave de bodegón del campo proveedor: "B23 Electrocuba SV (1201)" → "1201"
function extractBodegonKeyFromProveedor(proveedor) {
  return proveedor?.match(/\((\d+)\)\s*$/)?.[1] ?? null;
}

// Hoja "TD BD REAB" (BD REABAST SM23 M-BODEGONES), columna AP:
//   L = EF Global (stock), W = Índice de Cálculo AVG, R = U/C, N = días de AO1 ("Stock Máximo de 30D")
//   AP = W=0 ? 0 : CEILING( L < W·N ? W·N − L : StockMáx − L , R )     (AX siempre vacío)
// Índice de Cálculo AVG = promedio de: Ult. 6 mes, Prom. Diario > 0, Prom. Diario > 0 (lo pide el cliente).
const DIAS_STOCK_MAX    = 30;
const PROPUESTA_INDICES = [
  "prom_ventas_diario_ult_6_mes",
  "prom_ventas_diario_mayor_0",
  "prom_ventas_diario_mayor_0",
];

// CEILING de Sheets: múltiplo de `multiple` más cercano por arriba (admite negativos); "+ 0" evita -0.
function ceilToMultiple(value, multiple) {
  if (!multiple || multiple <= 1) return Math.ceil(value) + 0;
  return Math.ceil(value / multiple) * multiple + 0;
}

function propuestaBodegon({ ef, iavg, uc }) {
  if (!iavg) return { prop: 0, objetivo: 0, stockMax: 0 };
  const objetivo = iavg * DIAS_STOCK_MAX;
  const stockMax = ceilToMultiple(objetivo, uc);
  const bruto    = ef < objetivo ? objetivo - ef : stockMax - ef;
  return { prop: ceilToMultiple(bruto, uc), objetivo, stockMax };
}

// Reparte `total` cajas enteras proporcionalmente a `weights` (>= 0) con el método del mayor resto,
// de modo que la suma sea exactamente `total`. Los empates se resuelven en el orden de BODEGON_KEYS.
function repartirPorPeso(total, weights) {
  const sum = BODEGON_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  const out = {};
  const resto = [];
  let asignado = 0;
  for (const k of BODEGON_KEYS) {
    const exacto = total * (weights[k] || 0) / sum;
    out[k] = Math.floor(exacto);
    asignado += out[k];
    resto.push({ k, frac: exacto - out[k] });
  }
  resto.sort((a, b) => b.frac - a.frac);
  for (let i = 0; asignado < total; i++, asignado++) out[resto[i % resto.length].k]++;
  return out;
}

// Ejecuta fn sobre items con un máximo de `limit` peticiones simultáneas.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Propuesta de distribución por bodegón.
 *   1. /api/products?search={cod}&almacenes=797,1012,1825,1826 → idOnline (idTienda) de cada bodegón
 *   2. Por idOnline: índices de venta (rdp-ind-general-diario) y stock EF (ap-latest)
 *   3. Propuesta de cada bodegón con la fórmula de la hoja (columna AP)
 *   4. % de cada propuesta sobre la suma de las propuestas positivas → reparto de las cajas recibidas
 */
async function computeProposal(rows) {
  const rowsWithCod = rows.filter(r => r.cod);
  if (!rowsWithCod.length) throw new Error("Asocia al menos un código antes de calcular la propuesta.");

  console.groupCollapsed(`[propuesta] inicio — ${rowsWithCod.length} productos con código`);
  console.log(`días stock máximo = ${DIAS_STOCK_MAX} | índices = ${PROPUESTA_INDICES.join(" + ")} (promedio)`);
  console.groupEnd();

  // Paso 1: idOnline por bodegón para cada código único
  const idOnlineByCode = new Map(); // cod → Map<bodegonKey, idOnline>
  const uniqueCods = [...new Set(rowsWithCod.map(r => r.cod))];

  await mapPool(uniqueCods, 8, async (cod) => {
    const products = await fetchProductInBodegones(cod, Object.values(BODEGON_ALMACEN_IDS));
    const byKey = new Map();
    for (const p of products) {
      const bKey     = extractBodegonKeyFromProveedor(p.proveedor ?? "");
      const idOnline = String(p.idOnline ?? p.id_online ?? "").trim();
      if (bKey && BODEGON_KEYS.includes(bKey) && idOnline && idOnline !== "0") byKey.set(bKey, idOnline);
    }
    idOnlineByCode.set(cod, byKey);
  });

  // Paso 2: índices de venta y stock (EF) de cada idOnline
  const allIdOnlines = [...new Set([...idOnlineByCode.values()].flatMap(m => [...m.values()]))];
  const salesByIdOnline = new Map(); // idOnline → entrada de índices | null
  const efByIdOnline    = new Map(); // idOnline → stock (EF Global)

  await mapPool(allIdOnlines, 8, async (idOnline) => {
    const [entry, stockProducts] = await Promise.all([
      fetchSalesIndexByIdTienda(idOnline),
      fetchProductsByIdOnlines([idOnline]).catch(() => []),
    ]);
    salesByIdOnline.set(idOnline, entry);
    const prod = stockProducts.find(p => String(p.idOnline ?? p.id_online) === idOnline) ?? stockProducts[0];
    efByIdOnline.set(idOnline, prod?.cantidad ?? 0);
  });

  // Paso 3-4: propuesta por bodegón, porcentajes y reparto por fila
  return rows.map(row => {
    if (!row.cod) return row;

    const byKey = idOnlineByCode.get(row.cod);
    if (!byKey?.size) {
      console.warn(`[propuesta] cod="${row.cod}" — no se encontró en ningún bodegón, fila sin cambios`);
      return row;
    }

    const uc    = Math.max(1, row.uc || 1);
    const total = row.cajasRecib;

    const detalle = BODEGON_KEYS.map(bKey => {
      const idOnline = byKey.get(bKey) ?? null;
      const entry    = idOnline ? salesByIdOnline.get(idOnline) : null;
      const iavg     = entry ? (computeIndiceAvg(entry, PROPUESTA_INDICES) || 0) : 0;
      const ef       = idOnline ? (efByIdOnline.get(idOnline) ?? 0) : 0;
      const { prop, objetivo, stockMax } = propuestaBodegon({ ef, iavg, uc });
      return {
        bodegon: bKey, idOnline: idOnline ?? "—",
        "Ult.6m": entry?.prom_ventas_diario_ult_6_mes ?? null,
        "Diario>0 (×2)": entry?.prom_ventas_diario_mayor_0 ?? null,
        "I.AVG": iavg ? +iavg.toFixed(4) : 0,
        EF: ef, "U/C": uc,
        [`Objetivo ${DIAS_STOCK_MAX}D`]: +objetivo.toFixed(2),
        "Stock Máx": stockMax,
        Propuesta: prop,
      };
    });

    // Una propuesta negativa significa exceso de stock: no recibe cajas (cuenta como 0)
    const positivas = Object.fromEntries(detalle.map(d => [d.bodegon, Math.max(0, d.Propuesta)]));
    const sumaProp  = BODEGON_KEYS.reduce((s, k) => s + positivas[k], 0);

    let reparto;
    if (sumaProp > 0) {
      reparto = repartirPorPeso(total, positivas);
      detalle.forEach(d => {
        d["%"]     = +(positivas[d.bodegon] / sumaProp * 100).toFixed(2);
        d["Cajas"] = reparto[d.bodegon];
      });
    } else {
      // Ningún bodegón necesita (o no hay ventas): reparto igual, el 1053 se queda el sobrante
      const base = Math.floor(total / 4);
      reparto = { "1053": total - base * 3, "1201": base, "1882": base, "1883": base };
      detalle.forEach(d => { d["%"] = 25; d["Cajas"] = reparto[d.bodegon]; });
    }

    console.group(`[propuesta] ${row.cod} — ${row.nombre.slice(0, 50)}`);
    console.log("I.AVG = (Ult.6m + Diario>0 + Diario>0) / 3");
    console.log(`Rec/C = ${total} cajas · U/C = ${uc} · suma de propuestas positivas = ${sumaProp}${sumaProp > 0 ? "" : " → sin necesidad: reparto igual"}`);
    console.table(detalle);
    console.log(`→ 1053=${reparto["1053"]} · 1201=${reparto["1201"]} · 1882=${reparto["1882"]} · 1883=${reparto["1883"]}`);
    console.groupEnd();

    const newRow = { ...row };
    for (const k of BODEGON_KEYS) newRow[KEY_TO_FIELD[k]] = reparto[k];
    return newRow;
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtN   = (n, d = 2) =>
  typeof n === "number" && isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
const fmtUSD = (n) => (typeof n === "number" && isFinite(n) ? `$${fmtN(n)}` : "—");
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "2-digit" }); }
  catch { return iso; }
}

// ── Destination config ────────────────────────────────────────────────────────
// Botones de "Enviar pedidos": sólidos y con relieve para que se lean como acciones
const PEDIDO_BTN = "h-8 px-3 gap-1.5 text-[11px] font-mono font-semibold text-white shadow-md border-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0";

const DESTINOS = [
  {
    key: "t1201", label: "1201",
    hdrCls:   "text-violet-700 dark:text-violet-300",
    pedidoCls: "bg-violet-600 hover:bg-violet-500 shadow-violet-600/30",
    grpCls:   "bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
    inpCls:   "border border-violet-200/80 dark:border-violet-800/50 bg-violet-50/60 dark:bg-violet-950/30 focus-visible:ring-violet-300/50",
    badgeCls: "text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/50 hover:bg-violet-100 dark:hover:bg-violet-900/60",
    btnCls:   "bg-violet-600 hover:bg-violet-700 text-white",
    cellBg:   "bg-violet-50/30 dark:bg-violet-950/20",
    divCls:   "border-l-4 border-l-violet-400 dark:border-l-violet-500",
  },
  {
    key: "w1882", label: "1882",
    hdrCls:   "text-cyan-700 dark:text-cyan-300",
    pedidoCls: "bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/30",
    grpCls:   "bg-cyan-50/80 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
    inpCls:   "border border-cyan-200/80 dark:border-cyan-800/50 bg-cyan-50/60 dark:bg-cyan-950/30 focus-visible:ring-cyan-300/50",
    badgeCls: "text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/50 hover:bg-cyan-100 dark:hover:bg-cyan-900/60",
    btnCls:   "bg-cyan-600 hover:bg-cyan-700 text-white",
    cellBg:   "bg-cyan-50/30 dark:bg-cyan-950/20",
    divCls:   "border-l-4 border-l-cyan-400 dark:border-l-cyan-500",
  },
  {
    key: "z1883", label: "1883",
    hdrCls:   "text-green-700 dark:text-green-300",
    pedidoCls: "bg-green-600 hover:bg-green-500 shadow-green-600/30",
    grpCls:   "bg-green-50/80 dark:bg-green-950/40 text-green-700 dark:text-green-400",
    inpCls:   "border border-green-200/80 dark:border-green-800/50 bg-green-50/60 dark:bg-green-950/30 focus-visible:ring-green-300/50",
    badgeCls: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/50 hover:bg-green-100 dark:hover:bg-green-900/60",
    btnCls:   "bg-green-600 hover:bg-green-700 text-white",
    cellBg:   "bg-green-50/30 dark:bg-green-950/20",
    divCls:   "border-l-4 border-l-green-400 dark:border-l-green-500",
  },
];

// ── Ejecución por ítem ────────────────────────────────────────────────────────
// Con el servidor, el Ajuste AA y cada transferencia se ejecutan en TKC desde la API (documento montado) y el check
// lo escribe el servidor; sin servidor, lo confirma el usuario a mano. Cada fila guarda
// `exec[objetivo] = { at, by, qty, state }` (qty = unidades ejecutadas; state solo viene del servidor).
// Tipo de check: "done" · "in_progress" (reservado, enviándose) · "unverified" (enviado, sin poder comprobar) · "error" · null
const execKind = (ex) => {
  if (!ex) return null;
  if (ex.state === "in_progress" || ex.state === "unverified") return ex.state;
  if (ex.state === "error" || ex.state === "failed") return "error";
  return "done";
};
const EXEC_TARGETS = [
  { key: "aa", label: "Ajuste AA 1053", short: "AA" },
  ...DESTINOS.map(d => ({ key: d.key, label: `Transferencia ${d.label}`, short: d.label })),
];
const execQty = (row, key) => ((key === "aa" ? row.cajasRecib : row[key]) ?? 0) * row.uc;

// Script de cada objetivo: Ajuste AA → cod*cant · Transferencia → 1053*almDestino*cod*cant (siempre sale del 1053)
const ORIGEN_TRANSFER = "1053";
const scriptLine = (row, key) => (key === "aa"
  ? `${row.cod}*${execQty(row, key)}`
  : `${ORIGEN_TRANSFER}*${key.slice(1)}*${row.cod}*${execQty(row, key)}`);

/** Avance de ejecución de cada objetivo y si la factura está completamente ajustada. */
function summarizeExec(rows) {
  const stats = {};
  for (const t of EXEC_TARGETS) {
    const applicable = rows.filter(r => r.cod && execQty(r, t.key) > 0);
    const kind = (r) => execKind(r.exec?.[t.key]);
    const done       = applicable.filter(r => kind(r) === "done" && r.exec[t.key].qty === execQty(r, t.key)).length;
    const modified   = applicable.filter(r => kind(r) === "done" && r.exec[t.key].qty !== execQty(r, t.key)).length;
    const inProgress = applicable.filter(r => kind(r) === "in_progress").length;
    const unverified = applicable.filter(r => kind(r) === "unverified").length;
    stats[t.key] = { total: applicable.length, done, modified, inProgress, unverified, pending: applicable.length - done - modified - inProgress - unverified, complete: applicable.length > 0 && done === applicable.length };
  }
  const hasDistribution = DESTINOS.some(d => stats[d.key].total > 0);
  const complete = stats.aa.total > 0 && hasDistribution && EXEC_TARGETS.every(t => stats[t.key].total === 0 || stats[t.key].complete);
  return { stats, complete };
}

// Avance "hechos/total" de un objetivo, o check verde cuando está completo
function ExecProgress({ s }) {
  if (!s || s.total === 0) return null;
  if (s.complete) return <CheckCircle2 className="h-3.5 w-3.5 text-white" />;
  return (
    <span className={cn("tabular-nums text-[10px] px-1.5 py-0.5 rounded-full font-semibold", s.modified ? "bg-amber-100 text-amber-800" : "bg-black/25 text-white")}
      title={s.modified ? `${s.modified} ítem(s) cambiaron después de ejecutarse` : undefined}>
      {s.done}/{s.total}
    </span>
  );
}

// Separadores gruesos de color que delimitan cada bloque de la tabla
const DIV_AA   = "border-l-4 border-l-rose-400 dark:border-l-rose-500";
const DIV_1053 = "border-l-4 border-l-amber-400 dark:border-l-amber-500";

// ── Cell styles ───────────────────────────────────────────────────────────────
const TH = "px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border/60 whitespace-nowrap select-text";
const TD = "px-1 py-0.5 border-b border-border/30 align-middle";
const NUM_INPUT = cn(
  "h-6 text-xs tabular-nums px-1 text-center",
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
  "bg-transparent border-0 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:bg-background rounded",
);
const SCRIPT_CHIP = "font-mono text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors truncate";

const TOTAL_COLS = 25;

function FilterToggle({ label, value, onChange, opts }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}:</span>
      <div className="flex rounded-md border overflow-hidden">
        {opts.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "px-2 h-6 text-[10px] font-medium transition-colors",
              value === v ? "bg-violet-600 text-white" : "bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BodegonDistribucion() {
  const { toast } = useToast();
  const { user, isAdmin } = useProcurementUser();
  const fileRef   = useRef(null);

  // ── Core state ───────────────────────────────────────────────────────────────
  const [showList,  setShowList]  = useState(true); // true = lista de facturas · false = captura/edición
  const [isParsing,    setIsParsing]    = useState(false);
  const [invoiceMeta,  setInvoiceMeta]  = useState(null);
  const [rows,         setRows]         = useState([]);
  const [filename,     setFilename]     = useState("");

  // ── Proveedor externo y modo de entrada (PDF o manual) ───────────────────────
  const [suppliers,  setSuppliers]  = useState([]);
  const [supplierId, setSupplierId] = useState(() => {
    try { return localStorage.getItem("reab_dist_supplier") ?? ""; } catch { return ""; }
  });
  const [inputMode, setInputMode] = useState("pdf"); // pdf | manual
  useEffect(() => { loadExternalSuppliers().then(setSuppliers); }, []);
  const supplier = suppliers.find(s => s.id === supplierId) ?? suppliers[0] ?? null;
  const canPdf   = supplier?.parser === "mayorista23";
  const pickSupplier = (id) => {
    setSupplierId(id);
    try { localStorage.setItem("reab_dist_supplier", id); } catch { /* opcional */ }
  };
  useEffect(() => { if (supplier && !canPdf) setInputMode("manual"); }, [supplier, canPdf]);

  // ── Associations ──────────────────────────────────────────────────────────────
  const [assocMap, setAssocMap] = useState(new Map()); // name_key → internal_code

  // ── Inline search ─────────────────────────────────────────────────────────────
  const [searchRow,     setSearchRow]     = useState(null);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef(null);

  // ── Nombre TKC de cada código asociado (cod → nombre en TKC) ─────────────────
  const [tkcNames, setTkcNames] = useState(() => new Map());
  const [tkcPhotos, setTkcPhotos] = useState(() => new Map()); // cod → [url, …] (para el carrusel)
  const tkcRequested = useRef(new Set());

  // ── Filtros y buscador de la tabla ────────────────────────────────────────────
  const [tableSearch,  setTableSearch]  = useState("");
  const [filtEstado,   setFiltEstado]   = useState("all"); // all | nuevos | creados | pendientes

  // ── CodInicial: último valor buscado por fila (evita repetir la consulta) ──────
  const preCodLookup = useRef(new Map());
  const [preCodLoading, setPreCodLoading] = useState(null); // rowId

  // ── Proposal ──────────────────────────────────────────────────────────────────
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalDone,    setProposalDone]    = useState(false);

  // ── Factura abierta: se guarda sola con cada cambio (no hay botón Guardar) ───
  const [invoiceId,  setInvoiceId]  = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [savedAt,    setSavedAt]    = useState(null);
  const [historyId,  setHistoryId]  = useState(null);
  const [priceMap,   setPriceMap]   = useState(() => new Map()); // rowId → precios anteriores
  const savedRowsRef = useRef([]);   // filas tal como están guardadas
  const versionRef   = useRef(null); // versión de la factura en el servidor (control de concurrencia)
  const saveQueue    = useRef(Promise.resolve()); // los guardados se encadenan: nunca dos PATCH a la vez
  const [mode, setMode] = useState(null); // "api" (servidor) | "local" (provisional en este navegador)
  const modeRef = useRef(null);
  modeRef.current = mode;
  useEffect(() => { getDistribucionMode().then(setMode).catch(() => {}); }, []);
  const pendingLabel = useRef(null); // etiqueta de la próxima entrada del historial (p. ej. "Propuesta calculada")
  const rowsRef      = useRef([]);
  const invoiceIdRef = useRef(null);
  const userEmail    = user?.email ?? "";
  rowsRef.current      = rows;
  invoiceIdRef.current = invoiceId;

  const logEvent = useCallback((type, summary) => {
    if (invoiceIdRef.current) addInvoiceEvent(invoiceIdRef.current, { type, summary, user: userEmail }).catch(() => {});
  }, [userEmail]);

  const refreshPrices = useCallback(async () => {
    const id = invoiceIdRef.current;
    if (!id) return;
    try {
      if (modeRef.current === "api") { setPriceMap(await priceHistoryForInvoice({ id })); return; }
      const rec = await getInvoice(id);
      if (rec) setPriceMap(await priceHistoryForInvoice({ ...rec, rows: rowsRef.current }));
    } catch { /* el historial de precios es informativo */ }
  }, []);

  // Adopta los checks de ejecución que escribió el servidor (sin tocar lo que el usuario está editando)
  const adoptServerExec = useCallback((serverRows) => {
    const byId = new Map(serverRows.map(r => [r.id, r.exec ?? {}]));
    setRows(prev => {
      let changed = false;
      const next = prev.map(r => {
        const ex = byId.get(r.id);
        if (!ex || JSON.stringify(ex) === JSON.stringify(r.exec ?? {})) return r;
        changed = true;
        return { ...r, exec: ex };
      });
      return changed ? next : prev;
    });
  }, []);

  // Alinea versión y checks con el servidor (tras ejecutar o releer la factura)
  const syncFromServer = useCallback((rec) => {
    versionRef.current = rec.version;
    const byId = new Map(rec.rows.map(r => [r.id, r.exec ?? {}]));
    savedRowsRef.current = savedRowsRef.current.map(r => (byId.has(r.id) ? { ...r, exec: byId.get(r.id) } : r));
    adoptServerExec(rec.rows);
  }, [adoptServerExec]);

  const saveNow = useCallback(() => {
    const run = async () => {
      const id = invoiceIdRef.current;
      const current = rowsRef.current;
      if (!id || !current.length) return;
      const changes = diffRows(savedRowsRef.current, current);
      const pending = pendingLabel.current; // { label, type } de la operación que originó el cambio
      if (!changes.length && !pending) return;
      pendingLabel.current = null;
      setSaveStatus("saving");
      try {
        const total = Math.round(current.reduce((s, r) => s + r.cajasFactura * r.precioCaja, 0) * 100) / 100;
        const { stats, complete } = summarizeExec(current);
        const exec = { complete, ...Object.fromEntries(EXEC_TARGETS.map(t => [t.key, { done: stats[t.key].done, total: stats[t.key].total }])) };
        const { record } = await saveInvoice(id, {
          baseRows: savedRowsRef.current, rows: current, version: versionRef.current, total, exec,
          user: userEmail, changes, label: pending?.label, type: pending?.type ?? "edicion",
        });
        if (record) {
          // Servidor: versión nueva y filas tal como quedaron (los cambios hechos durante el guardado se detectan en el siguiente)
          versionRef.current = record.version;
          savedRowsRef.current = record.rows;
          adoptServerExec(record.rows);
        } else {
          savedRowsRef.current = current;
        }
        setSaveStatus("saved");
        setSavedAt(new Date());
        refreshPrices();
      } catch (err) {
        pendingLabel.current = pending;
        setSaveStatus("error");
        toast({ title: "No se pudo guardar la factura", description: err.message, variant: "destructive", duration: 6000 });
      }
    };
    saveQueue.current = saveQueue.current.catch(() => {}).then(run);
    return saveQueue.current;
  }, [userEmail, toast, refreshPrices, adoptServerExec]);

  // Guardado automático: 0,9 s después del último cambio
  useEffect(() => {
    if (!invoiceId) return;
    const t = setTimeout(saveNow, 900);
    return () => clearTimeout(t);
  }, [rows, invoiceId, saveNow]);

  useEffect(() => { if (invoiceId) refreshPrices(); else setPriceMap(new Map()); }, [invoiceId, refreshPrices]);

  // ── Ejecución por ítem (Ajuste AA y transferencias) ───────────────────────────
  const [pendingExec, setPendingExec] = useState(null); // { target, rowIds } copiado y a la espera de confirmar (modo local)
  const [execDialog, setExecDialog]   = useState(null); // { key, label, pendingIds, modifiedIds, lines } (modo servidor)
  const [execRunning, setExecRunning] = useState(false);
  const { stats: execStats, complete: allAdjusted } = useMemo(() => summarizeExec(rows), [rows]);

  const setExecuted = useCallback((target, rowIds, executed) => {
    const ids = new Set(rowIds);
    const at = new Date().toISOString();
    setRows(prev => prev.map(r => {
      if (!ids.has(r.id)) return r;
      const exec = { ...(r.exec ?? {}) };
      if (executed) exec[target] = { at, by: userEmail, qty: execQty(r, target) };
      else delete exec[target];
      return { ...r, exec };
    }));
    const t = EXEC_TARGETS.find(x => x.key === target);
    pendingLabel.current = {
      label: `${t.label}: ${executed ? "ejecutado" : "check quitado"} · ${ids.size} ${ids.size === 1 ? "ítem" : "ítems"}`,
      type: "ejecucion",
    };
  }, [userEmail]);

  // Tras ejecutar en TKC: relee la factura y, mientras algo siga "en curso", pide al servidor que recoja el resultado
  const pollExecution = useCallback(async (id) => {
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 4000));
      if (invoiceIdRef.current !== id) return;
      try { await reconcileInvoiceExecutions(id); } catch { /* se reintenta */ }
      const rec = await getInvoice(id).catch(() => null);
      if (!rec || invoiceIdRef.current !== id) return;
      syncFromServer(rec);
      if (!rec.rows.some(r => Object.values(r.exec ?? {}).some(e => e.state === "in_progress"))) return;
    }
  }, [syncFromServer]);

  const runExecution = useCallback(async ({ credentials, confirmModified }) => {
    const id = invoiceIdRef.current;
    const d = execDialog;
    if (!id || !d) return;
    setExecRunning(true);
    try {
      await saveNow(); // el servidor debe tener las cantidades que se ven en pantalla
      const res = await executeInvoice(id, {
        target: d.key, credentials, confirmModified,
        itemIds: confirmModified ? [...d.pendingIds, ...d.modifiedIds] : undefined,
      });
      setExecDialog(null);
      const rec = await getInvoice(id);
      if (rec) syncFromServer(rec);
      const status = res?.status ?? "";
      const RESULTADO = {
        nothing_to_do: [`${d.label}: nada que enviar`, "No había ítems pendientes.", false],
        done:          [`${d.label}: enviado a TKC`, "El documento queda montado («editado»); confírmalo en TKC.", false],
        in_progress:   [`${d.label}: en curso`, "TKC sigue trabajando; el resultado se recoge solo.", false],
        partial:       [`${d.label}: enviado solo en parte`, "Algunos ítems no se enviaron. Revisa los marcados y reintenta.", true],
        unverified:    [`${d.label}: enviado, sin poder verificar`, "Revisa TKC y marca cada ítem como ejecutado o pendiente.", true],
        failed:        [`${d.label}: no se pudo enviar`, "Ningún ítem se envió. Revisa el detalle de cada ítem.", true],
      };
      const [title, description, aviso] = RESULTADO[status] ?? RESULTADO.done;
      toast({ title, description, variant: aviso ? "destructive" : undefined, duration: aviso ? 9000 : 6000 });
      if (rec?.rows.some(r => Object.values(r.exec ?? {}).some(e => e.state === "in_progress"))) pollExecution(id);
    } catch (err) {
      toast({ title: `No se pudo ejecutar ${d.label}`, description: err.message, variant: "destructive", duration: 9000 });
      const rec = await getInvoice(id).catch(() => null); // un fallo a medias puede haber dejado ítems "sin verificar"
      if (rec) syncFromServer(rec);
    } finally {
      setExecRunning(false);
    }
  }, [execDialog, saveNow, syncFromServer, pollExecution, toast]);

  // Un ítem quedó "sin verificar" (se envió y no se pudo comprobar): el usuario mira TKC y lo cierra a mano
  const resolveUnverified = useCallback(async (key, row) => {
    const t = EXEC_TARGETS.find(x => x.key === key);
    const exists = window.confirm(`${t.label} · "${row.nombre}"\n\nSe envió a TKC pero no se pudo comprobar. Revisa TKC.\n\n¿El documento SÍ existe?\n\nAceptar = sí, marcar como ejecutado\nCancelar = no, volver a pendiente`);
    if (!exists && !window.confirm("¿Confirmas que NO se aplicó en TKC? Volverá a estar pendiente y podrá reenviarse.")) return;
    try {
      await resolveInvoiceExecutions(invoiceIdRef.current, { target: key, itemIds: [row.id], outcome: exists ? "done" : "pending" });
      const rec = await getInvoice(invoiceIdRef.current);
      if (rec) syncFromServer(rec);
      toast({ description: exists ? "Marcado como ejecutado." : "Vuelve a estar pendiente.", duration: 2500 });
    } catch (err) {
      toast({ description: err.message, variant: "destructive", duration: 5000 });
    }
  }, [syncFromServer, toast]);

  // Aviso cuando un objetivo (o toda la factura) pasa a estar completo
  const prevComplete = useRef({ invoiceId: null, flags: {}, all: false });
  useEffect(() => {
    const flags = Object.fromEntries(EXEC_TARGETS.map(t => [t.key, execStats[t.key].complete]));
    const prev = prevComplete.current;
    if (prev.invoiceId === invoiceId && invoiceId != null) {
      if (allAdjusted && !prev.all) {
        toast({ title: "Factura completamente ajustada", description: "El Ajuste AA y todas las transferencias tienen check.", duration: 6000 });
      } else {
        for (const t of EXEC_TARGETS) {
          if (flags[t.key] && !prev.flags[t.key]) toast({ title: `${t.label} completo`, description: "Todos los ítems tienen check.", duration: 4000 });
        }
      }
    }
    prevComplete.current = { invoiceId, flags, all: allAdjusted };
  }, [execStats, allAdjusted, invoiceId, toast]);

  useEffect(() => { setPendingExec(null); }, [invoiceId]);

  // Cierra la factura abierta (guardando lo pendiente) y vuelve a la captura vacía
  const resetToEntry = useCallback(async () => {
    await saveNow();
    invoiceIdRef.current = null;
    savedRowsRef.current = [];
    versionRef.current = null;
    setInvoiceId(null);
    setRows([]); setInvoiceMeta(null); setFilename(""); setProposalDone(false);
    setSaveStatus("idle"); setSavedAt(null); setSearchRow(null);
  }, [saveNow]);
  const goToList = useCallback(async () => { await resetToEntry(); setShowList(true); }, [resetToEntry]);
  const startNew = useCallback(async () => { await resetToEntry(); setShowList(false); }, [resetToEntry]);

  const openInvoice = useCallback(async (id) => {
    await saveNow();
    try {
      const rec = await getInvoice(id);
      if (!rec) { toast({ description: "La factura ya no existe.", variant: "destructive", duration: 3000 }); return; }
      if (rec.status === "anulada") {
        toast({ description: "La factura está anulada. Restáurala desde la lista para editarla.", duration: 4000 });
        return;
      }
      if (rec.supplierId) setSupplierId(rec.supplierId);
      invoiceIdRef.current = rec.id;
      savedRowsRef.current = rec.rows;
      versionRef.current = rec.version ?? null;
      setInvoiceId(rec.id);
      setRows(rec.rows);
      setInvoiceMeta({
        numero: rec.numero, fecha: rec.fecha, total: rec.total, filename: rec.filename,
        proveedor: rec.supplierName, manual: rec.source === "manual", invoiceId: rec.id, hasPdf: rec.hasPdf,
      });
      setFilename(rec.filename);
      setProposalDone(rec.rows.some(r => r.r1053 || r.t1201 || r.w1882 || r.z1883));
      setSaveStatus("saved"); setSavedAt(new Date(rec.updatedAt));
      setSearchRow(null);
      setShowList(false);
      if (rec.rows.some(r => Object.values(r.exec ?? {}).some(e => e.state === "in_progress"))) pollExecution(rec.id);
    } catch (err) {
      toast({ description: `No se pudo abrir la factura: ${err.message}`, variant: "destructive", duration: 4000 });
    }
  }, [saveNow, toast, pollExecution]);

  // Crea la factura en el sistema (una sola por proveedor + número) y la abre en la tabla
  const registerInvoice = useCallback(async ({ meta, filled, source, file }) => {
    if (!supplier) { toast({ description: "Elige un proveedor.", variant: "destructive", duration: 3000 }); return false; }
    let numero = String(meta.numero ?? "").trim();
    if (!numero) numero = (window.prompt("No se pudo leer el número de factura. Escríbelo para continuar:") ?? "").trim();
    if (!numero) {
      toast({ description: "Sin número de factura no se puede registrar. Se canceló la carga.", variant: "destructive", duration: 4000 });
      return false;
    }
    const total = Math.round(filled.reduce((s, r) => s + r.cajasFactura * r.precioCaja, 0) * 100) / 100;
    try {
      await saveNow();
      const rec = await createInvoice({
        supplierId: supplier.id, supplierName: supplier.name, numero, fecha: meta.fecha ?? "", total,
        source, filename: file?.name ?? "", rows: filled, user: userEmail,
      }, file ?? null);
      const savedRows = rec.rows ?? filled; // con el servidor, las filas traen el id que les dio el servidor
      invoiceIdRef.current = rec.id;
      savedRowsRef.current = savedRows;
      versionRef.current = rec.version ?? null;
      setInvoiceId(rec.id);
      setProposalDone(false);
      setSearchRow(null);
      setInvoiceMeta({ ...meta, numero, filename: file?.name ?? "", proveedor: supplier.name, manual: source === "manual", invoiceId: rec.id, hasPdf: !!file && !rec.pdfError });
      setFilename(file?.name ?? "");
      setRows(savedRows);
      if (rec.pdfError) toast({ title: "Factura registrada, pero el PDF no se subió", description: rec.pdfError, variant: "destructive", duration: 9000 });
      else if (rec.duplicatePdfOf?.length) toast({ title: "Este mismo PDF ya está en otra factura del proveedor", description: `Facturas: ${rec.duplicatePdfOf.join(", ")}`, duration: 7000 });
      setSaveStatus("saved"); setSavedAt(new Date());
      return true;
    } catch (err) {
      if (err.code === "DUPLICATE") {
        const ex = err.existing;
        if (!ex?.id) {
          toast({ title: "Esa factura ya existe", description: `Ya hay una factura #${numero} de ${supplier.name}. Búscala en la lista.`, variant: "destructive", duration: 6000 });
        } else if (window.confirm(`Ya existe la factura #${numero} de ${supplier.name} (ID ${ex.id}${ex.status === "anulada" ? ", anulada" : ""}).\n¿Abrir la existente en lugar de crear otra?`)) {
          await openInvoice(ex.id);
        }
      } else {
        toast({ title: "No se pudo registrar la factura", description: err.message, variant: "destructive", duration: 6000 });
      }
      return false;
    }
  }, [supplier, userEmail, saveNow, openInvoice, toast]);

  const verDocumento = useCallback(async () => {
    if (!invoiceIdRef.current) return;
    const blob = await getInvoicePdf(invoiceIdRef.current);
    if (!blob) { toast({ description: "Esta factura no tiene documento asociado.", duration: 3000 }); return; }
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  }, [toast]);


  // Nombre en TKC de los códigos asociados (con pausa para no consultar mientras se escribe)
  useEffect(() => {
    const timer = setTimeout(() => {
      const missing = [...new Set(rows.map(r => r.cod).filter(Boolean))]
        .filter(c => !tkcRequested.current.has(c));
      if (!missing.length) return;
      missing.forEach(c => tkcRequested.current.add(c));
      Promise.all(missing.map(async (cod) => {
        try {
          const [p] = await fetchProductInBodegones(cod, Object.values(BODEGON_ALMACEN_IDS));
          return [cod, p?.nombre ?? null, (p?.fotos ?? []).map(x => x?.foto ?? x).filter(Boolean)];
        } catch {
          tkcRequested.current.delete(cod);
          return [cod, null, []];
        }
      })).then(entries => {
        setTkcNames(prev => {
          const next = new Map(prev);
          for (const [cod, nombre] of entries) if (nombre) next.set(cod, nombre);
          return next;
        });
        setTkcPhotos(prev => {
          const next = new Map(prev);
          for (const [cod, , fotos] of entries) if (fotos.length) next.set(cod, fotos);
          return next;
        });
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [rows]);

  // Cargar asociaciones guardadas al montar
  useEffect(() => {
    fetchSm23Associations().then(list => {
      if (!list?.length) return;
      setAssocMap(new Map(list.map(a => [a.name_key, a.internal_code])));
    });
  }, []);

  // ── Factura manual ────────────────────────────────────────────────────────────
  const loadManual = useCallback(async ({ meta, products }) => {
    const filled = products.map(p => {
      const cod = assocMap.get(p.nombre) ?? "";
      return { ...p, cod, nuevo: !cod, creado: !!cod };
    });
    const ok = await registerInvoice({ meta, filled, source: "manual", file: null });
    if (!ok) return;
    const nAuto = filled.filter(p => p.cod).length;
    toast({
      title: `${filled.length} productos cargados`,
      description: [nAuto ? `${nAuto} con código auto-completado` : null, `Factura #${meta.numero}`].filter(Boolean).join(" · "),
      duration: 3500,
    });
  }, [assocMap, registerInvoice, toast]);

  // ── PDF ───────────────────────────────────────────────────────────────────────
  const loadPdf = useCallback(async (file) => {
    if (!file?.name?.toLowerCase().endsWith(".pdf")) {
      toast({ description: "Selecciona un archivo PDF.", variant: "destructive", duration: 2500 });
      return;
    }
    setIsParsing(true);
    setProposalDone(false);
    setSearchRow(null);
    try {
      const ab       = await file.arrayBuffer();
      const { products, headerFlat, invoiceTotal, sumImportes } =
        parseMayorista23Items(await getRawTextItems(ab));
      if (!products.length) {
        toast({
          description: "No se encontraron productos. Verifica que sea una factura Mayorista 23.",
          variant: "destructive", duration: 4000,
        });
        return;
      }
      // Nuevo = sin código asociado; Creado = con código. Las casillas siguen siendo editables.
      const filled = products.map(p => {
        const cod = assocMap.get(p.nombre) ?? "";
        return { ...p, cod, nuevo: !cod, creado: !!cod };
      });
      const meta   = extractInvoiceMeta(headerFlat);
      const ok = await registerInvoice({ meta, filled, source: "pdf", file });
      if (!ok) return;
      const nAuto = filled.filter(p => p.cod).length;
      toast({
        title:       `${filled.length} productos importados`,
        description: [
          nAuto ? `${nAuto} con código auto-completado` : null,
          meta.numero ? `Orden #${meta.numero}` : null,
        ].filter(Boolean).join(" · ") || file.name,
        duration: 3500,
      });
      if (invoiceTotal != null && Math.abs(sumImportes - invoiceTotal) > 0.05) {
        toast({
          title:       "Verifica los productos importados",
          description: `La suma de los ítems ($${sumImportes.toFixed(2)}) no coincide con el Total Productos de la factura ($${invoiceTotal.toFixed(2)}). Puede faltar o sobrar algún ítem.`,
          variant:     "destructive",
          duration:    9000,
        });
      }
    } catch (err) {
      console.error(err);
      toast({ description: `Error al procesar el PDF: ${err.message}`, variant: "destructive", duration: 4000 });
    } finally {
      setIsParsing(false);
    }
  }, [toast, assocMap, registerInvoice]);

  const onFileChange = (e) => { const f = e.target.files?.[0]; if (f) loadPdf(f); e.target.value = ""; };
  const onDrop      = (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadPdf(f); };
  const onDragOver  = (e) => e.preventDefault();

  // ── Row editing ───────────────────────────────────────────────────────────────
  const setField = useCallback((id, field, val) =>
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: val };
      if (field === "cod" && !String(val).trim()) { next.nuevo = true; next.creado = false; }
      return next;
    })), []);

  // Al asociar un código la fila pasa a Creado (se puede cambiar a mano después).
  const marcarCreado = useCallback((id) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, nuevo: false, creado: true } : r)), []);

  // CodInicial escrito que no coincide con el Cód. TKC de la fila (deben coincidir los 6 últimos dígitos).
  const codInicialMismatch = useCallback((r) => {
    const d = String(r.preCod ?? "").replace(/\D/g, "");
    const c = String(r.cod ?? "").trim();
    if (!d || !c) return false;
    return !c.endsWith(d.slice(-6).padStart(6, "0"));
  }, []);
  const nAlertas = useMemo(() => rows.filter(codInicialMismatch).length, [rows, codInicialMismatch]);
  const confirmarAlertas = useCallback(() =>
    nAlertas === 0 || window.confirm(`Hay ${nAlertas} fila(s) con un CodInicial que no coincide con su Cód. TKC. ¿Continuar de todos modos?`),
  [nAlertas]);

  // ── Clipboard ─────────────────────────────────────────────────────────────────
  const copyText = useCallback((text, label = "") => {
    try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
    toast({ description: label ? `Copiado: ${label}` : "Copiado", duration: 1500 });
  }, [toast]);

  // ── Pedidos globales (compilan TODAS las filas) ───────────────────────────────
  // Copia solo los ítems que aún no tienen check. El check se pone cuando el usuario confirma
  // que lo ejecutó en TKC (barra "Ya lo ejecuté"), no al copiar.
  const sendPedido = useCallback((key) => {
    const t = EXEC_TARGETS.find(x => x.key === key);
    const eligible = rows.filter(r => r.cod && execQty(r, key) > 0);
    if (!eligible.length) {
      toast({ description: key === "aa" ? "Ninguna fila tiene código asociado." : `No hay cajas asignadas a ${t.short} con código.`, duration: 2500 });
      return;
    }
    if (modeRef.current === "api") {
      const pendingRows  = eligible.filter(r => { const k = execKind(r.exec?.[key]); return !k || k === "error"; });
      const modifiedRows = eligible.filter(r => execKind(r.exec?.[key]) === "done" && r.exec[key].qty !== execQty(r, key));
      const open = eligible.filter(r => ["in_progress", "unverified"].includes(execKind(r.exec?.[key]))).length;
      if (!pendingRows.length && !modifiedRows.length) {
        toast({
          title: `${t.label}: nada pendiente`,
          description: open ? `${open} ítem(s) están en curso o sin verificar; revísalos en la tabla.` : "Todos los ítems ya están ejecutados.",
          duration: 5000,
        });
        return;
      }
      if (!confirmarAlertas()) return;
      setExecDialog({
        key, label: t.label,
        pendingIds: pendingRows.map(r => r.id), modifiedIds: modifiedRows.map(r => r.id),
        lines: pendingRows.map(r => scriptLine(r, key)),
      });
      return;
    }
    const todo = eligible.filter(r => !r.exec?.[key]);
    const changedAfter = eligible.filter(r => r.exec?.[key] && r.exec[key].qty !== execQty(r, key)).length;
    if (!todo.length) {
      toast({
        title: `${t.label}: nada pendiente`,
        description: changedAfter
          ? `${changedAfter} ítem(s) cambiaron después de ejecutarse. Quita su check si quieres volver a enviarlos.`
          : "Todos los ítems ya tienen check.",
        duration: 5000,
      });
      return;
    }
    if (!confirmarAlertas()) return;
    const lines = todo.map(r => scriptLine(r, key));
    copyText(lines.join("\n"), `${lines.length} líneas ${t.short}`);
    logEvent("script", `${t.label}: script copiado · ${lines.length} líneas`);
    setPendingExec({ target: key, rowIds: todo.map(r => r.id) });
    const omitidos = eligible.length - todo.length;
    toast({
      title: `${t.label}: ${lines.length} ítems copiados`,
      description: omitidos ? `Se omitieron ${omitidos} que ya tienen check o cambiaron después de ejecutarse.` : "Confirma cuando lo ejecutes en TKC.",
      duration: 4000,
    });
  }, [rows, copyText, toast, confirmarAlertas, logEvent]);

  // Check individual de cada ítem (junto a su script)
  const renderExecCheck = (row, key) => {
    const qty = execQty(row, key);
    if (!row.cod || qty <= 0) return null;
    const ex = row.exec?.[key];
    const when = ex?.at ? new Date(ex.at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "";
    if (mode === "api") {
      // Con el servidor el check lo escribe la ejecución real en TKC: aquí solo se muestra
      const kind = execKind(ex);
      if (kind === "in_progress") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" title="Enviándose a TKC…" />;
      if (kind === "unverified") {
        return (
          <button type="button" className="shrink-0 text-rose-600" title="Se envió a TKC pero no se pudo verificar. Clic para revisarlo y cerrarlo a mano."
            onClick={() => resolveUnverified(key, row)}>
            <AlertTriangle className="h-3.5 w-3.5" />
          </button>
        );
      }
      if (kind === "error") return <span className="shrink-0 text-rose-500" title={ex.error ? `Falló: ${ex.error}` : "Falló el envío; se puede reintentar."}><AlertTriangle className="h-3.5 w-3.5" /></span>;
      if (kind === "done" && ex.qty === qty) return <span className="shrink-0 text-emerald-600" title={`Ejecutado${when ? ` ${when}` : ""}${ex.by ? ` · ${ex.by}` : ""}${ex.ref ? ` · doc. ${ex.ref}` : ""}`}><CheckCircle2 className="h-3.5 w-3.5" /></span>;
      if (kind === "done") return <span className="shrink-0 text-amber-500" title={`Cambió después de ejecutarse: se envió ${ex.qty} u y ahora son ${qty} u. Usa el botón Pedido para enviar la diferencia.`}><AlertTriangle className="h-3.5 w-3.5" /></span>;
      return <span className="shrink-0 text-muted-foreground/40" title="Pendiente de ejecutar"><Circle className="h-3.5 w-3.5" /></span>;
    }
    if (ex && ex.qty === qty) {
      return (
        <button type="button" className="shrink-0 text-emerald-600" title={`Ejecutado ${when}${ex.by ? ` · ${ex.by}` : ""}. Clic para quitar el check.`}
          onClick={() => { if (window.confirm("¿Quitar el check de ejecución de este ítem?")) setExecuted(key, [row.id], false); }}>
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
      );
    }
    if (ex) {
      return (
        <button type="button" className="shrink-0 text-amber-500" title={`Cambió después de ejecutarse: se ejecutó ${ex.qty} u y ahora son ${qty} u. Clic para quitar el check y poder reenviarlo.`}
          onClick={() => { if (window.confirm("¿Quitar el check para volver a enviar este ítem con la cantidad nueva?")) setExecuted(key, [row.id], false); }}>
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      );
    }
    return (
      <button type="button" className="shrink-0 text-muted-foreground/40 hover:text-emerald-600" title="Pendiente. Clic para marcar como ejecutado."
        onClick={() => setExecuted(key, [row.id], true)}>
        <Circle className="h-3.5 w-3.5" />
      </button>
    );
  };

  // ── Association search ────────────────────────────────────────────────────────
  const handleSearchChange = useCallback((text) => {
    setSearchQuery(text);
    clearTimeout(searchTimerRef.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchCatalogProducts(text.trim(), 10);
        setSearchResults(results ?? []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 350);
  }, []);

  const openSearch = useCallback((rowId) => {
    setSearchRow(prev => prev === rowId ? null : rowId);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Guarda en el servidor la regla "nombre de la factura → código" y la recuerda en memoria.
  // Devuelve el código que tenía antes esa regla (si existía).
  const rememberAlias = useCallback((key, code, productName, fotos) => {
    const previous = assocMap.get(key);
    saveSm23Associations([{ name_key: key, internal_code: code }]).catch(err => {
      console.error("[asociación] no se guardó en el servidor:", err);
      toast({
        title: "Asociación no guardada en el servidor",
        description: `Se aplicó a esta fila, pero no se recordará la próxima vez. ${err.message}`,
        variant: "destructive",
        duration: 7000,
      });
    });
    setAssocMap(prev => new Map(prev).set(key, code));
    if (productName) setTkcNames(prev => new Map(prev).set(code, productName));
    if (fotos?.length) {
      tkcRequested.current.add(code);
      setTkcPhotos(prev => new Map(prev).set(code, fotos));
    }
    return previous;
  }, [assocMap, toast]);

  const selectAssociation = useCallback(async (rowId, nombre, codeOrProduct) => {
    const code = typeof codeOrProduct === "string"
      ? codeOrProduct.trim()
      : String(codeOrProduct.codigo ?? codeOrProduct.id_online ?? "").trim();
    if (!code) return;
    setField(rowId, "cod", code);
    marcarCreado(rowId);
    setSearchRow(null);
    setSearchQuery("");
    setSearchResults([]);
    const previous = rememberAlias(
      nombre, code,
      typeof codeOrProduct === "string" ? null : codeOrProduct.nombre,
      typeof codeOrProduct === "string" ? null : (codeOrProduct.fotos ?? []).map(x => x?.foto ?? x).filter(Boolean),
    );
    toast({
      description: previous && previous !== code
        ? `Asociación actualizada: antes ${previous}, ahora ${code}`
        : `Código "${code}" asociado a esta fila`,
      duration: 2500,
    });
  }, [setField, marcarCreado, rememberAlias, toast]);

  // Al salir de la celda Cód. TKC (o con Enter): si el código existe en el catálogo se guarda la
  // asociación; si no existe, se avisa y no se guarda nada.
  const codChecked = useRef(new Map()); // rowId → último código verificado
  const commitCod = useCallback(async (row) => {
    const code = String(row.cod ?? "").trim();
    const key  = row.nombreFactura ?? row.nombre;
    if (!code || assocMap.get(key) === code) return;
    if (codChecked.current.get(row.id) === code) return;
    codChecked.current.set(row.id, code);
    try {
      const product = await findProductByCode(code);
      if (!product) {
        toast({
          title: "Código no encontrado",
          description: `"${code}" no existe en el catálogo. La asociación no se guardó.`,
          variant: "destructive",
          duration: 6000,
        });
        return;
      }
      const previous = rememberAlias(key, product.codigo, product.nombre);
      marcarCreado(row.id);
      toast({
        description: previous && previous !== product.codigo
          ? `Asociación actualizada: antes ${previous}, ahora ${product.codigo}`
          : `Asociación guardada: ${product.codigo}`,
        duration: 2500,
      });
    } catch (err) {
      codChecked.current.delete(row.id); // permite reintentar
      toast({
        title: "No se pudo verificar el código",
        description: `${err.message}. La asociación no se guardó.`,
        variant: "destructive",
        duration: 6000,
      });
    }
  }, [assocMap, marcarCreado, rememberAlias, toast]);

  // ── CodInicial → Cód. TKC ──────────────────────────────────────────────────────
  // Los últimos 6 dígitos del código (con ceros a la izquierda si faltan) identifican el producto.
  const resolvePreCod = useCallback(async (row) => {
    const digits = String(row.preCod ?? "").replace(/\D/g, "");
    if (!digits) return;
    const suffix = digits.slice(-6).padStart(6, "0");
    if (preCodLookup.current.get(row.id) === suffix) return;
    preCodLookup.current.set(row.id, suffix);

    setPreCodLoading(row.id);
    try {
      const found = await searchProductsByCodeSuffix(suffix);
      console.log(`[codInicial] ${suffix} → ${found.length} coincidencia(s)`, found);
      if (found.length === 1) {
        selectAssociation(row.id, row.nombreFactura ?? row.nombre, found[0]);
      } else if (found.length > 1) {
        // Varios códigos terminan igual: se muestran en el panel para elegir
        setSearchRow(row.id);
        setSearchQuery("");
        setSearchResults(found);
        toast({ description: `${found.length} códigos terminan en ${suffix}. Elige el correcto.`, duration: 3500 });
      } else {
        preCodLookup.current.delete(row.id);
        toast({ description: `No se encontró ningún código TKC que termine en ${suffix}.`, variant: "destructive", duration: 4000 });
      }
    } catch (err) {
      preCodLookup.current.delete(row.id);
      toast({ description: `Error al buscar el CodInicial: ${err.message}`, variant: "destructive", duration: 4000 });
    } finally {
      setPreCodLoading(null);
    }
  }, [selectAssociation, toast]);

  // ── Exportar productos marcados como Nuevo ────────────────────────────────────
  const exportNuevos = useCallback(() => {
    const nuevos = rows.filter(r => r.nuevo);
    if (!nuevos.length) {
      toast({ description: "No hay productos marcados como Nuevo.", duration: 2500 });
      return;
    }
    const data = nuevos.map(r => ({
      "CodInicial":         r.preCod || "",
      "Cód. TKC":          r.cod || "",
      "Nombre (factura)":  r.nombre,
      "Nombre TKC":        tkcNames.get(r.cod) ?? "",
      "U/C":               r.uc,
      "Cajas facturadas":  r.cajasFactura,
      "Cajas recibidas":   r.cajasRecib,
      "Precio/C":          r.precioCaja,
      "Total U":           r.cajasRecib * r.uc,
      "Creado":            r.creado ? "Sí" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos nuevos");
    const orden = invoiceMeta?.numero ? `_${invoiceMeta.numero}` : "";
    XLSX.writeFile(wb, `productos_nuevos_SM23M${orden}_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast({ description: `${nuevos.length} productos nuevos exportados`, duration: 2500 });
  }, [rows, tkcNames, invoiceMeta, toast]);

  // ── Filas visibles (filtros + buscador); `idx` conserva el número original ────
  const visibleRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => {
        if (filtEstado === "nuevos"     && !row.nuevo)                  return false;
        if (filtEstado === "creados"    && !row.creado)                 return false;
        if (filtEstado === "pendientes" && !(row.nuevo && !row.creado)) return false;
        if (!q) return true;
        return (
          row.nombre.toLowerCase().includes(q) ||
          (row.cod ?? "").toLowerCase().includes(q) ||
          (row.preCod ?? "").toLowerCase().includes(q) ||
          (tkcNames.get(row.cod) ?? "").toLowerCase().includes(q)
        );
      });
  }, [rows, tableSearch, filtEstado, tkcNames]);

  // ── Propuesta ─────────────────────────────────────────────────────────────────
  const handleProposal = useCallback(async () => {
    const withCode = rows.filter(r => r.cod);
    if (!withCode.length) {
      toast({ description: "Asocia al menos un código antes de calcular la propuesta.", duration: 3000 });
      return;
    }
    setProposalLoading(true);
    try {
      const updated = await computeProposal(rows);
      const changed = updated.filter((r, i) => {
        const o = rows[i];
        return r.cod && (r.r1053 !== o.r1053 || r.t1201 !== o.t1201 || r.w1882 !== o.w1882 || r.z1883 !== o.z1883);
      });
      pendingLabel.current = { label: "Propuesta calculada", type: "propuesta" };
      setRows(updated);
      setProposalDone(true);
      toast({
        title:       "Propuesta calculada",
        description: `${changed.length}/${rows.length} productos con distribución por I.AVG`,
        duration: 3500,
      });
    } catch (err) {
      console.error(err);
      toast({ description: `Error: ${err.message}`, variant: "destructive", duration: 4000 });
    } finally {
      setProposalLoading(false);
    }
  }, [rows, toast]);

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const totalImporte  = rows.reduce((s, r) => s + r.cajasFactura * r.precioCaja, 0);
  const totalUnidades = rows.reduce((s, r) => s + r.cajasRecib * r.uc, 0);
  const nWithCode     = rows.filter(r => r.cod).length;

  // ════════════════════════════════════════════════════════════
  // LISTA DE FACTURAS (debe evaluarse antes que el estado vacío)
  // ════════════════════════════════════════════════════════════
  if (showList) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 pt-4 pb-3 border-b flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold">Distribución Externos</h1>
            <p className="text-xs text-muted-foreground">Facturas cargadas · edita, consulta su historial o abre su documento</p>
          </div>
        </div>
        <InvoiceList suppliers={suppliers} user={user} isAdmin={isAdmin} onOpen={openInvoice} onNew={startNew} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // DROP ZONE (estado vacío)
  // ════════════════════════════════════════════════════════════
  if (!rows.length) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 pt-4 pb-3 border-b flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold">Distribución Externos</h1>
            <p className="text-xs text-muted-foreground">Elige el proveedor y cómo vas a cargar la factura</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowList(true)}>
            <List className="h-3 w-3" />
            Facturas
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-4xl p-6 space-y-6 flex flex-col items-center">

            {/* 1 · Proveedor */}
            <div className="w-full max-w-sm space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">1 · Proveedor</p>
              <SearchSelect
                value={supplier?.id ?? ""}
                onChange={pickSupplier}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Busca o selecciona un proveedor…" size="md" className="w-full"
              />
              <p className="text-[11px] text-muted-foreground">
                ¿Falta alguno? Regístralo en <a href="#/bodegones/ProveedoresBodegon" className="underline">Proveedores Bodegón</a>.
              </p>
            </div>

            {/* 2 · Modo de entrada */}
            <div className="w-full space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">2 · Cómo cargar la factura</p>
              <div className="grid gap-3 sm:grid-cols-2 max-w-xl mx-auto">
                {[
                  { id: "pdf",    icon: FileText,      title: "Factura PDF",       desc: canPdf ? "Lee los productos del PDF automáticamente." : "No hay lector de PDF para este proveedor.", disabled: !canPdf },
                  { id: "manual", icon: ClipboardList, title: "Ingresar manualmente", desc: "Escribe o pega los productos cuando solo te mandan los datos.", disabled: false },
                ].map(m => (
                  <button
                    key={m.id}
                    disabled={m.disabled}
                    onClick={() => setInputMode(m.id)}
                    className={cn(
                      "text-left rounded-xl border-2 p-4 transition-all",
                      inputMode === m.id ? "border-violet-500 bg-violet-50/50 dark:bg-violet-950/20" : "border-muted-foreground/20 hover:border-violet-400/60",
                      m.disabled && "opacity-40 cursor-not-allowed hover:border-muted-foreground/20",
                    )}
                  >
                    <m.icon className="h-5 w-5 text-violet-500 mb-2" />
                    <p className="text-sm font-semibold">{m.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* 3 · Datos */}
            <div className="w-full flex flex-col items-center space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">3 · Datos de la factura</p>
              {inputMode === "manual" ? (
                <ManualInvoiceForm key={supplier?.id} supplier={supplier} extractUC={extractUC} onSubmit={loadManual} />
              ) : (
                <div
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    "w-full max-w-sm border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-5",
                    "cursor-pointer select-none transition-all duration-200",
                    isParsing
                      ? "border-violet-300 dark:border-violet-700 bg-violet-50/30"
                      : "border-muted-foreground/20 hover:border-violet-400/60 hover:bg-violet-50/20 dark:hover:bg-violet-950/10",
                  )}
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="h-10 w-10 text-violet-500 animate-spin" />
                      <p className="text-sm font-medium text-muted-foreground">Procesando PDF…</p>
                    </>
                  ) : (
                    <>
                      <div className="h-16 w-16 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-violet-500 dark:text-violet-400" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-semibold">Arrastra la factura aquí</p>
                        <p className="text-xs text-muted-foreground">o haz clic para seleccionar</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-3 font-mono">Factura PDF · {supplier?.name ?? "Mayorista 23"}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={onFileChange} />
            </div>
          </div>
        </div>
      </div>
    );
  }


  // ════════════════════════════════════════════════════════════
  // VISTA PRINCIPAL — Tabla de distribución
  // ════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full min-h-0">
      <InvoiceHistoryDialog invoiceId={historyId} open={historyId != null} onOpenChange={(o) => { if (!o) setHistoryId(null); }} />
      <TkcExecuteDialog
        open={execDialog != null}
        onOpenChange={(o) => { if (!o) setExecDialog(null); }}
        label={execDialog?.label ?? ""}
        pending={execDialog?.pendingIds.length ?? 0}
        modified={execDialog?.modifiedIds.length ?? 0}
        running={execRunning}
        onRun={runExecution}
        onCopyScript={() => {
          if (!execDialog?.lines.length) return;
          copyText(execDialog.lines.join("\n"), `${execDialog.lines.length} líneas ${execDialog.label}`);
          logEvent("script", `${execDialog.label}: script copiado · ${execDialog.lines.length} líneas`);
        }}
      />

      {/* ── Header principal ─────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 border-b">
        {/* Fila 1: ícono + meta + KPIs + acciones */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-7 w-7 rounded-md bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          </div>

          {/* Meta de la factura */}
          <div className="flex items-baseline gap-2 flex-wrap min-w-0">
            <span className="text-sm font-semibold leading-none">Distribución Externos</span>
            {invoiceMeta?.proveedor && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {invoiceMeta.proveedor}{invoiceMeta.manual ? " · manual" : ""}
              </span>
            )}
            {invoiceMeta?.numero && (
              <span className="font-mono text-xs text-muted-foreground">
                #{invoiceMeta.numero}{invoiceMeta.invoiceId ? ` · ID ${invoiceMeta.invoiceId}` : ""}
              </span>
            )}
            {invoiceMeta?.fecha && (
              <span className="text-xs text-muted-foreground">{invoiceMeta.fecha}</span>
            )}
            {invoiceMeta?.total && (
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {fmtUSD(invoiceMeta.total)}
              </span>
            )}
          </div>

          {/* KPIs */}
          <div className="flex items-center gap-3 text-xs ml-auto">
            <span>
              <span className="font-bold">{rows.length}</span>
              <span className="text-muted-foreground ml-1">prods.</span>
            </span>
            <span title="Productos con código asociado">
              <span className={cn("font-bold tabular-nums", nWithCode === rows.length ? "text-emerald-600" : "text-amber-600")}>
                {nWithCode}/{rows.length}
              </span>
              <span className="text-muted-foreground ml-1">cód.</span>
            </span>
            <span>
              <span className="font-bold tabular-nums text-violet-700 dark:text-violet-400">
                {totalUnidades.toLocaleString()}
              </span>
              <span className="text-muted-foreground ml-1">u</span>
            </span>
            <span className="font-bold tabular-nums">{fmtUSD(totalImporte)}</span>
          </div>

          {/* Acciones secundarias */}
          <div className="flex items-center gap-1">
            <Button
              variant={proposalDone ? "outline" : "default"}
              size="sm"
              className={cn("h-7 text-xs gap-1.5", proposalDone ? "border-emerald-400/50 text-emerald-700" : "bg-violet-600 hover:bg-violet-700 text-white")}
              onClick={handleProposal}
              disabled={proposalLoading}
              title="Calcular la distribución: propuesta de cada bodegón (fórmula de la hoja) → % → reparto de las cajas recibidas"
            >
              {proposalLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
              {proposalDone ? "Recalcular" : "Propuesta"}
            </Button>
            <span
              className={cn("flex items-center gap-1 text-[11px] px-1", saveStatus === "error" ? "text-destructive" : "text-muted-foreground")}
              title="La factura se guarda sola con cada cambio; cada cambio queda en su historial"
            >
              {saveStatus === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</>}
              {saveStatus === "saved" && <><Check className="h-3 w-3 text-emerald-600" /> Guardado{savedAt ? ` ${savedAt.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : ""}</>}
              {saveStatus === "error" && <><AlertTriangle className="h-3 w-3" /> No guardado</>}
            </span>
            {invoiceMeta?.hasPdf && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={verDocumento} title="Abrir el PDF de la factura">
                <FileText className="h-3 w-3" />
                Documento
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setHistoryId(invoiceId)} disabled={!invoiceId} title="Operaciones y precios de esta factura">
              <History className="h-3 w-3" />
              Historial
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={goToList} title="Volver a la lista de facturas">
              <List className="h-3 w-3" />
              Facturas
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={startNew} title="Cerrar esta factura y cargar otra"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={onFileChange} />
        </div>

        {mode === "local" && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-300">
            Provisional: el servidor aún no tiene Distribución Externos; esta factura se guarda solo en este navegador y los checks de ejecución son manuales.
          </p>
        )}

        {/* Fila 2: botones de pedido global */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40 flex-wrap">
          <span className="text-[11px] text-foreground/80 font-semibold uppercase tracking-wider shrink-0">
            Enviar pedidos:
          </span>
          <Button
            size="sm"
            className={PEDIDO_BTN + " bg-amber-600 hover:bg-amber-500 shadow-amber-600/30"}
            onClick={() => sendPedido("aa")}
            title={mode === "api" ? "Ejecuta en TKC el Ajuste AA de los ítems pendientes" : "Copia los scripts de Ajuste AA de los ítems que aún no tienen check"}
          >
            <SendIcon className="h-3.5 w-3.5" />
            Pedido AA 1053
            <ExecProgress s={execStats.aa} />
          </Button>
          {DESTINOS.map(dest => (
            <Button
              key={dest.key}
              size="sm"
              className={cn(PEDIDO_BTN, dest.pedidoCls)}
              onClick={() => sendPedido(dest.key)}
              title={mode === "api" ? `Ejecuta en TKC la transferencia 1053 → ${dest.label} de los ítems pendientes` : `Copia los scripts de Transferencia a ${dest.label} de los ítems que aún no tienen check`}
            >
              <SendIcon className="h-3.5 w-3.5" />
              Pedido Transf {dest.label}
              <ExecProgress s={execStats[dest.key]} />
            </Button>
          ))}
        </div>

        {/* Confirmación de ejecución del último pedido copiado */}
        {mode !== "api" && pendingExec && (
          <div className="flex items-center gap-2 mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 px-3 py-1.5 text-xs">
            <ClipboardList className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span>
              Copiaste <strong>{EXEC_TARGETS.find(t => t.key === pendingExec.target)?.label}</strong> ({pendingExec.rowIds.length} ítems).
              Cuando lo ejecutes en TKC, confírmalo para marcar esos ítems con check.
            </span>
            <Button size="sm" className="h-6 ml-auto text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              onClick={() => { setExecuted(pendingExec.target, pendingExec.rowIds, true); setPendingExec(null); }}>
              <Check className="h-3 w-3" /> Ya lo ejecuté
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setPendingExec(null)}>Descartar</Button>
          </div>
        )}

        {allAdjusted && (
          <div className="flex items-center gap-2 mt-2 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800/50 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
            <PartyPopper className="h-4 w-4 shrink-0" />
            <strong>Factura completamente ajustada.</strong>
            <span className="text-emerald-700/80 dark:text-emerald-400/80">El Ajuste AA y todas las transferencias tienen check en todos sus ítems.</span>
          </div>
        )}

        {/* Fila 3: buscador, filtros y exportación de nuevos */}
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/40 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="h-7 pl-7 text-xs w-64 bg-background"
            />
          </div>
          <FilterToggle
            label="Mostrar" value={filtEstado} onChange={setFiltEstado}
            opts={[["all", "Todos"], ["nuevos", "Nuevos"], ["creados", "Creados"], ["pendientes", "Pendientes"]]}
          />
          <Button
            variant="outline" size="sm" className="h-7 text-xs gap-1.5"
            onClick={exportNuevos}
            title="Exporta a Excel los productos marcados como Nuevo para darles entrada"
          >
            <Download className="h-3 w-3" />
            Exportar nuevos ({rows.filter(r => r.nuevo).length})
          </Button>
          {nAlertas > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              title="Filas donde el CodInicial no coincide con los últimos 6 dígitos del Cód. TKC"
            >
              <AlertTriangle className="h-3 w-3" /> {nAlertas} fila{nAlertas === 1 ? "" : "s"} con alerta de CodInicial
            </span>
          )}
          {visibleRows.length !== rows.length && (
            <span className="text-[10px] text-muted-foreground">
              Mostrando {visibleRows.length} de {rows.length}
            </span>
          )}
        </div>
      </div>

      {/* ── Tabla ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-separate border-spacing-0" style={{ minWidth: 2300 }}>
          <thead className="sticky top-0 z-20 bg-background">

            {/* Fila de grupos */}
            <tr>
              <th colSpan={13}className={cn(TH, "text-left bg-slate-50 dark:bg-slate-900/60 text-slate-500 pl-3")}>
                Factura Mayorista 23
              </th>
              <th
                colSpan={1}
                title="Ajuste AA: script para dar entrada en el 1053 a todo lo recibido de la factura."
                className={cn(TH, "text-center bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400", DIV_AA)}
              >
                Ajuste AA
              </th>
              <th
                colSpan={2}
                title="Bodegón 1053 (principal). Aquí entra toda la mercancía por Ajuste AA y se queda lo que no se transfiere a los otros bodegones."
                className={cn(TH, "text-center bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400", DIV_1053)}
              >
                1053
              </th>
              {DESTINOS.map((d) => (
                <th
                  key={d.key}
                  colSpan={3}
                  title={`Bodegón ${d.label}. Recibe su parte de la mercancía por transferencia desde el 1053.`}
                  className={cn(TH, "text-center", d.grpCls, d.divCls)}
                >
                  → {d.label}
                </th>
              ))}
            </tr>

            {/* Fila de columnas */}
            <tr>
              <th className={cn(TH, "text-center text-muted-foreground w-7")}>#</th>
              <th
                className={cn(TH, "text-left text-muted-foreground pl-2")}
                style={{ minWidth: 100 }}
                title="Últimos 6 dígitos del código TKC (te lo pasan para los productos nuevos). Escríbelo y presiona Enter o sal del campo: se busca el Cód. TKC completo."
              >
                CodInicial
              </th>
              <th className={cn(TH, "text-center text-muted-foreground w-16")} title="Producto nuevo (aún no existe en el catálogo)">Nuevo</th>
              <th className={cn(TH, "text-left text-muted-foreground pl-2")} style={{ minWidth: 150 }}>Cód. TKC</th>
              <th className={cn(TH, "text-center text-muted-foreground w-16")} title="Producto ya creado en el catálogo">Creado</th>
              <th className={cn(TH, "text-left text-muted-foreground pl-2")} style={{ minWidth: 240 }}>Nombre producto</th>
              <th className={cn(TH, "text-center text-muted-foreground w-12")}>U/C</th>
              <th className={cn(TH, "text-center text-muted-foreground w-14")} title="Cajas facturadas">Fac/C</th>
              <th className={cn(TH, "text-center text-muted-foreground w-14")} title="Cajas recibidas">Rec/C</th>
              <th className={cn(TH, "text-right text-muted-foreground w-20 pr-2")}>Precio/C</th>
              <th className={cn(TH, "text-right text-muted-foreground bg-slate-50/80 dark:bg-slate-900/50 w-20 pr-2")}>Importe</th>
              <th className={cn(TH, "text-right text-muted-foreground bg-slate-50/80 dark:bg-slate-900/50 w-16 pr-2")}>P/u</th>
              <th className={cn(TH, "text-right text-muted-foreground bg-slate-50/80 dark:bg-slate-900/50 w-16 pr-2")}>Total U</th>
              {/* Ajuste AA */}
              <th
                title="Script de Ajuste AA para el 1053: código*unidades totales recibidas (Rec/C × U/C). Clic en la celda para copiarlo."
                className={cn(TH, "text-left text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 pl-2", DIV_AA)}
                style={{ minWidth: 170 }}
              >
                Script AA
              </th>
              {/* 1053 */}
              <th
                title="Cajas que se quedan en el 1053: lo recibido menos lo que se transfiere a los demás bodegones."
                className={cn(TH, "text-center text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 w-14", DIV_1053)}
              >
                1053/C
              </th>
              <th
                title="Unidades que se quedan en el 1053: cajas × U/C."
                className={cn(TH, "text-center text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 w-16")}
              >
                1053/U
              </th>
              {/* Destinos */}
              {DESTINOS.map((d) => (
                <React.Fragment key={d.key}>
                  <th
                    title={`Cajas a transferir al bodegón ${d.label} (propuesta calculada o ajustada a mano).`}
                    className={cn(TH, "text-center w-14", d.hdrCls, d.cellBg, d.divCls)}
                  >
                    {d.label}/C
                  </th>
                  <th
                    title={`Unidades a transferir al bodegón ${d.label}: cajas × U/C.`}
                    className={cn(TH, "text-center w-16", d.hdrCls, d.cellBg)}
                  >
                    {d.label}/U
                  </th>
                  <th
                    title={`Script de transferencia al ${d.label}: 1053*${d.label}*código*unidades (cajas × U/C). Clic en la celda para copiarlo.`}
                    className={cn(TH, "text-left pl-2", d.hdrCls, d.cellBg)}
                    style={{ minWidth: 155 }}
                  >
                    Script {d.label}
                  </th>
                </React.Fragment>
              ))}
            </tr>
          </thead>

          <tbody>
            {!visibleRows.length && (
              <tr>
                <td colSpan={TOTAL_COLS} className="py-10 text-center text-xs text-muted-foreground italic">
                  Ningún producto coincide con la búsqueda o los filtros.
                </td>
              </tr>
            )}
            {visibleRows.map(({ row, idx }) => {
              const tkcName    = row.cod ? tkcNames.get(row.cod) : null;
              const n          = row.cajasFactura * row.precioCaja;
              const o          = row.uc > 0 ? row.precioCaja / row.uc : 0;
              const p          = row.cajasRecib * row.uc;
              const aaScript   = row.cod ? `${row.cod}*${p}` : null;
              const isSearching = searchRow === row.id;
              const stripBg    = idx % 2 === 1 ? "bg-muted/[0.03]" : "";

              return (
                <React.Fragment key={row.id}>

                  {/* ── Fila de datos ── */}
                  <tr className={cn("group hover:bg-accent/20 transition-colors", stripBg, isSearching && "bg-sky-50/30 dark:bg-sky-950/15")}>

                    {/* # */}
                    <td className={cn(TD, "text-center text-muted-foreground/50 tabular-nums w-7 select-none")}>{idx + 1}</td>

                    {/* CodInicial */}
                    <td className={cn(TD)} style={{ minWidth: 100 }}>
                      <div className="flex items-center gap-1 pr-1">
                        <Input
                          value={row.preCod ?? ""}
                          onChange={(e) => setField(row.id, "preCod", e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onBlur={() => resolvePreCod(row)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolvePreCod(row); } }}
                          placeholder="6 dígitos"
                          inputMode="numeric"
                          className={cn(
                            "h-6 text-xs font-mono px-1.5 flex-1 min-w-0",
                            "bg-transparent border-0 shadow-none rounded",
                            "focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:bg-background",
                            !row.preCod && "placeholder:text-muted-foreground/35",
                          )}
                        />
                        {codInicialMismatch(row) && (
                          <AlertTriangle
                            className="h-3 w-3 text-amber-500 shrink-0"
                            title={`CodInicial ${row.preCod} no coincide con el Cód. TKC ${row.cod}`}
                          />
                        )}
                        {preCodLoading === row.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
                      </div>
                    </td>

                    {/* N */}
                    <td className={cn(TD, "text-center w-16")}>
                      <Checkbox checked={row.nuevo} onCheckedChange={(v) => setField(row.id, "nuevo", !!v)} className="h-3.5 w-3.5" />
                    </td>

                    {/* Cód. EAN + botón Asociar */}
                    <td className={cn(TD)} style={{ minWidth: 150 }}>
                      <div className="flex items-center gap-1 pr-1">
                        <Input
                          value={row.cod}
                          onChange={(e) => setField(row.id, "cod", e.target.value)}
                          onBlur={() => commitCod(row)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCod(row); } }}
                          placeholder="Cód. TKC"
                          title={row.cod}
                          className={cn(
                            "h-6 text-xs font-mono px-1.5 flex-1 min-w-0",
                            "bg-transparent border-0 shadow-none rounded",
                            "focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:bg-background",
                            !row.cod && "placeholder:text-muted-foreground/35",
                          )}
                        />
                        {/* Botón Asociar — siempre visible */}
                        <button
                          onClick={() => openSearch(row.id)}
                          title={isSearching ? "Cerrar búsqueda" : "Buscar y asociar código TKC"}
                          className={cn(
                            "shrink-0 h-5 w-5 rounded flex items-center justify-center transition-colors",
                            isSearching
                              ? "bg-sky-500 text-white"
                              : row.cod
                                ? "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent"
                                : "bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 hover:bg-sky-200 dark:hover:bg-sky-800/60",
                          )}
                        >
                          <Search className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    {/* C */}
                    <td className={cn(TD, "text-center w-16")}>
                      <Checkbox checked={row.creado} onCheckedChange={(v) => setField(row.id, "creado", !!v)} className="h-3.5 w-3.5" />
                    </td>

                    {/* Nombre */}
                    <td className={cn(TD)} style={{ minWidth: 270 }}>
                      <div className="flex items-start gap-1.5">
                        <ProductImageHover
                          thumbOnly
                          thumbClass="h-8 w-8 mt-0.5"
                          name={tkcName ?? row.nombre}
                          images={row.cod ? (tkcPhotos.get(row.cod) ?? []) : []}
                        />
                        <div className="flex-1 min-w-0">
                      <Input
                        value={row.nombre}
                        onChange={(e) => setField(row.id, "nombre", e.target.value)}
                        title={row.nombre}
                        className={cn(
                          "h-6 text-xs px-1.5 w-full",
                          "bg-transparent border-0 shadow-none rounded",
                          "focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:bg-background",
                        )}
                      />
                      {tkcName && (
                        <div
                          className="px-1.5 pb-0.5 text-[10px] leading-tight text-sky-600 dark:text-sky-400 truncate"
                          title={`Nombre en TKC: ${tkcName}`}
                        >
                          TKC: {tkcName}
                        </div>
                      )}
                        </div>
                      </div>
                    </td>

                    {/* U/C */}
                    <td className={cn(TD, "w-12")}>
                      <Input type="number" min="1" value={row.uc}
                        onChange={(e) => setField(row.id, "uc", Math.max(1, parseInt(e.target.value) || 1))}
                        className={cn(NUM_INPUT, "w-full font-bold")}
                      />
                    </td>

                    {/* Fac/C */}
                    <td className={cn(TD, "w-14")}>
                      <Input type="number" min="0" value={row.cajasFactura}
                        onChange={(e) => setField(row.id, "cajasFactura", Math.max(0, parseInt(e.target.value) || 0))}
                        className={cn(NUM_INPUT, "w-full")}
                      />
                    </td>

                    {/* Rec/C */}
                    <td className={cn(TD, "w-14")}>
                      <Input type="number" min="0" value={row.cajasRecib}
                        onChange={(e) => setField(row.id, "cajasRecib", Math.max(0, parseInt(e.target.value) || 0))}
                        className={cn(NUM_INPUT, "w-full")}
                      />
                    </td>

                    {/* Precio/C */}
                    <td className={cn(TD, "w-20")}>
                      {(() => {
                        const hist = priceMap.get(row.id) ?? [];
                        const last = hist[hist.length - 1];
                        const diff = last?.precioCaja ? ((row.precioCaja - last.precioCaja) / last.precioCaja) * 100 : null;
                        const changed = diff != null && Math.abs(diff) >= 0.01;
                        return (
                          <div className="flex items-center gap-0.5" title={hist.length
                            ? "Precios anteriores:\n" + hist.slice().reverse().map(h => `${h.fecha} (#${h.numero}): $${Number(h.precioCaja).toFixed(2)}`).join("\n")
                            : undefined}>
                            <Input type="number" min="0" step="0.01" value={row.precioCaja}
                              onChange={(e) => setField(row.id, "precioCaja", Math.max(0, parseFloat(e.target.value) || 0))}
                              className={cn(NUM_INPUT, "w-full text-right")}
                            />
                            {changed && (
                              <span className={cn("text-[9px] font-bold shrink-0", diff > 0 ? "text-rose-600" : "text-emerald-600")}>
                                {diff > 0 ? "▲" : "▼"}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Importe */}
                    <td className={cn(TD, "text-right tabular-nums font-medium pr-2 bg-slate-50/30 dark:bg-slate-900/20 w-20")}>
                      {fmtUSD(n)}
                    </td>

                    {/* P/u */}
                    <td className={cn(TD, "text-right tabular-nums text-muted-foreground pr-2 bg-slate-50/30 dark:bg-slate-900/20 w-16")}>
                      {fmtUSD(o)}
                    </td>

                    {/* Total U */}
                    <td className={cn(TD, "text-right tabular-nums font-bold pr-2 bg-slate-50/30 dark:bg-slate-900/20 w-16")}>
                      {p > 0 ? p.toLocaleString() : <span className="text-muted-foreground/40 font-normal">—</span>}
                    </td>

                    {/* Script AA (copiar al click) */}
                    <td className={cn(TD, "bg-rose-50/30 dark:bg-rose-950/20", DIV_AA)} style={{ minWidth: 170 }}>
                      {aaScript ? (
                        <div className="flex items-center gap-1">
                          {renderExecCheck(row, "aa")}
                          <button
                            onClick={() => copyText(aaScript, aaScript)}
                            title={`Click para copiar: ${aaScript}`}
                            className={cn(SCRIPT_CHIP, "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 max-w-[148px]")}
                          >
                            {aaScript}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/30 italic pl-1.5">sin código</span>
                      )}
                    </td>

                    {/* 1053/C */}
                    <td className={cn(TD, "w-14 bg-amber-50/30 dark:bg-amber-950/20", DIV_1053)}>
                      <Input type="number" min="0" value={row.r1053}
                        onChange={(e) => setField(row.id, "r1053", Math.max(0, parseInt(e.target.value) || 0))}
                        className={cn(NUM_INPUT, "w-full border rounded border-amber-200/70 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/30 focus-visible:ring-amber-300/50")}
                      />
                    </td>

                    {/* 1053/U */}
                    <td className={cn(TD, "w-16 text-center tabular-nums font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/30 dark:bg-amber-950/20")}>
                      {(row.r1053 || 0) * row.uc > 0
                        ? ((row.r1053 || 0) * row.uc).toLocaleString()
                        : <span className="text-muted-foreground/30 font-normal">—</span>}
                    </td>

                    {/* Destinos */}
                    {DESTINOS.map((dest) => {
                      const cajas    = row[dest.key] ?? 0;
                      const u        = cajas * row.uc;
                      const btScript = row.cod && u > 0 ? scriptLine(row, dest.key) : null;

                      return (
                        <React.Fragment key={dest.key}>
                          {/* Cajas input */}
                          <td className={cn(TD, "w-14", dest.cellBg, dest.divCls)}>
                            <Input type="number" min="0" value={cajas}
                              onChange={(e) => setField(row.id, dest.key, Math.max(0, parseInt(e.target.value) || 0))}
                              className={cn(NUM_INPUT, "w-full border rounded", dest.inpCls)}
                            />
                          </td>
                          {/* Unidades */}
                          <td className={cn(TD, "w-16 text-center tabular-nums font-semibold", dest.hdrCls, dest.cellBg)}>
                            {u > 0 ? u.toLocaleString() : <span className="text-muted-foreground/30 font-normal">—</span>}
                          </td>
                          {/* Script copiar */}
                          <td className={cn(TD, dest.cellBg)} style={{ minWidth: 155 }}>
                            {btScript ? (
                              <div className="flex items-center gap-1">
                                {renderExecCheck(row, dest.key)}
                                <button
                                  onClick={() => copyText(btScript, btScript)}
                                  title={`Click para copiar: ${btScript}`}
                                  className={cn(SCRIPT_CHIP, dest.badgeCls, "max-w-[132px]")}
                                >
                                  {btScript}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/25 pl-1.5">—</span>
                            )}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>

                  {/* ── Fila de búsqueda/asociación ── */}
                  {isSearching && (
                    <tr>
                      <td colSpan={TOTAL_COLS} className="px-3 py-2.5 bg-sky-50/60 dark:bg-sky-950/20 border-b border-sky-200/40 dark:border-sky-800/30">
                        {/* Nombre del producto que se está asociando */}
                        <p className="text-[10px] text-sky-700 dark:text-sky-400 font-medium mb-2 truncate">
                          Asociando: <span className="italic">{row.nombre}</span>
                        </p>

                        <div className="flex items-start gap-3 flex-wrap">
                          {/* Búsqueda por nombre */}
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                                <Input
                                  autoFocus
                                  value={searchQuery}
                                  onChange={(e) => handleSearchChange(e.target.value)}
                                  placeholder="Buscar por nombre de producto…"
                                  className="h-7 pl-7 text-xs w-72 bg-background"
                                />
                              </div>
                              {searchLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSearchRow(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground/60">
                              La búsqueda es por <strong>nombre</strong> de producto. Para ingresar el código directamente, usa el campo de abajo.
                            </p>
                          </div>

                          {/* Resultados */}
                          {searchResults.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {searchResults.map(r => {
                                const code = String(r.codigo ?? r.id_online ?? "");
                                return (
                                  <button
                                    key={r.id_online ?? code}
                                    onClick={() => selectAssociation(row.id, row.nombreFactura ?? row.nombre, r)}
                                    className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border bg-background hover:bg-accent transition-colors max-w-[220px]"
                                  >
                                    <span className="font-mono font-bold text-sky-700 dark:text-sky-400 shrink-0">{code}</span>
                                    <span className="text-muted-foreground truncate">{r.nombre}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {!searchLoading && searchQuery && !searchResults.length && (
                            <span className="text-xs text-muted-foreground/60 italic self-center">Sin resultados</span>
                          )}
                        </div>

                        {/* Ingreso manual de código — siempre visible */}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-sky-200/30">
                          <span className="text-[10px] text-muted-foreground/80 shrink-0">Ingresar código TKC directamente:</span>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const val = e.currentTarget.elements.namedItem("ean").value.trim();
                              if (val) selectAssociation(row.id, row.nombreFactura ?? row.nombre, val);
                            }}
                            className="flex items-center gap-1"
                          >
                            <Input
                              name="ean"
                              defaultValue={row.cod}
                              placeholder="810146500698"
                              className="h-6 text-xs font-mono w-40 bg-background"
                            />
                            <Button type="submit" variant="secondary" size="sm" className="h-6 text-xs px-3">
                              Asociar
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
