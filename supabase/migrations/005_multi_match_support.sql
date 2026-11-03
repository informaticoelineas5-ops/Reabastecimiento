-- ─── 005_multi_match_support.sql ───────────────────────────────────────────
-- Permite asociación múltiple: un ítem del proveedor → varios productos internos.
-- La tabla supplier_offer_item_matches ya NO tiene unique constraint en offer_item_id
-- (nunca lo tuvo), así que no es necesario eliminar nada ahí.
--
-- Solo necesitamos agregar supplier_product_code a purchase_order_items
-- para que la Vista Proveedor del pedido pueda mostrar el código del proveedor.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_product_code TEXT;

-- También guardamos explícitamente el internal_product_id en los items
-- (ya existía en algunos deploys, se asegura con IF NOT EXISTS)
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS internal_product_id TEXT;
