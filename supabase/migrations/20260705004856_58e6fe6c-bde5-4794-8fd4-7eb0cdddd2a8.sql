
-- 1) Tighten SELECT policies on sensitive tables

DROP POLICY IF EXISTS profiles_read_all ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin_like(auth.uid())
    OR public.is_dl()
    OR public.is_finance()
    OR public.is_pm()
  );

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.is_admin_like(auth.uid())
    OR public.is_finance()
    OR public.is_dl()
    OR public.is_pm()
    OR public.is_developer()
  );

DROP POLICY IF EXISTS demand_select ON public.demand_requests;
CREATE POLICY demand_select ON public.demand_requests
  FOR SELECT TO authenticated
  USING (
    public.is_developer()
    OR public.is_finance()
    OR public.is_dl()
    OR created_by = auth.uid()
    OR (service_line IS NOT NULL AND public.has_sl_access(service_line::public.service_line))
  );

DROP POLICY IF EXISTS snap_select ON public.allocation_snapshots;
CREATE POLICY snap_select ON public.allocation_snapshots
  FOR SELECT TO authenticated
  USING (
    public.is_developer()
    OR public.is_governance_lead()
    OR public.is_finance()
    OR public.is_dl()
    OR (service_line IS NOT NULL AND public.has_sl_access(service_line::public.service_line))
  );

DROP POLICY IF EXISTS hf_select ON public.headcount_forecast;
CREATE POLICY hf_select ON public.headcount_forecast
  FOR SELECT TO authenticated
  USING (
    public.is_developer()
    OR public.is_governance_lead()
    OR public.is_finance()
    OR public.is_dl()
    OR public.has_sl_access(service_line)
  );

DROP POLICY IF EXISTS sl_select ON public.service_lines;
CREATE POLICY sl_select ON public.service_lines
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS usl_select ON public.user_service_lines;
CREATE POLICY usl_select ON public.user_service_lines
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin_like(auth.uid())
    OR public.is_dl()
    OR public.is_finance()
    OR public.is_pm()
  );

-- 2) Set search_path on remaining functions (idempotent)
ALTER FUNCTION public.handle_resource_exit() SET search_path = public;
ALTER FUNCTION public.prevent_closed_project_delete() SET search_path = public;
ALTER FUNCTION public.prevent_exited_resource_delete() SET search_path = public;
ALTER FUNCTION public.prevent_project_delete_with_allocations() SET search_path = public;
ALTER FUNCTION public.set_demand_fulfilled_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.validate_allocation_cap() SET search_path = public;
ALTER FUNCTION public.validate_allocation_dates() SET search_path = public;
ALTER FUNCTION public.validate_allocation_project_active() SET search_path = public;
ALTER FUNCTION public.validate_nonbillable_project() SET search_path = public;
ALTER FUNCTION public.validate_project_code() SET search_path = public;
ALTER FUNCTION public.validate_resource_active_for_allocation() SET search_path = public;

-- 3) Ensure all public views run as the querying user (respect RLS)
ALTER VIEW public.v_utilisation_weekly SET (security_invoker = true);
ALTER VIEW public.v_kpi_project_code_coverage SET (security_invoker = true);
ALTER VIEW public.v_kpi_allocation_freshness SET (security_invoker = true);
ALTER VIEW public.v_kpi_avg_bench_days SET (security_invoker = true);
ALTER VIEW public.v_kpi_demand_lead_time SET (security_invoker = true);
ALTER VIEW public.v_kpi_forecast_accuracy SET (security_invoker = true);
ALTER VIEW public.v_kpi_utilisation_now SET (security_invoker = true);
ALTER VIEW public.v_resource_bench_streak SET (security_invoker = true);
ALTER VIEW public.v_cliff_edge SET (security_invoker = true);

-- 4) Revoke EXECUTE from anon (and PUBLIC) on SECURITY DEFINER functions.
-- Trigger functions also get revoked from authenticated — they only run
-- via triggers with the definer's rights and should not be callable directly.
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_project_transition() FROM PUBLIC, anon, authenticated;

-- Helper/role predicates: keep for authenticated (RLS policies call them), revoke anon.
REVOKE ALL ON FUNCTION public.allocatable_resources() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_sl_access(public.service_line, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_like(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_developer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_dl(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_finance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_governance_lead(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_pm(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_project_pm(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_resource_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_sl_lead(public.service_line, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_allocated_project_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_pm_project_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_resource_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pm_project_resource_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_project_code(public.service_line) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_leave(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_from_leave(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.take_allocation_snapshot(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.allocatable_resources() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_sl_access(public.service_line, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_like(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_developer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_dl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_governance_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_pm(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_resource_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sl_lead(public.service_line, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_allocated_project_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pm_project_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_resource_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pm_project_resource_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_project_code(public.service_line) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_leave(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_from_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.take_allocation_snapshot(date) TO authenticated;
