ALTER TABLE idempotency_records ADD COLUMN resource_project_id uuid REFERENCES projects(id);
UPDATE idempotency_records SET resource_project_id=COALESCE(response->>'project_id',CASE WHEN response ? 'owner_id' THEN response->>'id' END)::uuid;
ALTER TABLE operation_jobs ADD COLUMN request_id text NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE operation_jobs ADD COLUMN context_hash text CHECK(context_hash IS NULL OR length(context_hash)=64);
-- Legacy work has no verifiable original context. Preserve its history and
-- require a fresh request rather than guessing provenance during an upgrade.
UPDATE operation_jobs SET status='failed',error='Legacy operation requires a new planning request',lease_until=NULL,updated_at=now() WHERE kind='planning' AND status IN ('queued','running');
CREATE FUNCTION immutable_operation_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.project_id,NEW.created_by,NEW.kind,NEW.input,NEW.conversation_session_id,NEW.request_id,NEW.context_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.created_by,OLD.kind,OLD.input,OLD.conversation_session_id,OLD.request_id,OLD.context_hash,OLD.created_at) THEN RAISE EXCEPTION 'immutable operation context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_operation_context_trigger BEFORE UPDATE ON operation_jobs FOR EACH ROW EXECUTE FUNCTION immutable_operation_context();
ALTER TABLE plan_versions ADD COLUMN origin_operation_id uuid REFERENCES operation_jobs(id);
CREATE FUNCTION immutable_plan_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.origin_operation_id IS DISTINCT FROM OLD.origin_operation_id THEN RAISE EXCEPTION 'immutable plan operation provenance'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_plan_origin_trigger BEFORE UPDATE OF origin_operation_id ON plan_versions FOR EACH ROW EXECUTE FUNCTION immutable_plan_origin();
