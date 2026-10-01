-- Demo seed data for Supabase/PostgreSQL. Run after schema-postgres.sql.
-- Sample login password for all demo accounts: FarmDemo!2026
-- Demo credentials are public by design. Never use them in production.
-- This seed is additive and can be run more than once.

BEGIN;

INSERT INTO users (
  fullname,
  email,
  password,
  role,
  hectares,
  birthdate,
  age,
  gender,
  civil_status,
  address,
  contact_number,
  place_of_birth
)
VALUES
  (
    'Demo Farmer One',
    'demo.farmer1@example.invalid',
    '$2b$10$fMOclZEaNo.Vlak6mb.Vu.gOgVLIJIKQ8BM7y.394lH4F33EuwGa6',
    'farmer',
    2.50,
    '1985-04-12',
    41,
    'Male',
    'Married',
    'Demo Barangay, Aringay',
    '09000000001',
    'Aringay'
  ),
  (
    'Demo Farmer Two',
    'demo.farmer2@example.invalid',
    '$2b$10$fMOclZEaNo.Vlak6mb.Vu.gOgVLIJIKQ8BM7y.394lH4F33EuwGa6',
    'farmer',
    1.25,
    '1992-08-23',
    34,
    'Female',
    'Single',
    'Demo Barangay, Aringay',
    '09000000002',
    'Aringay'
  ),
  (
    'Demo Administrator',
    'demo.admin@example.invalid',
    '$2b$10$fMOclZEaNo.Vlak6mb.Vu.gOgVLIJIKQ8BM7y.394lH4F33EuwGa6',
    'admin',
    0.00,
    NULL,
    NULL,
    NULL,
    NULL,
    'Demo account',
    NULL,
    NULL
  )
ON CONFLICT (email) DO NOTHING;

INSERT INTO resources (name, total_quantity, unit, description)
SELECT demo.name, demo.total_quantity, demo.unit, '[DEMO] Sample inventory'
FROM (
  VALUES
    ('[DEMO] Rice seeds', 120.0000::NUMERIC, 'bags'),
    ('[DEMO] Organic fertilizer', 40.0000::NUMERIC, 'bags')
) AS demo(name, total_quantity, unit)
WHERE NOT EXISTS (
  SELECT 1
  FROM resources existing
  WHERE existing.name = demo.name
    AND existing.description = '[DEMO] Sample inventory'
);

INSERT INTO distributions (farmer_id, resource_id, allocated_quantity, status, received_at)
SELECT farmer.id, resource.id, demo.quantity, demo.status,
       CASE WHEN demo.status = 'received' THEN NOW() ELSE NULL END
FROM (
  VALUES
    ('demo.farmer1@example.invalid', '[DEMO] Rice seeds', 20.0000::NUMERIC, 'received'),
    ('demo.farmer2@example.invalid', '[DEMO] Organic fertilizer', 5.0000::NUMERIC, 'pending')
) AS demo(farmer_email, resource_name, quantity, status)
JOIN users farmer ON farmer.email = demo.farmer_email
JOIN resources resource ON resource.name = demo.resource_name
  AND resource.description = '[DEMO] Sample inventory'
WHERE NOT EXISTS (
  SELECT 1
  FROM distributions existing
  WHERE existing.farmer_id = farmer.id
    AND existing.resource_id = resource.id
    AND existing.allocated_quantity = demo.quantity
    AND existing.status = demo.status
);

INSERT INTO complaints (farmer_id, subject, message)
SELECT farmer.id,
       '[DEMO] Seedling question',
       'Demo record: asking when the next seedling distribution is scheduled.'
FROM users farmer
WHERE farmer.email = 'demo.farmer2@example.invalid'
  AND NOT EXISTS (
    SELECT 1
    FROM complaints existing
    WHERE existing.farmer_id = farmer.id
      AND existing.subject = '[DEMO] Seedling question'
  );

INSERT INTO notifications (farmer_id, distribution_id, message)
SELECT farmer.id, distribution.id,
       '[DEMO] A sample fertilizer allocation is ready for review.'
FROM users farmer
JOIN distributions distribution ON distribution.farmer_id = farmer.id
JOIN resources resource ON resource.id = distribution.resource_id
WHERE farmer.email = 'demo.farmer2@example.invalid'
  AND resource.name = '[DEMO] Organic fertilizer'
  AND resource.description = '[DEMO] Sample inventory'
  AND NOT EXISTS (
    SELECT 1
    FROM notifications existing
    WHERE existing.farmer_id = farmer.id
      AND existing.distribution_id = distribution.id
      AND existing.message = '[DEMO] A sample fertilizer allocation is ready for review.'
  );

COMMIT;