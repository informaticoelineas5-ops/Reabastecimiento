# Pedido al backend: Propuesta Bodegones

Flujo: el sistema propone → el cardista revisa las cantidades → el cardista ejecuta el Pedido BT (script `código*cantidad`, de uno o varios bodegones). Sin inventarista. La propuesta se guarda tal como la deja el cardista (una sola, con líneas de uno o varios bodegones).

| Endpoint | Para qué se va a usar |
|---|---|
| `POST /bodegon-proposals` | Guardar la propuesta del cardista: cabecera (estado, nota) + líneas |
| `GET /bodegon-proposals` | Listar propuestas (filtros: estado, bodegón, usuario, fechas) |
| `GET /bodegon-proposals/{id}` | Ver una propuesta con todas sus líneas |
| `PATCH /bodegon-proposals/{id}` | Editar cantidades finales de las líneas mientras no esté ejecutada (con `version`, como las facturas) |
| `POST /bodegon-proposals/{id}/execute` | Enviar el Pedido BT de uno o varios bodegones al sistema intermedio (`POST /down-shop/runs`) y guardar el resultado por línea |
| `GET /bodegon-proposals/{id}/events` | Historial: quién creó, editó y ejecutó, cuándo, y el resultado de cada envío |

**Línea de la propuesta:** `bodegon_id`, `product_code`, `nombre`, `uc`, `origen`, `stock`, `i_avg`, `prop_ideal` (lo que propuso el sistema), `cantidad_final` (lo que dejó el cardista), `script`, y tras ejecutar: `exec_status` (`ejecutado` / `fallido` / `unverified`), `exec_error`, `job_id`.

**Estados:** `borrador` → `ejecutada` (o `parcial` si algún bodegón o línea falló o quedó `unverified`).

**Roles:** crear, editar y ejecutar solo `cardista`, `admin` y `supervisor`. Hay que dar de alta el rol `cardista`. `analista` y `revisor` sin acceso (son de Reab. normal).

**Envío al sistema intermedio (colección «Elineas Transferencia: API»):** Pedido BT = `POST /down-shop/runs` (`mode: "integro"`, `Idempotency-Key` obligatoria, `lines: [{code, quantity, warehouse}]` o `text` `ALMACEN*CODIGO*CANTIDAD`). Es un trabajo: responde `202 {jobId}` y el resultado por línea sale en `GET /jobs/{id}` (`ejecutado` / `fallido` / `unverified`; una `unverified` no se reintenta sola). Una corrida a la vez por almacén (`409 job_conflict`).
