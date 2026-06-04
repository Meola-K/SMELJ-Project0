-- SCRUM-304: Migration 4-Augen-Prinzip für bestehende Datenbanken.
-- Auf einer frischen Installation nicht nötig (db.sql enthält das Schema bereits).
USE zeitstempel;

ALTER TABLE requests
    MODIFY COLUMN status ENUM('pending','first_approved','approved','denied') DEFAULT 'pending',
    ADD COLUMN first_reviewed_by INT DEFAULT NULL AFTER reason,
    ADD COLUMN first_reviewed_at DATETIME DEFAULT NULL AFTER first_reviewed_by,
    ADD CONSTRAINT fk_requests_first_reviewer FOREIGN KEY (first_reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Bestehende Anträge:
-- 'pending' durchlaufen ab jetzt automatisch beide Stufen, keine Anpassung nötig.
-- 'approved'/'denied' bleiben terminal. Die historische Einzelfreigabe steht in reviewed_by;
-- first_reviewed_by bleibt bei diesen Altdatensätzen bewusst NULL (es gab keine zweite Stufe).
