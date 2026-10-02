-- PostgreSQL schema for Aringay Agriculture
-- Creates the application tables required by the app and preserves original field meaning.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  fullname VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'farmer' CHECK (role IN ('admin', 'farmer')),
  hectares NUMERIC(10,2) DEFAULT 0.00,
  birthdate DATE,
  age INTEGER,
  gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', 'Other')),
  civil_status VARCHAR(20) CHECK (civil_status IN ('Single', 'Married', 'Widowed', 'Separated')),
  address VARCHAR(255),
  contact_number VARCHAR(20),
  place_of_birth VARCHAR(255),
  profile_pic VARCHAR(255) NOT NULL DEFAULT 'default.png',
  pending_fullname VARCHAR(100),
  pending_hectares NUMERIC(10,2),
  has_pending_changes BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  total_quantity NUMERIC(15,4) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  description TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id),
  subject VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  image_path VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by INTEGER,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distributions (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  allocated_quantity NUMERIC(15,4) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'received')),
  proof_image VARCHAR(255),
  received_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deletion_reason TEXT,
  deleted_by INTEGER,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id),
  distribution_id INTEGER REFERENCES distributions(id),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_notification_reads (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  activity_key VARCHAR(100) NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (admin_id, activity_key)
);

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  notification_id INTEGER,
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  processing_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  sid VARCHAR(128) PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS app_locks (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS app_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role_deleted ON users(role, is_deleted);
CREATE INDEX IF NOT EXISTS idx_distributions_farmer_id ON distributions(farmer_id);
CREATE INDEX IF NOT EXISTS idx_distributions_resource_id ON distributions(resource_id);
CREATE INDEX IF NOT EXISTS idx_complaints_farmer_id ON complaints(farmer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_farmer_id ON notifications(farmer_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_pending_due ON email_logs(next_attempt_at,created_at,id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON app_sessions(expires_at);

INSERT INTO app_locks (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_migrations (version) VALUES ('001_typescript_compatibility')
ON CONFLICT (version) DO NOTHING;
INSERT INTO app_migrations (version) VALUES ('002_email_retry_schedule')
ON CONFLICT (version) DO NOTHING;
