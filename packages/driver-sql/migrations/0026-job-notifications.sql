-- Install the wake-up at the write so older replicas also notify during a rolling deploy.
CREATE FUNCTION notify_job_due() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    PERFORM pg_notify('ob_jobs', json_build_array(NEW.kind, NEW.available_at)::text);
  ELSE
    PERFORM pg_notify('ob_jobs', json_build_array('purge-org', NEW.deleted_at, 'tombstone')::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER jobs_notify_insert AFTER INSERT ON jobs
FOR EACH ROW WHEN (NEW.instance_id IS NULL) EXECUTE FUNCTION notify_job_due();

CREATE TRIGGER jobs_notify_release AFTER UPDATE OF available_at ON jobs
FOR EACH ROW WHEN (NEW.instance_id IS NULL AND OLD.instance_id IS NOT NULL)
EXECUTE FUNCTION notify_job_due();
