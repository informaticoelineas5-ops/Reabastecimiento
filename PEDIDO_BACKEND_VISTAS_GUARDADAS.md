# Pedido al backend — Vistas de filtros guardadas por usuario (`saved-views`)

Fecha: 2026-10-22 · API de referencia: REAB v1.4.0

## 1. Qué se necesita

En la pantalla **Propuesta de Reabastecimiento** (y luego en otras) el usuario configura una combinación de filtros y quiere **guardarla con un nombre** para recuperarla después con un clic, sin volver a filtrar. Esas vistas deben guardarse **en la base de datos, por usuario**, para que lo sigan en cualquier equipo o navegador.

El recurso actual `user-preferences` / `auth/me/preferences` **no sirve**: su esquema es cerrado (`additionalProperties: false`, solo `almacen`, `almacenes`, `suministradores`, `selected_indices`) y no admite otro contenido ni varias entradas con nombre.

## 2. Modelo

Tabla `saved_views`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid (o bigint) | PK |
| `user_id` | text/uuid | **lo fija el servidor** desde el token; el cliente no lo envía |
| `screen` | text | identifica la pantalla; hoy `"bodegon-propuesta"`. Mejor texto libre validado (`^[a-z0-9-]{1,64}$`) que un enum, para añadir pantallas sin tocar la API |
| `name` | text | obligatorio, 1–80 caracteres, recortado de espacios |
| `config` | jsonb | objeto con los filtros; **el servidor no lo interpreta**, solo lo valida como objeto JSON y limita su tamaño (≤ 16 KB) |
| `created_at`, `updated_at` | timestamptz | |

Restricción única: `(user_id, screen, lower(name))`.

Ejemplo de `config` actual (puede crecer sin cambios en la API):

```json
{
  "viewMode": "oreste",
  "cobThreshold": 15,
  "tipoOrigen": "interno",
  "origenSel": ["wh:1201"],
  "filtEstados": [],
  "filtCats": ["A", "B"],
  "search": "",
  "indexSlots": ["prom_ventas_diario_top_max_2", "prom_ventas_diario_mayor_0", "prom_ventas_diario_ult_1_mes"]
}
```

## 3. Endpoints

Todos operan **solo sobre las vistas del usuario autenticado**. Una vista ajena responde **404** (como ya hacen `supplier-offers` y `purchase-orders`), nunca 403 ni se filtra su existencia.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/saved-views?screen=…` | lista las vistas propias de esa pantalla (sin `screen`, todas las propias). Paginado y con `count=none` como el resto de listados. Orden: `name` asc |
| POST | `/saved-views` | `{ screen, name, config }` → 201 con la vista. **409** si ya existe ese nombre para el usuario y la pantalla |
| PATCH | `/saved-views/{id}` | `{ name?, config? }` → 200 con la vista. 409 si el nuevo nombre ya existe |
| DELETE | `/saved-views/{id}` | 204 (o 200 con la vista eliminada) |

Formato de respuesta igual al resto de la API: `{ success, data, pagination, meta }`, con `id`, `screen`, `name`, `config`, `created_at`, `updated_at` en cada vista.

## 4. Roles

Es una preferencia **personal**: la puede gestionar **cualquier usuario autenticado, incluido `consulta`**, solo sobre sus propias vistas. Debe quedar así en el `x-roles` del OpenAPI (todos los roles) y la restricción de "solo las propias" debe documentarse igual que en los demás recursos con filtro por usuario.

## 5. Cómo lo consume el frontend (ya implementado)

`src/api/savedViewsStore.js` llama a estos endpoints. Mientras el recurso no exista (la lista responde 404/405/501) trabaja en **modo local** (navegador) y muestra un aviso en el menú *Mis vistas*. **Cuando el backend lo despliegue no hay que tocar el frontend**: la primera carga detecta el recurso, **sube a la BD las vistas que hubiera en el navegador** (sin duplicar nombres) y deja de usar el almacenamiento local.

## 6. Criterios de aceptación

- Un usuario crea una vista desde un equipo y la ve al entrar desde otro.
- Dos usuarios pueden tener una vista con el mismo nombre sin conflicto; el mismo usuario no (409).
- Un usuario no puede leer, modificar ni borrar vistas de otro (404).
- `consulta` puede guardar y usar sus vistas.
- Un `config` mayor de 16 KB o que no sea un objeto devuelve 422.
- Borrar un usuario (si el sistema lo permite) elimina sus vistas, o las deja huérfanas sin romper nada.
