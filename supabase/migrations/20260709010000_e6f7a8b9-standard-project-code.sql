-- Standardized project-code generation: [SL identifier]-[Customer abbreviation]-[NNN]
--   Example: DLA-AIM-001  (a DLaaS project for the customer "AI Motive").
--     - SL identifier   = first 3 letters of the uppercased service line
--                         (DLaaS->DLA, CCaaS->CCA, Legacy->LEG, CLM->CLM, MS->MS).
--     - Customer abbrev = first 3 alphabetic characters of customer_name, uppercased,
--                         auto-derived ("AI Motive" -> "AIM").
--     - Sequence (NNN)  = per (SL identifier + customer abbreviation) prefix, zero-padded to 3.
-- This replaces the old purely-sequential [SL]-YYYY-NNN generator. Existing project codes are
-- the UNIQUE business key of a project and are NOT rewritten; this governs new codes only.

-- Drop the single-arg generator; the code now needs the customer too, so callers move to the
-- two-arg signature below.
DROP FUNCTION IF EXISTS public.next_project_code(public.service_line);

CREATE OR REPLACE FUNCTION public.next_project_code(_sl public.service_line, _customer_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sl_id     text := left(upper(_sl::text), 3);
  cust_name text;
  cust_abbr text;
  prefix    text;
  maxn      int;
BEGIN
  SELECT customer_name INTO cust_name FROM public.customers WHERE id = _customer_id;
  IF cust_name IS NULL THEN
    RAISE EXCEPTION 'Unknown customer %', _customer_id;
  END IF;

  -- First 3 letters of the name with non-alphabetics stripped, uppercased. "AI Motive" -> "AIM".
  cust_abbr := upper(left(regexp_replace(cust_name, '[^A-Za-z]', '', 'g'), 3));
  IF cust_abbr = '' THEN
    RAISE EXCEPTION 'Customer "%" has no alphabetic characters to abbreviate', cust_name;
  END IF;

  prefix := sl_id || '-' || cust_abbr;  -- both segments are [A-Z] only, safe to interpolate into the regex below

  -- Highest existing sequence for this prefix. Legacy [SL]-YYYY-NNN codes have a numeric middle
  -- segment, so they never match this alpha prefix and are correctly ignored.
  SELECT COALESCE(MAX(substring(project_code from '(\d{3})$')::int), 0) INTO maxn
  FROM public.projects
  WHERE project_code ~ ('^' || prefix || '-\d{3}$');

  RETURN prefix || '-' || lpad((maxn + 1)::text, 3, '0');
END $$;

REVOKE ALL ON FUNCTION public.next_project_code(public.service_line, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_project_code(public.service_line, uuid) TO authenticated;
