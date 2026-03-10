import { apiFetch, setToken, clearToken, getToken } from './api.js';

const pageLogin = document.getElementById('page-login');
const pageAdmin = document.getElementById('page-admin');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const navUsername = document.getElementById('nav-username');

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
        showAdmin();
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
    pageAdmin.classList.add('hidden');
    pageLogin.classList.remove('hidden');
    document.querySelector('.navbar-user').classList.add('hidden');
});

(async function init() {
    const token = getToken();
    if (!token) return;
    try {
        const data = await apiFetch('/auth/me');
        currentUser = data;
        showAdmin();
    } catch {
        clearToken();
    }
})();

function showAdmin() {
    pageLogin.classList.add('hidden');
    pageAdmin.classList.remove('hidden');
    navUsername.textContent = `${currentUser.first_name} ${currentUser.last_name}`;
    document.querySelector('.navbar-user').classList.remove('hidden');
    loadUsers();
    loadGroups();
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
                ${u.id !== currentUser.id ? (u.active
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

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
