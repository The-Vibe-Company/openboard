-- A legacy writer would complete the prerequisite without advancing its dependants.
-- Use lock_not_available so the previous replica rolls back and answers a retryable 503.
CREATE FUNCTION guard_task_dependency_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload::jsonb ? 'hasDependants' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM task_needs
    WHERE org_id = NEW.org_id AND board_id = NEW.board_id AND needs = NEW.message
  ) THEN
    RAISE EXCEPTION 'task prerequisites require a dependency-aware writer' USING ERRCODE = '55P03';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_task_dependency_completion BEFORE INSERT ON events
  FOR EACH ROW WHEN (NEW.type = 'task.completed')
  EXECUTE FUNCTION guard_task_dependency_completion();
