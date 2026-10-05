/* ========================================
   AVVIO.JS - Caricatore della versione pubblicata
   Su internet l'app è cifrata (dati/*.bin). Questo file è l'unico codice in chiaro:
   1. legge il codice di attivazione salvato sul dispositivo (o lo chiede)
   2. scarica e decifra dati/app.bin, che contiene HTML, CSS e moduli JS dell'app
   3. mette a disposizione dell'app la decifratura di libreria e spartiti (globalThis.lettoreCifrato)
   4. avvia l'app
   Senza codice giusto non si vede nulla: né il codice dell'app né i titoli né i PDF.
   ======================================== */

import { chiavi, decifra, leggiCodice } from './cifra.js';

const CHIAVE_CODICE = 'codice-dispositivo';
const els = {
    blocco: document.getElementById('blocco'),
    form: document.getElementById('attiva'),
    codice: document.getElementById('codice'),
    bottone: document.getElementById('attivaBtn'),
    errore: document.getElementById('errore')
};

// ========== CODICE SALVATO ==========

function codiceSalvato() {
    try {
        return localStorage.getItem(CHIAVE_CODICE);
    } catch {
        return null;
    }
}

function salvaCodice(codice) {
    try {
        if (codice) localStorage.setItem(CHIAVE_CODICE, codice);
        else localStorage.removeItem(CHIAVE_CODICE);
    } catch {
        // Storage bloccato: il codice andrà reinserito alla prossima apertura
    }
}

// ========== AVVIO DELL'APP ==========

class CodiceErrato extends Error {}

async function avvia(codice) {
    const k = await chiavi(codice);
    const response = await fetch('dati/app.bin');
    if (!response.ok) throw new Error(`app.bin: ${response.status}`);
    let pacchetto;
    try {
        pacchetto = JSON.parse(new TextDecoder().decode(await decifra(k, await response.arrayBuffer(), 'app')));
    } catch {
        throw new CodiceErrato();
    }

    globalThis.lettoreCifrato = {
        libreria: 'dati/libreria.bin',
        decifra: (dati, nome) => decifra(k, dati, nome)
    };

    els.blocco.hidden = true;
    const stile = document.createElement('style');
    stile.textContent = pacchetto.css;
    document.head.append(stile);
    document.body.insertAdjacentHTML('beforeend', pacchetto.html);
    await importaModuli(pacchetto.moduli, pacchetto.principale);
}

/**
 * Carica i moduli JS decifrati. Ogni modulo diventa un file temporaneo (blob:) e
 * gli import tra moduli ('./ui.js') vengono collegati a questi file.
 */
const IMPORT_LOCALE = /(\bfrom\s*|\bimport\s*\(\s*)(['"])\.\/([\w.-]+\.js)\2/g;

async function importaModuli(moduli, principale) {
    const url = {};
    const inCorso = new Set();
    const prepara = nome => {
        if (url[nome]) return url[nome];
        if (!(nome in moduli)) throw new Error(`Modulo mancante: ${nome}`);
        if (inCorso.has(nome)) throw new Error(`Import circolare: ${nome}`);
        inCorso.add(nome);
        for (const [, , , dipendenza] of moduli[nome].matchAll(IMPORT_LOCALE)) prepara(dipendenza);
        const codice = moduli[nome].replace(IMPORT_LOCALE, (_, prima, apice, file) => `${prima}${apice}${url[file]}${apice}`);
        url[nome] = URL.createObjectURL(new Blob([codice], { type: 'text/javascript' }));
        return url[nome];
    };
    await import(prepara(principale));
}

// ========== SCHERMATA DEL CODICE ==========

function mostraBlocco(messaggio = '') {
    els.blocco.hidden = false;
    els.errore.textContent = messaggio;
    els.bottone.disabled = false;
    els.codice.focus();
}

els.form.addEventListener('submit', async event => {
    event.preventDefault();
    const codice = els.codice.value.trim();
    if (!leggiCodice(codice)) return mostraBlocco('Il codice ha 24 caratteri: controlla di averlo scritto tutto.');
    els.bottone.disabled = true;
    els.errore.textContent = '';
    try {
        await avvia(codice);
        salvaCodice(codice);
        // Chiede al browser di non cancellare i dati dell'app (spartiti offline compresi)
        navigator.storage?.persist?.().catch(() => {});
    } catch (error) {
        mostraBlocco(error instanceof CodiceErrato
            ? 'Codice non valido.'
            : 'Serve la connessione a internet per attivare il dispositivo.');
    }
});

const salvato = codiceSalvato();
if (!salvato) {
    mostraBlocco();
} else {
    try {
        await avvia(salvato);
    } catch (error) {
        if (error instanceof CodiceErrato) {
            // Il codice è stato cambiato con una nuova pubblicazione
            salvaCodice(null);
            mostraBlocco('Il codice è cambiato: inserisci quello nuovo.');
        } else {
            mostraBlocco('Impossibile aprire l\'app. Collegati a internet e riprova.');
        }
    }
}
