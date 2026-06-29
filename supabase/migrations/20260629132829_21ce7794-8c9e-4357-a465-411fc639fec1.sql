
ALTER FUNCTION public.validate_project_code() SET search_path = public;
ALTER FUNCTION public.validate_nonbillable_project() SET search_path = public;
ALTER FUNCTION public.handle_resource_exit() SET search_path = public;
ALTER VIEW public.v_utilisation_weekly SET (security_invoker = true);
