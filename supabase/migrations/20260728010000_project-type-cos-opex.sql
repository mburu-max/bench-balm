-- Align project_type with COS/OPEX too: Billable_Delivery -> COS, Non_Billable -> OPEX.
-- Bench_Available / Training / Internal_Operations unchanged. Idempotent / safe to re-run.
-- project_type is on projects.project_type (currently dormant); RENAME VALUE preserves any rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'project_type' AND e.enumlabel = 'Billable_Delivery') THEN
    ALTER TYPE public.project_type RENAME VALUE 'Billable_Delivery' TO 'COS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'project_type' AND e.enumlabel = 'Non_Billable') THEN
    ALTER TYPE public.project_type RENAME VALUE 'Non_Billable' TO 'OPEX';
  END IF;
END $$;
