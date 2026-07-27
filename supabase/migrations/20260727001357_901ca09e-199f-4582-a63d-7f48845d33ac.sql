CREATE OR REPLACE FUNCTION public.list_project_managers()
 RETURNS TABLE(user_id uuid, full_name text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    public.is_developer()
    OR public.is_governance_lead()
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND role = 'service_line_lead')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
    SELECT p.id, p.full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE ur.role = 'project_manager'
    ORDER BY p.full_name NULLS LAST, p.email;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_project_managers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_managers() TO authenticated;