# Reabastecimiento — pedido al backend (roles, estados y campos de línea)

Verificado en producción v1.5.0 con cuentas `comercial` y `analista`. «Propios» = `created_by` = usuario.

## 1. Roles: cambios necesarios

| Endpoint | Rol | Cambio | Error actual |
|---|---|---|---|
| `PATCH /purchase-orders/{id}` | comercial | Permitir en sus pedidos con `approval_status = draft` aunque `status = pendiente_revision` («Enviar a IC»: `approval_status`; fechas clave) | 403 «solo puede modificar pedidos en estado 'borrador'» |
| `DELETE /purchase-orders/{id}` | comercial | Igual que arriba | 403 (mismo mensaje) |
| `DELETE /purchase-order-items/{id}` | comercial | Líneas de sus pedidos con `approval_status = draft` (o borrado en cascada al borrar el pedido) | 403 «reservada a admin, supervisor» |
| `POST /offer-item-price-history` | comercial | Permitir (se registra al importar una oferta) | 403 «reservada a admin, supervisor» |

Necesarios por el flujo, **no probados** (faltó cuenta revisor/admin):

| Endpoint | Rol | Operación |
|---|---|---|
| `PATCH /purchase-orders/{id}` | comercial | `comercial_notified = true`; fechas clave; `confirmation_status` (pedido en `confirmado` o posterior) |
| `PATCH /purchase-orders/{id}` | analista, revisor | Fechas clave (pedido en `confirmado` o posterior) |
| `POST /purchase-orders/{id}/transition` | comercial | `confirmado → enviado` |
| `PATCH /purchase-order-items/{id}` | comercial | `acceptance_status` (pedido en `enviado`) |

Verificado correcto, sin cambios: comercial crea pedido y líneas, recalcula y pasa `borrador → pendiente_revision`; analista edita `final_qty`, recalcula y pasa a Revisor (`approval_status`, `ic_reviewed_*`).

## 2. Estados nuevos de pedido: `en_transito`, `pagado`
Añadir al enum de `status` (respuesta y filtros `status`, `status_in`) y a `POST /purchase-orders/{id}/transition`:

| Transición | Roles |
|---|---|
| `enviado → en_transito` | admin, supervisor, comercial, analista |
| `en_transito → pagado` | admin, supervisor, comercial, analista |
| `pagado → recibido` / `parcialmente_recibido` | admin, supervisor, comercial, analista |
| `en_transito`, `pagado` → `cancelado` | como hoy |

Antes de `pagado` el front hace `PATCH` de `paid_at`, `paid_by`, `payment_reference` (campos ya existentes): mismos roles, pedido en `en_transito`.

## 3. Campos nuevos en la línea (`/purchase-order-items`)
| Campo | Tipo | Quién lo escribe | Cuándo |
|---|---|---|---|
| `confirmed_qty` | número, nullable | comercial | pedido en `enviado` (importar confirmación del proveedor; `null` al restablecer) |
| `paid_qty` | número, nullable | comercial, analista | pedido en `en_transito` (modal de pago) |

Aceptarlos en `POST` y `PATCH`; devolverlos en `GET`, `/purchase-orders/{id}/detail` y `/items`.

## 4. Matriz por endpoint
✅ permitido hoy · 🔧 hay que añadir · · sin acceso y no hace falta.

### supplier-offers

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `POST /supplier-offers/{id}/recalculate` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /supplier-offers/{id}/items` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /supplier-offers` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /supplier-offers` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /supplier-offers/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /supplier-offers/{id}` | ✅ | ✅ | ✅ | · | · | · | · |
| `DELETE /supplier-offers/{id}` | ✅ | ✅ | · | · | · | · | · |

### supplier-offer-items

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /supplier-offer-items` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /supplier-offer-items` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /supplier-offer-items/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /supplier-offer-items/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `DELETE /supplier-offer-items/{id}` | ✅ | ✅ | · | · | · | · | · |

### supplier-offer-item-matches

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /supplier-offer-item-matches` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /supplier-offer-item-matches` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /supplier-offer-item-matches/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /supplier-offer-item-matches/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /supplier-offer-item-matches/{id}` | ✅ | ✅ | ✅ | · | · | · | · |

### offer-item-matches

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /offer-item-matches` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /offer-item-matches` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /offer-item-matches/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /offer-item-matches/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `DELETE /offer-item-matches/{id}` | ✅ | ✅ | · | · | · | · | · |

### offer-item-price-history

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /offer-item-price-history` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /offer-item-price-history` | ✅ | ✅ | 🔧 | · | · | · | · |
| `GET /offer-item-price-history/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `DELETE /offer-item-price-history/{id}` | ✅ | ✅ | · | · | · | · | · |

