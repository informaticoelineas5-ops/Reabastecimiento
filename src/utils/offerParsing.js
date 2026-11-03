/**
 * Interpretación de las listas de precios de proveedores externos (Excel, CSV o PDF ya convertido a filas).
 * Funciones puras, sin interfaz: detectan encabezados y columnas, la moneda, los títulos de sección
 * y construyen los ítems de la oferta. Se prueban desde Node con archivos reales (ver scripts/test_offer_parser.mjs).
 */

export const NONE = "__none__";

// Campos del sistema y cómo suelen llamarse en los archivos de los proveedores.
// Los candidatos están ya normalizados (minúsculas, sin tildes, espacios simples).
export const SYSTEM_FIELDS = [
  { key: "supplier_product_code", label: "Código Proveedor", required: false,
    candidates: ["codigo prov", "codigo proveedor", "codigo", "code", "cod", "sku", "ref", "referencia"] },
  { key: "supplier_product_name", label: "Nombre del Producto", required: true,
    candidates: ["producto", "nombre", "name", "product", "descripcion", "description", "articulo", "denominacion"] },
  { key: "offered_cost", label: "Precio (costo ofertado)", required: true,
    candidates: ["precio oferta", "precio usd", "precio eur", "precio venta", "precio", "price", "cost", "costo", "valor"] },
  { key: "unit", label: "Unidad", required: false,
    candidates: ["unidad de medida", "unidad", "unit", "um", "udm"] },
  { key: "pack_multiple", label: "Unidad por Caja / Múltiplo", required: false,
    candidates: ["unidad por caja", "unidades por caja", "unid por caja", "unid x caja", "unidades x caja", "uni x caja", "pack", "multiplo", "multiple", "lote"] },
  { key: "min_qty", label: "Cantidad Mínima", required: false,
    candidates: ["pedido minimo", "minimo", "min qty", "cantidad minima", "cant min"] },
  { key: "availability", label: "Disponibilidad / Stock", required: false,
    candidates: ["disponibilidad unidades", "disponibilidad", "disponibles", "disponible", "availability", "stock", "existencia"] },
  { key: "valid_until", label: "Fecha Catálogo / Vigencia", required: false,
    candidates: ["fecha catalogo", "vigencia", "valid until", "vencimiento", "hasta"] },
  { key: "format", label: "Categoría / Formato", required: false,
    candidates: ["categoria", "formato", "format", "presentacion"] },
  { key: "supplier_description", label: "Marca / Descripción", required: false,
    candidates: ["descripcion adicional", "marca", "brand"] },
  { key: "notes", label: "Proveedor / Notas", required: false,
    candidates: ["proveedor", "supplier", "observaciones", "notas", "notes", "comentarios"] },
];

// Orden en que se asignan las columnas: lo más específico primero, para que "Unidad por caja"
// no se quede como "Unidad" y "Descripción adicional" no se quede como nombre.
const DETECT_ORDER = [
  "supplier_product_code", "offered_cost", "pack_multiple", "min_qty", "availability", "valid_until",
  "supplier_description", "format", "notes", "supplier_product_name", "unit",
];

/** "Unid     x caja" → "unid x caja" · "Descripción" → "descripcion" */
export function normHeader(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9€$%]+/g, " ").trim();
}

const matchesCandidate = (h, c) => {
  if (!h) return false;
  if (h === c) return true;
  if (c.length <= 3) return h.split(" ").includes(c);   // "um", "cod", "ref": solo como palabra completa
  return h.includes(c);
};

/** Índice de la primera columna que encaja con los candidatos (exacta antes que parcial), o -1. */
export function detectCol(headers, candidatesRaw, used = new Set()) {
  const norm = headers.map(normHeader);
  const candidates = candidatesRaw.map(normHeader);
  for (const c of candidates) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && h === c);
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && matchesCandidate(h, c));
    if (i >= 0) return i;
  }
  return -1;
}

