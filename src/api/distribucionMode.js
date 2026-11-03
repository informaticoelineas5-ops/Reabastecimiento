/**
 * ¿Está el backend de Distribución Externos desplegado?
 *
 *   "api"   → /external-invoices existe: facturas, proveedores externos, PDF, historial y ejecución viven en el servidor.
 *   "local" → el servidor responde 404 (aún no desplegado): se usan los almacenes provisionales del navegador,
 *             igual que antes, y las pantallas avisan de ello.
 *
 * Se decide una sola vez por carga de la página. Un error distinto de 404 (red, 401, 500) NO se cachea ni
 * degrada a "local": se propaga para no guardar datos en el navegador por una caída momentánea.
 */
import { reabRequest } from "./reabApiClient";

let modePromise = null;

export function getDistribucionMode() {
  if (!modePromise) {
    modePromise = reabRequest("GET", "/external-invoices", { params: { pageSize: 1, count: "none" } })
      .then(() => "api")
      .catch((err) => {
        if (err.status === 404) return "local";
        modePromise = null;
        throw err;
      });
  }
  return modePromise;
}

export const isApiMode = async () => (await getDistribucionMode()) === "api";

/** Mensaje legible de un error de la API REAB (usa error.message del sobre si viene). */
export function apiErrorMessage(err) {
  const m = err?.body?.error?.message;
  const d = err?.body?.error?.details;
  const detail = Array.isArray(d) && d.length ? ` (${d.map(x => x.message ?? x.field ?? x).join("; ")})` : "";
  return m ? `${m}${detail}` : (err?.message ?? "Error desconocido");
}
