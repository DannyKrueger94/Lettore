/* ========================================
   CIFRA.JS - Cifratura della versione pubblicata
   Usato sia dallo script di pubblicazione sul PC (Node.js) sia dall'app (avvio.js).

   - Codice di attivazione: 24 caratteri (120 bit casuali), es. K7QF-M2XA-9B4T-…
     Non è una password: è impossibile da indovinare anche provando all'infinito.
   - Dal codice si ricavano due chiavi (HKDF-SHA256): una AES-256-GCM per cifrare
     e una HMAC per i nomi dei file, così da fuori non si capisce quali brani ci sono.
   - Formato di un file cifrato: 12 byte di IV + dati cifrati con il controllo di integrità.
     Il nome del file (es. "app", "libreria", "spartiti/…pdf") è legato ai dati:
     un file non può essere scambiato con un altro.
   ======================================== */

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base32 senza I, L, O, U (facili da confondere)
const BYTE_CODICE = 15;                                // 120 bit = 24 caratteri
const testo = s => new TextEncoder().encode(s);
const subtle = globalThis.crypto.subtle;

// ========== CODICE DI ATTIVAZIONE ==========

/** Nuovo codice casuale, nel formato XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
export function nuovoCodice() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(BYTE_CODICE));
    let bits = 0;
    let valore = 0;
    let codice = '';
    for (const byte of bytes) {
        valore = (valore << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            codice += ALFABETO[(valore >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return codice.match(/.{4}/g).join('-');
}

/** Bytes del codice, oppure null se non è scritto correttamente. Ignora trattini, spazi e maiuscole. */
export function leggiCodice(codice) {
    const pulito = String(codice).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (pulito.length !== (BYTE_CODICE * 8) / 5) return null;
    const bytes = new Uint8Array(BYTE_CODICE);
    let bits = 0;
    let valore = 0;
    let i = 0;
    for (const carattere of pulito) {
        const cifra = ALFABETO.indexOf(carattere);
        if (cifra < 0) return null;
        valore = ((valore << 5) | cifra) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            bytes[i++] = (valore >>> (bits - 8)) & 255;
            bits -= 8;
        }
    }
    return bytes;
}

// ========== CHIAVI ==========

/** Chiavi ricavate dal codice di attivazione */
export async function chiavi(codice) {
    const bytes = leggiCodice(codice);
    if (!bytes) throw new Error('Codice scritto in modo errato');
    const base = await subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    const hkdf = info => ({ name: 'HKDF', hash: 'SHA-256', salt: testo('lettore-spartiti'), info: testo(info) });
    return {
        aes: await subtle.deriveKey(hkdf('cifratura'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
        mac: await subtle.deriveKey(hkdf('nomi'), base, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    };
}

// ========== CIFRARE E DECIFRARE ==========

/**
 * Cifra i dati. L'IV è ricavato da nome e contenuto: lo stesso file dà sempre lo stesso
 * risultato, così ripubblicando cambiano solo i file davvero modificati.
 */
export async function cifra(k, dati, nome) {
    const bytes = dati instanceof Uint8Array ? dati : new Uint8Array(dati);
    const firma = new Uint8Array(await subtle.sign('HMAC', k.mac, concat(testo(`iv:${nome}\0`), bytes)));
    const iv = firma.slice(0, 12);
    const cifrato = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: testo(nome) }, k.aes, bytes));
    return concat(iv, cifrato);
}

/** Decifra i dati. Fallisce se il codice è sbagliato o il file è stato alterato. */
export async function decifra(k, dati, nome) {
    const bytes = new Uint8Array(dati);
    return subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: testo(nome) }, k.aes, bytes.slice(12));
}

/** Nome pubblico (illeggibile) di un file, es. "spartiti/Classici/Iris.pdf" -> "3f9a…" */
export async function nomeFile(k, percorso) {
    const firma = new Uint8Array(await subtle.sign('HMAC', k.mac, testo(`file:${percorso}`)));
    return [...firma.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}
