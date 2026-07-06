-- Delivery Lead role cut (Sharad, July sync): validation now sits entirely with the
-- Service Line Lead. The delivery_lead enum value can't be dropped from Postgres, so we
-- make it grant NOTHING — is_dl() and is_sl_lead() no longer match delivery_lead. No user
-- holds it, so this is inert today and prevents any future delivery_lead from gaining powers.
CREATE OR REPLACE FUNCTION public.is_dl(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'service_line_lead');
$$;

CREATE OR REPLACE FUNCTION public.is_sl_lead(_sl public.service_line, _uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_service_lines usl ON usl.user_id = ur.user_id
    WHERE ur.user_id = _uid AND ur.role = 'service_line_lead' AND usl.service_line = _sl
  );
$$;
