import { Router } from 'express';
import db from '../db.js';
import { auth, role } from '../middleware/auth.js';

const router = Router();

router.post('/', auth, async (req, res) => {
    try {
        const { type, dateFrom, dateTo, note, reason } = req.body;
        if (!type || !dateFrom || !dateTo) return res.status(400).json({ error: 'Typ und Datum erforderlich' });

        const validTypes = ['urlaub', 'gleitzeit', 'homeoffice', 'krank', 'sonderurlaub'];
        if (!validTypes.includes(type)) return res.status(400).json({ error: 'Ungültiger Antragstyp' });

        // Sonderurlaub: Anlass ist Pflicht, bei 'sonstiges' zusätzlich Freitext (note)
        const validReasons = ['hochzeit', 'geburt', 'trauerfall', 'umzug', 'sonstiges'];
        let reasonValue = null;
        if (type === 'sonderurlaub') {
            if (!reason || !validReasons.includes(reason)) {
                return res.status(400).json({ error: 'Bitte gültigen Anlass für Sonderurlaub wählen' });
            }
            if (reason === 'sonstiges' && (!note || !note.trim())) {
                return res.status(400).json({ error: 'Bei Anlass "Sonstiges" ist eine Begründung im Notizfeld erforderlich' });
            }
            reasonValue = reason;
        }

        if (new Date(dateFrom) > new Date(dateTo)) return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });

        const [overlap] = await db.query(
            `SELECT id FROM requests WHERE user_id = ? AND status != 'denied'
             AND ((date_from BETWEEN ? AND ?) OR (date_to BETWEEN ? AND ?) OR (date_from <= ? AND date_to >= ?))`,
            [req.user.id, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]
        );
        if (overlap.length) return res.status(400).json({ error: 'Es gibt bereits einen Antrag in diesem Zeitraum' });

        const [result] = await db.query(
            'INSERT INTO requests (user_id, type, date_from, date_to, note, reason) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, type, dateFrom, dateTo, note || null, reasonValue]
        );

        const io = req.app.get('io');
        if (io) {
            const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [req.user.id]);
            if (user[0]?.supervisor_id) {
                io.to(`user-${user[0].supervisor_id}`).emit('request:new', {
                    id: result.insertId,
                    userId: req.user.id,
                    userName: `${req.user.firstName} ${req.user.lastName}`,
                    type, dateFrom, dateTo, reason: reasonValue
                });
            }
        }

        res.json({ id: result.insertId, message: 'Antrag eingereicht' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/my', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT r.*, CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name,
                    CONCAT(fr.first_name, ' ', fr.last_name) as first_reviewer_name
             FROM requests r
             LEFT JOIN users rv ON r.reviewed_by = rv.id
             LEFT JOIN users fr ON r.first_reviewed_by = fr.id
             WHERE r.user_id = ? ORDER BY r.created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/pending', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const selectCols = `r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name, u.email,
                            CONCAT(fr.first_name, ' ', fr.last_name) as first_reviewer_name`;
        const joins = `FROM requests r JOIN users u ON r.user_id = u.id
                       LEFT JOIN users fr ON r.first_reviewed_by = fr.id`;

        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT ${selectCols} ${joins}
                     WHERE r.status = 'pending'
                        OR (r.status = 'first_approved' AND (r.first_reviewed_by IS NULL OR r.first_reviewed_by <> ?))
                     ORDER BY r.created_at ASC`;
            params = [req.user.id];
        } else {
            query = `SELECT ${selectCols} ${joins}
                     WHERE (r.status = 'pending' AND u.supervisor_id = ?)
                        OR (r.status = 'first_approved' AND r.first_reviewed_by <> ?)
                     ORDER BY r.created_at ASC`;
            params = [req.user.id, req.user.id];
        }
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/all', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name,
                     CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name,
                     CONCAT(fr.first_name, ' ', fr.last_name) as first_reviewer_name
                     FROM requests r JOIN users u ON r.user_id = u.id
                     LEFT JOIN users rv ON r.reviewed_by = rv.id
                     LEFT JOIN users fr ON r.first_reviewed_by = fr.id
                     ORDER BY r.created_at DESC LIMIT 100`;
            params = [];
        } else {
            query = `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name,
                     CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name,
                     CONCAT(fr.first_name, ' ', fr.last_name) as first_reviewer_name
                     FROM requests r JOIN users u ON r.user_id = u.id
                     LEFT JOIN users rv ON r.reviewed_by = rv.id
                     LEFT JOIN users fr ON r.first_reviewed_by = fr.id
                     WHERE u.supervisor_id = ? ORDER BY r.created_at DESC LIMIT 100`;
            params = [req.user.id];
        }
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/:id/review', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

        const [requests] = await db.query('SELECT * FROM requests WHERE id = ?', [req.params.id]);
        if (!requests.length) return res.status(404).json({ error: 'Antrag nicht gefunden' });

        const request = requests[0];
        if (!['pending', 'first_approved'].includes(request.status)) {
            return res.status(409).json({ error: 'Antrag wurde bereits abgeschlossen' });
        }

        const reviewerName = `${req.user.firstName} ${req.user.lastName}`;
        const io = req.app.get('io');

        if (request.status === 'pending') {
            if (req.user.role === 'vorgesetzter') {
                const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [request.user_id]);
                if (user[0]?.supervisor_id !== req.user.id) {
                    return res.status(403).json({ error: 'Nicht dein Mitarbeiter' });
                }
            }

            if (status === 'denied') {
                const [r] = await db.query(
                    "UPDATE requests SET status = 'denied', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
                    [req.user.id, request.id]
                );
                if (!r.affectedRows) return res.status(409).json({ error: 'Antrag wurde bereits abgeschlossen' });
                if (io) io.to(`user-${request.user_id}`).emit('request:reviewed', { id: request.id, status: 'denied', stage: 'first', reviewerName });
                return res.json({ message: 'Antrag abgelehnt' });
            }

            const [r] = await db.query(
                "UPDATE requests SET status = 'first_approved', first_reviewed_by = ?, first_reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
                [req.user.id, request.id]
            );
            if (!r.affectedRows) return res.status(409).json({ error: 'Antrag wurde bereits abgeschlossen' });

            if (io) {
                io.to(`user-${request.user_id}`).emit('request:reviewed', { id: request.id, status: 'first_approved', stage: 'first', reviewerName });
                io.to('admins').to('supervisors').emit('request:awaiting_second', { id: request.id, firstReviewerId: req.user.id });
            }
            return res.json({ message: 'Erste Genehmigung erteilt – wartet auf zweite Freigabe' });
        }

        if (request.first_reviewed_by === req.user.id) {
            return res.status(403).json({ error: 'Du hast diesen Antrag bereits in der ersten Stufe bearbeitet' });
        }

        if (status === 'denied') {
            const [r] = await db.query(
                "UPDATE requests SET status = 'denied', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'first_approved' AND first_reviewed_by <> ?",
                [req.user.id, request.id, req.user.id]
            );
            if (!r.affectedRows) return res.status(409).json({ error: 'Antrag wurde bereits abgeschlossen' });
            if (io) io.to(`user-${request.user_id}`).emit('request:reviewed', { id: request.id, status: 'denied', stage: 'final', reviewerName });
            return res.json({ message: 'Antrag abgelehnt' });
        }

        const [r] = await db.query(
            "UPDATE requests SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'first_approved' AND first_reviewed_by <> ?",
            [req.user.id, request.id, req.user.id]
        );
        if (!r.affectedRows) return res.status(409).json({ error: 'Antrag wurde bereits abgeschlossen' });
        if (io) io.to(`user-${request.user_id}`).emit('request:reviewed', { id: request.id, status: 'approved', stage: 'final', reviewerName });
        return res.json({ message: 'Antrag endgültig genehmigt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/:id', auth, async (req, res) => {
    try {
        const [requests] = await db.query('SELECT * FROM requests WHERE id = ? AND user_id = ? AND status = "pending"', [req.params.id, req.user.id]);
        if (!requests.length) return res.status(404).json({ error: 'Antrag nicht gefunden oder nicht stornierbar' });

        await db.query('DELETE FROM requests WHERE id = ?', [req.params.id]);
        res.json({ message: 'Antrag zurückgezogen' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;