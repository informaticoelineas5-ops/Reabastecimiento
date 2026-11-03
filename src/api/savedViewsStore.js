/**
 * Vistas (conjuntos de filtros) guardadas por cada usuario y pantalla.
 *
 * Se guardan en la BD a través de la API de REAB (recurso `/saved-views`, ver
 * PEDIDO_BACKEND_VISTAS_GUARDADAS.md); el servidor asocia cada vista al usuario del token.
 *
 * Mientras el backend no tenga ese recurso (la lista responde 404/405/501) el módulo trabaja en
 * "modo local" (localStorage) para no bloquear el uso, y lo avisa con `getSavedViewsMode()`.
 * En cuanto el recurso exista, la siguiente carga sube automáticamente las vistas locales a la BD
 * y borra la copia local. No hay que cambiar nada en las pantallas.
 *
 *   listSavedViews(userId, screen)                        → Promise<[{ id, name, config, createdAt, updatedAt }]>
 *   saveSavedView(userId, screen, { id?, name, config })  → Promise<view>   (crea, o actualiza si trae id)
 *   deleteSavedView(userId, screen, id)                   → Promise<void>
 *   getSavedViewsMode()                                   → "api" | "local"
 *
 * `config` es un JSON libre que define cada pantalla; este módulo no lo interpreta.
 */
import { reabRequest } from "./reabApiClient";

const PATH = "/saved-views";
let mode = "api"; // pasa a "local" si el servidor no tiene el recurso
let missing = false; // el servidor ya dijo que no existe: no se vuelve a preguntar hasta recargar la página

export const getSavedViewsMode = () => mode;

// ── Modo local (solo mientras el backend no tenga el recurso) ────────────────────
const keyFor = (userId, screen) => `reab_saved_views:${screen}:${String(userId || "anon").toLowerCase()}`;

function readLocal(userId, screen) {
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(userId, screen)) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeLocal(userId, screen, list) {
  try {
    localStorage.setItem(keyFor(userId, screen), JSON.stringify(list));
  } catch {
    throw new Error("No se pudo guardar en este navegador (almacenamiento bloqueado o lleno).");
  }
}
const clearLocal = (userId, screen) => { try { localStorage.removeItem(keyFor(userId, screen)); } catch { /* nada */ } };

// ── API ──────────────────────────────────────────────────────────────────────────
const fromApi = (v) => ({
  id: v.id, name: v.name, config: v.config ?? {},
  createdAt: v.created_at ?? v.createdAt, updatedAt: v.updated_at ?? v.updatedAt,
});
const isMissingResource = (err) => [404, 405, 501].includes(err?.status);
const byName = (a, b) => a.name.localeCompare(b.name, "es");

export async function listSavedViews(userId, screen) {
  if (missing) return readLocal(userId, screen).sort(byName);
  try {
    const res = await reabRequest("GET", PATH, { params: { screen, pageSize: 200, count: "none" } });
    mode = "api";

    // Si había vistas guardadas solo en el navegador, se suben a la BD una sola vez
    const local = readLocal(userId, screen);
    if (local.length) {
      const serverNames = new Set((res.data ?? []).map(v => String(v.name).toLowerCase()));
      let failed = 0;
      for (const v of local) {
        if (serverNames.has(v.name.toLowerCase())) continue;
        try { await reabRequest("POST", PATH, { body: { screen, name: v.name, config: v.config } }); }
        catch (err) { if (err.status !== 409) failed++; }
      }
      if (!failed) clearLocal(userId, screen);
      const again = await reabRequest("GET", PATH, { params: { screen, pageSize: 200, count: "none" } });
      return (again.data ?? []).map(fromApi).sort(byName);
    }
    return (res.data ?? []).map(fromApi).sort(byName);
  } catch (err) {
    if (!isMissingResource(err)) throw err;
    mode = "local";
    missing = true;
    return readLocal(userId, screen).sort(byName);
  }
}

export async function saveSavedView(userId, screen, { id, name, config }) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("Ponle un nombre a la vista.");

  if (mode === "api") {
    try {
      const res = id
        ? await reabRequest("PATCH", `${PATH}/${id}`, { body: { name: clean, config } })
        : await reabRequest("POST", PATH, { body: { screen, name: clean, config } });
      return fromApi(res.data ?? res);
    } catch (err) {
      if (err.status === 409) throw new Error(`Ya tienes una vista llamada "${clean}".`);
      throw err;
    }
  }

  const list = readLocal(userId, screen);
  const now = new Date().toISOString();
  if (list.some(v => v.id !== id && v.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Ya tienes una vista llamada "${clean}".`);
  }
  let view;
  const i = id ? list.findIndex(v => v.id === id) : -1;
  if (i >= 0) {
    view = { ...list[i], name: clean, config, updatedAt: now };
    list[i] = view;
  } else {
    view = { id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: clean, config, createdAt: now, updatedAt: now };
    list.push(view);
  }
  writeLocal(userId, screen, list);
  return view;
}

export async function deleteSavedView(userId, screen, id) {
  if (mode === "api") {
    await reabRequest("DELETE", `${PATH}/${id}`);
    return;
  }
  writeLocal(userId, screen, readLocal(userId, screen).filter(v => v.id !== id));
}
