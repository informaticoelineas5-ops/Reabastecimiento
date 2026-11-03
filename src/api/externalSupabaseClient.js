import {
  fetchApGlobalIndex as _fetchApGlobalIndex,
  fetchApGlobalEstadoForAlmacenesStream as _fetchApGlobalEstadoStream,
  fetchElineasWarehouses,
  fetchApLatestByProveedorStream,
  fetchProductInBodegones,
  searchProductsByCodeSuffix as searchElineasProductsByCodeSuffix,
  fetchElineasProductByCode,
  fetchProductsPaginated,
  fetchProductsAll,
  fetchApLatestByIdOnlines as _fetchApLatestByIdOnlines,
  fetchApLatestSuministradores,
  fetchApLatestSuministradoresMulti,
  fetchApLatestByIdOnline,
  searchElineasLiveProducts,
} from './elineasApiClient';
import { fetchReabProductsByCodeSuffix, fetchReabProductByCode } from './reabApiClient';

export async function fetchAllExtCatalog(conditions, options) {
  return fetchProductsAll(conditions, options);
}

// ── ap-global (delegated to Elineas API) ───────────────────────────────────

export async function fetchApGlobalIndex() {
  return _fetchApGlobalIndex();
}

export async function fetchApGlobalEstadoForAlmacenesStream(almacenes, onChunk) {
  return _fetchApGlobalEstadoStream(almacenes, onChunk);
}

// ── Warehouses ──────────────────────────────────────────────────────────────
// Target: Elineas API /api/warehouses
// Currently blocked: 403 "Rol insuficiente" — backend must grant access
export async function fetchAlmacenes() {
  try {
    const warehouses = await fetchElineasWarehouses();
    return warehouses
      .map(w => {
        // proveedor field = exact string used in ap-latest — highest priority
        if (w.proveedor) return w.proveedor;
        // name only — do NOT append (key) because ap-latest proveedor won't include it
        return w.name ?? w.warehouseName ?? w.nombre ?? w.almacen
          ?? (w.key ?? w.id ? String(w.key ?? w.id) : null);
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nA = parseInt(a.match(/\((\d+)\)/)?.[1] ?? a);
        const nB = parseInt(b.match(/\((\d+)\)/)?.[1] ?? b);
        return !isNaN(nA) && !isNaN(nB) ? nA - nB : a.localeCompare(b);
      });
  } catch {
    return [];
  }
}

// ── Products (catalog) — target: Elineas API /reports/ap-latest ────────────
// Currently blocked: 403 "Rol insuficiente" — backend must grant access

export async function fetchExtProductByIdOnline(idOnline) {
  if (!idOnline) return null;
  return fetchApLatestByIdOnline(idOnline);
}

export async function fetchExtProductById(_id) {
  return null;
}

export async function fetchExtSuministradores(almacen) {
  return fetchApLatestSuministradores(almacen);
}

export async function fetchExtSuministradoresMulti(almacenes) {
  return fetchApLatestSuministradoresMulti(almacenes);
}

export async function fetchExtCatalogPaginated(conditions = {}, options = {}) {
  return fetchProductsPaginated(conditions, options);
}

export async function fetchProductsForAlmacen(almacen) {
  if (!almacen) return new Map();
  return fetchApLatestByProveedorStream(almacen, null);
}

export async function fetchProductsForAlmacenStream(almacen, onChunk) {
  if (!almacen) { onChunk?.(new Map()); return new Map(); }
  return fetchApLatestByProveedorStream(almacen, onChunk);
}

export async function fetchProductsByIdOnlines(idOnlines) {
  return _fetchApLatestByIdOnlines(idOnlines);
}

export async function searchCatalogProducts(text, limit = 10) {
  return searchElineasLiveProducts(text, limit);
}

export { fetchProductInBodegones };

// ¿Existe este código en el catálogo? Maestro de la API primero, catálogo de Elineas después.
// Devuelve { codigo, nombre } o null si no existe. Lanza error si no se pudo verificar.
export async function findProductByCode(codigo) {
  try {
    const own = await fetchReabProductByCode(codigo);
    if (own) return own;
  } catch (err) {
    console.warn('[código] maestro de productos no disponible:', err.message);
  }
  return fetchElineasProductByCode(codigo); // si esta también falla, el error sube: no se puede verificar
}

// CodInicial: busca primero en el maestro de productos de la API (filtro codigo_like);
// si no hay coincidencias, prueba con el catálogo de Elineas.
export async function searchProductsByCodeSuffix(suffix) {
  try {
    const own = await fetchReabProductsByCodeSuffix(suffix);
    if (own.length) return own;
  } catch (err) {
    console.warn('[preCod] maestro de productos no disponible, se usa el catálogo de Elineas:', err.message);
  }
  return searchElineasProductsByCodeSuffix(suffix);
}

// ── DataImport (invGlobal view) — pendiente de migración ───────────────────
// Sigue en Supabase externo hasta que se migre processInventory al REAB API.

const BASE_URL = import.meta.env.VITE_EXT_SUPABASE_URL;
const API_KEY  = import.meta.env.VITE_EXT_SUPABASE_ANON_KEY;

function extHeaders(extra = {}) {
  return {
    apikey:        API_KEY,
    Authorization: `Bearer ${API_KEY}`,
    ...extra,
  };
}

const PAGE_SIZE = 1000;

function parseTotalFromContentRange(res) {
  const cr = res.headers.get('Content-Range');
  if (!cr) return null;
  const m = cr.match(/\d+-\d+\/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

async function fetchAllPages(url, onProgress) {
  let from    = 0;
  let total   = null;
  const results = [];

  while (true) {
    const to  = from + PAGE_SIZE - 1;
    const res = await fetch(url, {
      headers: {
        ...extHeaders(),
        Range:        `${from}-${to}`,
        'Range-Unit': 'items',
        Prefer:       'count=exact',
      },
    });

    if (res.status === 416) break;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error ${res.status}: ${text}`);
    }

    const page = await res.json();
    if (!page.length) break;

    results.push(...page);
    if (total === null) total = parseTotalFromContentRange(res);
    if (onProgress) onProgress(results.length, total);
    from += page.length;
  }

  return results;
}

export async function fetchExternalWarehouses(viewName) {
  if (!BASE_URL || !API_KEY) return [];
  const col  = encodeURIComponent('"No. Almacén"');
  const url  = `${BASE_URL}/rest/v1/${viewName}?select=${col}`;
  const rows = await fetchAllPages(url, null);

  const seen = new Set(
    rows.map((r) => r['No. Almacén']).filter((v) => v != null).map(String)
  );

  return [...seen].sort((a, b) => {
    const nA = parseInt(a), nB = parseInt(b);
    return !isNaN(nA) && !isNaN(nB) ? nA - nB : String(a).localeCompare(String(b));
  });
}

export async function fetchExternalTable(viewName, onProgress, warehouses = null) {
  if (!BASE_URL || !API_KEY) return [];
  let filterParam = '';
  if (warehouses?.length) {
    const col  = encodeURIComponent('"No. Almacén"');
    const vals = warehouses.join(',');
    filterParam = `&${col}=in.(${vals})`;
  }

  const url = `${BASE_URL}/rest/v1/${viewName}?select=*${filterParam}`;
  return fetchAllPages(url, onProgress);
}
