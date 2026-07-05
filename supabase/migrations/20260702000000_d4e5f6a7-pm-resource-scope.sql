-- Tighten PM resource visibility to match the per-role visibility spec:
-- a Project Manager sees ONLY the resources allocated to the projects they own —
-- not the whole service-line pool. (Governance/Finance stay global; SL/Delivery
-- Leads stay scoped to their assigned service line(s) via has_sl_access.)
CREATE OR REPLACE FUNCTION public.pm_project_resource_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT a.resource_id FROM public.allocations a
  WHERE a.project_id IN (SELECT id FROM public.projects WHERE project_manager_user_id = auth.uid());
$$;

DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated
  USING (
    public.has_sl_access(service_line)
    OR user_id = auth.uid()
    OR (public.is_pm() AND id IN (SELECT public.pm_project_resource_ids()))
  );

DROP FUNCTION IF EXISTS public.my_pm_service_lines();
