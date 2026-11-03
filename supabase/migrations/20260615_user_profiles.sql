-- Tabla de perfiles de usuario con roles
-- user_id es nullable: el admin puede pre-crear perfiles antes de que el usuario se registre
DROP TABLE IF EXISTS user_profiles CASCADE;

CREATE TABLE user_profiles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE,          -- se rellena en el primer login
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'consulta',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON user_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "profiles_update" ON user_profiles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "profiles_delete" ON user_profiles FOR DELETE TO authenticated USING (true);
