-- Allocation picker pool. The strict resources_select policy limits a PM's *reads*
-- (and dashboard) to resources already on their projects. But to STAFF a project a PM
-- needs to pick from the bench, so this SECURITY DEFINER function returns the wider
-- "allocatable" set without loosening RLS anywhere else:
--   global roles / SL & Delivery Leads -> their normal has_sl_access scope
--   PM                                 -> active resources in the service line(s) of the
--                                         projects they own (their staffing pool)
-- Used only by the allocation forms' resource dropdowns.
CREATE OR REPLACE FUNCTION public.allocatable_resources()
RETURNS SETOF public.resources
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.resources r
  WHERE r.status = 'Active'
    AND (
      public.has_sl_access(r.service_line)
      OR (
        public.is_pm() AND r.service_line IN (
          SELECT DISTINCT service_line FROM public.projects WHERE project_manager_user_id = auth.uid()
        )
      )
    )
  ORDER BY r.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.allocatable_resources() TO authenticated;
