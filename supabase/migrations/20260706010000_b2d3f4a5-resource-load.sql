-- Cross-SL-accurate resource load. RLS hides other service lines' allocation rows from an
-- SL Lead, so bench/utilisation computed from their scoped allocations understates a resource
-- who is loaned out to another division. This SECURITY DEFINER function returns each visible
-- resource's TOTAL current load across the WHOLE ledger (all SLs) plus how much sits in other
-- service lines — without exposing the other division's project details.
CREATE OR REPLACE FUNCTION public.resource_current_load()
RETURNS TABLE(resource_id uuid, home_sl text, total_pct int, other_sl_pct int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH visible AS (
    -- mirrors resources_select: which resources the caller may see
    SELECT r.id, r.service_line::text AS home_sl
    FROM public.resources r
    WHERE r.status = 'Active'
      AND (
        public.has_sl_access(r.service_line)
        OR r.user_id = auth.uid()
        OR (public.is_pm() AND r.id IN (SELECT public.pm_project_resource_ids()))
      )
  )
  SELECT
    v.id AS resource_id,
    v.home_sl,
    COALESCE(SUM(a.allocation_pct) FILTER (WHERE a.allocation_type <> 'Leave'), 0)::int AS total_pct,
    COALESCE(SUM(a.allocation_pct) FILTER (WHERE a.allocation_type <> 'Leave' AND a.service_line::text <> v.home_sl), 0)::int AS other_sl_pct
  FROM visible v
  LEFT JOIN public.allocations a
    ON a.resource_id = v.id
   AND a.allocation_start_date <= CURRENT_DATE
   AND a.allocation_end_date >= CURRENT_DATE
  GROUP BY v.id, v.home_sl;
$$;

GRANT EXECUTE ON FUNCTION public.resource_current_load() TO authenticated;
