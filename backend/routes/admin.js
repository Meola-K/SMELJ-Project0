import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../db.js';
import { auth, role } from '../middleware/auth.js';

const router = Router();

// Users
router.get('/users', auth, role('admin', 'vorgesetzter'), async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.group_id, u.supervisor_id,
                     u.nfc_uid, u.active, u.created_at, g.name as group_name,
                     CONCAT(s.first_name, ' ', s.last_name) as supervisor_name
                     FROM users u LEFT JOIN groups_table g ON u.group_id = g.id
                     LEFT JOIN users s ON u.supervisor_id = s.id ORDER BY u.last_name`;
            params = [];
        } else {
            query = `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.group_id,
                     u.nfc_uid, u.active, g.name as group_name
                     FROM users u LEFT JOIN groups_table g ON u.group_id = g.id
                     WHERE u.supervisor_id = ? ORDER BY u.last_name`;
            params = [req.user.id];
        }
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/users', auth, role('admin'), async (req, res) => {
    try {
        const { email, password, firstName, lastName, role: userRole, supervisorId, groupId } = req.body;
        if (!email || !password || !firstName || !lastName) return res.status(400).json({ error: 'Alle Pflichtfelder ausfüllen' });
        if (password.length < 6) return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });

        const validRoles = ['admin', 'vorgesetzter', 'arbeiter'];
        if (userRole && !validRoles.includes(userRole)) return res.status(400).json({ error: 'Ungültige Rolle' });

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length) return res.status(400).json({ error: 'Email bereits vergeben' });

        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (email, password, first_name, last_name, role, supervisor_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, hash, firstName, lastName, userRole || 'arbeiter', supervisorId || null, groupId || null]
        );

        await db.query(
            'INSERT INTO time_limits (user_id) VALUES (?)', [result.insertId]
        );

        const weekdays = [0, 1, 2, 3, 4];
        for (const day of weekdays) {
            await db.query(
                'INSERT INTO work_rules (user_id, weekday, core_start, core_end, max_daily_minutes, work_allowed) VALUES (?, ?, ?, ?, ?, ?)',
                [result.insertId, day, day < 4 ? '09:00:00' : '09:00:00', day < 4 ? '15:00:00' : '14:00:00', 480, 1]
            );
        }
        for (const day of [5, 6]) {
            await db.query(
                'INSERT INTO work_rules (user_id, weekday, core_start, core_end, max_daily_minutes, work_allowed) VALUES (?, ?, NULL, NULL, 0, 0)',
                [result.insertId, day]
            );
        }

        res.json({ id: result.insertId, message: 'Benutzer erstellt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/users/:id', auth, role('admin'), async (req, res) => {
    try {
        const { email, firstName, lastName, role: userRole, supervisorId, groupId, active, password } = req.body;
        const userId = parseInt(req.params.id);

        if (email) {
            const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
            if (existing.length) return res.status(400).json({ error: 'Email bereits vergeben' });
        }

        let query = 'UPDATE users SET';
        const fields = [];
        const params = [];

        if (email) { fields.push(' email = ?'); params.push(email); }
        if (firstName) { fields.push(' first_name = ?'); params.push(firstName); }
        if (lastName) { fields.push(' last_name = ?'); params.push(lastName); }
        if (userRole) { fields.push(' role = ?'); params.push(userRole); }
        if (supervisorId !== undefined) { fields.push(' supervisor_id = ?'); params.push(supervisorId || null); }
        if (groupId !== undefined) { fields.push(' group_id = ?'); params.push(groupId || null); }
        if (active !== undefined) { fields.push(' active = ?'); params.push(active ? 1 : 0); }

        if (password) {
            if (password.length < 6) return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });
            const hash = await bcrypt.hash(password, 10);
            fields.push(' password = ?');
            params.push(hash);
        }

        if (!fields.length) return res.status(400).json({ error: 'Keine Änderungen' });

        query += fields.join(',') + ' WHERE id = ?';
        params.push(userId);
        await db.query(query, params);

        res.json({ message: 'Benutzer aktualisiert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/users/:id', auth, role('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (userId === req.user.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
        await db.query('UPDATE users SET active = 0 WHERE id = ?', [userId]);
        res.json({ message: 'Benutzer deaktiviert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Groups
router.get('/groups', auth, role('admin'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT g.*, COUNT(u.id) as member_count FROM groups_table g
             LEFT JOIN users u ON u.group_id = g.id AND u.active = 1
             GROUP BY g.id ORDER BY g.name`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/groups', auth, role('admin'), async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name erforderlich' });
        const [result] = await db.query('INSERT INTO groups_table (name) VALUES (?)', [name]);
        res.json({ id: result.insertId, message: 'Gruppe erstellt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/groups/:id', auth, role('admin'), async (req, res) => {
    try {
        await db.query('UPDATE users SET group_id = NULL WHERE group_id = ?', [req.params.id]);
        await db.query('DELETE FROM groups_table WHERE id = ?', [req.params.id]);
        res.json({ message: 'Gruppe gelöscht' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Devices
router.get('/devices', auth, role('admin'), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM devices ORDER BY name');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/devices', auth, role('admin'), async (req, res) => {
    try {
        const { id, name, location } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'ID und Name erforderlich' });
        await db.query('INSERT INTO devices (id, name, location) VALUES (?, ?, ?)', [id, name, location || null]);
        res.json({ message: 'Gerät registriert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/devices/:id/assign', auth, role('admin'), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User-ID erforderlich' });
        await db.query('UPDATE devices SET mode = "assign", assign_user_id = ? WHERE id = ?', [userId, req.params.id]);

        const io = req.app.get('io');
        if (io) io.emit('device:assignMode', { deviceId: req.params.id, userId });

        res.json({ message: 'Zuweisungsmodus aktiviert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Work Rules
router.get('/work-rules/:userId', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (userId !== req.user.id && req.user.role === 'arbeiter') {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }
        const [rules] = await db.query('SELECT * FROM work_rules WHERE user_id = ? ORDER BY weekday', [userId]);
        const [limits] = await db.query('SELECT * FROM time_limits WHERE user_id = ?', [userId]);
        res.json({ rules, limits: limits[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/work-rules/:userId', auth, role('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { rules, limits } = req.body;

        if (rules) {
            for (const rule of rules) {
                await db.query(
                    `INSERT INTO work_rules (user_id, weekday, core_start, core_end, max_daily_minutes, work_allowed)
                     VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
                     core_start = VALUES(core_start), core_end = VALUES(core_end),
                     max_daily_minutes = VALUES(max_daily_minutes), work_allowed = VALUES(work_allowed)`,
                    [userId, rule.weekday, rule.coreStart || null, rule.coreEnd || null, Math.max(0, rule.maxDailyMinutes || 480), rule.workAllowed ? 1 : 0]
                );
            }
        }

        if (limits) {
            await db.query(
                `INSERT INTO time_limits (user_id, max_weekly_minutes, max_overtime_minutes, max_undertime_minutes)
                 VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
                 max_weekly_minutes = VALUES(max_weekly_minutes),
                 max_overtime_minutes = VALUES(max_overtime_minutes),
                 max_undertime_minutes = VALUES(max_undertime_minutes)`,
                [userId, Math.max(0, limits.maxWeeklyMinutes || 2400), Math.max(0, limits.maxOvertimeMinutes || 720), Math.max(0, limits.maxUndertimeMinutes || 240)]
            );
        }

        res.json({ message: 'Arbeitsregeln aktualisiert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Team overview for Vorgesetzter
router.get('/team/online', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        let query, params;

        if (req.user.role === 'admin') {
            query = `SELECT u.id, u.first_name, u.last_name, u.email, t.type, t.stamp_time
                     FROM users u LEFT JOIN (
                         SELECT user_id, type, stamp_time FROM timestamps_log
                         WHERE DATE(stamp_time) = ? AND id IN (
                             SELECT MAX(id) FROM timestamps_log WHERE DATE(stamp_time) = ? GROUP BY user_id
                         )
                     ) t ON u.id = t.user_id WHERE u.active = 1 ORDER BY u.last_name`;
            params = [today, today];
        } else {
            query = `SELECT u.id, u.first_name, u.last_name, u.email, t.type, t.stamp_time
                     FROM users u LEFT JOIN (
                         SELECT user_id, type, stamp_time FROM timestamps_log
                         WHERE DATE(stamp_time) = ? AND id IN (
                             SELECT MAX(id) FROM timestamps_log WHERE DATE(stamp_time) = ? GROUP BY user_id
                         )
                     ) t ON u.id = t.user_id WHERE u.active = 1 AND u.supervisor_id = ? ORDER BY u.last_name`;
            params = [today, today, req.user.id];
        }

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/overview', auth, role('admin', 'vorgesetzter'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'Zeitraum erforderlich' });

        let userQuery, userParams;
        if (req.user.role === 'admin') {
            userQuery = `SELECT u.id, u.first_name, u.last_name, u.role, u.group_id, g.name as group_name
                         FROM users u LEFT JOIN groups_table g ON u.group_id = g.id
                         WHERE u.active = 1 ORDER BY u.last_name`;
            userParams = [];
        } else {
            userQuery = `SELECT u.id, u.first_name, u.last_name, u.role, u.group_id, g.name as group_name
                         FROM users u LEFT JOIN groups_table g ON u.group_id = g.id
                         WHERE u.active = 1 AND u.supervisor_id = ? ORDER BY u.last_name`;
            userParams = [req.user.id];
        }

        const [users] = await db.query(userQuery, userParams);
        const [allStamps] = await db.query(
            `SELECT user_id, type, stamp_time FROM timestamps_log
             WHERE DATE(stamp_time) BETWEEN ? AND ? ORDER BY stamp_time ASC`,
            [from, to]
        );

        const stampsByUser = {};
        allStamps.forEach(s => {
            if (!stampsByUser[s.user_id]) stampsByUser[s.user_id] = [];
            stampsByUser[s.user_id].push(s);
        });

        const [allRules] = await db.query('SELECT * FROM work_rules');
        const rulesByUser = {};
        allRules.forEach(r => {
            if (!rulesByUser[r.user_id]) rulesByUser[r.user_id] = [];
            rulesByUser[r.user_id].push(r);
        });

        const result = users.map(u => {
            const stamps = stampsByUser[u.id] || [];
            const days = {};
            stamps.forEach(s => {
                const day = s.stamp_time.toISOString().split('T')[0];
                if (!days[day]) days[day] = [];
                days[day].push(s);
            });

            let totalMinutes = 0;
            let workDays = 0;
            Object.values(days).forEach(entries => {
                let dayMin = 0;
                for (let i = 0; i < entries.length - 1; i += 2) {
                    if (entries[i].type === 'in' && entries[i + 1]?.type === 'out') {
                        dayMin += (new Date(entries[i + 1].stamp_time) - new Date(entries[i].stamp_time)) / 60000;
                    }
                }
                totalMinutes += dayMin;
                if (dayMin > 0) workDays++;
            });

            const rules = rulesByUser[u.id] || [];
            let expectedMinutes = 0;
            const current = new Date(from);
            const endDate = new Date(Math.min(new Date(to), new Date()));
            while (current <= endDate) {
                const weekday = (current.getDay() + 6) % 7;
                const rule = rules.find(r => r.weekday === weekday);
                if (rule && rule.work_allowed) expectedMinutes += rule.max_daily_minutes;
                current.setDate(current.getDate() + 1);
            }

            return {
                id: u.id,
                firstName: u.first_name,
                lastName: u.last_name,
                role: u.role,
                groupName: u.group_name,
                workDays,
                totalMinutes: Math.floor(totalMinutes),
                balance: Math.floor(totalMinutes - expectedMinutes)
            };
        });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Dashboard stats
router.get('/stats', auth, role('admin'), async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [totalUsers] = await db.query('SELECT COUNT(*) as count FROM users WHERE active = 1');
        const [stampedIn] = await db.query(
            `SELECT COUNT(DISTINCT user_id) as count FROM timestamps_log
             WHERE DATE(stamp_time) = ? AND id IN (
                 SELECT MAX(id) FROM timestamps_log WHERE DATE(stamp_time) = ? GROUP BY user_id
             ) AND type = 'in'`, [today, today]
        );
        const [pendingReqs] = await db.query("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");
        const [activeDevices] = await db.query('SELECT COUNT(*) as count FROM devices WHERE active = 1 AND last_seen > DATE_SUB(NOW(), INTERVAL 5 MINUTE)');

        res.json({
            totalUsers: totalUsers[0].count,
            stampedIn: stampedIn[0].count,
            pendingRequests: pendingReqs[0].count,
            activeDevices: activeDevices[0].count
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;