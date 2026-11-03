// SOLO LECTURA. Comprueba cuántos productos de un almacén (los de la vista "Productos sin U/C", sacados de indg_ap_sub)
// existen en el maestro de productos del servidor REAB (GET /products), y cuántos de ellos ya tienen unidades_por_caja.
// Sirve para decidir si "Productos sin U/C" puede guardar con PATCH /products/{id}.
//
// Uso (PowerShell):
//   $env:REAB_CUENTA='correo@dominio.com:clave'
//   $env:REAB_ALMACEN='581'          # opcional, por defecto 581
//   node scripts/comprobar_uc_maestro.mjs

const spec = process.env.REAB_CUENTA;
if (!spec || !spec.includes("@")) throw new Error("Define REAB_CUENTA='correo:clave'");
const ALMACEN = process.env.REAB_ALMACEN || "581";
const [email, ...rest] = spec.split(":");
const password = rest.join(":");

const REAB = "https://apireab.mercadoelineas.com/api/v1";
const ELINEAS = "https://api.mercadoelineas.com/api";
const AUTH = "https://apiauth.mercadoelineas.com/api";

// ── sesiones ──
const a = await fetch(`${AUTH}/auth/sign-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, rememberMe: false }) });
const aj = await a.json().catch(() => ({}));
if (!a.ok || !aj.token) throw new Error(`Login Elineas falló (${a.status})`);
const elToken = aj.token;

const l = await fetch(`${REAB}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, system_slug: "reabastecimiento", remember_me: false }) });
const lj = await l.json().catch(() => ({}));
const reabToken = lj.data?.tokens?.access_token ?? lj.data?.token;
if (!l.ok || !reabToken) throw new Error(`Login REAB falló (${l.status}): ${lj.error?.message ?? ""}`);
console.log(`Sesión: ${email} · rol ${lj.data?.user?.role}\n`);

// ── productos del almacén (los de la vista) ──
const delAlmacen = new Map();   // codigo → nombre
for (let page = 1; ; page++) {
  const u = new URL(`${ELINEAS}/reports/indg_ap_sub`);
  u.searchParams.set("page", page); u.searchParams.set("pageSize", 500); u.searchParams.set("withTotal", "false");
  u.searchParams.set("filter", `almacenKey:${ALMACEN}`);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${elToken}` } });
  if (!r.ok) throw new Error(`indg_ap_sub ${r.status}`);
  const j = await r.json();
  for (const row of j.data ?? []) { const c = String(row.codigo ?? "").trim(); if (c) delAlmacen.set(c, row.nombre ?? ""); }
  if (!j.pagination?.hasNextPage) break;
}
console.log(`Almacén ${ALMACEN}: ${delAlmacen.size} productos distintos (por código)`);

// ── maestro del servidor ──
const maestro = new Map();      // codigo → { id, uc }
const PS = 200;   // máximo de /products
for (let page = 1; ; page++) {
  const u = new URL(`${REAB}/products`);
  u.searchParams.set("page", page); u.searchParams.set("pageSize", PS); u.searchParams.set("count", "none");
  u.searchParams.set("fields", "id,codigo,unidades_por_caja");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${reabToken}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`GET /products página ${page} → HTTP ${r.status} ${j.error?.message ?? ""} · ${JSON.stringify(j.error?.details ?? [])}`); break; }
  for (const p of j.data ?? []) maestro.set(String(p.codigo).trim(), { id: p.id, uc: p.unidades_por_caja });
  if (!j.pagination?.hasNextPage || !(j.data?.length)) break;
}
console.log(`Maestro REAB: ${maestro.size} productos\n`);

// ── diagnóstico del maestro (si salió vacío) ──
if (!maestro.size) {
  for (const path of ["/products?pageSize=3", "/products/pending-units-per-box?pageSize=3"]) {
    const r = await fetch(REAB + path, { headers: { Authorization: `Bearer ${reabToken}` } });
    const j = await r.json().catch(() => ({}));
    console.log(`GET ${path} → HTTP ${r.status} · filas=${j.data?.length ?? "?"} · totalItems=${j.pagination?.totalItems ?? "?"} · ${JSON.stringify(j.data?.[0] ?? j.error ?? {}).slice(0, 300)}`);
  }
  console.log("");
}

// ── cruce ──
let existen = 0, conUC = 0, sinUC = 0;
const faltan = [];
for (const [c, nombre] of delAlmacen) {
  const m = maestro.get(c);
  if (!m) { faltan.push([c, nombre]); continue; }
  existen++;
  if (m.uc != null && Number(m.uc) > 0) conUC++; else sinUC++;
}
console.log(`De los ${delAlmacen.size} productos del almacén ${ALMACEN}:`);
console.log(`  ✅ existen en el maestro: ${existen}  (con U/C: ${conUC} · sin U/C: ${sinUC})`);
console.log(`  ❌ NO existen en el maestro: ${faltan.length}`);
faltan.slice(0, 15).forEach(([c, n]) => console.log(`     ${c}  ${n}`));
if (faltan.length > 15) console.log(`     … y ${faltan.length - 15} más`);
