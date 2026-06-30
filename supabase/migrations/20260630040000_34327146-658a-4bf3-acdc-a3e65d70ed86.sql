-- Cliff Edge view: active resources whose last billable/NB allocation ends within 90 days
-- with no follow-on allocation. Enables proactive bench-risk management.

CREATE OR REPLACE VIEW public.v_cliff_edge AS
WITH resource_coverage AS (
  SELECT
    r.id              AS resource_id,
    r.full_name,
    r.omni_id,
    r.service_line,
    r.position,
    r.manager_name,
    r.employment_type,
    COALESCE(
      MAX(a.allocation_end_date) FILTER (
        WHERE a.allocation_type IN ('Billable','Non-Billable')
          AND a.allocation_end_date >= CURRENT_DATE
      ),
      CURRENT_DATE - 1
    ) AS last_covered_date
  FROM public.resources r
  LEFT JOIN public.allocations a ON a.resource_id = r.id
  WHERE r.status = 'Active'
  GROUP BY r.id, r.full_name, r.omni_id, r.service_line, r.position, r.manager_name, r.employment_type
),
cliff_candidates AS (
  SELECT *,
    (last_covered_date - CURRENT_DATE) AS days_until_cliff
  FROM resource_coverage
  WHERE last_covered_date <= CURRENT_DATE + 90
)
SELECT
  cc.resource_id,
  cc.full_name,
  cc.omni_id,
  cc.service_line::text AS service_line,
  cc.position,
  cc.manager_name,
  cc.employment_type::text AS employment_type,
  cc.last_covered_date,
  cc.days_until_cliff,
  CASE
    WHEN cc.days_until_cliff <= 0  THEN 0
    WHEN cc.days_until_cliff <= 30 THEN 30
    WHEN cc.days_until_cliff <= 60 THEN 60
    ELSE 90
  END AS cliff_band,
  (
    SELECT p.project_code
    FROM public.allocations a2
    JOIN public.projects p ON p.id = a2.project_id
    WHERE a2.resource_id = cc.resource_id
      AND a2.allocation_end_date = cc.last_covered_date
      AND a2.allocation_type IN ('Billable','Non-Billable')
    ORDER BY a2.allocation_pct DESC
    LIMIT 1
  ) AS ending_project_code,
  (
    SELECT c.customer_name
    FROM public.allocations a2
    JOIN public.customers c ON c.id = a2.customer_id
    WHERE a2.resource_id = cc.resource_id
      AND a2.allocation_end_date = cc.last_covered_date
      AND a2.allocation_type IN ('Billable','Non-Billable')
    ORDER BY a2.allocation_pct DESC
    LIMIT 1
  ) AS ending_customer_name
FROM cliff_candidates cc
ORDER BY cc.days_until_cliff ASC;

GRANT SELECT ON public.v_cliff_edge TO authenticated;
