import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email und Passwort erforderlich' });

        const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
        if (!rows.length) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, firstName: user.first_name, lastName: user.last_name, groupId: user.group_id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: { id: user.id, email: user.email, role: user.role, firstName: user.first_name, lastName: user.last_name, groupId: user.group_id }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.get('/me', auth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.group_id, u.supervisor_id, u.nfc_uid, u.active,
             g.name as group_name,
             CONCAT(s.first_name, ' ', s.last_name) as supervisor_name
             FROM users u
             LEFT JOIN groups_table g ON u.group_id = g.id
             LEFT JOIN users s ON u.supervisor_id = s.id
             WHERE u.id = ?`, [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

router.put('/password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Alle Felder erforderlich' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });

        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
        const valid = await bcrypt.compare(currentPassword, rows[0].password);
        if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });

        const hash = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
        res.json({ message: 'Passwort geändert' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

export default router;
