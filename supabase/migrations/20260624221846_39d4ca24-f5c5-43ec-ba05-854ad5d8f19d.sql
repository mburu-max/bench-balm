
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','governance_lead','delivery_lead','project_manager','finance','viewer');
CREATE TYPE public.service_line AS ENUM ('DLaaS','CLM','MS','CCaaS','Legacy');
CREATE TYPE public.allocation_type AS ENUM ('Billable','Non-Billable','Bench','Leave');
CREATE TYPE public.project_status AS ENUM ('Draft','Pending_Delivery_Lead','Pending_Finance','Active','On_Hold','Closed','Rejected');
CREATE TYPE public.resource_status AS ENUM ('Active','On_Leave','Exited');
CREATE TYPE public.employment_type AS ENUM ('FTE','Contractor','Vendor');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Auto-create profile + bootstrap first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'governance_lead');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_read_all" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin_like(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','governance_lead'));
$$;

-- Admin/governance can manage roles
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin_like(auth.uid())) WITH CHECK (public.is_admin_like(auth.uid()));

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ UPDATED_AT helper ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ CUSTOMERS ============
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL UNIQUE,
  service_lines public.service_line[] NOT NULL DEFAULT '{}',
  region TEXT,
  vertical TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_read_all" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_admin_write" ON public.customers FOR ALL TO authenticated
  USING (public.is_admin_like(auth.uid())) WITH CHECK (public.is_admin_like(auth.uid()));
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PROJECTS ============
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT NOT NULL UNIQUE,
  hubspot_deal_id TEXT,
  project_description TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  service_line public.service_line NOT NULL,
  project_manager_id UUID REFERENCES auth.users(id),
  delivery_lead_id UUID REFERENCES auth.users(id),
  governance_lead_id UUID REFERENCES auth.users(id),
  delivery_center TEXT,
  client_region TEXT,
  vertical TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status public.project_status NOT NULL DEFAULT 'Draft',
  contract_signed BOOLEAN NOT NULL DEFAULT false,
  approval_notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_read_all" ON public.projects FOR SELECT TO authenticated USING (true);
-- Anyone signed in can create draft projects (acts as PM)
CREATE POLICY "projects_insert_any" ON public.projects FOR INSERT TO authenticated WITH CHECK (true);
-- Admin/gov can update anything; PM can update their own draft; delivery lead can update assigned for approval flow
CREATE POLICY "projects_update_admin" ON public.projects FOR UPDATE TO authenticated
  USING (
    public.is_admin_like(auth.uid())
    OR project_manager_id = auth.uid()
    OR delivery_lead_id = auth.uid()
    OR public.has_role(auth.uid(),'finance')
  );
CREATE POLICY "projects_delete_admin" ON public.projects FOR DELETE TO authenticated
  USING (public.is_admin_like(auth.uid()));
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ RESOURCES ============
CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  omni_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  position TEXT,
  department TEXT,
  location TEXT,
  manager_name TEXT,
  employment_type public.employment_type NOT NULL DEFAULT 'FTE',
  default_allocation_type public.allocation_type NOT NULL DEFAULT 'Bench',
  status public.resource_status NOT NULL DEFAULT 'Active',
  service_line public.service_line NOT NULL,
  email TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "resources_read_all" ON public.resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "resources_admin_write" ON public.resources FOR ALL TO authenticated
  USING (public.is_admin_like(auth.uid())) WITH CHECK (public.is_admin_like(auth.uid()));
CREATE TRIGGER resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ALLOCATIONS ============
CREATE TABLE public.allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  service_line public.service_line NOT NULL,
  -- snapshots
  omni_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  role TEXT,
  manager TEXT,
  location TEXT,
  employment_type public.employment_type,
  resource_status public.resource_status,
  -- editable
  allocation_type public.allocation_type NOT NULL DEFAULT 'Billable',
  allocation_start_date DATE NOT NULL,
  allocation_end_date DATE NOT NULL,
  allocation_pct INT NOT NULL CHECK (allocation_pct BETWEEN 1 AND 100),
  remarks TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (allocation_end_date >= allocation_start_date)
);
CREATE INDEX allocations_resource_idx ON public.allocations(resource_id);
CREATE INDEX allocations_project_idx ON public.allocations(project_id);
CREATE INDEX allocations_dates_idx ON public.allocations(allocation_start_date, allocation_end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocations TO authenticated;
GRANT ALL ON public.allocations TO service_role;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allocations_read_all" ON public.allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "allocations_write_any_auth" ON public.allocations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE TRIGGER allocations_updated_at BEFORE UPDATE ON public.allocations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Validation triggers =====

-- 1) Allocation dates must fall within project dates (only for project-tied, non-Leave rows)
CREATE OR REPLACE FUNCTION public.validate_allocation_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.allocation_type = 'Leave' THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT start_date, end_date, status INTO p FROM public.projects WHERE id = NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF NEW.allocation_start_date < p.start_date THEN
    RAISE EXCEPTION 'Allocation start date (%) is before project start date (%)', NEW.allocation_start_date, p.start_date;
  END IF;
  IF NEW.allocation_end_date > p.end_date THEN
    RAISE EXCEPTION 'Allocation end date (%) is after project end date (%)', NEW.allocation_end_date, p.end_date;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocations_validate_dates
  BEFORE INSERT OR UPDATE ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_allocation_dates();

-- 2) 100% cap across overlapping date ranges for the same resource
CREATE OR REPLACE FUNCTION public.validate_allocation_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE max_total INT;
BEGIN
  SELECT COALESCE(MAX(total),0) INTO max_total FROM (
    SELECT d::date AS day, SUM(allocation_pct) AS total
    FROM public.allocations a,
         generate_series(GREATEST(a.allocation_start_date, NEW.allocation_start_date),
                         LEAST(a.allocation_end_date, NEW.allocation_end_date),
                         interval '1 day') d
    WHERE a.resource_id = NEW.resource_id
      AND a.id <> COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND a.allocation_end_date >= NEW.allocation_start_date
      AND a.allocation_start_date <= NEW.allocation_end_date
    GROUP BY d
  ) s;
  IF (max_total + NEW.allocation_pct) > 100 THEN
    RAISE EXCEPTION 'Over-allocation: existing % %% + new % %% exceeds 100%% on overlapping dates', max_total, NEW.allocation_pct;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocations_validate_cap
  BEFORE INSERT OR UPDATE ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_allocation_cap();
