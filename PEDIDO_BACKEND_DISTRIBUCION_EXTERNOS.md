# Pedido al backend — Distribución Externos (facturas, documento, historial y ejecución)

Fecha: 2026-10-21 · API de referencia: REAB v1.4.0 (`https://apireab.mercadoelineas.com/openapi.json`)

**Este documento reemplaza el "Pedido A" de `PEDIDO_BACKEND_BODEGONES.md`** (la foto de la pantalla con botón *Guardar*). El flujo cambió: ya no existe *Guardar*; la factura es un registro único que se actualiza con cada cambio y deja historial. El "Pedido B" (existencias de origen en `bodegon-product-origin`) sigue vigente en el otro documento.

El frontend ya está construido y funcionando con un almacenamiento **provisional en el navegador** (IndexedDB). Todo lo que se describe aquí es lo que el frontend hoy simula y debe pasar a vivir en el servidor. La interfaz que el frontend usa para ello está en `src/api/externalInvoicesStore.js` y `src/api/externalSuppliersStore.js`: solo hay que reescribir esas funciones con llamadas a la API.

---

## 1. Qué hace la pantalla (resumen funcional)

**Distribución Externos** tiene dos vistas:

1. **Captura / edición** de una factura de un proveedor externo (p. ej. SM23M). Entrada por **PDF** (hoy solo SM23M tiene lector, que corre en el navegador) o **manual** (formulario). La factura trae productos con `U/C`, cajas facturadas/recibidas y precio por caja. El usuario asocia cada producto a un código TKC, calcula una propuesta de distribución (cajas para 1053, 1201, 1882, 1883) y genera dos tipos de scripts que se ejecutan en TKC (sistema externo): **Ajuste AA** (1053) y **Transferencias** a 1201, 1882 y 1883.
2. **Lista de facturas**: tabla con filtros por ID, número de factura, proveedor y estado, y acciones *Editar, Historial, Ver documento, Anular/Restaurar, Eliminar (solo admin)*.

Reglas de negocio:

- **Una factura es única por proveedor + número.** Cargar otra vez la misma ofrece abrir la existente.
- **No hay botón Guardar.** Cada cambio actualiza la factura (el frontend envía los cambios ~1 s después de dejar de escribir) y queda reflejado en su **historial**.
- **Anular ≠ Eliminar.** *Anular* conserva la factura y su historial (reversible: *Restaurar*). *Eliminar* borra todo definitivamente y **solo lo puede hacer `admin`**. Una factura anulada no se edita.
- **Cada factura tiene su documento** (el PDF original). Las facturas manuales no tienen documento.
- **Checks de ejecución por ítem**: cada ítem tiene un estado independiente para *Ajuste AA* y para cada transferencia (1201, 1882, 1883). Una fila ejecutada **no se bloquea** (sigue editable). Las transferencias **no** dependen de que el AA esté hecho.
- **Historial de precios** por producto, para ver cuánto cambió el precio por caja entre facturas del mismo proveedor.

---

## 2. Modelo de datos propuesto

> Nombres orientativos; si el backend prefiere otra convención, el frontend se adapta. Los tipos monetarios y de cantidad deben ser `numeric`, no `float`.

### 2.1 `external-suppliers` (Proveedores Bodegón)

Catálogo de proveedores externos. Hoy el frontend lo guarda solo en el navegador.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid / int | PK |
| `name` | text | único (sin distinguir mayúsculas), obligatorio |
| `parser` | text null | `"mayorista23"` si el frontend sabe leer sus PDF; `null` = solo manual. Lo fija el sistema, no el usuario |
| `active` | bool | por si se quiere desactivar en lugar de borrar |
| `created_at`, `created_by` | | auditoría |

Semilla inicial: `SM23M` con `parser = "mayorista23"`.

