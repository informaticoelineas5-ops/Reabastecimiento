# Pedido al backend — Módulo Bodegones (REAB)

Fecha: 2026-10-19 · API de referencia: E-Líneas · API de Reabastecimiento v1.4.0 (`https://apireab.mercadoelineas.com/openapi.json`)

Este documento contiene dos pedidos independientes, con todo el contexto necesario para implementarlos sin conocer el frontend:

- **Pedido A** — `distributions`: que el botón **Guardar** de la vista *Distribución SM23M* deje una copia completa (una "foto") de la pantalla.
- **Pedido B** — `bodegon-product-origin`: añadir a la respuesta la existencia y la cantidad en tienda del producto en su almacén de origen (necesario para la vista *Propuesta Bodegones*).

Al final hay una lista de **preguntas abiertas** (sección 4) que necesitamos que el backend responda antes o durante la implementación.

---

## 1. Contexto

### 1.1 Qué es el módulo Bodegones

El sistema REAB (Reabastecimiento) es una SPA React que consume dos APIs:

- **API REAB** (`apireab.mercadoelineas.com/api/v1`): la API de este documento. Guarda orígenes, alias, ofertas, distribuciones, parámetros, etc.
- **API Elineas** (`api.mercadoelineas.com/api`): datos operativos de TKC (catálogo `ap-latest` por almacén, índices de venta `rdp-ind-general-*`, productos por almacén).

El módulo **Bodegones** gestiona el reabastecimiento de cuatro almacenes/tiendas bodegón. Sus claves TKC son:

| Bodegón | Clave TKC | ID de almacén en Elineas (`/api/products?almacenes=`) |
|---|---|---|
| Principal | `1053` | 797 |
| Destino | `1201` | 1012 |
| Destino | `1882` | 1825 |
| Destino | `1883` | 1826 |

Una compra externa (al proveedor **Mayorista 23**, abreviado **SM23**) llega al `1053` y se reparte entre los cuatro.

### 1.2 Vista "Distribución SM23M" (donde actúa el Pedido A)

Flujo del usuario:

1. Importa el PDF de la factura de Mayorista 23. El frontend extrae cada línea: nombre del producto, cajas facturadas, precio por caja, y el U/C (unidades por caja) que viene escrito en el nombre, p. ej. `(24 x 395 g / 14 oz)` → U/C = 24.
2. Asocia cada línea con un **código TKC**. La asociación `nombre de la factura → código` se guarda en `product-aliases` (ya funciona). Para productos nuevos, otro usuario le pasa al cliente los **últimos 6 dígitos** del código (*CodInicial*) y el sistema busca el código completo.
3. Marca productos como **Nuevo** (hay que darles entrada en TKC) y luego como **Creado** (ya se les dio entrada).
4. El sistema **propone** cuántas cajas van a cada bodegón. Lógica (réplica de la columna AP de la hoja "TD BD REAB"):
   - Para cada bodegón: `I.AVG = (Ult. 6 meses + Prom. diario>0 + Prom. diario>0) / 3`.
   - Objetivo = `I.AVG × 30 días`; stock máximo = `CEILING(objetivo, U/C)`.
   - Propuesta del bodegón = `CEILING( EF < objetivo ? objetivo − EF : stockMáx − EF , U/C )`, con `EF` = existencia actual del producto en ese bodegón.
   - Las propuestas negativas (exceso) cuentan como 0; se calcula el porcentaje de cada propuesta sobre la suma y se reparten las cajas recibidas por el método del mayor resto (la suma siempre es exacta).
5. El usuario puede ajustar las cajas de cada bodegón a mano.
6. La pantalla genera **scripts** `código*unidades` para el sistema externo de TKC, que es el que ejecuta los movimientos:
   - **Ajuste AA 1053**: da entrada al `1053` a todo lo recibido de la factura.
   - **Transferencia** desde el `1053` a `1201`, `1882` y `1883`.
7. **Guardar** debería dejar constancia de todo esto. **Hoy no guarda nada** (el frontend apuntaba a rutas que no existen y ya muestra un aviso honesto de "No se guardó nada").

> Importante: la API REAB **no ejecuta** transferencias; el propio doc de `distributions` lo dice. Solo se registra lo que el usuario decidió.

### 1.3 Vista "Propuesta Bodegones" (donde actúa el Pedido B)

