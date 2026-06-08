// Service Worker — Touching Sound
// Estrategia: cache-first para todos los assets locales.
// En el primer visit se descargan y cachean; los siguientes son instantáneos.

const CACHE = 'touching-sound-v14';

// Assets locales a precachear en el install
const PRECACHE = [
  '/',
  '/index.html',
  '/app.html',
  '/style.css',
  '/main.js',
  '/audio.js',
  '/ui.js',
  '/gestures.js',
  '/layers.js',

  // Fuentes
  '/fonts/EricaOne-Regular.ttf',
  '/fonts/Montserrat-Regular.ttf',

  // SVGs de la app
  '/svg/personaje_web.svg',
  '/svg/manos_web.svg',
  '/svg/pinch.svg',
  '/svg/fist.svg',
  '/svg/left_hand.svg',
  '/svg/right_hand.svg',
  '/svg/bar_tutorial.svg',
  '/svg/hand_tutorial.svg',
  '/svg/pinch_tutorial.svg',
  '/svg/tempo_tutorial.svg',

  // Iconos
  '/svg/icons/icon_piano.svg',
  '/svg/icons/icon_drum.svg',
  '/svg/icons/icon_wave.svg',
  '/svg/icons/icon_trem.svg',
  '/svg/icons/icon_dist.svg',
  '/svg/icons/icon_chorus.svg',
  '/svg/icons/icon_delay.svg',
  '/svg/icons/icon_synth.svg',
  '/svg/icons/icon_bass.svg',
  '/svg/icons/icon_effects.svg',
  '/svg/icons/icon_added_effects.svg',
  '/svg/icons/icon_tempo.svg',
  '/svg/icons/icon_mute.svg',
  '/svg/icons/icon_palette.svg',
  '/svg/icons/icon_record.svg',
  '/svg/icons/left_palette.svg',

  // Muestras de audio — Claps
  '/samples/Claps/RD_C_1.wav',
  '/samples/Claps/RD_C_3.wav',
  '/samples/Claps/RD_C_5.wav',
  '/samples/Claps/RD_C_6.wav',

  // Crash
  '/samples/Cymbals/Crash/RD_C_C_1.wav',
  '/samples/Cymbals/Crash/RD_C_C_2.wav',
  '/samples/Cymbals/Crash/RD_C_C_3.wav',
  '/samples/Cymbals/Crash/RD_C_C_4.wav',
  '/samples/Cymbals/Crash/RD_C_C_5.wav',
  '/samples/Cymbals/Crash/RD_C_C_6.wav',
  '/samples/Cymbals/Crash/RD_C_C_7.wav',
  '/samples/Cymbals/Crash/RD_C_C_8.wav',
  '/samples/Cymbals/Crash/RD_C_C_9.wav',

  // Hi-Hat cerrado
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_1.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_2.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_3.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_4.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_5.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_6.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_7.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_8.wav',
  '/samples/Cymbals/Hi%20Hat/closed%20hat/RD_C_HH_9.wav',

  // Hi-Hat abierto
  '/samples/Cymbals/Hi%20Hat/open%20hat/RD_C_HH_11.wav',
  '/samples/Cymbals/Hi%20Hat/open%20hat/RD_C_HH_12.wav',
  '/samples/Cymbals/Hi%20Hat/open%20hat/RD_C_HH_13.wav',

  // Ride
  '/samples/Cymbals/Ride/RD_C_R_1.wav',
  '/samples/Cymbals/Ride/RD_C_R_2.wav',
  '/samples/Cymbals/Ride/RD_C_R_3.wav',
  '/samples/Cymbals/Ride/RD_C_R_4.wav',
  '/samples/Cymbals/Ride/RD_C_R_5.wav',
  '/samples/Cymbals/Ride/RD_C_R_6.wav',
  '/samples/Cymbals/Ride/RD_C_R_7.wav',
  '/samples/Cymbals/Ride/RD_C_R_8.wav',
  '/samples/Cymbals/Ride/RD_C_R_9.wav',
  '/samples/Cymbals/Ride/RD_C_R_10.wav',
  '/samples/Cymbals/Ride/RD_C_R_11.wav',
  '/samples/Cymbals/Ride/RD_C_R_12.wav',

  // Splash
  '/samples/Cymbals/Splash/RD_C_S_1.wav',
  '/samples/Cymbals/Splash/RD_C_S_2.wav',
  '/samples/Cymbals/Splash/RD_C_S_3.wav',
  '/samples/Cymbals/Splash/RD_C_S_4.wav',
  '/samples/Cymbals/Splash/RD_C_S_5.wav',
  '/samples/Cymbals/Splash/RD_C_S_6.wav',
  '/samples/Cymbals/Splash/RD_C_S_7.wav',
  '/samples/Cymbals/Splash/RD_C_S_8.wav',
  '/samples/Cymbals/Splash/RD_C_S_9.wav',

  // Kick
  '/samples/Kick/RD_K_1.wav',
  '/samples/Kick/RD_K_2.wav',
  '/samples/Kick/RD_K_3.wav',
  '/samples/Kick/RD_K_4.wav',
  '/samples/Kick/RD_K_5.wav',
  '/samples/Kick/RD_K_6.wav',
  '/samples/Kick/RD_K_9.wav',
  '/samples/Kick/RD_K_10.wav',

  // Blast Block
  '/samples/Percussion/Blast%20Block/RD_P_BB_1.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_2.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_3.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_4.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_5.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_6.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_7.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_8.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_9.wav',
  '/samples/Percussion/Blast%20Block/RD_P_BB_10.wav',

  // Cowbell
  '/samples/Percussion/Cowbell/RD_P_C_1.wav',
  '/samples/Percussion/Cowbell/RD_P_C_2.wav',
  '/samples/Percussion/Cowbell/RD_P_C_3.wav',
  '/samples/Percussion/Cowbell/RD_P_C_4.wav',
  '/samples/Percussion/Cowbell/RD_P_C_5.wav',
  '/samples/Percussion/Cowbell/RD_P_C_6.wav',
  '/samples/Percussion/Cowbell/RD_P_C_7.wav',
  '/samples/Percussion/Cowbell/RD_P_C_8.wav',

  // Egg Shaker
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_1.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_2.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_3.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_4.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_5.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_6.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_7.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_8.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_9.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_10.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_11.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_12_100BPM.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_13_100BPM.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_14_128BPM.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_15_128BPM.wav',
  '/samples/Percussion/Egg%20Shaker/RD_P_ES_16_160BPM.wav',

  // Sleigh Bells
  '/samples/Percussion/Sleigh%20Bells/RD_P_SB_1.wav',
  '/samples/Percussion/Sleigh%20Bells/RD_P_SB_2.wav',
  '/samples/Percussion/Sleigh%20Bells/RD_P_SB_3.wav',
  '/samples/Percussion/Sleigh%20Bells/RD_P_SB_4.wav',
  '/samples/Percussion/Sleigh%20Bells/RD_P_SB_5.wav',

  // Stick Hits
  '/samples/Percussion/Stick%20Hits/RD_P_SH_1.wav',
  '/samples/Percussion/Stick%20Hits/RD_P_SH_2.wav',
  '/samples/Percussion/Stick%20Hits/RD_P_SH_3.wav',

  // Snare
  '/samples/Snare/RD_S_1.wav',
  '/samples/Snare/RD_S_2.wav',
  '/samples/Snare/RD_S_3.wav',
  '/samples/Snare/RD_S_4.wav',
  '/samples/Snare/RD_S_5.wav',
  '/samples/Snare/RD_S_6.wav',
  '/samples/Snare/RD_S_7.wav',
  '/samples/Snare/RD_S_8.wav',
  '/samples/Snare/RD_S_9.wav',
  '/samples/Snare/RD_S_10.wav',
  '/samples/Snare/RD_S_11.wav',
  '/samples/Snare/RD_S_12.wav',
  '/samples/Snare/RD_S_13.wav',

  // Snare Processed
  '/samples/Snare/Processed/RD_S_P_3.wav',
  '/samples/Snare/Processed/RD_S_P_4.wav',
  '/samples/Snare/Processed/RD_S_P_5.wav',
  '/samples/Snare/Processed/RD_S_P_6.wav',
  '/samples/Snare/Processed/RD_S_P_7.wav',
  '/samples/Snare/Processed/RD_S_P_8.wav',
  '/samples/Snare/Processed/RD_S_P_9.wav',
  '/samples/Snare/Processed/RD_S_P_10.wav',

  // Floor Tom
  '/samples/Toms/Floor%20Tom/RD_T_FT_1.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_2.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_3.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_4.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_5.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_6.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_7.wav',
  '/samples/Toms/Floor%20Tom/RD_T_FT_8.wav',

  // High Tom
  '/samples/Toms/High%20Tom/RD_T_HT_1.wav',
  '/samples/Toms/High%20Tom/RD_T_HT_2.wav',
  '/samples/Toms/High%20Tom/RD_T_HT_3.wav',
  '/samples/Toms/High%20Tom/RD_T_HT_4.wav',
  '/samples/Toms/High%20Tom/RD_T_HT_7.wav',
  '/samples/Toms/High%20Tom/RD_T_HT_8.wav',

  // Mid Tom
  '/samples/Toms/Mid%20Tom/RD_T_MT_1.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_2.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_3.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_4.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_6.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_8.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_9.wav',
  '/samples/Toms/Mid%20Tom/RD_T_MT_10.wav',
];

