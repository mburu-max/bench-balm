-- Business terminology: allocation_type is COS / OPEX (not Billable / Non-Billable). Rename the two
-- enum values in place (Bench and Leave unchanged). Idempotent / safe to re-run.
-- The enum-cast views (v_utilisation_weekly, v_kpi_utilisation_now, v_cliff_edge) reference the enum
-- members by identity, so RENAME VALUE updates them automatically — no recreation needed. The items
-- below DO need updating: the PL/pgSQL function (runtime-parsed literal), the snapshot-TEXT view and
-- data, and the column default.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'allocation_type' AND e.enumlabel = 'Billable') THEN
    ALTER TYPE public.allocation_type RENAME VALUE 'Billable' TO 'COS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'allocation_type' AND e.enumlabel = 'Non-Billable') THEN
    ALTER TYPE public.allocation_type RENAME VALUE 'Non-Billable' TO 'OPEX';
  END IF;
END $$;

-- allocation_snapshots stores allocation_type as TEXT — bring historical rows in line.
UPDATE public.allocation_snapshots SET allocation_type = 'COS'  WHERE allocation_type = 'Billable';
UPDATE public.allocation_snapshots SET allocation_type = 'OPEX' WHERE allocation_type = 'Non-Billable';

-- New-allocation default.
ALTER TABLE public.allocations ALTER COLUMN allocation_type SET DEFAULT 'COS'::public.allocation_type;

-- Dependent PL/pgSQL function (literal is parsed at runtime, so it must be updated).
CREATE OR REPLACE FUNCTION public.validate_nonbillable_project()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE pcode text;
BEGIN
  IF NEW.allocation_type = 'OPEX'::allocation_type AND NEW.project_id IS NOT NULL THEN
    SELECT project_code INTO pcode FROM public.projects WHERE id = NEW.project_id;
    IF pcode IS NOT NULL AND pcode !~ '^(INT|NB)-' THEN
      RAISE WARNING 'OPEX allocation against a COS project code % (R-08): expected INT- or NB- prefix', pcode;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- View over the snapshot TEXT column (literal text comparison, so it must be updated).
CREATE OR REPLACE VIEW public.v_resource_bench_streak AS
 WITH daily_bench AS (
         SELECT s_1.snapshot_date, s_1.resource_id,
            (COALESCE(sum(s_1.allocation_pct) FILTER (WHERE (s_1.allocation_type = ANY (ARRAY['COS'::text, 'OPEX'::text]))), (0)::bigint) = 0) AS is_fully_benched
           FROM allocation_snapshots s_1
          GROUP BY s_1.snapshot_date, s_1.resource_id
        ), ranked AS (
         SELECT daily_bench.snapshot_date, daily_bench.resource_id, daily_bench.is_fully_benched,
            (daily_bench.snapshot_date - (((row_number() OVER (PARTITION BY daily_bench.resource_id, daily_bench.is_fully_benched ORDER BY daily_bench.snapshot_date))::integer)::double precision * '1 day'::interval)) AS grp
           FROM daily_bench
          WHERE daily_bench.is_fully_benched
        ), streaks AS (
         SELECT ranked.resource_id, min(ranked.snapshot_date) AS bench_since,
            max(ranked.snapshot_date) AS last_seen_benched, (count(*))::integer AS consecutive_bench_days
           FROM ranked
          GROUP BY ranked.resource_id, ranked.grp
        )
 SELECT resource_id, bench_since, last_seen_benched, consecutive_bench_days
   FROM streaks s
  WHERE (last_seen_benched = ( SELECT max(allocation_snapshots.snapshot_date) AS max FROM allocation_snapshots));
