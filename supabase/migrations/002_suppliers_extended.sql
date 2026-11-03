-- Migración: columnas extendidas para la tabla suppliers
-- Ejecutar en: Supabase → SQL Editor

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_type          TEXT,
  ADD COLUMN IF NOT EXISTS comercializacion_type  TEXT,
  ADD COLUMN IF NOT EXISTS comercial              TEXT,
  ADD COLUMN IF NOT EXISTS cargo_1                TEXT,
  ADD COLUMN IF NOT EXISTS telefono_1             TEXT,
  ADD COLUMN IF NOT EXISTS contact_2              TEXT,
  ADD COLUMN IF NOT EXISTS cargo_2                TEXT,
  ADD COLUMN IF NOT EXISTS telefono_2             TEXT,
  ADD COLUMN IF NOT EXISTS contact_3              TEXT,
  ADD COLUMN IF NOT EXISTS cargo_3                TEXT,
  ADD COLUMN IF NOT EXISTS telefono_3             TEXT,
  ADD COLUMN IF NOT EXISTS contact_4              TEXT,
  ADD COLUMN IF NOT EXISTS cargo_4                TEXT,
  ADD COLUMN IF NOT EXISTS telefono_4             TEXT,
  ADD COLUMN IF NOT EXISTS contact_5              TEXT,
  ADD COLUMN IF NOT EXISTS cargo_5                TEXT,
  ADD COLUMN IF NOT EXISTS telefono_5             TEXT,
  ADD COLUMN IF NOT EXISTS productos_global       TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS productos_especificos  TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_contract           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contract_notes         TEXT,
  ADD COLUMN IF NOT EXISTS next_contact_date      DATE;
