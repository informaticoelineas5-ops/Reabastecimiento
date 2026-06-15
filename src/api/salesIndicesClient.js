const BASE_URL = import.meta.env.VITE_EXT_SUPABASE_URL?.trim();
const API_KEY  = import.meta.env.VITE_EXT_SUPABASE_ANON_KEY?.trim();

const PAGE_SIZE = 500;

const INDEX_KEYS = [
  'prom_ventas_diario_top_max_2',
  'prom_ventas_diario_mayor_0',
  'prom_ventas_diario_todos',
  'prom_ventas_diario_no_festivas',
  'prom_ventas_diario_festivas',
  'prom_ventas_diario_nom_dic',
  'prom_ventas_diario_14_feb',
  'prom_ventas_diario_madres',
  'prom_ventas_diario_ult_1_mes',
  'prom_ventas_diario_ult_3_mes',
  'prom_ventas_diario_ult_6_mes',
];

function calcCategoria(indice) {
  if (indice == null) return null;
  if (indice >= 1.0) return 'A';
  if (indice >= 0.6) return 'B';
  if (indice >= 0.2) return 'C';
  return 'D';
}

async function fetchAllPages(url) {
  let from = 0;
  const results = [];
  const headers = { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` };
  while (true) {
    const to  = from + PAGE_SIZE - 1;
    const res = await fetch(url, {
      headers: { ...headers, Range: `${from}-${to}`, 'Range-Unit': 'items' },
    });
    if (res.status === 416) break;
    if (!res.ok) throw new Error(`fetchSalesIndices: HTTP ${res.status}`);
    const page = await res.json();
    if (!page.length) break;
    results.push(...page);
    from += page.length;
  }
  return results;
}

export async function fetchSalesIndices() {
  if (!BASE_URL || !API_KEY) return new Map();
  const cols = ['id_tienda', ...INDEX_KEYS].join(',');
  const url  = `${BASE_URL}/rest/v1/mv_rdp_ind_general_diario?select=${cols}&order=id_tienda.asc`;
  const rows = await fetchAllPages(url);
  const map  = new Map();
  for (const r of rows) {
    const id = r.id_tienda;
    if (id == null) continue;
    const pv = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const indices = {};
    for (const key of INDEX_KEYS) indices[key] = pv(r[key]);
    const p1 = indices.prom_ventas_diario_top_max_2;
    const p2 = indices.prom_ventas_diario_mayor_0;
    const p3 = indices.prom_ventas_diario_ult_1_mes;
    const indiceAvg = (p1 != null && p2 != null && p3 != null) ? (p1 + p2 + p3) / 3 : null;
    map.set(String(id), {
      ...indices,
      promedioMaxDiv2: indices.prom_ventas_diario_top_max_2,
      promedioPos:     indices.prom_ventas_diario_mayor_0,
      promedioUlt1mes: indices.prom_ventas_diario_ult_1_mes,
      indiceAvg,
      categoriaVentas: calcCategoria(indiceAvg),
    });
  }
  return map;
}
