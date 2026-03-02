-- =============================================================================
-- Contractor Proposal Engine — Supabase Cache Schema
-- =============================================================================
-- All tables here are cache-only and fully rebuildable from Vault.
-- Mutations follow: append event → update document → rebuild cache.
-- RLS enforces tenant isolation via auth.tenant_id() extracted from Clerk JWT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Auth helper: extract tenant_id from Clerk JWT custom claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::UUID
$$;

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------
CREATE TYPE quote_status AS ENUM (
  'draft', 'priced', 'sent', 'accepted', 'rejected', 'expired'
);

CREATE TYPE proposal_status AS ENUM (
  'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'paid'
);

CREATE TYPE payment_mode AS ENUM ('deposit', 'full');

CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TYPE event_action AS ENUM (
  'quote.created',    'quote.extracted',  'quote.priced',
  'proposal.created', 'proposal.sent',    'proposal.viewed',
  'proposal.accepted','proposal.rejected','proposal.expired',
  'payment.initiated','payment.succeeded','payment.failed',   'payment.refunded',
  'export.created',   'export.completed', 'export.failed'
);

CREATE TYPE event_target_type AS ENUM ('quote', 'proposal', 'payment', 'export');

CREATE TYPE validation_status AS ENUM ('pending', 'valid', 'invalid');

CREATE TYPE export_provider AS ENUM ('stripe', 'docusign', 'quickbooks', 'email', 'pdf');

CREATE TYPE export_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE item_category AS ENUM (
  'lumber', 'roofing', 'electrical', 'plumbing', 'concrete',
  'paint', 'hardware', 'flooring', 'other'
);

