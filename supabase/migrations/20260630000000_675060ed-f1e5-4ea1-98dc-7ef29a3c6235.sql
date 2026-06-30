-- Phase 2 of RA_Standard_Requirements compliance: RLS rewrite & rules-engine triggers.
-- Pre-checked against live data: 0 duplicate allocation rows; 3 allocations reference
-- non-Active projects (On_Hold), which is fine since the new R-03 trigger is INSERT-only.

-- ============ FINANCE vs GOVERNANCE LEAD SPLIT ============
-- Master data ownership narrows to Governance Lead (+ developer); SL Lead scoped to own SL.
DROP POLICY IF EXISTS customers_write ON public.customers;
CREATE POLICY customers_write ON public.customers FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_governance_lead())
  WITH CHECK (public.is_developer() OR public.is_governance_lead());

DROP POLICY IF EXISTS resources_write ON public.resources;
CREATE POLICY resources_write ON public.resources FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_governance_lead() OR public.is_sl_lead(service_line))
  WITH CHECK (public.is_developer() OR public.is_governance_lead() OR public.is_sl_lead(service_line));

-- Plain "finance" keeps a narrow projects_update allowance (already covered by is_finance()
-- in the existing projects_update policy) but a column guard restricts what they can actually
-- change: only contract_signed, only while the project is Verified.
CREATE OR REPLACE FUNCTION public.guard_finance_project_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(),'finance')
     AND NOT public.is_governance_lead()
     AND NOT public.is_developer() THEN
    IF OLD.status <> 'Verified' THEN
      RAISE EXCEPTION 'Finance can only confirm contract on a Verified project';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.project_code IS DISTINCT FROM OLD.project_code
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.service_line IS DISTINCT FROM OLD.service_line
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.project_description IS DISTINCT FROM OLD.project_description
       OR NEW.project_manager_user_id IS DISTINCT FROM OLD.project_manager_user_id
    THEN
      RAISE EXCEPTION 'Finance role may only update contract_signed on a Verified project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_finance_project_update ON public.projects;
CREATE TRIGGER trg_guard_finance_project_update
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_finance_project_update();

-- Final activation gate (Verified -> Active) becomes Governance-Lead-only, not plain Finance.
CREATE OR REPLACE FUNCTION public.validate_project_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_dev boolean := public.is_developer();
  is_fin boolean := public.is_finance();
  is_d  boolean := public.is_dl();
  is_p  boolean := public.is_pm();
BEGIN
  IF is_dev THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' AND NOT (is_fin OR is_d) THEN
      RAISE EXCEPTION 'New projects must be created as Draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Verified' THEN
    IF NOT (is_d OR is_fin) THEN RAISE EXCEPTION 'Only Delivery Lead can verify a Draft project'; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'Verified' AND NEW.status = 'Active' THEN
    IF NOT (public.is_governance_lead() OR is_dev) THEN
      RAISE EXCEPTION 'Only Governance Lead can activate a project';
    END IF;
    IF NOT COALESCE(NEW.contract_signed, false) THEN
      RAISE EXCEPTION 'Cannot activate project: signed contract required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('On_Hold','Closed','Rejected') AND is_fin THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;

-- ============ SL LEAD ALLOCATION SCOPING ============
DROP POLICY IF EXISTS allocations_insert ON public.allocations;
CREATE POLICY allocations_insert ON public.allocations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

