# Permisos de Reabastecimiento por rol

Generado desde el OpenAPI de la API REAB (`x-roles` de cada operación). Formato `recurso:acción`, igual que en Transferencias Bodegon.

## Convención

| Acción | Operación de la API |
|---|---|
| `read` | `GET` (listados, detalle y sublistados) |
| `create` | `POST` sobre la colección |
| `update` | `PATCH` / `PUT` |
| `delete` | `DELETE` |
| `bulk` | `POST …/bulk` (alta o corrección en bloque) |
| `transition` | `POST …/transition` (cambio de estado de un pedido) |
| `recalculate` | `POST …/recalculate` |

El `recurso` es el nombre de la ruta de la API (`/api/v1/<recurso>`). Se omiten `auth`, `meta` y `health`, que no requieren un rol concreto.

> **Importante.** Hoy la API REAB decide con el **nombre del rol** (se lo pregunta a Identity en cada petición) y no lee permisos. Asignar estos permisos en Identity no cambia por sí solo lo que un usuario puede hacer, hasta que el backend haga que la API los consulte. Hay además reglas que un permiso no puede expresar y que la API aplica por dato: `comercial` solo ve y modifica los pedidos y ofertas que creó él, y el estado del pedido decide quién puede modificarlo.

## admin (96 permisos)

```
bodegon-product-origin:bulk
bodegon-product-origin:create
bodegon-product-origin:delete
bodegon-product-origin:read
bodegon-product-origin:update
connectors:create
connectors:delete
connectors:read
connectors:update
distributions:create
distributions:delete
distributions:read
import-logs:create
import-logs:read
inventory-snapshots:create
inventory-snapshots:delete
inventory-snapshots:read
inventory-snapshots:update
offer-bodegones:create
offer-bodegones:delete
offer-bodegones:read
offer-item-matches:create
offer-item-matches:delete
offer-item-matches:read
offer-item-matches:update
offer-item-price-history:create
offer-item-price-history:delete
offer-item-price-history:read
offers:create
offers:delete
offers:read
offers:update
params:create
params:delete
params:read
params:update
product-aliases:bulk
product-aliases:create
product-aliases:delete
product-aliases:read
product-aliases:update
products:create
products:delete
products:read
products:update
purchase-order-items:create
purchase-order-items:delete
purchase-order-items:read
purchase-order-items:update
purchase-orders:create
purchase-orders:delete
purchase-orders:read
purchase-orders:recalculate
purchase-orders:transition
purchase-orders:update
replenishment-proposals:create
replenishment-proposals:delete
replenishment-proposals:read
replenishment-proposals:update
sales-index:create
sales-index:delete
sales-index:read
sales-index:update
supplier-contacts:create
supplier-contacts:delete
supplier-contacts:read
supplier-contacts:update
supplier-offer-item-matches:create
supplier-offer-item-matches:delete
supplier-offer-item-matches:read
supplier-offer-item-matches:update
supplier-offer-items:create
supplier-offer-items:delete
supplier-offer-items:read
supplier-offer-items:update
supplier-offers:create
supplier-offers:delete
supplier-offers:read
supplier-offers:recalculate
supplier-offers:update
supplier-variable-overrides:create
supplier-variable-overrides:delete
supplier-variable-overrides:read
supplier-variable-overrides:update
suppliers:create
suppliers:delete
suppliers:read
suppliers:update
system-variables:create
system-variables:delete
system-variables:read
system-variables:update
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## supervisor (96 permisos)

```
bodegon-product-origin:bulk
bodegon-product-origin:create
bodegon-product-origin:delete
bodegon-product-origin:read
bodegon-product-origin:update
connectors:create
connectors:delete
connectors:read
connectors:update
distributions:create
distributions:delete
distributions:read
import-logs:create
import-logs:read
inventory-snapshots:create
inventory-snapshots:delete
inventory-snapshots:read
inventory-snapshots:update
offer-bodegones:create
offer-bodegones:delete
offer-bodegones:read
offer-item-matches:create
offer-item-matches:delete
offer-item-matches:read
offer-item-matches:update
offer-item-price-history:create
offer-item-price-history:delete
offer-item-price-history:read
offers:create
offers:delete
offers:read
offers:update
params:create
params:delete
params:read
params:update
product-aliases:bulk
product-aliases:create
product-aliases:delete
product-aliases:read
product-aliases:update
products:create
products:delete
products:read
products:update
purchase-order-items:create
purchase-order-items:delete
purchase-order-items:read
purchase-order-items:update
purchase-orders:create
purchase-orders:delete
purchase-orders:read
purchase-orders:recalculate
purchase-orders:transition
purchase-orders:update
replenishment-proposals:create
replenishment-proposals:delete
replenishment-proposals:read
replenishment-proposals:update
sales-index:create
sales-index:delete
sales-index:read
sales-index:update
supplier-contacts:create
supplier-contacts:delete
supplier-contacts:read
supplier-contacts:update
supplier-offer-item-matches:create
supplier-offer-item-matches:delete
supplier-offer-item-matches:read
supplier-offer-item-matches:update
supplier-offer-items:create
supplier-offer-items:delete
supplier-offer-items:read
supplier-offer-items:update
supplier-offers:create
supplier-offers:delete
supplier-offers:read
supplier-offers:recalculate
supplier-offers:update
supplier-variable-overrides:create
supplier-variable-overrides:delete
supplier-variable-overrides:read
supplier-variable-overrides:update
suppliers:create
suppliers:delete
suppliers:read
suppliers:update
system-variables:create
system-variables:delete
system-variables:read
system-variables:update
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## comercial (48 permisos)

