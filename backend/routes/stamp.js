import { Router } from 'express';
import db from '../db.js';
import { auth } from '../middleware/auth.js';

const router = Router();

async function getLastStamp(userId) {
    const [rows] = await db.query(
        'SELECT * FROM timestamps_log WHERE user_id = ? ORDER BY stamp_time DESC LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function getTodayMinutes(userId) {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await db.query(
        `SELECT type, stamp_time FROM timestamps_log
         WHERE user_id = ? AND DATE(stamp_time) = ?
         ORDER BY stamp_time ASC`,
        [userId, today]
    );

    let total = 0;
    for (let i = 0; i < rows.length - 1; i += 2) {
        if (rows[i].type === 'in' && rows[i + 1]?.type === 'out') {
            total += (new Date(rows[i + 1].stamp_time) - new Date(rows[i].stamp_time)) / 60000;
        }
    }

    if (rows.length % 2 === 1 && rows[rows.length - 1].type === 'in') {
        total += (Date.now() - new Date(rows[rows.length - 1].stamp_time)) / 60000;
    }

    return Math.floor(total);
}

async function getMonthBalance(userId) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const [stamps] = await db.query(
        `SELECT type, stamp_time FROM timestamps_log
         WHERE user_id = ? AND DATE(stamp_time) BETWEEN ? AND ?
         ORDER BY stamp_time ASC`,
        [userId, monthStart, monthEnd]
    );

    let actualMinutes = 0;
    for (let i = 0; i < stamps.length - 1; i += 2) {
        if (stamps[i].type === 'in' && stamps[i + 1]?.type === 'out') {
            actualMinutes += (new Date(stamps[i + 1].stamp_time) - new Date(stamps[i].stamp_time)) / 60000;
        }
    }

    const [rules] = await db.query('SELECT * FROM work_rules WHERE user_id = ?', [userId]);
    let expectedMinutes = 0;
    const current = new Date(monthStart);
    const endDate = new Date(Math.min(new Date(monthEnd), now));

    while (current <= endDate) {
        const weekday = (current.getDay() + 6) % 7;
        const rule = rules.find(r => r.weekday === weekday);
        if (rule && rule.work_allowed) {
            expectedMinutes += rule.max_daily_minutes;
        }
        current.setDate(current.getDate() + 1);
    }

    return Math.floor(actualMinutes - expectedMinutes);
}

async function checkCoreTime(userId, now) {
    const weekday = (now.getDay() + 6) % 7;
    const [rules] = await db.query(
        'SELECT * FROM work_rules WHERE user_id = ? AND weekday = ?',
        [userId, weekday]
    );

    if (!rules.length) return { allowed: true, warning: null };

    const rule = rules[0];
    if (!rule.work_allowed) {
        return { allowed: false, warning: 'Arbeiten an diesem Tag nicht erlaubt' };
    }

    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    let warning = null;

    if (rule.core_start && currentTime > rule.core_start.substring(0, 8)) {
        warning = `Kernzeit-Beginn war ${rule.core_start.substring(0, 5)} Uhr`;
    }

    return { allowed: true, warning };
}

