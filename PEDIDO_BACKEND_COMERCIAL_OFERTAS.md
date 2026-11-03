# Pedido al backend: el rol `comercial` debe poder LEER todas las ofertas de proveedor

## Situación actual
Según el OpenAPI de la API REAB, estas operaciones filtran por usuario cuando el rol es `comercial`; los registros ajenos responden `404` (no `403`):

- `GET /api/v1/supplier-offers`
- `GET /api/v1/supplier-offers/{id}`
- `GET /api/v1/offer-bodegones` y `GET /api/v1/offer-bodegones/{id}` ("`comercial` solo ve los bodegones de las ofertas que importó él")

Resultado: un comercial solo ve en "Ofertas Proveedor" las que él importó, y necesita ver **todas**.

## Cambio solicitado
1. **Lectura abierta para `comercial`** (sin filtro por usuario) en:
   - `GET /supplier-offers` y `GET /supplier-offers/{id}`
   - `GET /offer-bodegones` y `GET /offer-bodegones/{id}`
   - Los ítems de oferta (`supplier-offers/items` / equivalente), para que el detalle de una oferta ajena cargue completo.
2. **Escritura sin cambios** (siguen limitadas a lo propio, ajenos → `404`):
   - `PATCH` y `DELETE /supplier-offers/{id}`
   - `POST /supplier-offers/{id}/recalculate`
   - `POST` y `DELETE /offer-bodegones`
3. **Fuera de alcance:** `purchase-orders` y `purchase-order-items` mantienen el filtro actual.

## Referencia
`analista` y `revisor` ya tienen lectura de estos recursos; se pide el mismo comportamiento de lectura para `comercial`.

## Cómo probarlo
Con un usuario `comercial` que no importó la oferta X:
- `GET /supplier-offers` incluye la oferta X → hoy no aparece.
- `GET /supplier-offers/{X}` responde `200` → hoy `404`.
- `PATCH /supplier-offers/{X}` sigue respondiendo `404`.

## Lado frontend (pendiente de la confirmación del backend)
Se quita el filtro por dueño en las pantallas de ofertas y se mantiene la restricción de editar/borrar a lo propio.
