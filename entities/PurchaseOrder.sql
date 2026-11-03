{
  "name": "PurchaseOrder",
  "type": "object",
  "properties": {
    "order_number": {
      "type": "string"
    },
    "supplier_name": {
      "type": "string"
    },
    "offer_id": {
      "type": "string"
    },
    "offer_name": {
      "type": "string"
    },
    "created_by": {
      "type": "string",
      "description": "Email del comercial"
    },
    "status": {
      "type": "string",
      "enum": [
        "borrador",
        "pendiente_revision",
        "confirmado",
        "enviado",
        "parcialmente_recibido",
        "recibido",
        "cancelado"
      ],
      "default": "borrador"
    },
    "total_amount": {
      "type": "number",
      "default": 0
    },
    "currency": {
      "type": "string",
      "default": "USD"
    },
    "exchange_rate": {
      "type": "number",
      "default": 1
    },
    "total_amount_base": {
      "type": "number",
      "default": 0
    },
    "notes": {
      "type": "string"
    },
    "confirmed_at": {
      "type": "string",
      "format": "date-time"
    },
    "confirmed_by": {
      "type": "string"
    },
    "rejection_reason": {
      "type": "string"
    },
    "fecha_limite_pago": {
      "type": "string",
      "format": "date",
      "description": "Fecha límite para pagar el pedido"
    },
    "fecha_estimada_llegada": {
      "type": "string",
      "format": "date",
      "description": "ETA estimada de llegada del pedido/contenedor"
    }
  },
  "required": [
    "supplier_name",
    "offer_id",
    "created_by"
  ]
}