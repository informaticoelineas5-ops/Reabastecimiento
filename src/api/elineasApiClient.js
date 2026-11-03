import { tokenStore } from './tokenStore';

const ELINEAS_BASE = 'https://api.mercadoelineas.com/api';
const PAGE_SIZE          = 2000; // for rdp-ind-general-diario
const AP_PAGE_SIZE       = 500;  // ap-latest max page size
const AP_GLOBAL_PAGE_SIZE = 500; // ap-global-v2 max page size

// Separate token store for Elineas API (may differ from REAB token)
const ELINEAS_KEY = 'elineas_jwt';
export const elineasTokenStore = {
  get()      { try { return localStorage.getItem(ELINEAS_KEY); }       catch { return null; } },
  set(token) { try { localStorage.setItem(ELINEAS_KEY, token); }       catch {} },
  clear()    { try { localStorage.removeItem(ELINEAS_KEY); }           catch {} },
};

// Login to Elineas API — call once after app login succeeds.
// Tries system_slug variants in order so it works regardless of how the
// backend configured the user's role.
export async function elineasLogin(email, password) {
  elineasTokenStore.clear();

  const attempts = [
    { email, password, system_slug: 'elineas-monorepo' },
    { email, password },                                   // no system_slug
  ];

  for (const body of attempts) {
    try {
      const res = await fetch(`${ELINEAS_BASE}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) continue;
      const json  = await res.json();
      const token = json.data?.token ?? json.data?.tokens?.access_token ?? json.token;
      if (token) {
        elineasTokenStore.set(token);
        return token;
      }
    } catch { /* try next variant */ }
  }

  console.warn('[Elineas] login failed para todos los intentos — se usará token REAB para llamadas Elineas');
  return null;
}

// Supports array values for repeated params (e.g. multiple filter= entries)
async function elineasRequest(path, params = {}) {
  // Prefer Elineas-specific token; fall back to REAB token
  const token = elineasTokenStore.get() ?? tokenStore.get();
  const url = new URL(ELINEAS_BASE + path);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(String(k), String(item));
    } else {
      url.searchParams.set(String(k), String(v));
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(url.toString(), { headers });

  // If Elineas token expired, clear it and retry once with REAB token
  if (res.status === 401 && elineasTokenStore.get()) {
    elineasTokenStore.clear();
    const reabToken = tokenStore.get();
    const retryHeaders = { 'Content-Type': 'application/json' };
    if (reabToken) retryHeaders['Authorization'] = `Bearer ${reabToken}`;
    res = await fetch(url.toString(), { headers: retryHeaders });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Elineas API ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Normalize ap-latest row to backward-compat field names ──────────────────

const pf = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const pi = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

export function normalizeApProduct(r) {
  const images = Array.isArray(r.imagenes)
    ? r.imagenes
    : r.imagen ? [r.imagen] : [];
  return {
    ...r,
    // Numeric fields that components call .toFixed() or arithmetic on
    precio:         pf(r.precio),
    precioCosto:    pf(r.precioCosto),
    precioBase:     pf(r.precioBase),
    tasa:           pf(r.tasa),
    cantidad:       pf(r.cantidad),
    cantidadSalidas: pf(r.cantidadSalidas),
    cantidadUm:     pf(r.cantidadUm),
    cantidadBase:   pf(r.cantidadBase),
    peso:           pf(r.peso),
    volumen:        pf(r.volumen),
    // Backward-compat aliases
    id_online:       r.idOnline ?? null,
    categoria_online: r.categoriaOnline ?? null,
    reserved_qty:    pf(r.cantidadSalidas) ?? 0,
    fotos:           images.map(url => ({ foto: url })),
  };
}

// ── apGlobalV2 ─────────────────────────────────────────────────────────────

function buildApGlobalMap(rows, existingMap = new Map()) {
  for (const r of rows) {
    const tid = r.idTienda ?? r['Id Tienda'];
    if (tid == null) continue;
    const key    = String(tid);
    const estado = r.estadoAnuncio ?? r['Estado Anuncio'] ?? null;
    if (estado || !existingMap.has(key)) existingMap.set(key, estado);
  }
  return existingMap;
}

export async function fetchApGlobalIndex() {
  try {
    const map = new Map();
    let page  = 1;
    while (true) {
      const res  = await elineasRequest('/reports/ap-global-v2', { page, pageSize: AP_GLOBAL_PAGE_SIZE });
      const rows = res.data ?? [];
      if (!rows.length) break;
      buildApGlobalMap(rows, map);
      if (page >= (res.pagination?.totalPages ?? 1)) break;
      page++;
    }
    return { map };
  } catch (err) {
    console.error('[Elineas apGlobal] Error:', err.message);
    return { map: new Map() };
  }
}

export async function fetchApGlobalEstadoForAlmacenesStream(almacenes, onChunk) {
  if (!almacenes?.length) { onChunk?.(new Map()); return new Map(); }
  const map = new Map();
  const t0  = performance.now();

  await Promise.all(almacenes.map(async (almacen) => {
    let page = 1;
    while (true) {
      const res  = await elineasRequest('/reports/ap-global-v2', {
        page,
        pageSize: AP_GLOBAL_PAGE_SIZE,
        filter: `almacen:${almacen}`,
      });
      const rows = res.data ?? [];
      if (!rows.length) break;
      buildApGlobalMap(rows, map);
      onChunk?.(new Map(map));
      if (page >= (res.pagination?.totalPages ?? 1)) break;
      page++;
    }
  }));

  return map;
}

// ── Sales indices (rdp-ind-general-diario) ─────────────────────────────────

export async function fetchSalesIndices(onProgress) {
  const rows = [];
  let page   = 1;
  let total  = null;
  while (true) {
    const res     = await elineasRequest('/reports/rdp-ind-general-diario', { page, pageSize: PAGE_SIZE });
    const batch   = res.data ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    if (total === null) total = res.pagination?.totalItems ?? null;
    if (onProgress) onProgress(rows.length, total);
    if (page >= (res.pagination?.totalPages ?? 1)) break;
    page++;
  }
  return rows;
}

// ── Warehouses catalog ─────────────────────────────────────────────────────

// Fallback: extract unique Proveedor values from ap-global-v2
// ap-global-v2 is a different endpoint from ap-latest and may have different permissions
async function fetchProveedoresFromApGlobal() {
  const seen = new Set();
  let page = 1;
  while (true) {
    const res  = await elineasRequest('/reports/ap-global-v2', { page, pageSize: AP_GLOBAL_PAGE_SIZE });
    const rows = res.data ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      const p = r.almacen;
      if (p) seen.add(p);
    }
    if (page >= (res.pagination?.totalPages ?? 1)) break;
    page++;
  }
  if (!seen.size) throw new Error('no proveedores in ap-global-v2');
  return [...seen].sort().map(p => ({ proveedor: p }));
}

export async function fetchElineasWarehouses() {
  // 1) Try dedicated warehouse endpoint
  try {
    const res  = await elineasRequest('/warehouses');
    const data = res.data ?? res;
    if (Array.isArray(data) && data.length > 0) return data;
    throw new Error('empty');
  } catch (e1) {
    console.warn('[Elineas] /warehouses →', e1.message, '— trying ap-global-v2 fallback');
  }
  // 2) Fallback: extract proveedores from ap-global-v2 (different report, may have different access)
  try {
    return await fetchProveedoresFromApGlobal();
  } catch (e2) {
    console.error('[Elineas] ap-global-v2 also failed →', e2.message,
      '\n⚠ Almacenes unavailable. Backend must grant the REAB user access to /api/warehouses or /reports/ap-latest.');
    return [];
  }
}

// ── ap-latest (product snapshot) ───────────────────────────────────────────

// Internal: fetch all pages of ap-latest with given filters (array of "col:val" strings)
async function fetchApLatestPages(filters = [], onProgress) {
  const results = [];
  let page  = 1;
  let total = null;

  while (true) {
    const params = {
      page,
      pageSize: AP_PAGE_SIZE,
      withTotal: page === 1 ? 'true' : 'false',
    };
    if (filters.length) params.filter = filters;

    const res   = await elineasRequest('/reports/ap-latest', params);
    const batch = res.data ?? [];
    if (!batch.length) break;

    results.push(...batch);
    if (total === null) total = res.pagination?.totalItems ?? null;
    if (onProgress) onProgress(results.length, total);
    if (!res.pagination?.hasNextPage) break;
    page++;
  }

  return results;
}

// All products for one warehouse — streaming version (fires onChunk after each page)
export async function fetchApLatestByProveedorStream(proveedor, onChunk) {
  if (!proveedor) { onChunk?.(new Map()); return new Map(); }
  const map = new Map();
  const t0  = performance.now();

  // Sin total conocido (withTotal=false): se piden tandas de páginas en paralelo y se
  // procesan en orden hasta que una venga vacía o sin página siguiente.
  const CONCURRENCY = 3;
  let page = 1;
  let done = false;

  while (!done) {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const req = elineasRequest('/reports/ap-latest', {
          page: page + i,
          pageSize: AP_PAGE_SIZE,
          withTotal: 'false',
          filter: `warehouseName:${proveedor}`,
        });
        // La primera página de la tanda debe existir; las siguientes pueden estar fuera de rango.
        return i === 0
          ? req
          : req.catch(e => {
              if (/→ (400|404|422):/.test(e.message)) return { data: [] };
              throw e;
            });
      }),
    );

    for (const res of results) {
      const batch = res.data ?? [];
      for (const r of batch) {
        const norm = normalizeApProduct(r);
        const key  = String(norm.id_online ?? norm.codigo ?? r.idTkc ?? '');
        if (key) map.set(key, norm);
      }
      if (!batch.length || !res.pagination?.hasNextPage) { done = true; break; }
    }

    onChunk?.(new Map(map));
    page += CONCURRENCY;
  }

  return map;
}

// Paginated catalog — mirrors old fetchExtCatalogPaginated signature
export async function fetchApLatestPaginated(conditions = {}, options = {}) {
  const { search, extraFilters = [], orderBy, limit = 50, offset = 0 } = options;
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;

  // Map old snake_case condition keys to Elineas camelCase filter column names
  const FIELD_MAP = {
    categoria_online: 'categoriaOnline',
    id_online:        'idOnline',
    proveedor:        'warehouseName',
    reserved_qty:     'cantidadSalidas',
  };
  const filters = [];
  for (const [key, value] of Object.entries(conditions)) {
    if (value === null || value === undefined || value === '') continue;
    const col = FIELD_MAP[key] ?? key;
    if (Array.isArray(value)) {
      value.forEach(v => filters.push(`${col}:${v}`));
    } else {
      filters.push(`${col}:${value}`);
    }
  }

  const params = {
    page,
    pageSize: Math.min(limit, AP_PAGE_SIZE),
    withTotal: 'true',
  };

  // search can be a string or {text, columns} object
  const searchText = typeof search === 'string' ? search.trim() : search?.text?.trim();
  if (searchText) params.search = searchText;

  if (orderBy) {
    const asc = !orderBy.startsWith('-');
    const col  = FIELD_MAP[asc ? orderBy : orderBy.slice(1)] ?? (asc ? orderBy : orderBy.slice(1));
    params.sortBy  = col;
    params.sortDir = asc ? 'asc' : 'desc';
  }
  if (filters.length) params.filter = filters;

  const res = await elineasRequest('/reports/ap-latest', params);
  return {
    data:  (res.data ?? []).map(normalizeApProduct),
    total: res.pagination?.totalItems ?? 0,
  };
}

// Fetch ALL pages of ap-latest for conditions — used when client-side filters require full data
export async function fetchApLatestAll(conditions = {}, options = {}) {
  const { search, orderBy } = options;
  const FIELD_MAP = { categoria_online: 'categoriaOnline', id_online: 'idOnline', proveedor: 'warehouseName', reserved_qty: 'cantidadSalidas' };

  const filterList = [];
  for (const [key, value] of Object.entries(conditions)) {
    if (value === null || value === undefined || value === '') continue;
    const col = FIELD_MAP[key] ?? key;
    if (Array.isArray(value)) value.forEach(v => filterList.push(`${col}:${v}`));
    else filterList.push(`${col}:${value}`);
  }

  const searchText = typeof search === 'string' ? search.trim() : search?.text?.trim();
  const rows = [];
  let page = 1;

  while (true) {
    const params = { page, pageSize: AP_PAGE_SIZE, withTotal: 'false' };
    if (filterList.length) params.filter = filterList;
    if (searchText) params.search = searchText;
    if (orderBy) {
      const asc = !orderBy.startsWith('-');
      const raw = asc ? orderBy : orderBy.slice(1);
      params.sortBy  = FIELD_MAP[raw] ?? raw;
      params.sortDir = asc ? 'asc' : 'desc';
    }
    const res   = await elineasRequest('/reports/ap-latest', params);
    const batch = res.data ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    if (!res.pagination?.hasNextPage) break;
    page++;
  }

  return rows.map(normalizeApProduct);
}

// ── Catálogo vía /products?almacenes= ──────────────────────────────────────
// /products combina datos estáticos de ap-latest con los que varían (sub-latest), sin el desfase de horarios
// de ap-latest. `almacenes` recibe los IDs internos de almacén de Elineas (797, 1012…), NO la clave TKC (1053, 1201…):
// se resuelven desde /warehouses por nombre y se guardan en memoria.
let warehouseIdsPromise = null;

function loadWarehouseIds() {
  if (!warehouseIdsPromise) {
    warehouseIdsPromise = fetchElineasWarehouses().then((list) => {
      // /warehouses → { key: clave TKC, nombre, nombreTkc, value: ID interno que espera /products?almacenes= }
      const byName = new Map(), byKey = new Map();
      for (const w of list) {
        const id = w.value ?? w.id ?? w.warehouseId ?? w.almacenId;
        if (id == null) continue;
        if (w.key != null) byKey.set(String(w.key), String(id));
        for (const n of [w.nombre, w.nombreTkc, w.proveedor, w.name, w.warehouseName, w.almacen]) {
          if (n) byName.set(String(n).trim().toLowerCase(), String(id));
        }
      }
      if (!byName.size && !byKey.size) throw new Error('/warehouses no devolvió IDs de almacén');
      return { byName, byKey };
    }).catch((e) => { warehouseIdsPromise = null; throw e; });
  }
  return warehouseIdsPromise;
}

// Clave TKC dentro del nombre: último número entre paréntesis o, si no hay, el último grupo de dígitos
const keyFromName = (name) => {
  const s = String(name ?? '');
  return ([...s.matchAll(/((d+))/g)].pop() ?? [...s.matchAll(/(d+)/g)].pop())?.[1] ?? null;
};

async function resolveWarehouseIds(names) {
  const { byName, byKey } = await loadWarehouseIds();
  const list = [].concat(names ?? []).filter(Boolean);
  const ids = [], missing = [];
  for (const n of list) {
    const id = byName.get(String(n).trim().toLowerCase()) ?? byKey.get(keyFromName(n));
    if (id) ids.push(id); else missing.push(n);
  }
  if (missing.length) throw new Error(`No se encontró el ID de almacén para: ${missing.join(', ')}`);
  return [...new Set(ids)];
}

// Condiciones del Catálogo → parámetros de /products
async function buildProductsParams(conditions = {}, options = {}) {
  const { search, orderBy } = options;
  const FIELD_MAP = { categoria_online: 'categoriaOnline', id_online: 'idOnline', reserved_qty: 'cantidadSalidas' };
  const params = {};
  const filters = [];
  for (const [key, value] of Object.entries(conditions)) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'proveedor') { params.almacenes = (await resolveWarehouseIds(value)).join(','); continue; }
    const col = FIELD_MAP[key] ?? key;
    [].concat(value).forEach(v => filters.push(`${col}:${v}`));
  }
  if (filters.length) params.filter = filters;
  const searchText = typeof search === 'string' ? search.trim() : search?.text?.trim();
  if (searchText) params.search = searchText;
  if (orderBy) {
    const asc = !orderBy.startsWith('-');
    const raw = asc ? orderBy : orderBy.slice(1);
    params.sortBy  = FIELD_MAP[raw] ?? raw;
    params.sortDir = asc ? 'asc' : 'desc';
  }
  return params;
}

export async function fetchProductsPaginated(conditions = {}, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const params = await buildProductsParams(conditions, options);
  const res = await elineasRequest('/products', {
    ...params,
    page: Math.floor(offset / Math.max(limit, 1)) + 1,
    pageSize: Math.min(limit, AP_PAGE_SIZE),
    withTotal: 'true',
  });
  return {
    data:  (res.data ?? []).map(normalizeApProduct),
    total: res.pagination?.totalItems ?? 0,
  };
}

export async function fetchProductsAll(conditions = {}, options = {}) {
  const params = await buildProductsParams(conditions, options);
  const rows = [];
  for (let page = 1; ; page++) {
    const res = await elineasRequest('/products', { ...params, page, pageSize: AP_PAGE_SIZE, withTotal: 'false' });
    const batch = res.data ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    if (!res.pagination?.hasNextPage) break;
  }
  return rows.map(normalizeApProduct);
}

// Look up products by their idOnline values (for ProposalTable)
// Multiple filter= params are AND — must query one at a time or in small batches
export async function fetchApLatestByIdOnlines(idOnlines) {
  if (!idOnlines?.length) return [];
  const ids = [...new Set(idOnlines.map(v => String(v)).filter(Boolean))];
  const batches = await Promise.all(
    ids.map(id => fetchApLatestPages([`idOnline:${id}`]))
  );
  return batches.flat().map(normalizeApProduct);
}

// Get unique suministrador values for a proveedor (warehouse)
export async function fetchApLatestSuministradores(proveedor) {
  if (!proveedor) return [];
  const rows = await fetchApLatestPages([`warehouseName:${proveedor}`]);
  return [...new Set(rows.map(r => r.suministrador).filter(Boolean))].sort();
}

// Get unique suministrador values for multiple proveedores
// Each proveedor needs a separate request (multiple filter= params are AND, not OR)
export async function fetchApLatestSuministradoresMulti(proveedores) {
  if (!proveedores?.length) return [];
  const batches = await Promise.all(
    proveedores.map(p => fetchApLatestPages([`warehouseName:${p}`]))
  );
  const all = batches.flat();
  return [...new Set(all.map(r => r.suministrador ?? r.proveedor).filter(Boolean))].sort();
}

// Fetch all rdp-vd-latest rows filtered client-side by date range [fromDate, toDate]
// Dates are YYYY-MM-DD strings. Fires onProgress(loaded, total) after each page.
export async function fetchVdLatestForDateRange(fromDate, toDate, onProgress) {
  const rows = [];
  let page = 1;
  let total = null;
  while (true) {
    const res = await elineasRequest('/reports/rdp-vd-latest', {
      page,
      pageSize: 500,
      withTotal: page === 1 ? 'true' : 'false',
    });
    const batch = res.data ?? [];
    if (!batch.length) break;
    rows.push(...batch);
    if (total === null) total = res.pagination?.totalItems ?? null;
    if (onProgress) onProgress(rows.length, total);
    if (!res.pagination?.hasNextPage) break;
    page++;
  }
  // Filter by date range client-side
  return rows.filter(r => {
    const d = (r.sellDate ?? '').slice(0, 10);
    return d >= fromDate && d <= toDate;
  });
}

// Ventas directas de UN producto (por código) desde `fromDate` (YYYY-MM-DD).
// Pide al reporte solo las filas de ese código (filter=codigo:…). Si el servidor ignorara el filtro
// se detecta en la primera página (filas de otros códigos) y se aborta, para no descargar todo el reporte.
export async function fetchVdLatestForCode(codigo, fromDate) {
  const code = String(codigo ?? '').trim();
  if (!code) return [];
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const res = await elineasRequest('/reports/rdp-vd-latest', {
      page, pageSize: 500, withTotal: 'false', filter: `codigo:${code}`,
    });
    const batch = res.data ?? [];
    if (page === 1 && batch.some(r => String(r.codigo ?? '').trim() !== code)) {
      throw new Error('El reporte de ventas no permite filtrar por código de producto.');
    }
    rows.push(...batch);
    if (!batch.length || !res.pagination?.hasNextPage) break;
  }
  return rows.filter(r => (r.sellDate ?? '').slice(0, 10) >= fromDate);
}

// Ventas diarias de UN producto en UN almacén desde `fromDate` (YYYY-MM-DD), del reporte general de ventas
// (rdp-latest: una fila por día, producto y almacén; es la misma base de los índices de venta).
// El reporte solo filtra por igualdad: se piden las filas del producto y almacén, de la fecha más reciente a la más
// antigua, y se corta al llegar a `fromDate`. Si el servidor ignorara el filtro se detecta en la primera página.
export async function fetchRdpSalesForProduct(idTienda, almacenKey, fromDate) {
  const id = String(idTienda ?? '').trim();
  const key = String(almacenKey ?? '').trim();
  if (!id || !key) return [];
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const res = await elineasRequest('/reports/rdp-latest', {
      page, pageSize: 500, withTotal: 'false', sortBy: 'reportDate', sortDir: 'desc',
      filter: [`idTienda:${id}`, `almacenKey:${key}`],
    });
    const batch = res.data ?? [];
    if (page === 1 && batch.some(r => String(r.idTienda ?? '').trim() !== id || String(r.almacenKey ?? '').trim() !== key)) {
      throw new Error('El reporte de ventas no permite filtrar por producto y almacén.');
    }
    rows.push(...batch);
    const oldest = batch.length ? String(batch[batch.length - 1].reportDate ?? '').slice(0, 10) : '';
    if (!batch.length || !res.pagination?.hasNextPage || (oldest && oldest < fromDate)) break;
  }
  return rows.filter(r => String(r.reportDate ?? '').slice(0, 10) >= fromDate);
}

// Single product by idOnline from snapshot
export async function fetchApLatestByIdOnline(idOnline) {
  if (!idOnline) return null;
  const res = await elineasRequest('/reports/ap-latest', {
    filter:   `idOnline:${idOnline}`,
    pageSize: 1,
    withTotal: 'false',
  });
  const row = (res.data ?? [])[0];
  return row ? normalizeApProduct(row) : null;
}

// ── Live product search (TKC in real time — use sparingly) ─────────────────

export async function searchElineasLiveProducts(text, limit = 10) {
  if (!text?.trim() || text.trim().length < 2) return [];
  const res = await elineasRequest('/products', {
    search:   text.trim(),
    pageSize: Math.min(limit, 500),
    page:     1,
  });
  return (res.data ?? []).map(normalizeApProduct);
}

/**
 * Busca un producto por código (EAN/TKC) en almacenes específicos.
 * Retorna una entrada por almacén que tenga ese producto.
 * @param {string} codigo — código exacto a buscar
 * @param {string[]} almacenIds — IDs numéricos de almacenes (ej. ["797","1012","1825","1826"])
 * @returns {Array} productos filtrados a los que tienen exactamente ese código
 */
// Producto del catálogo de Elineas por código exacto (cualquier almacén) → { codigo, nombre } | null
export async function fetchElineasProductByCode(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return null;
  const res = await elineasRequest('/products', { search: c, pageSize: 20, page: 1 });
  const p = (res.data ?? []).map(normalizeApProduct).find(x => String(x.codigo ?? '').trim() === c);
  return p ? { codigo: c, nombre: p.nombre ?? '' } : null;
}

// Busca el código TKC completo a partir de sus últimos dígitos (CodInicial).
// Devuelve [{ codigo, nombre }] sin repetir códigos (el catálogo trae una entrada por almacén).
export async function searchProductsByCodeSuffix(suffix) {
  const s = String(suffix ?? '').trim();
  if (!s) return [];
  const res = await elineasRequest('/products', { search: s, pageSize: 100, page: 1 });
  const found = new Map();
  for (const p of (res.data ?? []).map(normalizeApProduct)) {
    const codigo = String(p.codigo ?? '').trim();
    if (codigo.endsWith(s) && !found.has(codigo)) found.set(codigo, { codigo, nombre: p.nombre ?? '' });
  }
  return [...found.values()];
}

export async function fetchProductInBodegones(codigo, almacenIds) {
  if (!codigo?.trim() || !almacenIds?.length) return [];
  const res = await elineasRequest('/products', {
    search:    codigo.trim(),
    pageSize:  20,
    page:      1,
    almacenes: almacenIds.join(','),
  });
  return (res.data ?? [])
    .map(normalizeApProduct)
    .filter(p => String(p.codigo ?? "").trim() === codigo.trim());
}
