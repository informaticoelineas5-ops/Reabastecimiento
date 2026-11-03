// Prueba el lector (hucre) y la interpretación de ofertas con archivos reales. SOLO LECTURA: no llama a ninguna API.
// Uso:  node scripts/test_offer_parser.mjs "<archivo1>" "<archivo2>" …
import fs from "node:fs";
import path from "node:path";
import { readSpreadsheetBuffer } from "../src/utils/spreadsheet.js";
import { SYSTEM_FIELDS, NONE, detectHeaderRow, detectMapping, detectCurrency, buildItems } from "../src/utils/offerParsing.js";

const short = (v) => (v === undefined ? "·" : typeof v === "string" ? JSON.stringify(v.length > 34 ? v.slice(0, 34) + "…" : v) : String(v));

for (const file of process.argv.slice(2)) {
  console.log("\n" + "█".repeat(4), path.basename(file));
  const t0 = performance.now();
  const { sheets } = await readSpreadsheetBuffer(new Uint8Array(fs.readFileSync(file)), file);
  console.log(`  lectura: ${Math.round(performance.now() - t0)} ms · hojas: ${sheets.map(s => `${s.name} (${s.rows.length} filas)`).join(", ")}`);

  const rows = sheets[0].rows;
  const hIdx = detectHeaderRow(rows);
  const headers = rows[hIdx].map(h => String(h ?? "").trim());
  const map = detectMapping(headers);
  console.log(`  fila de encabezados: ${hIdx + 1} → ${JSON.stringify(headers.filter(Boolean))}`);
  console.log("  columnas detectadas:");
  for (const f of SYSTEM_FIELDS) {
    const i = map[f.key];
    console.log(`    ${f.label.padEnd(28)} ${i === NONE ? "— (sin mapear)" : `col ${i + 1} "${headers[i]}"`}${f.required && i === NONE ? "  ← OBLIGATORIO" : ""}`);
  }

  const cur = detectCurrency(rows, hIdx, map.offered_cost);
  console.log("  moneda:", cur ? `${cur.code} (de "${cur.from}")` : "no detectada");

  for (const [label, opts] of [["secciones ON, sin precio omitidos", { currency: cur?.code ?? "USD" }], ["secciones OFF (como antes)", { currency: cur?.code ?? "USD", useSections: false, includeNoPrice: true }]]) {
    const { items, stats } = buildItems(rows, hIdx, map, opts);
    console.log(`\n  ▶ ${label}`);
    console.log(`    ítems a importar: ${items.length} · productos=${stats.productos} secciones=${stats.secciones} sin precio=${stats.sinPrecio} sin nombre=${stats.sinNombre} repetidos=${stats.repetidos} ignoradas=${stats.ignoradas}`);
    if (label.startsWith("secciones ON")) {
      const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
      console.log(`    categorías (${cats.length}): ${JSON.stringify(cats.slice(0, 5))}${cats.length > 5 ? "…" : ""}`);
      items.slice(0, 3).forEach(it => console.log("    ", JSON.stringify(it)));
    } else {
      const falsos = items.filter(i => i.offered_cost === undefined);
      console.log(`    de esos, sin precio (los títulos de sección entrarían como productos): ${falsos.length} · ejemplos: ${JSON.stringify(falsos.slice(0, 3).map(i => i.supplier_product_name.slice(0, 30)))}`);
    }
  }
}
