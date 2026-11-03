/**
 * Facturas de Distribución Externos: factura + productos + PDF + historial de operaciones.
 *
 * PROVISIONAL: mientras el backend no tenga estos recursos, todo se guarda solo en este navegador
 * (IndexedDB; el PDF se guarda como archivo). No se comparte con otros usuarios ni con otros equipos.
 *
 * Al conectar el backend basta con reescribir las funciones exportadas; las pantallas solo usan esta
 * interfaz. Ver PEDIDO_BACKEND_BODEGONES.md para el modelo de datos propuesto.
 *
 * Reglas:
 *  - Una factura es única por proveedor + número. No hay botón "Guardar": cada cambio actualiza la
 *    misma factura y deja una entrada en su historial.
 *  - "Anular" conserva la factura y su historial; solo "deleteInvoice" (admin) la borra del todo.
 */

const DB_NAME = "reab_ext_invoices";
const DB_VER  = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("invoices")) db.createObjectStore("invoices", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("events")) {
        db.createObjectStore("events", { keyPath: "id", autoIncrement: true }).createIndex("invoiceId", "invoiceId");
      }
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "invoiceId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(new Error("No se pudo abrir el almacenamiento local de este navegador."));
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror   = () => reject(req.error ?? new Error("Error de almacenamiento local."));
});

async function tx(stores, mode, fn) {
  const db = await openDb();
  try {
    const t = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error ?? new Error("Error de almacenamiento local."));
      t.onabort = () => reject(t.error ?? new Error("Transacción cancelada."));
    });
    const result = await fn(t);
    await done;
    return result;
  } finally {
    db.close();
  }
}

const now = () => new Date().toISOString();

// ── Comparación de filas (para el historial) ─────────────────────────────────────
const TRACKED = [
  ["cod", "Cód. TKC"], ["nombre", "Nombre"], ["uc", "U/C"],
  ["cajasFactura", "Cajas facturadas"], ["cajasRecib", "Cajas recibidas"], ["precioCaja", "Precio/caja"],
  ["r1053", "1053/C"], ["t1201", "1201/C"], ["w1882", "1882/C"], ["z1883", "1883/C"],
  ["nuevo", "Nuevo"], ["creado", "Creado"],
];

// Checks de ejecución por ítem: row.exec[objetivo] = { at, by, qty } (ausente = pendiente)
const EXEC_LABELS = { aa: "Ajuste AA", t1201: "Transf. 1201", w1882: "Transf. 1882", z1883: "Transf. 1883" };

/** Lista de cambios entre dos versiones de las filas: [{ producto, campo, antes, despues }] */
export function diffRows(prev = [], next = []) {
  const changes = [];
  const prevById = new Map(prev.map(r => [r.id, r]));
  const nextIds  = new Set(next.map(r => r.id));
  for (const r of next) {
    const p = prevById.get(r.id);
    if (!p) { changes.push({ producto: r.nombre, campo: "Producto", antes: null, despues: "agregado" }); continue; }
    for (const [key, label] of TRACKED) {
      const a = p[key] ?? "", b = r[key] ?? "";
      if (a !== b) changes.push({ producto: r.nombre, campo: label, antes: a === "" ? "—" : a, despues: b === "" ? "—" : b });
    }
    for (const [key, label] of Object.entries(EXEC_LABELS)) {
      const a = !!p.exec?.[key], b = !!r.exec?.[key];
      if (a !== b) changes.push({ producto: r.nombre, campo: label, antes: a ? "ejecutado" : "pendiente", despues: b ? "ejecutado" : "pendiente" });
    }
  }
  for (const p of prev) if (!nextIds.has(p.id)) changes.push({ producto: p.nombre, campo: "Producto", antes: "presente", despues: "quitado" });
  return changes;
}

/** "Cód. TKC ×2, Cajas recibidas ×1" */
export function summarizeChanges(changes) {
  const count = new Map();
  for (const c of changes) count.set(c.campo, (count.get(c.campo) ?? 0) + 1);
  return [...count].map(([campo, n]) => (n > 1 ? `${campo} ×${n}` : campo)).join(", ");
}

