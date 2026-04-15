import { apiFetch, setToken, clearToken, getToken } from './api.js';
import { registerRoute, onNavigate, navigateTo, startRouter } from './router.js';

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
});

// ── Mobile Sidebar Toggle ───────────────────────────────────
function openSidebar() {
    sidebar.classList.add('is-open');
    sidebarOverlay.classList.remove('hidden');
    btnHamburger.classList.add('is-active');
}

function closeSidebar() {
    sidebar.classList.remove('is-open');
    sidebarOverlay.classList.add('hidden');
    btnHamburger.classList.remove('is-active');
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

// ── Routes registrieren ─────────────────────────────────────
registerRoute('dashboard', {
    pageId: 'page-dashboard',
    onEnter: loadDashboard,
});

registerRoute('team', {
    pageId: 'page-team',
    onEnter: loadTeamPage,
});

registerRoute('groups', {
    pageId: 'page-groups',
    onEnter: loadGroupsPage,
});

registerRoute('admin', {
    pageId: 'page-admin',
    onEnter: () => { loadUsers(); loadGroups(); },
});

registerRoute('requests-overview', {
    pageId: 'page-requests-overview',
    onEnter: loadRequestsOverview,
});

// ── Login ───────────────────────────────────────────────────
btnLogin.addEventListener('click', async () => {
    loginError.classList.add('hidden');
    try {
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: loginEmail.value.trim(),
                password: loginPassword.value,
            }),
        });
        setToken(data.token);
        currentUser = data.user;
        showApp();
    } catch (err) {
        loginError.textContent = err.message;
        loginError.classList.remove('hidden');
    }
});

loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnLogin.click();
});

// ── Logout ──────────────────────────────────────────────────
btnLogout.addEventListener('click', () => {
    clearToken();
    currentUser = null;
    clearInterval(todayTimer);
    clearInterval(window._pendingBadgeTimer);
    if (socket) { socket.disconnect(); socket = null; }
    appShell.classList.add('hidden');
    pageLogin.classList.remove('hidden');
    closeSidebar();
    window.location.hash = '';
});

// 401 Auto-Logout (Token abgelaufen oder ungültig)
window.addEventListener('auth:logout', (e) => {
    currentUser = null;
    clearInterval(todayTimer);
    appShell.classList.add('hidden');
    pageLogin.classList.remove('hidden');
    closeSidebar();
    window.location.hash = '';
    if (e.detail?.reason === 'session_expired') {
        loginError.textContent = 'Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.';
        loginError.classList.remove('hidden');
    }
});

