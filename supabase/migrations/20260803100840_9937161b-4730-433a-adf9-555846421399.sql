DROP TRIGGER IF EXISTS trg_prevent_exited_resource_delete ON public.resources;

DELETE FROM public.allocations;
DELETE FROM public.resources;

CREATE TRIGGER trg_prevent_exited_resource_delete
BEFORE DELETE ON public.resources
FOR EACH ROW EXECUTE FUNCTION public.prevent_exited_resource_delete();