
CREATE OR REPLACE FUNCTION public.validate_project_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_code !~ '^(CLM|MS|DLAAS|CCAAS|LEGACY|INT|NB)-[0-9]{4}-[0-9]{3}$' THEN
    RAISE EXCEPTION 'Project code "%" must match [SL|INT|NB]-YYYY-NNN (e.g. CLM-2026-001)', NEW.project_code;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_project_code ON public.projects;
CREATE TRIGGER trg_validate_project_code
  BEFORE INSERT OR UPDATE OF project_code ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_code();

CREATE OR REPLACE FUNCTION public.validate_nonbillable_project()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pcode text;
BEGIN
  IF NEW.allocation_type = 'Non-Billable'::allocation_type AND NEW.project_id IS NOT NULL THEN
    SELECT project_code INTO pcode FROM public.projects WHERE id = NEW.project_id;
    IF pcode IS NOT NULL AND pcode !~ '^(INT|NB)-' THEN
      RAISE WARNING 'Non-Billable allocation against billable project code % (R-08): expected INT- or NB- prefix', pcode;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_nonbillable_project ON public.allocations;
CREATE TRIGGER trg_validate_nonbillable_project
  BEFORE INSERT OR UPDATE ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_nonbillable_project();

CREATE OR REPLACE FUNCTION public.handle_resource_exit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Exited'::resource_status AND (OLD.status IS DISTINCT FROM 'Exited'::resource_status) THEN
    UPDATE public.allocations
    SET allocation_end_date = CURRENT_DATE
    WHERE resource_id = NEW.id AND allocation_end_date > CURRENT_DATE;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_handle_resource_exit ON public.resources;
CREATE TRIGGER trg_handle_resource_exit
  AFTER UPDATE OF status ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.handle_resource_exit();

CREATE TABLE IF NOT EXISTS public.allocation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  resource_id uuid,
  resource_name text,
  omni_id text,
  role text,
  service_line text,
  project_id uuid,
  project_code text,
  customer_name text,
  allocation_type text,
  allocation_pct integer,
  allocation_start_date date,
  allocation_end_date date,
  manager text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON public.allocation_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_resource ON public.allocation_snapshots(resource_id);
GRANT SELECT ON public.allocation_snapshots TO authenticated;
GRANT ALL ON public.allocation_snapshots TO service_role;
ALTER TABLE public.allocation_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snap_select ON public.allocation_snapshots;
DROP POLICY IF EXISTS snap_admin ON public.allocation_snapshots;
CREATE POLICY snap_select ON public.allocation_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY snap_admin ON public.allocation_snapshots FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_finance())
  WITH CHECK (public.is_developer() OR public.is_finance());

CREATE OR REPLACE FUNCTION public.take_allocation_snapshot(_d date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.allocation_snapshots WHERE snapshot_date = _d;
  INSERT INTO public.allocation_snapshots (
    snapshot_date, resource_id, resource_name, omni_id, role, service_line,
    project_id, project_code, customer_name, allocation_type, allocation_pct,
    allocation_start_date, allocation_end_date, manager
  )
  SELECT _d, a.resource_id, a.resource_name, a.omni_id, a.role, a.service_line::text,
         a.project_id, p.project_code, c.customer_name, a.allocation_type::text, a.allocation_pct,
         a.allocation_start_date, a.allocation_end_date, a.manager
  FROM public.allocations a
  LEFT JOIN public.projects p ON p.id = a.project_id
  LEFT JOIN public.customers c ON c.id = a.customer_id
  WHERE a.allocation_start_date <= _d AND a.allocation_end_date >= _d;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE TABLE IF NOT EXISTS public.demand_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  service_line text NOT NULL,
  role text NOT NULL,
  headcount integer NOT NULL CHECK (headcount > 0),
  allocation_pct integer NOT NULL DEFAULT 100 CHECK (allocation_pct BETWEEN 1 AND 100),
  required_from date NOT NULL,
  required_to date NOT NULL,
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In_Progress','Fulfilled','Cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_demand_updated ON public.demand_requests;
CREATE TRIGGER trg_demand_updated BEFORE UPDATE ON public.demand_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_requests TO authenticated;
GRANT ALL ON public.demand_requests TO service_role;
ALTER TABLE public.demand_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demand_select ON public.demand_requests;
DROP POLICY IF EXISTS demand_write  ON public.demand_requests;
CREATE POLICY demand_select ON public.demand_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY demand_write  ON public.demand_requests FOR ALL TO authenticated
  USING (public.is_developer() OR public.is_finance() OR public.is_dl() OR created_by = auth.uid())
  WITH CHECK (public.is_developer() OR public.is_finance() OR public.is_dl() OR created_by = auth.uid());

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,
  actor uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_table_row ON public.audit_log(table_name, row_id);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON public.audit_log;
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_developer() OR public.is_finance());

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := (OLD).id; ELSE rid := (NEW).id; END IF;
  INSERT INTO public.audit_log(table_name, row_id, action, actor, old_data, new_data)
  VALUES (
    TG_TABLE_NAME, rid, TG_OP, auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_audit_projects ON public.projects;
CREATE TRIGGER trg_audit_projects AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_allocations ON public.allocations;
CREATE TRIGGER trg_audit_allocations AFTER INSERT OR UPDATE OR DELETE ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE OR REPLACE VIEW public.v_utilisation_weekly AS
WITH weeks AS (
  SELECT generate_series(
    date_trunc('week', CURRENT_DATE)::date - INTERVAL '12 weeks',
    date_trunc('week', CURRENT_DATE)::date,
    INTERVAL '1 week'
  )::date AS week_start
),
res AS (
  SELECT id, service_line::text AS service_line FROM public.resources WHERE status = 'Active'::resource_status
)
SELECT
  w.week_start,
  r.service_line,
  COUNT(DISTINCT r.id)::int AS headcount,
  COALESCE(ROUND(AVG(
    COALESCE((
      SELECT SUM(a.allocation_pct)
      FROM public.allocations a
      WHERE a.resource_id = r.id
        AND a.allocation_type IN ('Billable'::allocation_type,'Non-Billable'::allocation_type)
        AND a.allocation_start_date <= (w.week_start + INTERVAL '6 days')::date
        AND a.allocation_end_date   >= w.week_start
    ), 0)
  ))::int, 0) AS avg_utilisation_pct
FROM weeks w
CROSS JOIN res r
GROUP BY w.week_start, r.service_line
ORDER BY w.week_start, r.service_line;

GRANT SELECT ON public.v_utilisation_weekly TO authenticated;
