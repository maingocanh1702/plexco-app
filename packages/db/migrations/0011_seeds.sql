-- ============================================================================
-- 0011_seeds.sql
-- Reference/seed data: sports (DD-08 starter list) + plan catalog v1 (DD-03).
-- Idempotent via ON CONFLICT.
-- ============================================================================

-- ---- Sports (starter list; DD-08 still open, extend freely) ----------------
INSERT INTO sports (key, name, active) VALUES
  ('badminton',  'Cầu lông',   true),
  ('pickleball', 'Pickleball', true),
  ('tennis',     'Tennis',     true),
  ('football',   'Bóng đá',    true),
  ('volleyball', 'Bóng chuyền',true),
  ('basketball', 'Bóng rổ',    true)
ON CONFLICT (key) DO NOTHING;

-- ---- Plan catalog v1 (DD-03 pricing, VND/month per club) -------------------
INSERT INTO plans (plan_key, version, price, limits, entitlements) VALUES
  ('free_web',     1,      0, '{}', '{"web_app": true, "telegram": false, "zalo": false, "messenger": false}'),
  ('telegram',     1,  79000, '{}', '{"web_app": true, "telegram": true,  "zalo": false, "messenger": false}'),
  ('plus_channel', 1, 159000, '{}', '{"web_app": true, "telegram": true,  "extra_channel_count": 1, "extra_channel_options": ["zalo", "messenger"]}'),
  ('all_channels', 1, 199000, '{}', '{"web_app": true, "telegram": true,  "zalo": true,  "messenger": true}')
ON CONFLICT (plan_key, version) DO NOTHING;
