-- SCRUM-299 / SCRUM-304: 4-Augen-Prinzip für Abwesenheitsanträge
-- Erweitert den Status um 'first_approved' und ergänzt die Spalten für den ersten Genehmiger.
-- Auf einer bestehenden Datenbank EINMALIG ausführen.

USE zeitstempel;

ALTER TABLE requests
    MODIFY COLUMN status ENUM('pending','first_approved','approved','denied') DEFAULT 'pending',
    ADD COLUMN first_reviewed_by INT DEFAULT NULL AFTER status,
    ADD COLUMN first_reviewed_at DATETIME DEFAULT NULL AFTER first_reviewed_by,
    ADD CONSTRAINT fk_requests_first_reviewer FOREIGN KEY (first_reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Bestehende Anträge:
--   pending  -> bleiben pending und durchlaufen ab jetzt beide Stufen.
--   approved -> wurden im alten Einzel-Genehmigungs-System final freigegeben und bleiben approved.
--               reviewed_by/reviewed_at gelten als finale (zweite) Genehmigung;
--               first_reviewed_by bleibt NULL (Altbestand, nur einmal genehmigt).
--   denied   -> bleiben denied.
-- Es ist also keine Datenumwandlung nötig; das Schema-Update genügt.
