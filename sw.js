/* ========================================
   SW.JS - Service worker: l'app funziona anche offline
   - App (html, css, js, pdf.js): cache con versione, aggiornata quando cambi VERSION
   - Spartiti PDF: cache separata "spartiti-pdf" gestita dall'app, che resta tra un aggiornamento e l'altro
   - Libreria: prima la rete; se non risponde entro pochi secondi si usa la copia salvata,
     così l'app si apre senza attese anche con una connessione pessima
   Funziona sia con i sorgenti in chiaro (libreria.json, *.pdf) sia con la versione
   pubblicata cifrata (dati/libreria.bin, dati/app.bin, dati/*.bin).
   Sorgenti: quando modifichi l'app, aumenta VERSION e comparirà l'avviso "Aggiorna".
   Versione pubblicata: VERSION e APP_FILES li scrive da solo strumenti/pubblica.mjs.
   ======================================== */

const VERSION = 'p-cf619118ee1d';
const APP_CACHE = `app-${VERSION}`;
const PDF_CACHE = 'spartiti-pdf';

const APP_FILES = [
    "./",
    "./index.html",
    "./avvio.js",
    "./cifra.js",
    "./manifest.webmanifest",
    "./dati/app.bin",
    "./dati/libreria.bin",
    "./vendor/pdfjs/pdf.min.mjs",
    "./vendor/pdfjs/pdf.worker.min.mjs",
    "./icons/icon-128x128.png",
    "./icons/icon-144x144.png",
    "./icons/icon-152x152.png",
    "./icons/icon-192x192.png",
    "./icons/icon-384x384.png",
    "./icons/icon-512x512.png",
    "./icons/icon-72x72.png",
    "./icons/icon-96x96.png"
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_FILES)));
});

self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name !== APP_CACHE && name !== PDF_CACHE) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    const path = url.pathname;
    const isLibrary = path.endsWith('/libreria.json') || path.endsWith('/dati/libreria.bin');
    const isSheet = path.toLowerCase().endsWith('.pdf')
        || (path.includes('/dati/') && path.endsWith('.bin') && !isLibrary && !path.endsWith('/dati/app.bin'));

    // Spartiti: prima la cache degli spartiti, poi la rete
    if (isSheet) {
        event.respondWith(
            caches.open(PDF_CACHE).then(cache => cache.match(request)).then(hit => hit || fetch(request))
        );
        return;
    }

    // Libreria: prima la rete (così vedi subito i brani nuovi), offline la copia salvata.
    // Con una connessione che non risponde, dopo 3 secondi si usa la copia salvata.
    if (isLibrary) {
        const key = url.origin + path;
        event.respondWith(
            withTimeout(fetch(request), 3000)
                .then(response => {
                    if (!response.ok) throw new Error(`libreria: ${response.status}`);
                    const copy = response.clone();
                    caches.open(APP_CACHE).then(cache => cache.put(key, copy));
                    return response;
                })
                .catch(() => caches.match(key))
        );
        return;
    }

    // Resto dell'app: dalla cache della versione installata (veloce e offline)
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then(hit => {
            if (hit) return hit;
            return fetch(request).catch(() => {
                if (request.mode === 'navigate') return caches.match('./index.html');
                throw new Error('offline');
            });
        })
    );
});

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
