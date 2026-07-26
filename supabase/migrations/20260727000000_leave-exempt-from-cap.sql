-- Make Leave orthogonal to the 100% billable cap, consistent with the other allocation validators
-- (which all exempt Leave). A Leave row is never capped, and existing Leave rows never count against
-- other allocations. This lets time-off be recorded for a fully-allocated resource, and lets someone
-- on leave still be booked to a project.
CREATE OR REPLACE FUNCTION public.validate_allocation_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE max_total INT;
BEGIN
  IF NEW.allocation_type = 'Leave' THEN RETURN NEW; END IF;
  SELECT COALESCE(MAX(total),0) INTO max_total FROM (
    SELECT d::date AS day, SUM(allocation_pct) AS total
    FROM public.allocations a,
         generate_series(GREATEST(a.allocation_start_date, NEW.allocation_start_date),
                         LEAST(a.allocation_end_date, NEW.allocation_end_date),
                         interval '1 day') d
    WHERE a.resource_id = NEW.resource_id
      AND a.allocation_type <> 'Leave'
      AND a.id <> COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND a.allocation_end_date >= NEW.allocation_start_date
      AND a.allocation_start_date <= NEW.allocation_end_date
    GROUP BY d
  ) s;

  IF (max_total + NEW.allocation_pct) > 100 THEN
    IF NEW.cap_override IS TRUE THEN
      IF NEW.cap_override_reason IS NULL OR length(trim(NEW.cap_override_reason)) = 0 THEN
        RAISE EXCEPTION 'cap_override requires a non-empty cap_override_reason (R-01)';
      END IF;
      IF NOT (public.is_developer() OR public.is_governance_lead()) THEN
        RAISE EXCEPTION 'Only Governance Lead can override the 100%% allocation cap (R-01)';
      END IF;
      NEW.cap_override_by := auth.uid();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Over-allocation: existing % %% + new % %% exceeds 100%% on overlapping dates', max_total, NEW.allocation_pct;
  END IF;
  RETURN NEW;
END;
$function$;
