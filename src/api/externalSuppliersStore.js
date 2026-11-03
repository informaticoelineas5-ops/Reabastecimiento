/**
 * Proveedores externos de Bodegones (SM23M y similares).
 *
 * Con el backend desplegado viven en la tabla `suppliers` con is_external = true (y `parser` si hay lector
 * de PDF); si el servidor aún no los tiene se usa la lista provisional del navegador (externalSuppliersLocal).
 *
 *   loadExternalSuppliers()          → Promise<[{ id, name, parser }]>
 *   saveExternalSupplier({id?,name}) → Promise<supplier>   (crea o renombra)
 *   deleteExternalSupplier(id)       → Promise<{ deactivated }>
 *
 * Reglas del servidor: el nombre es único (sin distinguir mayúsculas) entre externos; `is_external` no se
 * cambia tras crear; un externo con facturas no se borra: se desactiva (is_active = false).
 */
import { reabRequest } from "./reabApiClient";
import { getDistribucionMode, apiErrorMessage } from "./distribucionMode";
import * as local from "./externalSuppliersLocal";

const toSupplier = (s) => ({ id: s.id, name: s.name, parser: s.parser ?? null, isActive: s.is_active !== false });

export async function loadExternalSuppliers() {
  if ((await getDistribucionMode()) === "local") return local.loadExternalSuppliers();
  const res = await reabRequest("GET", "/suppliers", {
    params: { is_external: true, pageSize: 200, sortBy: "name", sortOrder: "asc", count: "none" },
  });
  return (res.data ?? []).map(toSupplier).filter(s => s.isActive);
}

export async function saveExternalSupplier({ id, name }) {
  if ((await getDistribucionMode()) === "local") return local.saveExternalSupplier({ id, name });
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("El nombre es obligatorio.");
  try {
    const res = id
      ? await reabRequest("PATCH", `/suppliers/${id}`, { body: { name: clean } })
      : await reabRequest("POST", "/suppliers", { body: { name: clean, is_external: true, is_active: true } });
    return toSupplier(res.data ?? res);
  } catch (err) {
    if (err.status === 409 || err.status === 422) throw new Error(apiErrorMessage(err));
    throw err;
  }
}

export async function deleteExternalSupplier(id) {
  if ((await getDistribucionMode()) === "local") { await local.deleteExternalSupplier(id); return { deactivated: false }; }
  try {
    await reabRequest("DELETE", `/suppliers/${id}`);
    return { deactivated: false };
  } catch (err) {
    if (err.status !== 409) throw err;
    // Tiene facturas: no se borra, se desactiva (deja de aparecer en la lista)
    await reabRequest("PATCH", `/suppliers/${id}`, { body: { is_active: false } });
    return { deactivated: true };
  }
}
