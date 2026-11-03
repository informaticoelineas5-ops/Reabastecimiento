import { tokenStore } from './tokenStore';

const REAB_BASE = 'https://apireab.mercadoelineas.com/api/v1';

export const SELECTABLE_INDICES = [
  // ── Ventas (columnas de mv_rdp_ind_general_diario_v2) ───────────────────────
  { key: 'prom_ventas_diario_top_max_2',   label: 'Prom. Diario ≥ max/2',       short: 'P.≥½',   group: 'Ventas' },
  { key: 'prom_ventas_diario_mayor_0',     label: 'Prom. Diario > 0 (100%)',    short: 'P.>0',   group: 'Ventas' },
  { key: 'prom_ventas_diario_todos',       label: 'Prom. Diario Todos',         short: 'P.Tod',  group: 'Ventas' },
  { key: 'prom_ventas_diario_no_festivas', label: 'Prom. Diario No Festivas',   short: 'P.NoF',  group: 'Ventas' },
  { key: 'prom_ventas_diario_festivas',    label: 'Prom. Diario Festivas',      short: 'P.Fest', group: 'Ventas' },
  { key: 'prom_ventas_diario_nom_dic',     label: 'Prom. Diario Nov+Dic',       short: 'P.NDic', group: 'Ventas' },
  { key: 'prom_ventas_diario_14_feb',      label: 'Prom. Diario 14 Feb',        short: 'P.Feb',  group: 'Ventas' },
  { key: 'prom_ventas_diario_madres',      label: 'Prom. Diario Madres',        short: 'P.Mad',  group: 'Ventas' },
  { key: 'prom_ventas_diario_ult_7_dias',  label: 'Prom. Diario Últ. 7 días',   short: 'P.7d',   group: 'Ventas' },
  { key: 'prom_ventas_diario_ult_15_dias', label: 'Prom. Diario Últ. 15 días',  short: 'P.15d',  group: 'Ventas' },
  { key: 'prom_ventas_diario_ult_1_mes',   label: 'Prom. Diario Últ. 1 mes',   short: 'P.1m',   group: 'Ventas' },
  { key: 'prom_ventas_diario_ult_3_mes',   label: 'Prom. Diario Últ. 3 meses', short: 'P.3m',   group: 'Ventas' },
  { key: 'prom_ventas_diario_ult_6_mes',   label: 'Prom. Diario Últ. 6 meses', short: 'P.6m',   group: 'Ventas' },
];

export const DEFAULT_SELECTED_INDICES = [
  'prom_ventas_diario_top_max_2',
  'prom_ventas_diario_mayor_0',
  'prom_ventas_diario_ult_1_mes',
];

export async function getUserPreferences() {
  const token = tokenStore.get();
  if (!token) return null;
  try {
    const res = await fetch(`${REAB_BASE}/auth/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function saveUserPreferences({ almacen, almacenes = [], suministradores = [], selected_indices = [] }) {
  const token = tokenStore.get();
  if (!token) return;
  await fetch(`${REAB_BASE}/auth/me/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      almacen: almacenes[0] ?? almacen ?? null,
      almacenes,
      suministradores,
      selected_indices,
    }),
  });
}
