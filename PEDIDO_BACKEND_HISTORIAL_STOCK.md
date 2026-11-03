# Pedido al backend — Historial diario de existencias (para "desde cuándo está agotado / en déficit / en exceso")

Fecha: 2026-10-28

## 1. Para qué

En **Centro de Alertas** se abrió un panel de detalle por producto. Una de sus preguntas es *"¿desde cuándo está agotado (o en déficit, o en exceso)?"*.
Hoy **no se puede responder con exactitud**: el reporte `ap-latest` de Elineas solo trae la **última** foto de inventario, y no encontramos un histórico de existencias por producto.

## 2. Qué necesitamos

Un **histórico diario de existencias por producto y almacén**.

### Opción recomendada: usar el recurso que ya existe, `inventory-snapshots`

La API de REAB ya tiene `GET /inventory-snapshots` con los campos que hacen falta:

| Campo | Uso |
|---|---|
| `offer_external_id` | **idTienda / id_online del producto** (es lo que la pantalla filtra) |
| `snapshot_at` | fecha de la foto |
| `existencia_fisica` | existencia física |
| `stock_reserva` | reservado |
| `stock_tienda` | existencia en tienda |

Lo que pedimos es que **se llene todos los días** (idealmente justo después de cada corrida de `ap-latest`) con **una fila por producto y almacén**, y se conserve al menos 12 meses.

- Si `offer_external_id` **no** es el idTienda, díganos qué identificador usa para poder consultarlo; si hace falta, añadir `warehouse` / `proveedor` y `codigo` a la fila.
- Debe poder consultarse así (la pantalla ya lo hace):
  `GET /inventory-snapshots?offer_external_id=<idTienda>&sortBy=snapshot_at&sortOrder=desc&pageSize=200&count=none&fields=snapshot_at,existencia_fisica,stock_reserva`
- Roles: lectura para todos los roles que ya la tienen.
- Volumen estimado: ~3.800 productos por bodegón × 365 días ≈ 1,4 M filas por año y bodegón. Conviene un índice `(offer_external_id, snapshot_at)`.

### Alternativa (más cómoda para el frontend): campo calculado

Un endpoint que devuelva, por producto, desde qué fecha lleva en su estado actual, por ejemplo
`GET /stock-state-since?id_online=…` → `{ estado: "AGOTADO", desde: "2026-10-02" }`.
Para Déficit y Exceso la cobertura depende del ritmo de ventas, así que el cálculo tendría que hacerse con el índice de ese día; por eso preferimos la opción del histórico y calcular nosotros.

## 3. Qué hace el frontend con eso (ya implementado)

- Muestra "**Agotado desde 2 oct 2026 · hace 26 días**" y un gráfico de la existencia en el tiempo con las líneas de mínimo (15 días) y exceso (60 días).
- Si la fila más antigua ya estaba en ese estado, dice "**Al menos desde**…".
- **Mientras no haya historial**, el panel lo dice con claridad y, solo para agotados, muestra la fecha de la última venta directa como referencia aproximada.
- **No hay que cambiar nada en el frontend** cuando el histórico exista: lo usa en cuanto la consulta devuelva filas.

## 4. Otra cosa que el panel necesita (confirmar)

El gráfico de **ventas por mes** usa `GET /reports/rdp-vd-latest?filter=codigo:<código>` (API de Elineas). Necesitamos confirmar que ese reporte **admite `filter=codigo:…`**. Si lo ignora, el panel no descarga el reporte completo: avisa "no permite filtrar por código" y no muestra el gráfico.

## 5. Criterios de aceptación

- Para un producto agotado hace 3 semanas, `GET /inventory-snapshots?offer_external_id=…` devuelve una fila por día, con `existencia_fisica = 0` desde esa fecha.
- Las filas se generan todos los días sin huecos (o el hueco queda identificable).
- La consulta responde en < 1 s para un producto con 12 meses de historia.
