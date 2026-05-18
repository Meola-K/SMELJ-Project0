# ZeitStempel – Projektdokumentation

## Setup

### Voraussetzungen
- Node.js ≥ 18
- MySQL-Datenbank

### Installation

```bash
cd backend
npm install
cp .env.example .env
# .env anpassen (JWT_SECRET, DB_*)
node server.js
```

---

## Umgebungsvariablen (backend/.env)

| Variable      | Pflicht | Standard  | Beschreibung |
|---------------|---------|-----------|--------------|
| `JWT_SECRET`  | ✅ ja   | –         | Langer, zufälliger String für JWT-Signierung |
| `JWT_EXPIRY`  | nein    | `8h`      | JWT-Ablaufzeit (z. B. `1h`, `30m`, `8h`, `1d`) |
| `DB_HOST`     | ✅ ja   | localhost | MySQL-Host |
| `DB_USER`     | ✅ ja   | root      | MySQL-Benutzer |
| `DB_PASS`     | nein    | –         | MySQL-Passwort |
| `DB_NAME`     | ✅ ja   | zeitstempel | MySQL-Datenbankname |
| `PORT`        | nein    | `3001`    | HTTP-Port des Servers |

### JWT-Session-Dauer konfigurieren

Die Session-Dauer ist auf **8 Stunden** voreingestellt (statt vormals 24h).  
Der Wert kann über `JWT_EXPIRY` in der `.env` angepasst werden:

```env
JWT_EXPIRY=8h   # Standard
JWT_EXPIRY=4h   # Kürzere Session
JWT_EXPIRY=1d   # 24h (Legacy-Verhalten, nicht empfohlen)
```

Bei abgelaufener Session wird der Nutzer **automatisch ausgeloggt** und ein Toast mit der Meldung *„Sitzung abgelaufen"* angezeigt.

---

## Rollenbasierte Zugangskontrolle (RBAC)

### Rollen

| Rolle           | Beschreibung |
|-----------------|--------------|
| `admin`         | Vollzugriff auf alle Funktionen und Admin-Bereich |
| `vorgesetzter`  | Zugriff auf Team, Antragsübersicht, Monatsberichte |
| `arbeiter`      | Nur eigene Zeiterfassung, Anträge und Kalender |

### Frontend – Route Guards

Der Router (`frontend/js/router.js`) prüft bei jeder Navigation die Rolle des eingeloggten Nutzers.  
Routen mit `roles`-Konfiguration sind nur für die angegebenen Rollen zugänglich.  
Unberechtigte Zugriffe leiten automatisch zum Dashboard um.

```js
registerRoute('admin', {
    pageId: 'page-admin',
    onEnter: () => { loadUsers(); loadGroups(); },
    roles: ['admin', 'vorgesetzter'],  // Nur diese Rollen dürfen rein
});
```

**Sidebar-Einblendung nach Rolle:**  
Menüpunkte werden über `data-roles`-Attribute im HTML gesteuert und per `updateSidebarForRole()` ein-/ausgeblendet.

### Backend – `role()`-Middleware

Alle sensiblen Endpunkte sind mit der `role()`-Middleware aus `backend/middleware/auth.js` geschützt:

```js
// Nur für Admins
router.get('/export/csv', auth, role('admin'), handler);

// Für Admins und Vorgesetzte
router.get('/overview', auth, role('admin', 'vorgesetzter'), handler);
```

Bei unberechtigtem Zugriff antwortet das Backend mit `403 Forbidden`.
