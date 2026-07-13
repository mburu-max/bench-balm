-- Resubmission: a Rejected project, once the SL Lead (or Governance) edits and saves it, returns
-- to the Draft approval queue. The transition trigger previously had no Rejected -> Draft path, so
-- the resubmitting UPDATE hit "Invalid status transition". Add that single path (from Rejected,
-- into Draft, for an SL Lead or Governance Lead; Developer is already short-circuited at the top).
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

  -- Resubmission: only from Rejected, only into Draft, by the SL Lead or Governance.
  IF NEW.status = 'Draft' AND OLD.status = 'Rejected' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Closed' AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;
