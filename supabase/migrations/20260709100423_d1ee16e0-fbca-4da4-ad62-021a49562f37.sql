CREATE OR REPLACE FUNCTION public.validate_project_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_code !~ '^[A-Z]{2,3}-[A-Z]{1,3}-[0-9]{3,}$'
     AND NEW.project_code !~ '^(CLM|MS|DLAAS|CCAAS|LEGACY|INT|NB)-[0-9]{4}-[0-9]{3}$' THEN
    RAISE EXCEPTION 'Project code "%" must match [SL]-[CUST]-NNN (e.g. DLA-AIM-001)', NEW.project_code;
  END IF;
  RETURN NEW;
END $$;