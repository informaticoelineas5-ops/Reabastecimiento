// Prueba, contra el servidor real, el backend de Distribución Externos (facturas, ítems, PDF, historial, precios).
// NO ejecuta nada en TKC. Por defecto solo LEE; con REAB_ESCRIBIR=1 crea UNA factura de prueba
// (número "ZZ-PRUEBA-…" de un proveedor externo ya existente), la prueba y la deja ANULADA
// (o la borra si la cuenta es admin/supervisor).
//
// Uso (PowerShell):
//   $env:REAB_CUENTA='correo@dominio.com:clave'      # rol comercial, analista, supervisor o admin
//   node scripts/probar_distribucion.mjs             # solo lectura
//   $env:REAB_ESCRIBIR='1'; node scripts/probar_distribucion.mjs   # con factura de prueba

const BASE = "https://apireab.mercadoelineas.com/api/v1";
const spec = process.env.REAB_CUENTA;
if (!spec || !spec.includes("@")) throw new Error("Define REAB_CUENTA='correo:clave'");
const ESCRIBIR = process.env.REAB_ESCRIBIR === "1";
const res = [];
const rep = (paso, ok, nota = "") => { res.push({ paso, ok, nota }); console.log(`${ok === null ? "⏭" : ok ? "✅" : "❌"} ${paso}${nota ? "  → " + nota : ""}`); };

// ── sesión ──
const [email, ...rest] = spec.split(":");
const lg = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: rest.join(":"), system_slug: "reabastecimiento", remember_me: false }) });
const lj = await lg.json().catch(() => ({}));
const token = lj.data?.tokens?.access_token ?? lj.data?.token;
if (!lg.ok || !token) throw new Error(`Login falló (${lg.status}): ${lj.error?.message ?? ""}`);
const rol = String(lj.data?.user?.role ?? "").toLowerCase();
console.log(`Sesión: ${email} · rol ${rol}\n`);

const call = async (method, path, { body, raw, headers } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const ct = r.headers.get("content-type") ?? "";
  const j = ct.includes("json") ? await r.json().catch(() => ({})) : null;
  return { status: r.status, j, data: j?.data, err: j?.error, ct, buf: j ? null : Buffer.from(await r.arrayBuffer()) };
};
const tipo = (v) => (v === null ? "null" : typeof v);

// ── lectura ──
let r = await call("GET", "/external-invoices?pageSize=5&count=none");
rep("GET /external-invoices (listado)", r.status === 200, `HTTP ${r.status}${r.err ? " · " + r.err.message : ""} · ${r.data?.length ?? 0} filas`);
if (r.status === 500) console.log("   ⚠ 500 en el listado: suele ser una migración que no se aplicó (falta una tabla o columna).");
const lista = r.data ?? [];
if (lista[0]) {
  const f = lista[0];
  rep("Tipos de la cabecera", true, `version=${tipo(f.version)} · n_items=${tipo(f.n_items)} · total=${tipo(f.total)} · exec_summary=${tipo(f.exec_summary)}`);
  if (typeof f.version !== "number") console.log("   ⚠ version llega como texto: el PATCH exige entero, el front debe enviarlo con Number().");
  const d = await call("GET", `/external-invoices/${f.id}`);
  rep("GET /external-invoices/{id} (con ítems)", d.status === 200, `HTTP ${d.status} · ${d.data?.items?.length ?? 0} ítems`);
  const it = d.data?.items?.[0];
  if (it) rep("Tipos del ítem", true, `uc=${tipo(it.uc)} · position=${tipo(it.position)} · boxes_1201=${tipo(it.boxes_1201)} · exec_aa=${JSON.stringify(it.exec_aa)}`);
  const ph = await call("GET", `/external-invoices/${f.id}/price-history`);
  rep("GET price-history", ph.status === 200, `HTTP ${ph.status}`);
  const ev = await call("GET", `/external-invoices/${f.id}/events?pageSize=5`);
  rep("GET events", ev.status === 200, `HTTP ${ev.status} · ${ev.data?.length ?? 0} eventos`);
  const doc = await call("GET", `/external-invoices/${f.id}/document`);
  rep("GET document (PDF)", f.has_document ? doc.status === 200 : doc.status === 404, `HTTP ${doc.status} · has_document=${f.has_document}`);
} else rep("Facturas existentes", null, "no hay ninguna: la lectura de ítems/PDF/historial no se pudo probar sin escribir");

r = await call("GET", "/suppliers?is_external=true&pageSize=5&count=none");
rep("GET /suppliers?is_external=true", r.status === 200, `HTTP ${r.status} · ${r.data?.length ?? 0} proveedores externos`);
const prov = r.data?.[0];
const rc = await call("POST", "/external-invoices/0/executions/reconcile");
rep("POST executions/reconcile (factura inexistente)", [404, 422].includes(rc.status), `HTTP ${rc.status} (404/422 = la ruta existe y valida)`);