DROP POLICY IF EXISTS allocations_update ON public.allocations;
CREATE POLICY allocations_update ON public.allocations FOR UPDATE TO authenticated
  USING (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  )
  WITH CHECK (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

DROP POLICY IF EXISTS allocations_delete ON public.allocations;
CREATE POLICY allocations_delete ON public.allocations FOR DELETE TO authenticated
  USING (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
    OR public.is_sl_lead(service_line)
  );

-- ============ RESOURCE SELF-SERVICE VISIBILITY (never narrows for a higher role) ============
DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated
  USING (
    NOT public.is_resource_role()
    OR public.is_developer() OR public.is_governance_lead() OR public.has_role(auth.uid(),'finance')
    OR public.is_dl() OR public.is_pm() OR public.is_sl_lead(service_line)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS allocations_select ON public.allocations;
CREATE POLICY allocations_select ON public.allocations FOR SELECT TO authenticated
  USING (
    NOT public.is_resource_role()
    OR public.is_developer() OR public.is_governance_lead() OR public.has_role(auth.uid(),'finance')
    OR public.is_dl() OR public.is_pm() OR public.is_sl_lead(service_line)
    OR resource_id IN (SELECT id FROM public.resources WHERE user_id = auth.uid())
  );

-- ============ R-04: On-Leave/Exited resources cannot get NEW allocations (Hard Block) ============
CREATE OR REPLACE FUNCTION public.validate_resource_active_for_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rstatus public.resource_status;
BEGIN
  IF NEW.allocation_type = 'Leave' THEN RETURN NEW; END IF;
  SELECT status INTO rstatus FROM public.resources WHERE id = NEW.resource_id;
  IF rstatus IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'Cannot allocate resource with status % — resource must be Active (R-04)', rstatus;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_resource_active ON public.allocations;
CREATE TRIGGER trg_validate_resource_active
  BEFORE INSERT ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_resource_active_for_allocation();

-- ============ R-01: 100% cap with Governance override (logged) ============
ALTER TABLE public.allocations ADD COLUMN IF NOT EXISTS cap_override boolean NOT NULL DEFAULT false;
ALTER TABLE public.allocations ADD COLUMN IF NOT EXISTS cap_override_reason text;
ALTER TABLE public.allocations ADD COLUMN IF NOT EXISTS cap_override_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.validate_allocation_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE max_total INT;
BEGIN
  SELECT COALESCE(MAX(total),0) INTO max_total FROM (
    SELECT d::date AS day, SUM(allocation_pct) AS total
    FROM public.allocations a,
         generate_series(GREATEST(a.allocation_start_date, NEW.allocation_start_date),
                         LEAST(a.allocation_end_date, NEW.allocation_end_date),
                         interval '1 day') d
    WHERE a.resource_id = NEW.resource_id
      AND a.id <> COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND a.allocation_end_date >= NEW.allocation_start_date
      AND a.allocation_start_date <= NEW.allocation_end_date
    GROUP BY d
  ) s;

  IF (max_total + NEW.allocation_pct) > 100 THEN
    IF NEW.cap_override IS TRUE THEN
      IF NEW.cap_override_reason IS NULL OR length(trim(NEW.cap_override_reason)) = 0 THEN
        RAISE EXCEPTION 'cap_override requires a non-empty cap_override_reason (R-01)';
      END IF;
      IF NOT (public.is_developer() OR public.is_governance_lead()) THEN
        RAISE EXCEPTION 'Only Governance Lead can override the 100%% allocation cap (R-01)';
      END IF;
      NEW.cap_override_by := auth.uid();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Over-allocation: existing % %% + new % %% exceeds 100%% on overlapping dates', max_total, NEW.allocation_pct;
  END IF;
  RETURN NEW;
END;
$$;

-- ============ R-02: date-bounds Warning + override (safe default = hard block, unchanged) ============
ALTER TABLE public.allocations ADD COLUMN IF NOT EXISTS date_override_reason text;

CREATE OR REPLACE FUNCTION public.validate_allocation_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p RECORD; out_of_bounds boolean := false;
BEGIN
  IF NEW.allocation_type = 'Leave' THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT start_date, end_date, status INTO p FROM public.projects WHERE id = NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;

  IF NEW.allocation_start_date < p.start_date OR NEW.allocation_end_date > p.end_date THEN
    out_of_bounds := true;
  END IF;

  IF out_of_bounds THEN
    IF NEW.date_override_reason IS NOT NULL AND length(trim(NEW.date_override_reason)) > 0 THEN
      IF NOT (public.is_developer() OR public.is_governance_lead() OR public.is_pm() OR public.is_sl_lead(NEW.service_line)) THEN
        RAISE EXCEPTION 'Only PM / Service Line Lead / Governance can override allocation date bounds (R-02)';
      END IF;
      RAISE WARNING 'Allocation dates [% , %] fall outside project window [% , %] — override reason: %',
        NEW.allocation_start_date, NEW.allocation_end_date, p.start_date, p.end_date, NEW.date_override_reason;
    ELSE
      RAISE EXCEPTION 'Allocation dates [% , %] must fall within project dates [% , %] (R-02) — supply date_override_reason to override',
        NEW.allocation_start_date, NEW.allocation_end_date, p.start_date, p.end_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ============ R-03: only Active projects, enforced at DB level (was UI-only) ============
CREATE OR REPLACE FUNCTION public.validate_allocation_project_active()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pstatus public.project_status;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO pstatus FROM public.projects WHERE id = NEW.project_id;
  IF pstatus IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'Cannot create allocation against project with status % — project must be Active (R-03)', pstatus;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_allocation_project_active ON public.allocations;
CREATE TRIGGER trg_validate_allocation_project_active
  BEFORE INSERT ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_allocation_project_active();

-- ============ RETENTION PROTECTION (doc 9.3: do not delete Exited/Closed) ============
CREATE OR REPLACE FUNCTION public.prevent_exited_resource_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Exited' THEN
    RAISE EXCEPTION 'Resource % is Exited and is retained per policy — deletion is not permitted', OLD.full_name;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_exited_resource_delete ON public.resources;
CREATE TRIGGER trg_prevent_exited_resource_delete
  BEFORE DELETE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_exited_resource_delete();

CREATE OR REPLACE FUNCTION public.prevent_closed_project_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Closed' THEN
    RAISE EXCEPTION 'Project % is Closed and is retained per policy — deletion is not permitted', OLD.project_code;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_closed_project_delete ON public.projects;
CREATE TRIGGER trg_prevent_closed_project_delete
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.prevent_closed_project_delete();

-- ============ DATA QUALITY: no duplicate allocation rows (doc 9.2) ============
CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_no_dupe
  ON public.allocations (resource_id, project_id, allocation_start_date, allocation_end_date, allocation_type)
  WHERE project_id IS NOT NULL;

-- ============ AUDIT COMPLETENESS (doc NFR Auditability) ============
DROP TRIGGER IF EXISTS trg_audit_resources ON public.resources;
CREATE TRIGGER trg_audit_resources AFTER INSERT OR UPDATE OR DELETE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_customers ON public.customers;
CREATE TRIGGER trg_audit_customers AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