Muestra los productos del bodegón `1053` con su estado de stock, cobertura, origen y una propuesta de reabastecimiento. Replica la tabla dinámica **"TD Reab Elineas"** de un cliente (Oreste), que aplica estos cuatro filtros:

| Columna de la hoja | Condición |
|---|---|
| Cobert. * Días | menor que 20 |
| Cant. Exist. almacén de origen | mayor que 1 |
| Propuesta Ideal | mayor que 1 |
| Cant. en tienda almacén de origen | mayor que 1 |

La hoja muestra ~108 filas; la aplicación hoy muestra ~708 porque el cuarto filtro **no se puede aplicar**: no tenemos el dato "cantidad en tienda del almacén de origen". Detalle en la sección 3.

### 1.4 Endpoints que el frontend ya usa

| Endpoint | Uso | Estado |
|---|---|---|
| `GET /bodegon-product-origin?bodegon_id=1053` | Origen de cada producto (todas las páginas, `pageSize=200`) | Funciona |
| `GET /product-aliases` y `POST /product-aliases/bulk` | Asociaciones nombre de factura → código | Funciona |
| `GET /products?codigo=…` y `?codigo_like=…` | Validar un código y buscar por sufijo (CodInicial) | En uso |
| `GET /offers?codigo_in=…&proveedor_in=…` | Intento de leer `stock_tienda` del origen | **No devolvió datos** (ver 3.4) |
| `distributions`, `offer-bodegones`, `supplier-offers` | Guardar / Historial | **Sin conectar** |

---

## 2. Pedido A — `distributions` como foto de la pantalla

### 2.1 Objetivo

Que cada vez que el usuario pulse **Guardar** quede registrada una copia **inmutable** de la distribución tal como la dejó, para:

1. **Reconstruir** exactamente la tabla en el *Historial* de una factura pasada.
2. **Auditar** qué propuso el sistema frente a lo que decidió el usuario.
3. **Conciliar** después con el sistema externo (que ejecuta los movimientos).
4. **Evitar** guardar dos veces la misma factura.

El usuario pidió registrar todo: lo transferido a `1201`, `1882`, `1883` **y también lo que queda en el `1053`**.

### 2.2 Qué hay hoy (según el OpenAPI 1.4.0)

`POST /distributions` acepta solo:

```
fecha (date, hoy si se omite) · origen_id* · destino_id* · product_code* · cajas · unidades · usuario_id (se estampa solo)
```

Roles de creación: `admin`, `supervisor`, `analista`. Borrado: `admin`, `supervisor`. No hay creación en bloque, no hay forma de agrupar filas de un mismo guardado, no hay `offer_id`, y tampoco campos para la línea de la factura ni para distinguir el tipo de movimiento.

### 2.3 Qué falta y por qué

- **Sin agrupación** no se puede saber qué filas pertenecen a la misma factura ni evitar duplicados.
- **Sin tipo de movimiento** no se distingue el ingreso por AA, las transferencias y lo retenido en `1053`.
- **Sin datos de la línea** (nombre, cajas facturadas/recibidas, precio, U/C, flags) no se puede reconstruir la pantalla.
- **Sin bulk** serían unas 105 peticiones (21 productos × 5 filas) y un fallo a medias dejaría datos parciales. Al ser una bitácora que no se edita, un reintento duplicaría filas.

### 2.4 Propuesta de modelo

#### Cabecera (recurso nuevo, p. ej. `distribution-batches`) — o reutilizar `supplier_offers` si el backend lo prefiere

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `created_at`, `created_by` | auto | `created_by` desde el JWT |
| `supplier_name` | string, requerido | `"Mayorista 23"` |
| `invoice_number` | string, requerido | Número de orden, p. ej. `9810255` |
| `invoice_date` | date | Fecha de la factura |
| `total_usd` | number \| null | Total de productos de la factura |
| `source_file_name` | string \| null | Nombre del PDF |

Restricción: **único por (`supplier_name`, `invoice_number`)**. Un segundo intento responde `409` para que el frontend avise "esta factura ya fue guardada".

#### Filas de `distributions` — campos nuevos

Las filas de un mismo producto comparten `batch_id` y `product_code`. Una fila por producto y destino, **siempre cinco por producto** (aunque `cajas` sea 0), para que la foto sea completa.

