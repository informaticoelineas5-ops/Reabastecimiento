# Pedido: endpoint de orígenes externos por producto

## Contexto
La Propuesta de Reabastecimiento de Bodegones necesita saber, para cada producto, si se compra a un proveedor externo (hoy SM23M). Esa información no está en ninguna tabla; solo puede deducirse de las facturas externas: si el `product_code` de un ítem aparece en una factura activa, ese producto es de origen externo.

## Problema
`GET /external-invoices` devuelve solo cabeceras, sin ítems. Para armar la lista «código → factura» el front tendría que abrir cada factura con `GET /external-invoices/{id}`. Con el límite de 120 peticiones por minuto hay que poner un tope (hoy las 60 más recientes). Un producto que solo aparece en una factura más antigua queda como «Sin origen» aunque sea externo, sin ningún aviso.

## Pedido
Un endpoint que devuelva esa lista ya calculada:

`GET /api/v1/external-invoices/product-origins`

- **Roles:** los mismos que leen facturas (`admin`, `supervisor`, `comercial`, `analista`, `revisor`). Bearer JWT.
- **Parámetros opcionales:** `product_code_in` (lista separada por comas), `supplier_id`, `page`, `pageSize` (máximo 500) y `count=none`, como el resto de listados.
- **Qué se agrupa:** los ítems de facturas con `status = 'activa'` y `product_code` no vacío (con `trim`). Las anuladas no cuentan; al anular o restaurar una factura el resultado debe cambiar de inmediato (sin caché, o con caché que se invalide).
- **Una fila por `product_code`**, con los datos de la factura más reciente que lo contiene. «Más reciente» se decide igual que en `price-history`: por `invoice_date`, o por la fecha de alta si no tiene; a igual fecha, por `id` mayor.
- **Campos de cada fila:** `product_code`, `supplier_id`, `supplier_name`, `invoice_id`, `invoice_number`, `invoice_date`, `invoice_name` (el nombre que ese producto tenía en esa factura) y `times_bought` (número de facturas activas distintas que contienen el código).
- **Orden:** por `product_code`.
- **Volumen esperado:** decenas de facturas con 50 a 150 ítems cada una; unos miles de códigos como máximo. Probablemente baste un índice en los ítems por `product_code` y otro en las facturas por `status`.

Ejemplo de respuesta:

```json
{ "success": true,
  "data": [
    { "product_code": "7501032915339", "supplier_id": "…", "supplier_name": "SM23M",
      "invoice_id": 8239, "invoice_number": "9810255", "invoice_date": "2026-10-06",
      "invoice_name": "COLA 12x355", "times_bought": 3 }
  ],
  "pagination": { "page": 1, "pageSize": 200, "totalItems": 1840 } }
```

## Por qué en el servidor
Una petición en lugar de hasta 60, sin tope artificial, sin riesgo de 429 y con el dato siempre completo.

## Alternativa si es más fácil
`GET /external-invoice-items`, paginado, con filtros `status`, `product_code_in` y `supplier_id`, devolviendo cada ítem con `invoice_number`, `invoice_date` y `supplier_name` de su factura. El front agruparía; la primera opción es preferible.

## Además, confirmar o desplegar
La colección no lo documenta y el Swagger público sigue en 1.4.0:

1. Desplegar la 1.5.0 en producción (hoy `GET /external-invoices` responde 404).
2. Subida del PDF: ¿cuerpo `application/pdf` en bruto o multipart? Si es multipart, ¿cómo se llama el campo?
3. Forma de `exec_summary`, de `price-history` y de `detail` en `/events` (un ejemplo de cada uno).
4. Valores posibles de `exec_*.state`.
5. Ítem sin código: ¿acepta `product_code: ""` o espera `null`?
