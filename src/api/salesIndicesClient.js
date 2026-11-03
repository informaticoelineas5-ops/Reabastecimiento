import { elineasTokenStore } from './elineasApiClient';
import { tokenStore } from './tokenStore';
import { fetchPagesParallel } from './paginate';

const ELINEAS_BASE = 'https://api.mercadoelineas.com/api';
const PAGE_SIZE    = 500;

export const INDEX_KEYS = [
  'prom_ventas_diario_top_max_2',
  'prom_ventas_diario_mayor_0',
  'prom_ventas_diario_todos',
  'prom_ventas_diario_no_festivas',
  'prom_ventas_diario_festivas',
  'prom_ventas_diario_nom_dic',
  'prom_ventas_diario_14_feb',
  'prom_ventas_diario_madres',
  'prom_ventas_diario_ult_7_dias',
  'prom_ventas_diario_ult_15_dias',
  'prom_ventas_diario_ult_1_mes',
  'prom_ventas_diario_ult_3_mes',
  'prom_ventas_diario_ult_6_mes',
];

// Elineas API camelCase → internal snake_case used throughout the app
const FIELD_MAP = {
  promMax2:       'prom_ventas_diario_top_max_2',
  promMayor0:     'prom_ventas_diario_mayor_0',
  promTodos:      'prom_ventas_diario_todos',
  promNoFestivas: 'prom_ventas_diario_no_festivas',
  promFestivas:   'prom_ventas_diario_festivas',
  promNovDic:     'prom_ventas_diario_nom_dic',
  prom14Feb:      'prom_ventas_diario_14_feb',
  promMadres:     'prom_ventas_diario_madres',
  promUlt7Dias:   'prom_ventas_diario_ult_7_dias',
  promUlt15Dias:  'prom_ventas_diario_ult_15_dias',
  promUlt1Mes:    'prom_ventas_diario_ult_1_mes',
  promUlt3Mes:    'prom_ventas_diario_ult_3_mes',
  promUlt6Mes:    'prom_ventas_diario_ult_6_mes',
};

export function calcCategoria(indice) {
  if (indice == null) return null;
  if (indice >= 1.0) return 'A';
  if (indice >= 0.6) return 'B';
  if (indice >= 0.2) return 'C';
  return 'D';
}