### 2.2 `external-invoices` (cabecera)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | int autoincremental | es el **ID** que el usuario ve y filtra en la lista (p. ej. 8239); debe ser corto y legible |
| `supplier_id` | FK `external-suppliers` | |
| `supplier_name` | text | copia desnormalizada del nombre al crear (la lista lo muestra aunque se renombre el proveedor) |
| `invoice_number` | text | número de la factura del proveedor; obligatorio |
| `invoice_date` | date null | |
| `source` | enum `pdf` \| `manual` | |
| `status` | enum `activa` \| `anulada` | |
| `annul_reason`, `annulled_at`, `annulled_by` | | solo si anulada |
| `total` | numeric | suma de `cajas_factura × precio_caja` de los ítems (el servidor puede recalcularlo) |
| `n_items` | int | derivado |
| `n_items_with_code` | int | derivado: ítems con `product_code` |
| `exec_summary` | json | ver 2.5; derivado, para pintar la columna *Ajustes* de la lista sin traer los ítems |
| `document_id` | FK `external-invoice-files` null | |
| `version` | int | contador para control de concurrencia (ver 3.3) |
| `created_at`, `created_by`, `updated_at`, `updated_by` | | |

**Restricción única**: `(supplier_id, invoice_number)` — incluye las anuladas. Un intento de duplicado debe responder **409** con el `id` de la existente (el frontend lo usa para ofrecer "abrir la existente").

### 2.3 `external-invoice-items` (productos de la factura)

Una fila por producto. Es lo que hoy el frontend llama "fila" y guarda como arreglo dentro de la factura.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK. El frontend genera hoy un id local por fila; si el servidor asigna el suyo, devolverlo al crear |
| `invoice_id` | FK | |
| `position` | int | orden de la fila en la factura |
| `invoice_name` | text | **nombre original de la factura** (no se edita; es la clave del alias) |
| `name` | text | nombre editable por el usuario |
| `product_code` | text null | código TKC asociado (puede ser null = producto *Nuevo*) |
| `initial_code` | text null | **CodInicial**: últimos 6 dígitos que da el cliente para los productos nuevos |
| `is_new` | bool | marca *Nuevo* (editable a mano) |
| `is_created` | bool | marca *Creado* (editable a mano) |
| `uc` | int | unidades por caja |
| `boxes_invoiced` | numeric | cajas facturadas |
| `boxes_received` | numeric | cajas recibidas |
| `price_box` | numeric | precio por caja |
| `boxes_1053`, `boxes_1201`, `boxes_1882`, `boxes_1883` | numeric | resultado de la distribución (cajas por destino) |
| `exec_aa`, `exec_1201`, `exec_1882`, `exec_1883` | json null | check de ejecución, ver 2.5 |

Hoy `distributions` (el recurso existente) guarda parte de esto como auditoría. Si el backend prefiere **reutilizar `distributions` como tabla de ítems** añadiéndole `invoice_id` y los campos que faltan, es válido; lo importante es el contrato de la sección 3.

### 2.4 `external-invoice-files` (documento)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `invoice_id` | FK único | un documento por factura |
| `filename` | text | nombre original |
| `content_type` | text | `application/pdf` |
| `size` | int | bytes |
| `sha256` | text | hash del archivo; permite detectar el mismo PDF cargado dos veces |
| `storage_key` | text | ubicación en el almacenamiento (disco, S3…) |
| `uploaded_at`, `uploaded_by` | | |

Tamaño máximo sugerido: 20 MB. Solo `application/pdf`.

### 2.5 Checks de ejecución

Por ítem y por objetivo (`aa`, `1201`, `1882`, `1883`), el campo `exec_*` guarda:

```json
{ "at": "2026-10-21T14:32:10Z", "by": "usuario@dominio", "qty": 240 }
```

- `null` = pendiente.
- `qty` = **unidades** que se ejecutaron (AA: `boxes_received × uc`; transferencia: `boxes_destino × uc`). Se guarda para detectar que **la cantidad cambió después de ejecutar**: si `qty` ≠ cantidad actual, el ítem se considera *modificado tras ejecutar* (no cuenta como completo y el frontend lo marca en ámbar).
- El estado lo fija el usuario con una confirmación explícita ("Ya lo ejecuté en TKC"); el sistema **no** puede saber si TKC ejecutó realmente.

`exec_summary` (en la cabecera, derivado por el servidor) tiene esta forma, y es lo que consume la lista:

```json
{
  "complete": false,
  "aa":    { "done": 12, "total": 21 },
  "t1201": { "done": 0,  "total": 5  },
  "w1882": { "done": 0,  "total": 7  },
  "z1883": { "done": 0,  "total": 4  }
}
```

Definiciones (el frontend las calcula igual hoy):

- *Ítem aplicable* a un objetivo: tiene `product_code` y cantidad en unidades > 0 para ese objetivo.
- `done`: aplicables con `exec_*` no nulo **y** `qty` igual a la cantidad actual.
- `total`: aplicables.
- `complete` (**factura completamente ajustada**): `aa.total > 0`, existe al menos una transferencia con `total > 0` (es decir, ya hay distribución calculada) y, para cada objetivo con `total > 0`, `done == total`.

### 2.6 `external-invoice-events` (historial)

Registro **inmutable** (solo se agrega) de lo ocurrido en la factura.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint | |
| `invoice_id` | FK | índice |
| `ts` | timestamptz | |
| `user` | text | email del usuario |
| `type` | enum | `carga`, `edicion`, `propuesta`, `script`, `ejecucion`, `anulacion`, `restauracion` |
| `summary` | text | una línea legible, p. ej. `"Cód. TKC ×2, Cajas recibidas ×1"` |
| `detail` | json | lista de cambios: `[{ "item": "<nombre>", "field": "Cód. TKC", "before": "—", "after": "810146503606" }]` |

Qué se registra:

| `type` | Cuándo |
|---|---|
| `carga` | creación de la factura (PDF o manual) con nº de productos |
| `edicion` | cambios de campos de ítems agrupados por actualización: código TKC, nombre, U/C, cajas, precio, cajas por destino, marcas Nuevo/Creado, ítems agregados/quitados |
| `propuesta` | el usuario calculó o recalculó la propuesta de distribución |
| `script` | se copió el script de Ajuste AA o de una transferencia (con nº de líneas) |
| `ejecucion` | se marcó o desmarcó el check de ejecución de uno o varios ítems de un objetivo |
| `anulacion` / `restauracion` | con motivo opcional |

**Recomendación: que el servidor genere los eventos de `edicion`/`ejecucion`/`carga`/`anulacion`/`restauracion` comparando antes y después** (así el historial no depende de que el cliente lo envíe bien). Los eventos `propuesta` y `script` son acciones del usuario sin cambio de datos propio, así que el cliente los envía con `POST …/events`.

### 2.7 Historial de precios (derivado, sin tabla propia)

Para un producto: los `price_box` que tuvo en las demás facturas **activas** del mismo proveedor, ordenados por fecha. Se identifica por `product_code` o, si no tiene código, por `invoice_name`. Se ve en dos sitios: junto al precio de cada ítem (▲▼ y tooltip con los anteriores) y en la pestaña *Precios* del historial de la factura (precio actual, precio anterior, variación %).

---

## 3. Endpoints propuestos

Convenciones de la API REAB actuales (listados paginados, `fields`, filtros). Roles: ver sección 4.

### 3.1 Proveedores externos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/external-suppliers` | lista (con `active`) |
| POST | `/external-suppliers` | crear `{ name }` → 409 si el nombre ya existe |
| PATCH | `/external-suppliers/{id}` | renombrar / activar-desactivar |
| DELETE | `/external-suppliers/{id}` | solo si no tiene facturas (o desactivar) |

### 3.2 Facturas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/external-invoices` | lista **sin ítems** (columnas de la lista). Filtros: `id`, `invoice_number` (contiene), `supplier_id`, `status` (`activa`/`anulada`/todas), `created_at` rango. Orden por `id` desc. Debe devolver `exec_summary`, `n_items`, `n_items_with_code`, `total`, `has_document` |
| GET | `/external-invoices/{id}` | la factura **con todos sus ítems** (para abrirla en la tabla) |
| GET | `/external-invoices/lookup?supplier_id=&invoice_number=` | para comprobar si ya existe antes de crear (alternativa: basarse solo en el 409 del POST) |
| POST | `/external-invoices` | crea la factura con sus ítems `{ supplier_id, invoice_number, invoice_date, source, items:[…] }`. 409 si existe, con `{ existing_id, status }`. Genera el evento `carga` |
| PATCH | `/external-invoices/{id}` | actualiza **cabecera y/o ítems** en una sola llamada (ver 3.3). Genera eventos `edicion`/`ejecucion` por comparación. Rechaza (409/422) si `status = anulada` |
| POST | `/external-invoices/{id}/annul` | `{ reason? }` → `status = anulada`, evento `anulacion` |
| POST | `/external-invoices/{id}/restore` | → `status = activa`, evento `restauracion` |
| DELETE | `/external-invoices/{id}` | borrado definitivo: factura, ítems, documento y eventos. **Solo `admin`** |

