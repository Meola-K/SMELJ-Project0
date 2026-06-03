import { apiFetch, setToken, clearToken, getToken } from './api.js';
import { registerRoute, onNavigate, navigateTo, startRouter, setCurrentUserProvider } from './router.js';
import { showToast, toast, openModal, closeModal as utilsCloseModal, initModal, initModalSystem, confirmModal } from './utils.js';
import { makeSortFn, setSortHeader, bindSortHeaders, filterByText, filterByValue, updateCountBadge } from './tableHelpers.js';

// ── DOM References ──────────────────────────────────────────
const pageLogin = document.getElementById('page-login');
const appShell = document.getElementById('app-shell');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');

// Sidebar
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const btnHamburger = document.getElementById('btn-hamburger');
const sidebarNav = document.getElementById('sidebar-nav');
const sidebarUsername = document.getElementById('sidebar-username');
const sidebarRole = document.getElementById('sidebar-role');
const sidebarAvatar = document.getElementById('sidebar-avatar');

// Dashboard
const btnStamp = document.getElementById('btn-stamp');
const btnStampText = document.getElementById('btn-stamp-text');
const stampSpinner = document.getElementById('stamp-spinner');
const stampIndicator = document.getElementById('stamp-indicator');
const stampStatusText = document.getElementById('stamp-status-text');
const stampLastTime = document.getElementById('stamp-last-time');
const stampLastLabel = document.getElementById('stamp-last-label');
const stampLastClock = document.getElementById('stamp-last-clock');
const stampWarning = document.getElementById('stamp-warning');
const stampWarningText = document.getElementById('stamp-warning-text');
const todayMinutesEl = document.getElementById('today-minutes');
const monthBalanceEl = document.getElementById('month-balance');
const todayStampsList = document.getElementById('today-stamps-list');
const historyTbody = document.getElementById('history-tbody');
const historyFrom = document.getElementById('history-from');
const historyTo = document.getElementById('history-to');
const btnLoadHistory = document.getElementById('btn-load-history');

// Admin / User CRUD
const modal = document.getElementById('modal-create-user');
const btnOpenModal = document.getElementById('btn-open-create-user');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const formCreateUser = document.getElementById('form-create-user');
const createError = document.getElementById('create-user-error');
const createSuccess = document.getElementById('create-user-success');
const usersTbody = document.getElementById('users-tbody');

const cuFirstname = document.getElementById('cu-firstname');
const cuLastname = document.getElementById('cu-lastname');
const cuEmail = document.getElementById('cu-email');
const cuPassword = document.getElementById('cu-password');
const cuRole = document.getElementById('cu-role');
const cuGroup = document.getElementById('cu-group');
const cuSupervisor = document.getElementById('cu-supervisor');
const cuEmailHint = document.getElementById('cu-email-hint');

let currentUser = null;
let allUsers = [];
let allGroups = [];
let isStampedIn = false;
let todayTimer = null;
let liveBaseMinutes = 0;
let liveBaseTimestamp = 0;

// ── Rollenbasierte Navigation ───────────────────────────────
const roleLabelsMap = { admin: 'Admin', vorgesetzter: 'Vorgesetzter', arbeiter: 'Mitarbeiter' };

function updateSidebarForRole(role) {
    sidebarNav.querySelectorAll('.sidebar-link[data-roles]').forEach(link => {
        const allowed = link.dataset.roles.split(',');
        link.classList.toggle('hidden', !allowed.includes(role));
    });
}

function updateSidebarUser() {
    const name = currentUser.first_name || currentUser.firstName;
    const last = currentUser.last_name || currentUser.lastName;
    sidebarUsername.textContent = `${name} ${last}`;
    sidebarRole.textContent = roleLabelsMap[currentUser.role] || currentUser.role;
    sidebarAvatar.textContent = `${(name || '?')[0]}${(last || '?')[0]}`.toUpperCase();
}

// ── Sidebar Active Link ─────────────────────────────────────
onNavigate((routeName) => {
    sidebarNav.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === routeName);
    });
    if (routeName !== 'dashboard') clearInterval(todayTimer);
});

// ── Mobile Sidebar Toggle ───────────────────────────────────
function openSidebar() {
    sidebar.classList.add('is-open');
    sidebarOverlay.classList.remove('hidden');
    btnHamburger.classList.add('is-active');
    btnHamburger.setAttribute('aria-expanded', 'true');
    btnHamburger.setAttribute('aria-label', 'Menü schließen');
}

function closeSidebar() {
    sidebar.classList.remove('is-open');
    sidebarOverlay.classList.add('hidden');
    btnHamburger.classList.remove('is-active');
    btnHamburger.setAttribute('aria-expanded', 'false');
    btnHamburger.setAttribute('aria-label', 'Menü öffnen');
}

btnHamburger.addEventListener('click', () => {
    sidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
});

sidebarOverlay.addEventListener('click', closeSidebar);

// Sidebar-Links: auf Mobile nach Klick schließen
sidebarNav.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-link');
    if (link && window.innerWidth <= 768) {
        closeSidebar();
    }
});

// ── SCRUM-325: Sidebar einklappen (Desktop) + Persistenz ────
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
const SIDEBAR_STATE_KEY = 'zs_sidebar';

// Im eingeklappten Zustand das Label als Tooltip am Icon zeigen
function setSidebarLinkTitles(collapsed) {
    sidebarNav.querySelectorAll('.sidebar-link').forEach(link => {
        const label = link.querySelector('span:not(.sidebar-badge)');
        if (collapsed && label) {
            link.setAttribute('title', label.textContent.trim());
        } else {
            link.removeAttribute('title');
        }
    });
}

function applySidebarCollapsed(collapsed) {
    appShell.classList.toggle('sidebar-collapsed', collapsed);
    btnSidebarCollapse.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen';
    btnSidebarCollapse.setAttribute('aria-label', label);
    btnSidebarCollapse.setAttribute('title', label);
    setSidebarLinkTitles(collapsed);
}

btnSidebarCollapse.addEventListener('click', () => {
    const collapsed = !appShell.classList.contains('sidebar-collapsed');
    applySidebarCollapsed(collapsed);
    try { localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) {}
});

// Gespeicherten Zustand beim Laden wiederherstellen
applySidebarCollapsed(localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed');

// ── Routes registrieren ─────────────────────────────────────
registerRoute('dashboard', {
    pageId: 'page-dashboard',
    onEnter: loadDashboard,
});

// SCRUM-331/332: Mitarbeiter-Funktionen als eigene Routen (für alle Rollen verfügbar)
registerRoute('stempeln', {
    pageId: 'page-stempeln',
    onEnter: loadStamping,
    roles: ['admin', 'vorgesetzter', 'arbeiter'],
});

registerRoute('antraege', {
    pageId: 'page-antraege',
    onEnter: loadRequestsPage,
    roles: ['admin', 'vorgesetzter', 'arbeiter'],
});

registerRoute('historie', {
    pageId: 'page-historie',
    onEnter: loadHistoryPage,
    roles: ['admin', 'vorgesetzter', 'arbeiter'],
});

registerRoute('profil', {
    pageId: 'page-profil',
    onEnter: loadMyWorkRules,
    roles: ['admin', 'vorgesetzter', 'arbeiter'],
});

registerRoute('team', {
    pageId: 'page-team',
    onEnter: loadTeamPage,
    roles: ['admin', 'vorgesetzter'],
});

registerRoute('groups', {
    pageId: 'page-groups',
    onEnter: loadGroupsPage,
    roles: ['admin'],
});

registerRoute('admin', {
    pageId: 'page-admin',
    onEnter: () => { loadUsers(); loadGroups(); },
    roles: ['admin', 'vorgesetzter'],
});

registerRoute('requests-overview', {
    pageId: 'page-requests-overview',
    onEnter: loadRequestsOverview,
    roles: ['admin', 'vorgesetzter'],
});

// ── Login ───────────────────────────────────────────────────
const formLogin = document.getElementById('form-login');

// SCRUM-288: Backend-Error-Code → deutsche User-Meldung
function mapAuthErrorCode(code, fallback) {
    switch (code) {
        case 'invalid_credentials':  return 'E-Mail oder Passwort falsch.';
        case 'account_disabled':     return 'Konto deaktiviert, bitte Admin kontaktieren.';
        case 'missing_credentials':  return 'Bitte E-Mail und Passwort eingeben.';
        case 'session_expired':      return 'Sitzung abgelaufen, bitte erneut anmelden.';
        case 'forbidden':            return 'Keine Berechtigung.';
        default:                     return fallback || 'Anmeldung fehlgeschlagen.';
    }
}

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
    loginError.focus();
}

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    // Clientseitige Vorprüfung – damit der User nicht erst auf den Server warten muss.
    if (!email || !password) {
        showLoginError('Bitte E-Mail und Passwort eingeben.');
        return;
    }

    try {
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        setToken(data.token);
        currentUser = data.user;
        setupSocket(data.token);
        showApp();
    } catch (err) {
        showLoginError(mapAuthErrorCode(err.code, err.message));
    }
});

// ── Logout ──────────────────────────────────────────────────
btnLogout.addEventListener('click', () => {
    if (socket) { socket.disconnect(); socket = null; }
    clearToken();
    currentUser = null;
    clearInterval(todayTimer);
    clearInterval(window._pendingBadgeTimer);
    appShell.classList.add('hidden');
    pageLogin.classList.remove('hidden');
    closeSidebar();
    window.location.hash = '';
});

// 401 Auto-Logout (Token abgelaufen oder ungültig) – SCRUM-288
window.addEventListener('auth:logout', (e) => {
    currentUser = null;
    clearInterval(todayTimer);
    if (window._pendingBadgeTimer) clearInterval(window._pendingBadgeTimer);
    if (typeof socket !== 'undefined' && socket) { try { socket.disconnect(); } catch {} }
    appShell.classList.add('hidden');
    pageLogin.classList.remove('hidden');
    closeSidebar();
    window.location.hash = '';
    if (e.detail?.reason === 'session_expired') {
        showToast('Sitzung abgelaufen', 'Bitte erneut anmelden.', 'warning');
        showLoginError(mapAuthErrorCode('session_expired'));
    }
});

// ── Auto-Login ──────────────────────────────────────────────
(async function init() {
    const token = getToken();
    if (!token) return;
    try {
        const data = await apiFetch('/auth/me');
        currentUser = data;
        setupSocket(getToken());
        showApp();
    } catch {
        clearToken();
    }
})();

// ── Show App ────────────────────────────────────────────────
function showApp() {
    pageLogin.classList.add('hidden');
    appShell.classList.remove('hidden');

    updateSidebarUser();
    updateSidebarForRole(currentUser.role);

    // Rollen-Provider für Router registrieren
    setCurrentUserProvider(() => currentUser);

    if (currentUser.role === 'admin' || currentUser.role === 'vorgesetzter') {
        updateSidebarPendingBadge();
        clearInterval(window._pendingBadgeTimer);
        window._pendingBadgeTimer = setInterval(updateSidebarPendingBadge, 30000);
    }

    setupSocket();

    // Router starten (setzt auch die initiale Route)
    startRouter('dashboard');
}