export function computeIndiceAvg(entry, selectedKeys) {
  if (!entry || !selectedKeys?.length) return null;
  const vals = selectedKeys.map(k => entry[k]).filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export { parseRows as parseIndexRows };
function parseRows(rows) {
  const pv = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const map = new Map();
  for (const r of rows) {
    const id = r.idTienda;
    if (id == null) continue;
    const indices = {};
    for (const [apiKey, snakeKey] of Object.entries(FIELD_MAP)) {
      indices[snakeKey] = pv(r[apiKey]);
    }
    const p1 = indices.prom_ventas_diario_top_max_2;
    const p2 = indices.prom_ventas_diario_mayor_0;
    const p3 = indices.prom_ventas_diario_ult_1_mes;
    const indiceAvg = (p1 != null && p2 != null && p3 != null) ? (p1 + p2 + p3) / 3 : null;
    map.set(String(id), {
      ...indices,
      promedioMaxDiv2: p1,
      promedioPos:     p2,
      promedioUlt1mes: p3,
      indiceAvg,
      categoriaVentas: calcCategoria(indiceAvg),
      suministrador: r.suministrador ?? null,
    });
  }
  return map;
}

// Código numérico del almacén a partir de su nombre. Formatos reales:
//   "B23 Electrocuba SV (1201)" → 1201 · "TKC 789" → 789 · "TKC SUB 1053" → 1053 · "TKC SUB 593 UP" → 593
// Primero el último número entre paréntesis; si no hay, el último grupo de dígitos del nombre
// (aunque no esté al final: "… 593 UP").
export function extractAlmacenKey(name) {
  const s = String(name ?? "");
  const paren = [...s.matchAll(/\((\d+)\)/g)].pop();
  if (paren) return paren[1];
  return [...s.matchAll(/\d+/g)].pop()?.[0] ?? null;
}

/** Almacenes cuyo nombre no permite saber su código (no se pueden consultar en el reporte). */
export const almacenesSinClave = (almacenes) => (almacenes ?? []).filter(a => !extractAlmacenKey(a));

async function fetchPageAlmacen(page, almacenKeys) {
  const token = elineasTokenStore.get() ?? tokenStore.get();
  const url   = new URL(`${ELINEAS_BASE}/reports/rdp-ind-general-almacen`);
  url.searchParams.set('page',     String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('filter',   `almacenKey:${almacenKeys.join(' , ')}`);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rdp-ind-general-almacen ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Devuelve la entrada de índice de ventas para un idTienda específico.
 * Usa rdp-ind-general-diario con filter=idTienda:{id}.
 * Retorna null si no hay datos.
 */
export async function fetchSalesIndexByIdTienda(idTienda) {
  if (!idTienda) return null;
  const token = elineasTokenStore.get() ?? tokenStore.get();
  const url = new URL(`${ELINEAS_BASE}/reports/rdp-ind-general-diario`);
  url.searchParams.set('filter',   `idTienda:${idTienda}`);
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('page',     '1');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res  = await fetch(url.toString(), { headers });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    const rows = json.data ?? [];
    if (!rows.length) return null;
    if ((json.pagination?.totalItems ?? 1) > 1) {
      console.warn(`[rdp] idTienda=${idTienda} devuelve ${json.pagination.totalItems} filas; se usa solo la primera`);
    }
    return parseRows(rows).get(String(idTienda)) ?? null;
  } catch {
    return null;
  }
}

export async function fetchSalesIndicesAlmacenStream(almacenes, onChunk) {
  // Sin almacén no se carga nada: antes se descargaban los índices de TODOS los almacenes,
  // lo que mezclaba productos y suministradores ajenos a la selección.
  if (!almacenes?.length) { onChunk?.(new Map()); return new Map(); }
  const keys = [...new Set(almacenes.map(extractAlmacenKey).filter(Boolean))];
  if (!keys.length) {
    throw new Error(`No se pudo identificar el código del almacén: ${almacenes.join(", ")}`);
  }
  const sinClave = almacenesSinClave(almacenes);
  if (sinClave.length) console.warn("[indices-almacen] almacenes sin código, se omiten:", sinClave);
  const accumulated = new Map();
  const t0 = performance.now();

  const first = await fetchPageAlmacen(1, keys);
  parseRows(first.data ?? []).forEach((v, k) => accumulated.set(k, v));
  onChunk?.(new Map(accumulated));

  const rest = await fetchPagesParallel(first.pagination?.totalPages ?? 1, (p) => fetchPageAlmacen(p, keys));
  for (const res of rest) parseRows(res.data ?? []).forEach((v, k) => accumulated.set(k, v));
  if (rest.length) onChunk?.(new Map(accumulated));

  return accumulated;
}

async function fetchPage(page) {
  const token = elineasTokenStore.get() ?? tokenStore.get();
  const url   = new URL(`${ELINEAS_BASE}/reports/rdp-ind-general-diario`);
  url.searchParams.set('page',     String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rdp-ind-general-diario ${res.status}: ${text}`);
  }
  return res.json();
}

// Streaming version — fires onChunk after each page (allows progressive rendering)
export async function fetchSalesIndicesStream(onChunk) {
  const accumulated = new Map();
  const t0 = performance.now();
  let page = 1;
  while (true) {
    const res   = await fetchPage(page);
    const batch = res.data ?? [];
    if (!batch.length) break;
    parseRows(batch).forEach((v, k) => accumulated.set(k, v));
    onChunk?.(new Map(accumulated));
    if (page >= (res.pagination?.totalPages ?? 1)) break;
    page++;
  }
  return accumulated;
}

export async function fetchSalesIndices() {
  return fetchSalesIndicesStream();
}

// With only ~3.4k total rows loading all is faster than N individual filtered requests
export async function fetchSalesIndicesByIds(_ids) {
  return fetchSalesIndices();
}