```
bodegon-product-origin:read
distributions:read
import-logs:read
inventory-snapshots:read
offer-bodegones:create
offer-bodegones:delete
offer-bodegones:read
offer-item-matches:create
offer-item-matches:read
offer-item-matches:update
offer-item-price-history:read
offers:read
params:read
product-aliases:bulk
product-aliases:create
product-aliases:read
product-aliases:update
products:read
purchase-order-items:create
purchase-order-items:read
purchase-order-items:update
purchase-orders:create
purchase-orders:delete
purchase-orders:read
purchase-orders:recalculate
purchase-orders:transition
purchase-orders:update
replenishment-proposals:create
replenishment-proposals:read
replenishment-proposals:update
sales-index:read
supplier-contacts:create
supplier-contacts:read
supplier-offer-item-matches:create
supplier-offer-item-matches:delete
supplier-offer-item-matches:read
supplier-offer-items:create
supplier-offer-items:read
supplier-offer-items:update
supplier-offers:create
supplier-offers:read
supplier-offers:recalculate
supplier-offers:update
suppliers:read
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## analista (42 permisos)

```
bodegon-product-origin:bulk
bodegon-product-origin:create
bodegon-product-origin:delete
bodegon-product-origin:read
bodegon-product-origin:update
distributions:create
distributions:read
import-logs:read
inventory-snapshots:read
offer-bodegones:read
offer-item-matches:create
offer-item-matches:read
offer-item-matches:update
offer-item-price-history:read
offers:read
params:read
product-aliases:bulk
product-aliases:create
product-aliases:read
product-aliases:update
products:read
products:update
purchase-order-items:read
purchase-order-items:update
purchase-orders:read
purchase-orders:recalculate
purchase-orders:transition
purchase-orders:update
replenishment-proposals:read
sales-index:read
supplier-contacts:create
supplier-contacts:read
supplier-offer-item-matches:create
supplier-offer-item-matches:read
supplier-offer-items:read
supplier-offer-items:update
supplier-offers:read
suppliers:read
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## revisor (33 permisos)

```
bodegon-product-origin:read
distributions:read
import-logs:read
inventory-snapshots:read
offer-bodegones:read
offer-item-matches:create
offer-item-matches:read
offer-item-matches:update
offer-item-price-history:read
offers:read
params:read
product-aliases:read
products:read
purchase-order-items:read
purchase-order-items:update
purchase-orders:read
purchase-orders:recalculate
purchase-orders:transition
purchase-orders:update
replenishment-proposals:read
sales-index:read
supplier-contacts:create
supplier-contacts:read
supplier-offer-item-matches:create
supplier-offer-item-matches:read
supplier-offer-items:read
supplier-offer-items:update
supplier-offers:read
suppliers:read
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## inventario (11 permisos)

```
inventory-snapshots:read
offers:read
params:read
product-aliases:read
products:read
purchase-order-items:read
purchase-orders:read
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## consulta (9 permisos)

```
inventory-snapshots:read
offers:read
params:read
product-aliases:read
products:read
user-preferences:create
user-preferences:delete
user-preferences:read
user-preferences:update
```

## Catálogo completo de permisos (96)

