-- Phase 4 of RA_Standard_Requirements compliance: KPI views + bench streak + pg_cron.

-- ============ BENCH STREAK VIEW (consecutive fully-benched days per resource) ============
CREATE OR REPLACE VIEW public.v_resource_bench_streak AS
WITH daily_bench AS (
  SELECT s.snapshot_date, s.resource_id,
         (COALESCE(SUM(s.allocation_pct) FILTER (WHERE s.allocation_type IN ('Billable','Non-Billable')), 0) = 0) AS is_fully_benched
  FROM public.allocation_snapshots s
  GROUP BY s.snapshot_date, s.resource_id
),
ranked AS (
  SELECT *,
    snapshot_date - (ROW_NUMBER() OVER (PARTITION BY resource_id, is_fully_benched ORDER BY snapshot_date))::int * INTERVAL '1 day' AS grp
  FROM daily_bench
  WHERE is_fully_benched
),
streaks AS (
  SELECT resource_id, MIN(snapshot_date) AS bench_since, MAX(snapshot_date) AS last_seen_benched,
         COUNT(*)::int AS consecutive_bench_days
  FROM ranked
  GROUP BY resource_id, grp
)
SELECT s.*
FROM streaks s
WHERE s.last_seen_benched = (SELECT MAX(snapshot_date) FROM public.allocation_snapshots);

GRANT SELECT ON public.v_resource_bench_streak TO authenticated;

-- ============ KPI VIEWS (doc 6.1 — the 5 KPIs not already covered client-side) ============
CREATE OR REPLACE VIEW public.v_kpi_project_code_coverage AS
SELECT
  COUNT(*) FILTER (WHERE project_id IS NOT NULL)::numeric / GREATEST(COUNT(*),1) * 100 AS pct_with_project_code
FROM public.allocations;
GRANT SELECT ON public.v_kpi_project_code_coverage TO authenticated;

CREATE OR REPLACE VIEW public.v_kpi_allocation_freshness AS
SELECT
  COUNT(*) FILTER (WHERE updated_at >= now() - INTERVAL '14 days')::numeric / GREATEST(COUNT(*),1) * 100 AS pct_fresh
FROM public.allocations;
GRANT SELECT ON public.v_kpi_allocation_freshness TO authenticated;

CREATE OR REPLACE VIEW public.v_kpi_avg_bench_days AS
SELECT COALESCE(AVG(consecutive_bench_days), 0)::numeric AS avg_bench_days
FROM public.v_resource_bench_streak;
GRANT SELECT ON public.v_kpi_avg_bench_days TO authenticated;

CREATE OR REPLACE VIEW public.v_kpi_demand_lead_time AS
SELECT
  COALESCE(AVG(EXTRACT(epoch FROM (fulfilled_at - created_at)) / 86400.0), 0)::numeric AS avg_lead_time_days
FROM public.demand_requests
WHERE fulfilled_at IS NOT NULL;
GRANT SELECT ON public.v_kpi_demand_lead_time TO authenticated;

CREATE OR REPLACE VIEW public.v_kpi_forecast_accuracy AS
SELECT
  hf.month,
  hf.service_line,
  hf.planned_headcount,
  COUNT(r.id)::int AS actual_headcount,
  CASE WHEN hf.planned_headcount = 0 THEN NULL
       ELSE ROUND(100 - (ABS(COUNT(r.id) - hf.planned_headcount)::numeric / hf.planned_headcount * 100), 1)
  END AS accuracy_pct
FROM public.headcount_forecast hf
LEFT JOIN public.resources r
  ON r.service_line = hf.service_line
  AND r.status = 'Active'
GROUP BY hf.month, hf.service_line, hf.planned_headcount;
GRANT SELECT ON public.v_kpi_forecast_accuracy TO authenticated;

-- ============ UTILISATION SUMMARY (per SL) — already exists as v_utilisation_weekly ============
-- Add a current-snapshot view for the KPI dashboard point-in-time values:
CREATE OR REPLACE VIEW public.v_kpi_utilisation_now AS
SELECT
  r.service_line,
  COUNT(r.id)::int AS total_active,
  COALESCE(ROUND(AVG(
    COALESCE((
      SELECT SUM(a.allocation_pct)
      FROM public.allocations a
      WHERE a.resource_id = r.id
        AND a.allocation_type IN ('Billable','Non-Billable')
        AND a.allocation_start_date <= CURRENT_DATE
        AND a.allocation_end_date >= CURRENT_DATE
    ), 0)
  ))::int, 0) AS avg_utilisation_pct,
  COUNT(r.id) FILTER (WHERE (
    SELECT COALESCE(SUM(a.allocation_pct), 0)
    FROM public.allocations a
    WHERE a.resource_id = r.id
      AND a.allocation_type IN ('Billable','Non-Billable')
      AND a.allocation_start_date <= CURRENT_DATE
      AND a.allocation_end_date >= CURRENT_DATE
  ) > 100)::int AS over_allocated_count,
  COUNT(r.id) FILTER (WHERE (
    SELECT COALESCE(SUM(a.allocation_pct), 0)
    FROM public.allocations a
    WHERE a.resource_id = r.id
      AND a.allocation_type IN ('Billable','Non-Billable')
      AND a.allocation_start_date <= CURRENT_DATE
      AND a.allocation_end_date >= CURRENT_DATE
  ) = 0)::int AS bench_count
FROM public.resources r
WHERE r.status = 'Active'
GROUP BY r.service_line;
GRANT SELECT ON public.v_kpi_utilisation_now TO authenticated;

-- ============ DAILY SNAPSHOT AUTOMATION via pg_cron (may fail if not enabled on this tier) ============
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'daily-allocation-snapshot',
    '0 1 * * *',
    $$SELECT public.take_allocation_snapshot(CURRENT_DATE);$$
  );
  RAISE NOTICE 'pg_cron scheduled daily snapshot at 01:00 UTC';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron extension not available on this tier — daily snapshots must be triggered manually via the Snapshots page. Error: %', SQLERRM;
END;
$$;
