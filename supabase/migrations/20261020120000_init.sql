-- Sable initial schema.
-- Tenant tables live in public and have row level security forced on.
-- Privileged helpers live in private, which is not an exposed API schema.
-- auth.uid() is created only when missing so this file can run on stock Postgres
-- and does not replace Supabase Auth.
-- gen_random_uuid() is core PostgreSQL (13+). This file does not require pgcrypto,
-- which keeps it applicable on PGlite and on Supabase.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO app_user, authenticated;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO app_user, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = pg_catalog
    AS $fn$
      SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
    $fn$;
  END IF;
END $$;

CREATE TABLE private.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.schema_migrations FORCE ROW LEVEL SECURITY;

CREATE FUNCTION private.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION private.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO app_user, authenticated;

CREATE FUNCTION private.line_total_minor(quantity_milli integer, unit_amount_minor bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN (quantity_milli::bigint * unit_amount_minor) >= 0
      THEN ((quantity_milli::bigint * unit_amount_minor) + 500) / 1000
    ELSE - ((-(quantity_milli::bigint * unit_amount_minor) + 500) / 1000)
  END;
$$;

CREATE FUNCTION private.cost_amount_minor(minutes integer, hourly_rate_minor bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN (minutes::bigint * hourly_rate_minor) >= 0
      THEN ((minutes::bigint * hourly_rate_minor) + 30) / 60
    ELSE - ((-(minutes::bigint * hourly_rate_minor) + 30) / 60)
  END;
$$;

-- Identity is global. Authorization is membership, never a submitted organization id.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email)),
  CONSTRAINT users_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  currency char(3) NOT NULL,
  timezone text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT organizations_slug_fmt CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT organizations_currency_fmt CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT organizations_timezone_fmt CHECK (timezone ~ '^[A-Za-z0-9_+\/-]{1,64}$')
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT memberships_role_chk CHECK (role IN ('owner', 'admin', 'manager', 'contributor', 'client'))
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id),
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'trialing',
  provider text NOT NULL DEFAULT 'mock',
  seat_limit integer NOT NULL,
  project_limit integer NOT NULL,
  storage_limit_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('trial', 'studio', 'agency')),
  CONSTRAINT subscriptions_status_chk CHECK (status IN ('trialing', 'active', 'canceled')),
  CONSTRAINT subscriptions_provider_chk CHECK (provider IN ('mock', 'stripe')),
  CONSTRAINT subscriptions_limits_chk CHECK (seat_limit > 0 AND project_limit > 0 AND storage_limit_bytes > 0)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  invited_by uuid NOT NULL REFERENCES users (id),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users (id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_lower CHECK (email = lower(email)),
  CONSTRAINT invitations_role_chk CHECK (role IN ('owner', 'admin', 'manager', 'contributor', 'client')),
  CONSTRAINT invitations_terminal_chk CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX invitations_one_pending
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_org_idx ON invitations (organization_id);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'lead',
  website text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CONSTRAINT clients_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT clients_stage_chk CHECK (stage IN ('lead', 'qualified', 'active', 'paused', 'closed')),
  CONSTRAINT clients_custom_object CHECK (jsonb_typeof(custom_fields) = 'object')
);
CREATE INDEX clients_org_name_idx ON clients (organization_id, name);

CREATE TABLE client_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  options text[] NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, key),
  CONSTRAINT field_key_fmt CHECK (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT field_type_chk CHECK (field_type IN ('text', 'number', 'date', 'select')),
  CONSTRAINT field_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT field_select_options CHECK (field_type <> 'select' OR cardinality(options) > 0)
);

CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT contact_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT contact_email_lower CHECK (email IS NULL OR email = lower(email))
);

CREATE TABLE client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT note_body_len CHECK (char_length(body) BETWEEN 1 AND 8000)
);

CREATE TABLE client_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  actor_id uuid REFERENCES users (id),
  kind text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT activity_summary_len CHECK (char_length(summary) BETWEEN 1 AND 300)
);

CREATE TABLE client_access (
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_id, user_id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  client_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  description text NOT NULL DEFAULT '',
  timezone text NOT NULL,
  start_on date,
  end_on date,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id),
  CONSTRAINT project_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT project_status_chk CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'canceled')),
  CONSTRAINT project_timezone_fmt CHECK (timezone ~ '^[A-Za-z0-9_+\/-]{1,64}$'),
  CONSTRAINT project_date_order CHECK (start_on IS NULL OR end_on IS NULL OR end_on >= start_on)
);
CREATE INDEX projects_org_idx ON projects (organization_id, status);

CREATE TABLE project_access (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, user_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE project_members (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, user_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);

-- Internal money is split from projects so a project read cannot leak cost.
CREATE TABLE project_budgets (
  organization_id uuid NOT NULL,
  project_id uuid PRIMARY KEY,
  revenue_budget_minor bigint,
  cost_budget_minor bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_nonnegative CHECK (
    (revenue_budget_minor IS NULL OR revenue_budget_minor >= 0)
    AND (cost_budget_minor IS NULL OR cost_budget_minor >= 0)
  )
);

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT milestone_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE TABLE labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8a8175',
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  CONSTRAINT label_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT label_color_fmt CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_task_id uuid,
  milestone_id uuid,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'backlog',
  client_visible boolean NOT NULL DEFAULT false,
  due_on date,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, parent_task_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT task_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT task_status_chk CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'done'))
);
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_due_idx ON tasks (organization_id, due_on);

CREATE TABLE task_assignees (
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task_id, user_id),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE task_labels (
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL,
  label_id uuid NOT NULL,
  PRIMARY KEY (organization_id, task_id, label_id),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, label_id) REFERENCES labels (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT comment_body_len CHECK (char_length(body) BETWEEN 1 AND 8000)
);

CREATE TABLE task_dependencies (
  organization_id uuid NOT NULL,
  predecessor_id uuid NOT NULL,
  successor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (predecessor_id, successor_id),
  FOREIGN KEY (organization_id, predecessor_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, successor_id) REFERENCES tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT dependency_not_self CHECK (predecessor_id <> successor_id)
);

CREATE TABLE project_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  CONSTRAINT template_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE TABLE template_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'backlog',
  client_visible boolean NOT NULL DEFAULT false,
  offset_days integer,
  parent_key text,
  UNIQUE (organization_id, id),
  UNIQUE (template_id, key),
  FOREIGN KEY (organization_id, template_id) REFERENCES project_templates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT template_task_key_fmt CHECK (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT template_task_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT template_task_status_chk CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'done'))
);

