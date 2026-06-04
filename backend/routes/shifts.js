import { Router } from 'express';
import db from '../db.js';
import { auth, role } from '../middleware/auth.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BLOCKING_TYPES = ['urlaub', 'krank', 'sonderurlaub'];
const ABSENCE_LABEL = { urlaub: 'Urlaub', krank: 'Krank', sonderurlaub: 'Sonderurlaub' };

function isValidDate(s) {
    if (!DATE_RE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// work_rules.weekday: Montag=0 .. Sonntag=6 (JS getUTCDay: Sonntag=0 .. Samstag=6)
function appWeekday(dateStr) {
    return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function dateOnly(v) {
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

// Liefert pro betroffenem User+Datum den Grund, warum er nicht arbeiten kann (oder undefined).
async function buildUnavailability(userIds, dateStrings) {
    if (!userIds.length) return { absence: [], blockedWeekdays: new Map() };
    const ph = userIds.map(() => '?').join(',');
    const minDate = dateStrings.reduce((a, b) => (a < b ? a : b));
    const maxDate = dateStrings.reduce((a, b) => (a > b ? a : b));

    const [absence] = await db.query(
        `SELECT user_id, type, date_from, date_to FROM requests
         WHERE status = 'approved' AND type IN ('urlaub','krank','sonderurlaub')
           AND user_id IN (${ph}) AND date_from <= ? AND date_to >= ?`,
        [...userIds, maxDate, minDate]
    );
    const [rules] = await db.query(
        `SELECT user_id, weekday FROM work_rules WHERE work_allowed = 0 AND user_id IN (${ph})`,
        userIds
    );
    const blockedWeekdays = new Map();
    for (const r of rules) blockedWeekdays.set(`${r.user_id}:${r.weekday}`, true);
    return { absence, blockedWeekdays };
}

function reasonFor(userId, dateStr, unavail) {
    for (const a of unavail.absence) {
        if (a.user_id === userId && dateOnly(a.date_from) <= dateStr && dateOnly(a.date_to) >= dateStr) {
            return ABSENCE_LABEL[a.type] || a.type;
        }
    }
    if (unavail.blockedWeekdays.has(`${userId}:${appWeekday(dateStr)}`)) return 'darf an diesem Wochentag nicht arbeiten';
    return null;
}

// ── Planung (Vorgesetzter / Admin) ────────────────────────────────────────────

router.post('/', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const { title, date, startTime, endTime, groupId, minStaff } = req.body;
        if (!isValidDate(date)) return res.status(400).json({ error: 'Ungültiges Datum' });
        if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return res.status(400).json({ error: 'Ungültige Uhrzeit' });
        if (endTime <= startTime) return res.status(400).json({ error: 'Ende muss nach dem Start liegen' });

        const min = Math.min(999, Math.max(0, parseInt(minStaff) || 0));
        let group = null;
        if (groupId) {
            const [g] = await db.query('SELECT id FROM groups_table WHERE id = ?', [parseInt(groupId)]);
            if (!g.length) return res.status(400).json({ error: 'Gruppe nicht gefunden' });
            group = g[0].id;
        }

        const [result] = await db.query(
            `INSERT INTO shifts (title, shift_date, start_time, end_time, group_id, min_staff, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [title?.trim() || null, date, `${startTime}:00`, `${endTime}:00`, group, min, req.user.id]
        );
        res.json({ id: result.insertId, message: 'Schicht erstellt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/plan', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!isValidDate(from) || !isValidDate(to)) return res.status(400).json({ error: 'Zeitraum erforderlich' });
        if (to < from) return res.status(400).json({ error: 'Ungültiger Zeitraum' });

        let shiftQuery = `SELECT s.*, g.name as group_name FROM shifts s
                          LEFT JOIN groups_table g ON s.group_id = g.id
                          WHERE s.shift_date BETWEEN ? AND ?`;
        const params = [from, to];
        if (req.user.role === 'vorgesetzter') { shiftQuery += ' AND s.created_by = ?'; params.push(req.user.id); }
        shiftQuery += ' ORDER BY s.shift_date, s.start_time';

        const [shifts] = await db.query(shiftQuery, params);
        if (!shifts.length) return res.json([]);

        const shiftIds = shifts.map(s => s.id);
        const [assigns] = await db.query(
            `SELECT sa.id as assignment_id, sa.shift_id, sa.user_id, CONCAT(u.first_name,' ',u.last_name) as name
             FROM shift_assignments sa JOIN users u ON sa.user_id = u.id
             WHERE sa.shift_id IN (${shiftIds.map(() => '?').join(',')}) ORDER BY u.last_name`,
            shiftIds
        );

        const userIds = [...new Set(assigns.map(a => a.user_id))];
        const dates = [...new Set(shifts.map(s => dateOnly(s.shift_date)))];
        const unavail = await buildUnavailability(userIds, dates);

        const byShift = new Map();
        for (const s of shifts) byShift.set(s.id, []);
        for (const a of assigns) {
            const dateStr = dateOnly(shifts.find(s => s.id === a.shift_id).shift_date);
            byShift.get(a.shift_id).push({ ...a, unavailable: reasonFor(a.user_id, dateStr, unavail) });
        }

        const out = shifts.map(s => {
            const list = byShift.get(s.id);
            const warnings = [];
            if (list.length < s.min_staff) warnings.push(`Unterbesetzt (${list.length}/${s.min_staff})`);
            for (const a of list) if (a.unavailable) warnings.push(`${a.name}: ${a.unavailable}`);
            return {
                id: s.id, title: s.title, shift_date: dateOnly(s.shift_date),
                start_time: String(s.start_time).slice(0, 5), end_time: String(s.end_time).slice(0, 5),
                group_id: s.group_id, group_name: s.group_name, min_staff: s.min_staff,
                assigned_count: list.length, understaffed: list.length < s.min_staff,
                assignments: list, warnings
            };
        });
        res.json(out);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/:id', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const [s] = await db.query('SELECT created_by FROM shifts WHERE id = ?', [parseInt(req.params.id)]);
        if (!s.length) return res.status(404).json({ error: 'Schicht nicht gefunden' });
        if (req.user.role === 'vorgesetzter' && s[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }
        await db.query('DELETE FROM shifts WHERE id = ?', [parseInt(req.params.id)]);
        res.json({ message: 'Schicht gelöscht' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/:id/assign', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const shiftId = parseInt(req.params.id);
        const userId = parseInt(req.body.userId);
        if (!userId) return res.status(400).json({ error: 'Mitarbeiter erforderlich' });

        const [s] = await db.query('SELECT shift_date, created_by FROM shifts WHERE id = ?', [shiftId]);
        if (!s.length) return res.status(404).json({ error: 'Schicht nicht gefunden' });
        if (req.user.role === 'vorgesetzter' && s[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }

        const [u] = await db.query('SELECT supervisor_id, active FROM users WHERE id = ?', [userId]);
        if (!u.length || !u[0].active) return res.status(400).json({ error: 'Mitarbeiter nicht verfügbar' });
        if (req.user.role === 'vorgesetzter' && u[0].supervisor_id !== req.user.id) {
            return res.status(403).json({ error: 'Nicht dein Mitarbeiter' });
        }

        try {
            await db.query('INSERT INTO shift_assignments (shift_id, user_id) VALUES (?, ?)', [shiftId, userId]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Bereits eingeplant' });
            throw e;
        }

        const dateStr = dateOnly(s[0].shift_date);
        const unavail = await buildUnavailability([userId], [dateStr]);
        const warning = reasonFor(userId, dateStr, unavail);

        const io = req.app.get('io');
        if (io) io.to(`user-${userId}`).emit('shift:assigned', { shiftId });
        res.json({ message: 'Mitarbeiter eingeplant', warning });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/:id/assign/:userId', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const shiftId = parseInt(req.params.id);
        const [s] = await db.query('SELECT created_by FROM shifts WHERE id = ?', [shiftId]);
        if (!s.length) return res.status(404).json({ error: 'Schicht nicht gefunden' });
        if (req.user.role === 'vorgesetzter' && s[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }
        await db.query('DELETE FROM shift_assignments WHERE shift_id = ? AND user_id = ?', [shiftId, parseInt(req.params.userId)]);
        res.json({ message: 'Zuweisung entfernt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// ── Mitarbeiter-Ansicht (alle Rollen) ─────────────────────────────────────────

router.get('/my', auth, async (req, res) => {
    try {
        const from = isValidDate(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10);
        let to = req.query.to;
        if (!isValidDate(to)) {
            const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30);
            to = d.toISOString().slice(0, 10);
        }
        const [rows] = await db.query(
            `SELECT s.id, s.title, s.shift_date, s.start_time, s.end_time, g.name as group_name,
                    sa.id as assignment_id,
                    sw.id as swap_id, sw.status as swap_status,
                    CONCAT(tu.first_name,' ',tu.last_name) as swap_to_name
             FROM shift_assignments sa
             JOIN shifts s ON sa.shift_id = s.id
             LEFT JOIN groups_table g ON s.group_id = g.id
             LEFT JOIN shift_swaps sw ON sw.assignment_id = sa.id AND sw.status IN ('pending','accepted')
             LEFT JOIN users tu ON sw.to_user_id = tu.id
             WHERE sa.user_id = ? AND s.shift_date BETWEEN ? AND ?
             ORDER BY s.shift_date, s.start_time`,
            [req.user.id, from, to]
        );
        res.json(rows.map(r => ({
            ...r, shift_date: dateOnly(r.shift_date),
            start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5)
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Kollegen, denen man eine Schicht anbieten kann (gleiche Gruppe oder gleicher Vorgesetzter).
router.get('/colleagues', auth, async (req, res) => {
    try {
        const shiftId = parseInt(req.query.shiftId);
        if (!shiftId) return res.status(400).json({ error: 'Schicht erforderlich' });

        const [own] = await db.query(
            'SELECT id FROM shift_assignments WHERE shift_id = ? AND user_id = ?', [shiftId, req.user.id]
        );
        if (!own.length) return res.status(403).json({ error: 'Du bist dieser Schicht nicht zugewiesen' });

        const [s] = await db.query('SELECT shift_date FROM shifts WHERE id = ?', [shiftId]);
        const dateStr = dateOnly(s[0].shift_date);

        const [me] = await db.query('SELECT group_id, supervisor_id FROM users WHERE id = ?', [req.user.id]);
        const { group_id, supervisor_id } = me[0];
        if (!group_id && !supervisor_id) return res.json([]);

        const [users] = await db.query(
            `SELECT id, CONCAT(first_name,' ',last_name) as name FROM users
             WHERE active = 1 AND id <> ?
               AND (${group_id ? 'group_id = ?' : '0'} OR ${supervisor_id ? 'supervisor_id = ?' : '0'})
               AND id NOT IN (SELECT user_id FROM shift_assignments WHERE shift_id = ?)
             ORDER BY last_name`,
            [
                req.user.id,
                ...(group_id ? [group_id] : []),
                ...(supervisor_id ? [supervisor_id] : []),
                shiftId
            ]
        );

        const ids = users.map(u => u.id);
        const unavail = await buildUnavailability(ids, [dateStr]);
        res.json(users.filter(u => !reasonFor(u.id, dateStr, unavail)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/swaps', auth, async (req, res) => {
    try {
        const assignmentId = parseInt(req.body.assignmentId);
        const toUserId = parseInt(req.body.toUserId);
        if (!assignmentId || !toUserId) return res.status(400).json({ error: 'Schicht und Kollege erforderlich' });
        if (toUserId === req.user.id) return res.status(400).json({ error: 'Tausch mit sich selbst nicht möglich' });

        const [a] = await db.query(
            `SELECT sa.id, sa.shift_id, sa.user_id, s.shift_date FROM shift_assignments sa
             JOIN shifts s ON sa.shift_id = s.id WHERE sa.id = ?`, [assignmentId]
        );
        if (!a.length || a[0].user_id !== req.user.id) return res.status(403).json({ error: 'Nicht deine Schicht' });

        const [open] = await db.query(
            "SELECT id FROM shift_swaps WHERE assignment_id = ? AND status IN ('pending','accepted')", [assignmentId]
        );
        if (open.length) return res.status(400).json({ error: 'Für diese Schicht läuft bereits eine Tauschanfrage' });

        const [target] = await db.query('SELECT active, group_id, supervisor_id FROM users WHERE id = ?', [toUserId]);
        if (!target.length || !target[0].active) return res.status(400).json({ error: 'Kollege nicht verfügbar' });

        const [me] = await db.query('SELECT group_id, supervisor_id FROM users WHERE id = ?', [req.user.id]);
        const sameTeam = (me[0].group_id && me[0].group_id === target[0].group_id)
            || (me[0].supervisor_id && me[0].supervisor_id === target[0].supervisor_id);
        if (!sameTeam) return res.status(400).json({ error: 'Kollege ist nicht im selben Team' });

        const [dup] = await db.query('SELECT id FROM shift_assignments WHERE shift_id = ? AND user_id = ?', [a[0].shift_id, toUserId]);
        if (dup.length) return res.status(400).json({ error: 'Kollege ist bereits dieser Schicht zugewiesen' });

        const dateStr = dateOnly(a[0].shift_date);
        const unavail = await buildUnavailability([toUserId], [dateStr]);
        if (reasonFor(toUserId, dateStr, unavail)) return res.status(400).json({ error: 'Kollege kann an diesem Tag nicht arbeiten' });

        const [result] = await db.query(
            'INSERT INTO shift_swaps (assignment_id, from_user_id, to_user_id) VALUES (?, ?, ?)',
            [assignmentId, req.user.id, toUserId]
        );
        const io = req.app.get('io');
        if (io) io.to(`user-${toUserId}`).emit('swap:incoming', { id: result.insertId });
        res.json({ id: result.insertId, message: 'Tausch angeboten' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/swaps/incoming', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT sw.id, sw.status, s.title, s.shift_date, s.start_time, s.end_time,
                    CONCAT(fu.first_name,' ',fu.last_name) as from_name
             FROM shift_swaps sw
             JOIN shift_assignments sa ON sw.assignment_id = sa.id
             JOIN shifts s ON sa.shift_id = s.id
             JOIN users fu ON sw.from_user_id = fu.id
             WHERE sw.to_user_id = ? AND sw.status = 'pending'
             ORDER BY s.shift_date`,
            [req.user.id]
        );
        res.json(rows.map(r => ({
            ...r, shift_date: dateOnly(r.shift_date),
            start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5)
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/swaps/outgoing', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT sw.id, sw.status, s.title, s.shift_date,
                    CONCAT(tu.first_name,' ',tu.last_name) as to_name
             FROM shift_swaps sw
             JOIN shift_assignments sa ON sw.assignment_id = sa.id
             JOIN shifts s ON sa.shift_id = s.id
             JOIN users tu ON sw.to_user_id = tu.id
             WHERE sw.from_user_id = ?
             ORDER BY sw.created_at DESC LIMIT 30`,
            [req.user.id]
        );
        res.json(rows.map(r => ({ ...r, shift_date: dateOnly(r.shift_date) })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/swaps/:id/respond', auth, async (req, res) => {
    try {
        const accept = req.body.accept === true;
        const [sw] = await db.query("SELECT * FROM shift_swaps WHERE id = ? AND status = 'pending'", [parseInt(req.params.id)]);
        if (!sw.length || sw[0].to_user_id !== req.user.id) return res.status(404).json({ error: 'Anfrage nicht gefunden' });

        const newStatus = accept ? 'accepted' : 'rejected';
        await db.query('UPDATE shift_swaps SET status = ? WHERE id = ?', [newStatus, sw[0].id]);

        const io = req.app.get('io');
        if (io) {
            io.to(`user-${sw[0].from_user_id}`).emit('swap:responded', { id: sw[0].id, accepted: accept });
            if (accept) io.to('admins').to('supervisors').emit('swap:needsReview', { id: sw[0].id });
        }
        res.json({ message: accept ? 'Tausch angenommen – wartet auf Freigabe' : 'Tausch abgelehnt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/swaps/:id/cancel', auth, async (req, res) => {
    try {
        const [sw] = await db.query(
            "SELECT * FROM shift_swaps WHERE id = ? AND status IN ('pending','accepted')", [parseInt(req.params.id)]
        );
        if (!sw.length || sw[0].from_user_id !== req.user.id) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
        await db.query("UPDATE shift_swaps SET status = 'cancelled' WHERE id = ?", [sw[0].id]);
        const io = req.app.get('io');
        if (io) io.to(`user-${sw[0].to_user_id}`).emit('swap:cancelled', { id: sw[0].id });
        res.json({ message: 'Tauschanfrage zurückgezogen' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// ── Tausch-Freigabe (Vorgesetzter / Admin) ────────────────────────────────────

router.get('/swaps/review', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        let query = `SELECT sw.id, s.title, s.shift_date, s.start_time, s.end_time,
                            CONCAT(fu.first_name,' ',fu.last_name) as from_name,
                            CONCAT(tu.first_name,' ',tu.last_name) as to_name
                     FROM shift_swaps sw
                     JOIN shift_assignments sa ON sw.assignment_id = sa.id
                     JOIN shifts s ON sa.shift_id = s.id
                     JOIN users fu ON sw.from_user_id = fu.id
                     JOIN users tu ON sw.to_user_id = tu.id
                     WHERE sw.status = 'accepted'`;
        const params = [];
        if (req.user.role === 'vorgesetzter') {
            query += ' AND (fu.supervisor_id = ? OR tu.supervisor_id = ?)';
            params.push(req.user.id, req.user.id);
        }
        query += ' ORDER BY s.shift_date';
        const [rows] = await db.query(query, params);
        res.json(rows.map(r => ({
            ...r, shift_date: dateOnly(r.shift_date),
            start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5)
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/swaps/:id/review', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    const approve = req.body.approve === true;
    const conn = await db.getConnection();
    try {
        const [sw] = await conn.query(
            `SELECT sw.*, sa.shift_id, s.shift_date,
                    fu.supervisor_id as from_sup, tu.supervisor_id as to_sup
             FROM shift_swaps sw
             JOIN shift_assignments sa ON sw.assignment_id = sa.id
             JOIN shifts s ON sa.shift_id = s.id
             JOIN users fu ON sw.from_user_id = fu.id
             JOIN users tu ON sw.to_user_id = tu.id
             WHERE sw.id = ? AND sw.status = 'accepted'`,
            [parseInt(req.params.id)]
        );
        if (!sw.length) { conn.release(); return res.status(404).json({ error: 'Anfrage nicht gefunden' }); }
        const swap = sw[0];
        if (req.user.role === 'vorgesetzter' && swap.from_sup !== req.user.id && swap.to_sup !== req.user.id) {
            conn.release();
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }

        if (!approve) {
            await conn.query("UPDATE shift_swaps SET status = 'denied', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [req.user.id, swap.id]);
            conn.release();
            const io = req.app.get('io');
            if (io) { io.to(`user-${swap.from_user_id}`).emit('swap:reviewed', { approved: false }); io.to(`user-${swap.to_user_id}`).emit('swap:reviewed', { approved: false }); }
            return res.json({ message: 'Tausch abgelehnt' });
        }

        const dateStr = dateOnly(swap.shift_date);
        const unavail = await buildUnavailability([swap.to_user_id], [dateStr]);
        if (reasonFor(swap.to_user_id, dateStr, unavail)) {
            conn.release();
            return res.status(400).json({ error: 'Kollege kann an diesem Tag nicht mehr arbeiten' });
        }
        const [dup] = await conn.query(
            'SELECT id FROM shift_assignments WHERE shift_id = ? AND user_id = ? AND id <> ?',
            [swap.shift_id, swap.to_user_id, swap.assignment_id]
        );
        if (dup.length) { conn.release(); return res.status(400).json({ error: 'Kollege ist bereits dieser Schicht zugewiesen' }); }

        await conn.beginTransaction();
        await conn.query('UPDATE shift_assignments SET user_id = ? WHERE id = ?', [swap.to_user_id, swap.assignment_id]);
        await conn.query("UPDATE shift_swaps SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [req.user.id, swap.id]);
        await conn.query(
            "UPDATE shift_swaps SET status = 'cancelled' WHERE assignment_id = ? AND status IN ('pending','accepted') AND id <> ?",
            [swap.assignment_id, swap.id]
        );
        await conn.commit();
        conn.release();

        const io = req.app.get('io');
        if (io) { io.to(`user-${swap.from_user_id}`).emit('swap:reviewed', { approved: true }); io.to(`user-${swap.to_user_id}`).emit('swap:reviewed', { approved: true }); }
        res.json({ message: 'Tausch genehmigt' });
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;
