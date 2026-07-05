-- Projects page spec:
--  1. Drop the signed-contract gate on activation (Finance gate deferred, June 30).
--  2. Project creation is PM (+ Governance/Developer) only — SL/Delivery Leads no longer insert.
--  3. Block deleting a project that still has allocations (clear message).
--  4. Server-side sequential project-code generator (a PM can't see all projects to number them).

-- 1. Activation no longer requires contract_signed.
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl();
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
    IF NOT (is_d OR is_gov) THEN RAISE EXCEPTION 'Only SL / Delivery Lead can verify a Draft project'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'Verified' AND NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only Governance Lead can activate a project'; END IF;
    RETURN NEW;  -- contract gate deferred
  END IF;

  IF NEW.status IN ('On_Hold','Closed','Rejected') AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;

-- 2. Only PM / Governance / Developer may create projects.
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_developer() OR public.is_governance_lead() OR public.is_pm());

-- 3. Refuse to delete a project that still has allocations.
CREATE OR REPLACE FUNCTION public.prevent_project_delete_with_allocations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.allocations WHERE project_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete project % — remove its allocations first', OLD.project_code;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_prevent_project_delete_with_allocations ON public.projects;
CREATE TRIGGER trg_prevent_project_delete_with_allocations
  BEFORE DELETE ON public.projects FOR EACH ROW
  EXECUTE FUNCTION public.prevent_project_delete_with_allocations();

-- 4. Next sequential project code for a service line: [SL]-[YEAR]-[NNN].
CREATE OR REPLACE FUNCTION public.next_project_code(_sl public.service_line)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prefix text := upper(_sl::text);
  yr text := to_char(CURRENT_DATE, 'YYYY');
  maxn int;
BEGIN
  SELECT COALESCE(MAX(substring(project_code from '\d{3}$')::int), 0) INTO maxn
  FROM public.projects
  WHERE project_code ~ ('^' || prefix || '-' || yr || '-\d{3}$');
  RETURN prefix || '-' || yr || '-' || lpad((maxn + 1)::text, 3, '0');
END $$;
GRANT EXECUTE ON FUNCTION public.next_project_code(public.service_line) TO authenticated;
