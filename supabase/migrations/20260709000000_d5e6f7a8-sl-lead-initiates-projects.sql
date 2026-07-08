-- Overhauled project-creation workflow (top-down):
--   1. Service Line Leads now INITIATE projects (scoped to their assigned SL). PMs no longer
--      create — a project cascades down to the PM the SL Lead assigns on creation.
--   2. list_project_managers(): SECURITY DEFINER roster of PM users for the assignment picker,
--      so an SL Lead can populate the dropdown without broad read access to profiles/user_roles.
--   3. On-Hold becomes Governance-only — SL Leads are prohibited from holding (and, as before,
--      from activating and deleting). SL Leads may still create, edit, verify, reject and close.

-- 1. Creation policy: SL Lead (own service line) + Governance + Developer. (PM removed.)
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer()
    OR public.is_governance_lead()
    OR public.is_sl_lead(service_line)
  );

-- 2. PM roster for the assignment dropdown.
CREATE OR REPLACE FUNCTION public.list_project_managers()
RETURNS TABLE (user_id uuid, full_name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'project_manager'
  ORDER BY p.full_name NULLS LAST, p.email;
$$;
GRANT EXECUTE ON FUNCTION public.list_project_managers() TO authenticated;

-- 3. Transition trigger: On-Hold is Governance-only; Close/Reject stay SL-Lead + Governance.
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl(); -- SL Lead validator capability
BEGIN
  IF is_dev THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT (is_d OR is_gov) THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Verified' THEN
    IF NOT (is_d OR is_gov) THEN RAISE EXCEPTION 'Only SL Lead or Governance can verify a Draft project'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'Verified' AND NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only Governance Lead can activate a project'; END IF;
    RETURN NEW;
  END IF;

  -- On-Hold is a Governance-only privilege (SL Leads are prohibited).
  IF NEW.status = 'On_Hold' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only Governance Lead can put a project on hold'; END IF;
    RETURN NEW;
  END IF;

  -- Close / Reject remain available to SL Lead + Governance.
  IF NEW.status IN ('Closed','Rejected') AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;
