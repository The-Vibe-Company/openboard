-- A compatible purge may take the existing job on an older replica.
CREATE FUNCTION clear_purged_org_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM usage_daily WHERE org_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_purged_org_usage AFTER UPDATE OF purged_at ON orgs
FOR EACH ROW WHEN (OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL)
EXECUTE FUNCTION clear_purged_org_usage();