| Campo | Tipo | Req. | Para qué |
|---|---|---|---|
| `batch_id` | uuid | sí | Agrupa las filas de un Guardar |
| `tipo` | enum `ajuste_aa` \| `transferencia` \| `retencion` | sí | Distingue el movimiento |
| `row_number` | integer | sí | Posición de la línea en la factura |
| `cajas_propuestas` | number \| null | no | Lo que propuso el sistema, antes de que el usuario lo editara |
| `uc` | integer | sí | U/C usado para calcular `unidades` |
| `nombre_factura` | string | sí | Nombre original de la factura (clave del alias) |
| `cajas_facturadas`, `cajas_recibidas`, `precio_caja` | number \| null | solo en `ajuste_aa` | Línea de la factura |
| `es_nuevo`, `creado` | boolean \| null | solo en `ajuste_aa` | Flags de la fila |
| `pre_cod_tkc` | string \| null | solo en `ajuste_aa` | Últimos 6 dígitos que le pasaron al cliente |
| `detalle` | json \| null | no | Datos del cálculo por bodegón (I.AVG, EF, objetivo, propuesta en unidades, %). Opcional, para análisis futuro |

Convención de `tipo`, `origen_id` y `destino_id`:

| `tipo` | `origen_id` | `destino_id` | `cajas` |
|---|---|---|---|
| `ajuste_aa` | `SM23` (ver pregunta 2) | `1053` | Todo lo recibido de la factura |
| `transferencia` | `1053` | `1201` / `1882` / `1883` | Lo asignado a ese bodegón |
| `retencion` | `1053` | `1053` | Lo que se queda en el `1053` |

### 2.5 Endpoints

1. `POST /distribution-batches` → crea la cabecera y devuelve `id`. `409` si (proveedor, factura) ya existe.
2. `POST /distributions/bulk` con `{ batch_id, items: [...] }` → inserta **todas las filas en una sola transacción** (todo o nada). Máximo 500 por petición. `fecha` y `usuario_id` se estampan en servidor.
3. `GET /distribution-batches` → lista paginada, filtrable por `invoice_number`, `supplier_name` y rango de fechas (para el Historial).
4. `GET /distributions?batch_id=…` → todas las filas de un guardado (para reconstruir la tabla).
5. Se mantiene el criterio actual: las filas **no se editan**; solo `admin`/`supervisor` pueden borrar. Idealmente borrar una cabecera elimina sus filas.

### 2.6 Validaciones que debería hacer el servidor

- `unidades = cajas × uc` para cada fila.
- Por cada `product_code` dentro de un `batch_id`: la suma de `cajas` de `transferencia` + `retencion` **debe ser igual** a las `cajas` de `ajuste_aa`.
- `destino_id` ∈ {`1053`, `1201`, `1882`, `1883`}; `tipo` y `origen_id`/`destino_id` coherentes con la tabla anterior.
- `cajas`, `cajas_facturadas`, `cajas_recibidas` ≥ 0.
- Cualquier incumplimiento → `422` sin insertar nada.

### 2.7 Ejemplo completo (datos reales de una factura)

Factura Mayorista 23 nº 9810255 del 6/10/2026, total 4992.07 USD. Producto `810146500698` — *Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)*: 10 cajas facturadas y recibidas, 38.19 USD por caja, U/C 24. Reparto final: 1053 = 4, 1201 = 3, 1882 = 1, 1883 = 2.

```http
POST /api/v1/distribution-batches
{
  "supplier_name": "Mayorista 23",
  "invoice_number": "9810255",
  "invoice_date": "2026-10-06",
  "total_usd": 4992.07,
  "source_file_name": "261006 - ID-9810255. Confirmación de cobro. Mayorista23.pdf"
}
→ 201 { "data": { "id": "<batch_id>", ... } }
```

