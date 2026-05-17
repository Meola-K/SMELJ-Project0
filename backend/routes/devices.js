import { Router } from 'express';
import db from '../db.js';

const router = Router();

// SCRUM-295: GET /api/devices/:id/presence – Anwesenheitsliste für Frontdesk-Modus
// Wird vom ESP32 ohne Auth aufgerufen (wie /api/stamp/nfc). deviceId muss aktiv sein.
router.get('/:id/presence', async (req, res) => {
    try {
        const deviceId = req.params.id;

        // Gerät prüfen (last_seen aktualisieren). Unbekannte Geräte werden – analog zu
        // /api/stamp/nfc – automatisch angelegt, damit ein neues ESP32 nicht abgelehnt wird.
        const [devices] = await db.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
        if (!devices.length) {
            await db.query(
                'INSERT INTO devices (id, name, mode, active, last_seen) VALUES (?, ?, "stamp", 1, NOW())',
                [deviceId, deviceId]
            );
            return res.json({ mode: 'stamp', users: [] });
        }
        if (!devices[0].active) {
            return res.status(403).json({ error: 'Gerät deaktiviert' });
        }
        await db.query('UPDATE devices SET last_seen = NOW() WHERE id = ?', [deviceId]);

        const mode = devices[0].mode;

        const today = new Date().toISOString().split('T')[0];

        // Alle aktiven Mitarbeiter
        const [users] = await db.query(
            'SELECT id, first_name, last_name FROM users WHERE active = 1 ORDER BY last_name, first_name'
        );
        if (!users.length) {
            return res.json({ mode, users: [] });
        }

        // Letzter Stempel pro User (heute) – für anwesend/abwesend
        const [stamps] = await db.query(
            `SELECT user_id, type, stamp_time FROM timestamps_log
             WHERE DATE(stamp_time) = ?
             AND id IN (
                SELECT MAX(id) FROM timestamps_log WHERE DATE(stamp_time) = ? GROUP BY user_id
             )`,
            [today, today]
        );
        const lastByUser = new Map();
        for (const s of stamps) lastByUser.set(s.user_id, s);

        // Genehmigte Abwesenheiten, die heute fallen (Urlaub/Krank/HO/Sonderurlaub)
        const [absences] = await db.query(
            `SELECT user_id, type FROM requests
             WHERE status = 'approved' AND ? BETWEEN date_from AND date_to`,
            [today]
        );
        const absenceByUser = new Map();
        for (const a of absences) absenceByUser.set(a.user_id, a.type);

        const result = users.map(u => {
            const abs = absenceByUser.get(u.id);
            let status;
            if (abs === 'urlaub' || abs === 'sonderurlaub') status = 'urlaub';
            else if (abs === 'krank') status = 'krank';
            else if (abs === 'homeoffice') status = 'ho';
            else if (lastByUser.get(u.id)?.type === 'in') status = 'present';
            else status = 'absent';

            return {
                id: u.id,
                name: `${u.first_name} ${u.last_name}`,
                status
            };
        });

        // Sortierung: Anwesende zuerst, dann der Rest in alphabetischer Reihenfolge
        const order = { present: 0, ho: 1, urlaub: 2, krank: 3, absent: 4 };
        result.sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name));

        res.json({ mode, users: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;
