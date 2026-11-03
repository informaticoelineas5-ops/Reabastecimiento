import { createClient } from '@supabase/supabase-js';
import { createReabEntityAdapter, REAB_ENTITIES } from './reabApiClient';
import { tokenStore } from './tokenStore';
import { apiAuthClearTokens } from './apiAuthClient';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const missingSupabaseEnvVars = [
  ['VITE_SUPABASE_URL', SUPABASE_URL],
  ['VITE_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
].filter(([, value]) => !value).map(([name]) => name);

export const isSupabaseConfigured = missingSupabaseEnvVars.length === 0;

export const supabaseConfigError = isSupabaseConfigured
  ? null
  : `Faltan variables de entorno de Supabase: ${missingSupabaseEnvVars.join(', ')}.`;

function createDisabledSupabaseClient() {
  const configurationError = new Error(
    `${supabaseConfigError} Copia .env.example a .env.local, completa los valores y reinicia npm run dev.`
  );

  return {
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      async getUser() {
        return { data: { user: null }, error: configurationError };
      },
      async signInWithPassword() {
        return { data: null, error: configurationError };
      },
      async signUp() {
        return { data: null, error: configurationError };
      },
      async signOut() {
        return { error: null };
      },
    },
    from() {
      throw configurationError;
    },
    rpc() {
      throw configurationError;
    },
  };
}

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createDisabledSupabaseClient();

// ── Entity name → Supabase table name ─────────────────────
// All entities now route through REAB_ENTITIES → createReabEntityAdapter.
// This map is kept as a fallback for any entity not yet in REAB_ENTITIES.
const TABLE_MAP = {};

// ── Map base44 orderBy format to Supabase ─────────────────
// "-created_date" → { column: "created_at", ascending: false }
const COLUMN_ALIASES = {
  created_date: 'created_at',
  updated_date: 'updated_at',
  row_index:    'row_number',
};

function parseOrderBy(orderBy) {
  if (!orderBy) return { column: 'created_at', ascending: false };
  const ascending = !orderBy.startsWith('-');
  const raw = ascending ? orderBy : orderBy.slice(1);
  return { column: COLUMN_ALIASES[raw] ?? raw, ascending };
}

// ── Generic entity adapter ─────────────────────────────────
function createEntityAdapter(entityName) {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);

  return {
    /** List all records, ordered and limited, with optional offset for pagination */
    async list(orderBy, limit = 1000, offset = 0) {
      const { column, ascending } = parseOrderBy(orderBy);
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order(column, { ascending })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return data ?? [];
    },

    /** Filter by equality conditions */
    async filter(conditions = {}, orderBy, limit = 1000) {
      const { column, ascending } = parseOrderBy(orderBy);
      let q = supabase.from(table).select('*');
      for (const [key, value] of Object.entries(conditions)) {
        if (Array.isArray(value)) {
          q = q.in(key, value);
        } else {
          q = q.eq(key, value);
        }
      }
      q = q.order(column, { ascending }).limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },

    /** Insert a single record and return it */
    async create(payload) {
      const { data, error } = await supabase
        .from(table)
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Update a record by id and return it */
    async update(id, payload) {
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Delete a record by id */
    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
    },

    /** Bulk insert and return inserted rows */
    async bulkCreate(items) {
      if (!items?.length) return [];
      const { data, error } = await supabase
        .from(table)
        .insert(items)
        .select();
      if (error) throw error;
      return data ?? [];
    },

    /**
     * Bulk upsert: inserts or updates rows based on the conflict column.
     * Use 'codigo' for products, 'id' for forcing updates on offers.
     */
    async bulkUpsert(items, conflictColumn) {
      if (!items?.length) return [];
      const { data, error } = await supabase
        .from(table)
        .upsert(items, { onConflict: conflictColumn })
        .select();
      if (error) throw error;
      return data ?? [];
    },

    /**
     * Server-side paginated filtering with text search and custom operators.
     * Returns { data: [], total: number }.
     *
     * @param {Object} conditions  - Equality conditions { column: value }
     * @param {Object} options
     *   @param {{ text: string, columns: string[] }} [options.search]  - ilike text search
     *   @param {Array<{ type, column, value }>}     [options.extraFilters]
     *   @param {string}  [options.orderBy]  - e.g. "nombre" or "-updated_at"
     *   @param {number}  [options.limit]    - default 50
     *   @param {number}  [options.offset]   - default 0
     */
    async filterPaginated(conditions = {}, options = {}) {
      const { search, extraFilters = [], orderBy, limit = 50, offset = 0 } = options;
      const { column, ascending } = parseOrderBy(orderBy);

      let q = supabase.from(table).select('*', { count: 'exact' });

      // Text search across multiple columns (OR)
      if (search?.text?.trim()) {
        const t = search.text.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
        const orExpr = (search.columns || []).map((c) => `${c}.ilike.%${t}%`).join(',');
        if (orExpr) q = q.or(orExpr);
      }

      // Equality / array conditions
      for (const [key, value] of Object.entries(conditions)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) q = q.in(key, value);
        else q = q.eq(key, value);
      }

      // Extra operators
      for (const f of extraFilters) {
        if (f.type === 'gt')  q = q.gt(f.column, f.value);
        if (f.type === 'gte') q = q.gte(f.column, f.value);
        if (f.type === 'lt')  q = q.lt(f.column, f.value);
        if (f.type === 'lte') q = q.lte(f.column, f.value);
        if (f.type === 'neq') q = q.neq(f.column, f.value);
        if (f.type === 'is')  q = q.is(f.column, f.value);
      }

      q = q.order(column, { ascending }).range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: data ?? [], total: count ?? 0 };
    },

    /**
     * Returns sorted unique non-null values for a single column.
     * Used to populate filter dropdowns (proveedores, categorías, etc.)
     */
    async selectDistinct(column, limit = 60000) {
      const { data, error } = await supabase
        .from(table)
        .select(column)
        .not(column, 'is', null)
        .neq(column, '')
        .limit(limit);
      if (error) throw error;
      const unique = [...new Set((data ?? []).map((r) => r[column]).filter(Boolean))].sort();
      return unique;
    },
  };
}

