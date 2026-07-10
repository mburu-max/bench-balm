-- Widen a PM's Resource Master view: they should see all resources in the service line(s) their
-- projects sit in (read-only), not only the resources already allocated to their projects.
-- Write access is unchanged (resources_write still excludes PMs).
CREATE OR REPLACE FUNCTION public.pm_project_service_lines()
RETURNS SETOF public.service_line
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT service_line
  FROM public.projects
  WHERE project_manager_user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.pm_project_service_lines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pm_project_service_lines() TO authenticated;

DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated
USING (
  public.has_sl_access(service_line)
  OR (user_id = auth.uid())
  OR (public.is_pm() AND service_line IN (SELECT public.pm_project_service_lines()))
);