// ── Facturas ─────────────────────────────────────────────────────────────────────
const lightRecord = ({ rows, ...rest }) => ({
  ...rest,
  nProductos: rows?.length ?? rest.nProductos ?? 0,
  nConCodigo: rows?.filter(r => r.cod).length ?? 0,
});

/** Todas las facturas (sin las filas), más recientes primero. */
export async function listInvoices() {
  const all = await tx(["invoices"], "readonly", (t) => wrap(t.objectStore("invoices").getAll()));
  return all.map(lightRecord).sort((a, b) => b.id - a.id);
}

export async function getInvoice(id) {
  return tx(["invoices"], "readonly", (t) => wrap(t.objectStore("invoices").get(Number(id)))) ?? null;
}

/** Busca por proveedor + número (incluye las anuladas). */
export async function findInvoiceByNumber(supplierId, numero) {
  const all = await tx(["invoices"], "readonly", (t) => wrap(t.objectStore("invoices").getAll()));
  const key = String(numero).trim().toLowerCase();
  return all.find(i => i.supplierId === supplierId && String(i.numero).trim().toLowerCase() === key) ?? null;
}

/**
 * Crea la factura (con su PDF opcional) y deja la primera entrada del historial.
 * Lanza Error con code "DUPLICATE" si ya existe esa factura del proveedor.
 */
export async function createInvoice(data, pdfBlob = null) {
  const dup = await findInvoiceByNumber(data.supplierId, data.numero);
  if (dup) { const e = new Error(`Ya existe la factura #${data.numero} de ${data.supplierName}.`); e.code = "DUPLICATE"; e.existing = dup; throw e; }
  const ts = now();
  const record = {
    supplierId: data.supplierId, supplierName: data.supplierName,
    numero: String(data.numero).trim(), fecha: data.fecha ?? "", total: data.total ?? 0,
    source: data.source, filename: data.filename ?? "", hasPdf: !!pdfBlob,
    status: "activa", rows: data.rows,
    createdAt: ts, createdBy: data.user ?? "", updatedAt: ts, updatedBy: data.user ?? "",
  };
  return tx(["invoices", "events", "files"], "readwrite", async (t) => {
    const id = await wrap(t.objectStore("invoices").add(record));
    if (pdfBlob) t.objectStore("files").put({ invoiceId: id, blob: pdfBlob, name: data.filename ?? "factura.pdf" });
    t.objectStore("events").add({
      invoiceId: id, ts, user: data.user ?? "", type: "carga",
      summary: `Factura cargada (${data.source === "manual" ? "manual" : "PDF"}) · ${data.rows.length} productos`,
      detail: [],
    });
    return { ...record, id };
  });
}

/**
 * Actualiza la factura. `info.changes` (lista de diffRows) y/o `info.label` generan una entrada
 * en el historial; si no hay ninguno de los dos no se registra evento.
 */
export async function updateInvoice(id, patch, user, info = {}) {
  return tx(["invoices", "events"], "readwrite", async (t) => {
    const store = t.objectStore("invoices");
    const cur = await wrap(store.get(Number(id)));
    if (!cur) throw new Error("La factura ya no existe.");
    const ts = now();
    const next = { ...cur, ...patch, updatedAt: ts, updatedBy: user ?? "" };
    store.put(next);
    const changes = info.changes ?? [];
    if (changes.length || info.label) {
      const resumen = summarizeChanges(changes);
      t.objectStore("events").add({
        invoiceId: Number(id), ts, user: user ?? "", type: info.type ?? "edicion",
        summary: [info.label, resumen].filter(Boolean).join(": ") || "Cambios",
        detail: changes.slice(0, 300),
      });
    }
    return next;
  });
}

export async function addInvoiceEvent(invoiceId, { type = "operacion", summary, detail = [], user = "" }) {
  return tx(["events"], "readwrite", (t) =>
    wrap(t.objectStore("events").add({ invoiceId: Number(invoiceId), ts: now(), user, type, summary, detail })));
}

