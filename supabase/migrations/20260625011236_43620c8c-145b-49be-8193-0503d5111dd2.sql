
-- 1) Add 'developer' to app_role; migrate admin -> developer
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'developer';
COMMIT;

UPDATE public.user_roles SET role = 'developer' WHERE role = 'admin';
DELETE FROM public.user_roles a USING public.user_roles b
  WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.role = b.role;

-- 2) Add 'Verified' to project_status; migrate old statuses
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'Verified';
COMMIT;

UPDATE public.projects SET status = 'Draft' WHERE status::text = 'Pending_Delivery_Lead';
UPDATE public.projects SET status = 'Verified' WHERE status::text = 'Pending_Finance';

-- 3) Add project_manager_user_id column on projects (link to auth user)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_manager_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_pm_user ON public.projects(project_manager_user_id);

-- 4) Helper functions (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'developer' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'governance_lead' THEN 3
    WHEN 'finance' THEN 4
    WHEN 'delivery_lead' THEN 5
    WHEN 'project_manager' THEN 6
    ELSE 99 END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_developer(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('developer','admin'));
$$;

CREATE OR REPLACE FUNCTION public.is_finance(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('finance','governance_lead'));
$$;

CREATE OR REPLACE FUNCTION public.is_dl(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'delivery_lead');
$$;

CREATE OR REPLACE FUNCTION public.is_pm(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'project_manager');
$$;

CREATE OR REPLACE FUNCTION public.is_project_pm(_project_id uuid, _uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND project_manager_user_id = _uid);
$$;

-- 5) Project status-transition trigger
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

  -- Draft -> Verified : DL or Finance or Dev
  IF OLD.status = 'Draft' AND NEW.status = 'Verified' THEN
    IF NOT (is_d OR is_fin) THEN RAISE EXCEPTION 'Only Delivery Lead can verify a Draft project'; END IF;
    RETURN NEW;
  END IF;

  -- Verified -> Active : Finance, requires contract_signed
  IF OLD.status = 'Verified' AND NEW.status = 'Active' THEN
    IF NOT is_fin THEN RAISE EXCEPTION 'Only Finance / Governance can activate a project'; END IF;
    IF NOT COALESCE(NEW.contract_signed, false) THEN
      RAISE EXCEPTION 'Cannot activate project: signed contract required';
    END IF;
    RETURN NEW;
  END IF;

  -- Allow finance to move things to On_Hold / Closed / Rejected
  IF NEW.status IN ('On_Hold','Closed','Rejected') AND is_fin THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid status transition % -> % for current role', OLD.status, NEW.status;
END $$;

DROP TRIGGER IF EXISTS trg_validate_project_transition ON public.projects;
CREATE TRIGGER trg_validate_project_transition
  BEFORE INSERT OR UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_transition();

-- 6) Replace RLS policies

-- PROJECTS
DROP POLICY IF EXISTS projects_read_all ON public.projects;
DROP POLICY IF EXISTS projects_insert_any ON public.projects;
DROP POLICY IF EXISTS projects_update_admin ON public.projects;
DROP POLICY IF EXISTS projects_delete_admin ON public.projects;

CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated USING (true);

CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer() OR public.is_finance() OR public.is_dl() OR public.is_pm()
  );

CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
  USING (
    public.is_developer()
    OR public.is_finance()
    OR public.is_dl()
    OR (public.is_pm() AND status = 'Draft' AND project_manager_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_developer()
    OR public.is_finance()
    OR public.is_dl()
    OR (public.is_pm() AND status = 'Draft' AND project_manager_user_id = auth.uid())
  );

CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated
  USING (public.is_developer() OR public.is_finance());

-- ALLOCATIONS
DROP POLICY IF EXISTS allocations_read_all ON public.allocations;
DROP POLICY IF EXISTS allocations_write_any_auth ON public.allocations;

CREATE POLICY allocations_select ON public.allocations FOR SELECT TO authenticated USING (true);

CREATE POLICY allocations_insert ON public.allocations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
  );

CREATE POLICY allocations_update ON public.allocations FOR UPDATE TO authenticated
  USING (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
  )
  WITH CHECK (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
  );

CREATE POLICY allocations_delete ON public.allocations FOR DELETE TO authenticated
  USING (
    public.is_developer() OR public.is_finance()
    OR (public.is_pm() AND project_id IS NOT NULL AND public.is_project_pm(project_id))
  );

-- CUSTOMERS
DROP POLICY IF EXISTS customers_read_all ON public.customers;
DROP POLICY IF EXISTS customers_admin_write ON public.customers;

CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_write ON public.customers FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_finance())
  WITH CHECK (public.is_developer() OR public.is_finance());

-- RESOURCES
DROP POLICY IF EXISTS resources_read_all ON public.resources;
DROP POLICY IF EXISTS resources_admin_write ON public.resources;

CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated USING (true);
CREATE POLICY resources_write ON public.resources FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_finance())
  WITH CHECK (public.is_developer() OR public.is_finance());

-- USER_ROLES
DROP POLICY IF EXISTS user_roles_read_all ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_developer());

CREATE POLICY user_roles_write ON public.user_roles FOR ALL TO authenticated
  USING (public.is_developer())
  WITH CHECK (public.is_developer());

-- 7) Update handle_new_user to default to project_manager
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'developer');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'project_manager');
  END IF;
  RETURN NEW;
END;
$$;
