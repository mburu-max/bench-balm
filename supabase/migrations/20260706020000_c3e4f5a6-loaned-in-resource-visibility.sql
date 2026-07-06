-- Loaned-in resource visibility for SL leads.
--
-- resources_select scopes a resource row by the resource's HOME service_line
-- (is_sl_lead via has_sl_access). But allocations_select scopes by the ALLOCATION's
-- (work) service_line — so when a resource is loaned in to a project under an SL lead's
-- line, the lead sees the allocation but NOT the person (the joined name comes back
-- blank). This adds a clause so a resource is visible to anyone who can access an SL
-- that resource is currently/ever allocated into.
--
-- Additive only: broadens SL leads (and the already-global governance/finance/dev roles,
-- which see everyone anyway). PMs and resource-role users are unaffected because
-- has_sl_access() is false for them, so the helper returns nothing for them.

CREATE OR REPLACE FUNCTION public.sl_accessible_resource_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Resources with an allocation whose WORK service line the caller can access.
  -- Definer bypasses allocations RLS so the loaned-in row is counted even though its
  -- own row is home-SL-scoped elsewhere.
  SELECT DISTINCT a.resource_id
  FROM public.allocations a
  WHERE a.resource_id IS NOT NULL
    AND a.service_line IS NOT NULL
    AND public.has_sl_access(a.service_line);
$$;

DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources
FOR SELECT TO authenticated
USING (
  has_sl_access(service_line)
  OR (user_id = auth.uid())
  OR (is_pm() AND id IN (SELECT pm_project_resource_ids()))
  OR (id IN (SELECT sl_accessible_resource_ids()))
);
