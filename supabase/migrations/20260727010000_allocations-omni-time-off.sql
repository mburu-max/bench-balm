-- Track the Omni time-off request that produced a Leave allocation, so the webhook can dedupe
-- (at-least-once delivery) and remove the row when the time-off is cancelled or rejected.
ALTER TABLE public.allocations ADD COLUMN IF NOT EXISTS omni_time_off_id text;
CREATE UNIQUE INDEX IF NOT EXISTS allocations_omni_time_off_id_key
  ON public.allocations (omni_time_off_id) WHERE omni_time_off_id IS NOT NULL;
