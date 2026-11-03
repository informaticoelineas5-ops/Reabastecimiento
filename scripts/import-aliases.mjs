#!/usr/bin/env node
/**
 * Importa asociaciones "código * nombre" a POST /api/v1/product-aliases/bulk.
 *
 * Uso (PowerShell):
 *   $env:REAB_TOKEN = "<JWT>"          # solo para este comando; no se guarda en ningún archivo
 *   node scripts/import-aliases.mjs scripts/data/aliases_lote1.txt              # prueba en seco (no escribe)
 *   node scripts/import-aliases.mjs scripts/data/aliases_lote1.txt --apply      # envía los alias NUEVOS
 *   node scripts/import-aliases.mjs scripts/data/aliases_lote1.txt --apply --overwrite   # además corrige los que ya existen con otro código
 *
 * Sin REAB_TOKEN solo valida el archivo. El token dura ~5 minutos: si caduca, el script lo indica.
 * Formato de cada entrada: "<código> * <nombre>"; las celdas con saltos de línea llegan entre comillas.
 */
import fs from "node:fs";

const API        = "https://apireab.mercadoelineas.com/api/v1";
const CHUNK_SIZE = 500; // máximo del endpoint
const args       = process.argv.slice(2);
const file       = args.find(a => !a.startsWith("--"));
const APPLY      = args.includes("--apply");
const OVERWRITE  = args.includes("--overwrite");
const token      = process.env.REAB_TOKEN?.trim();

if (!file) { console.error("Falta el archivo. Uso: node scripts/import-aliases.mjs <archivo> [--apply] [--overwrite]"); process.exit(1); }

