{
  "name": "SupplierContact",
  "type": "object",
  "properties": {
    "supplier_id": {
      "type": "string",
      "description": "FK a Supplier.id"
    },
    "supplier_name": {
      "type": "string"
    },
    "contact_date": {
      "type": "string",
      "format": "date",
      "description": "Fecha en que se realizó el contacto"
    },
    "contacted_by": {
      "type": "string",
      "description": "Email del comercial que realizó el contacto"
    },
    "notes": {
      "type": "string"
    }
  },
  "required": [
    "supplier_id",
    "contact_date"
  ]
}
