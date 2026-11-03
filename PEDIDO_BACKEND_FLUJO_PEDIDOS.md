# Pedido al backend: flujo de pedidos de compra (estados, campos de línea y permisos)

## Contexto
El front de Pedidos de Compra tiene un flujo ya definido y en uso. Al conectarlo con la API (esquemas estrictos, 422 «Unrecognized keys») hemos adaptado todo lo que se podía del lado del front (estado por `/transition`, totales por `/recalculate`, sin `confirmed_at`/`confirmed_by` en el cuerpo). Faltan **tres cosas que solo el backend puede dar**. Sin ellas, parte del flujo no funciona.

Flujo que el front necesita:

```
borrador → pendiente_revision → confirmado → enviado → en_transito → pagado → recibido
                                   (cualquiera, salvo recibido/cancelado → cancelado)
```
Más, en paralelo, el flujo de aprobación con `approval_status`: draft → pending_ic → pending_review → approved (esto ya funciona con los campos actuales).

## 1. Estados nuevos: `en_transito` y `pagado`
Hoy el enum de `status` y `POST /purchase-orders/{id}/transition` solo admiten `borrador, pendiente_revision, confirmado, enviado, parcialmente_recibido, recibido, cancelado`.

Pedimos añadir `en_transito` y `pagado`, con estas transiciones (además de las actuales):
- `enviado` → `en_transito`, `cancelado`
- `en_transito` → `pagado`, `cancelado`
- `pagado` → `recibido`, `parcialmente_recibido`, `cancelado`

(`parcialmente_recibido` y `recibido` se mantienen como hoy; `enviado → recibido` directo puede seguir permitido.)
Al pasar a `pagado` el front guarda antes `paid_at`, `paid_by` y `payment_reference` (campos que ya existen en el pedido).
Añadir ambos valores también a los filtros `status` / `status_in` y al enum de la respuesta.

## 2. Campos nuevos en la línea del pedido (`/purchase-order-items`)
- `confirmed_qty`: número, nullable. Cantidad que confirma el proveedor para esa línea (se importa desde su Excel; se pone a `null` al «Restablecer confirmación»).
- `paid_qty`: número, nullable. Cantidad realmente pagada de esa línea (modal de Pago). Si es `null` el front usa `final_qty`.

Deben aceptarse en `POST` y `PATCH` de `/purchase-order-items`, y devolverse en los GET y en `/purchase-orders/{id}/detail` y `/items`.
`acceptance_status` ya existe y se queda como está.

## 3. Permisos por rol (lo que el front permitía hasta ahora)
Hoy la API solo deja a `comercial` modificar sus pedidos en `borrador`, y a `analista`/`revisor` los que están en `pendiente_revision`; `admin`/`supervisor` todo. Eso rompe el flujo existente. Necesitamos:

| Rol | Acción | Estado de partida | Cómo |
|---|---|---|---|
| comercial | «Enviar a IC»: cambiar `approval_status` (a `pending_ic`) en un pedido propio | `pendiente_revision` | PATCH |
| comercial | Marcar «Enviado» (tras descargar el PDF y mandarlo al proveedor) | `confirmado` con `approval_status = approved` | transition |
| comercial | Guardar fechas clave (`fecha_limite_pago`, `fecha_estimada_llegada`) y marcar `comercial_notified = true` | `confirmado` en adelante | PATCH |
| comercial | Importar confirmación del proveedor (`confirmed_qty` en líneas + `confirmation_status` en el pedido) y revisarla | `enviado` | PATCH líneas y pedido |
| comercial y analista | `enviado → en_transito` | `enviado` (con `confirmation_status` que empiece por `reviewed`) | transition |
| comercial y analista | `en_transito → pagado` (+ `paid_qty` en líneas, `paid_at`, `paid_by`, `payment_reference`) | `en_transito` | transition + PATCH |
| comercial y analista | `pagado → recibido` | `pagado` | transition |
| analista | Editar `final_qty` de líneas y pasar a «pending_review» (`approval_status`, `ic_reviewed_by`, `ic_reviewed_at`) | `pendiente_revision` | PATCH (ya permitido) |
| revisor | Editar cantidades y aprobar (`approval_status = approved`, `approved_by`, `approved_at`, `comercial_notified = false`) y `pendiente_revision → confirmado` | `pendiente_revision` | PATCH + transition (ya permitido) |
| comercial | Eliminar un pedido propio en `borrador` | `borrador` | DELETE |

«Propio» = `created_by` igual al usuario, como hoy. No hace falta abrir pedidos ajenos.

## 4. Dos confirmaciones
1. **Eliminar pedido:** el front borra una a una las líneas y luego el pedido, pero `DELETE /purchase-order-items/{id}` es solo `admin`/`supervisor`. ¿`DELETE /purchase-orders/{id}` elimina las líneas en cascada? Si sí, quitamos el borrado de líneas del front y el comercial puede borrar su borrador.
2. **Crear pedido:** ¿qué estado toma por defecto un pedido nuevo (suponemos `borrador`)? ¿`created_by` se toma del token o hay que enviarlo (hoy lo enviamos)?