### 3.3 Autoguardado y concurrencia

El frontend envía cambios cada ~1 s tras la última edición, así que habrá **muchas escrituras pequeñas** y puede haber **dos personas editando la misma factura**.

Propuesta:

- `PATCH /external-invoices/{id}` recibe `version` (la que el cliente leyó) y solo los **ítems cambiados** (`items: [{ id, …campos }]`), más `items_added` / `items_removed_ids` si aplica. Alternativa aceptable: reenviar todos los ítems (una factura típica tiene 20–60).
- Si `version` no coincide → **409** con la versión actual; el frontend recarga y avisa. Al guardar bien, devuelve la factura con `version + 1`.
- Cada PATCH recalcula `total`, `n_items`, `n_items_with_code` y `exec_summary`.
- Un PATCH puede incluir `event_label` + `event_type` (p. ej. `"Propuesta calculada"` / `propuesta`, o `"Ajuste AA 1053: ejecutado · 12 ítems"` / `ejecucion`) para que el evento generado lleve el contexto de la acción.

### 3.4 Documento

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/external-invoices/{id}/document` | `multipart/form-data` con el PDF. Valida tipo y tamaño, calcula `sha256`. El frontend lo sube justo después de crear la factura PDF |
| GET | `/external-invoices/{id}/document` | descarga/streaming del PDF (`Content-Disposition: inline`) para *Ver documento*. Debe poder abrirse en una pestaña nueva con el token de sesión (o devolver una URL firmada de corta vida) |
| DELETE | `/external-invoices/{id}/document` | opcional, solo admin |

Creación de factura PDF en el frontend: `POST /external-invoices` y luego `POST …/document`. Si se prefiere una sola llamada multipart (JSON + archivo), también es válido.

Extra útil: al subir, si ya existe **otra** factura con el mismo `sha256` en el mismo proveedor, devolver aviso.

### 3.5 Historial

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/external-invoices/{id}/events` | historial, más reciente primero, paginado |
| POST | `/external-invoices/{id}/events` | registra eventos de acción sin cambio de datos: `{ type: "script"\|"propuesta", summary, detail? }` |

No se ofrece edición ni borrado de eventos (salvo `DELETE` de la factura, que los arrastra).

### 3.6 Historial de precios

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/external-invoices/{id}/price-history` | para cada ítem de la factura, el arreglo de precios previos: `{ item_id, history:[{ invoice_id, invoice_number, invoice_date, price_box }] }`, solo facturas **activas** del mismo proveedor, anteriores por fecha |

Si el backend prefiere una consulta por producto (`GET /external-invoice-items/price-history?supplier_id=&product_code=|invoice_name=`), también sirve.

### 3.7 Checks de ejecución (atajo opcional)

Los checks viajan dentro del `PATCH` de ítems (campos `exec_*`). Si se quiere un endpoint dedicado para que las confirmaciones no compitan con las ediciones:

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/external-invoices/{id}/executions` | `{ target: "aa"\|"1201"\|"1882"\|"1883", item_ids: […], executed: true\|false }` → el servidor fija `at`, `by` y `qty` (la cantidad **actual** del ítem), actualiza `exec_summary` y genera **un** evento `ejecucion` con el nº de ítems |

Este endpoint es más seguro (el servidor pone `at`, `by` y `qty`, el cliente no puede falsearlos) y es **el preferido**; en ese caso el PATCH general no debe permitir modificar `exec_*`.

---

## 4. Roles y permisos

Los roles de Bodegones se están redefiniendo aparte (cardista e inventarista de Bodegones, distintos a los del REAB general). **Este documento no los fija.** Lo que sí necesita el backend para esta funcionalidad es poder distinguir:

