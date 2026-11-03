/**
 * Facturas de Distribución Externos: factura + productos + PDF + historial + ejecución en TKC.
 *
 * Con el backend desplegado (GET /external-invoices responde) todo vive en la API REAB. Si el servidor aún
 * no lo tiene, se usa el almacenamiento provisional del navegador (externalInvoicesLocal.js), con la misma
 * interfaz, y las pantallas avisan de ello. Ver distribucionMode.js.
 *
 * Forma de los datos que usan las pantallas (la API se traduce a esto):
 *   factura: { id, supplierId, supplierName, numero, fecha, total, source, status, hasPdf, filename,
 *              nProductos, nConCodigo, exec, version, createdAt, updatedAt, annulReason, rows? }
 *   fila:    { id, nombre, nombreFactura, cod, preCod, nuevo, creado, uc, cajasFactura, cajasRecib,
 *              precioCaja, r1053, t1201, w1882, z1883, exec: { aa|t1201|w1882|z1883: { at, by, qty, state, ref, error } } }
 *
 * Reglas del servidor que se respetan aquí:
 *  - Una factura es única por proveedor + número (también las anuladas): el 409 trae existing_id y status.
 *  - Autoguardado con control de concurrencia: PATCH con `version` y solo los ítems cambiados; un 409 con
 *    current_version se resuelve releyendo la factura, reaplicando los cambios locales y reintentando una vez.
 *  - Los checks de ejecución (exec_*) los escribe solo el servidor al ejecutar en TKC; no se editan a mano.
 *  - Anular conserva todo y bloquea la edición; eliminar (solo admin) borra factura, ítems, PDF e historial.
 */
import { reabRequest, reabAuthedFetch, requestWithRetry } from "./reabApiClient";
import { fetchPagesParallel } from "./paginate";
import { getDistribucionMode, apiErrorMessage } from "./distribucionMode";
import * as local from "./externalInvoicesLocal";

export { diffRows, summarizeChanges } from "./externalInvoicesLocal";
export { getDistribucionMode as getStorageMode };

const isLocal = async () => (await getDistribucionMode()) === "local";

// ── Traducción API ⇄ pantallas ──────────────────────────────────────────────────
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Objetivo de ejecución: clave de la pantalla ⇄ valor de la API
const EXEC_API = { aa: "aa", t1201: "1201", w1882: "1882", z1883: "1883" };
export const execTargetToApi = (key) => EXEC_API[key] ?? key;