-- ---------------------------------------------------------------------------
-- Utility: updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- TABLE: tenants
-- =============================================================================
CREATE TABLE tenants (
  tenant_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id     TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  logo_url         TEXT,
  -- default_margin stored as percentage 0–100 (matches PricingConfig convention)
  default_margin   NUMERIC(5, 2) NOT NULL DEFAULT 0
                   CHECK (default_margin >= 0 AND default_margin <= 100),
  deposit_percent  NUMERIC(5, 2) NOT NULL DEFAULT 0
                   CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON tenants
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: quotes_cache
-- =============================================================================
CREATE TABLE quotes_cache (
  quote_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  status                 quote_status NOT NULL DEFAULT 'draft',
  supplier_quote_number  TEXT,
  supplier_date          DATE,
  project_name           TEXT,
  subtotal               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax                    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total                  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  content_hash           TEXT,
  vault_path             TEXT,
  extracted_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotes_tenant_id  ON quotes_cache (tenant_id);
CREATE INDEX idx_quotes_status     ON quotes_cache (status);
CREATE INDEX idx_quotes_vault_path ON quotes_cache (vault_path);

ALTER TABLE quotes_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotes_tenant_isolation ON quotes_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: quote_items_cache
-- =============================================================================
CREATE TABLE quote_items_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID NOT NULL REFERENCES quotes_cache (quote_id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  line_number   INTEGER NOT NULL CHECK (line_number >= 0),
  sku           TEXT,
  description   TEXT NOT NULL,
  quantity      NUMERIC(12, 4) NOT NULL CHECK (quantity >= 0),
  unit          TEXT NOT NULL,
  unit_cost     NUMERIC(12, 4) NOT NULL CHECK (unit_cost >= 0),
  extended_cost NUMERIC(12, 2) NOT NULL CHECK (extended_cost >= 0),
  category      item_category NOT NULL,
  UNIQUE (quote_id, line_number)
);

CREATE INDEX idx_quote_items_quote_id   ON quote_items_cache (quote_id);
CREATE INDEX idx_quote_items_tenant_id  ON quote_items_cache (tenant_id);
CREATE INDEX idx_quote_items_category   ON quote_items_cache (category);

ALTER TABLE quote_items_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY quote_items_tenant_isolation ON quote_items_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: proposals_cache
-- =============================================================================
CREATE TABLE proposals_cache (
  proposal_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id            UUID NOT NULL REFERENCES quotes_cache (quote_id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  status              proposal_status NOT NULL DEFAULT 'draft',
  contractor_name     TEXT NOT NULL,
  project_name        TEXT,
  materials_total     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (materials_total >= 0),
  tax                 NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  proposal_total      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (proposal_total >= 0),
  -- deposit_percent stored as decimal 0–1 (mirrors Zod deposit_pct)
  deposit_percent     NUMERIC(5, 4) CHECK (deposit_percent >= 0 AND deposit_percent <= 1),
  deposit_amount      NUMERIC(12, 2) CHECK (deposit_amount >= 0),
  financing_available BOOLEAN NOT NULL DEFAULT FALSE,
  content_hash        TEXT,
  vault_path          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposals_tenant_id   ON proposals_cache (tenant_id);
CREATE INDEX idx_proposals_quote_id    ON proposals_cache (quote_id);
CREATE INDEX idx_proposals_status      ON proposals_cache (status);
CREATE INDEX idx_proposals_vault_path  ON proposals_cache (vault_path);

CREATE TRIGGER proposals_updated_at
  BEFORE UPDATE ON proposals_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE proposals_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY proposals_tenant_isolation ON proposals_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: proposal_items_cache
-- =============================================================================
CREATE TABLE proposal_items_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   UUID NOT NULL REFERENCES proposals_cache (proposal_id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  line_number   INTEGER NOT NULL CHECK (line_number >= 0),
  description   TEXT NOT NULL,
  category      TEXT,
  cost          NUMERIC(12, 4) NOT NULL CHECK (cost >= 0),
  -- margin_percent stored as decimal 0–1 (mirrors Zod margin_pct)
  margin_percent NUMERIC(5, 4) NOT NULL CHECK (margin_percent >= 0 AND margin_percent <= 1),
  sell_price    NUMERIC(12, 2) NOT NULL CHECK (sell_price >= 0),
  extended_sell NUMERIC(12, 2) NOT NULL CHECK (extended_sell >= 0),
  UNIQUE (proposal_id, line_number)
);

CREATE INDEX idx_proposal_items_proposal_id ON proposal_items_cache (proposal_id);
CREATE INDEX idx_proposal_items_tenant_id   ON proposal_items_cache (tenant_id);

ALTER TABLE proposal_items_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY proposal_items_tenant_isolation ON proposal_items_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: payments_cache
-- =============================================================================
CREATE TABLE payments_cache (
  payment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id       UUID NOT NULL REFERENCES proposals_cache (proposal_id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  mode              payment_mode NOT NULL,
  status            payment_status NOT NULL DEFAULT 'pending',
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  stripe_session_id TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  vault_path        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_payments_tenant_id        ON payments_cache (tenant_id);
CREATE INDEX idx_payments_proposal_id      ON payments_cache (proposal_id);
CREATE INDEX idx_payments_status           ON payments_cache (status);
CREATE INDEX idx_payments_stripe_session   ON payments_cache (stripe_session_id);

ALTER TABLE payments_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_tenant_isolation ON payments_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: events_cache
-- =============================================================================
CREATE TABLE events_cache (
  event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  -- "timestamp" is reserved; stored as occurred_at to avoid quoting everywhere
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action            event_action NOT NULL,
  target_id         UUID NOT NULL,
  target_type       event_target_type NOT NULL,
  validation_status validation_status NOT NULL DEFAULT 'pending',
  metadata          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_events_tenant_id         ON events_cache (tenant_id);
CREATE INDEX idx_events_occurred_at       ON events_cache (occurred_at DESC);
CREATE INDEX idx_events_action            ON events_cache (action);
CREATE INDEX idx_events_target_id         ON events_cache (target_id);
CREATE INDEX idx_events_validation_status ON events_cache (validation_status);

ALTER TABLE events_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_tenant_isolation ON events_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- TABLE: exports_cache
-- =============================================================================
CREATE TABLE exports_cache (
  export_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES proposals_cache (proposal_id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  provider        export_provider NOT NULL,
  provider_ref_id TEXT,
  status          export_status NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exports_tenant_id    ON exports_cache (tenant_id);
CREATE INDEX idx_exports_proposal_id  ON exports_cache (proposal_id);
CREATE INDEX idx_exports_status       ON exports_cache (status);
CREATE INDEX idx_exports_provider     ON exports_cache (provider);

ALTER TABLE exports_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY exports_tenant_isolation ON exports_cache
  USING (tenant_id = auth.tenant_id());

-- =============================================================================
-- FUNCTION: rebuild_tenant_cache
-- Clears all cache rows for a tenant so they can be repopulated from Vault.
-- Deletes in reverse dependency order to satisfy FK constraints.
-- Requires service-role or equivalent; not callable by tenant JWT users.
-- =============================================================================
CREATE OR REPLACE FUNCTION rebuild_tenant_cache(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM exports_cache        WHERE tenant_id = p_tenant_id;
  DELETE FROM events_cache         WHERE tenant_id = p_tenant_id;
  DELETE FROM payments_cache       WHERE tenant_id = p_tenant_id;
  DELETE FROM proposal_items_cache WHERE tenant_id = p_tenant_id;
  DELETE FROM proposals_cache      WHERE tenant_id = p_tenant_id;
  DELETE FROM quote_items_cache    WHERE tenant_id = p_tenant_id;
  DELETE FROM quotes_cache         WHERE tenant_id = p_tenant_id;
END;
$$;
