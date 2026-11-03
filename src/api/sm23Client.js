/**
 * sm23Client.js — API client para el módulo Distribución Externos.
 * Asociaciones: conectadas a /api/v1/product-aliases.
 * Ofertas (guardar/historial): PENDIENTE — las rutas /sm23/* de abajo no existen en la API real;
 * devuelven mock vacío y registran un warning hasta definir el flujo con el backend.
 */

import { tokenStore } from './tokenStore';
import { reabRequest } from './reabApiClient';
import { fetchPagesParallel } from './paginate';

const BASE = 'https://apireab.mercadoelineas.com/api/v1/sm23';

function authHeaders() {
  const t = tokenStore.get();
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`sm23 ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json().catch(() => null);
}

// ── Associations ──────────────────────────────────────────────────────────────

// Las asociaciones «nombre de la factura → código TKC» viven en /product-aliases (global, no depende
// del proveedor; el nombre se compara exacto). Aquí se exponen con la forma { name_key, internal_code }.

const ALIAS_PAGE_SIZE = 200;

/** Devuelve todas las asociaciones guardadas { name_key, internal_code }[] */
export async function fetchSm23Associations() {
  try {
    const getPage = (page) => reabRequest('GET', '/product-aliases', {
      params: { page, pageSize: ALIAS_PAGE_SIZE, fields: 'alias_name,product_code' },
    });
    const first = await getPage(1);
    const rest  = await fetchPagesParallel(first.pagination?.totalPages ?? 1, getPage);
    return [first, ...rest]
      .flatMap(res => res.data ?? [])
      .map(a => ({ name_key: a.alias_name, internal_code: a.product_code }));
  } catch (err) {
    console.error('[sm23Client] no se pudieron cargar las asociaciones:', err.message);
    return [];
  }
}

/**
 * Crea o corrige asociaciones (hasta 500 por petición). Lanza error si el servidor rechaza la petición.
 * @param {{ name_key: string, internal_code: string }[]} associations
 */
export async function saveSm23Associations(associations) {
  if (!associations.length) return null;
  const items = associations.map(a => ({
    alias_name:   String(a.name_key).trim(),
    product_code: String(a.internal_code).trim(),
  }));
  return reabRequest('POST', '/product-aliases/bulk', { body: { items } });
}

// ── Offers ────────────────────────────────────────────────────────────────────

/**
 * Guarda una oferta completa (cabecera + items).
 * @returns {{ id: string } | null}
 */
export async function saveSm23Offer(offer, items) {
  try {
    return await apiFetch('POST', '/offers', { offer, items });
  } catch (err) {
    console.warn('[sm23Client] saveSm23Offer — backend pendiente:', err.message);
    return null;
  }
}

/**
 * Lista el historial de ofertas importadas (más recientes primero).
 * @returns {{ data: object[], total: number }}
 */
export async function fetchSm23Offers(limit = 20, offset = 0) {
  try {
    return await apiFetch('GET', `/offers?limit=${limit}&offset=${offset}`);
  } catch (err) {
    console.warn('[sm23Client] fetchSm23Offers — backend pendiente:', err.message);
    return { data: [], total: 0 };
  }
}

/**
 * Items de una oferta específica.
 * @returns {object[]}
 */
export async function fetchSm23OfferItems(offerId) {
  try {
    return await apiFetch('GET', `/offers/${offerId}/items`);
  } catch (err) {
    console.warn('[sm23Client] fetchSm23OfferItems — backend pendiente:', err.message);
    return [];
  }
}

/**
 * Actualiza campos parciales de un item (cantidades de distribución, código, etc.).
 */
export async function patchSm23OfferItem(offerId, itemId, fields) {
  try {
    return await apiFetch('PATCH', `/offers/${offerId}/items/${itemId}`, fields);
  } catch (err) {
    console.warn('[sm23Client] patchSm23OfferItem — backend pendiente:', err.message);
    return null;
  }
}
