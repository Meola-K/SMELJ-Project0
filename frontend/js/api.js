const API_BASE = '/api';

function getToken() {
    return localStorage.getItem('token');
}

function setToken(token) {
    localStorage.setItem('token', token);
}

function clearToken() {
    localStorage.removeItem('token');
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    // Body parsen – kann fehlen oder Nicht-JSON sein (z.B. CSV-Download im selben Helper)
    let data = {};
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try {
            data = await res.json();
        } catch {
            data = {};
        }
    }

    if (res.status === 401) {
        // Nur als "Session abgelaufen" behandeln, wenn ÜBERHAUPT ein Token vorhanden war.
        // Ohne Token (z.B. POST /auth/login mit falschen Daten) ist 401 ein Login-Fehler
        // und darf NICHT in den Auto-Logout-Pfad. Sonst kommt die irreführende
        // 'Sitzung abgelaufen'-Meldung auf der Login-Seite (Bug SCRUM-288).
        if (token) {
            clearToken();
            window.dispatchEvent(new CustomEvent('auth:logout', {
                detail: { reason: 'session_expired', code: data.code || 'session_expired' }
            }));
        }
        const err = new Error(data.error || 'Nicht autorisiert');
        err.code = data.code || (token ? 'session_expired' : 'invalid_credentials');
        err.status = 401;
        throw err;
    }

    if (!res.ok) {
        const err = new Error(data.error || 'Serverfehler');
        err.code = data.code;
        err.status = res.status;
        throw err;
    }
    return data;
}

export { getToken, setToken, clearToken, apiFetch };