/** Historial de la factura, más reciente primero. */
export async function listInvoiceEvents(invoiceId) {
  const list = await tx(["events"], "readonly", (t) =>
    wrap(t.objectStore("events").index("invoiceId").getAll(Number(invoiceId))));
  return list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export async function getInvoicePdf(invoiceId) {
  const f = await tx(["files"], "readonly", (t) => wrap(t.objectStore("files").get(Number(invoiceId))));
  return f?.blob ?? null;
}

/** Anular (conserva todo) o restaurar. */
export async function setInvoiceStatus(id, status, user, reason = "") {
  return tx(["invoices", "events"], "readwrite", async (t) => {
    const store = t.objectStore("invoices");
    const cur = await wrap(store.get(Number(id)));
    if (!cur) throw new Error("La factura ya no existe.");
    const ts = now();
    store.put({ ...cur, status, updatedAt: ts, updatedBy: user ?? "",
      annulReason: status === "anulada" ? reason : "", annulledAt: status === "anulada" ? ts : null });
    t.objectStore("events").add({
      invoiceId: Number(id), ts, user: user ?? "", type: status === "anulada" ? "anulacion" : "restauracion",
      summary: status === "anulada" ? `Factura anulada${reason ? `: ${reason}` : ""}` : "Factura restaurada", detail: [],
    });
  });
}

/** Borrado definitivo (solo admin): factura, PDF e historial. */
export async function deleteInvoice(id) {
  const n = Number(id);
  return tx(["invoices", "events", "files"], "readwrite", async (t) => {
    t.objectStore("invoices").delete(n);
    t.objectStore("files").delete(n);
    const evs = t.objectStore("events");
    const keys = await wrap(evs.index("invoiceId").getAllKeys(n));
    keys.forEach(k => evs.delete(k));
  });
}

// ── Origen externo de los productos ──────────────────────────────────────────────
/**
 * Productos internos (código TKC) que se han comprado a proveedores externos, según las facturas
 * cargadas y no anuladas. Es la fuente del origen "Externo" de la Propuesta de Reabastecimiento.
 * Devuelve Map(código → { supplierId, supplierName, invoiceName, invoiceNumber, invoiceId, invoiceDate, timesBought })
 * con los datos de la factura MÁS RECIENTE de ese código.
 */
export async function listExternalProductOrigins() {
  const all = await tx(["invoices"], "readonly", (t) => wrap(t.objectStore("invoices").getAll()));
  const map = new Map();
  const ordered = all.filter(i => i.status !== "anulada").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const inv of ordered) {
    for (const r of inv.rows ?? []) {
      const cod = String(r.cod ?? "").trim();
      if (!cod) continue;
      map.set(cod, {
        supplierId: inv.supplierId, supplierName: inv.supplierName,
        invoiceName: r.nombreFactura ?? r.nombre, invoiceNumber: inv.numero, invoiceId: inv.id,
        invoiceDate: inv.fecha || inv.createdAt.slice(0, 10),
        timesBought: (map.get(cod)?.timesBought ?? 0) + 1,
      });
    }
  }
  return map;
}

// ── Historial de precios ─────────────────────────────────────────────────────────
/**
 * Para cada fila de `record`, los precios por caja que ese producto tuvo en las demás facturas del
 * mismo proveedor (por código TKC o, si no tiene, por nombre de la factura), del más antiguo al más reciente.
 * Devuelve Map(rowId → [{ invoiceId, numero, fecha, precioCaja }])
 */
export async function priceHistoryForInvoice(record) {
  const all = await tx(["invoices"], "readonly", (t) => wrap(t.objectStore("invoices").getAll()));
  const others = all
    .filter(i => i.supplierId === record.supplierId && i.id !== record.id && i.status !== "anulada")
    .sort((a, b) => ((a.fecha || a.createdAt) < (b.fecha || b.createdAt) ? -1 : 1));
  const out = new Map();
  for (const r of record.rows ?? []) {
    const hist = [];
    for (const inv of others) {
      const match = inv.rows?.find(x => (r.cod && x.cod === r.cod) || (x.nombreFactura ?? x.nombre) === (r.nombreFactura ?? r.nombre));
      if (match) hist.push({ invoiceId: inv.id, numero: inv.numero, fecha: inv.fecha || inv.createdAt.slice(0, 10), precioCaja: match.precioCaja });
    }
    out.set(r.id, hist);
  }
  return out;
}
