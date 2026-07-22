-- HubSpot-sourced projects.
--
-- A closed-won deal (already approved in HubSpot) becomes a Draft project directly. The SL Lead
-- assigns a PM, which ACTIVATES it — Governance is only notified, it does not verify (HubSpot was
-- the approval). Only deals that carry a service line become projects; the rest stay in the
-- hubspot_deal_imports staging inbox.

-- import_hubspot_deal: create (or return, idempotently) a Draft project for a deal. Generates the
-- standard [SL]-[CUST]-NNN code. SECURITY DEFINER so the webhook (service role) and any backfill
-- can call it. Dates default to close date → +12 months for the SL Lead to adjust.
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

-- Allow an SL Lead (or Governance) to move a HubSpot-sourced Draft straight to Active — the
-- "assign a PM → activate" step. Everything else in the transition rules is unchanged.
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

  -- HubSpot pre-approved: an SL Lead assigning the PM activates the project (no Governance gate).
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

  -- Resubmission: a Rejected project, once edited, returns to the Draft approval queue.
  IF NEW.status = 'Draft' AND OLD.status = 'Rejected' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Closed' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;
