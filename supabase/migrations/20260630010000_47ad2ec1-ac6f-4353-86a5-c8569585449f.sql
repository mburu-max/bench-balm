-- Phase 3 of RA_Standard_Requirements compliance: New entities and fields.

-- ============ CUSTOMERS: Account Tier, Contract Type, Account Manager (doc 3.1) ============
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS account_tier text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS contract_type text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS account_manager text;

-- ============ PROJECTS: Project Type field (doc 3.3) ============
CREATE TYPE public.project_type AS ENUM (
  'Billable_Delivery','Non_Billable','Bench_Available','Training','Internal_Operations'
);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_type public.project_type;

-- ============ DEMAND REQUESTS: Classification + Fulfilled At (doc 5.1.1) ============
CREATE TYPE public.demand_classification AS ENUM (
  'Confirmed','Probable','Pipeline','Internal'
);
ALTER TABLE public.demand_requests ADD COLUMN IF NOT EXISTS demand_classification public.demand_classification;
ALTER TABLE public.demand_requests ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_demand_fulfilled_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Fulfilled' AND OLD.status IS DISTINCT FROM 'Fulfilled' THEN
    NEW.fulfilled_at := now();
  ELSIF NEW.status <> 'Fulfilled' AND OLD.status = 'Fulfilled' THEN
    NEW.fulfilled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_demand_fulfilled_at ON public.demand_requests;
CREATE TRIGGER trg_set_demand_fulfilled_at
  BEFORE UPDATE ON public.demand_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_demand_fulfilled_at();
