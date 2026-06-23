document.getElementById('year').textContent = new Date().getFullYear();

const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');

if (toggle && nav) {
    toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open);
    });
    nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            nav.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}

/* ============================================================
   Anfrage-Formular
   - Antispam-Check: 17 + 8 = 25
   - Sendet die Daten in Tabellenform per mailto:
   - Zeigt nach Versand eine Erfolgsmeldung
   ============================================================ */

const form = document.getElementById('anfrage-form');

if (form) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const antispam = form.querySelector('input[name="antispam"]');
    const successBox = form.querySelector('.form-success');
    const errorBox = form.querySelector('.form-error');

    const ANTISPAM_RESULT = 25;
    const RECIPIENT = ['info', 'bastke.de'].join('@');
    const SUBJECT = 'Modulwrap Anfrage';

    // Submit-Button bleibt deaktiviert, bis 25 eingegeben wurde
    const refreshSubmitState = () => {
        const ok = parseInt(antispam.value, 10) === ANTISPAM_RESULT;
        submitBtn.disabled = !ok;
    };
    refreshSubmitState();
    antispam.addEventListener('input', refreshSubmitState);

    // Tabellenförmigen Mail-Body aufbauen
    const buildBody = (data) => {
        const rows = [
            ['Vorname',          data.vorname],
            ['Name',             data.name],
            ['Anschrift',        data.anschrift],
            ['Telefonnummer',    data.telefon],
            ['E-Mail-Adresse',   data.email],
            ['Dringlichkeit',    data.dringlichkeit],
        ];
        const labelWidth = Math.max(...rows.map(r => r[0].length));
        const sep = '='.repeat(54);
        const sub = '-'.repeat(54);

        const tableLines = rows.map(([k, v]) =>
            `${k.padEnd(labelWidth)} : ${v || '-'}`
        );

        return [
            sep,
            'ANFRAGE — MODUL WRAPPING',
            sep,
            '',
            ...tableLines,
            '',
            sub,
            'Projekt / Vorhaben:',
            sub,
            (data.projekt || '').trim(),
            '',
            sep,
        ].join('\n');
    };

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        errorBox.hidden = true;
        errorBox.textContent = '';

        if (parseInt(antispam.value, 10) !== ANTISPAM_RESULT) {
            errorBox.textContent = 'Bitte beantworten Sie die Sicherheitsfrage korrekt (17 + 8).';
            errorBox.hidden = false;
            return;
        }

        if (!form.checkValidity()) {
            errorBox.textContent = 'Bitte füllen Sie alle Pflichtfelder aus.';
            errorBox.hidden = false;
            form.reportValidity();
            return;
        }

        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());
        const body = buildBody(data);

        const mailto = `mailto:${RECIPIENT}`
            + `?subject=${encodeURIComponent(SUBJECT)}`
            + `&body=${encodeURIComponent(body)}`;

        // Mail-Client öffnen
        window.location.href = mailto;

        // Formular ausblenden, Erfolgsmeldung zeigen
        Array.from(form.elements).forEach(el => { el.hidden = true; });
        successBox.hidden = false;
        successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}
