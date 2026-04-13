import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

import authRoutes from './routes/auth.js';
import stampRoutes from './routes/stamp.js';
import requestRoutes from './routes/requests.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME_use_a_long_random_secret_here') {
    console.error('FEHLER: JWT_SECRET ist nicht gesetzt oder noch der Standardwert.');
    console.error('Erstelle eine .env-Datei basierend auf .env.example und setze einen sicheren Wert.');
    process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('io', io);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/stamp', stampRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    }
});

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Nicht autorisiert'));
    try {
        socket.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        next(new Error('Token ungültig'));
    }
});

io.on('connection', (socket) => {
    socket.join(`user-${socket.user.id}`);
    if (socket.user.role === 'admin') socket.join('admins');
    if (socket.user.role === 'vorgesetzter') socket.join('supervisors');

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`ZeitStempel Server läuft auf Port ${PORT}`);
});