async function updateSidebarPendingBadge() {
    try {
        const reqs = await apiFetch('/requests/pending');
        const badge = document.getElementById('sidebar-pending-badge');
        if (!badge) return;
        if (reqs.length > 0) {
            badge.textContent = reqs.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch {}
}

// showToast, toast, openModal, closeModal, confirmModal → importiert aus ./utils.js

let socket = null;
function setupSocket() {
    if (typeof io === 'undefined') return;
    if (socket) socket.disconnect();
    socket = io({ auth: { token: getToken() } });

    socket.on('request:reviewed', async (data) => {
        const statusLabel = data.status === 'approved' ? 'genehmigt' : 'abgelehnt';
        const type = data.status === 'approved' ? 'success' : 'error';
        showToast(`Antrag ${statusLabel}`, `Bearbeitet von ${data.reviewerName}`, type);
        // Kalender-Cache invalidieren: frische Daten laden und Grid neu zeichnen,
        // falls der Kalender gerade sichtbar ist
        await loadCalendarRequests();
        if (document.getElementById('page-calendar') &&
            !document.getElementById('page-calendar').classList.contains('hidden')) {
            renderCalendar();
        }
    });

    socket.on('request:new', () => {
        if (currentUser.role === 'admin' || currentUser.role === 'vorgesetzter') {
            updateSidebarPendingBadge();
            showToast('Neuer Antrag', 'Ein Mitarbeiter hat einen neuen Antrag eingereicht', 'info');
        }
    });

    socket.on('correction:reviewed', (data) => {
        const statusLabel = data.status === 'approved' ? 'genehmigt' : 'abgelehnt';
        const type = data.status === 'approved' ? 'success' : 'error';
        showToast(`Korrektur ${statusLabel}`, `Bearbeitet von ${data.reviewerName}`, type);
        if (typeof loadMyCorrections === 'function') loadMyCorrections();
        if (data.status === 'approved' && typeof loadDashboard === 'function') loadDashboard();
    });

    socket.on('correction:new', () => {
        if (currentUser.role === 'admin' || currentUser.role === 'vorgesetzter') {
            showToast('Neue Korrektur', 'Ein Mitarbeiter hat einen Korrekturantrag eingereicht', 'info');
            if (typeof loadPendingCorrections === 'function') loadPendingCorrections();
        }
    });

    socket.on('stamp:update', (data) => {
        if (!currentUser || data.userId === currentUser.id) return;
        if (currentUser.role !== 'admin' && currentUser.role !== 'vorgesetzter') return;
        const fullName = `${data.user?.firstName ?? ''} ${data.user?.lastName ?? ''}`.trim() || 'Mitarbeiter';
        const action = data.type === 'in' ? 'eingestempelt' : 'ausgestempelt';
        showToast('Stempel-Update', `${fullName} hat sich ${action}`, 'info');
    });

    socket.on('nfc:assigned', async () => {
        showToast('NFC zugewiesen', 'Tag wurde erfolgreich zugewiesen', 'success');
        try {
            allUsers = await apiFetch('/admin/users');
            populateDeviceDropdowns();
            renderNfcTable();
            await loadDevices();
            const statusEl = document.getElementById('assign-status');
            if (statusEl) {
                statusEl.className = 'alert alert-success';
                statusEl.textContent = 'NFC-Tag erfolgreich zugewiesen!';
                statusEl.classList.remove('hidden');
            }
        } catch {}
    });
}

// ── Helpers ─────────────────────────────────────────────────
function formatMinutes(mins, withSign = false) {
    const intMins = Math.floor(mins);
    const sign = intMins < 0 ? '-' : (withSign ? '+' : '');
    const abs = Math.abs(intMins);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime(dateStr) {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    const yy = String(d.getFullYear()).slice(-2);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${yy}`;
}

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Datums-Konvertierung dd.mm.yy <-> ISO ─────────────────────
function isoToDisplay(isoStr) {
    // "2026-04-16" -> "16.04.26"
    if (!isoStr) return '';
    const [y, m, d] = isoStr.split('-');
    return `${d}.${m}.${y.slice(-2)}`;
}

function displayToIso(displayStr) {
    // "16.04.26" -> "2026-04-16"
    if (!displayStr) return '';
    const parts = displayStr.split('.');
    if (parts.length !== 3) return '';
    const [d, m, yy] = parts;
    const fullYear = parseInt(yy) < 70 ? `20${yy}` : `19${yy}`;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Auto-Punkt-Einfügung bei Datumseingabe
function setupDateInput(inputEl) {
    inputEl.addEventListener('input', () => {
        let v = inputEl.value.replace(/[^\d.]/g, '');
        // Auto-Punkt nach dd und mm
        if (v.length === 2 && !v.includes('.')) v += '.';
        else if (v.length === 5 && v.indexOf('.') === 2 && v.lastIndexOf('.') === 2) v += '.';
        if (v.length > 8) v = v.slice(0, 8);
        inputEl.value = v;
    });
}

// Alle Datums-Inputs initialisieren
document.querySelectorAll('input[pattern="\\d{2}\\.\\d{2}\\.\\d{2}"]').forEach(setupDateInput);

// Kalender-Buttons mit Text-Inputs verbinden
document.querySelectorAll('.date-input-wrap').forEach(wrap => {
    const textInput = wrap.querySelector('input[type="text"]');
    const datePicker = wrap.querySelector('.date-picker-hidden');
    const btn = wrap.querySelector('.btn-date-picker');
    if (!textInput || !datePicker || !btn) return;

    btn.addEventListener('click', () => {
        // Aktuellen Wert ins Date-Input übernehmen
        const iso = displayToIso(textInput.value);
        if (iso) datePicker.value = iso;
        datePicker.showPicker();
    });

    datePicker.addEventListener('change', () => {
        if (datePicker.value) {
            textInput.value = isoToDisplay(datePicker.value);
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
});

// ── Barrierefreiheit: Modal-System aus utils.js ───────────────
// openModal, closeModal (mit Focus-Trap & ESC) → importiert aus ./utils.js
// initModalSystem() registriert den globalen ESC-Handler
initModalSystem();

// Sidebar bei ESC schließen (zusätzlich zum Modal-ESC in utils.js)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
        closeSidebar();
        btnHamburger.focus();
    }
});

// Alias für Abwärtskompatibilität innerhalb dieser Datei
const openModalA11y  = openModal;
const closeModalA11y = utilsCloseModal;


// ── Dashboard ───────────────────────────────────────────────
function startTodayTicker() {
    clearInterval(todayTimer);
    todayTimer = setInterval(() => {
        const live = liveBaseMinutes + (Date.now() - liveBaseTimestamp) / 60000;
        todayMinutesEl.textContent = formatMinutes(live);
    }, 1000);
}

function stopTodayTicker() {
    clearInterval(todayTimer);
    todayTimer = null;
}

// Dashboard: nur Kern-Widgets (Stempel-Status, heutige Arbeitszeit, Zeitkonto, Resturlaub)
async function loadDashboard() {
    try {
        const data = await apiFetch('/stamp/today');
        isStampedIn = data.isStampedIn;
        const lastStamp = data.stamps && data.stamps.length ? data.stamps[data.stamps.length - 1] : null;
        updateStampUI(data.todayMinutes, data.balance, lastStamp);
        loadVacation();

        if (isStampedIn) startTodayTicker();
        else stopTodayTicker();
    } catch (err) {
        console.error(err);
    }
}

// SCRUM-331: Stempeln-Seite – heutige Stempelzeiten
async function loadStamping() {
    try {
        const data = await apiFetch('/stamp/today');
        renderTodayStamps(data.stamps);
    } catch (err) {
        console.error(err);
    }
}

// SCRUM-331: Meine-Anträge-Seite – Anträge und Zeitkorrekturen
function loadRequestsPage() {
    loadMyRequests();
    loadMyCorrections();
}

// SCRUM-331: Stempelhistorie-Seite – Standardzeitraum (aktueller Monat) setzen, falls leer
function loadHistoryPage() {
    if (!historyFrom.value || !historyTo.value) {
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        historyFrom.value = isoToDisplay(firstOfMonth.toISOString().split('T')[0]);
        historyTo.value = isoToDisplay(now.toISOString().split('T')[0]);
    }
    loadHistory();
}

// ── SCRUM-94: Eigene Arbeitsregeln einsehen (nur Lesezugriff) ─
async function loadMyWorkRules() {
    const container = document.getElementById('my-work-rules-content');
    if (!container || !currentUser) return;

    const labels = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    const hhmm = (t) => (t ? String(t).substring(0, 5) : null);
    const hours = (min) => {
        if (min === null || min === undefined) return '–';
        return (min / 60).toFixed(2).replace(/\.?0+$/, '') + ' Std.';
    };

    container.innerHTML = '<p class="text-muted">Lädt...</p>';

    try {
        const data = await apiFetch(`/admin/work-rules/${currentUser.id}`);
        const byWeekday = {};
        (data.rules || []).forEach(r => { byWeekday[r.weekday] = r; });

        const rows = labels.map((label, weekday) => {
            const rule = byWeekday[weekday];
            const allowed = !!(rule && rule.work_allowed);
            const start = allowed ? hhmm(rule.core_start) : null;
            const end = allowed ? hhmm(rule.core_end) : null;
            const core = (start && end) ? `${start} – ${end}` : '–';
            const max = allowed ? hours(rule.max_daily_minutes) : '–';
            return `
                <tr>
                    <td>${label}</td>
                    <td>${core}</td>
                    <td>${max}</td>
                    <td>
                        <span class="badge ${allowed ? 'badge-active' : 'badge-inactive'}">
                            ${allowed ? 'Ja' : 'Nein'}
                        </span>
                    </td>
                </tr>`;
        }).join('');

        const lim = data.limits || {};
        const limWeekly = lim.max_weekly_minutes ?? null;
        const limOver = lim.max_overtime_minutes ?? null;
        const limUnder = lim.max_undertime_minutes ?? null;

        container.innerHTML = `
            <table class="table work-rules-view-table">
                <thead>
                    <tr>
                        <th>Tag</th>
                        <th>Kernzeit</th>
                        <th>Max-Stunden</th>
                        <th>Erlaubt</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <h4 class="wr-limits-title">Meine Zeitlimits</h4>
            <div class="wr-limits">
                <div class="wr-limit">
                    <span class="wr-limit-value">${hours(limWeekly)}</span>
                    <span class="wr-limit-label">Max. Wochenstunden</span>
                </div>
                <div class="wr-limit">
                    <span class="wr-limit-value">${hours(limOver)}</span>
                    <span class="wr-limit-label">Max. Überstunden</span>
                </div>
                <div class="wr-limit">
                    <span class="wr-limit-value">${hours(limUnder)}</span>
                    <span class="wr-limit-label">Max. Minusstunden</span>
                </div>
            </div>`;
    } catch (err) {
        console.error(err);
        container.innerHTML = '<p class="text-muted">Arbeitsregeln konnten nicht geladen werden.</p>';
    }
}

function updateStampUI(todayMins, balance, lastStamp) {
    stampIndicator.className = `stamp-indicator ${isStampedIn ? 'in' : 'out'}`;
    stampStatusText.textContent = isStampedIn ? 'Eingestempelt' : 'Ausgestempelt';
    btnStamp.disabled = false;
    btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
    btnStamp.className = `btn btn-stamp ${isStampedIn ? 'stamp-out' : 'stamp-in'}`;
    todayMinutesEl.textContent = formatMinutes(todayMins);
    monthBalanceEl.textContent = formatMinutes(balance, true);
    monthBalanceEl.className = `stamp-info-value ${balance >= 0 ? 'positive' : 'negative'}`;
    liveBaseMinutes = todayMins;
    liveBaseTimestamp = Date.now();

    if (lastStamp) {
        const time = formatTime(lastStamp.stamp_time);
        stampLastLabel.textContent = lastStamp.type === 'in' ? 'Eingestempelt um' : 'Ausgestempelt um';
        stampLastClock.textContent = time;
        stampLastTime.classList.remove('hidden');
    } else {
        stampLastTime.classList.add('hidden');
    }
}

function showStampWarning(text) {
    stampWarningText.textContent = text;
    stampWarning.classList.remove('hidden');
    stampWarning.style.animation = 'none';
    stampWarning.offsetHeight;
    stampWarning.style.animation = '';
}

function hideStampWarning() {
    stampWarning.classList.add('hidden');
}

function renderTodayStamps(stamps) {
    if (!stamps || stamps.length === 0) {
        todayStampsList.innerHTML = '<p class="text-muted">Heute noch keine Stempelzeiten.</p>';
        return;
    }
    const sourceLabel = { web: 'Web', arduino: 'NFC', app: 'App' };
    todayStampsList.innerHTML = `
        <table class="table stamps-table">
            <thead>
                <tr>
                    <th>Typ</th>
                    <th>Uhrzeit</th>
                    <th>Quelle</th>
                </tr>
            </thead>
            <tbody>
                ${stamps.map(s => `
                    <tr>
                        <td>
                            <span class="badge ${s.type === 'in' ? 'badge-stamp-in' : 'badge-stamp-out'}">
                                ${s.type === 'in' ? 'Einstempeln' : 'Ausstempeln'}
                            </span>
                        </td>
                        <td class="stamp-time-cell">${formatTime(s.stamp_time)}</td>
                        <td>${sourceLabel[s.source] || s.source || '–'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

btnStamp.addEventListener('click', async () => {
    btnStamp.disabled = true;
    hideStampWarning();
    stampSpinner.classList.remove('hidden');
    btnStampText.textContent = 'Wird verarbeitet...';

    try {
        const result = await apiFetch('/stamp', {
            method: 'POST',
            body: JSON.stringify({ source: 'web' }),
        });

        stampSpinner.classList.add('hidden');

        if (!result.success) {
            showStampWarning(result.warning || 'Stempeln fehlgeschlagen');
            btnStamp.disabled = false;
            btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
            return;
        }

        if (result.warning) {
            showStampWarning(result.warning);
        }

        isStampedIn = result.type === 'in';

        const fresh = await apiFetch('/stamp/today');
        const freshLast = fresh.stamps && fresh.stamps.length ? fresh.stamps[fresh.stamps.length - 1] : null;
        updateStampUI(fresh.todayMinutes, fresh.balance, freshLast);
        renderTodayStamps(fresh.stamps);

        if (isStampedIn) startTodayTicker();
        else stopTodayTicker();
    } catch (err) {
        stampSpinner.classList.add('hidden');
        showStampWarning('Fehler: ' + err.message);
        btnStamp.disabled = false;
        btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
    }
});

// ── History ─────────────────────────────────────────────────
async function loadHistory() {
    const from = displayToIso(historyFrom.value);
    const to = displayToIso(historyTo.value);
    if (!from || !to) return;

    try {
        const stamps = await apiFetch(`/stamp/history?from=${from}&to=${to}`);
        renderHistory(stamps);
    } catch (err) {
        console.error(err);
    }
}

btnLoadHistory.addEventListener('click', loadHistory);

// ── History Sort ─────────────────────────────────────────────
let historySortDir = 'desc'; // Standard: Datum absteigend
let historyStampsCache = [];  // Stempel zwischenspeichern für Umsortierung

const thSortDate = document.getElementById('th-sort-date');
thSortDate.addEventListener('click', () => {
    historySortDir = historySortDir === 'desc' ? 'asc' : 'desc';
    thSortDate.className = `th-sortable th-sort-${historySortDir}`;
    thSortDate.setAttribute('aria-sort', historySortDir === 'desc' ? 'descending' : 'ascending');
    renderHistory(historyStampsCache);
});

function renderHistory(stamps) {
    historyStampsCache = stamps;
    const days = {};
    stamps.forEach(s => {
        const day = new Date(s.stamp_time).toISOString().split('T')[0];
        if (!days[day]) days[day] = [];
        days[day].push(s);
    });

    const rows = [];
    const sortedDays = Object.keys(days).sort();
    if (historySortDir === 'desc') sortedDays.reverse();

    sortedDays.forEach(day => {
        const entries = days[day];
        for (let i = 0; i < entries.length; i += 2) {
            const stampIn = entries[i]?.type === 'in' ? entries[i] : null;
            const stampOut = entries[i + 1]?.type === 'out' ? entries[i + 1] : null;
            let duration = '–';

            if (stampIn && stampOut) {
                const diff = (new Date(stampOut.stamp_time) - new Date(stampIn.stamp_time)) / 60000;
                duration = formatMinutes(diff);
            }

            rows.push(`
                <tr>
                    <td>${formatDate(day)}</td>
                    <td>${stampIn ? formatTime(stampIn.stamp_time) : '–'}</td>
                    <td>${stampOut ? formatTime(stampOut.stamp_time) : '–'}</td>
                    <td>${duration}</td>
                </tr>
            `);
        }

        if (entries.length === 0) {
            rows.push(`<tr><td>${formatDate(day)}</td><td>–</td><td>–</td><td>–</td></tr>`);
        }
    });

    if (rows.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine Stempelzeiten im gewählten Zeitraum.</td></tr>';
    } else {
        historyTbody.innerHTML = rows.join('');
    }
}

// ── Users (Admin) ───────────────────────────────────────────

// Sort-/Filter-State für Benutzertabelle
const usersSortState = { key: 'last_name', dir: 'asc' };
const usersFilterState = { group: '', role: '', status: '', text: '' };

async function loadUsers() {
    try {
        allUsers = await apiFetch('/admin/users');
        initUsersFilterBar();
        applyUsersFilter();
    } catch (err) {
        console.error('Fehler beim Laden der Benutzer:', err);
    }
}

function initUsersFilterBar() {
    // Gruppen-Dropdown befüllen (einmalig, danach nur aktualisieren)
    const groupSel = document.getElementById('users-filter-group');
    if (groupSel && groupSel.options.length <= 1) {
        const groups = [...new Map(allUsers.filter(u => u.group_name).map(u => [u.group_id, u.group_name])).entries()];
        groups.sort((a, b) => a[1].localeCompare(b[1]));
        groups.forEach(([id, name]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            groupSel.appendChild(opt);
        });
    }

    // Filter-Event-Listener (nur einmalig binden)
    const bar = document.getElementById('users-filter-bar');
    if (bar && !bar.dataset.bound) {
        bar.dataset.bound = '1';
        document.getElementById('users-filter-group')?.addEventListener('change', applyUsersFilter);
        document.getElementById('users-filter-role')?.addEventListener('change', applyUsersFilter);
        document.getElementById('users-filter-status')?.addEventListener('change', applyUsersFilter);
        document.getElementById('users-filter-text')?.addEventListener('input', applyUsersFilter);
        document.getElementById('btn-reset-users-filter')?.addEventListener('click', () => {
            const g = document.getElementById('users-filter-group');
            const r = document.getElementById('users-filter-role');
            const s = document.getElementById('users-filter-status');
            const t = document.getElementById('users-filter-text');
            if (g) g.value = '';
            if (r) r.value = '';
            if (s) s.value = '';
            if (t) t.value = '';
            applyUsersFilter();
        });
    }

    // Sort-Header initialisieren
    const thead = document.querySelector('#users-table thead');
    if (thead && !thead.dataset.sortBound) {
        thead.dataset.sortBound = '1';
        bindSortHeaders(thead, usersSortState, () => applyUsersFilter());
        // Initialzustand setzen
        const th = thead.querySelector(`th[data-sort-key="${usersSortState.key}"]`);
        if (th) setSortHeader(th, usersSortState.dir);
    }
}

function applyUsersFilter() {
    const groupSel  = document.getElementById('users-filter-group');
    const roleSel   = document.getElementById('users-filter-role');
    const statusSel = document.getElementById('users-filter-status');
    const textInp   = document.getElementById('users-filter-text');

    usersFilterState.group  = groupSel?.value  || '';
    usersFilterState.role   = roleSel?.value   || '';
    usersFilterState.status = statusSel?.value || '';
    usersFilterState.text   = textInp?.value   || '';

    let filtered = [...allUsers];
    if (usersFilterState.group)  filtered = filtered.filter(u => String(u.group_id) === usersFilterState.group);
    if (usersFilterState.role)   filtered = filterByValue(filtered, 'role', usersFilterState.role);
    if (usersFilterState.status !== '') {
        const activeVal = usersFilterState.status === 'aktiv';
        filtered = filtered.filter(u => Boolean(u.active) === activeVal);
    }
    if (usersFilterState.text) {
        filtered = filterByText(filtered, usersFilterState.text, ['first_name', 'last_name', 'email']);
    }

    // Sortierung
    filtered.sort(makeSortFn(usersSortState.key, usersSortState.dir));

    renderUsersTable(filtered);
    updateCountBadge(document.getElementById('users-count-badge'), filtered.length);
}

function renderUsersTable(users) {
    const data = users ?? allUsers;
    const roleLabels = { admin: 'Admin', vorgesetzter: 'Vorgesetzter', arbeiter: 'Mitarbeiter' };
    const uid = currentUser.id;
    usersTbody.innerHTML = data
        .map(
            (u) => `
        <tr>
            <td data-label="Name">${esc(u.first_name)} ${esc(u.last_name)}</td>
            <td class="col-hide-sm" data-label="E-Mail">${esc(u.email)}</td>
            <td data-label="Rolle"><span class="badge badge-role">${roleLabels[u.role] || u.role}</span></td>
            <td class="col-hide-md" data-label="Gruppe">${esc(u.group_name || '–')}</td>
            <td class="col-hide-md" data-label="Vorgesetzter">${esc(u.supervisor_name || '–')}</td>
            <td data-label="Status"><span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Aktiv' : 'Inaktiv'}</span></td>
            <td class="actions-cell">
                <button class="btn btn-sm" onclick="window._editUser(${u.id})">Bearbeiten</button>
                <button class="btn btn-sm" onclick="window._editWorkRules(${u.id})">Arbeitsregeln</button>
                ${u.id !== uid ? (u.active
                    ? `<button class="btn btn-sm btn-danger" onclick="window._deactivateUser(${u.id}, '${esc(u.first_name)} ${esc(u.last_name)}')">Deaktivieren</button>`
                    : `<button class="btn btn-sm btn-success" onclick="window._reactivateUser(${u.id}, '${esc(u.first_name)} ${esc(u.last_name)}')">Aktivieren</button>`
                ) : ''}
            </td>
        </tr>`
        )
        .join('');
}

async function loadGroups() {
    try {
        allGroups = await apiFetch('/admin/groups');
    } catch (err) {
        console.error('Fehler beim Laden der Gruppen:', err);
    }
}

function populateDropdowns() {
    cuGroup.innerHTML = '<option value="">-- Keine Gruppe --</option>';
    allGroups.forEach((g) => {
        cuGroup.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
    });

    cuSupervisor.innerHTML = '<option value="">-- Kein Vorgesetzter --</option>';
    allUsers
        .filter((u) => u.role === 'vorgesetzter' || u.role === 'admin')
        .forEach((u) => {
            cuSupervisor.innerHTML += `<option value="${u.id}">${esc(u.first_name)} ${esc(u.last_name)}</option>`;
        });
}

btnOpenModal.addEventListener('click', () => {
    formCreateUser.reset();
    createError.classList.add('hidden');
    createSuccess.classList.add('hidden');
    cuEmailHint.textContent = '';
    cuEmailHint.className = 'form-hint';
    populateDropdowns();
    openModalA11y(modal);
});

btnCloseModal.addEventListener('click', closeModal);
btnCancelModal.addEventListener('click', closeModal);
document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

function closeModal() {
    closeModalA11y(modal);
}

let emailCheckTimer = null;
cuEmail.addEventListener('input', () => {
    clearTimeout(emailCheckTimer);
    cuEmailHint.textContent = '';
    cuEmailHint.className = 'form-hint';
    const val = cuEmail.value.trim().toLowerCase();
    if (!val) return;
    emailCheckTimer = setTimeout(() => {
        const duplicate = allUsers.find((u) => u.email.toLowerCase() === val);
        if (duplicate) {
            cuEmailHint.textContent = 'Diese E-Mail ist bereits vergeben.';
            cuEmailHint.className = 'form-hint error';
        } else {
            cuEmailHint.textContent = 'E-Mail verfügbar.';
            cuEmailHint.className = 'form-hint success';
        }
    }, 300);
});

formCreateUser.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.classList.add('hidden');
    createSuccess.classList.add('hidden');

    const email = cuEmail.value.trim();

    if (allUsers.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
        createError.textContent = 'Diese E-Mail ist bereits vergeben.';
        createError.classList.remove('hidden');
        return;
    }

    const payload = {
        email,
        password: cuPassword.value,
        firstName: cuFirstname.value.trim(),
        lastName: cuLastname.value.trim(),
        role: cuRole.value,
        groupId: cuGroup.value ? parseInt(cuGroup.value) : null,
        supervisorId: cuSupervisor.value ? parseInt(cuSupervisor.value) : null,
    };

    try {
        const btn = document.getElementById('btn-submit-user');
        btn.disabled = true;
        btn.textContent = 'Erstelle...';

        await apiFetch('/admin/users', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        createSuccess.textContent = 'Benutzer erfolgreich erstellt!';
        createSuccess.classList.remove('hidden');
        showToast('Benutzer erstellt', 'Der neue Benutzer wurde erfolgreich angelegt.', 'success');
        formCreateUser.reset();
        cuEmailHint.textContent = '';

        await loadUsers();

        setTimeout(() => {
            closeModal();
            createSuccess.classList.add('hidden');
        }, 1200);

        btn.disabled = false;
        btn.textContent = 'Benutzer erstellen';
    } catch (err) {
        createError.textContent = err.message;
        createError.classList.remove('hidden');
        showToast('Fehler', err.message, 'error');
        const btn = document.getElementById('btn-submit-user');
        btn.disabled = false;
        btn.textContent = 'Benutzer erstellen';
    }
});

// ── Edit User Modal ─────────────────────────────────────────
const editModal = document.getElementById('modal-edit-user');
const formEditUser = document.getElementById('form-edit-user');
const editError = document.getElementById('edit-user-error');
const editSuccess = document.getElementById('edit-user-success');
const euId = document.getElementById('eu-id');
const euFirstname = document.getElementById('eu-firstname');
const euLastname = document.getElementById('eu-lastname');
const euEmail = document.getElementById('eu-email');
const euPassword = document.getElementById('eu-password');
const euRole = document.getElementById('eu-role');
const euGroup = document.getElementById('eu-group');
const euSupervisor = document.getElementById('eu-supervisor');
const euActive = document.getElementById('eu-active');
const euEmailHint = document.getElementById('eu-email-hint');

window._editUser = function (id) {
    const user = allUsers.find((u) => u.id === id);
    if (!user) return;

    editError.classList.add('hidden');
    editSuccess.classList.add('hidden');
    euEmailHint.textContent = '';
    euEmailHint.className = 'form-hint';

    euId.value = user.id;
    euFirstname.value = user.first_name;
    euLastname.value = user.last_name;
    euEmail.value = user.email;
    euPassword.value = '';
    euRole.value = user.role;
    euActive.value = user.active ? '1' : '0';

    euGroup.innerHTML = '<option value="">-- Keine Gruppe --</option>';
    allGroups.forEach((g) => {
        euGroup.innerHTML += `<option value="${g.id}"${g.id === user.group_id ? ' selected' : ''}>${esc(g.name)}</option>`;
    });

    euSupervisor.innerHTML = '<option value="">-- Kein Vorgesetzter --</option>';
    allUsers
        .filter((u) => (u.role === 'vorgesetzter' || u.role === 'admin') && u.id !== id)
        .forEach((u) => {
            euSupervisor.innerHTML += `<option value="${u.id}"${u.id === user.supervisor_id ? ' selected' : ''}>${esc(u.first_name)} ${esc(u.last_name)}</option>`;
        });

    openModalA11y(editModal);
};

document.getElementById('btn-close-edit-modal').addEventListener('click', closeEditModal);
document.getElementById('btn-cancel-edit-modal').addEventListener('click', closeEditModal);
document.querySelector('.modal-backdrop-edit')?.addEventListener('click', closeEditModal);

function closeEditModal() {
    closeModalA11y(editModal);
}

let editEmailTimer = null;
euEmail.addEventListener('input', () => {
    clearTimeout(editEmailTimer);
    euEmailHint.textContent = '';
    euEmailHint.className = 'form-hint';
    const val = euEmail.value.trim().toLowerCase();
    const currentId = parseInt(euId.value);
    if (!val) return;
    editEmailTimer = setTimeout(() => {
        const duplicate = allUsers.find((u) => u.email.toLowerCase() === val && u.id !== currentId);
        if (duplicate) {
            euEmailHint.textContent = 'Diese E-Mail ist bereits vergeben.';
            euEmailHint.className = 'form-hint error';
        } else {
            euEmailHint.textContent = 'E-Mail verfügbar.';
            euEmailHint.className = 'form-hint success';
        }
    }, 300);
});

formEditUser.addEventListener('submit', async (e) => {
    e.preventDefault();
    editError.classList.add('hidden');
    editSuccess.classList.add('hidden');

    const userId = parseInt(euId.value);
    const email = euEmail.value.trim();

    if (allUsers.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== userId)) {
        editError.textContent = 'Diese E-Mail ist bereits vergeben.';
        editError.classList.remove('hidden');
        return;
    }

    const payload = {
        email,
        firstName: euFirstname.value.trim(),
        lastName: euLastname.value.trim(),
        role: euRole.value,
        groupId: euGroup.value ? parseInt(euGroup.value) : null,
        supervisorId: euSupervisor.value ? parseInt(euSupervisor.value) : null,
        active: euActive.value === '1',
    };

    if (euPassword.value) {
        if (euPassword.value.length < 6) {
            editError.textContent = 'Passwort muss mindestens 6 Zeichen haben.';
            editError.classList.remove('hidden');
            return;
        }
        payload.password = euPassword.value;
    }

    try {
        const btn = document.getElementById('btn-submit-edit');
        btn.disabled = true;
        btn.textContent = 'Speichere...';

        await apiFetch(`/admin/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });

        editSuccess.textContent = 'Benutzer erfolgreich aktualisiert!';
        editSuccess.classList.remove('hidden');
        showToast('Gespeichert', 'Benutzerdaten wurden aktualisiert.', 'success');

        await loadUsers();

        setTimeout(() => {
            closeEditModal();
            editSuccess.classList.add('hidden');
        }, 1200);

        btn.disabled = false;
        btn.textContent = 'Speichern';
    } catch (err) {
        editError.textContent = err.message;
        editError.classList.remove('hidden');
        showToast('Fehler', err.message, 'error');
        const btn = document.getElementById('btn-submit-edit');
        btn.disabled = false;
        btn.textContent = 'Speichern';
    }
});

window._deactivateUser = async function (id, name) {
    if (!confirm(`Möchten Sie "${name}" wirklich deaktivieren?\n\nDer Benutzer kann sich danach nicht mehr anmelden, aber die Daten bleiben erhalten.`)) {
        return;
    }
    try {
        await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
        await loadUsers();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

window._reactivateUser = async function (id, name) {
    if (!confirm(`Möchten Sie "${name}" wieder aktivieren?`)) {
        return;
    }
    try {
        await apiFetch(`/admin/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ active: true }),
        });
        await loadUsers();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// ── Vacation ────────────────────────────────────────────────
async function loadVacation() {
    try {
        const data = await apiFetch('/admin/vacation/balance');
        document.getElementById('vacation-year').textContent = data.year;
        document.getElementById('vacation-total').textContent = data.totalDays;
        document.getElementById('vacation-used').textContent = data.usedDays;
        document.getElementById('vacation-remaining').textContent = data.remainingDays;
        const pct = data.totalDays > 0 ? Math.min((data.usedDays / data.totalDays) * 100, 100) : 0;
        document.getElementById('vacation-bar').style.width = `${pct}%`;
        const barWrap = document.getElementById('vacation-bar-wrap');
        if (barWrap) barWrap.setAttribute('aria-valuenow', Math.round(pct));
        const pendingEl = document.getElementById('vacation-pending-text');
        pendingEl.textContent = data.pendingRequests > 0 ? `${data.pendingRequests} offene(r) Urlaubsantrag/-anträge` : '';
    } catch (err) { console.error(err); }
}

// ── Groups Page ─────────────────────────────────────────────
async function loadGroupsPage() {
    try {
        allGroups = await apiFetch('/admin/groups');
        renderGroupsTable();
    } catch (err) { console.error(err); }
}

function renderGroupsTable() {
    const tbody = document.getElementById('groups-tbody');
    if (allGroups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine Gruppen vorhanden.</td></tr>';
        return;
    }
    tbody.innerHTML = allGroups.map(g => `
        <tr>
            <td data-label="Name">${esc(g.name)}</td>
            <td class="col-hide-sm" data-label="Mitglieder">${g.member_count}</td>
            <td class="col-hide-sm" data-label="Erstellt am">${formatDate(g.created_at)}</td>
            <td class="actions-cell">
                <button class="btn btn-sm btn-danger" onclick="window._deleteGroup(${g.id}, '${esc(g.name)}', ${g.member_count})">Löschen</button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('btn-create-group').addEventListener('click', async () => {
    const input = document.getElementById('new-group-name');
    const name = input.value.trim();
    if (!name) return;
    try {
        await apiFetch('/admin/groups', { method: 'POST', body: JSON.stringify({ name }) });
        input.value = '';
        loadGroupsPage();
    } catch (err) { alert('Fehler: ' + err.message); }
});

const deleteGroupModal      = document.getElementById('modal-delete-group');
const deleteGroupMessage    = document.getElementById('delete-group-message');
const deleteGroupOptions    = document.getElementById('delete-group-options');
const deleteGroupTargetWrap = document.getElementById('delete-group-target-wrap');
const deleteGroupTarget     = document.getElementById('delete-group-target');
const deleteGroupError      = document.getElementById('delete-group-error');
const btnConfirmDeleteGroup = document.getElementById('btn-confirm-delete-group');
const btnCancelDeleteGroup  = document.getElementById('btn-cancel-delete-group');
const btnCloseDeleteGroup   = document.getElementById('btn-close-delete-group-modal');

let deleteGroupCtx = null; // { id, memberCount }

function closeDeleteGroupModal() {
    closeModalA11y(deleteGroupModal);
    deleteGroupCtx = null;
}

function updateDeleteGroupConfirmState() {
    if (!deleteGroupCtx) return;
    if (deleteGroupCtx.memberCount === 0) {
        btnConfirmDeleteGroup.disabled = false;
        return;
    }
    const choice = document.querySelector('input[name="delete-group-action"]:checked');
    if (!choice) {
        btnConfirmDeleteGroup.disabled = true;
        return;
    }
    if (choice.value === 'move') {
        btnConfirmDeleteGroup.disabled = !deleteGroupTarget.value;
    } else {
        btnConfirmDeleteGroup.disabled = false;
    }
}

window._deleteGroup = function (id, name, memberCount) {
    deleteGroupCtx = { id, memberCount };
    deleteGroupError.classList.add('hidden');
    deleteGroupError.textContent = '';
    btnConfirmDeleteGroup.disabled = true;

    // Radios zurücksetzen
    document.querySelectorAll('input[name="delete-group-action"]').forEach(r => { r.checked = false; });
    deleteGroupTargetWrap.classList.add('hidden');
    deleteGroupTarget.value = '';

    if (memberCount === 0) {
        // SCRUM-324: leere Gruppen direkt löschbar
        deleteGroupMessage.textContent = `Gruppe "${name}" löschen? Keine Mitarbeiter sind zugeordnet.`;
        deleteGroupOptions.classList.add('hidden');
        btnConfirmDeleteGroup.disabled = false;
    } else {
        deleteGroupMessage.textContent = `Gruppe "${name}" löschen? ${memberCount} Mitarbeiter ${memberCount === 1 ? 'ist' : 'sind'} zugeordnet.`;
        deleteGroupOptions.classList.remove('hidden');

        // Dropdown füllen mit verfügbaren Gruppen (außer der zu löschenden)
        const others = allGroups.filter(g => g.id !== id);
        deleteGroupTarget.innerHTML = '<option value="">-- Bitte wählen --</option>' +
            others.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    }

    openModalA11y(deleteGroupModal);
};

document.querySelectorAll('input[name="delete-group-action"]').forEach(radio => {
    radio.addEventListener('change', () => {
        if (radio.value === 'move' && radio.checked) {
            deleteGroupTargetWrap.classList.remove('hidden');
        } else {
            deleteGroupTargetWrap.classList.add('hidden');
        }
        updateDeleteGroupConfirmState();
    });
});

deleteGroupTarget.addEventListener('change', updateDeleteGroupConfirmState);

btnCancelDeleteGroup.addEventListener('click', closeDeleteGroupModal);
btnCloseDeleteGroup.addEventListener('click', closeDeleteGroupModal);
deleteGroupModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteGroupModal);

btnConfirmDeleteGroup.addEventListener('click', async () => {
    if (!deleteGroupCtx) return;
    const { id, memberCount } = deleteGroupCtx;

    let targetGroupId = null;
    if (memberCount > 0) {
        const choice = document.querySelector('input[name="delete-group-action"]:checked');
        if (!choice) return;
        if (choice.value === 'move') {
            const v = deleteGroupTarget.value;
            if (!v) return;
            targetGroupId = Number(v);
        }
    }

    btnConfirmDeleteGroup.disabled = true;
    try {
        await apiFetch(`/admin/groups/${id}`, {
            method: 'DELETE',
            body: JSON.stringify({ targetGroupId })
        });
        closeDeleteGroupModal();
        loadGroupsPage();
    } catch (err) {
        deleteGroupError.textContent = 'Fehler: ' + err.message;
        deleteGroupError.classList.remove('hidden');
        updateDeleteGroupConfirmState();
    }
});

// ── Team Page ───────────────────────────────────────────────
async function loadTeamPage() {
    const tbody = document.getElementById('team-tbody');
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Lade Daten…</td></tr>';
    try {
        const members = await apiFetch('/admin/team/online');
        renderTeamTable(members);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Fehler: ${esc(err.message)}</td></tr>`;
    }
}

function renderTeamTable(members) {
    const tbody = document.getElementById('team-tbody');

    const present = members.filter(m => m.type === 'in').length;
    const absent  = members.length - present;

    document.getElementById('stat-present').textContent = present;
    document.getElementById('stat-absent').textContent  = absent;
    document.getElementById('stat-total').textContent   = members.length;

    if (members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Keine Mitarbeiter gefunden.</td></tr>';
        return;
    }

    tbody.innerHTML = members.map(m => {
        const isPresent = m.type === 'in';
        const statusBadge = isPresent
            ? '<span class="badge badge-present">Anwesend</span>'
            : '<span class="badge badge-absent">Abwesend</span>';
        const lastAction = m.stamp_time
            ? `${isPresent ? 'Eingestempelt' : 'Ausgestempelt'} ${formatTime(m.stamp_time)}`
            : '–';
        return `
            <tr>
                <td>${esc(m.last_name)}, ${esc(m.first_name)}</td>
                <td>${statusBadge}</td>
                <td>${lastAction}</td>
            </tr>`;
    }).join('');
}

document.getElementById('btn-refresh-team')?.addEventListener('click', loadTeamPage);

// ── Meine Anträge ───────────────────────────────────────────
const requestModal = document.getElementById('modal-new-request');
const btnNewRequest = document.getElementById('btn-new-request');
const btnCloseRequestModal = document.getElementById('btn-close-request-modal');
const btnCancelRequestModal = document.getElementById('btn-cancel-request-modal');
const btnSubmitRequest = document.getElementById('btn-submit-request');
const newRequestError = document.getElementById('new-request-error');
const newRequestSuccess = document.getElementById('new-request-success');
const requestsTbody = document.getElementById('requests-tbody');
const requestsTable = document.getElementById('requests-table');
const requestsEmpty = document.getElementById('requests-empty');

const typeLabels = {
    urlaub: 'Urlaub',
    gleitzeit: 'Gleitzeit',
    homeoffice: 'Homeoffice',
    krank: 'Krank',
    sonderurlaub: 'Sonderurlaub',
};

const reasonLabels = {
    hochzeit: 'Hochzeit',
    geburt: 'Geburt',
    trauerfall: 'Trauerfall',
    umzug: 'Umzug',
    sonstiges: 'Sonstiges',
};

const statusLabels = {
    pending: 'Ausstehend',
    approved: 'Genehmigt',
    denied: 'Abgelehnt',
};

function openRequestModal() {
    newRequestError.classList.add('hidden');
    newRequestSuccess.classList.add('hidden');
    document.getElementById('req-date-hint').classList.add('hidden');
    document.getElementById('req-type').value = 'urlaub';
    const reqFrom = document.getElementById('req-from');
    const reqTo   = document.getElementById('req-to');
    reqFrom.value = '';
    reqTo.value   = '';
    document.getElementById('req-note').value = '';
    // Sonderurlaub-Felder zurücksetzen
    document.getElementById('req-reason').value = '';
    updateReasonVisibility();
    openModalA11y(requestModal);
}

function closeRequestModal() {
    closeModalA11y(requestModal);
}

// Anlass-Feld nur bei Sonderurlaub einblenden, Notiz-Pflicht bei "Sonstiges"
function updateReasonVisibility() {
    const type = document.getElementById('req-type').value;
    const reasonGroup = document.getElementById('req-reason-group');
    const reason = document.getElementById('req-reason').value;
    const noteLabel = document.getElementById('req-note-label');
    const noteInput = document.getElementById('req-note');
    const noteHint  = document.getElementById('req-note-hint-required');

    if (type === 'sonderurlaub') {
        reasonGroup.classList.remove('hidden');
    } else {
        reasonGroup.classList.add('hidden');
    }

    // Notiz wird zur Pflicht, wenn Sonderurlaub + Anlass = sonstiges
    if (type === 'sonderurlaub' && reason === 'sonstiges') {
        noteLabel.textContent = 'Begründung *';
        noteInput.placeholder = 'Bitte Anlass kurz erläutern…';
        noteHint.classList.remove('hidden');
    } else {
        noteLabel.textContent = 'Notiz';
        noteInput.placeholder = 'Optional – z.B. Reiseziel, Arzttermin …';
        noteHint.classList.add('hidden');
    }
}

document.getElementById('req-type').addEventListener('change', updateReasonVisibility);
document.getElementById('req-reason').addEventListener('change', updateReasonVisibility);

btnNewRequest.addEventListener('click', openRequestModal);
btnCloseRequestModal.addEventListener('click', closeRequestModal);
btnCancelRequestModal.addEventListener('click', closeRequestModal);
document.querySelector('.modal-backdrop-request')?.addEventListener('click', closeRequestModal);

// Datum-Von → Datum-Bis Validierung
document.getElementById('req-from').addEventListener('input', validateReqDates);
document.getElementById('req-to').addEventListener('input', validateReqDates);

function validateReqDates() {
    const fromStr = document.getElementById('req-from').value;
    const toStr   = document.getElementById('req-to').value;
    const hint = document.getElementById('req-date-hint');
    const fromIso = displayToIso(fromStr);
    const toIso   = displayToIso(toStr);
    if (fromIso && toIso && toIso < fromIso) {
        hint.textContent = 'Das Enddatum muss nach dem Startdatum liegen.';
        hint.classList.remove('hidden');
        return false;
    }
    hint.classList.add('hidden');
    return true;
}

btnSubmitRequest.addEventListener('click', async () => {
    newRequestError.classList.add('hidden');
    newRequestSuccess.classList.add('hidden');

    const type     = document.getElementById('req-type').value;
    const reason   = document.getElementById('req-reason').value;
    const dateFrom = displayToIso(document.getElementById('req-from').value);
    const dateTo   = displayToIso(document.getElementById('req-to').value);
    const note     = document.getElementById('req-note').value.trim();

    // Client-seitige Validierung
    if (!dateFrom || !dateTo) {
        newRequestError.textContent = 'Bitte Start- und Enddatum im Format dd.mm.yy angeben.';
        newRequestError.classList.remove('hidden');
        return;
    }
    if (dateTo < dateFrom) {
        newRequestError.textContent = 'Das Enddatum muss nach dem Startdatum liegen.';
        newRequestError.classList.remove('hidden');
        return;
    }
    // Sonderurlaub-Validierung
    if (type === 'sonderurlaub') {
        if (!reason) {
            newRequestError.textContent = 'Bitte einen Anlass für den Sonderurlaub auswählen.';
            newRequestError.classList.remove('hidden');
            return;
        }
        if (reason === 'sonstiges' && !note) {
            newRequestError.textContent = 'Bei Anlass „Sonstiges" ist eine Begründung im Notizfeld erforderlich.';
            newRequestError.classList.remove('hidden');
            return;
        }
    }

    btnSubmitRequest.disabled = true;
    btnSubmitRequest.textContent = 'Wird gesendet...';

    try {
        await apiFetch('/requests', {
            method: 'POST',
            body: JSON.stringify({
                type,
                dateFrom,
                dateTo,
                note: note || undefined,
                reason: type === 'sonderurlaub' ? reason : undefined,
            }),
        });
        newRequestSuccess.textContent = 'Antrag erfolgreich eingereicht! Dein Vorgesetzter wurde benachrichtigt.';
        newRequestSuccess.classList.remove('hidden');
        showToast('Antrag gestellt', 'Dein Vorgesetzter wurde benachrichtigt.', 'success');
        await loadMyRequests();
        await loadVacation();
        // Kalender-Cache immer mitaktualisieren, damit er beim naechsten
        // Oeffnen den neuen (pending) Antrag korrekt einfaerbt
        await loadCalendarRequests();
        setTimeout(() => {
            closeRequestModal();
            newRequestSuccess.classList.add('hidden');
        }, 1800);
    } catch (err) {
        // Überlappungsfehler vom Backend klar anzeigen
        newRequestError.textContent = err.message;
        newRequestError.classList.remove('hidden');
        showToast('Fehler', err.message, 'error');
    } finally {
        btnSubmitRequest.disabled = false;
        btnSubmitRequest.textContent = 'Antrag stellen';
    }
});

async function loadMyRequests() {
    try {
        const requests = await apiFetch('/requests/my');
        renderMyRequests(requests);
    } catch (err) {
        console.error('Fehler beim Laden der Anträge:', err);
    }
}

// Helfer: Typ-Badge mit Farbe + ggf. Anlass bei Sonderurlaub
function renderTypeBadge(r) {
    const label = typeLabels[r.type] || r.type;
    const cls   = `badge badge-type type-${r.type}`;
    if (r.type === 'sonderurlaub' && r.reason) {
        return `<span class="${cls}">${esc(label)} – ${esc(reasonLabels[r.reason] || r.reason)}</span>`;
    }
    return `<span class="${cls}">${esc(label)}</span>`;
}

function renderMyRequests(requests) {
    if (!requests || requests.length === 0) {
        requestsTable.classList.add('hidden');
        requestsEmpty.classList.remove('hidden');
        return;
    }
    requestsTable.classList.remove('hidden');
    requestsEmpty.classList.add('hidden');

    requestsTbody.innerHTML = requests.map(r => {
        const statusClass = `badge-${r.status}`;
        const statusLabel = statusLabels[r.status] || r.status;
        const fromDate = formatDate(r.date_from);
        const toDate = formatDate(r.date_to);
        const zeitraum = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;
        const bearbeiter = r.reviewer_name ? esc(r.reviewer_name) : '–';
        const withdrawBtn = r.status === 'pending'
            ? `<button class="btn btn-sm btn-withdraw" onclick="window._withdrawRequest(${r.id})">Zurückziehen</button>`
            : '';
        return `
            <tr>
                <td>${renderTypeBadge(r)}</td>
                <td>${zeitraum}</td>
                <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                <td>${bearbeiter}</td>
                <td>${withdrawBtn}</td>
            </tr>
        `;
    }).join('');
}

window._withdrawRequest = async function(id) {
    if (!confirm('Möchten Sie diesen Antrag wirklich zurückziehen?')) return;
    try {
        await apiFetch(`/requests/${id}`, { method: 'DELETE' });
        await loadMyRequests();
        await loadVacation();
        await loadCalendarRequests();
        // Kalender sofort neu zeichnen wenn er gerade sichtbar ist
        if (document.getElementById('page-calendar') &&
            !document.getElementById('page-calendar').classList.contains('hidden')) {
            renderCalendar();
        }
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// ── SCRUM-157/159/160: Zeitkorrekturen beantragen ──────────────
const correctionModal       = document.getElementById('modal-new-correction');
const btnNewCorrection      = document.getElementById('btn-new-correction');
const btnCloseCorrModal     = document.getElementById('btn-close-correction-modal');
const btnCancelCorrModal    = document.getElementById('btn-cancel-correction-modal');
const btnSubmitCorrection   = document.getElementById('btn-submit-correction');
const newCorrectionError    = document.getElementById('new-correction-error');
const newCorrectionSuccess  = document.getElementById('new-correction-success');
const myCorrectionsTbody    = document.getElementById('my-corrections-tbody');
const myCorrectionsTable    = document.getElementById('my-corrections-table');
const myCorrectionsEmpty    = document.getElementById('my-corrections-empty');

const correctionTypeLabelsLocal = { add: 'Nachtragen', edit: 'Korrigieren', delete: 'Löschen' };
const correctionStatusLabels    = { pending: 'Ausstehend', approved: 'Genehmigt', denied: 'Abgelehnt' };

let myStampsCache = [];

async function openCorrectionModal() {
    newCorrectionError.classList.add('hidden');
    newCorrectionSuccess.classList.add('hidden');
    document.getElementById('corr-type').value = 'add';
    document.getElementById('corr-stamptype').value = 'in';
    document.getElementById('corr-date').value = '';
    document.getElementById('corr-time').value = '';
    document.getElementById('corr-reason').value = '';

    // Stempel der letzten 30 Tage laden
    try {
        const today = new Date();
        const past = new Date(today);
        past.setDate(past.getDate() - 30);
        const from = past.toISOString().split('T')[0];
        const to   = today.toISOString().split('T')[0];
        myStampsCache = await apiFetch(`/stamp/history?from=${from}&to=${to}`);
    } catch {
        myStampsCache = [];
    }
    populateCorrectionStamps();
    updateCorrectionFields();
    openModalA11y(correctionModal);
}

function closeCorrectionModal() {
    closeModalA11y(correctionModal);
}

function populateCorrectionStamps() {
    const sel = document.getElementById('corr-stamp');
    if (!myStampsCache.length) {
        sel.innerHTML = '<option value="">Keine Stempel in den letzten 30 Tagen</option>';
        return;
    }
    const opts = myStampsCache.slice().reverse().map(s => {
        const typeLabel = s.type === 'in' ? 'Einstempeln' : 'Ausstempeln';
        const dateStr = formatDate(s.stamp_time);
        const timeStr = formatTime(s.stamp_time);
        return `<option value="${s.id}">${dateStr} ${timeStr} – ${typeLabel}</option>`;
    }).join('');
    sel.innerHTML = '<option value="">– Stempel wählen –</option>' + opts;
}

function updateCorrectionFields() {
    const type = document.getElementById('corr-type').value;
    const stampGroup     = document.getElementById('corr-stamp-group');
    const stampTypeGroup = document.getElementById('corr-stamptype-group');
    const dateGroup      = document.getElementById('corr-date-group');
    const timeGroup      = document.getElementById('corr-time-group');

    if (type === 'add') {
        stampGroup.classList.add('hidden');
        stampTypeGroup.classList.remove('hidden');
        dateGroup.classList.remove('hidden');
        timeGroup.classList.remove('hidden');
    } else if (type === 'edit') {
        stampGroup.classList.remove('hidden');
        stampTypeGroup.classList.add('hidden');
        dateGroup.classList.remove('hidden');
        timeGroup.classList.remove('hidden');
    } else {
        stampGroup.classList.remove('hidden');
        stampTypeGroup.classList.add('hidden');
        dateGroup.classList.add('hidden');
        timeGroup.classList.add('hidden');
    }
}

btnNewCorrection?.addEventListener('click', openCorrectionModal);
btnCloseCorrModal?.addEventListener('click', closeCorrectionModal);
btnCancelCorrModal?.addEventListener('click', closeCorrectionModal);
document.querySelector('.modal-backdrop-correction')?.addEventListener('click', closeCorrectionModal);
document.getElementById('corr-type')?.addEventListener('change', updateCorrectionFields);
document.getElementById('corr-stamp')?.addEventListener('change', () => {
    const stampId = document.getElementById('corr-stamp').value;
    const stamp = myStampsCache.find(s => String(s.id) === String(stampId));
    if (stamp && document.getElementById('corr-type').value === 'edit') {
        const d = new Date(stamp.stamp_time);
        document.getElementById('corr-date').value = isoToDisplay(d.toISOString().split('T')[0]);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('corr-time').value = `${hh}:${mm}`;
    }
});

btnSubmitCorrection?.addEventListener('click', async () => {
    newCorrectionError.classList.add('hidden');
    newCorrectionSuccess.classList.add('hidden');

    const type     = document.getElementById('corr-type').value;
    const stampId  = document.getElementById('corr-stamp').value;
    const stampTp  = document.getElementById('corr-stamptype').value;
    const dateStr  = document.getElementById('corr-date').value;
    const timeStr  = document.getElementById('corr-time').value;
    const reason   = document.getElementById('corr-reason').value.trim();

    if (!reason || reason.length < 5) {
        newCorrectionError.textContent = 'Bitte eine Begründung mit mindestens 5 Zeichen angeben.';
        newCorrectionError.classList.remove('hidden');
        return;
    }

    const body = { type, reason };

    if (type === 'add') {
        const iso = displayToIso(dateStr);
        if (!iso || !timeStr) {
            newCorrectionError.textContent = 'Bitte Datum (dd.mm.yy) und Uhrzeit angeben.';
            newCorrectionError.classList.remove('hidden');
            return;
        }
        body.stampType = stampTp;
        body.correctedTime = `${iso}T${timeStr}`;
    } else if (type === 'edit') {
        if (!stampId) {
            newCorrectionError.textContent = 'Bitte einen Stempel auswählen.';
            newCorrectionError.classList.remove('hidden');
            return;
        }
        const iso = displayToIso(dateStr);
        if (!iso || !timeStr) {
            newCorrectionError.textContent = 'Bitte Datum (dd.mm.yy) und neue Uhrzeit angeben.';
            newCorrectionError.classList.remove('hidden');
            return;
        }
        body.stampId = parseInt(stampId);
        body.correctedTime = `${iso}T${timeStr}`;
    } else {
        if (!stampId) {
            newCorrectionError.textContent = 'Bitte einen Stempel auswählen.';
            newCorrectionError.classList.remove('hidden');
            return;
        }
        body.stampId = parseInt(stampId);
    }

    btnSubmitCorrection.disabled = true;
    btnSubmitCorrection.textContent = 'Wird gesendet...';

    try {
        await apiFetch('/corrections', { method: 'POST', body: JSON.stringify(body) });
        newCorrectionSuccess.textContent = 'Korrekturantrag eingereicht. Dein Vorgesetzter wurde benachrichtigt.';
        newCorrectionSuccess.classList.remove('hidden');
        showToast('Korrektur eingereicht', 'Dein Vorgesetzter wurde benachrichtigt.', 'success');
        await loadMyCorrections();
        setTimeout(() => {
            closeCorrectionModal();
            newCorrectionSuccess.classList.add('hidden');
        }, 1800);
    } catch (err) {
        newCorrectionError.textContent = err.message;
        newCorrectionError.classList.remove('hidden');
        showToast('Fehler', err.message, 'error');
    } finally {
        btnSubmitCorrection.disabled = false;
        btnSubmitCorrection.textContent = 'Antrag stellen';
    }
});

async function loadMyCorrections() {
    if (!myCorrectionsTbody) return;
    try {
        const corrections = await apiFetch('/corrections/my');
        renderMyCorrections(corrections);
    } catch (err) {
        console.error('Fehler beim Laden der Korrekturen:', err);
    }
}

function renderMyCorrections(corrections) {
    if (!corrections || !corrections.length) {
        myCorrectionsTable.classList.add('hidden');
        myCorrectionsEmpty.classList.remove('hidden');
        return;
    }
    myCorrectionsTable.classList.remove('hidden');
    myCorrectionsEmpty.classList.add('hidden');

    myCorrectionsTbody.innerHTML = corrections.map(c => {
        const typeLabel = correctionTypeLabelsLocal[c.type] || c.type;
        const statusLabel = correctionStatusLabels[c.status] || c.status;
        let dateTimeCell = '–';
        if (c.type === 'add') {
            dateTimeCell = `${formatDate(c.corrected_time)} ${formatTime(c.corrected_time)} (${c.stamp_type === 'in' ? 'Ein' : 'Aus'})`;
        } else if (c.type === 'edit') {
            const oldT = c.original_time ? `${formatDate(c.original_time)} ${formatTime(c.original_time)}` : '–';
            const newT = c.corrected_time ? `${formatDate(c.corrected_time)} ${formatTime(c.corrected_time)}` : '–';
            dateTimeCell = `${oldT} → ${newT}`;
        } else if (c.type === 'delete' && c.original_time) {
            dateTimeCell = `${formatDate(c.original_time)} ${formatTime(c.original_time)}`;
        }
        const reasonShort = esc(c.reason.length > 50 ? c.reason.slice(0, 50) + '…' : c.reason);
        const withdrawBtn = c.status === 'pending'
            ? `<button class="btn btn-sm btn-withdraw" onclick="window._withdrawCorrection(${c.id})">Zurückziehen</button>`
            : '';
        return `
            <tr>
                <td><span class="badge badge-type type-${c.type}">${typeLabel}</span></td>
                <td>${dateTimeCell}</td>
                <td title="${esc(c.reason)}">${reasonShort}</td>
                <td><span class="badge badge-${c.status}">${statusLabel}</span></td>
                <td>${withdrawBtn}</td>
            </tr>
        `;
    }).join('');
}

window._withdrawCorrection = async function(id) {
    if (!confirm('Möchten Sie diesen Korrekturantrag wirklich zurückziehen?')) return;
    try {
        await apiFetch(`/corrections/${id}`, { method: 'DELETE' });
        await loadMyCorrections();
    } catch (err) {
        showToast('Fehler', err.message, 'error');
    }
};

// ── Antragsverwaltung (Vorgesetzter / Admin) ─────────────────

let allRequestsData = [];   // cache für client-seitiges Filtern
let pendingRequestsData = [];

// Tab-Switching (mit ARIA-Unterstützung)
document.querySelectorAll('.req-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.req-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const target = tab.dataset.tab;
        document.getElementById('req-panel-pending').classList.toggle('hidden', target !== 'pending');
        document.getElementById('req-panel-all').classList.toggle('hidden', target !== 'all');
        document.getElementById('req-panel-corrections').classList.toggle('hidden', target !== 'corrections');
    });

    // Pfeiltasten-Navigation für Tabs
    tab.addEventListener('keydown', (e) => {
        const tabs = Array.from(document.querySelectorAll('.req-tab'));
        const idx = tabs.indexOf(tab);
        let newIdx = -1;
        if (e.key === 'ArrowRight') newIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + tabs.length) % tabs.length;
        if (newIdx >= 0) {
            e.preventDefault();
            tabs[newIdx].focus();
            tabs[newIdx].click();
        }
    });
});

// Filter
document.getElementById('filter-status')?.addEventListener('change', applyAllFilter);
document.getElementById('filter-type')?.addEventListener('change', applyAllFilter);
document.getElementById('filter-req-text')?.addEventListener('input', applyAllFilter);
document.getElementById('btn-reset-filter')?.addEventListener('click', () => {
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-type').value = '';
    const textEl = document.getElementById('filter-req-text');
    if (textEl) textEl.value = '';
    applyAllFilter();
});

// Sort-State für Anträge-Tabelle
const allReqSortState = { key: 'created_at', dir: 'desc' };
let allReqSortBound = false;

function initAllReqSortHeaders() {
    if (allReqSortBound) return;
    const thead = document.querySelector('#all-requests-table thead');
    if (!thead) return;
    allReqSortBound = true;
    bindSortHeaders(thead, allReqSortState, () => applyAllFilter());
    const th = thead.querySelector(`th[data-sort-key="${allReqSortState.key}"]`);
    if (th) setSortHeader(th, allReqSortState.dir);
}

// Sort-State für Pending-Tabelle
const pendingSortState = { key: 'created_at', dir: 'asc' };
let pendingSortBound = false;

function initPendingSortHeaders() {
    if (pendingSortBound) return;
    const thead = document.querySelector('#pending-table thead');
    if (!thead) return;
    pendingSortBound = true;
    bindSortHeaders(thead, pendingSortState, () => {
        const sorted = [...pendingRequestsData].sort(makeSortFn(pendingSortState.key, pendingSortState.dir));
        renderPendingRequests(sorted, true);
    });
}

async function loadRequestsOverview() {
    await Promise.all([loadPendingRequests(), loadAllRequests(), loadPendingCorrections()]);
    initAllReqSortHeaders();
    initPendingSortHeaders();
}

async function loadPendingRequests() {
    try {
        pendingRequestsData = await apiFetch('/requests/pending');
        renderPendingRequests(pendingRequestsData);
    } catch (err) {
        console.error('Fehler beim Laden ausstehender Anträge:', err);
    }
}

async function loadAllRequests() {
    try {
        allRequestsData = await apiFetch('/requests/all');
        applyAllFilter();
    } catch (err) {
        console.error('Fehler beim Laden aller Anträge:', err);
    }
}

function renderPendingRequests(requests, skipBadge) {
    const tbody = document.getElementById('pending-tbody');
    const emptyEl = document.getElementById('pending-empty');
    const table = document.getElementById('pending-table');
    const badge = document.getElementById('pending-count-badge');

    // Badge aktualisieren (nur wenn nicht vom Sort-Re-Render aufgerufen)
    if (!skipBadge) {
        if (requests.length > 0) {
            badge.textContent = requests.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (requests.length === 0) {
        table.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }
    table.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    tbody.innerHTML = requests.map(r => {
        const from = formatDate(r.date_from);
        const to = formatDate(r.date_to);
        const zeitraum = from === to ? from : `${from} – ${to}`;
        return `
            <tr>
                <td data-label="Mitarbeiter"><strong>${esc(r.user_name)}</strong></td>
                <td data-label="Typ">${renderTypeBadge(r)}</td>
                <td data-label="Zeitraum">${zeitraum}</td>
                <td class="col-hide-sm" data-label="Notiz">${r.note ? esc(r.note) : '<span class="text-muted">–</span>'}</td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-approve" onclick="window._reviewRequest(${r.id}, 'approved')">Genehmigen</button>
                    <button class="btn btn-sm btn-deny" onclick="window._reviewRequest(${r.id}, 'denied')">Ablehnen</button>
                </td>
            </tr>
        `;
    }).join('');
}

function applyAllFilter() {
    const statusVal = document.getElementById('filter-status')?.value || '';
    const typeVal   = document.getElementById('filter-type')?.value   || '';
    const textVal   = document.getElementById('filter-req-text')?.value || '';

    let filtered = [...allRequestsData];
    if (statusVal) filtered = filtered.filter(r => r.status === statusVal);
    if (typeVal)   filtered = filtered.filter(r => r.type === typeVal);
    if (textVal)   filtered = filterByText(filtered, textVal, ['user_name', 'reviewer_name']);

    // Sortierung
    filtered.sort(makeSortFn(allReqSortState.key, allReqSortState.dir));

    renderAllRequests(filtered);
    updateCountBadge(document.getElementById('all-req-count-badge'), filtered.length);
}

function renderAllRequests(requests) {
    const tbody  = document.getElementById('all-requests-tbody');
    const emptyEl = document.getElementById('all-empty');
    const table  = document.getElementById('all-requests-table');

    if (requests.length === 0) {
        table.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }
    table.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    tbody.innerHTML = requests.map(r => {
        const from = formatDate(r.date_from);
        const to   = formatDate(r.date_to);
        const zeitraum = from === to ? from : `${from} – ${to}`;
        const statusClass = `badge-${r.status}`;
        const statusLabel = statusLabels[r.status] || r.status;
        const bearbeiter  = r.reviewer_name ? esc(r.reviewer_name) : '<span class="text-muted">–</span>';
        const eingereicht = r.created_at ? formatDate(r.created_at) : '–';
        return `
            <tr>
                <td data-label="Mitarbeiter">${esc(r.user_name)}</td>
                <td data-label="Typ">${renderTypeBadge(r)}</td>
                <td data-label="Zeitraum">${zeitraum}</td>
                <td data-label="Status"><span class="badge ${statusClass}">${statusLabel}</span></td>
                <td class="col-hide-md" data-label="Bearbeiter">${bearbeiter}</td>
                <td class="col-hide-sm" data-label="Eingereicht">${eingereicht}</td>
            </tr>
        `;
    }).join('');
}

window._reviewRequest = async function(id, status) {
    const label = status === 'approved' ? 'genehmigen' : 'ablehnen';
    if (!confirm(`Antrag wirklich ${label}?`)) return;
    try {
        await apiFetch(`/requests/${id}/review`, {
            method: 'PUT',
            body: JSON.stringify({ status }),
        });
        await loadRequestsOverview();
        updateSidebarPendingBadge();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// ── SCRUM-163: Zeitkorrekturen verwalten ──────────────────────

const correctionTypeLabels = { add: 'Hinzufügen', edit: 'Bearbeiten', delete: 'Löschen' };

async function loadPendingCorrections() {
    try {
        const corrs = await apiFetch('/admin/corrections/pending');
        renderPendingCorrections(corrs);
    } catch (err) {
        console.error('Fehler beim Laden der Korrekturen:', err);
    }
}

function renderPendingCorrections(corrs) {
    const tbody = document.getElementById('corrections-tbody');
    const emptyEl = document.getElementById('corrections-empty');
    const table = document.getElementById('corrections-table');
    const badge = document.getElementById('corrections-count-badge');

    if (badge) {
        if (corrs.length > 0) {
            badge.textContent = corrs.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (!tbody) return;

    if (corrs.length === 0) {
        table.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }
    table.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    tbody.innerHTML = corrs.map(c => {
        const typeLabel = correctionTypeLabels[c.type] || c.type;
        const stampLabel = c.stamp_type === 'in' ? 'Einstempeln' : c.stamp_type === 'out' ? 'Ausstempeln' : '';
        const original = c.original_time
            ? `${formatDate(c.original_time)} ${formatTime(c.original_time)}`
            : '<span class="text-muted">–</span>';
        const corrected = c.corrected_time
            ? `${formatDate(c.corrected_time)} ${formatTime(c.corrected_time)}${stampLabel ? ` (${stampLabel})` : ''}`
            : '<span class="text-muted">–</span>';
        return `
            <tr>
                <td data-label="Mitarbeiter"><strong>${esc(c.user_name)}</strong></td>
                <td data-label="Typ"><span class="badge badge-pending">${typeLabel}</span></td>
                <td class="col-hide-sm" data-label="Original">${original}</td>
                <td class="col-hide-sm" data-label="Korrektur">${corrected}</td>
                <td class="col-hide-md" data-label="Begründung">${esc(c.reason)}</td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-approve" onclick="window._reviewCorrection(${c.id}, 'approved')">Genehmigen</button>
                    <button class="btn btn-sm btn-deny" onclick="window._reviewCorrection(${c.id}, 'denied')">Ablehnen</button>
                </td>
            </tr>
        `;
    }).join('');
}

window._reviewCorrection = async function(id, status) {
    const msg = status === 'approved'
        ? 'Korrektur wirklich genehmigen? Der Stempel wird angepasst.'
        : 'Korrektur wirklich ablehnen?';
    if (!confirm(msg)) return;
    try {
        await apiFetch(`/admin/corrections/${id}/review`, {
            method: 'PUT',
            body: JSON.stringify({ status }),
        });
        await loadPendingCorrections();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// ── SCRUM-44: Geräte-Überwachung ─────────────────────────────

let devicesRefreshTimer = null;
let allDevicesData = [];

// Sort-/Filter-State für Gerätetabelle
const devicesSortState = { key: 'name', dir: 'asc' };
const devicesFilterState = { status: '', mode: '', text: '' };
let devicesSortBound = false;

async function loadDevicesPage() {
    await Promise.all([loadDevices(), loadUsersForDevices()]);
    populateDeviceDropdowns();
    renderNfcTable();
    setupNfcListeners();
    initDevicesSortAndFilter();
    clearInterval(devicesRefreshTimer);
    devicesRefreshTimer = setInterval(loadDevices, 15000);
}

function initDevicesSortAndFilter() {
    // Sort-Header
    if (!devicesSortBound) {
        const thead = document.querySelector('#devices-table thead');
        if (thead) {
            devicesSortBound = true;
            bindSortHeaders(thead, devicesSortState, () => applyDevicesFilter());
            const th = thead.querySelector(`th[data-sort-key="${devicesSortState.key}"]`);
            if (th) setSortHeader(th, devicesSortState.dir);
        }
    }
    // Filter-Listener
    document.getElementById('devices-filter-status')?.addEventListener('change', applyDevicesFilter);
    document.getElementById('devices-filter-mode')?.addEventListener('change', applyDevicesFilter);
    document.getElementById('devices-filter-text')?.addEventListener('input', applyDevicesFilter);
    document.getElementById('btn-reset-devices-filter')?.addEventListener('click', () => {
        const s = document.getElementById('devices-filter-status');
        const m = document.getElementById('devices-filter-mode');
        const t = document.getElementById('devices-filter-text');
        if (s) s.value = '';
        if (m) m.value = '';
        if (t) t.value = '';
        applyDevicesFilter();
    });
}

function applyDevicesFilter() {
    devicesFilterState.status = document.getElementById('devices-filter-status')?.value || '';
    devicesFilterState.mode   = document.getElementById('devices-filter-mode')?.value   || '';
    devicesFilterState.text   = document.getElementById('devices-filter-text')?.value   || '';

    let filtered = [...allDevicesData];

    if (devicesFilterState.status !== '') {
        const isOnline = devicesFilterState.status === 'online';
        filtered = filtered.filter(d => isDeviceOnline(d.last_seen) === isOnline);
    }
    if (devicesFilterState.mode) {
        filtered = filterByValue(filtered, 'mode', devicesFilterState.mode);
    }
    if (devicesFilterState.text) {
        filtered = filterByText(filtered, devicesFilterState.text, ['name', 'location', 'id']);
    }

    // Sortierung
    filtered.sort(makeSortFn(devicesSortState.key, devicesSortState.dir));

    renderDevicesTable(filtered);
    updateCountBadge(document.getElementById('devices-count-badge'), filtered.length);
}

async function loadUsersForDevices() {
    if (!allUsers.length) {
        try { allUsers = await apiFetch('/admin/users'); } catch {}
    }
}

async function loadDevices() {
    try {
        allDevicesData = await apiFetch('/admin/devices');
        applyDevicesFilter();
    } catch (err) {
        console.error('Fehler beim Laden der Geräte:', err);
    }
}

function isDeviceOnline(lastSeen) {
    if (!lastSeen) return false;
    return (Date.now() - new Date(lastSeen).getTime()) <= 5 * 60 * 1000;
}

function formatLastSeen(lastSeen) {
    if (!lastSeen) return '<span class="text-muted">Noch nie</span>';
    const diffMin = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000);
    if (diffMin < 1) return 'Gerade eben';
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    return `${formatDate(lastSeen)} ${formatTime(lastSeen)}`;
}

function renderDevicesTable(devices) {
    const tbody = document.getElementById('devices-tbody');
    const emptyEl = document.getElementById('devices-empty');
    const table = document.getElementById('devices-table');
    if (!tbody) return;

    if (devices.length === 0) {
        table.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }
    table.classList.remove('hidden');
    emptyEl.classList.add('hidden');

    tbody.innerHTML = devices.map(d => {
        const online = isDeviceOnline(d.last_seen);
        const statusBadge = online
            ? '<span class="badge badge-active">● Online</span>'
            : '<span class="badge badge-inactive">● Offline</span>';
        const modeOptions = [
            { v: 'stamp',     l: 'Stempel-Modus' },
            { v: 'frontdesk', l: 'Frontdesk-Modus' },
        ].map(o => `<option value="${o.v}" ${d.mode === o.v ? 'selected' : ''}>${o.l}</option>`).join('');
        const modeCell = d.mode === 'assign'
            ? '<span class="badge badge-pending">Zuweisung läuft…</span>'
            : `<select class="device-mode-select" data-device-id="${esc(d.id)}" onchange="window._changeDeviceMode(this)">${modeOptions}</select>`;
        return `
            <tr>
                <td class="col-hide-sm" data-label="ID"><code>${esc(d.id)}</code></td>
                <td data-label="Name">${esc(d.name)}</td>
                <td class="col-hide-md" data-label="Standort">${esc(d.location || '–')}</td>
                <td data-label="Modus">${modeCell}</td>
                <td data-label="Status">${statusBadge}</td>
                <td class="col-hide-sm" data-label="Zuletzt gesehen">${formatLastSeen(d.last_seen)}</td>
                <td class="actions-cell">
                    <button class="btn btn-sm ${d.active ? 'btn-danger' : 'btn-success'}" onclick="window._toggleDevice('${esc(d.id)}', ${d.active})">${d.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button class="btn btn-sm btn-danger" onclick="window._deleteDevice('${esc(d.id)}', '${esc(d.name)}')">Löschen</button>
                </td>
            </tr>
        `;
    }).join('');
}

function populateDeviceDropdowns() {
    const deviceSelect = document.getElementById('assign-device');
    const userSelect = document.getElementById('assign-user');
    if (!deviceSelect || !userSelect) return;

    deviceSelect.innerHTML = '<option value="">-- Gerät wählen --</option>' +
        allDevicesData.filter(d => d.active).map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');

    const usersWithoutNfc = allUsers.filter(u => u.active && !u.nfc_uid);
    userSelect.innerHTML = '<option value="">-- Mitarbeiter wählen --</option>' +
        usersWithoutNfc.map(u => `<option value="${u.id}">${esc(u.first_name)} ${esc(u.last_name)}</option>`).join('');
}

function renderNfcTable() {
    const tbody = document.getElementById('nfc-tbody');
    const empty = document.getElementById('nfc-empty');
    const table = document.getElementById('nfc-table');
    if (!tbody) return;
    const usersWithNfc = allUsers.filter(u => u.nfc_uid);

    if (!usersWithNfc.length) {
        table.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }
    table.classList.remove('hidden');
    empty.classList.add('hidden');

    tbody.innerHTML = usersWithNfc.map(u => `
        <tr>
            <td data-label="Mitarbeiter">${esc(u.first_name)} ${esc(u.last_name)}</td>
            <td data-label="NFC-UID"><code>${esc(u.nfc_uid)}</code></td>
            <td class="actions-cell"><button class="btn btn-sm btn-danger" onclick="window._removeNfc(${u.id}, '${esc(u.first_name)} ${esc(u.last_name)}')">Entfernen</button></td>
        </tr>
    `).join('');
}

let nfcListenersSet = false;
function setupNfcListeners() {
    if (nfcListenersSet) return;
    nfcListenersSet = true;

    document.getElementById('btn-assign-nfc')?.addEventListener('click', async () => {
        const deviceId = document.getElementById('assign-device').value;
        const userId = document.getElementById('assign-user').value;
        const statusEl = document.getElementById('assign-status');

        if (!deviceId || !userId) {
            statusEl.className = 'alert alert-error';
            statusEl.textContent = 'Bitte Gerät und Mitarbeiter auswählen.';
            statusEl.classList.remove('hidden');
            return;
        }

        try {
            await apiFetch(`/admin/devices/${deviceId}/assign`, {
                method: 'PUT',
                body: JSON.stringify({ userId: parseInt(userId) }),
            });
            statusEl.className = 'alert alert-success';
            statusEl.textContent = 'Zuweisungsmodus aktiv — jetzt NFC-Karte an das Gerät halten.';
            statusEl.classList.remove('hidden');
        } catch (err) {
            statusEl.className = 'alert alert-error';
            statusEl.textContent = err.message;
            statusEl.classList.remove('hidden');
        }
    });
}

window._toggleDevice = async function(id, currentActive) {
    try {
        await apiFetch(`/admin/devices/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ active: !currentActive }),
        });
        await loadDevices();
        populateDeviceDropdowns();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

window._deleteDevice = async function(id, name) {
    if (!confirm(`Gerät "${name}" wirklich löschen?`)) return;
    try {
        await apiFetch(`/admin/devices/${id}`, { method: 'DELETE' });
        await loadDevices();
        populateDeviceDropdowns();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

window._removeNfc = async function(userId, name) {
    if (!confirm(`NFC-Tag von "${name}" wirklich entfernen?`)) return;
    try {
        await apiFetch(`/admin/users/${userId}/nfc`, { method: 'PUT' });
        allUsers = await apiFetch('/admin/users');
        populateDeviceDropdowns();
        renderNfcTable();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// SCRUM-297: Modus pro Stempeluhr umschalten (stamp / frontdesk)
window._changeDeviceMode = async function(selectEl) {
    const deviceId = selectEl.dataset.deviceId;
    const newMode = selectEl.value;
    const prevMode = selectEl.dataset.prevMode || (allDevicesData.find(d => d.id === deviceId)?.mode) || 'stamp';
    if (newMode === prevMode) return;
    selectEl.disabled = true;
    try {
        await apiFetch(`/admin/devices/${deviceId}/mode`, {
            method: 'PUT',
            body: JSON.stringify({ mode: newMode }),
        });
        showToast('Modus geändert', newMode === 'frontdesk' ? 'Frontdesk-Modus aktiv' : 'Stempel-Modus aktiv', 'success');
        await loadDevices();
    } catch (err) {
        showToast('Fehler', err.message, 'error');
        selectEl.value = prevMode;
    } finally {
        selectEl.disabled = false;
    }
};

const modalCreateDevice = document.getElementById('modal-create-device');
const formCreateDevice = document.getElementById('form-create-device');

function closeDeviceModal() {
    if (modalCreateDevice) closeModalA11y(modalCreateDevice);
}

document.getElementById('btn-open-create-device')?.addEventListener('click', () => {
    formCreateDevice?.reset();
    document.getElementById('create-device-error')?.classList.add('hidden');
    document.getElementById('create-device-success')?.classList.add('hidden');
    if (modalCreateDevice) openModalA11y(modalCreateDevice);
});

document.getElementById('btn-close-device-modal')?.addEventListener('click', closeDeviceModal);
document.getElementById('btn-cancel-device-modal')?.addEventListener('click', closeDeviceModal);
document.querySelector('.modal-backdrop-device')?.addEventListener('click', closeDeviceModal);

formCreateDevice?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('create-device-error');
    const okEl = document.getElementById('create-device-success');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');

    const payload = {
        id: document.getElementById('cd-id').value.trim(),
        name: document.getElementById('cd-name').value.trim(),
        location: document.getElementById('cd-location').value.trim() || null,
    };

    if (!payload.id || !payload.name) {
        errEl.textContent = 'ID und Name sind erforderlich.';
        errEl.classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('btn-submit-device');
    btn.disabled = true;
    btn.textContent = 'Registriere...';

    try {
        await apiFetch('/admin/devices', { method: 'POST', body: JSON.stringify(payload) });
        okEl.textContent = 'Gerät erfolgreich registriert!';
        okEl.classList.remove('hidden');
        formCreateDevice.reset();
        await loadDevices();
        setTimeout(() => { closeDeviceModal(); okEl.classList.add('hidden'); }, 1200);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Registrieren';
    }
});

// ── SCRUM-150/152: Arbeitsregeln & Zeitlimits ────────────────
const rulesModal = document.getElementById('modal-work-rules');
const rulesUserName = document.getElementById('rules-user-name');
const rulesTbody = document.getElementById('rules-tbody');
const rulesError = document.getElementById('rules-error');
const rulesSuccess = document.getElementById('rules-success');
const limWeekly = document.getElementById('lim-weekly');
const limOvertime = document.getElementById('lim-overtime');
const limUndertime = document.getElementById('lim-undertime');
const btnSubmitRules = document.getElementById('btn-submit-rules');

const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
let currentRulesUserId = null;

function minutesToHours(min) {
    if (min === null || min === undefined) return '';
    return (min / 60).toFixed(2).replace(/\.?0+$/, '');
}

function hoursToMinutes(hours) {
    const n = parseFloat(hours);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 60);
}

function timeToHHMM(t) {
    if (!t) return '';
    // Backend liefert "HH:MM:SS"; <input type="time"> erwartet "HH:MM"
    return String(t).substring(0, 5);
}

function renderRulesTable(rulesByWeekday) {
    rulesTbody.innerHTML = WEEKDAY_LABELS.map((label, weekday) => {
        const rule = rulesByWeekday[weekday] || { weekday, work_allowed: weekday < 5 ? 1 : 0, core_start: null, core_end: null, max_daily_minutes: weekday < 5 ? 480 : 0 };
        const allowed = !!rule.work_allowed;
        return `
            <tr data-weekday="${weekday}">
                <td class="rule-day-name">${label}</td>
                <td class="rule-allowed-cell">
                    <input type="checkbox" class="rule-allowed" ${allowed ? 'checked' : ''} aria-label="${label} Arbeit erlaubt">
                </td>
                <td>
                    <input type="time" class="rule-core-start" value="${timeToHHMM(rule.core_start)}" ${allowed ? '' : 'disabled'}>
                </td>
                <td>
                    <input type="time" class="rule-core-end" value="${timeToHHMM(rule.core_end)}" ${allowed ? '' : 'disabled'}>
                </td>
                <td>
                    <input type="number" class="rule-max-hours" min="0" max="24" step="0.25" value="${minutesToHours(rule.max_daily_minutes)}" ${allowed ? '' : 'disabled'}>
                </td>
            </tr>
        `;
    }).join('');

    // Checkbox-Toggle: Felder enabled/disabled
    rulesTbody.querySelectorAll('.rule-allowed').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const tr = e.target.closest('tr');
            const enable = e.target.checked;
            tr.querySelectorAll('input[type="time"], input[type="number"]').forEach(inp => {
                inp.disabled = !enable;
                if (!enable) inp.value = inp.type === 'number' ? '0' : '';
            });
        });
    });
}

async function openWorkRulesModal(userId) {
    currentRulesUserId = userId;
    const user = allUsers.find(u => u.id === userId);
    rulesUserName.textContent = user ? `${user.first_name} ${user.last_name}` : `User #${userId}`;
    rulesError.classList.add('hidden');
    rulesSuccess.classList.add('hidden');

    try {
        const data = await apiFetch(`/admin/work-rules/${userId}`);
        const byWeekday = {};
        (data.rules || []).forEach(r => { byWeekday[r.weekday] = r; });
        renderRulesTable(byWeekday);

        const limits = data.limits || {};
        limWeekly.value = minutesToHours(limits.max_weekly_minutes ?? 2400) || '40';
        limOvertime.value = minutesToHours(limits.max_overtime_minutes ?? 720) || '12';
        limUndertime.value = minutesToHours(limits.max_undertime_minutes ?? 240) || '4';

        openModalA11y(rulesModal);
    } catch (err) {
        rulesError.textContent = 'Fehler beim Laden: ' + err.message;
        rulesError.classList.remove('hidden');
        openModalA11y(rulesModal);
    }
}

function closeRulesModal() {
    closeModalA11y(rulesModal);
}

async function submitWorkRules() {
    rulesError.classList.add('hidden');
    rulesSuccess.classList.add('hidden');

    // Wochentag-Regeln einsammeln
    const rules = [];
    rulesTbody.querySelectorAll('tr').forEach(tr => {
        const weekday = parseInt(tr.dataset.weekday);
        const allowed = tr.querySelector('.rule-allowed').checked;
        const coreStart = tr.querySelector('.rule-core-start').value || null;
        const coreEnd = tr.querySelector('.rule-core-end').value || null;
        const maxHoursRaw = tr.querySelector('.rule-max-hours').value;

        rules.push({
            weekday,
            workAllowed: allowed,
            coreStart: allowed && coreStart ? coreStart : null,
            coreEnd: allowed && coreEnd ? coreEnd : null,
            maxDailyMinutes: allowed ? hoursToMinutes(maxHoursRaw) : 0
        });
    });

    // Zeitlimits einsammeln + validieren
    const weeklyH = parseFloat(limWeekly.value);
    const overH = parseFloat(limOvertime.value);
    const underH = parseFloat(limUndertime.value);

    if (!Number.isFinite(weeklyH) || weeklyH < 0) {
        rulesError.textContent = 'Max. Wochenstunden muss eine Zahl ≥ 0 sein.';
        rulesError.classList.remove('hidden');
        return;
    }
    if (!Number.isFinite(overH) || overH < 0) {
        rulesError.textContent = 'Max. Überstunden muss eine Zahl ≥ 0 sein.';
        rulesError.classList.remove('hidden');
        return;
    }
    if (!Number.isFinite(underH) || underH < 0) {
        rulesError.textContent = 'Max. Minusstunden muss eine Zahl ≥ 0 sein.';
        rulesError.classList.remove('hidden');
        return;
    }

    const payload = {
        rules,
        limits: {
            maxWeeklyMinutes: hoursToMinutes(weeklyH),
            maxOvertimeMinutes: hoursToMinutes(overH),
            maxUndertimeMinutes: hoursToMinutes(underH)
        }
    };

    btnSubmitRules.disabled = true;
    btnSubmitRules.textContent = 'Speichere...';
    try {
        await apiFetch(`/admin/work-rules/${currentRulesUserId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        rulesSuccess.textContent = 'Arbeitsregeln und Zeitlimits gespeichert.';
        rulesSuccess.classList.remove('hidden');
        setTimeout(() => {
            closeRulesModal();
            rulesSuccess.classList.add('hidden');
        }, 1200);
    } catch (err) {
        rulesError.textContent = err.message;
        rulesError.classList.remove('hidden');
    } finally {
        btnSubmitRules.disabled = false;
        btnSubmitRules.textContent = 'Speichern';
    }
}

window._editWorkRules = function (id) {
    // Sicherstellen, dass allUsers geladen ist (Name im Header)
    if (!allUsers.length) {
        loadUsers().then(() => openWorkRulesModal(id));
    } else {
        openWorkRulesModal(id);
    }
};

document.getElementById('btn-close-rules-modal').addEventListener('click', closeRulesModal);
document.getElementById('btn-cancel-rules-modal').addEventListener('click', closeRulesModal);
document.querySelector('.modal-backdrop-rules')?.addEventListener('click', closeRulesModal);
btnSubmitRules.addEventListener('click', submitWorkRules);

registerRoute('devices', { pageId: 'page-devices', onEnter: loadDevicesPage, roles: ['admin'] });

// ── SCRUM-210/211/212: Abwesenheitsbericht ───────────────────
const reportFrom = document.getElementById('report-from');
const reportTo = document.getElementById('report-to');
const reportType = document.getElementById('report-type');
const reportGroup = document.getElementById('report-group');
const reportStatus = document.getElementById('report-status');
const reportError = document.getElementById('report-error');
const reportSummary = document.getElementById('report-summary');
const reportEmpty = document.getElementById('report-empty');
const reportTbody = document.getElementById('report-tbody');
const btnReportPreview = document.getElementById('btn-report-preview');
const btnReportExport = document.getElementById('btn-report-export');

// Date-Input-Helper aktivieren (gleicher Mechanismus wie in der History)
setupDateInput(reportFrom);
setupDateInput(reportTo);

const REPORT_TYPE_BADGE_CLASS = {
    urlaub: 'type-urlaub',
    gleitzeit: 'type-gleitzeit',
    homeoffice: 'type-homeoffice',
    krank: 'type-krank',
    sonderurlaub: 'type-sonderurlaub'
};
const REPORT_TYPE_LABELS = {
    urlaub: 'Urlaub', gleitzeit: 'Gleitzeit', homeoffice: 'Homeoffice',
    krank: 'Krank', sonderurlaub: 'Sonderurlaub'
};
const REPORT_REASON_LABELS = {
    hochzeit: 'Hochzeit', geburt: 'Geburt', trauerfall: 'Trauerfall',
    umzug: 'Umzug', sonstiges: 'Sonstiges'
};
const REPORT_STATUS_BADGE = {
    approved: 'badge-active',
    pending: 'badge-role',
    denied: 'badge-inactive'
};
const REPORT_STATUS_LABEL = {
    approved: 'Genehmigt', pending: 'Ausstehend', denied: 'Abgelehnt'
};

async function loadReportsPage() {
    // Defaults: aktuelles Jahr, wenn Felder leer sind
    if (!reportFrom.value || !reportTo.value) {
        const now = new Date();
        const yearStart = new Date(now.getFullYear(), 0, 1);
        reportFrom.value = isoToDisplay(yearStart.toISOString().split('T')[0]);
        reportTo.value = isoToDisplay(now.toISOString().split('T')[0]);
    }

    // Gruppen für das Abteilungs-Dropdown sicherstellen
    try {
        if (!allGroups.length) await loadGroups();
    } catch (err) {
        console.error('Gruppen laden fehlgeschlagen:', err);
    }
    const currentVal = reportGroup.value;
    reportGroup.innerHTML = '<option value="">Alle Abteilungen</option>';
    allGroups.forEach(g => {
        reportGroup.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
    });
    if (currentVal) reportGroup.value = currentVal;

    // Initiale Vorschau direkt laden
    loadReportPreview();
}

function showReportError(msg) {
    reportError.textContent = msg;
    reportError.classList.remove('hidden');
}
function hideReportError() {
    reportError.classList.add('hidden');
}

function buildReportParams() {
    const from = displayToIso(reportFrom.value);
    const to = displayToIso(reportTo.value);
    if (!from || !to) {
        showReportError('Bitte Zeitraum (Von / Bis) eingeben.');
        return null;
    }
    if (new Date(from) > new Date(to)) {
        showReportError('Startdatum muss vor Enddatum liegen.');
        return null;
    }
    hideReportError();
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    if (reportType.value)   params.set('type', reportType.value);
    if (reportGroup.value)  params.set('groupId', reportGroup.value);
    if (reportStatus.value) params.set('status', reportStatus.value);
    return params;
}

function renderReportRows(data) {
    const { count, rows } = data;
    reportSummary.textContent = `${count} ${count === 1 ? 'Datensatz' : 'Datensätze'}`;

    if (!count) {
        reportEmpty.classList.remove('hidden');
        reportTbody.innerHTML = '';
        return;
    }
    reportEmpty.classList.add('hidden');

    reportTbody.innerHTML = rows.map(r => {
        const badgeCls = REPORT_TYPE_BADGE_CLASS[r.type] || '';
        const statusCls = REPORT_STATUS_BADGE[r.status] || '';
        const note = r.note ? esc(r.note) : '<span class="text-muted">–</span>';
        const reason = r.reasonLabel ? esc(r.reasonLabel) : '<span class="text-muted">–</span>';
        return `
            <tr>
                <td>${esc(r.name)}<br><span class="text-muted text-sm">${esc(r.email)}</span></td>
                <td>${esc(r.groupName || '–')}</td>
                <td><span class="badge badge-type ${badgeCls}">${esc(REPORT_TYPE_LABELS[r.type] || r.type)}</span></td>
                <td>${reason}</td>
                <td>${esc(formatDate(r.dateFrom))}</td>
                <td>${esc(formatDate(r.dateTo))}</td>
                <td>${r.workdays}</td>
                <td><span class="badge ${statusCls}">${esc(REPORT_STATUS_LABEL[r.status] || r.status)}</span></td>
                <td class="report-note-cell">${note}</td>
            </tr>
        `;
    }).join('');
}

async function loadReportPreview() {
    const params = buildReportParams();
    if (!params) return;

    btnReportPreview.disabled = true;
    btnReportPreview.textContent = 'Lädt…';
    reportTbody.innerHTML = '<tr><td colspan="9" class="text-muted">Lädt…</td></tr>';
    try {
        const data = await apiFetch(`/admin/export/absences?${params.toString()}`);
        renderReportRows(data);
    } catch (err) {
        showReportError('Fehler beim Laden: ' + err.message);
        reportSummary.textContent = '–';
        reportTbody.innerHTML = '<tr><td colspan="9" class="text-muted">–</td></tr>';
    } finally {
        btnReportPreview.disabled = false;
        btnReportPreview.textContent = 'Vorschau aktualisieren';
    }
}

async function downloadReportCsv() {
    const params = buildReportParams();
    if (!params) return;

    btnReportExport.disabled = true;
    const originalLabel = btnReportExport.innerHTML;
    btnReportExport.textContent = 'Erzeuge CSV…';

    try {
        // CSV-Download muss als blob() gehen, weil JWT im Authorization-Header steckt
        // (kein direkter <a download>-Link möglich, der trägt keinen Header).
        const token = getToken();
        const url = `/api/admin/export/absences?${params.toString()}&format=csv`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (!res.ok) {
            // Fehler ist JSON; CSV-Pfad liefert text/csv – also nur bei !ok versuchen JSON zu lesen
            let msg = 'Download fehlgeschlagen';
            try {
                const body = await res.json();
                msg = body.error || msg;
                // 401 manuell handhaben – fetch() nutzt nicht apiFetch hier
                if (res.status === 401 && token) {
                    clearToken();
                    window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason: 'session_expired' } }));
                    return;
                }
            } catch {}
            throw new Error(msg);
        }

        const blob = await res.blob();
        // Dateiname aus Content-Disposition lesen, sonst sinnvollen Default bauen
        const cd = res.headers.get('Content-Disposition') || '';
        let filename = `abwesenheiten_${params.get('from')}_${params.get('to')}.csv`;
        const match = cd.match(/filename="?([^"]+)"?/i);
        if (match) filename = match[1];

        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
    } catch (err) {
        showReportError('CSV-Export fehlgeschlagen: ' + err.message);
    } finally {
        btnReportExport.disabled = false;
        btnReportExport.innerHTML = originalLabel;
    }
}

btnReportPreview.addEventListener('click', loadReportPreview);
btnReportExport.addEventListener('click', downloadReportCsv);

// Reagieren auf Filter-Änderungen mit Enter
[reportFrom, reportTo].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); loadReportPreview(); }
    });
});

registerRoute('reports', { pageId: 'page-reports', onEnter: loadReportsPage, roles: ['admin'] });

// ── SCRUM-202/204/207: Team-Monatsbericht ──────────────────────
const monthlyReportSelect = document.getElementById('monthly-report-select');
const monthlyReportError = document.getElementById('monthly-report-error');
const monthlyReportTbody = document.getElementById('monthly-report-tbody');
const monthlyReportEmpty = document.getElementById('monthly-report-empty');
const monthlyReportPrintMonth = document.getElementById('monthly-report-print-month');
const monthlyTotalExpected = document.getElementById('monthly-report-total-expected');
const monthlyTotalActual = document.getElementById('monthly-report-total-actual');
const monthlyTotalOvertime = document.getElementById('monthly-report-total-overtime');
const monthlyTotalVacation = document.getElementById('monthly-report-total-vacation');
const monthlyTotalSick = document.getElementById('monthly-report-total-sick');
const btnMonthlyReportPrint = document.getElementById('btn-monthly-report-print');

function buildMonthOptions() {
    // Letzte 12 Monate; aktueller Monat als Default
    const now = new Date();
    const opts = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `${MONTH_NAMES_DE[d.getMonth()]} ${d.getFullYear()}`;
        opts.push({ value, label });
    }
    return opts;
}

function fillMonthlyMonthSelect() {
    if (monthlyReportSelect.options.length) return;
    const opts = buildMonthOptions();
    monthlyReportSelect.innerHTML = opts
        .map((o, idx) => `<option value="${o.value}"${idx === 0 ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('');
}

function showMonthlyReportError(msg) {
    monthlyReportError.textContent = msg;
    monthlyReportError.classList.remove('hidden');
}
function hideMonthlyReportError() {
    monthlyReportError.classList.add('hidden');
}

function renderMonthlyReport(data) {
    const { users, totals, month } = data;
    const [y, m] = month.split('-');
    const monthLabel = `${MONTH_NAMES_DE[parseInt(m, 10) - 1]} ${y}`;
    monthlyReportPrintMonth.textContent = monthLabel;

    monthlyTotalExpected.textContent = formatMinutes(totals.expectedMinutes);
    monthlyTotalActual.textContent = formatMinutes(totals.actualMinutes);
    monthlyTotalOvertime.textContent = formatMinutes(totals.overtimeMinutes, true);
    monthlyTotalVacation.textContent = String(totals.vacationDays);
    monthlyTotalSick.textContent = String(totals.sickDays);

    if (!users.length) {
        monthlyReportEmpty.classList.remove('hidden');
        monthlyReportTbody.innerHTML = '';
        return;
    }
    monthlyReportEmpty.classList.add('hidden');

    monthlyReportTbody.innerHTML = users.map(u => {
        const ot = u.overtimeMinutes;
        const otColor = ot < 0 ? '#dc2626' : (ot > 0 ? '#16a34a' : '');
        return `
            <tr>
                <td>${esc(u.name)}</td>
                <td>${formatMinutes(u.expectedMinutes)}</td>
                <td>${formatMinutes(u.actualMinutes)}</td>
                <td${otColor ? ` style="color:${otColor}"` : ''}>${formatMinutes(ot, true)}</td>
                <td>${u.vacationDays}</td>
                <td>${u.sickDays}</td>
            </tr>
        `;
    }).join('');
}

async function loadMonthlyReport() {
    hideMonthlyReportError();
    const month = monthlyReportSelect.value;
    if (!month) return;

    monthlyReportTbody.innerHTML = '<tr><td colspan="6" class="text-muted">Lädt…</td></tr>';
    monthlyTotalExpected.textContent = '–';
    monthlyTotalActual.textContent = '–';
    monthlyTotalOvertime.textContent = '–';
    monthlyTotalVacation.textContent = '–';
    monthlyTotalSick.textContent = '–';

    try {
        const data = await apiFetch(`/admin/reports/monthly?month=${encodeURIComponent(month)}`);
        renderMonthlyReport(data);
    } catch (err) {
        showMonthlyReportError('Fehler beim Laden: ' + err.message);
        monthlyReportTbody.innerHTML = '<tr><td colspan="6" class="text-muted">–</td></tr>';
    }
}

async function loadMonthlyReportPage() {
    fillMonthlyMonthSelect();
    await loadMonthlyReport();
}

monthlyReportSelect.addEventListener('change', loadMonthlyReport);
btnMonthlyReportPrint.addEventListener('click', () => window.print());

registerRoute('monthly-report', { pageId: 'page-monthly-report', onEnter: loadMonthlyReportPage, roles: ['admin', 'vorgesetzter'] });

// ── SCRUM-193/197/199: Zeiten-CSV-Export ─────────────────────
const exportFrom = document.getElementById('export-from');
const exportTo = document.getElementById('export-to');
const exportGroup = document.getElementById('export-group');
const exportError = document.getElementById('export-error');
const exportSummary = document.getElementById('export-summary');
const exportEmpty = document.getElementById('export-empty');
const exportTbody = document.getElementById('export-tbody');
const btnExportPreview = document.getElementById('btn-export-preview');
const btnExportCsv = document.getElementById('btn-export-csv');

setupDateInput(exportFrom);
setupDateInput(exportTo);

async function loadExportPage() {
    // Default-Zeitraum: aktueller Monat
    if (!exportFrom.value || !exportTo.value) {
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        exportFrom.value = isoToDisplay(firstOfMonth.toISOString().split('T')[0]);
        exportTo.value = isoToDisplay(now.toISOString().split('T')[0]);
    }

    // Gruppen ins Dropdown laden
    try {
        if (!allGroups.length) await loadGroups();
    } catch (err) {
        console.error('Gruppen laden fehlgeschlagen:', err);
    }
    const currentVal = exportGroup.value;
    exportGroup.innerHTML = '<option value="">Alle Gruppen</option>';
    allGroups.forEach(g => {
        exportGroup.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
    });
    if (currentVal) exportGroup.value = currentVal;

    loadExportPreview();
}

function showExportError(msg) {
    exportError.textContent = msg;
    exportError.classList.remove('hidden');
}
function hideExportError() {
    exportError.classList.add('hidden');
}

function buildExportParams() {
    const from = displayToIso(exportFrom.value);
    const to = displayToIso(exportTo.value);
    if (!from || !to) {
        showExportError('Bitte Zeitraum (Von / Bis) eingeben.');
        return null;
    }
    if (new Date(from) > new Date(to)) {
        showExportError('Startdatum muss vor Enddatum liegen.');
        return null;
    }
    hideExportError();
    const params = new URLSearchParams();
    params.set('from', from);
    params.set('to', to);
    if (exportGroup.value) params.set('groupId', exportGroup.value);
    return params;
}

function renderExportRows(data) {
    const { count, rows } = data;
    exportSummary.textContent = `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`;

    if (!count) {
        exportEmpty.classList.remove('hidden');
        exportTbody.innerHTML = '';
        return;
    }
    exportEmpty.classList.add('hidden');

    exportTbody.innerHTML = rows.map(r => {
        const color = r.overtimeMinutes < 0 ? '#dc2626' : (r.overtimeMinutes > 0 ? '#16a34a' : '');
        return `
            <tr>
                <td>${esc(r.name)}</td>
                <td>${esc(formatDate(r.date))}</td>
                <td>${esc(r.workTime)}</td>
                <td${color ? ` style="color:${color}"` : ''}>${esc(r.overtime)}</td>
            </tr>
        `;
    }).join('');
}

async function loadExportPreview() {
    const params = buildExportParams();
    if (!params) return;

    btnExportPreview.disabled = true;
    btnExportPreview.textContent = 'Lädt…';
    exportTbody.innerHTML = '<tr><td colspan="4" class="text-muted">Lädt…</td></tr>';
    try {
        const data = await apiFetch(`/admin/export/csv?${params.toString()}&format=json`);
        renderExportRows(data);
    } catch (err) {
        showExportError('Fehler beim Laden: ' + err.message);
        exportSummary.textContent = '–';
        exportTbody.innerHTML = '<tr><td colspan="4" class="text-muted">–</td></tr>';
    } finally {
        btnExportPreview.disabled = false;
        btnExportPreview.textContent = 'Vorschau aktualisieren';
    }
}

async function downloadExportCsv() {
    const params = buildExportParams();
    if (!params) return;

    btnExportCsv.disabled = true;
    const originalLabel = btnExportCsv.innerHTML;
    btnExportCsv.textContent = 'Erzeuge CSV…';

    try {
        // CSV-Download via fetch+Blob, weil JWT im Authorization-Header steckt
        // (ein direkter <a download>-Link kann keinen Header tragen).
        const token = getToken();
        const url = `/api/admin/export/csv?${params.toString()}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (!res.ok) {
            let msg = 'Download fehlgeschlagen';
            try {
                const body = await res.json();
                msg = body.error || msg;
                if (res.status === 401 && token) {
                    clearToken();
                    window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason: 'session_expired' } }));
                    return;
                }
            } catch {}
            throw new Error(msg);
        }

        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const today = new Date().toISOString().split('T')[0];
        let filename = `export_${today}.csv`;
        const match = cd.match(/filename="?([^"]+)"?/i);
        if (match) filename = match[1];

        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
    } catch (err) {
        showExportError('CSV-Export fehlgeschlagen: ' + err.message);
    } finally {
        btnExportCsv.disabled = false;
        btnExportCsv.innerHTML = originalLabel;
    }
}

btnExportPreview.addEventListener('click', loadExportPreview);
btnExportCsv.addEventListener('click', downloadExportCsv);

[exportFrom, exportTo].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); loadExportPreview(); }
    });
});

registerRoute('export', { pageId: 'page-export', onEnter: loadExportPage, roles: ['admin'] });

// ── Monatskalender (SCRUM-Monatskalender) ──────────────────
// Zeigt eine Monatsansicht mit farblich markierten Abwesenheiten
// des angemeldeten Mitarbeiters. Daten kommen vom existierenden
// Endpoint /api/requests/my und werden client-seitig auf den
// dargestellten Monat gefiltert.

const calendarGrid = document.getElementById('calendar-grid');
const calendarTitle = document.getElementById('cal-title');
const btnCalPrev = document.getElementById('btn-cal-prev');
const btnCalNext = document.getElementById('btn-cal-next');
const btnCalToday = document.getElementById('btn-cal-today');

const MONTH_NAMES_DE = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// State: aktuell angezeigter Monat
const _now = new Date();
let calendarYear  = _now.getFullYear();
let calendarMonth = _now.getMonth(); // 0-11
let calendarRequests = []; // Cache der Anträge

// ── Hilfsfunktionen ────────────────────────────────────────

// Lokales YYYY-MM-DD ohne Zeitzonen-Probleme
function toIsoLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Wochentag-Index mit Montag = 0, Sonntag = 6
function mondayBasedDay(date) {
    return (date.getDay() + 6) % 7;
}

// Timezone-sicheres Parsen von ISO-DATE-Strings (YYYY-MM-DD).
// new Date("2026-06-05") interpretiert als UTC → in CET/CEST landet man auf dem 4. Juni.
// Stattdessen: direkt als lokales Datum konstruieren.
function parseDateLocal(isoStr) {
    if (!isoStr) return null;
    const s = String(isoStr).slice(0, 10); // nur "YYYY-MM-DD" nehmen
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d); // lokal, kein UTC-Shift
}

// Map<ISODate, {type, status, reason}> über alle Tage des sichtbaren Grids
function buildAbsenceMap(requests, year, month) {
    const map = new Map();
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - mondayBasedDay(first));
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 41); // 42 Zellen (0..41)

    gridStart.setHours(0, 0, 0, 0);
    gridEnd.setHours(23, 59, 59, 999);

    requests.forEach(r => {
        if (r.status === 'denied') return;

        // BUGFIX: MySQL DATE-String ohne UTC-Timezone-Shift parsen
        const from = parseDateLocal(r.date_from);
        const to   = parseDateLocal(r.date_to);
        if (!from || !to) return;

        from.setHours(0, 0, 0, 0);
        to.setHours(0, 0, 0, 0);

        const cur = new Date(from);
        while (cur <= to) {
            if (cur >= gridStart && cur <= gridEnd) {
                map.set(toIsoLocal(cur), {
                    type:   r.type,
                    status: r.status,
                    reason: r.reason || null,
                });
            }
            cur.setDate(cur.getDate() + 1);
        }
    });
    return map;
}

// ── Rendering ──────────────────────────────────────────────

function renderCalendar() {
    if (!calendarGrid) return;

    calendarTitle.textContent = `${MONTH_NAMES_DE[calendarMonth]} ${calendarYear}`;

    const first = new Date(calendarYear, calendarMonth, 1);
    const leadingBlanks = mondayBasedDay(first); // wie viele Tage vor dem 1.
    const gridStart = new Date(calendarYear, calendarMonth, 1 - leadingBlanks);

    const absenceMap = buildAbsenceMap(calendarRequests, calendarYear, calendarMonth);
    const todayIso = toIsoLocal(new Date());

    const cells = [];
    for (let i = 0; i < 42; i++) {
        const day = new Date(gridStart);
        day.setDate(day.getDate() + i);
        const inMonth = day.getMonth() === calendarMonth;
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
        const iso = toIsoLocal(day);
        const isToday = iso === todayIso;
        const absence = absenceMap.get(iso);

        const classes = ['calendar-day'];
        if (!inMonth) classes.push('calendar-day--out-of-month');
        if (isWeekend) classes.push('calendar-day--weekend');
        if (isToday)  classes.push('calendar-day--today');
        if (absence) {
            classes.push('calendar-day--absence');
            classes.push(`type-${absence.type}`);
            if (absence.status === 'pending') classes.push('calendar-day--pending');
        }

        // Label – Typ/Anlass kurz anzeigen, nur im aktuellen Monat
        let label = '';
        if (absence && inMonth) {
            label = typeLabels[absence.type] || absence.type;
            if (absence.type === 'sonderurlaub' && absence.reason) {
                label = reasonLabels[absence.reason] || label;
            }
            if (absence.status === 'pending') label += ' (offen)';
        }

        // ARIA: Wochentag + Datum lesen
        const ariaLabel = day.toLocaleDateString('de-DE', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }) + (absence && inMonth ? ` – ${label}` : '') + (isToday ? ' – heute' : '');

        cells.push(`
            <div class="${classes.join(' ')}" role="gridcell" aria-label="${esc(ariaLabel)}">
                <span class="calendar-day-number">${day.getDate()}</span>
                ${label ? `<span class="calendar-day-label">${esc(label)}</span>` : ''}
            </div>
        `);
    }

    calendarGrid.innerHTML = cells.join('');
}

// ── Daten laden ────────────────────────────────────────────

async function loadCalendarRequests() {
    try {
        calendarRequests = await apiFetch('/requests/my');
    } catch (err) {
        console.error('Fehler beim Laden der Kalenderdaten:', err);
        calendarRequests = [];
    }
}

async function loadCalendar() {
    await loadCalendarRequests();
    renderCalendar();
}

// ── Navigation ─────────────────────────────────────────────

btnCalPrev?.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    }
    renderCalendar();
});

btnCalNext?.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }
    renderCalendar();
});

btnCalToday?.addEventListener('click', () => {
    const t = new Date();
    calendarYear = t.getFullYear();
    calendarMonth = t.getMonth();
    renderCalendar();
});

registerRoute('calendar', { pageId: 'page-calendar', onEnter: loadCalendar });
