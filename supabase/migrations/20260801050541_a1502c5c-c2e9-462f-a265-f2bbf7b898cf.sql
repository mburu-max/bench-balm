ALTER VIEW public.v_resource_bench_streak SET (security_invoker = true);

CREATE POLICY "hubspot_deal_imports_no_client_insert"
  ON public.hubspot_deal_imports
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "hubspot_deal_imports_no_client_delete"
  ON public.hubspot_deal_imports
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (false);