router.post('/', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();
        const source = req.body.source || 'web';

        const last = await getLastStamp(userId);
        const type = (!last || last.type === 'out') ? 'in' : 'out';

        let coreCheck = { allowed: true, warning: null };
        if (type === 'in') {
            coreCheck = await checkCoreTime(userId, now);
            if (!coreCheck.allowed) {
                return res.json({ success: false, warning: coreCheck.warning });
            }
        }

        await db.query(
            'INSERT INTO timestamps_log (user_id, type, stamp_time, source, device_id) VALUES (?, ?, ?, ?, ?)',
            [userId, type, now, source, req.body.deviceId || null]
        );

        const todayMinutes = await getTodayMinutes(userId);
        const balance = await getMonthBalance(userId);

        const result = {
            success: true,
            type,
            time: now.toISOString(),
            todayMinutes,
            balance,
            warning: coreCheck.warning,
            user: { firstName: req.user.firstName, lastName: req.user.lastName }
        };

        const io = req.app.get('io');
        if (io) io.emit('stamp:update', { userId, ...result });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.post('/nfc', async (req, res) => {
    try {
        const { nfcUid, deviceId } = req.body;
        if (!nfcUid || !deviceId) return res.status(400).json({ error: 'NFC-UID und Device-ID erforderlich' });

        await db.query('UPDATE devices SET last_seen = NOW() WHERE id = ?', [deviceId]);

        const [devices] = await db.query('SELECT * FROM devices WHERE id = ? AND active = 1', [deviceId]);
        if (!devices.length) return res.status(404).json({ error: 'Gerät nicht gefunden' });

        const device = devices[0];

        if (device.mode === 'assign' && device.assign_user_id) {
            await db.query('UPDATE users SET nfc_uid = ? WHERE id = ?', [nfcUid, device.assign_user_id]);
            await db.query('UPDATE devices SET mode = "stamp", assign_user_id = NULL WHERE id = ?', [deviceId]);

            const io = req.app.get('io');
            if (io) io.emit('nfc:assigned', { userId: device.assign_user_id, nfcUid, deviceId });

            return res.json({ action: 'assigned', message: 'NFC-Tag zugewiesen' });
        }

        const [users] = await db.query('SELECT * FROM users WHERE nfc_uid = ? AND active = 1', [nfcUid]);
        if (!users.length) return res.json({ action: 'unknown', message: 'Tag nicht zugewiesen' });

        const user = users[0];
        const now = new Date();
        const last = await getLastStamp(user.id);
        const type = (!last || last.type === 'out') ? 'in' : 'out';

        let coreCheck = { allowed: true, warning: null };
        if (type === 'in') {
            coreCheck = await checkCoreTime(user.id, now);
        }

        await db.query(
            'INSERT INTO timestamps_log (user_id, type, stamp_time, source, device_id) VALUES (?, ?, ?, ?, ?)',
            [user.id, type, now, 'arduino', deviceId]
        );

        const todayMinutes = await getTodayMinutes(user.id);
        const balance = await getMonthBalance(user.id);

        const result = {
            action: 'stamped',
            type,
            time: now.toISOString(),
            todayMinutes,
            balance,
            warning: coreCheck.warning,
            user: { firstName: user.first_name, lastName: user.last_name }
        };

        const io = req.app.get('io');
        if (io) io.emit('stamp:update', { userId: user.id, ...result });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/today', auth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [rows] = await db.query(
            'SELECT * FROM timestamps_log WHERE user_id = ? AND DATE(stamp_time) = ? ORDER BY stamp_time ASC',
            [req.user.id, today]
        );
        const todayMinutes = await getTodayMinutes(req.user.id);
        const balance = await getMonthBalance(req.user.id);
        const last = rows.length ? rows[rows.length - 1] : null;
        const isIn = last?.type === 'in';

        res.json({ stamps: rows, todayMinutes, balance, isStampedIn: isIn });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/history', auth, async (req, res) => {
    try {
        const { from, to } = req.query;
        const userId = req.query.userId ? parseInt(req.query.userId) : req.user.id;

        if (userId !== req.user.id) {
            if (req.user.role === 'arbeiter') {
                return res.status(403).json({ error: 'Keine Berechtigung' });
            }
            if (req.user.role === 'vorgesetzter') {
                const [check] = await db.query('SELECT id FROM users WHERE id = ? AND supervisor_id = ?', [userId, req.user.id]);
                if (!check.length) return res.status(403).json({ error: 'Keine Berechtigung' });
            }
        }

        const [rows] = await db.query(
            `SELECT * FROM timestamps_log WHERE user_id = ? AND DATE(stamp_time) BETWEEN ? AND ? ORDER BY stamp_time ASC`,
            [userId, from, to]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/balance/:userId', auth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (userId !== req.user.id && req.user.role === 'arbeiter') {
            return res.status(403).json({ error: 'Keine Berechtigung' });
        }

        const balance = await getMonthBalance(userId);
        const [limits] = await db.query('SELECT * FROM time_limits WHERE user_id = ?', [userId]);

        res.json({
            balance,
            limits: limits[0] || { max_weekly_minutes: 2400, max_overtime_minutes: 720, max_undertime_minutes: 240 }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;