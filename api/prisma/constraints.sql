-- Run after migrations: npm run db:constraints
-- A doctor can never have two live appointments starting at the same time.
-- Cancelled / expired / no-show appointments free the slot again.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_no_double_booking
  ON appointments ("doctorId", "startsAt")
  WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_rating_range;
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
