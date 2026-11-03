-- Migración: historial de contactos con proveedores (agenda de reabastecimiento)
-- Ejecutar en: Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name TEXT,
  contact_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  contacted_by  TEXT,
  notes         TEXT
);

ALTER TABLE supplier_contacts DISABLE ROW LEVEL SECURITY;
