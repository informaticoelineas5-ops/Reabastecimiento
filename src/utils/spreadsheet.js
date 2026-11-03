/**
 * Lectura de hojas de cálculo (xlsx, xls, xlsb, ods, csv…) con hucre.
 * Devuelve las hojas como matrices de filas, listas para el importador:
 *   - celdas vacías → ""  ·  fechas → "YYYY-MM-DD"  ·  números → number  ·  texto → string
 *   - se descartan las filas vacías al principio y al final (como hacía la lectura anterior)
 * Nada de esto toca la interfaz: se puede usar y probar desde Node.
 */
import { read as hucreRead } from "hucre";

const isEmpty = (v) => v === "" || v === null || v === undefined;
const pad = (n) => String(n).padStart(2, "0");

function normalizeCell(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // Las fechas de Excel se leen como UTC: se usan los componentes UTC para no desplazar el día.
    // Se suman 90 s: algunos programas guardan la fecha a las 23:59:2x del día anterior (redondeo de la
    // hora local) y sin esa tolerancia saldría un día antes.
    const d = new Date(v.getTime() + 90 * 1000);
    if (d.getUTCFullYear() < 1950) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`; // celda de solo hora
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

function trimRows(rows) {
  let a = 0, b = rows.length;
  while (a < b && rows[a].every(isEmpty)) a++;
  while (b > a && rows[b - 1].every(isEmpty)) b--;
  return rows.slice(a, b);
}

// Los CSV de Excel en español suelen venir en Windows-1252: UTF-8 si es válido, si no Windows-1252
function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Lee un archivo desde sus bytes. `filename` solo se usa para distinguir los CSV de texto. */
export async function readSpreadsheetBuffer(bytes, filename = "") {
  const data = /\.(csv|tsv|txt)$/i.test(filename) ? new TextEncoder().encode(decodeText(bytes)) : bytes;
  const wb = await hucreRead(data, { dates: "date" });
  const sheets = wb.sheets
    .map((s) => ({ name: s.name, rows: trimRows((s.rows ?? []).map((r) => r.map(normalizeCell))) }))
    .filter((s) => s.rows.length > 0);
  if (!sheets.length) throw new Error("El archivo no tiene hojas con datos.");
  return { sheets };
}

/** Lee un File del navegador. */
export async function readSpreadsheetFile(file) {
  return readSpreadsheetBuffer(new Uint8Array(await file.arrayBuffer()), file.name);
}
