import { apiFetch, setToken, clearToken, getToken } from './api.js';

const pageLogin = document.getElementById('page-login');
const pageDashboard = document.getElementById('page-dashboard');
const pageAdmin = document.getElementById('page-admin');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const navUsername = document.getElementById('nav-username');
const navLinks = document.getElementById('nav-links');
const navAdminLink = document.getElementById('nav-admin-link');
const navGroupsLink = document.getElementById('nav-groups-link');
const pageGroups = document.getElementById('page-groups');

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

let currentUser = null;
let allUsers = [];
let allGroups = [];
let isStampedIn = false;
let todayTimer = null;

const pages = { dashboard: pageDashboard, admin: pageAdmin, groups: pageGroups };

function navigateTo(page) {
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    if (pages[page]) pages[page].classList.remove('hidden');
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.toggle('active', l.dataset.page === page);
    });

    if (page === 'dashboard') loadDashboard();
    if (page === 'admin') { loadUsers(); loadGroups(); }
    if (page === 'groups') loadGroupsPage();
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
    });
});

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

btnLogout.addEventListener('click', () => {
    clearToken();
    currentUser = null;
    clearInterval(todayTimer);
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    pageLogin.classList.remove('hidden');
    navLinks.classList.add('hidden');
    document.querySelector('.navbar-user').classList.add('hidden');
});

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

function showApp() {
    pageLogin.classList.add('hidden');
    const name = currentUser.first_name || currentUser.firstName;
    const last = currentUser.last_name || currentUser.lastName;
    navUsername.textContent = `${name} ${last}`;
    navLinks.classList.remove('hidden');
    document.querySelector('.navbar-user').classList.remove('hidden');

    const role = currentUser.role;
    if (role === 'admin' || role === 'vorgesetzter') {
        navAdminLink.classList.remove('hidden');
    } else {
        navAdminLink.classList.add('hidden');
    }
    navGroupsLink.classList.toggle('hidden', role !== 'admin');

    navigateTo('dashboard');
}

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

    // Last stamp time display
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
    // Re-trigger animation
    stampWarning.style.animation = 'none';
    stampWarning.offsetHeight; // reflow
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
    todayStampsList.innerHTML = stamps.map(s => `
        <div class="stamp-entry">
            <div class="stamp-entry-icon ${s.type}"></div>
            <span class="stamp-entry-time">${formatTime(s.stamp_time)}</span>
            <span class="stamp-entry-label">${s.type === 'in' ? 'Einstempeln' : 'Ausstempeln'}</span>
            <span class="stamp-entry-source">${sourceLabel[s.source] || s.source || ''}</span>
        </div>
    `).join('');
}

btnStamp.addEventListener('click', async () => {
    btnStamp.disabled = true;
    hideStampWarning();

    // Show spinner
    stampSpinner.classList.remove('hidden');
    btnStampText.textContent = 'Wird verarbeitet...';

    try {
        const result = await apiFetch('/stamp', {
            method: 'POST',
            body: JSON.stringify({ source: 'web' }),
        });

        // Hide spinner
        stampSpinner.classList.add('hidden');

        if (!result.success) {
            // Kernzeit-Blockierung: zeige Warnung, kein Stempel
            showStampWarning(result.warning || 'Stempeln fehlgeschlagen');
            btnStamp.disabled = false;
            btnStampText.textContent = isStampedIn ? 'Ausstempeln' : 'Einstempeln';
            return;
        }

        // Kernzeitwarnung (nicht blockierend)
        if (result.warning) {
            showStampWarning(result.warning);
        }

        isStampedIn = result.type === 'in';

        // Fetch fresh today data for stamps list + last stamp
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

function renderHistory(stamps) {
    const days = {};
    stamps.forEach(s => {
        const day = new Date(s.stamp_time).toISOString().split('T')[0];
        if (!days[day]) days[day] = [];
        days[day].push(s);
    });

    const rows = [];
    const sortedDays = Object.keys(days).sort().reverse();

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
    const uid = currentUser.id || currentUser.id;
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

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Meine Anträge ─────────────────────────────────────────

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
