{
  "name": "Supplier",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Nombre del proveedor"
    },
    "code": {
      "type": "string",
      "description": "Código interno"
    },
    "supplier_type": {
      "type": "string",
      "description": "Tipo de proveedor (Fabricante, Distribuidor, etc.)"
    },
    "comercializacion_type": {
      "type": "string",
      "description": "Tipo de comercialización"
    },
    "comercial": {
      "type": "string",
      "description": "Nombre del comercial asignado"
    },
    "contact_name": {
      "type": "string",
      "description": "Contacto principal (nombre)"
    },
    "cargo_1": {
      "type": "string",
      "description": "Cargo del contacto 1"
    },
    "telefono_1": {
      "type": "string",
      "description": "Teléfono del contacto 1"
    },
    "contact_2": {
      "type": "string"
    },
    "cargo_2": {
      "type": "string"
    },
    "telefono_2": {
      "type": "string"
    },
    "contact_3": {
      "type": "string"
    },
    "cargo_3": {
      "type": "string"
    },
    "telefono_3": {
      "type": "string"
    },
    "contact_4": {
      "type": "string"
    },
    "cargo_4": {
      "type": "string"
    },
    "telefono_4": {
      "type": "string"
    },
    "contact_5": {
      "type": "string"
    },
    "cargo_5": {
      "type": "string"
    },
    "telefono_5": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "phone": {
      "type": "string"
    },
    "address": {
      "type": "string"
    },
    "country": {
      "type": "string"
    },
    "tax_id": {
      "type": "string",
      "description": "RIF / NIF / CUIT"
    },
    "default_currency": {
      "type": "string",
      "default": "USD"
    },
    "default_exchange_rate": {
      "type": "number",
      "default": 1
    },
    "default_lead_time_days": {
      "type": "number"
    },
    "default_min_qty": {
      "type": "number",
      "default": 1
    },
    "default_pack_multiple": {
      "type": "number",
      "default": 1
    },
    "payment_terms": {
      "type": "string"
    },
    "notes": {
      "type": "string"
    },
    "productos_global": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Categorías de productos globales que maneja"
    },
    "productos_especificos": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Productos o referencias específicas"
    },
    "has_contract": {
      "type": "boolean",
      "default": false,
      "description": "Indica si hay contrato activo"
    },
    "contract_notes": {
      "type": "string",
      "description": "Notas sobre el contrato o condiciones comerciales"
    },
    "next_contact_date": {
      "type": "string",
      "description": "Fecha del próximo contacto programado (ISO date)"
    },
    "is_active": {
      "type": "boolean",
      "default": true
    }
  },
  "required": [
    "name"
  ]
}