/** Mapa campo → columna. Una misma columna no se asigna a dos campos. */
export function detectMapping(headers, fields = SYSTEM_FIELDS) {
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const used = new Set();
  const map = {};
  for (const key of DETECT_ORDER) {
    const f = byKey[key];
    if (!f) continue;
    const idx = detectCol(headers, f.candidates, used);
    map[key] = idx >= 0 ? idx : NONE;
    if (idx >= 0) used.add(idx);
  }
  for (const f of fields) if (!(f.key in map)) {
    const idx = detectCol(headers, f.candidates, used);
    map[f.key] = idx >= 0 ? idx : NONE;
    if (idx >= 0) used.add(idx);
  }
  return map;
}

export function normalizeStr(str) {
  return (str || "").toString().toLowerCase().trim().replace(/\s+/g, " ");
}

/** "0,65 €" → 0.65 · "1.234,50" → 1234.5 · 0.65 → 0.65 */
export function parseNumeric(val) {
  if (typeof val === "number") return val;
  const s = String(val ?? "").replace(/[€$\s]/g, "").trim();
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) {
    // El separador que aparece último es el decimal: "1.234,50" (europeo) o "1,234.50" (americano)
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? parseFloat(s.replace(/\./g, "").replace(",", "."))
      : parseFloat(s.replace(/,/g, ""));
  }
  if (s.includes(",")) return parseFloat(s.replace(",", "."));
  return parseFloat(s);
}

/** Cualquier fecha razonable → "YYYY-MM-DD", o null si no se entiende (así la API no la rechaza). */
export function toIsoDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);                 // día/mes/año
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/**
 * Fila de encabezados: la que tiene más texto y menos números, con datos debajo.
 * Ignora títulos y datos de contacto de las primeras filas.
 */
const ALL_CANDIDATES = SYSTEM_FIELDS.flatMap(f => f.candidates);
const isHeaderWord = (c) => typeof c === "string" && ALL_CANDIDATES.some(k => matchesCandidate(normHeader(c), k));
const filledCount = (row) => (row || []).filter(c => c !== null && c !== undefined && c !== "").length;

export function detectHeaderRow(rows) {
  const LIMIT = Math.min(rows.length, 30);
  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < LIMIT; i++) {
    const nonEmpty = rows[i].filter(c => c !== null && c !== undefined && c !== "");
    const textCells = nonEmpty.filter(c => typeof c === "string" && c.length < 60);
    const numericCells = nonEmpty.filter(c => {
      const s = (c || "").toString().replace(/[$,\s]/g, "");
      return s.length > 0 && !isNaN(parseFloat(s));
    });
    // Las celdas que dicen "código", "descripción", "precio"… pesan mucho: son las que delatan un encabezado
    const score = textCells.length * 2 + nonEmpty.length - numericCells.length * 2 + nonEmpty.filter(isHeaderWord).length * 6;
    // Debajo debe haber datos, pero no necesariamente en la fila siguiente: suele venir un título de sección
    // de una sola celda ("ALIMENTOS") o la segunda línea del encabezado antes del primer producto.
    const dataBelow = [1, 2, 3, 4].some(k => filledCount(rows[i + k]) >= 3);
    if (score > bestScore && dataBelow) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

const CURRENCY_RULES = [
  ["EUR", /\b(eur|euro|euros)\b|€/],
  ["USD", /\b(usd|us\$|dolar|dolares)\b/],
  ["CUP", /\bcup\b/],
  ["MLC", /\bmlc\b/],
  ["GBP", /\b(gbp|libras?)\b|£/],
  ["CAD", /\bcad\b/],
];

/**
 * Moneda de los precios según el texto del encabezado de la columna de precio (y las dos filas vecinas:
 * es común un encabezado en dos líneas, "PRECIO" / "VENTA EUROS"). Devuelve { code, from } o null.
 */
export function detectCurrency(rows, headerIdx, priceCol) {
  if (priceCol === undefined || priceCol === NONE || priceCol === null) return null;
  const spots = [[headerIdx, priceCol], [headerIdx + 1, priceCol], [headerIdx + 2, priceCol], [headerIdx - 1, priceCol]];
  for (const [r, c] of spots) {
    const raw = rows[r]?.[c];
    if (raw === undefined || raw === null || raw === "" || typeof raw === "number") continue;
    const text = String(raw).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const [code, re] of CURRENCY_RULES) if (re.test(text)) return { code, from: String(raw).trim() };
  }
  return null;
}

