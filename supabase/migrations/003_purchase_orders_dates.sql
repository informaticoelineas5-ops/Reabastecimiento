-- Migración: fechas clave para seguimiento de pedidos (agenda "Hoy")
-- Ejecutar en: Supabase → SQL Editor

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS fecha_limite_pago      DATE,
  ADD COLUMN IF NOT EXISTS fecha_estimada_llegada DATE;