CREATE TABLE template_dependencies (
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL,
  predecessor_key text NOT NULL,
  successor_key text NOT NULL,
  PRIMARY KEY (template_id, predecessor_key, successor_key),
  FOREIGN KEY (organization_id, template_id) REFERENCES project_templates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT template_dep_not_self CHECK (predecessor_key <> successor_key)
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  internal boolean NOT NULL DEFAULT true,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CONSTRAINT attachment_entity_chk CHECK (entity_type IN ('client', 'project', 'task')),
  CONSTRAINT attachment_size_chk CHECK (byte_size > 0 AND byte_size <= 10485760),
  CONSTRAINT attachment_filename_len CHECK (char_length(filename) BETWEEN 1 AND 180),
  CONSTRAINT attachment_mime_chk CHECK (mime_type IN (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv'
  ))
);
CREATE INDEX attachments_entity_idx ON attachments (organization_id, entity_type, entity_id);

CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  client_id uuid NOT NULL,
  project_id uuid,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  issued_on date,
  expires_on date,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  CONSTRAINT estimate_status_chk CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')),
  CONSTRAINT estimate_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160)
);

CREATE TABLE estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  estimate_id uuid NOT NULL,
  position integer NOT NULL,
  description text NOT NULL,
  quantity_milli integer NOT NULL,
  unit_amount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  UNIQUE (organization_id, estimate_id, position),
  FOREIGN KEY (organization_id, estimate_id) REFERENCES estimates (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT estimate_line_qty CHECK (quantity_milli > 0),
  CONSTRAINT estimate_line_unit CHECK (unit_amount_minor >= 0),
  CONSTRAINT estimate_line_desc CHECK (char_length(btrim(description)) BETWEEN 1 AND 300)
);

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  client_id uuid NOT NULL,
  project_id uuid,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  issued_on date,
  expires_on date,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  CONSTRAINT proposal_status_chk CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')),
  CONSTRAINT proposal_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160)
);

CREATE TABLE proposal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  position integer NOT NULL,
  description text NOT NULL,
  quantity_milli integer NOT NULL,
  unit_amount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  UNIQUE (organization_id, proposal_id, position),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES proposals (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT proposal_line_qty CHECK (quantity_milli > 0),
  CONSTRAINT proposal_line_unit CHECK (unit_amount_minor >= 0),
  CONSTRAINT proposal_line_desc CHECK (char_length(btrim(description)) BETWEEN 1 AND 300)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  client_id uuid NOT NULL,
  project_id uuid,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  issued_on date,
  due_on date,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  CONSTRAINT invoice_status_chk CHECK (status IN ('draft', 'issued', 'partial', 'paid', 'void')),
  CONSTRAINT invoice_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160)
);
CREATE INDEX invoices_org_status_idx ON invoices (organization_id, status, issued_on);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  position integer NOT NULL,
  description text NOT NULL,
  quantity_milli integer NOT NULL,
  unit_amount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  UNIQUE (organization_id, invoice_id, position),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_line_qty CHECK (quantity_milli > 0),
  CONSTRAINT invoice_line_unit CHECK (unit_amount_minor >= 0),
  CONSTRAINT invoice_line_desc CHECK (char_length(btrim(description)) BETWEEN 1 AND 300)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  source text NOT NULL,
  provider text,
  provider_reference text,
  received_on date NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id),
  CONSTRAINT payment_amount_chk CHECK (amount_minor > 0),
  CONSTRAINT payment_source_chk CHECK (
    (source = 'manual' AND provider IS NULL AND provider_reference IS NULL)
    OR (source = 'provider' AND provider IS NOT NULL AND char_length(btrim(provider_reference)) > 0)
  )
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid,
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  minutes integer NOT NULL,
  billable boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id),
  CONSTRAINT time_minutes_chk CHECK (minutes > 0 AND minutes <= 1440)
);
CREATE INDEX time_entries_project_idx ON time_entries (organization_id, project_id, work_date);

