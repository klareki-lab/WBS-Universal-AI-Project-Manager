-- Structured fields are additive; existing project descriptions are preserved.
ALTER TABLE projects
  ADD COLUMN goals text NOT NULL DEFAULT '',
  ADD COLUMN requirements text NOT NULL DEFAULT '',
  ADD COLUMN start_date date,
  ADD COLUMN end_date date,
  ADD CONSTRAINT projects_dates_ordered CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date);
