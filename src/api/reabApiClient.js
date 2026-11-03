import { tokenStore } from './tokenStore';
import { fetchPagesParallel } from './paginate';

const REAB_BASE = 'https://apireab.mercadoelineas.com/api/v1';

// REAB API maximum allowed pageSize
const MAX_PAGE_SIZE = 200;

// Entities routed to REAB API instead of Supabase
export const REAB_ENTITIES = new Set([
  'Supplier',
  'SupplierContact',
  'PurchaseOrder',
  'PurchaseOrderItem',
  'SupplierOffer',
  'SupplierOfferItem',
  'SupplierOfferItemMatch',
  'Offer',
  'Product',
  'OfferItemPriceHistory',
  'OfferItemMatch',
  'ImportLog',
  'ReplenishmentProposalItem',
  'InventorySnapshot',
  'Connector',
  'SalesIndex',
]);

const REAB_PATH_MAP = {
  Supplier:                  '/suppliers',
  SupplierContact:           '/supplier-contacts',
  Product:                   '/products',
  PurchaseOrder:             '/purchase-orders',
  PurchaseOrderItem:         '/purchase-order-items',
  SupplierOffer:             '/supplier-offers',
  SupplierOfferItem:         '/supplier-offer-items',
  SupplierOfferItemMatch:    '/supplier-offer-item-matches',
  Offer:                     '/offers',
  OfferItemPriceHistory:     '/offer-item-price-history',
  OfferItemMatch:            '/offer-item-matches',
  ImportLog:                 '/import-logs',
  ReplenishmentProposalItem: '/replenishment-proposals',
  InventorySnapshot:         '/inventory-snapshots',
  Connector:                 '/connectors',
  SalesIndex:                '/sales-index',
};

// Field name aliases — same as in supabaseClient (old names → actual API names)
const COLUMN_ALIASES = {
  created_date:  'created_at',
  updated_date:  'updated_at',
  row_index:     'row_number',
  contact_date:  'created_at',
};

function resolveColumn(col) {
  return COLUMN_ALIASES[col] ?? col;
}

function parseOrderBy(orderBy) {
  if (!orderBy) return { column: 'created_at', ascending: false };
  const ascending = !orderBy.startsWith('-');
  const raw = ascending ? orderBy : orderBy.slice(1);
  return { column: resolveColumn(raw), ascending };
}

// Add backward-compat aliases so components that read .created_date still work
function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const out = { ...rec };
  if (out.created_at !== undefined && out.created_date === undefined) out.created_date = out.created_at;
  if (out.updated_at !== undefined && out.updated_date === undefined) out.updated_date = out.updated_at;
  return out;
}

function normalizeList(data) {
  if (Array.isArray(data)) return data.map(normalizeRecord);
  return normalizeRecord(data);
}