CREATE TABLE time_entry_costs (
  organization_id uuid NOT NULL,
  time_entry_id uuid PRIMARY KEY,
  hourly_rate_minor bigint NOT NULL,
  cost_amount_minor bigint NOT NULL,
  FOREIGN KEY (organization_id, time_entry_id) REFERENCES time_entries (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT time_cost_nonnegative CHECK (hourly_rate_minor >= 0 AND cost_amount_minor >= 0)
);

CREATE TABLE cost_rates (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hourly_rate_minor bigint NOT NULL,
  effective_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, effective_on),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT cost_rate_nonnegative CHECK (hourly_rate_minor >= 0)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT notification_kind_chk CHECK (kind IN (
    'invitation_accepted', 'task_assigned', 'invoice_issued', 'comment_added', 'member_joined'
  ))
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE notification_preferences (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  push boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, user_id, kind),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT preference_kind_chk CHECK (kind IN (
    'invitation_accepted', 'task_assigned', 'invoice_issued', 'comment_added', 'member_joined'
  ))
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  actor_id uuid REFERENCES users (id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_action_len CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_org_idx ON audit_events (organization_id, created_at DESC);

CREATE TABLE availability_windows (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  weekday integer NOT NULL,
  minutes integer NOT NULL,
  PRIMARY KEY (organization_id, user_id, weekday),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT availability_weekday_chk CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT availability_minutes_chk CHECK (minutes >= 0 AND minutes <= 1440)
);

-- Role lookup is security definer so policies can read memberships without recursing through RLS.
CREATE FUNCTION private.member_role(org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT m.role
  FROM public.memberships m
  WHERE m.organization_id = org
    AND m.user_id = private.current_user_id();
$$;

CREATE FUNCTION private.is_staff(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT private.member_role(org) IN ('owner', 'admin', 'manager', 'contributor');
$$;

CREATE FUNCTION private.is_finance(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT private.member_role(org) IN ('owner', 'admin', 'manager');
$$;

CREATE FUNCTION private.can_manage_members(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT private.member_role(org) IN ('owner', 'admin');
$$;

CREATE FUNCTION private.can_invite(org uuid, target_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT CASE private.member_role(org)
    WHEN 'owner' THEN target_role IN ('owner', 'admin', 'manager', 'contributor', 'client')
    WHEN 'admin' THEN target_role IN ('admin', 'manager', 'contributor', 'client')
    WHEN 'manager' THEN target_role IN ('contributor', 'client')
    ELSE false
  END;
$$;

CREATE FUNCTION private.shares_organization_with(other_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships me
    JOIN public.memberships them ON them.organization_id = me.organization_id
    WHERE me.user_id = private.current_user_id()
      AND them.user_id = other_user
  );
$$;

CREATE FUNCTION private.client_assigned(org uuid, client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_access ca
    JOIN public.memberships m
      ON m.organization_id = ca.organization_id
     AND m.user_id = ca.user_id
    WHERE ca.organization_id = org
      AND ca.client_id = client
      AND ca.user_id = private.current_user_id()
      AND m.role = 'client'
  );
$$;

CREATE FUNCTION private.client_can_project(org uuid, project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_access pa
    JOIN public.projects p
      ON p.organization_id = pa.organization_id
     AND p.id = pa.project_id
    JOIN public.client_access ca
      ON ca.organization_id = p.organization_id
     AND ca.client_id = p.client_id
     AND ca.user_id = pa.user_id
    WHERE pa.organization_id = org
      AND pa.project_id = project
      AND pa.user_id = private.current_user_id()
  );
$$;

CREATE FUNCTION private.task_visible_to_current(task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task
      AND t.client_visible
      AND private.client_can_project(t.organization_id, t.project_id)
  );
$$;

CREATE FUNCTION private.invoice_visible_to_client(invoice uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = invoice
      AND i.status IN ('issued', 'partial', 'paid')
      AND i.project_id IS NOT NULL
      AND private.client_can_project(i.organization_id, i.project_id)
  );
$$;

REVOKE ALL ON FUNCTION private.member_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_staff(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_finance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_invite(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.shares_organization_with(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.client_assigned(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.client_can_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.task_visible_to_current(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.invoice_visible_to_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.member_role(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.is_staff(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.is_finance(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_members(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.can_invite(uuid, text) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.shares_organization_with(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.client_assigned(uuid, uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.client_can_project(uuid, uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.task_visible_to_current(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.invoice_visible_to_client(uuid) TO app_user, authenticated;

CREATE FUNCTION private.reject_org_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE FUNCTION private.prevent_last_owner_loss() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  remaining integer;
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role IS DISTINCT FROM 'owner') THEN
    SELECT count(*) INTO remaining
    FROM public.memberships
    WHERE organization_id = OLD.organization_id
      AND role = 'owner'
      AND user_id <> OLD.user_id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'last owner cannot be removed or demoted';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.prevent_task_parent_cycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  found boolean;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'task cannot parent itself';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks parent
    WHERE parent.id = NEW.parent_task_id
      AND parent.organization_id = NEW.organization_id
      AND parent.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'parent task must belong to the same project';
  END IF;
  WITH RECURSIVE walk AS (
    SELECT NEW.parent_task_id AS id
    UNION ALL
    SELECT t.parent_task_id
    FROM public.tasks t
    JOIN walk w ON t.id = w.id
    WHERE t.parent_task_id IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE id = NEW.id) INTO found;
  IF found THEN
    RAISE EXCEPTION 'task parent cycle detected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.prevent_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  found boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tasks predecessor
    JOIN public.tasks successor
      ON successor.project_id = predecessor.project_id
     AND successor.organization_id = predecessor.organization_id
    WHERE predecessor.id = NEW.predecessor_id
      AND successor.id = NEW.successor_id
      AND predecessor.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'dependencies must stay inside one project';
  END IF;
  WITH RECURSIVE walk AS (
    SELECT NEW.predecessor_id AS id
    UNION ALL
    SELECT d.predecessor_id
    FROM public.task_dependencies d
    JOIN walk w ON d.successor_id = w.id
    WHERE d.organization_id = NEW.organization_id
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE id = NEW.successor_id) INTO found;
  IF found THEN
    RAISE EXCEPTION 'dependency cycle detected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.prevent_template_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  found boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.template_tasks t
    WHERE t.template_id = NEW.template_id AND t.key = NEW.predecessor_key AND t.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.template_tasks t
    WHERE t.template_id = NEW.template_id AND t.key = NEW.successor_key AND t.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'template dependency keys must exist on the template';
  END IF;
  WITH RECURSIVE walk AS (
    SELECT NEW.predecessor_key AS key
    UNION ALL
    SELECT d.predecessor_key
    FROM public.template_dependencies d
    JOIN walk w ON d.successor_key = w.key
    WHERE d.template_id = NEW.template_id
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE key = NEW.successor_key) INTO found;
  IF found THEN
    RAISE EXCEPTION 'template dependency cycle detected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_project_access_scope() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.client_access ca
      ON ca.organization_id = p.organization_id
     AND ca.client_id = p.client_id
     AND ca.user_id = NEW.user_id
    JOIN public.memberships m
      ON m.organization_id = ca.organization_id
     AND m.user_id = ca.user_id
    WHERE p.organization_id = NEW.organization_id
      AND p.id = NEW.project_id
      AND m.role = 'client'
  ) THEN
    RAISE EXCEPTION 'project access requires client-role access to that client';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_client_access_role() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.user_id = NEW.user_id
      AND m.role = 'client'
  ) THEN
    RAISE EXCEPTION 'client access requires the client role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.attachment_entity_ok() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.entity_type = 'client' AND NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = NEW.entity_id AND c.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attachment client is not in this organization';
  END IF;
  IF NEW.entity_type = 'project' AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.entity_id AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attachment project is not in this organization';
  END IF;
  IF NEW.entity_type = 'task' AND NOT EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = NEW.entity_id AND t.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'attachment task is not in this organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.require_line_total() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.total_minor IS DISTINCT FROM private.line_total_minor(NEW.quantity_milli, NEW.unit_amount_minor) THEN
    RAISE EXCEPTION 'line total does not match quantity and unit amount';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.document_is_draft(doc_type text, doc_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  st text;
BEGIN
  IF doc_type = 'estimate' THEN
    SELECT status INTO st FROM public.estimates WHERE id = doc_id;
  ELSIF doc_type = 'proposal' THEN
    SELECT status INTO st FROM public.proposals WHERE id = doc_id;
  ELSE
    SELECT status INTO st FROM public.invoices WHERE id = doc_id;
  END IF;
  RETURN st = 'draft';
END;
$$;

CREATE FUNCTION private.lock_lines_after_draft() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  doc_id uuid;
  kind text;
BEGIN
  IF TG_TABLE_NAME = 'estimate_lines' THEN
    kind := 'estimate';
    doc_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  ELSIF TG_TABLE_NAME = 'proposal_lines' THEN
    kind := 'proposal';
    doc_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.proposal_id ELSE NEW.proposal_id END;
  ELSE
    kind := 'invoice';
    doc_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  END IF;
  IF NOT private.document_is_draft(kind, doc_id) THEN
    RAISE EXCEPTION 'lines are locked after the document leaves draft';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.commercial_transition_ok(old_status text, new_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT old_status = new_status OR (old_status, new_status) IN (
    ('draft', 'sent'),
    ('draft', 'withdrawn'),
    ('sent', 'accepted'),
    ('sent', 'declined'),
    ('sent', 'withdrawn'),
    ('sent', 'expired')
  );
$$;

CREATE FUNCTION private.invoice_transition_ok(old_status text, new_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT old_status = new_status OR (old_status, new_status) IN (
    ('draft', 'issued'),
    ('draft', 'void'),
    ('issued', 'partial'),
    ('issued', 'paid'),
    ('issued', 'void'),
    ('partial', 'paid'),
    ('partial', 'void')
  );
$$;

CREATE FUNCTION private.enforce_estimate_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT private.commercial_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal estimate transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_proposal_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT private.commercial_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal proposal transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_invoice_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT private.invoice_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal invoice transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.assert_invoice_consistent(invoice uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  inv public.invoices%ROWTYPE;
  total bigint;
  paid bigint;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = invoice;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(total_minor), 0) INTO total FROM public.invoice_lines WHERE invoice_id = inv.id;
  SELECT COALESCE(SUM(amount_minor), 0) INTO paid FROM public.payments WHERE invoice_id = inv.id;
  IF inv.status IN ('draft', 'void') THEN
    IF paid <> 0 THEN
      RAISE EXCEPTION 'draft or void invoice cannot have payments';
    END IF;
    RETURN;
  END IF;
  IF total <= 0 THEN
    RAISE EXCEPTION 'issued invoice must have a positive total';
  END IF;
  IF paid > total THEN
    RAISE EXCEPTION 'payments exceed invoice total';
  END IF;
  IF inv.status = 'issued' AND paid <> 0 THEN
    RAISE EXCEPTION 'issued invoice must have zero payments';
  END IF;
  IF inv.status = 'paid' AND paid <> total THEN
    RAISE EXCEPTION 'paid invoice balance must be zero';
  END IF;
  IF inv.status = 'partial' AND (paid <= 0 OR paid >= total) THEN
    RAISE EXCEPTION 'partial invoice must have a remaining balance';
  END IF;
END;
$$;

CREATE FUNCTION private.check_invoice_consistency() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  iid uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    iid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    iid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  END IF;
  PERFORM private.assert_invoice_consistent(iid);
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.payment_within_balance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  inv public.invoices%ROWTYPE;
  total bigint;
  paid bigint;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = NEW.invoice_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment invoice is not in this organization';
  END IF;
  IF inv.status NOT IN ('issued', 'partial') THEN
    RAISE EXCEPTION 'payments are only accepted on issued invoices';
  END IF;
  SELECT COALESCE(SUM(total_minor), 0) INTO total FROM public.invoice_lines WHERE invoice_id = inv.id;
  SELECT COALESCE(SUM(amount_minor), 0) INTO paid FROM public.payments WHERE invoice_id = inv.id;
  IF NEW.amount_minor > (total - paid) THEN
    RAISE EXCEPTION 'payment exceeds outstanding balance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.require_cost_snapshot() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  mins integer;
BEGIN
  SELECT minutes INTO mins FROM public.time_entries WHERE id = NEW.time_entry_id;
  IF mins IS NULL THEN
    RAISE EXCEPTION 'time entry cost is missing its entry';
  END IF;
  IF NEW.cost_amount_minor IS DISTINCT FROM private.cost_amount_minor(mins, NEW.hourly_rate_minor) THEN
    RAISE EXCEPTION 'cost amount does not match minutes and rate';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_seat_limit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  lim integer;
  used integer;
BEGIN
  SELECT seat_limit INTO lim FROM public.subscriptions WHERE organization_id = NEW.organization_id;
  IF lim IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO used FROM public.memberships WHERE organization_id = NEW.organization_id;
  IF TG_TABLE_NAME = 'invitations' THEN
    SELECT count(*) INTO used
    FROM public.invitations
    WHERE organization_id = NEW.organization_id
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND id IS DISTINCT FROM NEW.id;
    used := used + (SELECT count(*) FROM public.memberships WHERE organization_id = NEW.organization_id);
  END IF;
  IF used >= lim THEN
    RAISE EXCEPTION 'seat limit reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.enforce_project_limit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  lim integer;
  used integer;
BEGIN
  SELECT project_limit INTO lim FROM public.subscriptions WHERE organization_id = NEW.organization_id;
  IF lim IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO used FROM public.projects WHERE organization_id = NEW.organization_id AND id IS DISTINCT FROM NEW.id;
  IF used >= lim THEN
    RAISE EXCEPTION 'project limit reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.assignee_is_staff() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.user_id = NEW.user_id
      AND m.role IN ('owner', 'admin', 'manager', 'contributor')
  ) THEN
    RAISE EXCEPTION 'tasks can only be assigned to staff';
  END IF;
  RETURN NEW;
END;
$$;

-- Privileged server functions. Each one authorizes explicitly because the owner bypasses RLS.
CREATE FUNCTION private.register_user(p_email text, p_name text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users (id, email, name, password_hash)
  VALUES (uid, lower(btrim(p_email)), btrim(p_name), p_password_hash);
  RETURN uid;
END;
$$;

-- Used when Supabase Auth already chose the user id. Still superuser-only.
CREATE FUNCTION private.register_user_with_id(
  p_id uuid,
  p_email text,
  p_name text,
  p_password_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, password_hash)
  VALUES (p_id, lower(btrim(p_email)), btrim(p_name), p_password_hash);
  RETURN p_id;
END;
$$;

CREATE FUNCTION private.lookup_login(p_email text)
RETURNS TABLE (id uuid, name text, password_hash text)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.id, u.name, u.password_hash
  FROM public.users u
  WHERE u.email = lower(btrim(p_email));
$$;

CREATE FUNCTION private.create_organization(
  p_name text,
  p_slug text,
  p_currency text,
  p_timezone text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := private.current_user_id();
  oid uuid := gen_random_uuid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  INSERT INTO public.organizations (id, name, slug, currency, timezone, created_by)
  VALUES (oid, btrim(p_name), p_slug, p_currency, p_timezone, uid);
  INSERT INTO public.memberships (organization_id, user_id, role)
  VALUES (oid, uid, 'owner');
  INSERT INTO public.subscriptions (
    organization_id, plan, status, provider, seat_limit, project_limit, storage_limit_bytes
  ) VALUES (oid, 'trial', 'trialing', 'mock', 5, 10, 1073741824);
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (oid, uid, 'organization.created', 'organization', oid, jsonb_build_object('slug', p_slug));
  RETURN oid;
END;
$$;

CREATE FUNCTION private.accept_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := private.current_user_id();
  inv public.invitations%ROWTYPE;
  user_email text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT email INTO user_email FROM public.users WHERE id = uid;
  SELECT * INTO inv FROM public.invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation revoked';
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation already accepted';
  END IF;
  IF inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation expired';
  END IF;
  IF inv.email <> user_email THEN
    RAISE EXCEPTION 'invitation email does not match';
  END IF;
  INSERT INTO public.memberships (organization_id, user_id, role)
  VALUES (inv.organization_id, uid, inv.role);
  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = uid
  WHERE id = inv.id;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    inv.organization_id, uid, 'invitation.accepted', 'invitation', inv.id,
    jsonb_build_object('role', inv.role)
  );
  RETURN inv.organization_id;
END;
$$;

CREATE FUNCTION private.revoke_invitation(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.invitations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF NOT private.can_invite(inv.organization_id, inv.role) THEN
    RAISE EXCEPTION 'not allowed to revoke this invitation';
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'accepted invitations cannot be revoked';
  END IF;
  IF inv.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.invitations SET revoked_at = now() WHERE id = inv.id;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id)
  VALUES (inv.organization_id, private.current_user_id(), 'invitation.revoked', 'invitation', inv.id);
END;
$$;

CREATE FUNCTION private.set_member_role(p_org uuid, p_user uuid, p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor text := private.member_role(p_org);
  old_role text;
BEGIN
  IF actor IS NULL OR actor NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'not allowed to manage members';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'manager', 'contributor', 'client') THEN
    RAISE EXCEPTION 'unknown role';
  END IF;
  SELECT role INTO old_role FROM public.memberships WHERE organization_id = p_org AND user_id = p_user;
  IF old_role IS NULL THEN
    RAISE EXCEPTION 'membership not found';
  END IF;
  IF (old_role = 'owner' OR p_role = 'owner') AND actor <> 'owner' THEN
    RAISE EXCEPTION 'only an owner can change ownership';
  END IF;
  UPDATE public.memberships SET role = p_role WHERE organization_id = p_org AND user_id = p_user;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org, private.current_user_id(), 'membership.role_changed', 'membership', p_user,
    jsonb_build_object('from', old_role, 'to', p_role)
  );
END;
$$;

CREATE FUNCTION private.remove_member(p_org uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor text := private.member_role(p_org);
  old_role text;
BEGIN
  IF actor IS NULL OR actor NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'not allowed to manage members';
  END IF;
  SELECT role INTO old_role FROM public.memberships WHERE organization_id = p_org AND user_id = p_user;
  IF old_role IS NULL THEN
    RAISE EXCEPTION 'membership not found';
  END IF;
  IF old_role = 'owner' AND actor <> 'owner' THEN
    RAISE EXCEPTION 'only an owner can remove an owner';
  END IF;
  DELETE FROM public.memberships WHERE organization_id = p_org AND user_id = p_user;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org, private.current_user_id(), 'membership.removed', 'membership', p_user,
    jsonb_build_object('role', old_role)
  );
END;
$$;

-- In-app delivery only. email and push preferences are stored and intentionally ignored here.
CREATE FUNCTION private.notify(
  p_org uuid,
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_href text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  deliver boolean;
BEGIN
  IF private.member_role(p_org) IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.organization_id = p_org AND m.user_id = p_user
  ) THEN
    RAISE EXCEPTION 'notification target is not a member';
  END IF;
  SELECT in_app INTO deliver
  FROM public.notification_preferences
  WHERE organization_id = p_org AND user_id = p_user AND kind = p_kind;
  IF deliver IS NULL THEN
    deliver := true;
  END IF;
  IF NOT deliver THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (organization_id, user_id, kind, title, body, href)
  VALUES (p_org, p_user, p_kind, p_title, p_body, p_href);
END;
$$;

CREATE FUNCTION private.write_audit(
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF private.member_role(p_org) IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_org, private.current_user_id(), p_action, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

-- Staff cannot read subscription rows. This definer check still enforces the storage cap on upload.
CREATE FUNCTION private.within_storage_limit(p_org uuid, p_extra integer) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  used bigint;
  cap bigint;
BEGIN
  IF NOT private.is_staff(p_org) THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;
  SELECT storage_limit_bytes INTO cap FROM public.subscriptions WHERE organization_id = p_org;
  IF cap IS NULL THEN
    RETURN false;
  END IF;
  SELECT coalesce(sum(byte_size), 0) INTO used FROM public.attachments WHERE organization_id = p_org;
  RETURN used + p_extra <= cap;
END;
$$;

REVOKE ALL ON FUNCTION private.register_user(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.register_user_with_id(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.lookup_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_organization(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.accept_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.revoke_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.set_member_role(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.remove_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.notify(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.write_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC;

-- register_user and lookup_login stay superuser-only. They are privileged server paths.
GRANT EXECUTE ON FUNCTION private.create_organization(text, text, text, text) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.accept_invitation(text) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.revoke_invitation(uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.set_member_role(uuid, uuid, text) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.remove_member(uuid, uuid) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.notify(uuid, uuid, text, text, text, text) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.write_audit(uuid, text, text, uuid, jsonb) TO app_user, authenticated;
GRANT EXECUTE ON FUNCTION private.within_storage_limit(uuid, integer) TO app_user, authenticated;

CREATE TRIGGER memberships_last_owner
  BEFORE UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION private.prevent_last_owner_loss();
CREATE TRIGGER memberships_seat_limit
  BEFORE INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_seat_limit();
CREATE TRIGGER invitations_seat_limit
  BEFORE INSERT ON invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_seat_limit();
CREATE TRIGGER projects_limit
  BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION private.enforce_project_limit();
CREATE TRIGGER tasks_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_task_id, project_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION private.prevent_task_parent_cycle();
CREATE TRIGGER dependencies_cycle
  BEFORE INSERT OR UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION private.prevent_dependency_cycle();
CREATE TRIGGER template_dependencies_cycle
  BEFORE INSERT OR UPDATE ON template_dependencies
  FOR EACH ROW EXECUTE FUNCTION private.prevent_template_dependency_cycle();
CREATE TRIGGER project_access_scope
  BEFORE INSERT OR UPDATE ON project_access
  FOR EACH ROW EXECUTE FUNCTION private.enforce_project_access_scope();
CREATE TRIGGER client_access_role
  BEFORE INSERT OR UPDATE ON client_access
  FOR EACH ROW EXECUTE FUNCTION private.enforce_client_access_role();
CREATE TRIGGER attachments_entity
  BEFORE INSERT OR UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION private.attachment_entity_ok();
CREATE TRIGGER estimate_lines_total
  BEFORE INSERT OR UPDATE ON estimate_lines
  FOR EACH ROW EXECUTE FUNCTION private.require_line_total();
CREATE TRIGGER proposal_lines_total
  BEFORE INSERT OR UPDATE ON proposal_lines
  FOR EACH ROW EXECUTE FUNCTION private.require_line_total();
CREATE TRIGGER invoice_lines_total
  BEFORE INSERT OR UPDATE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.require_line_total();
CREATE TRIGGER estimate_lines_lock
  BEFORE INSERT OR UPDATE OR DELETE ON estimate_lines
  FOR EACH ROW EXECUTE FUNCTION private.lock_lines_after_draft();
CREATE TRIGGER proposal_lines_lock
  BEFORE INSERT OR UPDATE OR DELETE ON proposal_lines
  FOR EACH ROW EXECUTE FUNCTION private.lock_lines_after_draft();
CREATE TRIGGER invoice_lines_lock
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.lock_lines_after_draft();
CREATE TRIGGER estimates_transition
  BEFORE UPDATE OF status ON estimates
  FOR EACH ROW EXECUTE FUNCTION private.enforce_estimate_transition();
CREATE TRIGGER proposals_transition
  BEFORE UPDATE OF status ON proposals
  FOR EACH ROW EXECUTE FUNCTION private.enforce_proposal_transition();
CREATE TRIGGER invoices_transition
  BEFORE UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION private.enforce_invoice_transition();
CREATE TRIGGER payments_balance
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION private.payment_within_balance();
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION private.reject_mutation();
CREATE TRIGGER time_costs_snapshot
  BEFORE INSERT OR UPDATE ON time_entry_costs
  FOR EACH ROW EXECUTE FUNCTION private.require_cost_snapshot();
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_mutation();
CREATE TRIGGER activity_append_only
  BEFORE UPDATE OR DELETE ON client_activity
  FOR EACH ROW EXECUTE FUNCTION private.reject_mutation();
CREATE TRIGGER assignees_staff
  BEFORE INSERT OR UPDATE ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION private.assignee_is_staff();

CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER clients_touch BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER estimates_touch BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER proposals_touch BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE CONSTRAINT TRIGGER invoices_consistent
  AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_invoice_consistency();
CREATE CONSTRAINT TRIGGER invoice_lines_consistent
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_invoice_consistency();
CREATE CONSTRAINT TRIGGER payments_consistent
  AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_invoice_consistency();

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'memberships', 'invitations', 'clients', 'client_field_definitions', 'client_contacts',
    'client_notes', 'client_activity', 'client_access', 'projects', 'project_access',
    'project_members', 'project_budgets', 'milestones', 'labels', 'tasks', 'task_assignees',
    'task_labels', 'task_comments', 'task_dependencies', 'project_templates', 'template_tasks',
    'template_dependencies', 'attachments', 'estimates', 'estimate_lines', 'proposals',
    'proposal_lines', 'invoices', 'invoice_lines', 'payments', 'time_entries', 'time_entry_costs',
    'cost_rates', 'notifications', 'notification_preferences', 'audit_events', 'availability_windows'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION private.reject_org_change()',
      tbl || '_org_immutable',
      tbl
    );
  END LOOP;
END $$;

-- Grants. RLS still applies. anon receives nothing.
GRANT USAGE ON SCHEMA public TO app_user, authenticated;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, app_user', tbl);
  END LOOP;
END $$;

GRANT SELECT (id, email, name, created_at) ON users TO app_user, authenticated;
GRANT UPDATE (name) ON users TO app_user, authenticated;
GRANT SELECT ON organizations TO app_user, authenticated;
-- currency stays immutable after creation. name and timezone are the settings surface.
GRANT UPDATE (name, timezone, updated_at) ON organizations TO app_user, authenticated;
GRANT SELECT ON memberships TO app_user, authenticated;
GRANT SELECT, INSERT ON invitations TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_field_definitions TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_contacts TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_notes TO app_user, authenticated;
GRANT SELECT, INSERT ON client_activity TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON client_access TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON project_access TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON project_members TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_budgets TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON milestones TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON labels TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON task_assignees TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON task_labels TO app_user, authenticated;
GRANT SELECT, INSERT ON task_comments TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON task_dependencies TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_templates TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON template_tasks TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON template_dependencies TO app_user, authenticated;
GRANT SELECT, INSERT, DELETE ON attachments TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE ON estimates TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON estimate_lines TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE ON proposals TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_lines TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE ON invoices TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_lines TO app_user, authenticated;
GRANT SELECT, INSERT ON payments TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE ON time_entries TO app_user, authenticated;
GRANT SELECT, INSERT ON time_entry_costs TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cost_rates TO app_user, authenticated;
GRANT SELECT ON notifications TO app_user, authenticated;
GRANT UPDATE (read_at) ON notifications TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO app_user, authenticated;
GRANT SELECT ON audit_events TO app_user, authenticated;
GRANT SELECT ON subscriptions TO app_user, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON availability_windows TO app_user, authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE client_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_field_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE client_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_activity FORCE ROW LEVEL SECURITY;
ALTER TABLE client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_access FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_access FORCE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones FORCE ROW LEVEL SECURITY;
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees FORCE ROW LEVEL SECURITY;
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_labels FORCE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE template_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE template_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates FORCE ROW LEVEL SECURITY;
ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE proposal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE time_entry_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry_costs FORCE ROW LEVEL SECURITY;
ALTER TABLE cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users FOR SELECT TO app_user, authenticated
  USING (id = private.current_user_id() OR private.shares_organization_with(id));
CREATE POLICY users_update ON users FOR UPDATE TO app_user, authenticated
  USING (id = private.current_user_id())
  WITH CHECK (id = private.current_user_id());

CREATE POLICY organizations_select ON organizations FOR SELECT TO app_user, authenticated
  USING (private.member_role(id) IS NOT NULL);
CREATE POLICY organizations_update ON organizations FOR UPDATE TO app_user, authenticated
  USING (private.member_role(id) IN ('owner', 'admin'))
  WITH CHECK (private.member_role(id) IN ('owner', 'admin'));

CREATE POLICY memberships_select ON memberships FOR SELECT TO app_user, authenticated
  USING (
    user_id = private.current_user_id()
    OR private.is_staff(organization_id)
  );

CREATE POLICY subscriptions_select ON subscriptions FOR SELECT TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY invitations_select ON invitations FOR SELECT TO app_user, authenticated
  USING (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR email = (SELECT u.email FROM users u WHERE u.id = private.current_user_id())
  );
CREATE POLICY invitations_insert ON invitations FOR INSERT TO app_user, authenticated
  WITH CHECK (
    invited_by = private.current_user_id()
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
    AND expires_at <= now() + interval '30 days'
    AND private.can_invite(organization_id, role)
  );

CREATE POLICY clients_select ON clients FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_assigned(organization_id, id));
CREATE POLICY clients_write ON clients FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id) AND created_by = private.current_user_id());
CREATE POLICY clients_update ON clients FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY clients_delete ON clients FOR DELETE TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY fields_staff ON client_field_definitions FOR ALL TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));

CREATE POLICY contacts_select ON client_contacts FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_assigned(organization_id, client_id));
CREATE POLICY contacts_write ON client_contacts FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY contacts_update ON client_contacts FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY contacts_delete ON client_contacts FOR DELETE TO app_user, authenticated
  USING (private.is_staff(organization_id));

CREATE POLICY notes_select ON client_notes FOR SELECT TO app_user, authenticated
  USING (
    private.is_staff(organization_id)
    OR (internal = false AND private.client_assigned(organization_id, client_id))
  );
CREATE POLICY notes_insert ON client_notes FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id) AND author_id = private.current_user_id());
CREATE POLICY notes_update ON client_notes FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id) AND (author_id = private.current_user_id() OR private.is_finance(organization_id)))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY notes_delete ON client_notes FOR DELETE TO app_user, authenticated
  USING (author_id = private.current_user_id() OR private.member_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY activity_select ON client_activity FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_assigned(organization_id, client_id));
CREATE POLICY activity_insert ON client_activity FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id));

CREATE POLICY client_access_select ON client_access FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR user_id = private.current_user_id());
CREATE POLICY client_access_write ON client_access FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id));
CREATE POLICY client_access_delete ON client_access FOR DELETE TO app_user, authenticated
  USING (private.is_finance(organization_id));

CREATE POLICY projects_select ON projects FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_can_project(organization_id, id));
CREATE POLICY projects_insert ON projects FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id) AND created_by = private.current_user_id());
CREATE POLICY projects_update ON projects FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY projects_delete ON projects FOR DELETE TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY project_access_select ON project_access FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR user_id = private.current_user_id());
CREATE POLICY project_access_write ON project_access FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id));
CREATE POLICY project_access_delete ON project_access FOR DELETE TO app_user, authenticated
  USING (private.is_finance(organization_id));

CREATE POLICY project_members_all ON project_members FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_can_project(organization_id, project_id));
CREATE POLICY project_members_write ON project_members FOR INSERT TO app_user, authenticated
  WITH CHECK (private.member_role(organization_id) IN ('owner', 'admin', 'manager'));
CREATE POLICY project_members_delete ON project_members FOR DELETE TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY budgets_all ON project_budgets FOR ALL TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY milestones_select ON milestones FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id) OR private.client_can_project(organization_id, project_id));
CREATE POLICY milestones_write ON milestones FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY milestones_update ON milestones FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY milestones_delete ON milestones FOR DELETE TO app_user, authenticated
  USING (private.is_staff(organization_id));

CREATE POLICY labels_staff ON labels FOR ALL TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));

