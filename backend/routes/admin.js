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

        const year = new Date().getFullYear();
        await db.query('INSERT INTO vacation_entitlements (user_id, year, total_days) VALUES (?, ?, 30)', [result.insertId, year]);

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

// DSGVO Art. 17 – Personenbezogene Daten anonymisieren
// Arbeitszeitdaten bleiben erhalten (Aufbewahrungspflicht §16 ArbZG: 2 Jahre,
// lohnrelevante Daten §41 EStG/§257 HGB: 6 Jahre), aber ohne Personenbezug.
router.delete('/users/:id/gdpr', auth, role('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (userId === req.user.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });

        const [user] = await db.query('SELECT active FROM users WHERE id = ?', [userId]);
        if (!user.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        if (user[0].active) return res.status(400).json({ error: 'Benutzer muss zuerst deaktiviert werden' });

        // Personenbezogene Daten im User anonymisieren
        await db.query(
            `UPDATE users SET
                email = CONCAT('geloescht_', id, '@anonym.local'),
                password = 'ANONYMIZED',
                first_name = 'Gelöscht',
                last_name = CONCAT('Nutzer-', id),
                nfc_uid = NULL
            WHERE id = ?`,
            [userId]
        );

        // Notizen in Anträgen entfernen (können Gesundheitsdaten enthalten)
        await db.query('UPDATE requests SET note = NULL WHERE user_id = ?', [userId]);

        // Begründungen in Korrekturen entfernen
        await db.query(
            "UPDATE corrections SET reason = 'Anonymisiert (DSGVO)' WHERE user_id = ?",
            [userId]
        );

        // Konfiguration löschen (keine Aufbewahrungspflicht)
        await db.query('DELETE FROM work_rules WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM time_limits WHERE user_id = ?', [userId]);

        res.json({ message: 'Personenbezogene Daten anonymisiert. Arbeitszeitdaten bleiben aufbewahrungspflichtig erhalten.' });
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
        const groupId = Number(req.params.id);
        if (!Number.isInteger(groupId) || groupId <= 0) {
            return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
        }

        const rawTarget = req.body ? req.body.targetGroupId : null;
        let targetGroupId = null;
        if (rawTarget !== null && rawTarget !== undefined && rawTarget !== '') {
            const parsed = Number(rawTarget);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                return res.status(400).json({ error: 'Ungültige Ziel-Gruppen-ID' });
            }
            if (parsed === groupId) {
                return res.status(400).json({ error: 'Zielgruppe darf nicht die zu löschende Gruppe sein' });
            }
            const [target] = await db.query('SELECT id FROM groups_table WHERE id = ?', [parsed]);
            if (target.length === 0) {
                return res.status(404).json({ error: 'Zielgruppe nicht gefunden' });
            }
            targetGroupId = parsed;
        }

        if (targetGroupId !== null) {
            await db.query('UPDATE users SET group_id = ? WHERE group_id = ?', [targetGroupId, groupId]);
        } else {
            await db.query('UPDATE users SET group_id = NULL WHERE group_id = ?', [groupId]);
        }
        await db.query('DELETE FROM groups_table WHERE id = ?', [groupId]);
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

// SCRUM-297: Modus pro Gerät umstellen (stamp ↔ frontdesk)
router.put('/devices/:id/mode', auth, role('admin'), async (req, res) => {
    try {
        const { mode } = req.body;
        if (!['stamp', 'frontdesk'].includes(mode)) {
            return res.status(400).json({ error: 'Ungültiger Modus' });
        }
        const [exists] = await db.query('SELECT id FROM devices WHERE id = ?', [req.params.id]);
        if (!exists.length) return res.status(404).json({ error: 'Gerät nicht gefunden' });

        await db.query(
            'UPDATE devices SET mode = ?, assign_user_id = NULL WHERE id = ?',
            [mode, req.params.id]
        );

        const io = req.app.get('io');
        if (io) io.emit('device:modeChanged', { deviceId: req.params.id, mode });

        res.json({ message: mode === 'frontdesk' ? 'Frontdesk-Modus aktiviert' : 'Stempel-Modus aktiviert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.delete('/devices/:id', auth, role('admin'), async (req, res) => {
    try {
        await db.query('DELETE FROM devices WHERE id = ?', [req.params.id]);
        res.json({ message: 'Gerät gelöscht' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/devices/:id', auth, role('admin'), async (req, res) => {
    try {
        const { name, location, active } = req.body;
        const fields = [];
        const params = [];
        if (name !== undefined) { fields.push('name = ?'); params.push(name); }
        if (location !== undefined) { fields.push('location = ?'); params.push(location); }
        if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
        if (!fields.length) return res.status(400).json({ error: 'Keine Änderungen' });
        params.push(req.params.id);
        await db.query(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ message: 'Gerät aktualisiert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/users/:id/nfc', auth, role('admin'), async (req, res) => {
    try {
        await db.query('UPDATE users SET nfc_uid = NULL WHERE id = ?', [req.params.id]);
        res.json({ message: 'NFC-Tag entfernt' });
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
            // 0 ist ein gültiger Wert (z.B. keine Überstunden erlaubt). Daher kein || Default,
            // sondern nur Fallback bei null/undefined/''.
            const toMin = (v, def) => {
                if (v === null || v === undefined || v === '') return def;
                const n = Number(v);
                return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : def;
            };
            await db.query(
                `INSERT INTO time_limits (user_id, max_weekly_minutes, max_overtime_minutes, max_undertime_minutes)
                 VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
                 max_weekly_minutes = VALUES(max_weekly_minutes),
                 max_overtime_minutes = VALUES(max_overtime_minutes),
                 max_undertime_minutes = VALUES(max_undertime_minutes)`,
                [
                    userId,
                    toMin(limits.maxWeeklyMinutes, 2400),
                    toMin(limits.maxOvertimeMinutes, 720),
                    toMin(limits.maxUndertimeMinutes, 240)
                ]
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

router.get('/vacation/balance', auth, async (req, res) => {
    try {
        const userId = req.query.userId ? parseInt(req.query.userId) : req.user.id;
        if (userId !== req.user.id && req.user.role === 'arbeiter') {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }

        const year = parseInt(req.query.year) || new Date().getFullYear();

        const [entitlement] = await db.query(
            'SELECT * FROM vacation_entitlements WHERE user_id = ? AND year = ?',
            [userId, year]
        );
        const totalDays = entitlement.length ? entitlement[0].total_days : 30;

        // WICHTIG: Sonderurlaub (z.B. Hochzeit, Geburt, Trauerfall, Umzug) wird NICHT
        // vom Erholungsurlaubsanspruch abgezogen. Daher filtern wir hier strikt nur
        // type = 'urlaub' und ignorieren 'sonderurlaub' bewusst.
        const [approved] = await db.query(
            `SELECT date_from, date_to FROM requests
             WHERE user_id = ? AND type = 'urlaub' AND status = 'approved'
             AND YEAR(date_from) = ?`,
            [userId, year]
        );

        let usedDays = 0;
        approved.forEach(r => {
            const from = new Date(r.date_from);
            const to = new Date(r.date_to);
            const current = new Date(from);
            while (current <= to) {
                const dow = current.getDay();
                if (dow !== 0 && dow !== 6) usedDays++;
                current.setDate(current.getDate() + 1);
            }
        });

        const [pending] = await db.query(
            `SELECT COUNT(*) as count FROM requests
             WHERE user_id = ? AND type = 'urlaub' AND status = 'pending'
             AND YEAR(date_from) = ?`,
            [userId, year]
        );

        res.json({
            year,
            totalDays,
            usedDays,
            remainingDays: totalDays - usedDays,
            pendingRequests: pending[0].count
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/corrections/pending', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as user_name
                     FROM corrections c JOIN users u ON c.user_id = u.id
                     WHERE c.status = 'pending' ORDER BY c.created_at ASC`;
            params = [];
        } else {
            query = `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as user_name
                     FROM corrections c JOIN users u ON c.user_id = u.id
                     WHERE c.status = 'pending' AND u.supervisor_id = ? ORDER BY c.created_at ASC`;
            params = [req.user.id];
        }
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/corrections/:id/review', auth, role('vorgesetzter', 'admin'), async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

        const [corrections] = await db.query('SELECT * FROM corrections WHERE id = ? AND status = "pending"', [req.params.id]);
        if (!corrections.length) return res.status(404).json({ error: 'Korrektur nicht gefunden' });

        const correction = corrections[0];

        if (req.user.role === 'vorgesetzter') {
            const [user] = await db.query('SELECT supervisor_id FROM users WHERE id = ?', [correction.user_id]);
            if (user[0]?.supervisor_id !== req.user.id) {
                return res.status(403).json({ error: 'Nicht dein Mitarbeiter' });
            }
        }

        await db.query(
            'UPDATE corrections SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
            [status, req.user.id, req.params.id]
        );

        if (status === 'approved') {
            if (correction.type === 'add') {
                await db.query(
                    'INSERT INTO timestamps_log (user_id, type, stamp_time, source) VALUES (?, ?, ?, ?)',
                    [correction.user_id, correction.stamp_type, correction.corrected_time, 'web']
                );
            } else if (correction.type === 'edit' && correction.stamp_id) {
                await db.query(
                    'UPDATE timestamps_log SET stamp_time = ? WHERE id = ?',
                    [correction.corrected_time, correction.stamp_id]
                );
            } else if (correction.type === 'delete' && correction.stamp_id) {
                await db.query('DELETE FROM timestamps_log WHERE id = ?', [correction.stamp_id]);
            }
        }

        const io = req.app.get('io');
        if (io) {
            io.to(`user-${correction.user_id}`).emit('correction:reviewed', {
                id: correction.id, status,
                reviewerName: `${req.user.firstName} ${req.user.lastName}`
            });
        }

        res.json({ message: status === 'approved' ? 'Korrektur genehmigt' : 'Korrektur abgelehnt' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// SCRUM-159/160: Userseitige Endpoints sind in routes/corrections.js gewandert.
// Die alte (weniger validierte) POST /admin/corrections-Route wurde entfernt.

// ── SCRUM-211/212: Abwesenheitsbericht – JSON-Vorschau & CSV-Export ──────────
// GET /api/admin/export/absences?from=YYYY-MM-DD&to=YYYY-MM-DD
//                                &type=urlaub|...  (optional)
//                                &groupId=<int>    (optional, Abteilung)
//                                &status=approved|pending|denied (optional)
//                                &format=csv|json (default: json)

const ABSENCE_TYPES = ['urlaub', 'gleitzeit', 'homeoffice', 'krank', 'sonderurlaub'];
const ABSENCE_STATUSES = ['pending', 'approved', 'denied'];
const TYPE_LABELS_DE = {
    urlaub: 'Urlaub', gleitzeit: 'Gleitzeit', homeoffice: 'Homeoffice',
    krank: 'Krank', sonderurlaub: 'Sonderurlaub'
};
const REASON_LABELS_DE = {
    hochzeit: 'Hochzeit', geburt: 'Geburt', trauerfall: 'Trauerfall',
    umzug: 'Umzug', sonstiges: 'Sonstiges'
};
const STATUS_LABELS_DE = {
    pending: 'Ausstehend', approved: 'Genehmigt', denied: 'Abgelehnt'
};

function countWorkdays(from, to) {
    let days = 0;
    const d = new Date(from);
    const end = new Date(to);
    // Auf Mitternacht UTC normalisieren, damit DST keine Endlosschleifen baut
    d.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);
    while (d <= end) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) days++;
        d.setDate(d.getDate() + 1);
    }
    return days;
}

function formatDateDe(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function formatDateTimeDe(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return `${formatDateDe(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// RFC4180-konformes Escapen + Schutz vor CSV-Injection (führendes =, +, -, @)
function csvEscape(value) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    // CSV-Injection-Schutz: gefährliche Steuerzeichen am Zeilenanfang neutralisieren
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function buildAbsenceCsv(rows) {
    const headers = [
        'Mitarbeiter', 'E-Mail', 'Abteilung', 'Typ', 'Anlass',
        'Von', 'Bis', 'Werktage', 'Status', 'Notiz',
        'Bearbeitet von', 'Bearbeitet am', 'Eingereicht am'
    ];
    // Semikolon als Trenner: deutsche Excel-Locale öffnet das ohne Importdialog korrekt.
    const SEP = ';';
    const lines = [headers.map(csvEscape).join(SEP)];
    for (const r of rows) {
        lines.push([
            r.name,
            r.email,
            r.groupName,
            r.typeLabel,
            r.reasonLabel,
            formatDateDe(r.dateFrom),
            formatDateDe(r.dateTo),
            r.workdays,
            r.statusLabel,
            r.note,
            r.reviewerName,
            formatDateTimeDe(r.reviewedAt),
            formatDateTimeDe(r.createdAt)
        ].map(csvEscape).join(SEP));
    }
    // CRLF gemäß RFC4180 – Excel/Numbers/LibreOffice akzeptieren es alle.
    return lines.join('\r\n') + '\r\n';
}

// ── SCRUM-197: Zeiten-Export als CSV ────────────────────────────────────────
// GET /api/admin/export/csv?from=YYYY-MM-DD&to=YYYY-MM-DD&groupId=<int>
//                          &format=csv|json (default: csv)
// Spalten: Mitarbeiter, Datum, Arbeitszeit (hh:mm), Überstunden (hh:mm)

function minutesToHHMM(min) {
    if (!Number.isFinite(min)) return '00:00';
    const sign = min < 0 ? '-' : '';
    const abs = Math.abs(Math.round(min));
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildTimesCsv(rows) {
    const headers = ['Mitarbeiter', 'Datum', 'Arbeitszeit', 'Überstunden'];
    const SEP = ';';
    const lines = [headers.map(csvEscape).join(SEP)];
    for (const r of rows) {
        lines.push([
            r.name,
            formatDateDe(r.date),
            r.workTime,
            r.overtime
        ].map(csvEscape).join(SEP));
    }
    return lines.join('\r\n') + '\r\n';
}

router.get('/export/csv', auth, role('admin'), async (req, res) => {
    try {
        const { from, to, groupId, format } = req.query;

        if (!from || !to) {
            return res.status(400).json({ error: 'Zeitraum (from, to) erforderlich' });
        }
        const isoRe = /^\d{4}-\d{2}-\d{2}$/;
        if (!isoRe.test(from) || !isoRe.test(to)) {
            return res.status(400).json({ error: 'Datum muss im Format YYYY-MM-DD sein' });
        }
        if (new Date(from) > new Date(to)) {
            return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });
        }

        let groupIdNum = null;
        if (groupId !== undefined && groupId !== '' && groupId !== 'null') {
            const n = Number(groupId);
            if (!Number.isInteger(n) || n <= 0) {
                return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
            }
            groupIdNum = n;
        }

        // Nutzer laden (optional nach Gruppe gefiltert)
        const userParams = [];
        let userWhere = 'u.active = 1';
        if (groupIdNum !== null) {
            userWhere += ' AND u.group_id = ?';
            userParams.push(groupIdNum);
        }
        const [users] = await db.query(
            `SELECT u.id, u.first_name, u.last_name
             FROM users u
             WHERE ${userWhere}
             ORDER BY u.last_name, u.first_name`,
            userParams
        );
        const userIds = users.map(u => u.id);

        // Stempel im Zeitraum laden (nur für gefilterte Nutzer)
        let stamps = [];
        let rules = [];
        if (userIds.length) {
            const placeholders = userIds.map(() => '?').join(',');
            const [s] = await db.query(
                `SELECT user_id, type, stamp_time FROM timestamps_log
                 WHERE user_id IN (${placeholders})
                 AND DATE(stamp_time) BETWEEN ? AND ?
                 ORDER BY user_id, stamp_time ASC`,
                [...userIds, from, to]
            );
            stamps = s;

            const [r] = await db.query(
                `SELECT user_id, weekday, max_daily_minutes, work_allowed FROM work_rules
                 WHERE user_id IN (${placeholders})`,
                userIds
            );
            rules = r;
        }

        // Stempel pro Nutzer und Tag gruppieren
        const stampsByUserDay = {};
        for (const s of stamps) {
            const day = s.stamp_time.toISOString().split('T')[0];
            const key = `${s.user_id}|${day}`;
            if (!stampsByUserDay[key]) stampsByUserDay[key] = [];
            stampsByUserDay[key].push(s);
        }

        // Regeln pro Nutzer/Wochentag
        const rulesByUser = {};
        for (const r of rules) {
            if (!rulesByUser[r.user_id]) rulesByUser[r.user_id] = {};
            rulesByUser[r.user_id][r.weekday] = r;
        }

        // Pro Nutzer alle Tage im Zeitraum durchgehen
        const result = [];
        for (const u of users) {
            const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
            const current = new Date(from);
            const endDate = new Date(to);
            current.setHours(12, 0, 0, 0);
            endDate.setHours(12, 0, 0, 0);

            while (current <= endDate) {
                const iso = current.toISOString().split('T')[0];
                const entries = stampsByUserDay[`${u.id}|${iso}`] || [];

                let dayMin = 0;
                for (let i = 0; i < entries.length - 1; i += 2) {
                    if (entries[i].type === 'in' && entries[i + 1]?.type === 'out') {
                        dayMin += (new Date(entries[i + 1].stamp_time) - new Date(entries[i].stamp_time)) / 60000;
                    }
                }

                // Soll-Arbeitszeit aus work_rules: Montag=0 ... Sonntag=6
                const weekday = (current.getDay() + 6) % 7;
                const rule = rulesByUser[u.id]?.[weekday];
                const expectedMin = (rule && rule.work_allowed) ? (rule.max_daily_minutes || 0) : 0;

                // Tage ohne Stempel UND ohne Soll überspringen (sonst riesige CSV mit 0:00-Zeilen)
                if (dayMin > 0 || expectedMin > 0) {
                    result.push({
                        userId: u.id,
                        name,
                        date: iso,
                        workMinutes: Math.round(dayMin),
                        overtimeMinutes: Math.round(dayMin - expectedMin),
                        workTime: minutesToHHMM(dayMin),
                        overtime: minutesToHHMM(dayMin - expectedMin)
                    });
                }

                current.setDate(current.getDate() + 1);
            }
        }

        // Sortierung: Name, dann Datum
        result.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));

        // Default ist CSV; JSON nur, wenn explizit angefordert (für Vorschau im Frontend).
        const wantsJson = (format || '').toLowerCase() === 'json';
        if (wantsJson) {
            return res.json({
                count: result.length,
                rows: result,
                filter: { from, to, groupId: groupIdNum }
            });
        }

        const csv = buildTimesCsv(result);
        const safeFrom = from.replace(/[^0-9-]/g, '');
        const safeTo = to.replace(/[^0-9-]/g, '');
        const filename = `export_${safeFrom}_${safeTo}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        // UTF-8 BOM, damit Excel-DE Umlaute (Überstunden) korrekt erkennt
        return res.send('﻿' + csv);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/export/absences', auth, role('admin'), async (req, res) => {
    try {
        const { from, to, type, groupId, status, format } = req.query;

        // Pflicht: from + to
        if (!from || !to) {
            return res.status(400).json({ error: 'Zeitraum (from, to) erforderlich' });
        }
        // Striktes ISO-Datumsformat verlangen (YYYY-MM-DD)
        const isoRe = /^\d{4}-\d{2}-\d{2}$/;
        if (!isoRe.test(from) || !isoRe.test(to)) {
            return res.status(400).json({ error: 'Datum muss im Format YYYY-MM-DD sein' });
        }
        if (new Date(from) > new Date(to)) {
            return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });
        }
        if (type && !ABSENCE_TYPES.includes(type)) {
            return res.status(400).json({ error: 'Ungültiger Typ' });
        }
        if (status && !ABSENCE_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Ungültiger Status' });
        }

        let groupIdNum = null;
        if (groupId !== undefined && groupId !== '' && groupId !== 'null') {
            const n = Number(groupId);
            if (!Number.isInteger(n) || n <= 0) {
                return res.status(400).json({ error: 'Ungültige Abteilungs-ID' });
            }
            groupIdNum = n;
        }

        const wantsCsv = (format || '').toLowerCase() === 'csv';

        // Anträge holen, die sich mit dem Filter-Zeitraum überlappen.
        const where = ['r.date_from <= ?', 'r.date_to >= ?'];
        const params = [to, from];
        if (type) { where.push('r.type = ?'); params.push(type); }
        if (groupIdNum !== null) { where.push('u.group_id = ?'); params.push(groupIdNum); }
        if (status) { where.push('r.status = ?'); params.push(status); }

        const query = `
            SELECT r.id, r.type, r.date_from, r.date_to, r.note, r.reason,
                   r.status, r.created_at, r.reviewed_at,
                   u.first_name, u.last_name, u.email,
                   g.name AS group_name,
                   CONCAT(rv.first_name, ' ', rv.last_name) AS reviewer_name
            FROM requests r
            JOIN users u ON r.user_id = u.id
            LEFT JOIN groups_table g ON u.group_id = g.id
            LEFT JOIN users rv ON r.reviewed_by = rv.id
            WHERE ${where.join(' AND ')}
            ORDER BY r.date_from ASC, u.last_name ASC, u.first_name ASC
        `;
        const [rows] = await db.query(query, params);

        const enriched = rows.map(r => ({
            id: r.id,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
            email: r.email || '',
            groupName: r.group_name || '',
            type: r.type,
            typeLabel: TYPE_LABELS_DE[r.type] || r.type,
            reason: r.reason || null,
            reasonLabel: r.reason ? (REASON_LABELS_DE[r.reason] || r.reason) : '',
            dateFrom: r.date_from,
            dateTo: r.date_to,
            workdays: countWorkdays(r.date_from, r.date_to),
            status: r.status,
            statusLabel: STATUS_LABELS_DE[r.status] || r.status,
            note: r.note || '',
            reviewerName: r.reviewer_name || '',
            reviewedAt: r.reviewed_at,
            createdAt: r.created_at
        }));

        if (wantsCsv) {
            const csv = buildAbsenceCsv(enriched);
            const safeFrom = from.replace(/[^0-9-]/g, '');
            const safeTo = to.replace(/[^0-9-]/g, '');
            const filename = `abwesenheiten_${safeFrom}_${safeTo}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Cache-Control', 'no-store');
            // UTF-8 BOM, damit Excel-DE Umlaute korrekt erkennt
            return res.send('\uFEFF' + csv);
        }

        return res.json({
            count: enriched.length,
            rows: enriched,
            filter: {
                from, to,
                type: type || null,
                groupId: groupIdNum,
                status: status || null
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;