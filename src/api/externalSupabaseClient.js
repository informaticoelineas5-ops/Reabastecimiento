const BASE_URL = import.meta.env.VITE_EXT_SUPABASE_URL;
const API_KEY  = import.meta.env.VITE_EXT_SUPABASE_ANON_KEY;

function extHeaders(extra = {}) {
  return {
    apikey:        API_KEY,
    Authorization: `Bearer ${API_KEY}`,
    ...extra,
  };
}

function buildPostgrestUrl(table, params) {
  const base = `${BASE_URL?.trim()}/rest/v1/${table}`;
  const qs   = params.length ? `?${params.join('&')}` : '';
  return base + qs;
}

// Codifica un valor para usarlo dentro de un filtro in.() de PostgREST.
// Envuelve en comillas dobles (URL-encoded) para que PostgREST maneje
// correctamente valores con paréntesis, comas u otros caracteres especiales.
function pgrestInValue(v) {
  const encoded = encodeURIComponent(String(v))
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
  return `%22${encoded}%22`;
}

/**
 * Devuelve la lista ordenada de almacenes (valores únicos de `proveedor` en products).
 */
export async function fetchAlmacenes() {
  if (!BASE_URL || !API_KEY) return [];
  const url = buildPostgrestUrl('products', ['select=proveedor', 'limit=60000']);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) throw new Error(`fetchAlmacenes: HTTP ${res.status}`);
  const data = await res.json();
  const unique = [...new Set(data.map(r => r.proveedor).filter(Boolean))];
  return unique.sort((a, b) => {
    const nA = parseInt(a.match(/\((\d+)\)/)?.[1] ?? '');
    const nB = parseInt(b.match(/\((\d+)\)/)?.[1] ?? '');
    return !isNaN(nA) && !isNaN(nB) ? nA - nB : a.localeCompare(b);
  });
}

/**
 * Devuelve un producto por su UUID (id primario de la tabla products en ELINEAS_DB).
 */
export async function fetchExtProductById(id) {
  if (!BASE_URL || !API_KEY || !id) return null;
  const url = buildPostgrestUrl('products', [
    'select=*,fotos(foto)',
    `id=eq.${id}`,
    'limit=1',
  ]);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) throw new Error(`fetchExtProductById: HTTP ${res.status}`);
  const data = await res.json();
  return data[0] ?? null;
}

/**
 * Devuelve un producto por su id_online (ID de la tienda online / marketplace).
 * Usado cuando el enlace viene desde Alertas (que usa offer_external_id del REAB).
 */
export async function fetchExtProductByIdOnline(idOnline) {
  if (!BASE_URL || !API_KEY || !idOnline) return null;
  const url = buildPostgrestUrl('products', [
    'select=*,fotos(foto)',
    `id_online=eq.${encodeURIComponent(idOnline)}`,
    'limit=1',
  ]);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) throw new Error(`fetchExtProductByIdOnline: HTTP ${res.status}`);
  const data = await res.json();
  return data[0] ?? null;
}

/**
 * Valores únicos de `suministrador` para un almacén dado.
 */
export async function fetchExtSuministradores(almacen) {
  if (!BASE_URL || !API_KEY || !almacen) return [];
  const params = [
    'select=suministrador',
    `proveedor=eq.${encodeURIComponent(almacen)}`,
    'limit=60000',
  ];
  const url = buildPostgrestUrl('products', params);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) throw new Error(`fetchExtSuministradores: HTTP ${res.status}`);
  const data = await res.json();
  return [...new Set(data.map(r => r.suministrador).filter(Boolean))].sort();
}

/**
 * Valores únicos de `suministrador` para múltiples almacenes a la vez.
 */
export async function fetchExtSuministradoresMulti(almacenes) {
  if (!BASE_URL || !API_KEY || !almacenes?.length) return [];
  const vals = almacenes.map(pgrestInValue).join(',');
  const url = buildPostgrestUrl('products', [
    'select=suministrador',
    `proveedor=in.(${vals})`,
    'limit=60000',
  ]);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) throw new Error(`fetchExtSuministradoresMulti: HTTP ${res.status}`);
  const data = await res.json();
  return [...new Set(data.map(r => r.suministrador).filter(Boolean))].sort();
}

/**
 * Consulta paginada con filtros y búsqueda en la tabla `products` del Supabase externo.
 * Devuelve { data: [], total: number }.
 */