CREATE POLICY tasks_select ON tasks FOR SELECT TO app_user, authenticated
  USING (
    private.is_staff(organization_id)
    OR (client_visible AND private.client_can_project(organization_id, project_id))
  );
CREATE POLICY tasks_insert ON tasks FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id) AND created_by = private.current_user_id());
CREATE POLICY tasks_update ON tasks FOR UPDATE TO app_user, authenticated
  USING (private.is_staff(organization_id))
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY tasks_delete ON tasks FOR DELETE TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY assignees_select ON task_assignees FOR SELECT TO app_user, authenticated
  USING (
    private.is_staff(organization_id)
    OR private.task_visible_to_current(task_id)
  );
CREATE POLICY assignees_insert ON task_assignees FOR INSERT TO app_user, authenticated
  WITH CHECK (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR (private.member_role(organization_id) = 'contributor' AND user_id = private.current_user_id())
  );
CREATE POLICY assignees_delete ON task_assignees FOR DELETE TO app_user, authenticated
  USING (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR (private.member_role(organization_id) = 'contributor' AND user_id = private.current_user_id())
  );

CREATE POLICY task_labels_select ON task_labels FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY task_labels_write ON task_labels FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY task_labels_delete ON task_labels FOR DELETE TO app_user, authenticated
  USING (private.is_staff(organization_id));

