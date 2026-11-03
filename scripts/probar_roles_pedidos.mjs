// Prueba, contra el servidor real, quién puede hacer cada paso del flujo de pedidos.
// Crea pedidos de prueba (proveedor "ZZ PRUEBA ROLES") y los borra al final con el usuario admin.
//
// Uso (PowerShell): una variable por cuenta (REAB_CUENTA_1 … REAB_CUENTA_6), formato correo:clave.
// El rol de cada cuenta se detecta al iniciar sesión; los pasos de un rol sin cuenta se omiten.
// Hacen falta como mínimo una cuenta comercial y una admin (o supervisor) para la limpieza.
//   $env:REAB_CUENTA_1='correo1@dominio.com:clave1'
//   $env:REAB_CUENTA_2='correo2@dominio.com:clave2'
//   node scripts/probar_roles_pedidos.mjs
// Opcional: $env:REAB_OFFER_ID="<id de una oferta del comercial>" (si no, usa la primera que él vea).

const BASE = "https://apireab.mercadoelineas.com/api/v1";
const sess = {};

async function login(spec) {
  const [email, ...rest] = spec.split(":");
  if (!email.includes("@") || !rest.length) throw new Error(`Cuenta con formato inválido (use correo@dominio.com:clave)`);
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: rest.join(":"), system_slug: "reabastecimiento", remember_me: false }),
  });
  const j = await res.json().catch(() => ({}));
  const token = j.data?.tokens?.access_token ?? j.data?.token ?? j.token;
  if (!res.ok || !token) throw new Error(`Login de ${email} falló (${res.status}): ${j.error?.message ?? ""} ${JSON.stringify(j.error?.details ?? "")}`);
  const rol = String(j.data?.user?.role ?? "").toUpperCase();
  console.log(`  ${email} → rol ${rol || "(sin rol)"}${sess[rol] ? "  (ya había otra cuenta con este rol; se usa esta)" : ""}`);
  sess[rol] = { email, token, rol };
}

async function call(role, method, path, body) {
  if (!sess[role]) return { status: 0, data: undefined, msg: "sin cuenta con este rol" };
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${sess[role].token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, data: j.data, msg: j.error?.message ?? "" };
}

const resultados = [];
const paso = async (n, role, desc, method, path, body, esperado = "ok") => {
  const r = await call(role, method, path, body);
  if (!sess[role]) { resultados.push({ n, role, desc, status: 0, permitido: null, msg: "omitido: no hay cuenta con este rol" }); return r; }
  const permitido = r.status < 400;
  resultados.push({ n, role, desc, status: r.status, permitido, msg: permitido ? "" : r.msg.slice(0, 90) });
  return r;
};

const hoy = new Date().toISOString();
for (let i = 1; i <= 6; i++) if (process.env[`REAB_CUENTA_${i}`]) await login(process.env[`REAB_CUENTA_${i}`]);
if (!sess.ADMIN && sess.SUPERVISOR) sess.ADMIN = sess.SUPERVISOR;
console.log("Roles detectados:", Object.keys(sess).join(", ") || "(ninguno)");
if (!sess.COMERCIAL) throw new Error("Hace falta una cuenta con rol comercial");
if (!sess.ADMIN) console.log("Aviso: no hay cuenta admin/supervisor; la limpieza se intentará con el comercial y puede quedar algún pedido de prueba.");
const aprob = sess.REVISOR ? "REVISOR" : sess.ADMIN ? "ADMIN" : null;   // quien aprueba el pedido de prueba

let offerId = process.env.REAB_OFFER_ID;
if (!offerId) {
  // El comercial solo ve sus ofertas; si no tiene ninguna, se toma una que vea otro rol (el pedido solo guarda su id)
  for (const r of ["COMERCIAL", "ANALISTA", "REVISOR", "ADMIN"]) {
    const l = await call(r, "GET", "/supplier-offers?pageSize=1");
    offerId = l.data?.[0]?.id;
    if (offerId) { if (r !== "COMERCIAL") console.log(`Aviso: el comercial no tiene ofertas; se usa una oferta visible para ${r}.`); break; }
  }
}
if (!offerId) throw new Error("No se encontró ninguna oferta: indica REAB_OFFER_ID");

const nuevoPedido = (extra = {}) => call("COMERCIAL", "POST", "/purchase-orders", {
  supplier_name: "ZZ PRUEBA ROLES", offer_id: offerId, created_by: sess.COMERCIAL.email, currency: "USD", exchange_rate: 1, ...extra,
});
const linea = (po) => call("COMERCIAL", "POST", "/purchase-order-items", {
  purchase_order_id: po, product_name: "ZZ PRODUCTO PRUEBA", final_qty: 2, unit_cost: 1, status: "included", is_new_product: true,
});

