-- A second line of defense beyond project locks and idempotency records.
CREATE UNIQUE INDEX one_successful_publication_per_plan
ON operation_jobs(project_id,(input->>'plan_version_id'))
WHERE kind='publish' AND status='succeeded';