// ── 1. Lectura: una entrada por línea o por celda entre comillas (con saltos de línea) ──────────
function readEntries(text) {
  const t = text.replace(/\r\n?/g, "\n");
  const out = [];
  let i = 0;
  while (i < t.length) {
    if (t[i] === "\n") { i++; continue; }
    let value = "";
    if (t[i] === '"') {
      i++;
      while (i < t.length) {
        if (t[i] === '"') {
          if (t[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++; break;
        }
        value += t[i++];
      }
      while (i < t.length && t[i] !== "\n") i++;
    } else {
      const end = t.indexOf("\n", i);
      const stop = end === -1 ? t.length : end;
      value = t.slice(i, stop);
      i = stop;
    }
    out.push(value);
  }
  return out;
}

// Misma normalización que el lector de facturas: espacios repetidos y saltos → un espacio; sin extremos
const normalize = (s) => s.replace(/\s+/g, " ").trim();

const raw = readEntries(fs.readFileSync(file, "utf8"));
const invalid = [];
const valid = [];
for (const [n, r] of raw.entries()) {
  const s = normalize(r);
  const idx = s.indexOf(" * ");
  const code = idx > 0 ? s.slice(0, idx).trim() : "";
  const name = idx > 0 ? s.slice(idx + 3).trim() : "";
  // Se acepta también el guion tipográfico U+2010: algunos códigos del catálogo (p. ej. 304010‐1) lo llevan y deben conservarse tal cual
  if (!code || !name || !/^[0-9A-Za-z][0-9A-Za-z‐-]*$/.test(code)) {
    invalid.push({ n: n + 1, texto: s });
    continue;
  }
  valid.push({ alias_name: name, product_code: code });
}

// ── 2. Duplicados dentro del archivo ────────────────────────────────────────────────────────────
const byName = new Map();          // alias_name → Set(códigos)
for (const v of valid) {
  if (!byName.has(v.alias_name)) byName.set(v.alias_name, new Set());
  byName.get(v.alias_name).add(v.product_code);
}
const internalConflicts = [...byName].filter(([, codes]) => codes.size > 1);
const unique = [...byName]
  .filter(([, codes]) => codes.size === 1)
  .map(([alias_name, codes]) => ({ alias_name, product_code: [...codes][0] }));
const repetidasIguales = valid.length - byName.size;

console.log(`\nArchivo: ${file}`);
console.log(`  Entradas leídas ............ ${raw.length}`);
console.log(`  Inválidas .................. ${invalid.length}`);
console.log(`  Repetidas idénticas ........ ${repetidasIguales} (se envían una sola vez)`);
console.log(`  Mismo nombre, otro código .. ${internalConflicts.length} (se excluyen)`);
console.log(`  Alias únicos y válidos ..... ${unique.length}`);
if (invalid.length)
  for (const x of invalid) console.log(`    ✗ línea ${x.n}: ${x.texto.slice(0, 100)}`);
for (const [name, codes] of internalConflicts)
  console.log(`    ⚠ "${name}" tiene varios códigos en el archivo: ${[...codes].join(", ")}`);

// ── 3. Comparación con lo que ya existe en el servidor ──────────────────────────────────────────
if (!token) {
  console.log("\nSin REAB_TOKEN: solo se validó el archivo (nada se envió ni se comparó con el servidor).");
  process.exit(0);
}

try {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const left = payload.exp - Math.floor(Date.now() / 1000);
  if (left <= 0) { console.error(`\nEl token caducó hace ${-left} s. Genera uno nuevo e inténtalo de nuevo.`); process.exit(2); }
  console.log(`\nToken válido para ${left} s más (usuario ${payload.email ?? "?"}).`);
} catch { console.log("\nNo se pudo leer la caducidad del token; se continúa."); }

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function fetchAllAliases() {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await api("GET", `/product-aliases?page=${page}&pageSize=200&fields=alias_name,product_code`);
    all.push(...(res.data ?? []));
    if (!res.pagination?.hasNextPage) break;
  }
  return all;
}

const existing = new Map((await fetchAllAliases()).map(a => [a.alias_name, a.product_code]));
const nuevos = [], iguales = [], distintos = [];
for (const u of unique) {
  if (!existing.has(u.alias_name)) nuevos.push(u);
  else if (existing.get(u.alias_name) === u.product_code) iguales.push(u);
  else distintos.push({ ...u, existente: existing.get(u.alias_name) });
}
console.log(`\nComparación con el servidor (${existing.size} alias existentes):`);
console.log(`  Nuevos ..................... ${nuevos.length}`);
console.log(`  Ya existen idénticos ....... ${iguales.length} (se omiten)`);
console.log(`  Existen con OTRO código .... ${distintos.length}${OVERWRITE ? " (se corregirán: --overwrite)" : " (no se tocan; usa --overwrite para corregirlos)"}`);
for (const d of distintos)
  console.log(`    ⚠ "${d.alias_name}"\n        en el servidor: ${d.existente}   ·   en el archivo: ${d.product_code}`);

// ── 4. Envío ────────────────────────────────────────────────────────────────────────────────────
const toSend = OVERWRITE ? [...nuevos, ...distintos.map(({ alias_name, product_code }) => ({ alias_name, product_code }))] : nuevos;

// (Sin process.exit al final: en Windows cerrar con conexiones abiertas dispara un aviso de Node.)
if (!APPLY) {
  console.log(`\nPRUEBA EN SECO: se enviarían ${toSend.length} alias. No se escribió nada. Añade --apply para enviarlos.`);
} else if (!toSend.length) {
  console.log("\nNada que enviar.");
} else {
  console.log(`\nEnviando ${toSend.length} alias en tandas de ${CHUNK_SIZE}…`);
  for (let i = 0; i < toSend.length; i += CHUNK_SIZE) {
    const items = toSend.slice(i, i + CHUNK_SIZE);
    const res = await api("POST", "/product-aliases/bulk", { items });
    console.log(`  tanda ${i / CHUNK_SIZE + 1}: ${items.length} enviados → el servidor guardó ${res.data?.length ?? "?"}`);
  }

  // ── 5. Verificación ───────────────────────────────────────────────────────────────────────────
  const after = new Map((await fetchAllAliases()).map(a => [a.alias_name, a.product_code]));
  const mal = toSend.filter(s => after.get(s.alias_name) !== s.product_code);
  console.log(`\nVerificación: ${toSend.length - mal.length}/${toSend.length} alias correctos en el servidor (${after.size} en total ahora).`);
  for (const m of mal) console.log(`    ✗ "${m.alias_name}" → esperado ${m.product_code}, hay ${after.get(m.alias_name) ?? "nada"}`);
  process.exitCode = mal.length ? 3 : 0;
}
