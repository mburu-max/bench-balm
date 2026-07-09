-- Fix: is_admin_like() omitted the 'developer' role — it matched only ('admin','governance_lead').
-- Per the role model, developer is the L0 superuser and must be "admin-like". The omission meant a
-- developer-ONLY account (no governance_lead) failed the profiles / user_service_lines SELECT
-- policies (which gate on is_admin_like) and so could only read its own row — e.g. the Admin -> Users
-- list showed only the signed-in developer, not everyone. It also blocked developer writes to customer
-- master data (customers_write gates on is_admin_like). It "worked" previously only because the other
-- developer account also carries governance_lead.
--
-- Adding 'developer' restores the intended superuser behaviour everywhere is_admin_like is used
-- (profiles read, user_service_lines read, customers write). It only grants MORE to developers, who
-- are already the top of the hierarchy, so there is no downgrade for any other role.
CREATE OR REPLACE FUNCTION public.is_admin_like(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','developer','governance_lead')
  );
$$;
