/**
 * Hash-basierter Router für ZeitStempel SPA
 * Navigiert über window.location.hash (#dashboard, #admin, etc.)
 */

const routes = {};
let currentRoute = null;
let onNavigateCallback = null;
let getCurrentUserFn = null;

/**
 * Funktion registrieren, die den aktuellen User zurückgibt (für Rollen-Check)
 */
export function setCurrentUserProvider(fn) {
    getCurrentUserFn = fn;
}

/**
 * Route registrieren
 * @param {string} name - Route-Name (z.B. 'dashboard')
 * @param {object} config - { pageId, onEnter?, roles? }
 */
export function registerRoute(name, config) {
    routes[name] = config;
}

/**
 * Callback setzen der bei jeder Navigation aufgerufen wird
 */
export function onNavigate(callback) {
    onNavigateCallback = callback;
}

/**
 * Zu einer Route navigieren
 */
export function navigateTo(routeName) {
    if (!routes[routeName]) {
        console.warn(`Route "${routeName}" nicht registriert`);
        return;
    }
    window.location.hash = `#${routeName}`;
}

/**
 * Aktuelle Route ermitteln
 */
export function getCurrentRoute() {
    return currentRoute;
}

/**
 * Router starten – hört auf hashchange Events
 * @param {string} defaultRoute - Fallback-Route
 */
export function startRouter(defaultRoute = 'dashboard') {
    function handleHash() {
        const hash = window.location.hash.replace('#', '') || defaultRoute;
        const route = routes[hash];

        if (!route) {
            window.location.hash = `#${defaultRoute}`;
            return;
        }

        // Rollen-Check: Falls Route `roles` definiert, prüfen ob User berechtigt ist
        if (route.roles && route.roles.length > 0) {
            const user = getCurrentUserFn ? getCurrentUserFn() : null;
            if (!user || !route.roles.includes(user.role)) {
                window.location.hash = `#${defaultRoute}`;
                return;
            }
        }

        // Alle Pages verstecken
        Object.values(routes).forEach(r => {
            const el = document.getElementById(r.pageId);
            if (el) el.classList.add('hidden');
        });

        // Aktive Page zeigen
        const pageEl = document.getElementById(route.pageId);
        if (pageEl) pageEl.classList.remove('hidden');

        currentRoute = hash;

        // Callback & onEnter
        if (onNavigateCallback) onNavigateCallback(hash);
        if (route.onEnter) route.onEnter();
    }

    window.addEventListener('hashchange', handleHash);
    handleHash(); // Initial
}
