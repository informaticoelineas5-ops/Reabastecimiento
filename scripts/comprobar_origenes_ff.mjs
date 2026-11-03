// SOLO LECTURA. Comprueba si el backend ya tiene el origen de cada producto (GET /bodegon-product-origin)
// para los almacenes FF (1964-1970), comparado con un bodegón (1053), y qué orígenes aparecen.
//
// Uso (PowerShell):
//   $env:REAB_CUENTA='correo@dominio.com:clave'
//   node scripts/comprobar_origenes_ff.mjs

const spec = process.env.REAB_CUENTA;
if (!spec || !spec.includes("@")) throw new Error("Define REAB_CUENTA='correo:clave'");
const [email, ...rest] = spec.split(":");
const BASE = "https://apireab.mercadoelineas.com/api/v1";

const l = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: rest.join(":"), system_slug: "reabastecimiento", remember_me: false }) });
const lj = await l.json().catch(() => ({}));
const token = lj.data?.tokens?.access_token ?? lj.data?.token;
if (!l.ok || !token) throw new Error(`Login REAB falló (${l.status})`);
console.log(`Sesión: ${email} · rol ${lj.data?.user?.role}\n`);

for (const id of ["1053", "1964", "1965", "1966", "1967", "1968", "1969", "1970"]) {
  const u = new URL(`${BASE}/bodegon-product-origin`);
  u.searchParams.set("bodegon_id", id); u.searchParams.set("pageSize", 200); u.searchParams.set("page", 1);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`${id}: HTTP ${r.status} ${j.error?.message ?? ""}`); continue; }
  const tipos = {}, tiendas = {};
  for (const x of j.data ?? []) {
    tipos[x.origin_type ?? "—"] = (tipos[x.origin_type ?? "—"] ?? 0) + 1;
    if (x.origin_store_id != null) tiendas[x.origin_store_id] = (tiendas[x.origin_store_id] ?? 0) + 1;
  }
  console.log(`${id}: ${j.pagination?.totalItems ?? "?"} productos con origen · (1ª página) tipos ${JSON.stringify(tipos)} · almacenes origen ${JSON.stringify(tiendas)}`);
}