| Acción | Quién (provisional: lo que el cliente indicó hasta ahora) |
|---|---|
| Ver lista y abrir facturas, ver historial y documento | roles de Bodegones |
| Crear y editar facturas, asociar códigos, confirmar ejecución, anular/restaurar | roles de Bodegones (cardista e inventarista de Bodegones, ambos igual por ahora; se afinará) |
| **Eliminar definitivamente** | **solo `admin`** |
| Gestionar `external-suppliers` | pendiente de definir (en el frontend hoy: admin, supervisor, analista) |

Importante: **el menú del frontend no es seguridad.** Estas reglas deben imponerse en la API. Cuando se definan los roles de Bodegones, cada operación necesita su `x-roles` en el OpenAPI.

---

## 5. Lo que el frontend ya hace (y no hay que replicar en el servidor)

- Leer el PDF de SM23M (parser en el navegador). El servidor recibe ítems ya estructurados y el PDF como archivo.
- Calcular la **propuesta de distribución** (fórmula de la hoja del cliente con índices de venta). El servidor guarda el resultado en `boxes_*`.
- Alertas de **CodInicial** que no coincide con el código TKC (aviso, no bloquea).
- Marcar *Nuevo* / *Creado* automáticamente (Nuevo = sin código, Creado = con código), editable a mano.
- Copiar los scripts (`codigo*unidades`) para TKC. Solo se incluyen los ítems **sin check**; los que cambiaron después de ejecutarse se omiten y se avisa.

## 6. Reutiliza lo que ya existe

- `product-aliases` (nombre de factura → código TKC): ya conectado. Sigue siendo global por nombre exacto.
- `bodegon-product-origin`: sin cambios en este pedido.
- Alta de códigos de producto: sin cambios.

## 7. Migración de lo que hay en los navegadores

Hasta que esto exista, las facturas y proveedores están solo en el navegador de cada usuario y **no se comparten ni se migran**. Opciones:

1. **Empezar de cero** (recomendada si solo hay pruebas).
2. Si ya hay facturas reales cargadas, el frontend puede incluir una acción única "Subir mis facturas locales" que las envíe con `POST /external-invoices` (409 = ya existe, se omite). Avísennos si la necesitan.

## 8. Preguntas abiertas para el backend

1. ¿`external-invoice-items` como tabla nueva o ampliar `distributions` con `invoice_id` y los campos extra?
2. Almacenamiento de PDF: ¿disco del servidor, S3/objeto, o campo binario? ¿Límite de tamaño real?
3. ¿Control de concurrencia con `version` + 409 es aceptable? ¿Prefieren `If-Match`/ETag?
4. ¿Generan ustedes los eventos por diferencia (recomendado) o prefieren que el cliente los envíe todos?
5. ¿Cómo se identifican los roles de Bodegones en la API (se resuelve junto con el tema de roles/Identity que se está hablando por separado)?
6. ¿Pueden entregar primero **facturas + ítems + documento** (lo mínimo para dejar de depender del navegador) y después **historial, precios y ejecuciones**?

## 9. Criterios de aceptación

- Crear una factura PDF y otra manual; la lista las muestra con ID, proveedor, nº, nº de productos y total.
- Crear una factura repetida (mismo proveedor y número) devuelve 409 con el `id` de la existente.
- Editar un ítem desde dos sesiones a la vez no pierde cambios en silencio (409 con versión).
- *Ver documento* abre el PDF original de una factura PDF; en una manual no hay documento.
- Cada cambio de código, cantidad, precio o check queda en el historial con usuario, fecha y antes/después.
- Marcar ejecución de 5 ítems en AA genera un solo evento `ejecucion` y `exec_summary.aa.done` sube en 5; cambiar después la cantidad de uno de ellos deja de contarlo como hecho.
- Con todos los objetivos aplicables completos, `exec_summary.complete = true` (la lista muestra *Completa*).
- Anular conserva todo y bloquea la edición; restaurar la reactiva; eliminar solo funciona para `admin` y borra documento e historial.
- `price-history` devuelve para un ítem los precios de las facturas anteriores activas del mismo proveedor.
