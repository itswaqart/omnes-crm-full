-- ============================================================
-- OMNES Media Group CRM — PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(30) NOT NULL DEFAULT 'sales_rep'
                  CHECK (role IN ('super_admin','admin','sales_manager','sales_rep','viewer')),
  team          VARCHAR(80),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pw BOOLEAN NOT NULL DEFAULT FALSE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sessions ─────────────────────────────────────────────────
CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_token   ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- ── Leads / Deals ─────────────────────────────────────────────
CREATE TABLE leads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company     VARCHAR(200) NOT NULL,
  contact     VARCHAR(120),
  email       VARCHAR(255),
  phone       VARCHAR(50),
  stage       VARCHAR(30) NOT NULL DEFAULT 'New'
                CHECK (stage IN ('New','Contacted','Qualified','Proposal','Closed Won','Closed Lost')),
  value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  probability SMALLINT NOT NULL DEFAULT 20 CHECK (probability BETWEEN 0 AND 100),
  source      VARCHAR(50),
  category    VARCHAR(50),
  property    VARCHAR(80),
  deal_type   VARCHAR(20) DEFAULT 'Direct' CHECK (deal_type IN ('Direct','Agency')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leads_stage       ON leads(stage);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX idx_leads_created_at  ON leads(created_at DESC);

-- ── Activities ────────────────────────────────────────────────
CREATE TABLE activities (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type       VARCHAR(20) NOT NULL CHECK (type IN ('Call','Email','Meeting','Note','Task')),
  note       TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activities_lead_id ON activities(lead_id);
CREATE INDEX idx_activities_user_id ON activities(user_id);

-- ── App Settings (categories, properties, etc.) ──────────────────
CREATE TABLE app_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default values
INSERT INTO app_settings (key, value) VALUES
  ('categories', '["Automotive","Luxury","Technology","Hospitality","Finance","Sports","FMCG","Real Estate"]'),
  ('properties', '["OMNES Lifestyle","OMNES Magazine","OMNES Digital","OMNES Travel","OMNES Business"]');

-- ── Audit Log ─────────────────────────────────────────────────
CREATE TABLE audit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(80) NOT NULL,
  target     TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_user_id   ON audit_log(user_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);

-- ── Auto-update updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leads_updated_at  BEFORE UPDATE ON leads  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed: Super Admin ─────────────────────────────────────────
-- Password: Omnes2026!  (bcrypt hash — regenerate in production)
INSERT INTO users (name, email, password_hash, role, team, must_change_pw) VALUES
  ('Layla Al Mansoori', 'layla@omnesmedia.com', '$2b$12$PLACEHOLDER_REPLACE_WITH_REAL_HASH', 'super_admin', 'Management', FALSE);

-- NOTE: Run `node scripts/seed.js` after deployment to insert all seed data with proper bcrypt hashes.
