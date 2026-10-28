CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, display_name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('human','service')), password_hash text, token_hash text UNIQUE,
 token_expires_at timestamptz, scopes text[] NOT NULL DEFAULT '{}', disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='human' AND password_hash IS NOT NULL AND token_hash IS NULL) OR (kind='service' AND password_hash IS NULL AND token_hash IS NOT NULL))
);
CREATE TABLE sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),csrf_hash text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),name text NOT NULL,description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','on_hold','completed','archived')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 published_plan_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_members (project_id uuid NOT NULL REFERENCES projects(id),user_id uuid NOT NULL REFERENCES users(id),role text NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(project_id,user_id));
CREATE TABLE phases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),key text NOT NULL,name text NOT NULL,description text NOT NULL DEFAULT '',position integer NOT NULL,UNIQUE(project_id,key),UNIQUE(project_id,id));
CREATE TABLE plan_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),number integer NOT NULL,base_project_version integer NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','published','superseded','rejected')),
 snapshot jsonb NOT NULL,content_hash text NOT NULL CHECK(length(content_hash)=64),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,UNIQUE(project_id,number),UNIQUE(project_id,id)
);
ALTER TABLE projects ADD CONSTRAINT published_plan_project_fk FOREIGN KEY(id,published_plan_id) REFERENCES plan_versions(project_id,id);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),phase_id uuid NOT NULL,
 title text NOT NULL,description text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','blocked','done','cancelled')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),assignee_id uuid,start_date date,due_date date,
 estimated_effort numeric CHECK(estimated_effort>=0),definition_of_done text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1 CHECK(version>0),
 source_plan_id uuid NOT NULL,source_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(source_plan_id,source_key),FOREIGN KEY(project_id,phase_id) REFERENCES phases(project_id,id),
 FOREIGN KEY(project_id,assignee_id) REFERENCES project_members(project_id,user_id),FOREIGN KEY(project_id,source_plan_id) REFERENCES plan_versions(project_id,id),CHECK(start_date IS NULL OR due_date IS NULL OR start_date<=due_date)
);
CREATE TABLE task_dependencies (project_id uuid NOT NULL,task_id uuid NOT NULL,depends_on_id uuid NOT NULL,PRIMARY KEY(task_id,depends_on_id),FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id),FOREIGN KEY(project_id,depends_on_id) REFERENCES tasks(project_id,id),CHECK(task_id<>depends_on_id));
CREATE TABLE plan_task_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL,plan_version_id uuid NOT NULL,key text NOT NULL,data jsonb NOT NULL,UNIQUE(plan_version_id,key),FOREIGN KEY(project_id,plan_version_id) REFERENCES plan_versions(project_id,id));
CREATE TABLE change_proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL,plan_version_id uuid NOT NULL UNIQUE,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(project_id,plan_version_id) REFERENCES plan_versions(project_id,id));
CREATE TABLE approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL,plan_version_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),content_hash text NOT NULL,decision text NOT NULL CHECK(decision IN ('approved','rejected')),comment text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_version_id),FOREIGN KEY(project_id,plan_version_id) REFERENCES plan_versions(project_id,id));
CREATE TABLE conversation_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,external_id text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,provider,external_id),UNIQUE(project_id,id));
CREATE TABLE operation_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),created_by uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('planning','publish')),status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),input jsonb NOT NULL,result jsonb,error text,attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 3,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,conversation_session_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(project_id,conversation_session_id) REFERENCES conversation_sessions(project_id,id));
CREATE TABLE activity_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),actor_id uuid NOT NULL REFERENCES users(id),request_id text NOT NULL,type text NOT NULL,entity_id uuid NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency_records (actor_id uuid NOT NULL REFERENCES users(id),key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,status_code integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,key));
CREATE INDEX tasks_project_status_idx ON tasks(project_id,status);
CREATE INDEX events_project_time_idx ON activity_events(project_id,created_at DESC,id);
CREATE INDEX operations_queue_idx ON operation_jobs(next_attempt_at) WHERE status IN ('queued','running');
CREATE INDEX plans_project_idx ON plan_versions(project_id,number DESC);
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable record'; END $$;
CREATE TRIGGER immutable_approval BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_drafts BEFORE UPDATE OR DELETE ON plan_task_drafts FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON activity_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION guard_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable plan'; END IF;
 IF (NEW.snapshot,NEW.content_hash,NEW.project_id,NEW.number,NEW.base_project_version,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.snapshot,OLD.content_hash,OLD.project_id,OLD.number,OLD.base_project_version,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'immutable plan content'; END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='in_review') OR (OLD.status='in_review' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='published') OR (OLD.status='published' AND NEW.status='superseded')) THEN RAISE EXCEPTION 'invalid plan transition'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER guard_plan_trigger BEFORE UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION guard_plan();
CREATE FUNCTION guard_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM users u JOIN project_members m ON m.user_id=u.id JOIN plan_versions p ON p.project_id=m.project_id WHERE u.id=NEW.user_id AND u.kind='human' AND NOT u.disabled AND m.role IN ('owner','editor') AND p.id=NEW.plan_version_id AND p.project_id=NEW.project_id AND p.status='in_review' AND p.content_hash=NEW.content_hash) THEN RAISE EXCEPTION 'invalid approval'; END IF; RETURN NEW; END $$;
CREATE TRIGGER approval_guard BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION guard_approval();
