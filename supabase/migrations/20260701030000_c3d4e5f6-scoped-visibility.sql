-- Scoped read visibility (Dashboard Dev Tracker RBAC + RA §9.1). Each user sees only
-- their slice; because the dashboard/bench/KPIs read these same tables, they auto-scope.
--
--   Developer / Governance / Finance : everything (Finance read-only via other policies)
--   SL Lead / Delivery Lead          : only their assigned service line(s) (user_service_lines)
--   Project Manager                  : only the projects they own; resource pool of their
--                                       projects' service line(s) so they can staff them
--   Resource                         : only their own profile + allocations
--   Customers                        : readable by all (docs: Customer Master read = all stakeholders)
--
-- All cross-table lookups go through SECURITY DEFINER helpers so RLS never recurses.

-- ============ VISIBILITY HELPERS ============
-- Global roles OR a member of the given service line.
CREATE OR REPLACE FUNCTION public.has_sl_access(_sl public.service_line, _uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_developer(_uid)
    OR public.is_governance_lead(_uid)
    OR public.has_role(_uid, 'finance')
    OR EXISTS (SELECT 1 FROM public.user_service_lines u WHERE u.user_id = _uid AND u.service_line = _sl);
$$;

-- resource rows linked to the current login (a self-service resource user)
CREATE OR REPLACE FUNCTION public.my_resource_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.resources WHERE user_id = auth.uid();
$$;

-- projects the current user manages (PM scope)
CREATE OR REPLACE FUNCTION public.my_pm_project_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.projects WHERE project_manager_user_id = auth.uid();
$$;

-- projects the current user is allocated to (resource scope, for the my-profile join)
CREATE OR REPLACE FUNCTION public.my_allocated_project_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT a.project_id FROM public.allocations a
  WHERE a.resource_id IN (SELECT id FROM public.resources WHERE user_id = auth.uid())
    AND a.project_id IS NOT NULL;
$$;

-- service line(s) of the projects the current user manages (PM resource-pool scope)
CREATE OR REPLACE FUNCTION public.my_pm_service_lines()
RETURNS SETOF public.service_line LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT service_line FROM public.projects WHERE project_manager_user_id = auth.uid();
$$;

-- ============ SCOPED SELECT POLICIES ============
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated
  USING (
    public.has_sl_access(service_line)
    OR (public.is_pm() AND project_manager_user_id = auth.uid())
    OR id IN (SELECT public.my_allocated_project_ids())
  );

DROP POLICY IF EXISTS allocations_select ON public.allocations;
CREATE POLICY allocations_select ON public.allocations FOR SELECT TO authenticated
  USING (
    public.has_sl_access(service_line)
    OR (public.is_pm() AND project_id IN (SELECT public.my_pm_project_ids()))
    OR resource_id IN (SELECT public.my_resource_ids())
  );

DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated
  USING (
    public.has_sl_access(service_line)
    OR user_id = auth.uid()
    OR (public.is_pm() AND service_line IN (SELECT public.my_pm_service_lines()))
  );

-- Customer Master is readable by all stakeholders (docs). Not scoped.
DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated USING (true);

-- Make the cliff-edge view respect the querying user's RLS (so the dashboard banner
-- and Cliff Edge page scope too, instead of running with the view owner's rights).
ALTER VIEW public.v_cliff_edge SET (security_invoker = true);