```http
POST /api/v1/distributions/bulk
{
  "batch_id": "<batch_id>",
  "items": [
    { "tipo": "ajuste_aa",     "row_number": 4, "product_code": "810146500698", "origen_id": "SM23", "destino_id": "1053",
      "cajas": 10, "unidades": 240, "uc": 24, "cajas_propuestas": 10,
      "nombre_factura": "Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)",
      "cajas_facturadas": 10, "cajas_recibidas": 10, "precio_caja": 38.19,
      "es_nuevo": false, "creado": false, "pre_cod_tkc": null },

    { "tipo": "transferencia", "row_number": 4, "product_code": "810146500698", "origen_id": "1053", "destino_id": "1201",
      "cajas": 3, "unidades": 72,  "uc": 24, "cajas_propuestas": 3, "nombre_factura": "Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)" },
    { "tipo": "transferencia", "row_number": 4, "product_code": "810146500698", "origen_id": "1053", "destino_id": "1882",
      "cajas": 1, "unidades": 24,  "uc": 24, "cajas_propuestas": 1, "nombre_factura": "Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)" },
    { "tipo": "transferencia", "row_number": 4, "product_code": "810146500698", "origen_id": "1053", "destino_id": "1883",
      "cajas": 2, "unidades": 48,  "uc": 24, "cajas_propuestas": 2, "nombre_factura": "Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)" },

    { "tipo": "retencion",     "row_number": 4, "product_code": "810146500698", "origen_id": "1053", "destino_id": "1053",
      "cajas": 4, "unidades": 96,  "uc": 24, "cajas_propuestas": 4, "nombre_factura": "Caja de leche condensada azucarada YEYA (24 x 395 g / 14 oz)" }
  ]
}
→ 201 { "data": { "inserted": 5 } }
```

Comprobación: 3 + 1 + 2 + 4 = 10 = cajas del `ajuste_aa`.

### 2.8 Cómo lo usará el frontend

- **Guardar**: crea la cabecera; si responde `409`, avisa "esta factura ya fue guardada" y no sigue. Si pasa, envía todas las filas en un solo bulk. El botón queda desactivado tras guardar, para evitar duplicados.
- **Historial**: lista las cabeceras; al abrir una, pide `GET /distributions?batch_id=` y reconstruye la tabla agrupando por `product_code`.

### 2.9 Roles

Hoy solo `admin`, `supervisor` y `analista` pueden crear distribuciones. Quien importa y guarda la factura es normalmente un usuario `comercial`. Ver pregunta 3.

### 2.10 Criterios de aceptación

- Un Guardar crea exactamente una cabecera y 5 filas por producto, o no crea nada.
- Guardar dos veces la misma factura devuelve `409` y no inserta filas.
- Una distribución cuya suma no cuadra devuelve `422`.
- `GET /distributions?batch_id=` devuelve filas suficientes para reconstruir la pantalla sin consultar nada más.

---

## 3. Pedido B — `bodegon-product-origin` con existencias del origen

### 3.1 Contexto

Para cada producto del bodegón `1053`, `bodegon-product-origin` indica de qué almacén grande se abastece (`origin_store_id`, p. ej. `593`, `789`, `1005`, `734`) y el tipo (`origin_type`: `warehouse`, `SM23 M.` o `sin-origen`). La vista *Propuesta Bodegones* necesita, además, **cuánto hay de ese producto en ese almacén de origen**, porque dos de los cuatro filtros del cliente dependen de ello (sección 1.3).

### 3.2 Qué pedimos

Añadir a cada registro de `GET /bodegon-product-origin` (y a `GET /bodegon-product-origin/{id}`) estos campos, calculados en el momento de la consulta para (`origin_store_id`, `product_code`):

| Campo | Tipo | Significado (columna de la hoja) |
|---|---|---|
| `origin_existencia_fisica` | number \| null | Existencia del producto en el almacén de origen. Hoja: **Cant. Exist. almacén de origen** |
| `origin_stock_tienda` | number \| null | Cantidad del producto **en tienda** en el almacén de origen. Hoja: **Cant. en tienda almacén de origen**. Es un subconjunto de la existencia: nunca debería superarla |
| `origin_stock_updated_at` | date-time \| null | Cuándo se tomó el dato |

Ambos son `null` cuando `origin_type` no es `warehouse` o el producto no tiene registro en ese almacén. Los nombres siguen la convención de `offers` (`existencia_fisica`, `stock_tienda`).

Respuesta esperada (los valores son un ejemplo):

```json
{
  "id": "41264bb9-db22-495d-bc51-20ef1c6a8bab",
  "bodegon_id": "1053",
  "product_code": "7501032915339",
  "origin_store_id": "593",
  "origin_type": "warehouse",
  "origin_existencia_fisica": 148,
  "origin_stock_tienda": 138,
  "origin_stock_updated_at": "2026-10-19T04:00:00Z"
}
```

Opcional pero muy útil: filtros `origin_existencia_fisica_min` y `origin_stock_tienda_min` para poder aplicar el filtro del cliente en el servidor.

### 3.3 Por qué

Datos reales de la aplicación con el filtro actual:

```
3788 productos → cobertura<20: 2852 → +exist. origen>1: 711 → +prop. ideal>1: 708 → +cant. tienda origen>1: NO APLICABLE
```

