-- ─── 006_new_product_flag.sql ────────────────────────────────────────────────
-- Permite marcar un ítem de oferta proveedor como "Producto Nuevo":
-- productos que el comercial quiere pedir aunque no existan en el catálogo interno.
-- El flag persiste en el ítem de la oferta para que sobreviva recargas de página.

ALTER TABLE supplier_offer_items
  ADD COLUMN IF NOT EXISTS is_new_product BOOLEAN DEFAULT FALSE;

-- También en purchase_order_items para identificarlos en el detalle del pedido y PDF
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS is_new_product BOOLEAN DEFAULT FALSE;
