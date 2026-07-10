-- Lock staffing approval removal to Governance at the DB level.
-- Anyone who can update a project (incl. an SL Lead) may SET the staffing sign-off, but CLEARING
-- it (unapprove) is Governance/Developer only. Enforced here so the UI restriction can't be
-- bypassed via the API.
CREATE OR REPLACE FUNCTION public.guard_staffing_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.staffing_approved_at IS NOT NULL
     AND NEW.staffing_approved_at IS NULL
     AND NOT (public.is_developer() OR public.is_governance_lead()) THEN
    RAISE EXCEPTION 'Only the Governance Lead can remove a staffing approval';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_staffing_approval ON public.projects;
CREATE TRIGGER trg_guard_staffing_approval
  BEFORE UPDATE OF staffing_approved_at ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_staffing_approval();