/** "06/10/2026", "6-10-26" o "2026-10-06" → "2026-10-06" (o null si no se entiende) */
function normDate(d) {
  const s = String(d ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function mapExec(e) {
  if (!e || typeof e !== "object" || (!e.at && !e.state)) return undefined;
  return { at: e.at ?? null, by: e.by ?? "", qty: num(e.qty), state: e.state ?? "done", ref: e.ref ?? null, error: e.error ?? null, attempt: e.attempt ?? null };
}

function fromApiItem(it) {
  const exec = {};
  for (const [key, api] of Object.entries(EXEC_API)) {
    const e = mapExec(it[`exec_${api}`]);
    if (e) exec[key] = e;
  }
  return {
    id: it.id,
    nombre: it.name || it.invoice_name || "",
    nombreFactura: it.invoice_name || it.name || "",
    cod: it.product_code ?? "",
    preCod: it.initial_code ?? "",
    nuevo: !!it.is_new,
    creado: !!it.is_created,
    uc: Math.max(1, num(it.uc, 1)),
    cajasFactura: num(it.boxes_invoiced),
    cajasRecib: num(it.boxes_received),
    precioCaja: num(it.price_box),
    r1053: num(it.boxes_1053),
    t1201: num(it.boxes_1201),
    w1882: num(it.boxes_1882),
    z1883: num(it.boxes_1883),
    exec,
  };
}

// Cuerpo de un ítem para crear / actualizar (sin los checks de ejecución, que no se escriben)
function toApiItem(r, withId = false) {
  const out = {
    ...(withId ? { id: r.id } : {}),
    invoice_name: r.nombreFactura ?? r.nombre,
    name: r.nombre ?? "",
    product_code: String(r.cod ?? "").trim(),
    initial_code: String(r.preCod ?? "").trim(),
    is_new: !!r.nuevo,
    is_created: !!r.creado,
    uc: Math.max(1, Math.round(num(r.uc, 1))),
    boxes_invoiced: num(r.cajasFactura),
    boxes_received: num(r.cajasRecib),
    price_box: num(r.precioCaja),
    boxes_1053: num(r.r1053),
    boxes_1201: num(r.t1201),
    boxes_1882: num(r.w1882),
    boxes_1883: num(r.z1883),
  };
  return out;
}

// exec_summary del servidor → { complete, aa: {done,total}, t1201: {…}, … } (lo que pinta la lista)
function mapExecSummary(es) {
  if (!es || typeof es !== "object") return null;
  const out = { complete: !!es.complete };
  let any = false;
  for (const [key, api] of Object.entries(EXEC_API)) {
    const v = es[api] ?? es[key] ?? es[`exec_${api}`];
    if (v && typeof v === "object") { out[key] = { done: num(v.done ?? v.completed), total: num(v.total) }; any = true; }
  }
  if (!any && (es.total != null || es.done != null)) out.aa = { done: num(es.done), total: num(es.total) };
  return out;
}

function fromApiInvoice(inv) {
  const rows = Array.isArray(inv.items) ? inv.items.map(fromApiItem) : undefined;
  return {
    id: inv.id,
    supplierId: inv.supplier_id,
    supplierName: inv.supplier_name ?? "",
    numero: inv.invoice_number ?? "",
    fecha: normDate(inv.invoice_date) ?? "",
    total: num(inv.total),
    source: inv.source ?? "pdf",
    status: inv.status ?? "activa",
    hasPdf: !!inv.has_document,
    filename: inv.document?.file_name ?? inv.document_name ?? (inv.has_document ? `factura-${inv.invoice_number}.pdf` : ""),
    nProductos: num(inv.n_items, rows?.length ?? 0),
    nConCodigo: num(inv.n_items_with_code, rows?.filter(r => r.cod).length ?? 0),
    exec: mapExecSummary(inv.exec_summary),
    version: inv.version ?? null,
    createdAt: inv.created_at ?? "",
    createdBy: inv.created_by ?? "",
    updatedAt: inv.updated_at ?? inv.created_at ?? "",
    updatedBy: inv.updated_by ?? "",
    annulReason: inv.annul_reason ?? inv.annulled_reason ?? inv.annulment_reason ?? "",
    rows,
  };
}

const unwrap = (res) => res?.data ?? res;
const base = (id) => `/external-invoices/${Number(id)}`;

// ── Facturas ─────────────────────────────────────────────────────────────────────
/** Todas las facturas (sin filas), más recientes primero. */
export async function listInvoices() {
  if (await isLocal()) return local.listInvoices();
  const getPage = (page) => reabRequest("GET", "/external-invoices", { params: { page, pageSize: 200, sortBy: "id", sortOrder: "desc" } });
  const first = await getPage(1);
  const rest = await fetchPagesParallel(first.pagination?.totalPages ?? 1, getPage);
  return [first, ...rest].flatMap(r => r.data ?? []).map(fromApiInvoice);
}

/** Factura con todas sus filas, o null si no existe. */
export async function getInvoice(id) {
  if (await isLocal()) return local.getInvoice(id);
  try { return fromApiInvoice(unwrap(await requestWithRetry("GET", base(id)))); }
  catch (err) { if (err.status === 404) return null; throw err; }
}

/** ¿Ya existe esa factura del proveedor (incluidas anuladas)? → { id, status } | null */
export async function findInvoiceByNumber(supplierId, numero) {
  if (await isLocal()) {
    const f = await local.findInvoiceByNumber(supplierId, numero);
    return f ? { id: f.id, status: f.status } : null;
  }
  const res = await reabRequest("GET", "/external-invoices/lookup", { params: { supplier_id: supplierId, invoice_number: String(numero).trim() } });
  const d = unwrap(res);
  if (!d || d.exists === false) return null;
  const id = d.id ?? d.existing_id;
  return id ? { id, status: d.status } : null;
}

/** Sube el PDF original (un documento por factura), como multipart. */
async function uploadInvoicePdf(id, blob) {
  const path = base(id) + "/document";
  // El servidor acepta multipart (campo "file"); el cuerpo en bruto da 415 (comprobado contra el servidor real)
  const form = new FormData();
  form.append("file", blob, "factura.pdf");
  const res = await reabAuthedFetch(path, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message ?? text; } catch { /* texto plano */ }
    const err = new Error(msg || `No se pudo subir el PDF (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  let dup = [];
  try { dup = (await res.json())?.data?.duplicate_of_invoice_ids ?? []; } catch { /* sin cuerpo */ }
  return { duplicateOf: dup };
}

/**
 * Crea la factura con sus ítems (y su PDF opcional). Devuelve la factura con sus filas ya con el id del servidor.
 * Lanza Error con code "DUPLICATE" y `existing` ({ id, status }) si ya existe esa factura del proveedor.
 */
export async function createInvoice(data, pdfBlob = null) {
  if (await isLocal()) return local.createInvoice(data, pdfBlob);
  let rec;
  try {
    const body = {
      supplier_id: data.supplierId,
      invoice_number: String(data.numero).trim(),
      source: data.source,
      items: data.rows.map(r => toApiItem(r)),
    };
    const fecha = normDate(data.fecha);
    if (fecha) body.invoice_date = fecha;
    rec = fromApiInvoice(unwrap(await reabRequest("POST", "/external-invoices", { body })));
  } catch (err) {
    if (err.status === 409) {
      const e = new Error(`Ya existe la factura #${data.numero} de ${data.supplierName}.`);
      e.code = "DUPLICATE";
      e.existing = { id: err.body?.error?.existing_id, status: err.body?.error?.status };
      throw e;
    }
    err.message = apiErrorMessage(err);
    throw err;
  }
  if (!rec.rows) rec = await getInvoice(rec.id);
  if (pdfBlob) {
    try {
      const { duplicateOf } = await uploadInvoicePdf(rec.id, pdfBlob);
      rec.hasPdf = true;
      rec.duplicatePdfOf = duplicateOf;
    } catch (err) {
      rec.pdfError = err.message; // la factura existe; el PDF se puede reintentar
    }
  }
  invalidateOriginsCache();
  return rec;
}

/** Reintenta subir el PDF de una factura que se creó sin él. */
export async function attachInvoicePdf(id, blob) {
  if (await isLocal()) throw new Error("El servidor aún no está disponible.");
  const out = await uploadInvoicePdf(id, blob);
  invalidateOriginsCache();
  return out;
}

// Diferencias entre dos versiones de las filas (por id): solo cambian los ítems existentes
function changedItems(baseRows, curRows) {
  const byId = new Map(baseRows.map(r => [r.id, JSON.stringify(toApiItem(r))]));
  return curRows.filter(r => byId.has(r.id) && byId.get(r.id) !== JSON.stringify(toApiItem(r)));
}

// Reaplica los cambios locales (cur respecto de base) sobre las filas recién leídas del servidor
function rebase(baseRows, curRows, freshRows) {
  const baseById = new Map(baseRows.map(r => [r.id, r]));
  const curById = new Map(curRows.map(r => [r.id, r]));
  return freshRows.map(fr => {
    const b = baseById.get(fr.id), c = curById.get(fr.id);
    if (!b || !c) return fr;
    const merged = { ...fr };
    for (const k of Object.keys(toApiItem(b))) {
      const field = { invoice_name: "nombreFactura", name: "nombre", product_code: "cod", initial_code: "preCod", is_new: "nuevo", is_created: "creado",
        uc: "uc", boxes_invoiced: "cajasFactura", boxes_received: "cajasRecib", price_box: "precioCaja",
        boxes_1053: "r1053", boxes_1201: "t1201", boxes_1882: "w1882", boxes_1883: "z1883" }[k];
      if (field && JSON.stringify(b[field]) !== JSON.stringify(c[field])) merged[field] = c[field];
    }
    return merged;
  });
}

/**
 * Autoguardado. `baseRows` = filas como están guardadas, `rows` = filas actuales, `version` = la que se leyó.
 * `type`/`label` etiquetan la entrada del historial ("propuesta" · "Propuesta calculada").
 * Devuelve { record, unchanged }: `record` = la factura tal como quedó en el servidor (con versión nueva y
 * checks de ejecución actualizados); las pantallas conservan sus filas y adoptan solo `version` y `exec`.
 */
export async function saveInvoice(id, { baseRows, rows, version, total, exec, user, changes, label, type }) {
  if (await isLocal()) {
    await local.updateInvoice(id, { rows, nProductos: rows.length, total, exec }, user, { changes, label, type: type ?? "edicion" });
    return { record: null, unchanged: false };
  }
  const eventType = type === "propuesta" ? "propuesta" : "edicion";
  let b = baseRows, cur = rows, ver = version;
  for (let attempt = 0; attempt < 2; attempt++) {
    const items = changedItems(b, cur);
    if (!items.length) {
      if (label) await addInvoiceEvent(id, { type: eventType, summary: label });
      return { record: null, unchanged: true };
    }
    try {
      const body = { version: Number(ver), items: items.map(r => toApiItem(r, true)), event_type: eventType };
      if (label) body.event_label = label;
      const res = await reabRequest("PATCH", base(id), { body });
      invalidateOriginsCache();
      return { record: fromApiInvoice(unwrap(res)), unchanged: false };
    } catch (err) {
      if (err.status === 409 && err.body?.error?.current_version != null && attempt === 0) {
        const fresh = await getInvoice(id);
        if (!fresh) throw new Error("La factura ya no existe.");
        if (fresh.status === "anulada") throw new Error("La factura fue anulada en otra sesión: ya no se puede editar.");
        cur = rebase(b, cur, fresh.rows);
        b = fresh.rows; ver = fresh.version;
        continue;
      }
      err.message = apiErrorMessage(err);
      throw err;
    }
  }
  throw new Error("La factura se modificó en otra sesión. Vuelve a abrirla para no perder tus cambios.");
}

// Eventos que el cliente puede registrar a mano: solo "propuesta" y "script" (los demás los genera el servidor)
const CLIENT_EVENTS = new Set(["propuesta", "script"]);

export async function addInvoiceEvent(invoiceId, { type = "operacion", summary, detail = [], user = "" }) {
  if (await isLocal()) return local.addInvoiceEvent(invoiceId, { type, summary, detail, user });
  if (!CLIENT_EVENTS.has(type)) return null;
  return reabRequest("POST", `${base(invoiceId)}/events`, { body: { type, summary, detail: detail?.length ? detail : null } });
}

// El detalle del servidor puede venir con otros nombres de campo: se lleva a { producto, campo, antes, despues }
function normalizeDetail(detail) {
  const list = Array.isArray(detail) ? detail : (Array.isArray(detail?.changes) ? detail.changes : []);
  return list.filter(d => d && typeof d === "object").map(d => ({
    producto: d.producto ?? d.product ?? d.name ?? d.item ?? d.invoice_name ?? "",
    campo: d.campo ?? d.field ?? d.label ?? "",
    antes: d.antes ?? d.before ?? d.old ?? d.from ?? "",
    despues: d.despues ?? d.after ?? d.new ?? d.to ?? "",
  }));
}

/** Historial de la factura, más reciente primero. */
export async function listInvoiceEvents(invoiceId) {
  if (await isLocal()) return local.listInvoiceEvents(invoiceId);
  const getPage = (page) => reabRequest("GET", `${base(invoiceId)}/events`, { params: { page, pageSize: 50 } });
  const first = await getPage(1);
  const rest = await fetchPagesParallel(Math.min(first.pagination?.totalPages ?? 1, 10), getPage);
  return [first, ...rest].flatMap(r => r.data ?? []).map(e => ({
    id: e.id,
    ts: e.created_at ?? e.ts ?? "",
    user: e.user ?? e.created_by ?? e.user_email ?? e.actor ?? "",
    type: e.type ?? e.event_type ?? "",
    summary: e.summary ?? "",
    detail: normalizeDetail(e.detail),
  }));
}

/** PDF original como Blob, o null si la factura no tiene documento. */
export async function getInvoicePdf(invoiceId) {
  if (await isLocal()) return local.getInvoicePdf(invoiceId);
  const res = await reabAuthedFetch(`${base(invoiceId)}/document`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo descargar el documento (${res.status}).`);
  return res.blob();
}

/** Anular (conserva todo y bloquea la edición) o restaurar. */
export async function setInvoiceStatus(id, status, user, reason = "") {
  if (await isLocal()) return local.setInvoiceStatus(id, status, user, reason);
  try {
    await reabRequest("POST", `${base(id)}/${status === "anulada" ? "annul" : "restore"}`, { body: { reason: reason || "" } });
  } catch (err) { err.message = apiErrorMessage(err); throw err; }
  invalidateOriginsCache();
}

/** Borrado definitivo (solo admin): factura, ítems, PDF e historial. */
export async function deleteInvoice(id) {
  if (await isLocal()) return local.deleteInvoice(id);
  await reabRequest("DELETE", base(id));
  invalidateOriginsCache();
}

// ── Historial de precios ─────────────────────────────────────────────────────────
/** Map(idFila → [{ invoiceId, numero, fecha, precioCaja }]) del más antiguo al más reciente. */
export async function priceHistoryForInvoice(record) {
  if (await isLocal()) return local.priceHistoryForInvoice(record);
  const d = unwrap(await reabRequest("GET", `${base(record.id)}/price-history`));
  const entries = Array.isArray(d)
    ? d.map(e => ({ id: e.item_id ?? e.id, hist: e.history ?? e.prices ?? e.previous ?? e.items ?? [] }))
    : Object.entries(d ?? {}).map(([k, v]) => ({ id: k, hist: Array.isArray(v) ? v : (v?.history ?? v?.prices ?? []) }));
  const out = new Map();
  for (const e of entries) {
    out.set(e.id, (e.hist ?? []).map(h => ({
      invoiceId: h.invoice_id ?? h.id,
      numero: h.invoice_number ?? h.numero ?? "",
      fecha: String(h.invoice_date ?? h.fecha ?? h.created_at ?? "").slice(0, 10),
      precioCaja: num(h.price_box ?? h.precio_caja ?? h.price, null),
    })));
  }
  return out;
}

// ── Origen externo de los productos (Propuesta de Reabastecimiento) ──────────────
const ORIGINS_TTL = 3 * 60 * 1000;
const ORIGINS_MAX_INVOICES = 60; // el listado no trae ítems: hay que abrir cada factura (límite de peticiones de la API)
let originsCache = null;
export function invalidateOriginsCache() { originsCache = null; }

/**
 * Productos internos (código TKC) comprados a proveedores externos según las facturas activas.
 * Map(código → { supplierId, supplierName, invoiceName, invoiceNumber, invoiceId, invoiceDate, timesBought })
 * con los datos de la factura MÁS RECIENTE de ese código.
 */
export async function listExternalProductOrigins() {
  if (await isLocal()) return local.listExternalProductOrigins();
  if (originsCache && Date.now() - originsCache.at < ORIGINS_TTL) return originsCache.map;

  const all = (await listInvoices()).filter(i => i.status !== "anulada" && i.nConCodigo > 0);
  // Más antiguas primero: la más reciente de cada código sobrescribe a las anteriores
  const recent = all.sort((a, b) => ((a.fecha || a.createdAt) < (b.fecha || b.createdAt) ? -1 : 1)).slice(-ORIGINS_MAX_INVOICES);
  const details = new Array(recent.length);
  let next = 0;
  const worker = async () => {
    while (next < recent.length) {
      const i = next++;
      try { details[i] = await getInvoice(recent[i].id); } catch { details[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, recent.length) }, worker));

  const map = new Map();
  recent.forEach((inv, i) => {
    for (const r of details[i]?.rows ?? []) {
      const cod = String(r.cod ?? "").trim();
      if (!cod) continue;
      map.set(cod, {
        supplierId: inv.supplierId, supplierName: inv.supplierName,
        invoiceName: r.nombreFactura ?? r.nombre, invoiceNumber: inv.numero, invoiceId: inv.id,
        invoiceDate: inv.fecha || String(inv.createdAt).slice(0, 10),
        timesBought: (map.get(cod)?.timesBought ?? 0) + 1,
      });
    }
  });
  originsCache = { at: Date.now(), map };
  return map;
}

// ── Ejecución en TKC (vía elineas-transferencia) ─────────────────────────────────
/**
 * Monta en TKC UN documento con los ítems pendientes del objetivo (Ajuste AA del 1053 o transferencia 1053 → bodegón).
 * `target` es la clave de la pantalla (aa | t1201 | w1882 | z1883). Las credenciales de TKC del usuario se mandan
 * en cada llamada y el servidor no las guarda. Devuelve el resultado del servidor (status, ítems, avisos…).
 *  - Un ítem cuya cantidad subió después de ejecutarse se omite salvo `confirmModified` + `itemIds` (envía la diferencia).
 *  - Lo que quede "unverified" no se reenvía solo: revisar TKC y usar resolveInvoiceExecutions.
 */
export async function executeInvoice(id, { target, itemIds, confirmModified = false, credentials }) {
  if (await isLocal()) throw new Error("La ejecución en TKC requiere el servidor, que aún no está disponible.");
  const body = { target: execTargetToApi(target), tkc_credentials: { username: credentials.username, password: credentials.password } };
  if (itemIds?.length) body.item_ids = itemIds;
  if (confirmModified) body.confirm_modified = true;
  try {
    const res = await reabRequest("POST", `${base(id)}/executions`, { body });
    return unwrap(res) ?? {};
  } catch (err) { err.message = apiErrorMessage(err); throw err; }
}

/** Recoge el resultado de los trabajos que quedaron en curso (idempotente). */
export async function reconcileInvoiceExecutions(id) {
  if (await isLocal()) return null;
  try { return unwrap(await reabRequest("POST", `${base(id)}/executions/reconcile`)); }
  catch (err) { err.message = apiErrorMessage(err); throw err; }
}

/** Cierra a mano lo que quedó sin verificar: outcome "done" (el documento existe en TKC) o "pending" (no se aplicó). */
export async function resolveInvoiceExecutions(id, { target, itemIds, outcome }) {
  if (await isLocal()) return null;
  try {
    return unwrap(await reabRequest("POST", `${base(id)}/executions/resolve`, {
      body: { target: execTargetToApi(target), item_ids: itemIds, outcome },
    }));
  } catch (err) { err.message = apiErrorMessage(err); throw err; }
}

// ── Migración de las facturas guardadas en este navegador ────────────────────────
/** Cuántas facturas hay en el almacenamiento local de este navegador. */
export async function countLocalInvoices() {
  try { return (await local.listInvoices()).length; } catch { return 0; }
}

/**
 * Sube al servidor las facturas locales. Las que ya existen (409) se omiten. El PDF viaja con la factura.
 * No se migran el historial local ni los checks de ejecución manuales (en el servidor solo los escribe la ejecución real).
 * Devuelve { migrated, skipped, failed: [{ numero, error }] }. No borra nada del navegador.
 */
export async function migrateLocalInvoices(suppliers) {
  if (await isLocal()) throw new Error("El servidor aún no está disponible.");
  const byName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]));
  const result = { migrated: 0, skipped: 0, failed: [] };
  for (const light of (await local.listInvoices()).sort((a, b) => a.id - b.id)) {
    const inv = await local.getInvoice(light.id);
    const sup = byName.get(String(inv.supplierName).trim().toLowerCase());
    if (!sup) { result.failed.push({ numero: inv.numero, error: `El proveedor "${inv.supplierName}" no existe en el servidor.` }); continue; }
    try {
      const pdf = inv.hasPdf ? await local.getInvoicePdf(inv.id) : null;
      const rec = await createInvoice({ supplierId: sup.id, supplierName: sup.name, numero: inv.numero, fecha: inv.fecha, source: inv.source, rows: inv.rows }, pdf);
      if (inv.status === "anulada") await setInvoiceStatus(rec.id, "anulada", "", inv.annulReason || "Migrada como anulada");
      result.migrated++;
    } catch (err) {
      if (err.code === "DUPLICATE") result.skipped++;
      else result.failed.push({ numero: inv.numero, error: err.message });
    }
  }
  return result;
}
