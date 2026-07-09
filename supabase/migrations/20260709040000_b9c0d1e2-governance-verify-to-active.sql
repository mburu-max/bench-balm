-- Single Governance approval gate: the Governance Lead now VERIFIES a Draft straight to Active
-- (the old two-step Draft -> Verified (SL Lead) -> Active (Governance) is collapsed). Activating a
-- project is what surfaces the "assign resources" flag on the assigned PM's side.
--   * Draft/Verified/On_Hold -> Active : Governance only (the "Verify" action).
--   * -> On_Hold                       : Governance only.
--   * -> Closed / Rejected             : Governance or the SL Lead of that service line.
-- SL Leads still CREATE drafts + assign the PM (enforced by projects_insert), but no longer verify.
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl(); -- SL Lead
BEGIN
  IF is_dev THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT is_gov THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Governance verifies (approves) a project to Active — the single approval gate.
  -- Covers Draft -> Active, plus legacy Verified -> Active and On_Hold -> Active (resume).
  IF NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can verify & activate a project'; END IF;
    RETURN NEW;
  END IF;

  -- On-Hold is Governance-only.
  IF NEW.status = 'On_Hold' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only the Governance Lead can put a project on hold'; END IF;
    RETURN NEW;
  END IF;

  -- Reject / Close: Governance or the SL Lead of that service line.
  IF NEW.status IN ('Closed','Rejected') AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;
