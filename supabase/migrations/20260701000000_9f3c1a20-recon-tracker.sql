-- Reconcile app to Dashboard Dev Tracker (Sharad 6/30/2026 decisions):
--   1. Finance = read-only, ZERO edit rights (tracker RBAC-03).
--   2. SL Lead = Delivery Lead — the two roles are operationally equivalent.
--   3. (Demand-raising retirement is a UI-only change; the table is left dormant.)
-- Additive/idempotent: CREATE OR REPLACE + DROP ... IF EXISTS throughout.

-- ============================================================
-- 2. SL LEAD = DELIVERY LEAD  (unify the two roles)
--    is_dl() now also matches service_line_lead  -> SL leads gain project verify/create.
--    is_sl_lead(sl) now also matches delivery_lead for EVERY service line (cross-SL),
--    while service_line_lead stays scoped to its owned service line(s).
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_dl(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('delivery_lead','service_line_lead')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sl_lead(_sl public.service_line, _uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'delivery_lead'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_service_lines usl ON usl.user_id = ur.user_id
    WHERE ur.user_id = _uid AND ur.role = 'service_line_lead' AND usl.service_line = _sl
  );
$$;

-- ============================================================
-- 1. FINANCE = ZERO EDIT
--    Every WRITE that previously admitted plain finance via is_finance()
--    (= finance OR governance_lead) is narrowed to is_developer()/is_governance_lead().
--    is_finance() itself is UNCHANGED and still used for READ/visibility policies,
--    so Finance keeps read-everywhere while losing all edit rights.
-- ============================================================

-- Project lifecycle: Finance is no longer an actor in any transition.
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_gov boolean := public.is_governance_lead();
  is_d   boolean := public.is_dl();   -- delivery_lead OR service_line_lead
BEGIN
  IF is_dev THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT (is_d OR is_gov) THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Draft -> Verified : SL / Delivery Lead (or Governance)
  IF OLD.status = 'Draft' AND NEW.status = 'Verified' THEN
    IF NOT (is_d OR is_gov) THEN RAISE EXCEPTION 'Only SL / Delivery Lead can verify a Draft project'; END IF;
    RETURN NEW;
  END IF;

  -- Verified -> Active : Governance Lead only, contract still required (tracker Sheet 5)
  IF OLD.status = 'Verified' AND NEW.status = 'Active' THEN
    IF NOT is_gov THEN RAISE EXCEPTION 'Only Governance Lead can activate a project'; END IF;
    IF NOT COALESCE(NEW.contract_signed, false) THEN
      RAISE EXCEPTION 'Cannot activate project: signed contract required';
    END IF;
    RETURN NEW;
  END IF;

  -- On_Hold / Closed / Rejected : Governance or SL/Delivery Lead
  IF NEW.status IN ('On_Hold','Closed','Rejected') AND (is_gov OR is_d) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;

-- The finance column-guard is now redundant (finance is excluded from projects_update
-- entirely); drop it so finance cannot touch projects at all.
DROP TRIGGER IF EXISTS trg_guard_finance_project_update ON public.projects;
DROP FUNCTION IF EXISTS public.guard_finance_project_update();

-- PROJECTS write policies: swap is_finance() -> is_governance_lead().
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer() OR public.is_governance_lead() OR public.is_dl() OR public.is_pm()
  );

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
  USING (
    public.is_developer() OR public.is_governance_lead() OR public.is_dl()
    OR (public.is_pm() AND status = 'Draft' AND project_manager_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_developer() OR public.is_governance_lead() OR public.is_dl()
    OR (public.is_pm() AND status = 'Draft' AND project_manager_user_id = auth.uid())
  );

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated
  USING (public.is_developer() OR public.is_governance_lead());

-- ALLOCATIONS write policies: swap is_finance() -> is_governance_lead().
DROP POLICY IF EXISTS allocations_insert ON public.allocations;
CREATE POLICY allocations_insert ON public.allocations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer() OR public.is_governance_lead()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

DROP POLICY IF EXISTS allocations_update ON public.allocations;
CREATE POLICY allocations_update ON public.allocations FOR UPDATE TO authenticated
  USING (
    public.is_developer() OR public.is_governance_lead()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  )
  WITH CHECK (
    public.is_developer() OR public.is_governance_lead()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

DROP POLICY IF EXISTS allocations_delete ON public.allocations;
CREATE POLICY allocations_delete ON public.allocations FOR DELETE TO authenticated
  USING (
    public.is_developer() OR public.is_governance_lead()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

-- SNAPSHOTS: writing/archiving is an edit; exclude finance (keeps read via snap_select).
DROP POLICY IF EXISTS snap_admin ON public.allocation_snapshots;
CREATE POLICY snap_admin ON public.allocation_snapshots FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_governance_lead())
  WITH CHECK (public.is_developer() OR public.is_governance_lead());
