-- Extend the audit trail to demand_requests (request workflow: status/priority/fulfilment changes)
-- and profiles (user identity — name/email changes). Both have an `id` column, so the existing
-- audit_row_change() trigger applies unchanged.
DROP TRIGGER IF EXISTS trg_audit_demand_requests ON public.demand_requests;
CREATE TRIGGER trg_audit_demand_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.demand_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
