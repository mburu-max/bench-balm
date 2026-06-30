-- Phase 5 of RA_Standard_Requirements compliance: Integration placeholder stubs (doc §8).
-- Adds sync_status indicator columns so the UI can show integration health at a glance.
-- No live API calls are made — see src/lib/integrations/{hubspot,omni-hr}.ts for extension points.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS hubspot_sync_status text NOT NULL DEFAULT 'not_configured';
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS omni_hr_sync_status text NOT NULL DEFAULT 'not_configured';
