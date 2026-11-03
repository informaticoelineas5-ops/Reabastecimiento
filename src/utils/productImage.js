// Imagen principal del producto por código, redimensionada por el servidor (endpoint público de la API de Elineas).
// sm = 200 px (miniaturas de tabla) · md = 480 px (detalle y carrusel) · lg = original.
const BASE = "https://api.mercadoelineas.com/api/public/products";

// Apagado mientras el servidor responda con `Cross-Origin-Resource-Policy: same-origin`: el navegador bloquea la
// imagen (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) y solo se gastaría una petición extra antes de usar la original.
// Ponerlo en true cuando el backend envíe `Cross-Origin-Resource-Policy: cross-origin` en /api/public/*.
const ENABLED = false;

export const productImageUrl = (codigo, size = "sm") =>
  ENABLED && codigo ?`${BASE}/${encodeURIComponent(String(codigo).trim())}/image?size=${size}` : null;