export async function fetchExtCatalogPaginated(conditions = {}, options = {}) {
  if (!BASE_URL || !API_KEY) return { data: [], total: 0 };

  const { search, extraFilters = [], orderBy, limit = 50, offset = 0 } = options;

  const params = ['select=*,fotos(foto)'];

  // Búsqueda de texto (OR entre columnas)
  if (search?.text?.trim()) {
    const t     = search.text.trim();
    const parts = (search.columns ?? []).map(c => `${c}.ilike.${encodeURIComponent(`%${t}%`)}`);
    if (parts.length) params.push(`or=(${parts.join(',')})`);
  }

  // Condiciones de igualdad
  for (const [key, value] of Object.entries(conditions)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      params.push(`${key}=in.(${value.map(pgrestInValue).join(',')})`);
    } else {
      params.push(`${key}=eq.${encodeURIComponent(String(value))}`);
    }
  }

  // Filtros extra (gt, lte, etc.)
  for (const f of extraFilters) {
    params.push(`${f.column}=${f.type}.${f.value}`);
  }

  // Ordenación
  if (orderBy) {
    const asc = !orderBy.startsWith('-');
    const col = asc ? orderBy : orderBy.slice(1);
    params.push(`order=${col}.${asc ? 'asc' : 'desc'}`);
  }

  const url = buildPostgrestUrl('products', params);
  const res = await fetch(url, {
    headers: extHeaders({
      Prefer:       'count=exact',
      Range:        `${offset}-${offset + limit - 1}`,
      'Range-Unit': 'items',
    }),
  });

  if (res.status === 416) return { data: [], total: 0 };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchExtCatalogPaginated: HTTP ${res.status}: ${text}`);
  }

  const data  = await res.json();
  const cr    = res.headers.get('Content-Range');
  const total = cr ? parseInt(cr.match(/\/(\d+)/)?.[1] ?? '0') : 0;
  return { data: data ?? [], total };
}

// Tamaño de página ajustado al límite del servidor externo
const PAGE_SIZE = 500;

const HEADERS = {
  apikey:         API_KEY,
  Authorization:  `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * Extrae el total real del header Content-Range (solo para mostrar progreso).
 * Devuelve null si no se puede leer.
 */
