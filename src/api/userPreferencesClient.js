import { supabase } from './supabaseClient';

export const SELECTABLE_INDICES = [
  { key: 'prom_ventas_diario_top_max_2',   label: 'Prom. Diario ≥ max/2',      short: 'P.≥½'   },
  { key: 'prom_ventas_diario_mayor_0',     label: 'Prom. Diario > 0 (100%)',    short: 'P.>0'   },
  { key: 'prom_ventas_diario_todos',       label: 'Prom. Diario Todos',         short: 'P.Tod'  },
  { key: 'prom_ventas_diario_no_festivas', label: 'Prom. Diario No Festivas',   short: 'P.NoF'  },
  { key: 'prom_ventas_diario_festivas',    label: 'Prom. Diario Festivas',      short: 'P.Fest' },
  { key: 'prom_ventas_diario_nom_dic',     label: 'Prom. Diario Nov+Dic',       short: 'P.NDic' },
  { key: 'prom_ventas_diario_14_feb',      label: 'Prom. Diario 14 Feb',        short: 'P.Feb'  },
  { key: 'prom_ventas_diario_madres',      label: 'Prom. Diario Madres',        short: 'P.Mad'  },
  { key: 'prom_ventas_diario_ult_1_mes',   label: 'Prom. Diario Últ. 1 mes',   short: 'P.1m'   },
  { key: 'prom_ventas_diario_ult_3_mes',   label: 'Prom. Diario Últ. 3 meses', short: 'P.3m'   },
  { key: 'prom_ventas_diario_ult_6_mes',   label: 'Prom. Diario Últ. 6 meses', short: 'P.6m'   },
];

export const DEFAULT_SELECTED_INDICES = [
  'prom_ventas_diario_top_max_2',
  'prom_ventas_diario_mayor_0',
  'prom_ventas_diario_ult_1_mes',
];

export async function getUserPreferences() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveUserPreferences({ almacen, almacenes = [], suministradores = [], selected_indices = [] }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        almacen: almacenes[0] ?? almacen ?? null,  // backward compat single field
        almacenes,
        suministradores,
        selected_indices,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}
