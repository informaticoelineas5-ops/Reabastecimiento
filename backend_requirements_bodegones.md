# Requerimientos Backend — Módulo Bodegones / FF

> Sistema: Reabastecimiento  
> Fecha: 2026-10-09  
> Prioridad: Alta → Media → Baja

---

## Contexto

Se está construyendo un nuevo módulo para los almacenes de tipo **Bodegón** (1053, 1201, 1882, 1883) y **FF** (7 almacenes, identificados por nombre que contiene "FF"). Estos almacenes se reabastecen mediante **transferencias internas** desde almacenes grandes, no con compras a proveedor. El módulo requiere los siguientes cambios en la API.

---

## 🔴 Alta Prioridad

### 1. Campo `unidades_por_caja` en el producto

**Qué:** Agregar el campo `unidades_por_caja` (U/C) a la entidad Producto, independiente de si hay una oferta de proveedor activa.

**Por qué:** Toda la cadena de cálculo depende de este valor:
- `P/Unidad = P/Caja ÷ U/C`
- `Propuesta (cajas) = ceil(Propuesta_unidades ÷ U/C)`
- `Unidades transferidas = Cajas_asignadas × U/C`

Sin U/C, los cálculos no pueden ejecutarse.

**Detalle:**
- Tipo: `integer` (o `decimal` si aplica fracción)
- Editable manualmente por el usuario con rol `analista` o `admin`
- Al importar una oferta de proveedor, si el producto existe y `unidades_por_caja` estaba vacío, auto-completar con el valor de la oferta
- Si `unidades_por_caja = null`, el frontend lo marcará como pendiente y excluirá el producto del cálculo de cajas

**Pantalla de gestión de U/C (pendientes):**  
Se requiere un endpoint que devuelva todos los productos que tienen `unidades_por_caja = null`, paginado y filtrable por almacén. Permite que un usuario (rol a definir, posiblemente `inventarista`) pueda llenar el dato de forma masiva sin entrar al módulo de propuesta.

```
GET /api/productos?uc_pendiente=true&storeId={id}
```

Respuesta: lista de productos con `{ productCode, nombre, storeId }`.  
La actualización se hace con el PATCH existente del producto.

---

### 2. Endpoint: stock de un producto en un almacén específico

**Qué:** Endpoint que devuelva el stock de un producto en un almacén específico.

**Propuesta de ruta:**
```
GET /api/stock?productCode={code}&storeId={id}
```

**Respuesta esperada:**
```json
{
  "productCode": "7501791600484",
  "storeId": 593,
  "existenciaTotal": 32,
  "enTienda": 31
}
```

**Por qué:** El módulo necesita mostrar, por cada producto del bodegón, cuánto stock hay en su almacén origen (el grande). Esto determina si la propuesta es viable y si debe limitarse.

**Nota:** Si el endpoint `/api/reports/rdp-ind-general-diario` ya devuelve existencias, verificar si permite filtrar por `storeId` y si separa `existenciaTotal` de `enTienda`. Si es así, se puede reutilizar.

---

### 3. Almacén origen por producto/bodegón

**Qué:** Mecanismo para registrar qué almacén grande es el origen de cada producto en cada bodegón.

**Por qué:** El origen no es fijo por bodegón — varía por producto. El sistema necesita saber de dónde tomar el stock para calcular la propuesta.

**Opciones (definir con el negocio cuál aplica):**

| Opción | Descripción |
|--------|-------------|
| A | Tabla `bodegon_product_origin`: `{ bodegon_id, product_code, origin_store_id }` |
| B | Campo `origen_id` directamente en la fila del producto del bodegón |
| C | Regla automática: el origen es el almacén que tenga más stock de ese producto |

Se recomienda la **Opción A o B** para que el usuario pueda editarlo manualmente cuando cambie.

---

## 🟡 Media Prioridad

### 4. Clasificaciones de stock para el módulo de Abastecimiento

El módulo de Abastecimiento necesita distinguir tres tipos de productos dentro del bodegón:

