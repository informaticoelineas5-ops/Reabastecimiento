/**
 * Proveedores externos de Bodegones (SM23M y similares).
 *
 * PROVISIONAL: mientras el backend no tenga el recurso, la lista se guarda solo en este navegador
 * (localStorage). No se comparte con otros usuarios ni con otros equipos.
 *
 * Para conectarlo al backend basta con reescribir estas funciones; las pantallas solo usan esta interfaz:
 *   loadExternalSuppliers()          → Promise<[{ id, name, parser }]>
 *   saveExternalSupplier({id?,name}) → Promise<supplier>   (crea o renombra)
 *   deleteExternalSupplier(id)       → Promise<void>
 *
 * `parser` indica si hay lector de PDF para ese proveedor ("mayorista23") o null (solo entrada manual).
 */

const KEY = "reab_external_suppliers_provisional";

const SEED = [{ id: "sm23m", name: "SM23M", parser: "mayorista23" }];

function readAll() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(list) && list.length) return list;
  } catch { /* se usa la lista inicial */ }
  return SEED.map(s => ({ ...s }));
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("No se pudo guardar en este navegador (almacenamiento bloqueado o lleno).");
  }
}

export async function loadExternalSuppliers() {
  return readAll().sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function saveExternalSupplier({ id, name }) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("El nombre es obligatorio.");
  const list = readAll();
  if (list.some(s => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Ya existe un proveedor llamado "${clean}".`);
  }
  if (id) {
    const i = list.findIndex(s => s.id === id);
    if (i < 0) throw new Error("El proveedor ya no existe.");
    list[i] = { ...list[i], name: clean };
    writeAll(list);
    return list[i];
  }
  const created = {
    id: `ext-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    parser: null,
  };
  writeAll([...list, created]);
  return created;
}

export async function deleteExternalSupplier(id) {
  const list = readAll().filter(s => s.id !== id);
  writeAll(list.length ? list : SEED.map(s => ({ ...s })));
}