async function request(method, urlPath, { params, body } = {}) {
  const token = tokenStore.get();
  const url = new URL(REAB_BASE + urlPath);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(String(k), String(v));
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // On 401, attempt one token refresh then retry
  if (res.status === 401) {
    const newToken = await reabRefreshToken();
    if (newToken) {
      const retryRes = await fetch(url.toString(), {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (retryRes.ok) return retryRes.json();
    }
    const err = new Error(`REAB API 401 (no token or refresh failed)`);
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`REAB API ${method} ${urlPath} → ${res.status}: ${text}`);
    err.status = res.status;
    try { err.body = JSON.parse(text); err.code = err.body?.error?.code; } catch { /* cuerpo no JSON */ }
    throw err;
  }

  // Respuestas sin cuerpo (p. ej. 204 en un DELETE) no son JSON
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export { request as reabRequest };

// fetch con el Bearer de REAB y un único refresco del token ante un 401 (para PDF y otras respuestas que no son JSON)
export async function reabAuthedFetch(urlPath, init = {}) {
  const call = (token) => fetch(REAB_BASE + urlPath, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let res = await call(tokenStore.get());
  if (res.status === 401) {
    const fresh = await reabRefreshToken();
    if (fresh) res = await call(fresh);
  }
  return res;
}

// Stock actual por (almacén, código) desde la tabla de ofertas: GET /offers?proveedor_in=…&codigo_in=…
// Devuelve Map("<almacén>|<código>" → { existencia, tienda }).
export async function fetchOfferStockByCodes(proveedores, codigos) {
  const out = new Map();
  if (!proveedores.length || !codigos.length) return out;

  const PAGE = 200;
  const chunkSize = Math.max(1, Math.floor(PAGE / proveedores.length));
  const chunks = [];
  for (let i = 0; i < codigos.length; i += chunkSize) chunks.push(codigos.slice(i, i + chunkSize));

  for (let i = 0; i < chunks.length; i += 6) {
    await Promise.all(chunks.slice(i, i + 6).map(async (chunk) => {
      const res = await request('GET', '/offers', {
        params: {
          codigo_in: chunk.join(','),
          proveedor_in: proveedores.join(','),
          fields: 'codigo,proveedor,existencia_fisica,stock_tienda',
          pageSize: PAGE,
          count: 'none',
        },
      });
      for (const o of res.data ?? []) {
        out.set(`${o.proveedor}|${o.codigo}`, { existencia: o.existencia_fisica, tienda: o.stock_tienda });
      }
    }));
  }
  return out;
}

// Producto del maestro de la API por código exacto → { codigo, nombre } | null
export async function fetchReabProductByCode(codigo) {
  const res = await request('GET', '/products', {
    params: { codigo, fields: 'codigo,nombre', pageSize: 1, count: 'none' },
  });
  const p = res.data?.[0];
  return p ? { codigo: String(p.codigo).trim(), nombre: p.nombre ?? '' } : null;
}

// Busca en el maestro de productos (REAB) los códigos que terminan en `suffix` (CodInicial).
export async function fetchReabProductsByCodeSuffix(suffix) {
  const res = await request('GET', '/products', {
    params: { codigo_like: suffix, fields: 'codigo,nombre', pageSize: 100, count: 'none' },
  });
  const found = new Map();
  for (const p of res.data ?? []) {
    const codigo = String(p.codigo ?? '').trim();
    if (codigo.endsWith(suffix) && !found.has(codigo)) found.set(codigo, { codigo, nombre: p.nombre ?? '' });
  }
  return [...found.values()];
}

// Recursos que tienen POST /bulk en la API (el resto no lo tiene)
const BULK_PATHS = new Set(['/product-aliases', '/bodegon-product-origin']);
const CREATE_CONCURRENCY = 6;

// El esquema de pedidos es estricto (422 con "Unrecognized keys"): estado y totales los calcula el servidor
const PO_SERVER_FIELDS = ['status', 'total_amount', 'total_amount_base', 'confirmed_at', 'confirmed_by'];
const PO_ITEM_CREATE_FIELDS = [
  'purchase_order_id', 'offer_item_id', 'internal_offer_id', 'internal_product_code', 'product_name',
  'supplier_product_name', 'unit', 'unit_cost', 'currency', 'min_qty', 'pack_multiple', 'current_stock',
  'suggested_qty', 'final_qty', 'override_reason', 'status', 'supplier_product_code', 'internal_product_id',
  'is_new_product', 'acceptance_status',
];
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));

/** Tras cargar las líneas: recalcula totales del pedido y, si se indica, lo pasa al estado dado. */
export async function finalizePurchaseOrder(id, status) {
  await request('POST', `/purchase-orders/${id}/recalculate`);
  if (status && status !== 'borrador') await request('POST', `/purchase-orders/${id}/transition`, { body: { status } });
}

// Reintenta una vez si el servidor pide esperar (429) o está momentáneamente saturado (502/503/504)
export async function requestWithRetry(method, urlPath, opts) {
  try {
    return await request(method, urlPath, opts);
  } catch (err) {
    if ([429, 502, 503, 504].includes(err.status)) {
      await new Promise(r => setTimeout(r, 800));
      return request(method, urlPath, opts);
    }
    throw err;
  }
}

export function createReabEntityAdapter(entityName) {
  const path = REAB_PATH_MAP[entityName];
  if (!path) throw new Error(`Unknown REAB entity: ${entityName}`);

  return {
    async list(orderBy, limit = 1000, offset = 0) {
      const { column, ascending } = parseOrderBy(orderBy);
      const clampedLimit = Math.min(limit, MAX_PAGE_SIZE);
      const page = Math.floor(offset / Math.max(clampedLimit, 1)) + 1;
      const res = await request('GET', path, {
        params: {
          page,
          pageSize: clampedLimit,
          sortBy: column,
          sortOrder: ascending ? 'asc' : 'desc',
        },
      });
      return normalizeList(res.data ?? []);
    },

    async filter(conditions = {}, orderBy, limit = 1000) {
      const { column, ascending } = parseOrderBy(orderBy);
      const params = { pageSize: Math.min(limit, MAX_PAGE_SIZE), sortBy: column, sortOrder: ascending ? 'asc' : 'desc' };

      for (const [key, value] of Object.entries(conditions)) {
        if (value === null || value === undefined) continue;
        const col = resolveColumn(key);
        if (Array.isArray(value)) params[`${col}_in`] = value.join(',');
        else params[col] = value;
      }

      const res = await request('GET', path, { params });
      return normalizeList(res.data ?? []);
    },

    async create(payload) {
      if (path === '/purchase-orders') payload = omit(payload, PO_SERVER_FIELDS);
      else if (path === '/purchase-order-items') payload = pick(payload, PO_ITEM_CREATE_FIELDS);
      const res = await request('POST', path, { body: payload });
      return normalizeRecord(res.data ?? res);
    },

    async update(id, payload) {
      if (path === '/purchase-orders') {
        // El estado y los totales ya no se escriben con PATCH: van por /transition y /recalculate
        // (confirmed_at/confirmed_by los registra el servidor al confirmar)
        const { status, total_amount, total_amount_base, confirmed_at, confirmed_by, ...rest } = payload;
        let res = null;
        if (Object.keys(rest).length) res = await request('PATCH', `${path}/${id}`, { body: rest });
        if (status) res = await request('POST', `${path}/${id}/transition`, { body: { status } });
        else if (total_amount !== undefined || total_amount_base !== undefined) res = await request('POST', `${path}/${id}/recalculate`);
        return normalizeRecord(res?.data?.order ?? res?.data ?? res);
      }
      const res = await request('PATCH', `${path}/${id}`, { body: payload });
      return normalizeRecord(res.data ?? res);
    },

    async delete(id) {
      await request('DELETE', `${path}/${id}`);
    },

    async bulkCreate(items) {
      if (!items?.length) return [];
      if (path === '/purchase-order-items') items = items.map(it => pick(it, PO_ITEM_CREATE_FIELDS));
      if (BULK_PATHS.has(path)) {
        const res = await request('POST', `${path}/bulk`, { body: items });
        return normalizeList(res.data ?? []);
      }
      // Sin endpoint masivo: una petición por registro, con concurrencia limitada
      const created = new Array(items.length);
      let next = 0, firstError = null;
      const worker = async () => {
        while (next < items.length && !firstError) {
          const i = next++;
          try {
            const res = await requestWithRetry('POST', path, { body: items[i] });
            created[i] = normalizeRecord(res.data ?? res);
          } catch (err) {
            firstError = firstError ?? err;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CREATE_CONCURRENCY, items.length) }, worker));
      if (firstError) throw firstError;
      return created;
    },

    async bulkUpsert(items) {
      // REAB API doesn't expose bulk-upsert — delegate to bulkCreate
      return this.bulkCreate(items);
    },

    async filterPaginated(conditions = {}, options = {}) {
      const { search, extraFilters = [], orderBy, limit = 50, offset = 0 } = options;
      const { column, ascending } = parseOrderBy(orderBy);
      const page = Math.floor(offset / Math.max(limit, 1)) + 1;

      const params = { page, pageSize: Math.min(limit, MAX_PAGE_SIZE), sortBy: column, sortOrder: ascending ? 'asc' : 'desc' };

      if (search?.text?.trim()) {
        // REAB API uses campo_like syntax; if search covers multiple columns use the first one
        const text = search.text.trim();
        const cols = search.columns ?? [];
        if (cols.length === 1) {
          params[`${resolveColumn(cols[0])}_like`] = text;
        } else if (cols.length > 1) {
          params['q'] = text;
        }
      }

      for (const [key, value] of Object.entries(conditions)) {
        if (value === null || value === undefined) continue;
        const col = resolveColumn(key);
        if (Array.isArray(value)) params[`${col}_in`] = value.join(',');
        else params[col] = value;
      }

      for (const f of extraFilters) {
        const col = resolveColumn(f.column);
        if (f.type === 'gte' || f.type === 'gt')  params[`${col}_min`] = f.value;
        if (f.type === 'lte' || f.type === 'lt')  params[`${col}_max`] = f.value;
      }

      const res = await request('GET', path, { params });
      return {
        data:  normalizeList(res.data ?? []),
        total: res.pagination?.totalItems ?? (res.data?.length ?? 0),
      };
    },

    async selectDistinct(column) {
      // Paginate through all pages and compute distinct client-side
      const col = resolveColumn(column);
      const seen = new Set();
      let page = 1;
      while (true) {
        const res = await request('GET', path, { params: { page, pageSize: MAX_PAGE_SIZE } });
        const batch = res.data ?? [];
        for (const r of batch) {
          const v = r[col];
          if (v !== null && v !== undefined && v !== '') seen.add(v);
        }
        if (!res.pagination?.hasNextPage || !batch.length) break;
        page++;
      }
      return [...seen].sort();
    },
  };
}

