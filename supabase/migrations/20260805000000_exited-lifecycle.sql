-- Exited-resource lifecycle (Phase 1 of the Exited/Reporting work).
--   1. exit_date column on resources (last working day).
--   2. Stamp exit_date automatically when a resource is marked Exited (default today); clear it when not.
--   3. Auto-truncate the ledger on exit: clip allocations ending after exit_date down to it, and delete
--      allocations that start entirely after it. Fires for manual edits AND the Omni sync path.
--   4. Guardrail: block INSERTing an allocation for an already-Exited resource.
-- Triggers (not app logic) so every write path — UI, Omni webhook, backfill — is covered uniformly.

ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS exit_date date;

-- (2) BEFORE row: keep exit_date consistent with status.
CREATE OR REPLACE FUNCTION public.stamp_resource_exit_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Exited' THEN
    IF NEW.exit_date IS NULL THEN NEW.exit_date := CURRENT_DATE; END IF;
  ELSE
    NEW.exit_date := NULL;  -- reinstated / active / on-leave => no exit date
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_resource_exit_date ON public.resources;
CREATE TRIGGER trg_stamp_resource_exit_date
  BEFORE INSERT OR UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.stamp_resource_exit_date();

-- (3) AFTER row: truncate the ledger once exit_date is settled.
CREATE OR REPLACE FUNCTION public.truncate_allocations_on_exit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Exited' AND NEW.exit_date IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'Exited'
       OR OLD.exit_date IS DISTINCT FROM NEW.exit_date
     ) THEN
    DELETE FROM public.allocations
      WHERE resource_id = NEW.id AND allocation_start_date > NEW.exit_date;
    UPDATE public.allocations
      SET allocation_end_date = NEW.exit_date
      WHERE resource_id = NEW.id AND allocation_end_date > NEW.exit_date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_truncate_allocations_on_exit ON public.resources;
CREATE TRIGGER trg_truncate_allocations_on_exit
  AFTER INSERT OR UPDATE ON public.resources
  FOR EACH ROW EXECUTE FUNCTION public.truncate_allocations_on_exit();

-- (4) Guardrail: no new allocations for an exited resource.
CREATE OR REPLACE FUNCTION public.block_exited_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.resources WHERE id = NEW.resource_id AND status = 'Exited') THEN
    RAISE EXCEPTION 'This resource has exited and can''t be allocated.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_exited_allocation ON public.allocations;
CREATE TRIGGER trg_block_exited_allocation
  BEFORE INSERT ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.block_exited_allocation();
