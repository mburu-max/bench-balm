-- Let the Service Line Lead (is_dl) resolve a hold: editing & saving an On_Hold project flips it
-- back to Active. Previously only Governance could move a project to Active. Mirrors the
-- Rejected -> Draft resubmission path. Governance keeps all its existing rights.
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
  -- HubSpot-sourced draft: assigning a PM activates it (no Governance gate).
  IF NEW.status = 'Active' AND OLD.status = 'Draft' AND OLD.hubspot_deal_id IS NOT NULL AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;
  -- Resolve a hold: the SL Lead (or Governance) edits & saves an On_Hold project -> back to Active.
  IF NEW.status = 'Active' AND OLD.status = 'On_Hold' AND (is_gov OR is_d) THEN
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
