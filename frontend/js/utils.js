/**
 * utils.js – Toast-System & Modal-System für SMELJ
 * Ticket: Toast-Benachrichtigungen und modale Dialoge
 */

// ── Hilfsfunktionen (intern) ─────────────────────────────────────────────────

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


// ── Toast-System ─────────────────────────────────────────────────────────────

const TOAST_DURATION = 3500; // Akzeptanzkriterium: Auto-Ausblenden nach 3,5 s

/**
 * Zeigt eine Toast-Benachrichtigung an.
 * @param {string} title
 * @param {string} [body]
 * @param {'success'|'error'|'info'} [type='info']
 */
export function showToast(title, body = '', type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const iconMap = { success: '✓', error: '✕', info: 'ℹ' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Barrierefreiheit: Fehler = assertive, Rest = polite (wie im bisherigen Code)
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${iconMap[type] ?? iconMap.info}</span>
        <div class="toast-text">
            <div class="toast-title">${escHtml(title)}</div>
            ${body ? `<div class="toast-body">${escHtml(body)}</div>` : ''}
        </div>
        <button class="toast-close" aria-label="Schließen">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => _removeToast(toast));
    container.appendChild(toast);

    // Auto-Ausblenden nach 3,5 s
    const timer = setTimeout(() => _removeToast(toast), TOAST_DURATION);
    toast._timer = timer;
}

function _removeToast(toast) {
    clearTimeout(toast._timer);
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
}

/** Kurzform-Helfer */
export const toast = {
    success: (title, body) => showToast(title, body, 'success'),
    error:   (title, body) => showToast(title, body, 'error'),
    info:    (title, body) => showToast(title, body, 'info'),
};


// ── Modal-System ─────────────────────────────────────────────────────────────

let _lastFocusedElement = null;

/** Focus-Trap: Tab-Reihenfolge bleibt innerhalb des Modals */
function _trapFocus(modalEl) {
    const focusable = modalEl.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    first.focus();

    modalEl._trapHandler = (e) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
    };
    modalEl.addEventListener('keydown', modalEl._trapHandler);
}

function _releaseFocus(modalEl) {
    if (modalEl._trapHandler) {
        modalEl.removeEventListener('keydown', modalEl._trapHandler);
        delete modalEl._trapHandler;
    }
    if (_lastFocusedElement) {
        _lastFocusedElement.focus();
        _lastFocusedElement = null;
    }
}

/**
 * Öffnet ein Modal (mit Focus-Trap & Fokus-Rückgabe).
 * @param {HTMLElement|string} modal - Modal-Element oder dessen ID
 */
export function openModal(modal) {
    const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
    if (!el) return;
    _lastFocusedElement = document.activeElement;
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
    _trapFocus(el);
}

/**
 * Schließt ein Modal und gibt den Fokus zurück.
 * @param {HTMLElement|string} modal - Modal-Element oder dessen ID
 */
export function closeModal(modal) {
    const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
    if (!el) return;
    el.classList.add('hidden');
    _releaseFocus(el);
    if (!document.querySelector('.modal:not(.hidden)')) {
        document.body.classList.remove('modal-open');
    }
}

/**
 * Globaler ESC-Handler: schließt das zuletzt geöffnete Modal.
 * Einmalig registrieren (wird von initModalSystem() aufgerufen).
 */
export function initModalSystem() {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length) {
            closeModal(openModals[openModals.length - 1]);
        }
    });
}

/**
 * Initialisiert ein einzelnes Modal: Backdrop-Klick und Close-Buttons.
 * @param {string|HTMLElement} modal
 * @param {string} [closeSelector='.modal-close, .btn-cancel-modal'] - Buttons, die schließen
 * @param {Function} [onClose] - Optionaler Callback beim Schließen
 */
export function initModal(modal, closeSelector = '.modal-close', onClose = null) {
    const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
    if (!el) return;

    const doClose = () => { closeModal(el); onClose?.(); };

    el.querySelectorAll(closeSelector).forEach(btn => btn.addEventListener('click', doClose));
    el.querySelector('.modal-backdrop')?.addEventListener('click', doClose);
}

/**
 * Dynamisches Bestätigungs-Modal. Gibt Promise<boolean> zurück.
 * @param {{ title: string, message?: string, confirmLabel?: string, cancelLabel?: string, confirmStyle?: string }} options
 * @returns {Promise<boolean>}
 */
export function confirmModal({
    title,
    message        = '',
    confirmLabel   = 'Bestätigen',
    cancelLabel    = 'Abbrechen',
    confirmStyle   = 'primary',
}) {
    return new Promise((resolve) => {
        document.getElementById('__confirm-modal')?.remove();

        const el = document.createElement('div');
        el.id        = '__confirm-modal';
        el.className = 'modal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', '__confirm-title');

        el.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content" style="max-width:420px">
                <div class="modal-header">
                    <h2 id="__confirm-title">${escHtml(title)}</h2>
                    <button class="modal-close" aria-label="Schließen">&times;</button>
                </div>
                ${message ? `<p style="padding:0 1.5rem 1rem;color:#475569;">${escHtml(message)}</p>` : ''}
                <div class="modal-footer">
                    <button class="btn" id="__confirm-cancel">${escHtml(cancelLabel)}</button>
                    <button class="btn btn-${escHtml(confirmStyle)}" id="__confirm-ok">${escHtml(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(el);

        const cleanup = (result) => {
            closeModal(el);
            setTimeout(() => el.remove(), 300);
            resolve(result);
        };

        el.querySelector('#__confirm-ok').addEventListener('click',     () => cleanup(true));
        el.querySelector('#__confirm-cancel').addEventListener('click', () => cleanup(false));
        el.querySelector('.modal-close').addEventListener('click',      () => cleanup(false));
        el.querySelector('.modal-backdrop').addEventListener('click',   () => cleanup(false));

        openModal(el);
    });
}
