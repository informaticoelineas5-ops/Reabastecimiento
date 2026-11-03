// Productos + existencias + índices de ventas + estado de anuncio, todo en una sola consulta:
// reporte `indg_ap_sub` de la API de Elineas (vista materializada mv_producto_almacen_completo).
// Sustituye a tres llamadas separadas por almacén: ap-latest (productos), rdp-ind-general-* (índices)
// y ap-global-v2 (estado de anuncio). Los índices son los del producto (idTienda) y los refresca el DBA:
// `updatedAt` de cada fila dice cuándo.
import { elineasTokenStore, normalizeApProduct } from './elineasApiClient';
import { tokenStore } from './tokenStore';
import { fetchPagesParallel } from './paginate';
import { extractAlmacenKey, parseIndexRows } from './salesIndicesClient';

const ELINEAS_BASE = 'https://api.mercadoelineas.com/api';
const PAGE_SIZE    = 500;   // tope del reporte

// Columnas por las que el reporte permite filtrar; cualquier otra daría 400
const FILTER_COLS = new Set([
  'almacenKey', 'almacenNombre', 'id', 'codigo', 'codigoPyme', 'idOnline', 'nombre', 'clasificacion',
  'categoriaOnline', 'categoriaAlmacen', 'proveedor', 'suministrador', 'marca', 'estadoAnuncio', 'idTienda',
]);
// Nombres que usa la app → columnas del reporte
const COL_MAP = {
  categoria_online:  'categoriaOnline',
  id_online:         'idOnline',
  reserved_qty:      'cantidadSalidas',
  existencia_fisica: 'cantidad',
};

async function indgRequest(params) {
  const token = elineasTokenStore.get() ?? tokenStore.get();
  const url = new URL(`${ELINEAS_BASE}/reports/indg_ap_sub`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, String(item)));
    else url.searchParams.set(k, String(v));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`indg_ap_sub ${res.status}: ${text}`);
  }
  return res.json();
}

// Fila del reporte → producto con los mismos nombres que antes daba ap-latest
function rowToProduct(r, almacenSel) {
  return {
    ...normalizeApProduct({ ...r, warehouseKey: r.almacenKey, warehouseName: r.almacenNombre, idTkc: r.id }),
    almacenSel: almacenSel ?? r.proveedor ?? null,
  };
}

const productKey = (p) => String(p.id_online ?? p.codigo ?? p.idTkc ?? '');

/** Claves de almacén (1000, 1053…) a partir de los nombres que guarda la app. */
export function almacenKeysOf(almacenes) {
  return [...new Set([].concat(almacenes ?? []).map(extractAlmacenKey).filter(Boolean))];
}

/**
 * Todo lo de uno o varios almacenes, página a página (onChunk recibe lo acumulado tras cada tanda).
 * Devuelve { products: Map<idOnline, producto>, salesMap: Map<idTienda, índices>, apMap: Map<idTienda, estado> }.
 */
export async function fetchIndgForAlmacenes(almacenes, onChunk) {
  const empty = () => ({ products: new Map(), salesMap: new Map(), apMap: new Map() });
  if (!almacenes?.length) { const e = empty(); onChunk?.(e); return e; }
  const keys = almacenKeysOf(almacenes);
  if (!keys.length) throw new Error(`No se pudo identificar el código del almacén: ${almacenes.join(', ')}`);
  const nameByKey = new Map(almacenes.map(a => [extractAlmacenKey(a), a]).filter(([k]) => k));

  const out = empty();
  const t0 = performance.now();
  const absorb = (rows) => {
    parseIndexRows(rows).forEach((v, k) => out.salesMap.set(k, v));
    for (const r of rows) {
      const p = rowToProduct(r, nameByKey.get(String(r.almacenKey)));
      const key = productKey(p);
      if (!key) continue;
      const entry = out.salesMap.get(String(r.idTienda ?? ''));
      out.products.set(key, entry ? { ...p, indices: entry } : p);
      const tid = r.idTienda ?? r.idOnline;
      if (tid != null && (r.estadoAnuncio || !out.apMap.has(String(tid)))) out.apMap.set(String(tid), r.estadoAnuncio ?? null);
    }
  };
  const snapshot = () => ({ products: new Map(out.products), salesMap: new Map(out.salesMap), apMap: new Map(out.apMap) });
  const params = (page, withTotal) => ({ page, pageSize: PAGE_SIZE, withTotal: withTotal ? 'true' : 'false', filter: `almacenKey:${keys.join(' , ')}` });

  const first = await indgRequest(params(1, true));
  absorb(first.data ?? []);
  onChunk?.(snapshot());

  const rest = await fetchPagesParallel(first.pagination?.totalPages ?? 1, (p) => indgRequest(params(p, false)));
  for (const res of rest) absorb(res.data ?? []);
  if (rest.length) onChunk?.(snapshot());

  return snapshot();
}

// Condiciones y orden del Catálogo → parámetros del reporte
function buildParams(conditions = {}, options = {}) {
  const { search, orderBy } = options;
  const filters = [];
  for (const [key, value] of Object.entries(conditions)) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'proveedor') {
      const keys = almacenKeysOf(value);
      if (!keys.length) throw new Error(`No se pudo identificar el código del almacén: ${[].concat(value).join(', ')}`);
      filters.push(`almacenKey:${keys.join(' , ')}`);
      continue;
    }
    const col = COL_MAP[key] ?? key;
    if (!FILTER_COLS.has(col)) continue;   // p. ej. revision, usa_catalogo: este reporte no las tiene
    [].concat(value).forEach(v => filters.push(`${col}:${v}`));
  }
  const params = {};
  if (filters.length) params.filter = filters;
  const text = typeof search === 'string' ? search.trim() : search?.text?.trim();
  if (text) params.search = text;
  if (orderBy) {
    const asc = !orderBy.startsWith('-');
    const raw = asc ? orderBy : orderBy.slice(1);
    params.sortBy  = COL_MAP[raw] ?? raw;
    params.sortDir = asc ? 'asc' : 'desc';
  }
  return params;
}

function rowsToProducts(rows) {
  const idx = parseIndexRows(rows);
  return rows.map(r => {
    const p = rowToProduct(r);
    const entry = idx.get(String(r.idTienda ?? ''));
    return entry ? { ...p, indices: entry } : p;
  });
}

/** Una página del Catálogo: { data, total }. Cada producto ya trae `indices` y `estadoAnuncio`. */
export async function fetchIndgPaginated(conditions = {}, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const res = await indgRequest({
    ...buildParams(conditions, options),
    page: Math.floor(offset / Math.max(limit, 1)) + 1,
    pageSize: Math.min(limit, PAGE_SIZE),
    withTotal: 'true',
  });
  return { data: rowsToProducts(res.data ?? []), total: res.pagination?.totalItems ?? 0 };
}

/** Todas las páginas de unas condiciones (para los filtros que solo se pueden aplicar en el navegador). */
export async function fetchIndgAll(conditions = {}, options = {}) {
  const params = buildParams(conditions, options);
  const first = await indgRequest({ ...params, page: 1, pageSize: PAGE_SIZE, withTotal: 'true' });
  const rows = [...(first.data ?? [])];
  const rest = await fetchPagesParallel(first.pagination?.totalPages ?? 1, (p) => indgRequest({ ...params, page: p, pageSize: PAGE_SIZE, withTotal: 'false' }));
  for (const res of rest) rows.push(...(res.data ?? []));
  return rowsToProducts(rows);
}