CREATE POLICY comments_select ON task_comments FOR SELECT TO app_user, authenticated
  USING (
    private.is_staff(organization_id)
    OR (internal = false AND private.task_visible_to_current(task_id))
  );
CREATE POLICY comments_insert ON task_comments FOR INSERT TO app_user, authenticated
  WITH CHECK (
    author_id = private.current_user_id()
    AND (
      private.is_staff(organization_id)
      OR (internal = false AND private.task_visible_to_current(task_id))
    )
  );

CREATE POLICY dependencies_staff ON task_dependencies FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY dependencies_write ON task_dependencies FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id));
CREATE POLICY dependencies_delete ON task_dependencies FOR DELETE TO app_user, authenticated
  USING (private.is_staff(organization_id));

CREATE POLICY templates_select ON project_templates FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY templates_write ON project_templates FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id) AND created_by = private.current_user_id());
CREATE POLICY templates_update ON project_templates FOR UPDATE TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));
CREATE POLICY templates_delete ON project_templates FOR DELETE TO app_user, authenticated
  USING (private.is_finance(organization_id));

CREATE POLICY template_tasks_select ON template_tasks FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY template_tasks_write ON template_tasks FOR ALL TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY template_deps_select ON template_dependencies FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY template_deps_write ON template_dependencies FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id));
CREATE POLICY template_deps_delete ON template_dependencies FOR DELETE TO app_user, authenticated
  USING (private.is_finance(organization_id));