const NUMERIC_FIELDS = ["offered_cost", "min_qty", "pack_multiple", "lead_time_days"];

/**
 * Convierte las filas de la hoja en ítems de la oferta.
 *   opts.currency        moneda que llevan los ítems
 *   opts.useSections     una fila con una sola celda de texto es un TÍTULO de sección: no es un producto
 *                        y su texto pasa a la categoría de los productos que le siguen
 *   opts.includeNoPrice  importar también los productos sin precio (por defecto se omiten)
 * Devuelve { items, stats }.
 */
export function buildItems(rows, headerIdx, colMap, opts = {}) {
  const { currency = "USD", useSections = true, includeNoPrice = false } = opts;
  const has = (k) => colMap[k] !== NONE && colMap[k] !== undefined;
  const nameIdx = colMap.supplier_product_name, codeIdx = colMap.supplier_product_code;
  const numericCols = new Set(["offered_cost", "min_qty", "pack_multiple", "availability"].filter(has).map(k => colMap[k]));
  const priceMapped = has("offered_cost");
  const cellText = (v) => (v === null || v === undefined ? "" : v.toString().trim());

  const data = rows.slice(headerIdx + 1);
  const stats = { filas: 0, productos: 0, secciones: 0, sinPrecio: 0, sinNombre: 0, repetidos: 0, ignoradas: 0, seccionesActivas: false };

  // Si casi todas las filas tienen una sola celda es una lista simple de nombres, no títulos de sección
  const singleInfo = data.map(r => {
    const idxs = r.map((c, i) => (cellText(c) !== "" ? i : -1)).filter(i => i >= 0);
    return { n: idxs.length, only: idxs[0] };
  });
  const filled = singleInfo.filter(x => x.n > 0).length;
  const singles = singleInfo.filter(x => x.n === 1).length;
  const sectionMode = useSections && filled > 0 && singles / filled <= 0.7;
  stats.seccionesActivas = sectionMode;

  const items = [];
  const seenCodes = new Set();
  let section = "";

  data.forEach((row, i) => {
    const info = singleInfo[i];
    if (info.n === 0) return;                         // fila vacía
    stats.filas++;

    if (info.n === 1) {
      const v = row[info.only];
      if (numericCols.has(info.only)) { stats.ignoradas++; return; }   // texto suelto bajo una columna numérica (p. ej. 2ª línea del encabezado)
      if (sectionMode && typeof v === "string") { section = v.trim(); stats.secciones++; return; }
    }

    const name = nameIdx !== undefined && nameIdx !== NONE ? cellText(row[nameIdx]) : "";
    const code = codeIdx !== undefined && codeIdx !== NONE ? cellText(row[codeIdx]) : "";
    // Si falta el nombre se usa el código, pero solo en filas con más datos (no en un título suelto)
    const effectiveName = name || (info.n >= 2 ? code : "");
    if (!effectiveName) { stats.sinNombre++; return; }

    const item = { supplier_product_name: effectiveName, is_valid: true, min_qty: 1, pack_multiple: 1, currency };
    for (const field of SYSTEM_FIELDS) {
      if (field.key === "supplier_product_name") continue;
      const idx = colMap[field.key];
      if (idx === NONE || idx === undefined) continue;
      const val = row[idx];
      if (val === "" || val === undefined || val === null) continue;
      if (NUMERIC_FIELDS.includes(field.key)) {
        const n = parseNumeric(val);
        if (!isNaN(n)) item[field.key] = n;
      } else if (field.key === "valid_until") {
        const d = toIsoDate(val);
        if (d) item.valid_until = d;
      } else {
        item[field.key] = val.toString().trim();
      }
    }
    if (section) item.category = section;

    if (priceMapped && item.offered_cost === undefined) {
      stats.sinPrecio++;
      if (!includeNoPrice) return;
    }
    items.push(item);
  });

  // Códigos repetidos (el mismo producto en varias secciones): se queda la primera aparición
  const out = [];
  for (const item of items) {
    const code = normalizeStr(item.supplier_product_code);
    if (code) {
      if (seenCodes.has(code)) { stats.repetidos++; continue; }
      seenCodes.add(code);
    }
    out.push(item);
  }
  stats.productos = out.length;
  return { items: out, stats };
}