// ── escritura (opcional) ──
if (!ESCRIBIR) { rep("Pruebas de escritura", null, "omitidas (REAB_ESCRIBIR=1 para hacerlas)"); }
else if (!prov) { rep("Pruebas de escritura", null, "no hay proveedor externo donde crear la factura de prueba"); }
else {
  const num = `ZZ-PRUEBA-${Date.now().toString(36).toUpperCase()}`;
  const items = [
    { invoice_name: "ZZ PRODUCTO PRUEBA 1", name: "ZZ PRODUCTO PRUEBA 1", product_code: "", initial_code: "", is_new: true, is_created: false, uc: 12, boxes_invoiced: 10, boxes_received: 10, price_box: 5.5, boxes_1053: 2, boxes_1201: 3, boxes_1882: 2, boxes_1883: 3 },
    { invoice_name: "ZZ PRODUCTO PRUEBA 2", name: "ZZ PRODUCTO PRUEBA 2", product_code: "", initial_code: "", is_new: true, is_created: false, uc: 6, boxes_invoiced: 4, boxes_received: 4, price_box: 8, boxes_1053: 1, boxes_1201: 1, boxes_1882: 1, boxes_1883: 1 },
  ];
  const c = await call("POST", "/external-invoices", { body: { supplier_id: prov.id, invoice_number: num, invoice_date: new Date().toISOString().slice(0, 10), source: "manual", items } });
  rep("POST crear factura", c.status === 201 || c.status === 200, `HTTP ${c.status}${c.err ? " · " + c.err.message : ""}`);
  const id = c.data?.id;
  if (id) {
    const dup = await call("POST", "/external-invoices", { body: { supplier_id: prov.id, invoice_number: num, source: "manual", items } });
    rep("Duplicada → 409 con existing_id", dup.status === 409 && dup.err?.existing_id != null, `HTTP ${dup.status} · existing_id=${dup.err?.existing_id}`);
    const lk = await call("GET", `/external-invoices/lookup?supplier_id=${prov.id}&invoice_number=${encodeURIComponent(num)}`);
    rep("GET lookup", lk.status === 200 && lk.data?.exists === true, `HTTP ${lk.status} · ${JSON.stringify(lk.data)}`);
    const g = await call("GET", `/external-invoices/${id}`);
    const v = g.data?.version, it0 = g.data?.items?.[0];
    rep("Versión inicial", g.status === 200, `version=${v} (${tipo(v)})`);
    const p1 = await call("PATCH", `/external-invoices/${id}`, { body: { version: Number(v), items: [{ id: it0.id, price_box: 6.25 }], event_type: "edicion" } });
    rep("PATCH (versión numérica) cambia un precio", p1.status === 200, `HTTP ${p1.status}${p1.err ? " · " + p1.err.message : ""} · versión nueva ${p1.data?.version}`);
    const p2 = await call("PATCH", `/external-invoices/${id}`, { body: { version: Number(v), items: [{ id: it0.id, price_box: 7 }] } });
    rep("PATCH con versión vieja → 409 + current_version", p2.status === 409 && p2.err?.current_version != null, `HTTP ${p2.status} · current_version=${p2.err?.current_version}`);
    const e1 = await call("POST", `/external-invoices/${id}/events`, { body: { type: "propuesta", summary: "Prueba de evento", detail: null } });
    rep("POST evento propuesta", [200, 201].includes(e1.status), `HTTP ${e1.status}`);
    const ph = await call("GET", `/external-invoices/${id}/price-history`);
    rep("price-history de la factura nueva", ph.status === 200, `HTTP ${ph.status}`);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    const up = await call("POST", `/external-invoices/${id}/document`, { raw: pdf, headers: { "Content-Type": "application/pdf" } });
    rep("Subir PDF (cuerpo en bruto application/pdf)", [200, 201].includes(up.status), `HTTP ${up.status}${up.err ? " · " + up.err.message : ""}`);
    if (![200, 201].includes(up.status)) {
      const fd = new FormData(); fd.append("file", new Blob([pdf], { type: "application/pdf" }), "prueba.pdf");
      const r2 = await fetch(`${BASE}/external-invoices/${id}/document`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      rep("Subir PDF (multipart, respaldo)", r2.ok, `HTTP ${r2.status}`);
    }
    const dl = await call("GET", `/external-invoices/${id}/document`);
    rep("Descargar el PDF", dl.status === 200 && dl.buf?.length > 0, `HTTP ${dl.status} · ${dl.buf?.length ?? 0} bytes · ${dl.ct}`);
    const an = await call("POST", `/external-invoices/${id}/annul`, { body: { reason: "prueba automática" } });
    rep("Anular", an.status === 200, `HTTP ${an.status}`);
    const pe = await call("PATCH", `/external-invoices/${id}`, { body: { version: Number(an.data?.version ?? v), items: [{ id: it0.id, price_box: 9 }] } });
    rep("Editar una anulada → 409", pe.status === 409, `HTTP ${pe.status}`);
    const rs = await call("POST", `/external-invoices/${id}/restore`, { body: { reason: "" } });
    rep("Restaurar", rs.status === 200, `HTTP ${rs.status}`);
    const rd = await call("DELETE", `/external-invoices/${id}`);
    if (rd.status === 200 || rd.status === 204) rep("Limpieza: borrada", true, "");
    else { await call("POST", `/external-invoices/${id}/annul`, { body: { reason: "prueba automática" } }); rep("Limpieza", null, `no se pudo borrar (HTTP ${rd.status}, solo admin/supervisor): queda ANULADA, número ${num}`); }
  }
}

console.log(`\n${res.filter(x => x.ok === true).length} bien · ${res.filter(x => x.ok === false).length} fallos · ${res.filter(x => x.ok === null).length} omitidos`);
