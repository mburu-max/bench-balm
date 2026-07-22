-- HubSpot sync support.
--
-- (1) A reliable dedupe key on customers: once a HubSpot company is matched to a customer (first
--     by this id, then by name), we store the id so every later sync is an exact match.
-- (2) A staging inbox for closed-won deals. A deal has no service line, project window or code —
--     all of which public.projects requires (NOT NULL + the end>=start CHECK) — so it lands here
--     first and an SL Lead promotes it into a proper Draft project.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS hubspot_company_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS customers_hubspot_company_id_key
  ON public.customers (hubspot_company_id) WHERE hubspot_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hubspot_deal_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id TEXT NOT NULL UNIQUE,
  deal_name TEXT,
  amount NUMERIC,
  close_date DATE,
  pipeline TEXT,
  hubspot_company_id TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  raw JSONB,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | promoted | dismissed
  promoted_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubspot_deal_imports TO authenticated;
GRANT ALL ON public.hubspot_deal_imports TO service_role;
ALTER TABLE public.hubspot_deal_imports ENABLE ROW LEVEL SECURITY;

-- The webhook writes via the service role (bypasses RLS). In-app, Governance / Developer / SL Lead
-- may read the inbox and update rows (promote / dismiss); inserts only ever come from the sync.
DROP POLICY IF EXISTS hubspot_imports_select ON public.hubspot_deal_imports;
CREATE POLICY hubspot_imports_select ON public.hubspot_deal_imports FOR SELECT TO authenticated
  USING (public.is_developer() OR public.is_governance_lead() OR public.is_dl());

DROP POLICY IF EXISTS hubspot_imports_update ON public.hubspot_deal_imports;
CREATE POLICY hubspot_imports_update ON public.hubspot_deal_imports FOR UPDATE TO authenticated
  USING (public.is_developer() OR public.is_governance_lead() OR public.is_dl())
  WITH CHECK (public.is_developer() OR public.is_governance_lead() OR public.is_dl());

DROP TRIGGER IF EXISTS hubspot_deal_imports_updated_at ON public.hubspot_deal_imports;
CREATE TRIGGER hubspot_deal_imports_updated_at BEFORE UPDATE ON public.hubspot_deal_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