// ── Auto-Login ──────────────────────────────────────────────
(async function init() {
    const token = getToken();
    if (!token) return;
    try {
        const data = await apiFetch('/auth/me');
        currentUser = data;
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

function showToast(title, body, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-title">${esc(title)}</div>${body ? `<div class="toast-body">${esc(body)}</div>` : ''}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.3s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

let socket = null;
function setupSocket() {
    if (typeof io === 'undefined') return;
    if (socket) socket.disconnect();
    socket = io({ auth: { token: getToken() } });

    socket.on('request:reviewed', (data) => {
        const statusLabel = data.status === 'approved' ? 'genehmigt' : 'abgelehnt';
        const type = data.status === 'approved' ? 'success' : 'error';
        showToast(`Antrag ${statusLabel}`, `Bearbeitet von ${data.reviewerName}`, type);
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
    });

    socket.on('correction:new', () => {
        if (currentUser.role === 'admin' || currentUser.role === 'vorgesetzter') {
            showToast('Neue Korrektur', 'Ein Mitarbeiter hat einen Korrekturantrag eingereicht', 'info');
            if (typeof loadPendingCorrections === 'function') loadPendingCorrections();
        }
    });
}

// ── Helpers ─────────────────────────────────────────────────
function formatMinutes(mins) {
    const sign = mins < 0 ? '-' : '';
    const abs = Math.abs(Math.floor(mins));
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
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Dashboard ───────────────────────────────────────────────
async function loadDashboard() {
    try {
        const data = await apiFetch('/stamp/today');
        isStampedIn = data.isStampedIn;
        const lastStamp = data.stamps && data.stamps.length ? data.stamps[data.stamps.length - 1] : null;
        updateStampUI(data.todayMinutes, data.balance, lastStamp);
        renderTodayStamps(data.stamps);

        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        historyFrom.value = firstOfMonth.toISOString().split('T')[0];
        historyTo.value = now.toISOString().split('T')[0];
        loadHistory();
        loadVacation();
        loadMyRequests();

        clearInterval(todayTimer);
        if (isStampedIn) {
            todayTimer = setInterval(async () => {
                try {
                    const fresh = await apiFetch('/stamp/today');
                    const freshLast = fresh.stamps && fresh.stamps.length ? fresh.stamps[fresh.stamps.length - 1] : null;
                    updateStampUI(fresh.todayMinutes, fresh.balance, freshLast);
                } catch {}
            }, 30000);
        }
    } catch (err) {
        console.error(err);
    }
}

function updateStampUI(todayMins, balance, lastStamp) {
    stampIndicator.className = `stamp-indicator ${isStampedIn ? 'in' : 'out'}`;
    stampStatusText.textContent = isStampedIn ? 'Eingestempelt' : 'Ausgestempelt';
    btnStamp.disabled = false;
    btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
    btnStamp.className = `btn btn-stamp ${isStampedIn ? 'stamp-out' : 'stamp-in'}`;
    todayMinutesEl.textContent = formatMinutes(todayMins);
    monthBalanceEl.textContent = formatMinutes(balance);
    monthBalanceEl.className = `stamp-info-value ${balance >= 0 ? 'positive' : 'negative'}`;

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

        clearInterval(todayTimer);
        if (isStampedIn) {
            todayTimer = setInterval(async () => {
                try {
                    const f = await apiFetch('/stamp/today');
                    const fLast = f.stamps && f.stamps.length ? f.stamps[f.stamps.length - 1] : null;
                    updateStampUI(f.todayMinutes, f.balance, fLast);
                } catch {}
            }, 30000);
        }
    } catch (err) {
        stampSpinner.classList.add('hidden');
        showStampWarning('Fehler: ' + err.message);
        btnStamp.disabled = false;
        btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
    }
});

// ── History ─────────────────────────────────────────────────
async function loadHistory() {
    const from = historyFrom.value;
    const to = historyTo.value;
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
async function loadUsers() {
    try {
        allUsers = await apiFetch('/admin/users');
        renderUsersTable();
    } catch (err) {
        console.error('Fehler beim Laden der Benutzer:', err);
    }
}

function renderUsersTable() {
    const roleLabels = { admin: 'Admin', vorgesetzter: 'Vorgesetzter', arbeiter: 'Mitarbeiter' };
    const uid = currentUser.id;
    usersTbody.innerHTML = allUsers
        .map(
            (u) => `
        <tr>
            <td>${esc(u.first_name)} ${esc(u.last_name)}</td>
            <td>${esc(u.email)}</td>
            <td><span class="badge badge-role">${roleLabels[u.role] || u.role}</span></td>
            <td>${esc(u.group_name || '–')}</td>
            <td>${esc(u.supervisor_name || '–')}</td>
            <td><span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Aktiv' : 'Inaktiv'}</span></td>
            <td class="actions-cell">
                <button class="btn btn-sm" onclick="window._editUser(${u.id})">Bearbeiten</button>
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
    modal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', closeModal);
btnCancelModal.addEventListener('click', closeModal);
document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

function closeModal() {
    modal.classList.add('hidden');
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

    editModal.classList.remove('hidden');
};

document.getElementById('btn-close-edit-modal').addEventListener('click', closeEditModal);
document.getElementById('btn-cancel-edit-modal').addEventListener('click', closeEditModal);
document.querySelector('.modal-backdrop-edit')?.addEventListener('click', closeEditModal);

function closeEditModal() {
    editModal.classList.add('hidden');
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
            <td>${esc(g.name)}</td>
            <td>${g.member_count}</td>
            <td>${formatDate(g.created_at)}</td>
            <td>
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

window._deleteGroup = async function (id, name, memberCount) {
    let msg = `Gruppe "${name}" wirklich löschen?`;
    if (memberCount > 0) msg += `\n\n${memberCount} Mitglieder werden keiner Gruppe mehr zugeordnet.`;
    if (!confirm(msg)) return;
    try {
        await apiFetch(`/admin/groups/${id}`, { method: 'DELETE' });
        loadGroupsPage();
    } catch (err) { alert('Fehler: ' + err.message); }
};

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
};

const statusLabels = {
    pending: 'Ausstehend',
    approved: 'Genehmigt',
    denied: 'Abgelehnt',
};

function openRequestModal() {
    newRequestError.classList.add('hidden');
    newRequestSuccess.classList.add('hidden');
    document.getElementById('req-type').value = 'urlaub';
    document.getElementById('req-from').value = '';
    document.getElementById('req-to').value = '';
    document.getElementById('req-note').value = '';
    requestModal.classList.remove('hidden');
}

function closeRequestModal() {
    requestModal.classList.add('hidden');
}

btnNewRequest.addEventListener('click', openRequestModal);
btnCloseRequestModal.addEventListener('click', closeRequestModal);
btnCancelRequestModal.addEventListener('click', closeRequestModal);
document.querySelector('.modal-backdrop-request')?.addEventListener('click', closeRequestModal);

btnSubmitRequest.addEventListener('click', async () => {
    newRequestError.classList.add('hidden');
    newRequestSuccess.classList.add('hidden');

    const type = document.getElementById('req-type').value;
    const dateFrom = document.getElementById('req-from').value;
    const dateTo = document.getElementById('req-to').value;
    const note = document.getElementById('req-note').value.trim();

    if (!dateFrom || !dateTo) {
        newRequestError.textContent = 'Bitte Start- und Enddatum angeben.';
        newRequestError.classList.remove('hidden');
        return;
    }

    btnSubmitRequest.disabled = true;
    btnSubmitRequest.textContent = 'Wird gesendet...';

    try {
        await apiFetch('/requests', {
            method: 'POST',
            body: JSON.stringify({ type, dateFrom, dateTo, note: note || undefined }),
        });
        newRequestSuccess.textContent = 'Antrag erfolgreich eingereicht!';
        newRequestSuccess.classList.remove('hidden');
        await loadMyRequests();
        setTimeout(() => {
            closeRequestModal();
            newRequestSuccess.classList.add('hidden');
        }, 1200);
    } catch (err) {
        newRequestError.textContent = err.message;
        newRequestError.classList.remove('hidden');
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
                <td>${esc(typeLabels[r.type] || r.type)}</td>
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
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
};

// ── Antragsverwaltung (Vorgesetzter / Admin) ─────────────────

let allRequestsData = [];   // cache für client-seitiges Filtern
let pendingRequestsData = [];

// Tab-Switching
document.querySelectorAll('.req-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.req-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('req-panel-pending').classList.toggle('hidden', target !== 'pending');
        document.getElementById('req-panel-all').classList.toggle('hidden', target !== 'all');
        document.getElementById('req-panel-corrections').classList.toggle('hidden', target !== 'corrections');
    });
});

// Filter
document.getElementById('filter-status')?.addEventListener('change', applyAllFilter);
document.getElementById('filter-type')?.addEventListener('change', applyAllFilter);
document.getElementById('btn-reset-filter')?.addEventListener('click', () => {
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-type').value = '';
    applyAllFilter();
});

async function loadRequestsOverview() {
    await Promise.all([loadPendingRequests(), loadAllRequests(), loadPendingCorrections()]);
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

function renderPendingRequests(requests) {
    const tbody = document.getElementById('pending-tbody');
    const emptyEl = document.getElementById('pending-empty');
    const table = document.getElementById('pending-table');
    const badge = document.getElementById('pending-count-badge');

    // Badge aktualisieren
    if (requests.length > 0) {
        badge.textContent = requests.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
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
                <td><strong>${esc(r.user_name)}</strong></td>
                <td>${esc(typeLabels[r.type] || r.type)}</td>
                <td>${zeitraum}</td>
                <td>${r.note ? esc(r.note) : '<span class="text-muted">–</span>'}</td>
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

    let filtered = allRequestsData;
    if (statusVal) filtered = filtered.filter(r => r.status === statusVal);
    if (typeVal)   filtered = filtered.filter(r => r.type === typeVal);

    renderAllRequests(filtered);
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
                <td>${esc(r.user_name)}</td>
                <td>${esc(typeLabels[r.type] || r.type)}</td>
                <td>${zeitraum}</td>
                <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                <td>${bearbeiter}</td>
                <td>${eingereicht}</td>
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

    if (corrs.length > 0) {
        badge.textContent = corrs.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

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
                <td><strong>${esc(c.user_name)}</strong></td>
                <td><span class="badge badge-pending">${typeLabel}</span></td>
                <td>${original}</td>
                <td>${corrected}</td>
                <td>${esc(c.reason)}</td>
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