La hoja del cliente muestra ~108 filas. Sin `origin_stock_tienda` no se puede aplicar el último filtro y sobran unas 600.

Además, hoy la aplicación obtiene la existencia del origen descargando el catálogo completo de cada almacén de origen desde Elineas (`ap-latest`), solo para leer una cantidad por producto:

| Almacén de origen | Productos descargados | Tiempo |
|---|---|---|
| `593 UP` | 20 641 | 14–27 s |
| `789` | 9 510 | 9–22 s |
| `1005` | 2 075 | 4–18 s |
| `734` | 416 | 2–14 s |

Con los dos campos en la respuesta de `bodegon-product-origin` esas descargas desaparecen y el tiempo de carga de la vista baja de decenas de segundos a una consulta.

### 3.4 Posible fuente y un problema que investigar

La tabla `offers` ya tiene `existencia_fisica` y `stock_tienda` por (`proveedor`, `codigo`), y su documentación dice que `proveedor` es la clave del almacén. La aplicación intentó leerlas con:

```
GET /offers?codigo_in=<hasta ~25 códigos>&proveedor_in=593,789,1005,734&fields=codigo,proveedor,existencia_fisica,stock_tienda&pageSize=200&count=none
```

para 708 códigos, y **no obtuvo `stock_tienda`** para ninguno. No sabemos si respondió vacío o con error. Preguntas: ¿contiene `offers` filas para esos almacenes de origen? ¿`proveedor` usa exactamente la clave (`593`) o algo como `TKC SUB 593 UP`? ¿Es esa la fuente que da los mismos números que las columnas J y K de la hoja, o debe salir de otro sitio (p. ej. el reporte `ap-latest` de Elineas, cuyo campo `cantidad` usamos hoy como existencia)?

### 3.5 Criterios de aceptación

- Para un producto con `origin_type = "warehouse"`, la respuesta incluye `origin_existencia_fisica` y `origin_stock_tienda`, y coinciden con las columnas "Cant. Exist. almacén de origen" y "Cant. en tienda almacén de origen" de la hoja del cliente.
- Para `sin-origen` y `SM23 M.`, ambos campos son `null`.
- El listado con `bodegon_id=1053` sigue pudiendo paginarse a `pageSize=200` sin degradarse de forma notable.

---

## 4. Preguntas abiertas

1. **Cabecera de la distribución.** ¿Prefieren un recurso nuevo (`distribution-batches`) o reutilizar `supplier_offers` con `offer_id`? Hoy `offer-bodegones.offer_id` apunta a `supplier_offers.id`. Si reutilizan `supplier_offers`, esa tabla tendría que admitir número y fecha de factura y total.
2. **`origen_id` del ingreso por AA.** SM23 no es un almacén con clave TKC. Proponemos el texto `SM23` o `null`. ¿Cuál prefieren?
3. **Roles.** ¿Puede el rol `comercial` crear distribuciones y cabeceras? Es quien suele importar y guardar la factura.
4. **Reguardar una factura.** Proponemos `409` y que solo un `admin` pueda borrar la cabecera para volver a guardar. ¿Están de acuerdo o prefieren versiones?
5. **Fuente de existencia y tienda del origen** (Pedido B): ¿`offers`, `ap-latest` u otra?, y ¿por qué `GET /offers` no devolvió datos para los almacenes de origen (3.4)?
6. **Guardar y `distributions`**: ¿registrar siempre las 5 filas por producto (incluidas las de 0 cajas) les parece bien, o prefieren omitir las filas en cero?

---

## 5. Glosario

| Término | Significado |
|---|---|
| **TKC** | Sistema/catálogo interno de la empresa; las "claves TKC" son los códigos de almacén y de producto |
| **SM23 / Mayorista 23** | Proveedor externo cuya factura en PDF se importa |
| **AA (Ajuste AA)** | Operación que da entrada al `1053` a todo lo recibido de la factura |
| **U/C** | Unidades por caja |
| **EF** | Existencia física (stock actual) |
| **I.AVG** | Índice de cálculo: promedio de varios índices de venta diaria |
| **CodInicial** | Últimos 6 dígitos del código TKC que le pasan al cliente para un producto nuevo |
| **Origen** | Almacén grande del que se reabastece un producto en un bodegón |
| **TD (Oreste)** | Tabla dinámica de Google Sheets del cliente, con los filtros de la sección 1.3 |
