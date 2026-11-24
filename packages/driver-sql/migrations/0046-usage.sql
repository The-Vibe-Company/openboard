CREATE TRIGGER queue_usage_delivery AFTER INSERT ON webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION queue_usage_day('created_at');

CREATE FUNCTION adjust_late_usage_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE usage_daily SET deliveries = deliveries + 1
  WHERE org_id = NEW.org_id AND day = NEW.created_at - (NEW.created_at % 86400000 + 86400000) % 86400000;
  RETURN NEW;
END;
$$;

CREATE TRIGGER adjust_late_usage_delivery AFTER INSERT ON webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION adjust_late_usage_delivery();

-- Protect pending rollups even if an older replica still runs the retention sweep.
CREATE FUNCTION keep_unrolled_usage_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM usage_pending_days p JOIN orgs o ON o.id = p.org_id
    WHERE p.org_id = OLD.org_id AND o.purged_at IS NULL
      AND p.job_key = CAST(OLD.created_at - (OLD.created_at % 86400000 + 86400000) % 86400000 AS TEXT)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER keep_unrolled_usage_delivery BEFORE DELETE ON webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION keep_unrolled_usage_delivery();