// ── Pedido A: recorre todo el flujo ──
// REAB_SALTAR_FLUJO=1 omite el pedido A (flujo completo) y prueba solo el borrado y los precios
let A, itemA;
if (!process.env.REAB_SALTAR_FLUJO) {
A = (await nuevoPedido()).data?.id;
if (!A) throw new Error("El comercial no pudo crear el pedido de prueba");
resultados.push({ n: 1, role: "COMERCIAL", desc: "Crear pedido", status: 201, permitido: true, msg: "" });
itemA = (await linea(A)).data?.id;
await paso(2, "COMERCIAL", "Recalcular totales (borrador)", "POST", `/purchase-orders/${A}/recalculate`);
await paso(3, "COMERCIAL", "borrador → pendiente_revision", "POST", `/purchase-orders/${A}/transition`, { status: "pendiente_revision" });
await paso(4, "COMERCIAL", "Enviar a IC (approval_status = pending_ic)", "PATCH", `/purchase-orders/${A}`, { approval_status: "pending_ic" });
await paso(5, "COMERCIAL", "Guardar fechas clave (pendiente_revision)", "PATCH", `/purchase-orders/${A}`, { fecha_limite_pago: "2026-12-01" });
await paso(6, "ANALISTA", "Editar cantidad de una línea", "PATCH", `/purchase-order-items/${itemA}`, { final_qty: 3 });
await paso(7, "ANALISTA", "Recalcular totales", "POST", `/purchase-orders/${A}/recalculate`);
await paso(8, "ANALISTA", "Enviar a Revisor (pending_review + ic_reviewed_*)", "PATCH", `/purchase-orders/${A}`, { approval_status: "pending_review", ic_reviewed_by: sess.ANALISTA?.email, ic_reviewed_at: hoy });
await paso(9, aprob, "Editar cantidad de una línea", "PATCH", `/purchase-order-items/${itemA}`, { final_qty: 4 });
await paso(10, aprob, "Aprobar: approval_status = approved", "PATCH", `/purchase-orders/${A}`, { approval_status: "approved", approved_by: sess[aprob]?.email, approved_at: hoy, comercial_notified: false });
await paso(11, aprob, "pendiente_revision → confirmado", "POST", `/purchase-orders/${A}/transition`, { status: "confirmado" });
if (aprob) {
await paso(12, "COMERCIAL", "Marcar notificación leída (confirmado)", "PATCH", `/purchase-orders/${A}`, { comercial_notified: true });
await paso(13, "COMERCIAL", "Guardar fechas clave (confirmado)", "PATCH", `/purchase-orders/${A}`, { fecha_estimada_llegada: "2026-12-15" });
await paso(14, "ANALISTA", "Guardar fechas clave (confirmado)", "PATCH", `/purchase-orders/${A}`, { fecha_limite_pago: "2026-12-02" });
await paso(15, "COMERCIAL", "confirmado → enviado", "POST", `/purchase-orders/${A}/transition`, { status: "enviado" });
await paso(16, "COMERCIAL", "Aceptar/rechazar línea (acceptance_status, enviado)", "PATCH", `/purchase-order-items/${itemA}`, { acceptance_status: "accepted" });
await paso(17, "COMERCIAL", "Importar confirmación (confirmation_status, enviado)", "PATCH", `/purchase-orders/${A}`, { confirmation_status: "imported" });
} else for (let n = 9; n <= 17; n++) if (![9, 10, 11].includes(n)) resultados.push({ n, role: "-", desc: "Pasos posteriores a la aprobación", status: 0, permitido: null, msg: "omitido: no hay revisor ni admin para aprobar el pedido" });
}

// ── Pedido B: el comercial borra el suyo en elaboración ──
const B = (await nuevoPedido()).data?.id;
const itemB = (await linea(B)).data?.id;
await call("COMERCIAL", "POST", `/purchase-orders/${B}/transition`, { status: "pendiente_revision" });
await paso(18, "COMERCIAL", "Borrar una línea de su pedido en elaboración", "DELETE", `/purchase-order-items/${itemB}`);
await paso(19, "COMERCIAL", "Borrar su pedido en elaboración (pendiente_revision)", "DELETE", `/purchase-orders/${B}`);

// ── Precios: solo comprueba autorización (cuerpo inválido a propósito: 422/400 = permitido, 403 = denegado) ──
const pr = await call("COMERCIAL", "POST", "/offer-item-price-history", { _prueba: true });
resultados.push({ n: 20, role: "COMERCIAL", desc: "Registrar cambio de precio (importar oferta)", status: pr.status, permitido: ![401, 403, 404].includes(pr.status), msg: [401, 403, 404].includes(pr.status) ? pr.msg.slice(0, 90) : "(cuerpo inválido a propósito; el rol sí pasa)" });

// ── Limpieza (admin) ──
const limpia = sess.ADMIN ? "ADMIN" : "COMERCIAL";
for (const po of [A, B].filter(Boolean)) {
  if (limpia !== "ADMIN") await call(limpia, "POST", `/purchase-orders/${po}/transition`, { status: "cancelado", reason: "prueba de roles" });
  const items = (await call(limpia, "GET", `/purchase-orders/${po}/items`)).data ?? [];
  for (const it of items) await call(limpia, "DELETE", `/purchase-order-items/${it.id}`);
  const d = await call(limpia, "DELETE", `/purchase-orders/${po}`);
  console.log(`Limpieza pedido ${po} (con ${limpia}): ${d.status}${d.status >= 400 ? "  → borrar a mano (proveedor ZZ PRUEBA ROLES)" : ""}`);
}

console.log("\n#  rol         resultado  paso");
for (const r of resultados) console.log(`${String(r.n).padEnd(2)} ${String(r.role ?? "-").padEnd(11)} ${r.permitido === null ? "⏭ omitido" : r.permitido ? "✅ OK    " : `❌ ${r.status}   `} ${r.desc}${r.msg ? "  → " + r.msg : ""}`);