// ── Install: precachear todos los assets locales ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cachear en lotes de 10 para no saturar la red
      const chunks = [];
      for (let i = 0; i < PRECACHE.length; i += 10) {
        chunks.push(PRECACHE.slice(i, i + 10));
      }
      return chunks.reduce((p, chunk) =>
        p.then(() =>
          Promise.allSettled(chunk.map(url =>
            cache.add(url).catch(() => {/* ignorar fallos individuales */})
          ))
        ), Promise.resolve()
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches antiguas ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first para assets locales, network-only para externos ────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorar requests que no sean GET (p.ej. las del modelo MediaPipe)
  if (event.request.method !== 'GET') return;

  // Recursos externos (CDN de MediaPipe, etc.) → siempre red
  if (url.origin !== self.location.origin) return;

  // No interceptar navegaciones HTML — dejar que vayan directo a la red.
  // Las navegaciones a /app, / etc. fallan si el SW intenta fetchearlas
  // porque Cloudflare las sirve con rewrites que el SW no puede seguir.
  if (event.request.mode === 'navigate') return;

  const req = new Request(event.request, { redirect: 'follow' });

  // Cache-first para assets (JS, CSS, WAVs, SVGs, fuentes).
  // Sin caching dinámico para evitar cascadas de operaciones IDB.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