CREATE POLICY attachments_select ON attachments FOR SELECT TO app_user, authenticated
  USING (
    private.is_staff(organization_id)
    OR (
      internal = false AND (
        (entity_type = 'client' AND private.client_assigned(organization_id, entity_id))
        OR (entity_type = 'project' AND private.client_can_project(organization_id, entity_id))
        OR (entity_type = 'task' AND private.task_visible_to_current(entity_id))
      )
    )
  );
CREATE POLICY attachments_insert ON attachments FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_staff(organization_id) AND uploaded_by = private.current_user_id());
CREATE POLICY attachments_delete ON attachments FOR DELETE TO app_user, authenticated
  USING (
    uploaded_by = private.current_user_id()
    OR private.member_role(organization_id) IN ('owner', 'admin', 'manager')
  );

CREATE POLICY estimates_select ON estimates FOR SELECT TO app_user, authenticated
  USING (private.is_finance(organization_id));
CREATE POLICY estimates_insert ON estimates FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id) AND created_by = private.current_user_id() AND status = 'draft');
CREATE POLICY estimates_update ON estimates FOR UPDATE TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY estimate_lines_all ON estimate_lines FOR ALL TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY proposals_select ON proposals FOR SELECT TO app_user, authenticated
  USING (private.is_finance(organization_id));