function parseTotalFromContentRange(res) {
  const cr = res.headers.get('Content-Range');
  if (!cr) return null;
  const m = cr.match(/\d+-\d+\/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Paginación robusta que funciona independientemente del max_rows del servidor.
 *
 * Regla de parada: el servidor devuelve 0 filas o responde 416.
 * NO usa el total del Content-Range para decidir si hay más datos,
 * porque algunos servidores reportan mal ese valor.
 * Avanza `from += page.length` para adaptarse al límite real del servidor.
 */
async function fetchAllPages(url, onProgress) {
  let from    = 0;
  let total   = null; // solo para mostrar progreso, no para parar
  const results = [];

  while (true) {
    const to  = from + PAGE_SIZE - 1;

    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        Range:        `${from}-${to}`,
        'Range-Unit': 'items',
        Prefer:       'count=exact',
      },
    });

    // 416 = rango fuera de límite → no hay más datos
    if (res.status === 416) break;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error ${res.status}: ${text}`);
    }

    const page = await res.json();

    // Página vacía → fin
    if (!page.length) break;

    results.push(...page);

    // Leer total para mostrar progreso (no para parar)
    if (total === null) total = parseTotalFromContentRange(res);
    if (onProgress) onProgress(results.length, total);

    // Avanzar por el número de filas REALMENTE recibidas,
    // no por PAGE_SIZE (el servidor puede tener max_rows menor)
    from += page.length;
  }

  return results;
}

/**
 * Obtiene los valores únicos de "No. Almacén" del view externo.
 * Pagina por todas las filas aunque el servidor tenga max_rows < PAGE_SIZE.
 */
export async function fetchExternalWarehouses(viewName) {
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

/**
 * Obtiene "Id Tienda" + "Estado Anuncio" desde la vista apGlobalV2.
 * Devuelve { map: Map<string, string> } donde la clave es String(Id Tienda).
 */
export async function fetchApGlobalIndex() {
  if (!BASE_URL || !API_KEY) {
    console.warn('[apGlobalV2] Faltan variables de entorno EXT_SUPABASE_URL / EXT_SUPABASE_ANON_KEY');
    return { map: new Map() };
  }

  const id    = encodeURIComponent('"Id Tienda"');
  const est   = encodeURIComponent('"Estado Anuncio"');
  const order = encodeURIComponent('"Id Tienda"') + '.asc';
  const url   = `${BASE_URL}/rest/v1/apGlobalV2?select=${id},${est}&order=${order}`;
  console.log('[apGlobalV2] Fetching:', url);

  let rows;
  try {
    rows = await fetchAllPages(url, null);
  } catch (err) {
    console.error('[apGlobalV2] Error al cargar la vista:', err.message);
    return { map: new Map() };
  }

  console.log(`[apGlobalV2] Filas recibidas: ${rows.length}`);
  if (rows.length > 0) console.log('[apGlobalV2] Primera fila (para verificar claves):', rows[0]);

  const map = new Map();
  for (const r of rows) {
    const tid = r['Id Tienda'];
    if (tid == null) continue;
    const estado = r['Estado Anuncio'] || null;
    const key = String(tid);
    // Un estado válido no se sobreescribe con uno vacío (la vista tiene filas duplicadas por variantes)
    if (estado || !map.has(key)) {
      map.set(key, estado);
    }
  }

  console.log(`[apGlobalV2] Filas: ${rows.length} → IDs únicos: ${map.size}`);
  return { map };
}

/**
 * Obtiene TODAS las filas de una vista del API externo.
 * Soporta filtro opcional por "No. Almacén".
 *
 * @param {string}    viewName
 * @param {Function}  [onProgress]  (fetched, total|null) => void
 * @param {string[]}  [warehouses]  si se da, filtra por esos almacenes
 */
export async function fetchExternalTable(viewName, onProgress, warehouses = null) {
  let filterParam = '';
  if (warehouses?.length) {
    const col  = encodeURIComponent('"No. Almacén"');
    const vals = warehouses.join(',');
    filterParam = `&${col}=in.(${vals})`;
  }

  const url = `${BASE_URL}/rest/v1/${viewName}?select=*${filterParam}`;
  return fetchAllPages(url, onProgress);
}

/**
 * Obtiene productos específicos por sus id_online (para ProposalTable — sin filtro de almacén).
 */
export async function fetchProductsByIdOnlines(idOnlines) {
  if (!BASE_URL || !API_KEY || !idOnlines?.length) return [];
  const numericIds = idOnlines.map(v => parseInt(String(v))).filter(v => !isNaN(v));
  if (!numericIds.length) return [];
  const url = buildPostgrestUrl('products', [
    'select=id_online,nombre,codigo,proveedor,suministrador,cantidad,precio',
    `id_online=in.(${numericIds.join(',')})`,
  ]);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Búsqueda de productos en todo el catálogo de ELINEAS_DB (sin filtro de almacén).
 * Usado en ProductMatcher para que el comercial pueda asociar con cualquier producto.
 */
export async function searchCatalogProducts(text, limit = 10) {
  if (!BASE_URL || !API_KEY || !text?.trim() || text.trim().length < 2) return [];
  const escaped = encodeURIComponent(`%${text.trim()}%`);
  const url = buildPostgrestUrl('products', [
    'select=id_online,nombre,codigo,proveedor,suministrador,cantidad',
    `or=(nombre.ilike.${escaped},codigo.ilike.${escaped})`,
    `limit=${limit}`,
    'order=nombre.asc',
  ]);
  const res = await fetch(url, { headers: extHeaders() });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Devuelve todos los productos de un almacén desde ELINEAS_DB.
 * Solo los campos necesarios para el Ranking de Ventas.
 * Devuelve Map<String(id_online), product>.
 */
export async function fetchProductsForAlmacen(almacen) {
  if (!BASE_URL || !API_KEY || !almacen) return new Map();
  const cols = 'id_online,nombre,codigo,proveedor,categoria_online,suministrador,cantidad,reserved_qty';
  const url  = `${BASE_URL}/rest/v1/products?select=${cols}&proveedor=eq.${encodeURIComponent(almacen)}&order=id_online.asc`;
  const rows = await fetchAllPages(url, null);
  const map  = new Map();
  for (const r of rows) {
    if (r.id_online != null) map.set(String(r.id_online), r);
  }
  return map;
}
