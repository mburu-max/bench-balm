DROP POLICY IF EXISTS sl_select ON public.service_lines;
CREATE POLICY sl_select ON public.service_lines
  FOR SELECT
  TO authenticated
  USING (public.has_sl_access(id));

REVOKE EXECUTE ON FUNCTION public.list_project_managers() FROM PUBLIC, anon;