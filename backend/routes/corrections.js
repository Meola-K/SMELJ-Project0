import { Router } from 'express';
import db from '../db.js';
import { auth } from '../middleware/auth.js';

const router = Router();

// Hilfsfunktion: ISO-DateTime (lokal) validieren – akzeptiert "YYYY-MM-DDTHH:MM" oder mit Sekunden
function parseLocalDateTime(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

// SCRUM-159: POST /api/corrections – Korrekturantrag einreichen
router.post('/', auth, async (req, res) => {
    try {
        const { stampId, type, correctedTime, stampType, reason } = req.body;

        if (!type || !reason || !reason.trim()) {
            return res.status(400).json({ error: 'Typ und Begründung erforderlich' });
        }
        if (!['add', 'edit', 'delete'].includes(type)) {
            return res.status(400).json({ error: 'Ungültiger Korrekturtyp' });
        }

        const reasonTrimmed = reason.trim();
        if (reasonTrimmed.length < 5) {
            return res.status(400).json({ error: 'Begründung zu kurz (min. 5 Zeichen)' });
        }
        if (reasonTrimmed.length > 500) {
            return res.status(400).json({ error: 'Begründung zu lang (max. 500 Zeichen)' });
        }

        let originalTime = null;
        let correctedDt = null;
        let stampTypeValue = null;

        if (type === 'add') {
            if (!stampType || !['in', 'out'].includes(stampType)) {
                return res.status(400).json({ error: 'Stempeltyp (in/out) erforderlich' });
            }
            correctedDt = parseLocalDateTime(correctedTime);
            if (!correctedDt) {
                return res.status(400).json({ error: 'Gültige Stempelzeit erforderlich' });
            }
            if (correctedDt > new Date()) {
                return res.status(400).json({ error: 'Stempelzeit darf nicht in der Zukunft liegen' });
            }
            stampTypeValue = stampType;
        }

        if (type === 'edit') {
            if (!stampId) return res.status(400).json({ error: 'Stempel-ID erforderlich' });
            correctedDt = parseLocalDateTime(correctedTime);
            if (!correctedDt) {
                return res.status(400).json({ error: 'Gültige neue Stempelzeit erforderlich' });
            }
            if (correctedDt > new Date()) {
                return res.status(400).json({ error: 'Stempelzeit darf nicht in der Zukunft liegen' });
            }
            const [stamp] = await db.query(
                'SELECT stamp_time, type FROM timestamps_log WHERE id = ? AND user_id = ?',
                [stampId, req.user.id]
            );
            if (!stamp.length) return res.status(404).json({ error: 'Stempel nicht gefunden' });
            originalTime = stamp[0].stamp_time;
            stampTypeValue = stamp[0].type;
        }

        if (type === 'delete') {
            if (!stampId) return res.status(400).json({ error: 'Stempel-ID erforderlich' });
            const [stamp] = await db.query(
                'SELECT stamp_time, type FROM timestamps_log WHERE id = ? AND user_id = ?',
                [stampId, req.user.id]
            );
            if (!stamp.length) return res.status(404).json({ error: 'Stempel nicht gefunden' });
            originalTime = stamp[0].stamp_time;
            stampTypeValue = stamp[0].type;
        }

        // Doppelte offene Anträge auf denselben Stempel verhindern
        if (stampId) {
            const [dup] = await db.query(
                'SELECT id FROM corrections WHERE user_id = ? AND stamp_id = ? AND status = "pending"',
                [req.user.id, stampId]
            );
            if (dup.length) {
                return res.status(400).json({ error: 'Es existiert bereits ein offener Antrag für diesen Stempel' });
            }
        }

        const [result] = await db.query(
            `INSERT INTO corrections
             (user_id, stamp_id, type, original_time, corrected_time, stamp_type, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, stampId || null, type, originalTime, correctedDt, stampTypeValue, reasonTrimmed]
        );

        const io = req.app.get('io');
        if (io) {
            const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [req.user.id]);
            const payload = {
                id: result.insertId,
                userId: req.user.id,
                userName: `${req.user.firstName} ${req.user.lastName}`,
                type
            };
            if (user[0]?.supervisor_id) {
                io.to(`user-${user[0].supervisor_id}`).emit('correction:new', payload);
            }
            io.to('admins').emit('correction:new', payload);
        }

        res.json({ id: result.insertId, message: 'Korrekturantrag eingereicht' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// SCRUM-160: GET /api/corrections/my – eigene Korrekturanträge abrufen
router.get('/my', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT c.id, c.stamp_id, c.type, c.original_time, c.corrected_time,
                    c.stamp_type, c.reason, c.status, c.reviewed_at, c.created_at,
                    CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name
             FROM corrections c
             LEFT JOIN users rv ON c.reviewed_by = rv.id
             WHERE c.user_id = ?
             ORDER BY c.created_at DESC
             LIMIT 100`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// DELETE /api/corrections/:id – eigene Pending-Korrektur zurückziehen
router.delete('/:id', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id FROM corrections WHERE id = ? AND user_id = ? AND status = "pending"',
            [req.params.id, req.user.id]
        );
        if (!rows.length) {
            return res.status(404).json({ error: 'Korrektur nicht gefunden oder nicht stornierbar' });
        }
        await db.query('DELETE FROM corrections WHERE id = ?', [req.params.id]);
        res.json({ message: 'Korrekturantrag zurückgezogen' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;
