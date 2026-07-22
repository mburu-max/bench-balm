-- 1) resubmit rejected -> draft (superseded by third but apply for clarity)
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl();
BEGIN
  IF is_dev THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT is_gov THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can verify & activate a project'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'On_Hold' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can put a project on hold'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'Rejected' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can reject a project'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'Draft' AND OLD.status = 'Rejected' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'Closed' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;

-- 2) hubspot sync: customers.hubspot_company_id + staging table
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
  status TEXT NOT NULL DEFAULT 'pending',
  promoted_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubspot_deal_imports TO authenticated;
GRANT ALL ON public.hubspot_deal_imports TO service_role;
ALTER TABLE public.hubspot_deal_imports ENABLE ROW LEVEL SECURITY;

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

-- 3) import_hubspot_deal + updated validate_project_transition (HubSpot fast-path)
CREATE OR REPLACE FUNCTION public.import_hubspot_deal(
  p_deal_id      text,
  p_deal_name    text,
  p_service_line public.service_line,
  p_customer_id  uuid,
  p_start        date,
  p_end          date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing uuid;
  new_id   uuid;
  code     text;
  s        date := COALESCE(p_start, CURRENT_DATE);
  e        date := COALESCE(p_end, COALESCE(p_start, CURRENT_DATE) + INTERVAL '12 months');
BEGIN
  SELECT id INTO existing FROM public.projects WHERE hubspot_deal_id = p_deal_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;
  IF e < s THEN e := s; END IF;
  code := public.next_project_code(p_service_line, p_customer_id);
  INSERT INTO public.projects (
    project_code, hubspot_deal_id, project_description, customer_id,
    service_line, start_date, end_date, status
  ) VALUES (
    code, p_deal_id, COALESCE(NULLIF(p_deal_name, ''), 'HubSpot deal ' || p_deal_id), p_customer_id,
    p_service_line, s, e, 'Draft'
  ) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.import_hubspot_deal(text, text, public.service_line, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_hubspot_deal(text, text, public.service_line, uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl();
BEGIN
  IF is_dev THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT is_gov THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Active' AND OLD.status = 'Draft' AND OLD.hubspot_deal_id IS NOT NULL AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can verify & activate a project'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'On_Hold' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can put a project on hold'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'Rejected' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can reject a project'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'Draft' AND OLD.status = 'Rejected' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'Closed' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;