CREATE POLICY proposals_insert ON proposals FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id) AND created_by = private.current_user_id() AND status = 'draft');
CREATE POLICY proposals_update ON proposals FOR UPDATE TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY proposal_lines_all ON proposal_lines FOR ALL TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY invoices_select ON invoices FOR SELECT TO app_user, authenticated
  USING (private.is_finance(organization_id) OR private.invoice_visible_to_client(id));
CREATE POLICY invoices_insert ON invoices FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id) AND created_by = private.current_user_id() AND status = 'draft');
CREATE POLICY invoices_update ON invoices FOR UPDATE TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY invoice_lines_all ON invoice_lines FOR ALL TO app_user, authenticated
  USING (
    private.is_finance(organization_id)
    OR private.invoice_visible_to_client(invoice_id)
  )
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY payments_select ON payments FOR SELECT TO app_user, authenticated
  USING (private.is_finance(organization_id) OR private.invoice_visible_to_client(invoice_id));
CREATE POLICY payments_insert ON payments FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id) AND recorded_by = private.current_user_id());

CREATE POLICY time_select ON time_entries FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY time_insert ON time_entries FOR INSERT TO app_user, authenticated
  WITH CHECK (
    (private.member_role(organization_id) IN ('owner', 'admin', 'manager'))
    OR (private.member_role(organization_id) = 'contributor' AND user_id = private.current_user_id())
  );
