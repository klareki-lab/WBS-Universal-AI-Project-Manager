-- Revocations append to history; approval/snapshot rows remain immutable.
-- No project FK here: approval already binds the project. This avoids taking a
-- reverse project lock from identity/membership revocation triggers.
CREATE TABLE approval_revocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
 actor_id uuid REFERENCES users(id),reason text NOT NULL,source text NOT NULL CHECK(source IN ('human','identity_disabled','membership_removed','role_downgraded','upgrade')),
 request_id text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_approval_revocations BEFORE UPDATE OR DELETE ON approval_revocations FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION revoke_disabled_approvals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.disabled AND NOT OLD.disabled THEN
 INSERT INTO approval_revocations(approval_id,reason,source)
 SELECT a.id,'Approver identity disabled','identity_disabled' FROM approvals a JOIN plan_versions p ON p.id=a.plan_version_id WHERE a.user_id=NEW.id AND a.decision='approved' AND p.status='approved'
 ON CONFLICT(approval_id) DO NOTHING;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER revoke_disabled_approvals_trigger AFTER UPDATE OF disabled ON users FOR EACH ROW EXECUTE FUNCTION revoke_disabled_approvals();
CREATE FUNCTION revoke_membership_approvals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (OLD.role IN ('owner','editor') AND NEW.role='viewer') THEN
 INSERT INTO approval_revocations(approval_id,reason,source)
 SELECT a.id,'Approver project permission revoked',CASE WHEN TG_OP='DELETE' THEN 'membership_removed' ELSE 'role_downgraded' END FROM approvals a JOIN plan_versions p ON p.id=a.plan_version_id WHERE a.user_id=OLD.user_id AND a.project_id=OLD.project_id AND a.decision='approved' AND p.status='approved'
 ON CONFLICT(approval_id) DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER revoke_membership_approvals_trigger AFTER DELETE OR UPDATE OF role ON project_members FOR EACH ROW EXECUTE FUNCTION revoke_membership_approvals();
-- Fail closed for any already-ineligible pending approvals on upgrade.
INSERT INTO approval_revocations(approval_id,reason,source)
SELECT a.id,'Approver is no longer eligible at upgrade','upgrade' FROM approvals a JOIN plan_versions p ON p.id=a.plan_version_id JOIN users u ON u.id=a.user_id
LEFT JOIN project_members m ON m.project_id=a.project_id AND m.user_id=a.user_id
WHERE a.decision='approved' AND p.status='approved' AND (u.disabled OR u.kind<>'human' OR m.role IS NULL OR m.role='viewer');