| Clasificación | Condición | Descripción |
|---------------|-----------|-------------|
| **Nuevo** | Producto NO existe en el catálogo del bodegón | Existe en el almacén origen pero nunca se creó en el bodegón |
| **Nuevo SV** | `EF = 0` + sin ventas + existe en catálogo del bodegón | Fue transferido al bodegón (ya tiene anuncio) pero llegó sin unidades; nunca tuvo stock físico aquí |
| **Ya Creado** | Existe en bodegón con historial normal | Ya opera normalmente en el bodegón |

**"Nuevo SV"** es distinto de **"AGOT. SV."**:
- `AGOT. SV.` = estado de stock del sistema (puede ocurrir en cualquier almacén)
- `Nuevo SV` = clasificación específica del módulo de Abastecimiento de Bodegones (producto creado en el bodegón pero que llegó a 0 sin haber tenido stock)

**Qué necesita el backend:**  
1. Verificar que el estado `AGOT. SV.` (`EF = 0` + sin ventas) ya existe en el enum. Si no, agregarlo.  
2. Endpoint o filtro que permita consultar: *"productos en este bodegón con EF = 0, sin ventas, y que nunca tuvieron historial de compra/recepción en este almacén"* — estos son los `Nuevo SV`.  
   - Una forma sencilla: filtrar los productos del catálogo del bodegón que tengan `EF = 0`, sin ventas, y cuyo `fecha_primera_recepcion` sea nula o no exista en este almacén.

---

### 5. Asociación de oferta a múltiples bodegones

**Qué:** Permitir que una oferta de proveedor externo (entidad `OfertaProveedor` o equivalente) se vincule a varios IDs de bodegón simultáneamente.

**Por qué:** El módulo "Proveedor Externo Multi-Bodegón" permite que una compra externa abastezca a 1053, 1201, 1882 y 1883 al mismo tiempo. Hoy la asociación es 1:1 (oferta → un almacén).

**Cambio mínimo:** Tabla de relación `oferta_bodegones`: `{ oferta_id, bodegon_id }`.

---

### 6. Entidad de registro de distribución (opcional pero recomendada)

**Qué:** Registrar cada distribución realizada: qué productos se enviaron a qué bodegón, en qué cantidades y en qué fecha.

**Por qué:** Auditoría y trazabilidad. Actualmente el usuario trabaja en Excel sin historial.

**Campos mínimos:**
```
id, fecha, origen_id, destino_id, product_code, cajas, unidades, usuario_id
```

**Nota:** Este registro NO ejecuta la transferencia en el sistema externo — solo guarda el log de lo que el usuario distribuyó desde este módulo.

---

## 🟢 Baja Prioridad

### 7. Tabla de parámetros configurables

**Qué:** Tabla para almacenar parámetros del módulo sin necesidad de deploy.

**Propuesta:**
```json
{ "sistema": "bodegones", "clave": "pct_ganancia", "valor": 0.40 }
{ "sistema": "bodegones", "clave": "pct_limite_origen", "valor": 0.50 }
{ "sistema": "bodegones", "clave": "dias_stock_max", "valor": 30 }
{ "sistema": "bodegones", "clave": "dias_stock_min", "valor": 15 }
```

**Ruta sugerida:** `GET /api/params?sistema=bodegones`

---

## Resumen

| # | Qué | Prioridad | Tipo |
|---|-----|-----------|------|
| 1 | Campo `unidades_por_caja` en Producto | 🔴 Alta | Campo nuevo |
| 2 | Endpoint stock por almacén específico | 🔴 Alta | Endpoint nuevo o extensión |
| 3 | Almacén origen por producto/bodegón | 🔴 Alta | Tabla nueva o campo |
| 4 | Estado `AGOT. SV.` en enum | 🟡 Media | Verificar / agregar |
| 5 | Oferta vinculada a múltiples bodegones | 🟡 Media | Tabla de relación |
| 6 | Registro de distribución | 🟡 Media | Entidad nueva |
| 7 | Tabla de parámetros configurables | 🟢 Baja | Tabla nueva |

---

*Dudas o aclaraciones: contactar al desarrollador frontend.*