CREATE POLICY time_update ON time_entries FOR UPDATE TO app_user, authenticated
  USING (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR user_id = private.current_user_id()
  )
  WITH CHECK (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR (private.member_role(organization_id) = 'contributor' AND user_id = private.current_user_id())
  );

CREATE POLICY time_costs_all ON time_entry_costs FOR SELECT TO app_user, authenticated
  USING (private.is_finance(organization_id));
CREATE POLICY time_costs_insert ON time_entry_costs FOR INSERT TO app_user, authenticated
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY cost_rates_all ON cost_rates FOR ALL TO app_user, authenticated
  USING (private.is_finance(organization_id))
  WITH CHECK (private.is_finance(organization_id));

CREATE POLICY notifications_select ON notifications FOR SELECT TO app_user, authenticated
  USING (user_id = private.current_user_id());
CREATE POLICY notifications_update ON notifications FOR UPDATE TO app_user, authenticated
  USING (user_id = private.current_user_id())
  WITH CHECK (user_id = private.current_user_id());

CREATE POLICY preferences_all ON notification_preferences FOR ALL TO app_user, authenticated
  USING (user_id = private.current_user_id())
  WITH CHECK (user_id = private.current_user_id() AND private.member_role(organization_id) IS NOT NULL);

CREATE POLICY audit_select ON audit_events FOR SELECT TO app_user, authenticated
  USING (private.member_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY availability_select ON availability_windows FOR SELECT TO app_user, authenticated
  USING (private.is_staff(organization_id));
CREATE POLICY availability_write ON availability_windows FOR INSERT TO app_user, authenticated
  WITH CHECK (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR (private.is_staff(organization_id) AND user_id = private.current_user_id())
  );
CREATE POLICY availability_update ON availability_windows FOR UPDATE TO app_user, authenticated
  USING (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR user_id = private.current_user_id()
  )
  WITH CHECK (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR (private.is_staff(organization_id) AND user_id = private.current_user_id())
  );
CREATE POLICY availability_delete ON availability_windows FOR DELETE TO app_user, authenticated
  USING (
    private.member_role(organization_id) IN ('owner', 'admin', 'manager')
    OR user_id = private.current_user_id()
  );

-- Supabase Storage bucket. Direct object reads stay closed.
-- The server authorizes through attachment RLS, then reads bytes with the service role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('sable-private', 'sable-private', false)
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'storage bucket was not created: %', SQLERRM;
    END;
  END IF;
END $$;

INSERT INTO private.schema_migrations (id) VALUES ('20261020120000_init');
