/**
 * tableHelpers.js
 * Wiederverwendbare Sort- und Filter-Helfer für Admin-Tabellen.
 * US-058-kompatibel (gleiche Klassen/Pfeile wie History-Tabelle)
 */

/**
 * Gibt eine Vergleichsfunktion für Array.sort() zurück.
 * @param {string} key       - Feld-Name im Objekt
 * @param {'asc'|'desc'} dir - Sortierrichtung
 */
export function makeSortFn(key, dir) {
    return (a, b) => {
        let av = a[key] ?? '';
        let bv = b[key] ?? '';
        // Datumsstrings → Zahlen
        if (typeof av === 'string' && av.match(/^\d{4}-\d{2}-\d{2}/)) {
            av = new Date(av).getTime();
            bv = new Date(bv).getTime();
        }
        // Boolesche Werte normieren
        if (typeof av === 'boolean') av = av ? 1 : 0;
        if (typeof bv === 'boolean') bv = bv ? 1 : 0;
        // Strings case-insensitiv
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();

        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
    };
}

/**
 * Verwaltet sortierbaren Spaltenkopf-Zustand.
 * @param {HTMLElement} thEl   - <th>-Element
 * @param {'asc'|'desc'|null} dir - aktuell aktive Richtung oder null
 */
export function setSortHeader(thEl, dir) {
    thEl.classList.remove('th-sort-asc', 'th-sort-desc', 'th-sort-none');
    if (dir) {
        thEl.classList.add(`th-sort-${dir}`);
        thEl.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    } else {
        thEl.classList.add('th-sort-none');
        thEl.setAttribute('aria-sort', 'none');
    }
}

/**
 * Baut einen sortierbaren Spaltenkopf und gibt ihn zurück.
 * @param {string} label  - Sichtbarer Text
 * @param {string} key    - Daten-Schlüssel
 * @returns {HTMLElement}
 */
export function makeSortableTh(label, key) {
    const th = document.createElement('th');
    th.className = 'th-sortable th-sort-none';
    th.dataset.sortKey = key;
    th.setAttribute('role', 'columnheader');
    th.setAttribute('aria-sort', 'none');
    th.innerHTML = `${label} <span class="sort-arrow" aria-hidden="true">▼</span>`;
    return th;
}

/**
 * Registriert Klick-Handler für alle sortierbaren <th> in einem <thead>.
 * Ruft onSort(key, dir) auf wenn sich die Sortierung ändert.
 *
 * @param {HTMLElement}                          thead
 * @param {{ key: string, dir: 'asc'|'desc' }}  state   - Mutable-Objekt mit aktuellem Zustand
 * @param {function(key:string, dir:string):void} onSort
 */
export function bindSortHeaders(thead, state, onSort) {
    thead.querySelectorAll('th[data-sort-key]').forEach(th => {
        th.classList.add('th-sortable');
        if (!th.querySelector('.sort-arrow')) {
            th.innerHTML += ' <span class="sort-arrow" aria-hidden="true">▼</span>';
        }
        th.setAttribute('role', 'columnheader');
        th.setAttribute('tabindex', '0');

        const handleSort = () => {
            const key = th.dataset.sortKey;
            let dir;
            if (state.key === key) {
                dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                dir = 'asc';
            }
            state.key = key;
            state.dir = dir;

            // Alle Header zurücksetzen
            thead.querySelectorAll('th[data-sort-key]').forEach(t => setSortHeader(t, null));
            setSortHeader(th, dir);
            onSort(key, dir);
        };

        th.addEventListener('click', handleSort);
        th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(); } });
    });
}

/**
 * Filtert ein Array nach einem Freitext-Suchbegriff über mehrere Felder.
 * @param {Array}    data
 * @param {string}   query
 * @param {string[]} fields - Feld-Namen die durchsucht werden sollen
 */
export function filterByText(data, query, fields) {
    if (!query) return data;
    const q = query.toLowerCase().trim();
    return data.filter(item =>
        fields.some(f => {
            const val = item[f];
            return val != null && String(val).toLowerCase().includes(q);
        })
    );
}

/**
 * Filtert ein Array nach exaktem Feld-Wert (Dropdown-Filter).
 * @param {Array}  data
 * @param {string} field
 * @param {string} value  - '' bedeutet kein Filter
 */
export function filterByValue(data, field, value) {
    if (!value) return data;
    return data.filter(item => String(item[field]) === value);
}

/**
 * Aktualisiert einen Trefferzähler-Badge.
 * @param {HTMLElement|null} el
 * @param {number}           count
 */
export function updateCountBadge(el, count) {
    if (!el) return;
    el.textContent = `${count} Treffer`;
    el.classList.toggle('hidden', count === 0);
}
