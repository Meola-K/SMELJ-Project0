import { Router } from 'express';
import db from '../db.js';
import { auth, role } from '../middleware/auth.js';

const router = Router();

router.post('/', auth, async (req, res) => {
    try {
        const { type, dateFrom, dateTo, note } = req.body;
        if (!type || !dateFrom || !dateTo) return res.status(400).json({ error: 'Typ und Datum erforderlich' });

        const validTypes = ['urlaub', 'gleitzeit', 'homeoffice', 'krank'];
        if (!validTypes.includes(type)) return res.status(400).json({ error: 'Ungültiger Antragstyp' });

        if (new Date(dateFrom) > new Date(dateTo)) return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });

        const [overlap] = await db.query(
            `SELECT id FROM requests WHERE user_id = ? AND status != 'denied'
             AND ((date_from BETWEEN ? AND ?) OR (date_to BETWEEN ? AND ?) OR (date_from <= ? AND date_to >= ?))`,
            [req.user.id, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]
        );
        if (overlap.length) return res.status(400).json({ error: 'Es gibt bereits einen Antrag in diesem Zeitraum' });

        const [result] = await db.query(
            'INSERT INTO requests (user_id, type, date_from, date_to, note) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, type, dateFrom, dateTo, note || null]
        );

        const io = req.app.get('io');
        if (io) {
            const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [req.user.id]);
            if (user[0]?.supervisor_id) {
                io.to(`user-${user[0].supervisor_id}`).emit('request:new', {
                    id: result.insertId,
                    userId: req.user.id,
                    userName: `${req.user.firstName} ${req.user.lastName}`,
                    type, dateFrom, dateTo
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
            `SELECT r.*, CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name
             FROM requests r LEFT JOIN users rv ON r.reviewed_by = rv.id
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
        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name, u.email
                     FROM requests r JOIN users u ON r.user_id = u.id
                     WHERE r.status = 'pending' ORDER BY r.created_at ASC`;
            params = [];
        } else {
            query = `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name, u.email
                     FROM requests r JOIN users u ON r.user_id = u.id
                     WHERE r.status = 'pending' AND u.supervisor_id = ? ORDER BY r.created_at ASC`;
            params = [req.user.id];
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
                     CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name
                     FROM requests r JOIN users u ON r.user_id = u.id
                     LEFT JOIN users rv ON r.reviewed_by = rv.id
                     ORDER BY r.created_at DESC LIMIT 100`;
            params = [];
        } else {
            query = `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) as user_name,
                     CONCAT(rv.first_name, ' ', rv.last_name) as reviewer_name
                     FROM requests r JOIN users u ON r.user_id = u.id
                     LEFT JOIN users rv ON r.reviewed_by = rv.id
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

        const [requests] = await db.query('SELECT * FROM requests WHERE id = ? AND status = "pending"', [req.params.id]);
        if (!requests.length) return res.status(404).json({ error: 'Antrag nicht gefunden oder bereits bearbeitet' });

        const request = requests[0];

        if (req.user.role === 'vorgesetzter') {
            const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [request.user_id]);
            if (user[0]?.supervisor_id !== req.user.id) {
                return res.status(403).json({ error: 'Nicht dein Mitarbeiter' });
            }
        }

        await db.query(
            'UPDATE requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
            [status, req.user.id, req.params.id]
        );

        const io = req.app.get('io');
        if (io) {
            io.to(`user-${request.user_id}`).emit('request:reviewed', {
                id: request.id, status, reviewerName: `${req.user.firstName} ${req.user.lastName}`
            });
        }

        res.json({ message: status === 'approved' ? 'Antrag genehmigt' : 'Antrag abgelehnt' });
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