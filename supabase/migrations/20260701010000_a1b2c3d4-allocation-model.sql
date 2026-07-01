-- Add allocation_model to the allocation ledger (RA doc §4.2 / Dashboard Dev Tracker
-- allocation_ledger — the engagement pattern of a resource on a project).
-- Nullable so the 36 existing allocation rows are untouched; the UI requires it for
-- new non-Leave allocations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allocation_model') THEN
    CREATE TYPE public.allocation_model AS ENUM (
      'Full_Dedication','Partial_Split','Time_Boxed','Surge_Flex','Shadow_Training'
    );
  END IF;
END $$;

ALTER TABLE public.allocations
  ADD COLUMN IF NOT EXISTS allocation_model public.allocation_model;
