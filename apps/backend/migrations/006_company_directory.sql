-- Memberships must be explicitly provisioned; do not silently combine existing users.
CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE company_employees (company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), PRIMARY KEY(company_id,user_id));
ALTER TABLE projects ADD COLUMN company_id uuid REFERENCES companies(id);