| Permiso | Roles |
|---|---|
| `bodegon-product-origin:bulk` | admin, supervisor, analista |
| `bodegon-product-origin:create` | admin, supervisor, analista |
| `bodegon-product-origin:delete` | admin, supervisor, analista |
| `bodegon-product-origin:read` | admin, supervisor, comercial, analista, revisor |
| `bodegon-product-origin:update` | admin, supervisor, analista |
| `connectors:create` | admin, supervisor |
| `connectors:delete` | admin, supervisor |
| `connectors:read` | admin, supervisor |
| `connectors:update` | admin, supervisor |
| `distributions:create` | admin, supervisor, analista |
| `distributions:delete` | admin, supervisor |
| `distributions:read` | admin, supervisor, comercial, analista, revisor |
| `import-logs:create` | admin, supervisor |
| `import-logs:read` | admin, supervisor, comercial, analista, revisor |
| `inventory-snapshots:create` | admin, supervisor |
| `inventory-snapshots:delete` | admin, supervisor |
| `inventory-snapshots:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `inventory-snapshots:update` | admin, supervisor |
| `offer-bodegones:create` | admin, supervisor, comercial |
| `offer-bodegones:delete` | admin, supervisor, comercial |
| `offer-bodegones:read` | admin, supervisor, comercial, analista, revisor |
| `offer-item-matches:create` | admin, supervisor, comercial, analista, revisor |
| `offer-item-matches:delete` | admin, supervisor |
| `offer-item-matches:read` | admin, supervisor, comercial, analista, revisor |
| `offer-item-matches:update` | admin, supervisor, comercial, analista, revisor |
| `offer-item-price-history:create` | admin, supervisor |
| `offer-item-price-history:delete` | admin, supervisor |
| `offer-item-price-history:read` | admin, supervisor, comercial, analista, revisor |
| `offers:create` | admin, supervisor |
| `offers:delete` | admin, supervisor |
| `offers:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `offers:update` | admin, supervisor |
| `params:create` | admin, supervisor |
| `params:delete` | admin, supervisor |
| `params:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `params:update` | admin, supervisor |
| `product-aliases:bulk` | admin, supervisor, comercial, analista |
| `product-aliases:create` | admin, supervisor, comercial, analista |
| `product-aliases:delete` | admin, supervisor |
| `product-aliases:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `product-aliases:update` | admin, supervisor, comercial, analista |
| `products:create` | admin, supervisor |
| `products:delete` | admin, supervisor |
| `products:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `products:update` | admin, supervisor, analista |
| `purchase-order-items:create` | admin, supervisor, comercial |
| `purchase-order-items:delete` | admin, supervisor |
| `purchase-order-items:read` | admin, supervisor, comercial, analista, revisor, inventario |
| `purchase-order-items:update` | admin, supervisor, comercial, analista, revisor |
| `purchase-orders:create` | admin, supervisor, comercial |
| `purchase-orders:delete` | admin, supervisor, comercial |
| `purchase-orders:read` | admin, supervisor, comercial, analista, revisor, inventario |
| `purchase-orders:recalculate` | admin, supervisor, comercial, analista, revisor |
| `purchase-orders:transition` | admin, supervisor, comercial, analista, revisor |
| `purchase-orders:update` | admin, supervisor, comercial, analista, revisor |
| `replenishment-proposals:create` | admin, supervisor, comercial |
| `replenishment-proposals:delete` | admin, supervisor |
| `replenishment-proposals:read` | admin, supervisor, comercial, analista, revisor |
| `replenishment-proposals:update` | admin, supervisor, comercial |
| `sales-index:create` | admin, supervisor |
| `sales-index:delete` | admin, supervisor |
| `sales-index:read` | admin, supervisor, comercial, analista, revisor |
| `sales-index:update` | admin, supervisor |
| `supplier-contacts:create` | admin, supervisor, comercial, analista, revisor |
| `supplier-contacts:delete` | admin, supervisor |
| `supplier-contacts:read` | admin, supervisor, comercial, analista, revisor |
| `supplier-contacts:update` | admin, supervisor |
| `supplier-offer-item-matches:create` | admin, supervisor, comercial, analista, revisor |
| `supplier-offer-item-matches:delete` | admin, supervisor, comercial |
| `supplier-offer-item-matches:read` | admin, supervisor, comercial, analista, revisor |
| `supplier-offer-item-matches:update` | admin, supervisor |
| `supplier-offer-items:create` | admin, supervisor, comercial |
| `supplier-offer-items:delete` | admin, supervisor |
| `supplier-offer-items:read` | admin, supervisor, comercial, analista, revisor |
| `supplier-offer-items:update` | admin, supervisor, comercial, analista, revisor |
| `supplier-offers:create` | admin, supervisor, comercial |
| `supplier-offers:delete` | admin, supervisor |
| `supplier-offers:read` | admin, supervisor, comercial, analista, revisor |
| `supplier-offers:recalculate` | admin, supervisor, comercial |
| `supplier-offers:update` | admin, supervisor, comercial |
| `supplier-variable-overrides:create` | admin, supervisor |
| `supplier-variable-overrides:delete` | admin, supervisor |
| `supplier-variable-overrides:read` | admin, supervisor |
| `supplier-variable-overrides:update` | admin, supervisor |
| `suppliers:create` | admin, supervisor |
| `suppliers:delete` | admin, supervisor |
| `suppliers:read` | admin, supervisor, comercial, analista, revisor |
| `suppliers:update` | admin, supervisor |
| `system-variables:create` | admin, supervisor |
| `system-variables:delete` | admin, supervisor |
| `system-variables:read` | admin, supervisor |
| `system-variables:update` | admin, supervisor |
| `user-preferences:create` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `user-preferences:delete` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `user-preferences:read` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
| `user-preferences:update` | admin, supervisor, comercial, analista, revisor, inventario, consulta |
