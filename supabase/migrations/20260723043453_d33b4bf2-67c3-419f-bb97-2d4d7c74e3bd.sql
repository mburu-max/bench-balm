-- Separate hold remarks from rejection reasons. Rejection reasons stay in projects.approval_notes;
-- On-Hold remarks get their own column so the two never overwrite each other and can both live in
-- the project's history.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS hold_notes text;