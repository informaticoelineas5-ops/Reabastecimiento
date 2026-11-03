/**
 * Unidades por caja (U/C) de los productos TKC.
 *
 * PROVISIONAL: mientras el backend no tenga el endpoint para guardar U/C por código, los valores se
 * guardan solo en este navegador (localStorage). No se comparten con otros usuarios ni con otros equipos.
 *
 * Para conectarlo al backend basta con reescribir estas dos funciones; la pantalla U/C Pendientes
 * solo usa esta interfaz:
 *   loadUnitsPerBox()                   → Promise<{ [codigoTKC]: number }>
 *   saveUnitsPerBox(codigo, uc, nombre) → Promise<void>   (lanzar Error si el servidor lo rechaza)
 */

const KEY = "reab_uc_provisional";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") || {}; } catch { return {}; }
}

export async function loadUnitsPerBox() {
  const all = readAll();
  return Object.fromEntries(Object.entries(all).map(([codigo, v]) => [codigo, v.uc]));
}

export async function saveUnitsPerBox(codigo, uc, nombre = "") {
  const all = readAll();
  all[codigo] = { uc, nombre, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    throw new Error("No se pudo guardar en este navegador (almacenamiento bloqueado o lleno).");
  }
}
