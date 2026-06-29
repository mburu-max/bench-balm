-- Phase 1 of RA_Standard_Requirements compliance: RBAC & schema foundation.
-- Additive only — no existing policy/trigger behavior changes here (that's Phase 2).

-- ============ NEW ROLES ============
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'service_line_lead';
COMMIT;
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'resource';
COMMIT;

-- ============ SL LEAD OWNERSHIP ============
CREATE TABLE IF NOT EXISTS public.user_service_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_line public.service_line NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_line)
);
GRANT SELECT ON public.user_service_lines TO authenticated;
GRANT ALL ON public.user_service_lines TO service_role;
ALTER TABLE public.user_service_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usl_select ON public.user_service_lines;
DROP POLICY IF EXISTS usl_write ON public.user_service_lines;
CREATE POLICY usl_select ON public.user_service_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY usl_write ON public.user_service_lines FOR ALL TO authenticated
  USING (public.is_developer()) WITH CHECK (public.is_developer());

-- ============ HELPER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.is_sl_lead(_sl public.service_line, _uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_service_lines usl ON usl.user_id = ur.user_id
    WHERE ur.user_id = _uid AND ur.role = 'service_line_lead' AND usl.service_line = _sl
  );
$$;

CREATE OR REPLACE FUNCTION public.is_governance_lead(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'governance_lead');
$$;

CREATE OR REPLACE FUNCTION public.is_resource_role(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'resource');
$$;

-- ============ RESOURCE SELF-SERVICE LINK ============
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_user_id ON public.resources(user_id) WHERE user_id IS NOT NULL;

-- ============ SERVICE LINE MASTER ============
CREATE TABLE IF NOT EXISTS public.service_lines (
  id public.service_line PRIMARY KEY,
  full_name text NOT NULL,
  lead_user_id uuid REFERENCES auth.users(id),
  description text,
  target_utilisation_min int,
  target_utilisation_max int,
  buffer_pct_min int,
  buffer_pct_max int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.service_lines (id, full_name, target_utilisation_min, target_utilisation_max, buffer_pct_min, buffer_pct_max) VALUES
  ('CLM','Contract Lifecycle Management', 85, 90, 10, 15),
  ('MS','Managed Services', 90, 95, 5, 10),
  ('DLaaS','Data Labeling as a Service', 85, 90, 10, 15),
  ('CCaaS','Contact Center as a Service', 85, 90, 10, 15),
  ('Legacy','Legacy / BSS', 95, 100, 0, 5)
ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON public.service_lines TO authenticated;
GRANT ALL ON public.service_lines TO service_role;
ALTER TABLE public.service_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sl_select ON public.service_lines;
DROP POLICY IF EXISTS sl_write ON public.service_lines;
CREATE POLICY sl_select ON public.service_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY sl_write ON public.service_lines FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_governance_lead())
  WITH CHECK (public.is_developer() OR public.is_governance_lead());
DROP TRIGGER IF EXISTS service_lines_updated_at ON public.service_lines;
CREATE TRIGGER service_lines_updated_at BEFORE UPDATE ON public.service_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ HEADCOUNT FORECAST (for Forecast Accuracy KPI, Phase 4) ============
CREATE TABLE IF NOT EXISTS public.headcount_forecast (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL,
  service_line public.service_line NOT NULL,
  planned_headcount int NOT NULL CHECK (planned_headcount >= 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, service_line)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.headcount_forecast TO authenticated;
GRANT ALL ON public.headcount_forecast TO service_role;
ALTER TABLE public.headcount_forecast ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hf_select ON public.headcount_forecast;
DROP POLICY IF EXISTS hf_write ON public.headcount_forecast;
CREATE POLICY hf_select ON public.headcount_forecast FOR SELECT TO authenticated USING (true);
CREATE POLICY hf_write ON public.headcount_forecast FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_governance_lead())
  WITH CHECK (public.is_developer() OR public.is_governance_lead());

-- ============ NEW SIGNUP DEFAULT → 'resource' (doc L5 self-service tier) ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'developer');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'resource');
  END IF;
  RETURN NEW;
END;
$$;

-- ============ RESOURCE SELF-SERVICE RPCS (R-04/L5: leave is self-reported, status-gated) ============
CREATE OR REPLACE FUNCTION public.request_leave(_resource_id uuid, _start date, _end date, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; r RECORD;
BEGIN
  SELECT * INTO r FROM public.resources WHERE id = _resource_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not your resource record';
  END IF;
  IF _end < _start THEN
    RAISE EXCEPTION 'End date before start date';
  END IF;

  INSERT INTO public.allocations (
    resource_id, project_id, customer_id, service_line, omni_id, resource_name,
    role, manager, location, employment_type, resource_status,
    allocation_type, allocation_start_date, allocation_end_date, allocation_pct, remarks, created_by
  ) VALUES (
    r.id, NULL, NULL, r.service_line, r.omni_id, r.full_name,
    r.position, r.manager_name, r.location, r.employment_type, r.status,
    'Leave', _start, _end, 100, _reason, auth.uid()
  )
  RETURNING id INTO new_id;

  UPDATE public.resources SET status = 'On_Leave' WHERE id = _resource_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_from_leave(_resource_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resources WHERE id = _resource_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not your resource record';
  END IF;
  UPDATE public.allocations SET allocation_end_date = CURRENT_DATE
    WHERE resource_id = _resource_id AND allocation_type = 'Leave' AND allocation_end_date > CURRENT_DATE;
  UPDATE public.resources SET status = 'Active' WHERE id = _resource_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_leave(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_from_leave(uuid) TO authenticated;
