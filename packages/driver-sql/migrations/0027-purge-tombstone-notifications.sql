-- Install separately so migration never holds trigger table locks on jobs and orgs together.
CREATE TRIGGER orgs_notify_tombstone AFTER UPDATE OF deleted_at ON orgs
FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION notify_job_due();
