const express = require('express')
const { WebSocketServer } = require('ws')
const http = require('http')

const app = express()
app.use(express.json())

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const clients = new Set()

const demoUsers = {
    'A3:B2:C1:D0': { name: 'Med Köker', konto: '+12:30' },
    'F1:E2:D3:C4': { name: 'Leon Kadown', konto: '-02:15' },
    '11:22:33:44': { name: 'Julian Lo Castro', konto: '+08:45' }
}

wss.on('connection', (ws) => {
    clients.add(ws)
    console.log('Client verbunden (' + clients.size + ' aktiv)')
    ws.on('close', () => clients.delete(ws))
})

function broadcast(data) {
    const msg = JSON.stringify(data)
    for (const ws of clients) {
        if (ws.readyState === 1) ws.send(msg)
    }
}

app.post('/api/stamp/nfc', (req, res) => {
    const { uid, device_id } = req.body
    if (!uid) return res.status(400).json({ error: 'uid fehlt' })

    const user = demoUsers[uid] || { name: 'Unbekannt', konto: '+00:00' }
    const now = new Date()
    const zeit = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    const datum = now.toLocaleDateString('de-DE')

    const response = {
        status: 'ok',
        uid,
        name: user.name,
        stempel: zeit,
        datum,
        konto: user.konto,
        typ: 'ein'
    }

    console.log('NFC Scan:', uid, '|', user.name, '| Einstempeln:', zeit)
    broadcast({ type: 'nfc_scan', ...response, device_id: device_id || 'esp32-01', timestamp: Date.now() })

    res.json(response)
})

app.get('/health', (req, res) => res.json({ status: 'online', clients: clients.size }))

server.listen(3001, '0.0.0.0', () => {
    console.log('Server laeuft auf Port 3001')
})