### purchase-orders

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `POST /purchase-orders/{id}/transition` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /purchase-orders/{id}/recalculate` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /purchase-orders/{id}/detail` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `GET /purchase-orders/{id}/items` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `GET /purchase-orders` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `POST /purchase-orders` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /purchase-orders/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `PATCH /purchase-orders/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `DELETE /purchase-orders/{id}` | ✅ | ✅ | ✅ | · | · | · | · |

### purchase-order-items

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /purchase-order-items` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `POST /purchase-order-items` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /purchase-order-items/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| `PATCH /purchase-order-items/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `DELETE /purchase-order-items/{id}` | ✅ | ✅ | 🔧 | · | · | · | · |

### replenishment-proposals

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /replenishment-proposals` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /replenishment-proposals` | ✅ | ✅ | ✅ | · | · | · | · |
| `GET /replenishment-proposals/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /replenishment-proposals/{id}` | ✅ | ✅ | ✅ | · | · | · | · |
| `DELETE /replenishment-proposals/{id}` | ✅ | ✅ | · | · | · | · | · |

### suppliers

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `POST /suppliers/bulk` | ✅ | ✅ | · | · | · | · | · |
| `GET /suppliers/{id}/contacts` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /suppliers` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /suppliers` | ✅ | ✅ | · | · | · | · | · |
| `GET /suppliers/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /suppliers/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /suppliers/{id}` | ✅ | ✅ | · | · | · | · | · |

### supplier-contacts

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /supplier-contacts` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /supplier-contacts` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `GET /supplier-contacts/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /supplier-contacts/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /supplier-contacts/{id}` | ✅ | ✅ | · | · | · | · | · |

### products

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /products/pending-units-per-box` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /products` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /products` | ✅ | ✅ | · | · | · | · | · |
| `GET /products/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /products/{id}` | ✅ | ✅ | · | ✅ | · | · | · |
| `DELETE /products/{id}` | ✅ | ✅ | · | · | · | · | · |

### product-aliases

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `POST /product-aliases/bulk` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| `GET /product-aliases` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /product-aliases` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| `GET /product-aliases/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /product-aliases/{id}` | ✅ | ✅ | ✅ | ✅ | · | · | · |
| `DELETE /product-aliases/{id}` | ✅ | ✅ | · | · | · | · | · |

### offers

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /offers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /offers` | ✅ | ✅ | · | · | · | · | · |
| `GET /offers/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /offers/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /offers/{id}` | ✅ | ✅ | · | · | · | · | · |

### inventory-snapshots

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /inventory-snapshots` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /inventory-snapshots` | ✅ | ✅ | · | · | · | · | · |
| `GET /inventory-snapshots/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /inventory-snapshots/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /inventory-snapshots/{id}` | ✅ | ✅ | · | · | · | · | · |

### sales-index

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /sales-index` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /sales-index` | ✅ | ✅ | · | · | · | · | · |
| `GET /sales-index/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `PATCH /sales-index/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /sales-index/{id}` | ✅ | ✅ | · | · | · | · | · |

### params

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /params` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /params` | ✅ | ✅ | · | · | · | · | · |
| `GET /params/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /params/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /params/{id}` | ✅ | ✅ | · | · | · | · | · |

### system-variables

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /system-variables/effective` | ✅ | ✅ | · | · | · | · | · |
| `GET /system-variables` | ✅ | ✅ | · | · | · | · | · |
| `POST /system-variables` | ✅ | ✅ | · | · | · | · | · |
| `GET /system-variables/{id}` | ✅ | ✅ | · | · | · | · | · |
| `PATCH /system-variables/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /system-variables/{id}` | ✅ | ✅ | · | · | · | · | · |

### supplier-variable-overrides

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /supplier-variable-overrides` | ✅ | ✅ | · | · | · | · | · |
| `POST /supplier-variable-overrides` | ✅ | ✅ | · | · | · | · | · |
| `GET /supplier-variable-overrides/{id}` | ✅ | ✅ | · | · | · | · | · |
| `PATCH /supplier-variable-overrides/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /supplier-variable-overrides/{id}` | ✅ | ✅ | · | · | · | · | · |

### connectors

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /connectors` | ✅ | ✅ | · | · | · | · | · |
| `POST /connectors` | ✅ | ✅ | · | · | · | · | · |
| `GET /connectors/{id}` | ✅ | ✅ | · | · | · | · | · |
| `PATCH /connectors/{id}` | ✅ | ✅ | · | · | · | · | · |
| `DELETE /connectors/{id}` | ✅ | ✅ | · | · | · | · | · |

### import-logs

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /import-logs` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `POST /import-logs` | ✅ | ✅ | · | · | · | · | · |
| `GET /import-logs/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |

### user-preferences

| Endpoint | admin | superv. | comercial | analista | revisor | inventario | consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /user-preferences` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /user-preferences` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /user-preferences/{user_id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /user-preferences/{user_id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `DELETE /user-preferences/{user_id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 5. Confirmaciones
1. ¿`DELETE /purchase-orders/{id}` borra las líneas en cascada?
2. ¿`created_by` se toma del token? Hoy el front lo envía.
3. Borrar los pedidos de prueba (proveedor «ZZ PRUEBA ROLES»): `6f8a7bc7-0b28-4bda-a9f0-dd1ee3a9dfb3`, `2a5dc1d1-bdbb-48b7-b276-3c4f6ccf29fb`, `15ff954d-a729-4da3-988f-f501a0589020`.