// Fetches the role assigned to this user in the 'reabastecimiento' system from IS.
// Response shape: { "roles": [{ "name": "admin", "system": { "slug": "reabastecimiento" } }, ...] }
async function fetchUserRoles(token) {
  try {
    const res = await fetch('https://apiauth.mercadoelineas.com/api/user-roles/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const roles = json.roles ?? json.data?.roles ?? [];
    // Un usuario puede tener varios roles en el sistema (p. ej. cardista y analista)
    return roles.filter(r => r.system?.slug === 'reabastecimiento').map(r => r.name).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Auth adapter (mirrors base44.auth API) ─────────────────
const authAdapter = {
  async me() {
    const token = tokenStore.get();
    if (!token) throw new Error('Not authenticated');

    // Identity comes from JWT claims (no /auth/me endpoint exists on IS)
    let claims = null;
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      claims = JSON.parse(atob(b64));
    } catch {}

    if (claims?.exp && claims.exp * 1000 < Date.now()) {
      apiAuthClearTokens();
      throw new Error('Session expired');
    }

    if (!claims?.sub && !claims?.email) {
      throw new Error('Invalid token');
    }

    // Role comes from IS user-roles endpoint (filtered to reabastecimiento system)
    const roles = await fetchUserRoles(token);
    const role = roles[0] ?? null;

    return {
      id:        claims.sub       ?? null,
      email:     claims.email     ?? null,
      role:      role             ?? 'consulta',
      roles:     roles.length ? roles : ['consulta'],
      full_name: claims.name      ?? claims.fullName ?? null,
      status:    'active',
    };
  },

  // Los usuarios, roles y permisos se gestionan en Identity (elineas-auth); esta app solo los lee.
  // Delegates to me() — identity now comes from IS
  async getMyProfile(_userId, _email) {
    return this.me();
  },

  async logout(redirectUrl) {
    apiAuthClearTokens();
    if (redirectUrl) window.location.href = redirectUrl;
  },

  redirectToLogin() {
    // Handled internally by AuthContext — no external URL needed
  },
};

// ── base44-compatible client ───────────────────────────────
export const base44 = {
  auth: authAdapter,
  entities: new Proxy(
    {},
    {
      get: (_, entityName) => {
        if (REAB_ENTITIES.has(entityName)) return createReabEntityAdapter(entityName);
        return createEntityAdapter(entityName);
      },
    }
  ),
};