// Origen de cada producto de un bodegón: GET /bodegon-product-origin?bodegon_id=1053
// Registro: { bodegon_id, product_code, origin_store_id, origin_type }
export async function fetchBodegonProductOrigins(bodegonId) {
  const getPage = (page) => request('GET', '/bodegon-product-origin', {
    params: { page, pageSize: MAX_PAGE_SIZE, bodegon_id: bodegonId },
  });

  const first = await getPage(1);
  const rest  = await fetchPagesParallel(first.pagination?.totalPages ?? 1, getPage);
  return [first, ...rest].flatMap(res => (res.data ?? []).map(normalizeRecord));
}

// Fetch ALL replenishment proposals across all pages
export async function fetchAllReplenishmentProposals() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await request('GET', '/replenishment-proposals', {
      params: { page, pageSize: MAX_PAGE_SIZE, sortBy: 'created_at', sortOrder: 'desc', count: 'none' },
    });
    const batch = res.data ?? [];
    all.push(...batch.map(normalizeRecord));
    if (!res.pagination?.hasNextPage || !batch.length) break;
    page++;
  }
  return all;
}

// Login helper — call once after Supabase login succeeds
export async function reabLogin(email, password) {
  const res = await fetch(`${REAB_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, system_slug: 'reabastecimiento', remember_me: false }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[REAB] login failed', res.status, text);
    throw new Error(`REAB login failed ${res.status}: ${text}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  const token = json.data?.tokens?.access_token ?? json.data?.token ?? json.token;
  if (token) { tokenStore.set(token); }
  else console.warn('[REAB] no token found in response', Object.keys(json));
  return token;
}

// Refresh helper — call when a request returns 401
export async function reabRefreshToken() {
  const currentToken = tokenStore.get();
  if (!currentToken) return null;
  try {
    const res = await fetch(`${REAB_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`,
      },
    });
    if (!res.ok) { tokenStore.clear(); return null; }
    const json = await res.json();
    const token = json.data?.tokens?.access_token ?? json.data?.token;
    if (token) tokenStore.set(token);
    return token;
  } catch {
    return null;
  }
}
