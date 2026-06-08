(function () {
'use strict';

// ── Atmósferas ────────────────────────────────────────────────────────────────
// Cada atmósfera define el contexto musical completo de la performance:
// - name:   nombre para mostrar en la UI.
// - scale:  array de notas MIDI que forman la escala (16 notas, dos octavas).
//           Todas las melodías, arpegios y el bajo usan solo estas notas.
// - color:  RGB base para el tinte de fondo (interpolado suavemente al cambiar).
// - tempo:  BPM por defecto al activar esta atmósfera (puede sobreescribirse
//           con el slider de tempo).
// Las 5 atmósferas cubren rangos de humor y velocidad distintos:
//   void=oscuro/lento, pulse=intenso/medio, float=aéreo/lento,
//   bloom=cálido/medio, storm=caótico/rápido.
const ATMOSPHERES = {
  void:  { name:'Void',  scale:[28,30,32,33,35,37,38,  40,42,44,45,47,49,50,52,53], color:{r:30, g:20, b:80},  tempo:72  },
  pulse: { name:'Pulse', scale:[38,40,41,43,45,47,48,  50,52,53,55,57,59,60,62,64], color:{r:120,g:20, b:40},  tempo:110 },
  float: { name:'Float', scale:[53,55,57,59,60,62,64,  65,67,69,71,72,74,76,77,79], color:{r:20, g:80, b:100}, tempo:80  },
  bloom: { name:'Bloom', scale:[43,45,47,49,50,52,54,  55,57,59,61,62,64,66,67,69], color:{r:80, g:100,b:20},  tempo:95  },
  storm: { name:'Storm', scale:[35,36,38,40,41,43,45,  47,48,50,52,53,55,57,59,60], color:{r:100,g:40, b:10},  tempo:130 },
};

// Los 7 grados de la escala diatónica (I al VII), usados como raíces de acorde.
// CHORD_OFFSETS define la voicing del acorde de 4 notas: raíz, 3ª, 5ª y 7ª diatónicas.
// Ejemplo: raíz=0, offset +2 = 3ª, +4 = 5ª, +6 = 7ª — un acorde de séptima.
const CHORD_ROOTS   = [0, 1, 2, 3, 4, 5, 6];
const CHORD_NAMES   = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const CHORD_OFFSETS = [0, 2, 4, 6];

// Cuatro patrones de groove para el bajo, de mínimo a máximo movimiento.
// Cada array tiene 8 posiciones (una por corchea del compás).
// El valor es el desplazamiento diatónico desde la raíz del acorde actual.
// null = silencio en esa posición. 0=raíz, 2=tercera, 4=quinta, 5=sexta, 7=octava.
// groove 0: solo raíz en los tiempos fuertes (minimalista).
// groove 1: raíz + quinta, dos veces por compás.
// groove 2: línea de escala ascendente en corcheas.
// groove 3: línea cromática con bordaduras — el más expresivo y sincopado.
const BASS_GROOVES = [
  [0, null, null, null, 0, null, null, null],
  [0, null, 4,    null, 0, null, 4,    null],
  [0, 2,    4,    2,    0, 4,    7,    4   ],
  [0, 2,    4,    5,    4, 2,    0,    2   ],
];

// ── Patrones rítmicos (mano derecha → complejidad 0–2) ────────────────────────
// Los patrones se dividen en tres rangos de BPM para que el groove se adapte
// al tempo real en vez de sonar igual de rápido o lento.
// Cada rango tiene 3 niveles de complejidad (0=mínimo, 1=medio, 2=complejo).
// Los arrays tienen 8 posiciones = 8 corcheas = 1 compás de 4/4.
// Índices: 0=tiempo1  1=tiempo1+ (and)  2=tiempo2  3=tiempo2+
//          4=tiempo3  5=tiempo3+         6=tiempo4  7=tiempo4+
// ghost: golpe de caja suave (snare a volumen bajo) para humanizar el groove.
// Los fills automáticos de toms se generan por separado en _playDrumFill().
// IMPORTANTE: el clap solo aparece en fast y SIEMPRE se suma a la snare,
// nunca la sustituye. r0 de todos los rangos no tiene clap.
const RHYTHM_PATTERNS = {
  // LENTO ≤85 BPM — hip-hop / boom-bap / trap
  slow: [
    // r0: mínimo — bombo en el 1, caja en el 3
    { kick:[1,0,0,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    // r1: boom-bap — bombo 1+and2, caja 2+4, ghost en and-de-1
    { kick:[1,0,0,1, 0,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
    // r2: trap completo — bombo 1+1++, caja 2+4, ghost antes de cada caja
    { kick:[1,1,0,0, 0,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,1, 0,0,0,1] },
  ],
  // MEDIO 86–125 BPM — rock / funk
  med: [
    // r0: rock básico — bombo 1+3, caja 2+4
    { kick:[1,0,0,0, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    // r1: funk groove — bombo 1+and2+3, caja 2+4, ghost en and-de-1
    { kick:[1,0,0,1, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
    // r2: hard funk — bombo 1+and2+3+and3, caja 2+4, ghost en 1++3+
    { kick:[1,0,0,1, 1,0,1,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
  ],
  // RÁPIDO >125 BPM — electrónico / broken-beat (sin four-on-the-floor)
  // El clap se añade ENCIMA de la caja en 2+4 — nunca la sustituye.
  fast: [
    // r0: mínimo — bombo 1+3, caja 2+4, sin clap
    { kick:[1,0,0,0, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    // r1: sincopado — bombo 1+3+and4, caja 2+4, clap 2+4
    { kick:[1,0,0,0, 1,0,0,1], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,1,0, 0,0,1,0], ghost:[0,0,0,0, 0,0,0,0] },
    // r2: broken-beat — bombo 1+1++3+and4, caja 2+4, clap 2+4, ghost antes del 2
    { kick:[1,1,0,0, 1,0,0,1], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,1,0, 0,0,1,0], ghost:[0,0,0,1, 0,0,0,0] },
  ],
};

// ── Patrones de platillos (mano izquierda → densidad 0–2) ─────────────────────
// c0 = hihat cerrado solamente — sin hihat abierto ni crash.
// c1 = corcheas de hihat + 1 hihat abierto muy sutil al final del compás (sin crash).
// c2 = corcheas de hihat + hihat abierto + crash cada 4 barras.
// El hihat abierto en c1 se dispara en la posición que deja hueco el patrón de
// hihat (posición 7 en slow/fast, posición 3 en med), para que el siguiente
// golpe de hihat cerrado lo "cierre" (choke). Esto es comportamiento real de batería.
const CYMBAL_PATTERNS = {
  // LENTO ≤85 BPM
  slow: [
    // c0: hihat cerrado en negras, sin abiertos ni crash
    { hihat:[1,0,1,0, 1,0,1,0], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    // c1: corcheas de hihat + hihat abierto muy suave al final del compás
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[0,0,0,0, 0,0,0,0] },
    // c2: corcheas de hihat + hihat abierto al final + crash cada 4 barras
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[1,0,0,0, 0,0,0,0] },
  ],
  // MEDIO 86–125 BPM
  med: [
    // c0: hihat cerrado en negras, sin abiertos ni crash
    { hihat:[1,0,1,0, 1,0,1,0], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    // c1: corcheas de hihat + hihat abierto suave antes de la caja en el 2
    { hihat:[1,1,1,0, 1,1,1,1], openhat:[0,0,0,1, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    // c2: corcheas de hihat + hihat abierto antes de caja + crash cada 4 barras
    { hihat:[1,1,1,0, 1,1,1,1], openhat:[0,0,0,1, 0,0,0,0], crash:[1,0,0,0, 0,0,0,0] },
  ],
  // RÁPIDO >125 BPM
  fast: [
    // c0: hihat cerrado en contratiempos (off-beats), sin abiertos ni crash
    { hihat:[0,1,0,1, 0,1,0,1], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    // c1: corcheas de hihat + hihat abierto muy suave al final del compás
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[0,0,0,0, 0,0,0,0] },
    // c2: corcheas de hihat + hihat abierto al final + crash cada 4 barras
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[1,0,0,0, 0,0,0,0] },
  ],
};

// Clasifica el BPM en uno de los tres rangos de patrón. Usado por ambas funciones
// de búsqueda de patrón para no repetir la misma lógica ternaria dos veces.
function _bpmBucket(bpm) { return bpm <= 85 ? 'slow' : bpm <= 125 ? 'med' : 'fast'; }

// Devuelve el patrón rítmico (kick/snare/clap/ghost) para el nivel de complejidad
// e y el BPM dados. complexity se clampea a 0–2.
function _getRhythmPattern(complexity, bpm) { return RHYTHM_PATTERNS[_bpmBucket(bpm)][Math.max(0, Math.min(2, complexity))]; }

// Devuelve el patrón de platillos (hihat/openhat/crash) para el nivel de densidad
// y el BPM dados. level se clampea a 0–2.
function _getCymbalPattern(level,      bpm) { return CYMBAL_PATTERNS [_bpmBucket(bpm)][Math.max(0, Math.min(2, level))];      }

// ── Catálogo de samples de batería ───────────────────────────────────────────
// Mapea el nombre lógico del instrumento a su carpeta de samples y prefijo de archivo.
// El cargador construye los nombres: ${dir}/${prefix}${i}.wav, donde i va de
// start (por defecto 1) hasta start+count-1.
// openhat usa start:10 porque sus archivos están numerados RD_C_HH_10..15 en
// la misma carpeta que los cerrados (1..9), pero en subdirectorios distintos.
const DRUM_CATALOG = {
  kick:      { dir:'samples/Kick',                            prefix:'RD_K_',    count:10 },
  snare:     { dir:'samples/Snare',                          prefix:'RD_S_',    count:16 },
  hihat:     { dir:'samples/Cymbals/Hi Hat/closed hat',      prefix:'RD_C_HH_', count:9  },
  openhat:   { dir:'samples/Cymbals/Hi Hat/open hat',        prefix:'RD_C_HH_', count:6, start:10 },
  clap:      { dir:'samples/Claps',                          prefix:'RD_C_',    count:8  },
  crash:     { dir:'samples/Cymbals/Crash',                  prefix:'RD_C_C_',  count:9  },
  highTom:   { dir:'samples/Toms/High Tom',                  prefix:'RD_T_HT_', count:9  },
  midTom:    { dir:'samples/Toms/Mid Tom',                   prefix:'RD_T_MT_', count:10 },
  floorTom:  { dir:'samples/Toms/Floor Tom',                 prefix:'RD_T_FT_', count:8  },
};

// ── Catálogo de efectos y formas de onda ─────────────────────────────────────
// FX_OPTIONS: orden canónico de los efectos. Usado para iterar y como claves.
// FX_LABELS:  nombre corto para mostrar en la UI.
// FX_COLORS:  color RGB por efecto — usado en el menú de la mano izquierda y en
//             los badges de la paleta.
const FX_OPTIONS = ['reverb', 'filter', 'drive', 'delay', 'flutter'];
const FX_LABELS  = { reverb:'Verb', filter:'Filtro', drive:'Drive', delay:'Delay', flutter:'Flutter' };
const FX_COLORS  = { reverb:[100,180,255], filter:[255,180,60], drive:[255,80,80], delay:[140,255,180], flutter:[200,100,255] };

// Formas de onda disponibles por capa. El orden importa: es el que se muestra en
// el menú de la mano izquierda cuando la capa está en modo play/edit.
// perc no tiene oscilador propio (usa samples), por eso su array está vacío.
const WAVEFORM_OPTIONS = {
  pad:  ['sine', 'triangle', 'sawtooth'],
  bass: ['triangle', 'sawtooth', 'square', 'sine'],
  synth:['sawtooth', 'square', 'triangle', 'sine'],
  lead: ['triangle', 'sine', 'sawtooth', 'square'],
  perc: [],
};

// ── Nodos de bus de audio ─────────────────────────────────────────────────────
// Topología del grafo de audio:
//   melodyBus → masterOut → dryGain → destination  (señal directa, seca)
//   rhythmBus → masterOut
//   masterOut → dryGain → destination
//   melodyBus → melodyRevSend (0.28) → reverbNode → reverbGain (0.30) → destination
//   rhythmBus → drumRevSend  (0.05) → reverbNode  (los drums son mucho más secos)
//   melodyBus/bassDelaySend etc. → _delayNode → _delayWet → masterOut
// Dos buses separan melodía (pad/synth/lead) de ritmo (bass/perc) para poder
// controlar su reverb de forma independiente.
let audioCtx   = null;   // contexto Web Audio — se crea una sola vez en init()
let masterOut  = null;   // gain de salida maestra (0.80)
let melodyBus  = null;   // suma de todas las capas melódicas (0.75)
let rhythmBus  = null;   // suma del bajo y la batería (0.80)
let reverbNode = null;   // convolucionador — impulso generado proceduralmente
let reverbGain = null;   // gain de salida del reverb (0.30)
let dryGain    = null;   // pass-through de la señal seca (1.00)
let _delayNode      = null;   // delay de 375ms (dotted eighth) con feedback 0.35
let _delayFeedback  = null;   // gain del bucle de feedback del delay
let _delayWet       = null;   // mezcla húmeda del delay hacia masterOut

// ── Nodos de audio por capa ───────────────────────────────────────────────────
// Cada capa tiene su propio subgrafo de nodos Web Audio.
// Los nodos se crean al activar la capa y se destruyen al desactivarla.

// PAD — 4 osciladores (acorde de séptima), tremolo, filtro FX, drive FX
let _padOscs        = [];    // array de { osc, env, gain } — uno por nota del acorde
let _padTremoloLFO  = null;  // oscilador de tremolo (sine, ~4.5 Hz por defecto)
let _padTremoloGain = null;  // profundidad del tremolo — se modula desde 0 (mano arriba) a 0.88 (mano abajo)
let _padBus         = null;  // gain de mute/volumen — todo el pad pasa por aquí
let _padFxFilter    = null;  // filtro pasa-baja en cadena (siempre activo, empieza en 20kHz = transparente)
let _padFxDrive     = null;  // waveshaper de saturación tanh
let _padReverbSend  = null;  // send al reverb (gain empieza en 0, sube con el efecto reverb)
let _padDelaySend   = null;  // send al delay (igual)

// BAJO — oscilador continuo, filtro, saturación, gate LFO
let _bassOsc         = null;  // oscilador — frecuencia se actualiza cada nota
let _bassEnv         = null;  // envolvente ADSR simplificada (attack lineal, decay exponencial)
let _bassFilter      = null;  // filtro pasa-baja resonante — también usado como FX filter
let _bassMuteGain    = null;  // gain de mute/volumen
let _bassReverbSend  = null;
let _bassDelaySend   = null;
let _bassDrive       = null;  // saturación waveshaper
let _bassTremoloLFO  = null;  // LFO de gate (sincronizado al tempo cuando está activo)
let _bassTremoloGain = null;  // profundidad del gate LFO

// SYNTH — oscilador + arpeggiator, filtro, saturación, tremolo
let _synthOsc         = null;
let _synthEnv         = null;  // envolvente con ataque rápido y decay corto (carácter percusivo)
let _synthFilter      = null;  // filtro pasa-baja resonante con Q alto (carácter ácido)
let _synthMuteGain    = null;
let _synthReverbSend  = null;
let _synthDelaySend   = null;
let _synthDrive       = null;
let _synthArpStep     = 0;     // paso actual del arpegio — avanza en cada tick
let _synthTremoloLFO  = null;  // mismo esquema de tremolo que el pad
let _synthTremoloGain = null;

// LEAD — oscilador continuo, tremolo melódico independiente, filtro FX, drive FX
let _leadOsc         = null;
let _leadEnv         = null;   // envolvente lenta para entrada suave del lead (0.35s attack)
let _leadTremoloLFO  = null;   // LFO de tremolo (rango 2.5–12.5 Hz)
let _leadTremoloGain = null;
let _leadBus         = null;   // gain de mute/volumen
let _leadFxFilter    = null;
let _leadFxDrive     = null;
let _leadReverbSend  = null;
let _leadDelaySend   = null;

// Pools de muestras de batería: cada nombre del catálogo tiene un array de AudioBuffers.
// _drumRR almacena el índice del round-robin — avanza en cada golpe para variar el sample.
const _drumPools = {};   // { nombre → [AudioBuffer, ...] }
const _drumRR    = {};   // { nombre → número (índice round-robin) }

// ── Máquina de estados de las capas ──────────────────────────────────────────
// Cada capa puede estar en uno de tres estados:
//   'off'     → inactiva, sin audio
//   'editing' → el usuario la está tocando en directo (las manos la controlan)
//   'looping' → hay un bucle grabado que se reproduce en loop

const _layerMode   = { pad:'off', bass:'off', synth:'off', perc:'off', lead:'off' };
const _layerMuted  = { pad:false, bass:false, synth:false, perc:false, lead:false };
// Volumen de salida por capa (0–1.2). Se aplica al nodo de mute de cada capa.
// 1.2 permite hasta +20% de ganancia (el usuario puede "empujar" el instrumento).
const _layerVolume = { pad:1.0,  bass:1.0,  synth:1.0,  perc:1.0,  lead:1.0  };
// Modo FX: cuando está activo, las manos controlan efectos en tiempo real
// en lugar de expresión (acorde, filtro, tremolo).
const _layerFxMode = { pad:false, bass:false, synth:false, perc:false, lead:false };
// Forma de onda del oscilador por capa. Se puede cambiar desde el menú izquierdo.
const _layerWaveform = { pad:'sine', bass:'triangle', synth:'sawtooth', lead:'triangle', perc:'' };
// Qué efecto está asignado a cada mano en modo FX.
// 'right' y 'left' se corresponden con la mano derecha e izquierda del usuario.
const _fxSlots = {
  pad:  { right:null, left:null },
  bass: { right:null, left:null },
  synth:{ right:null, left:null },
  perc: { right:null, left:null },
  lead: { right:null, left:null },
};
// Valores actuales de cada efecto por capa (0=neutro/desactivado, 1=máximo).
// filter arranca en 1 (filtro totalmente abierto = transparente).
// Estos valores se graban en el buffer del bucle para automatización.
const _fxVal = {};
for (const k of Layers.TYPE_ORDER) _fxVal[k] = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };

// Parámetros de expresión en tiempo real por capa.
// Se actualizan desde main.js en cada frame de MediaPipe y se leen en _tick().
const _layerRt = {
  pad:  { chordIdx:0, tremolo:0,  filterNorm:1.0 },    // acorde (0–6), tremolo (0–1), filtro (0–1)
  bass: { grooveIdx:0, filterNorm:0.8, gateNorm:0 },   // groove (0–3), filtro, gate
  synth:{ arpLen:2,   filterNorm:0.8, tremolo:0   },   // longitud arpegio (1–4), filtro, tremolo
  perc: { intensity:0, cymbalLevel:0 },                // complejidad (0–2), densidad platos (0–2)
  lead: { midi:60, tremolo:0,    filterNorm:1.0 },     // nota MIDI, tremolo, filtro
};

// ── Sistema de grabación de bucles ───────────────────────────────────────────
// Cada capa puede grabar un bucle de 8 pasos (8 corcheas = 1 compás de 4/4).
// En cada tick se guarda una "instantánea" (_snapLayer) del estado actual de la capa.
// Cuando el bucle se reproduce ('looping'), se lee la instantánea del paso actual
// en vez de los valores en tiempo real de las manos.
// _LOOP_STEPS=8 coincide exactamente con los patrones de batería de 8 pasos.
const _LOOP_STEPS = 8;    // 8 corcheas = 1 compás de 4/4
const _layerLoopBuf = { pad:null, bass:null, synth:null, perc:null, lead:null };

let _recordTarget  = null;   // clave de la capa que se está grabando ahora mismo
let _recordedSteps = 0;      // cuántos pasos se han grabado (cuenta hasta _LOOP_STEPS)
let _loopPos       = 0;      // posición actual dentro del bucle (0 a _LOOP_STEPS-1)
let _currentChordIdx = 0;    // índice de acorde global — el bajo y el synth lo leen para harmonizar

// Pre-roll: una barra de clics de metrónomo antes de que empiece la grabación.
// Permite al usuario sincronizarse antes de tocar lo que quiere grabar.
let _prerollTarget    = null;  // clave de la capa esperando a que acabe el pre-roll
let _prerollStepsLeft = 0;     // cuenta regresiva en pasos (empieza en 8 = 1 barra)
let _prerollStartAC   = 0;     // audioCtx.currentTime cuando empezó el pre-roll (para la barra de progreso)
let _prerollMs        = 0;     // duración total del pre-roll en ms (para la barra de progreso)

let _drumBeat      = 0;      // contador absoluto de pasos — nunca se resetea (solo al cambiar atmósfera)
let _atmoKey       = 'float'; // atmósfera activa
let _tempoOverride = null;   // BPM manual sobreescrito con el slider (null = usa el tempo de la atmósfera)
let _beatPulse     = 0;      // valor del destello visual en el tiempo 1 (decae en renderLoop)

// ── Scheduler de lookahead (WAAPI) ────────────────────────────────────────────
// Estrategia para timing de audio preciso:
// setTimeout es impreciso (jitter ±20ms, throttle al 1% en pestaña en segundo plano).
// Solución: usar el reloj del AudioContext (que corre independientemente del JS)
// para fijar el tiempo exacto de cada nota con src.start(time).
// El scheduler se despierta cada LOOKAHEAD_MS milisegundos y programa todas las
// notas que caen dentro de los próximos SCHEDULE_AHEAD segundos.
// Si setTimeout se retrasa, simplemente se programan más notas en ese frame.
// Las notas ya programadas no se ven afectadas — suenan en el momento exacto.
// (Patrón de Matt Ingalls / WAAPI scheduling)
const LOOKAHEAD_MS   = 25.0;   // cada cuánto se despierta el scheduler (ms)
const SCHEDULE_AHEAD = 0.10;   // cuánto por adelantado se programan las notas (segundos)
let   _nextNoteTime  = 0;      // tiempo AudioContext del próximo paso a programar
let   _scheduleTimer = null;   // referencia al setTimeout activo (para poder cancelarlo)

// ── Helpers de audio ──────────────────────────────────────────────────────────

// Convierte un número de nota MIDI a frecuencia en Hz.
// Fórmula estándar: A4 (MIDI 69) = 440 Hz. Cada semitono sube/baja un factor 2^(1/12).
// Ejemplo: MIDI 60 (Do central) = 440 × 2^((60-69)/12) = 440 × 2^(-0.75) ≈ 261.6 Hz.
function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Devuelve la nota MIDI en la posición degreeIdx de la escala de la atmósfera actual.
// Math.max/min clampea el índice para que nunca salga del array (acceso seguro).
function _scaleNote(degreeIdx) {
  const scale = ATMOSPHERES[_atmoKey].scale;
  return scale[Math.max(0, Math.min(scale.length - 1, degreeIdx))];
}

// Calcula las 4 notas MIDI de un acorde diatónico de séptima para el chordIdx dado.
// root: grado de la escala desde el que empieza el acorde (0=I, 1=II... 6=VII).
// CHORD_OFFSETS=[0,2,4,6]: salta de 2 en 2 grados → raíz, 3ª, 5ª y 7ª diatónicas.
// +7 desplaza el acorde una octava arriba en la escala (evita que el pad suene en los graves).
function _chordNotes(chordIdx) {
  const root = CHORD_ROOTS[Math.max(0, Math.min(CHORD_ROOTS.length - 1, chordIdx))] || 0;
  return CHORD_OFFSETS.map(off => _scaleNote(root + off + 7));
}

// Genera la curva de saturación para el WaveShaper de drive.
// Usa soft-clipping tanh: a values cercanas a 0 es lineal, a values altos se satura.
// preGain amplifica antes del tanh — cuanto mayor, más distorsión.
// Sin postComp: la amplitud de salida se preserva (el efecto es claramente audible).
// La curva se cachea: si amount no ha cambiado significativamente se reutiliza el
// mismo Float32Array en vez de crear uno nuevo cada frame (~30fps cuando el usuario
// mueve la mano en modo drive).
let _driveCurveCache = { amount: -1, buf: null };
function _makeDriveCurve(amount) {
  if (_driveCurveCache.buf && Math.abs(amount - _driveCurveCache.amount) < 0.001)
    return _driveCurveCache.buf;
  const n   = 256;
  const buf = _driveCurveCache.buf ?? new Float32Array(n);
  if (amount < 0.01) {
    // Sin saturación: curva lineal (identidad)
    for (let i = 0; i < n; i++) buf[i] = (i * 2) / (n - 1) - 1;
  } else {
    // Saturación tanh con preGain de 1 (sin efecto) a 21 (saturación extrema)
    const preGain = 1 + amount * 20;
    for (let i = 0; i < n; i++) buf[i] = Math.tanh(((i * 2) / (n - 1) - 1) * preGain);
  }
  _driveCurveCache = { amount, buf };
  return buf;
}

// ── Inicialización del grafo de audio ─────────────────────────────────────────
// Se llama una sola vez al iniciar la app (requiere gesto del usuario en Chrome).
// Crea todos los nodos de bus compartidos, el reverb procedural y carga los samples.
function init() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // iOS requiere reproducir un buffer silencioso en el mismo gesto del usuario
  // para desbloquear la sesión de audio. Sin esto, el AudioContext queda suspendido
  // y no produce ningún sonido aunque esté en estado 'running'.
  const _unlockBuf = audioCtx.createBuffer(1, 1, 22050);
  const _unlockSrc = audioCtx.createBufferSource();
  _unlockSrc.buffer = _unlockBuf;
  _unlockSrc.connect(audioCtx.destination);
  _unlockSrc.start(0);

  if (audioCtx.state === 'suspended') audioCtx.resume();

  masterOut  = audioCtx.createGain(); masterOut.gain.value  = 0.80;
  melodyBus  = audioCtx.createGain(); melodyBus.gain.value  = 0.75;
  rhythmBus  = audioCtx.createGain(); rhythmBus.gain.value  = 0.80;
  reverbNode = audioCtx.createConvolver();
  reverbGain = audioCtx.createGain(); reverbGain.gain.value = 0.30;
  dryGain    = audioCtx.createGain(); dryGain.gain.value    = 1.00;

  // Delay global: 375ms (~corchea a 80 BPM), feedback 35%, mezcla wet 40%
  _delayNode     = audioCtx.createDelay(2.0); _delayNode.delayTime.value = 0.375;
  _delayFeedback = audioCtx.createGain();     _delayFeedback.gain.value  = 0.35;
  _delayWet      = audioCtx.createGain();     _delayWet.gain.value       = 0.40;
  _delayNode.connect(_delayFeedback); _delayFeedback.connect(_delayNode);
  _delayNode.connect(_delayWet);      _delayWet.connect(masterOut);

  melodyBus.connect(masterOut);
  rhythmBus.connect(masterOut);
  masterOut.connect(dryGain);
  dryGain.connect(audioCtx.destination);
  reverbGain.connect(audioCtx.destination);
  reverbNode.connect(reverbGain);

  // Envíos de reverb separados: melodía recibe sala completa (0.28),
  // batería recibe solo un toque de sala (0.05) para sonar más seca.
  const melodyRevSend = audioCtx.createGain(); melodyRevSend.gain.value = 0.28;
  const drumRevSend   = audioCtx.createGain(); drumRevSend.gain.value   = 0.05;
  melodyBus.connect(melodyRevSend); melodyRevSend.connect(reverbNode);
  rhythmBus.connect(drumRevSend);   drumRevSend.connect(reverbNode);

  _buildReverb('large');
  _loadDrums();
}

// Genera un impulso de reverb procedural (ruido blanco con envolvente exponencial).
// No necesita un archivo de impulso externo. El tamaño 'large' da 4.5s de cola.
function _buildReverb(size) {
  const dur   = { small:0.8, medium:2.0, large:4.5 }[size] || 2.0;
  const decay = { small:1.5, medium:2.5, large:4.0 }[size] || 2.5;
  const sr  = audioCtx.sampleRate;             // muestras por segundo (generalmente 44100 o 48000)
  const len = Math.floor(sr * dur);            // número total de muestras del impulso
  const buf = audioCtx.createBuffer(2, len, sr); // buffer estéreo de 'len' muestras
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);           // vista directa (Float32Array) del canal
    for (let i = 0; i < len; i++) {
      // Muestra = ruido blanco (-1 a 1) × envolvente exponencial decreciente.
      // Math.random()*2-1 → ruido uniforme en [-1, 1].
      // Math.pow(1 - i/len, decay): vale 1 al principio y cae a 0 al final.
      // El exponente 'decay' controla la pendiente: mayor = cola más corta y limpia.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  reverbNode.buffer = buf;
}

// Carga todos los samples de batería del catálogo de forma asíncrona.
// Usa fetch + decodeAudioData para cada archivo WAV.
// El campo 'start' permite que los archivos no empiecen desde 1 (ej: openhat empieza en 10).
// Los archivos que no existen o fallan se saltan silenciosamente.
async function _loadDrums() {
  for (const [name, { dir, prefix, count, start = 1 }] of Object.entries(DRUM_CATALOG)) {
    _drumPools[name] = [];
    _drumRR[name]    = 0;
    for (let i = start; i < start + count; i++) {
      try {
        const res = await fetch(`${dir}/${prefix}${i}.wav`);
        if (!res.ok) continue;
        const ab  = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(ab);
        _drumPools[name].push(buf);
      } catch (e) { /* archivo no encontrado — se ignora */ }
    }
    if (_drumPools[name].length > 0) {
      console.log(`[drums] ${name}: ${_drumPools[name].length}/${count} samples cargados`);
    }
  }
}

// Reproduce un sample de batería con timing preciso anclado al reloj AudioContext.
// - name:     clave del pool (_drumPools[name])
// - vol:      ganancia 0–1.5
// - pitch:    playbackRate (null = velocidad original = 1.0)
// - time:     tiempo AudioContext en que debe sonar
// - stopTime: detener el source en este tiempo AC (para choke del hihat abierto)
// - fadeTime: fade exponencial a silencio en N segundos (para la cola del crash)
// stopTime y fadeTime son mutuamente excluyentes; fadeTime tiene prioridad.
// Round-robin: se avanza _drumRR[name] en cada llamada para variar el sample
// y evitar el "efecto de máquina de coser".
function _playDrum(name, vol, pitch, time, stopTime, fadeTime) {
  const pool = _drumPools[name];
  if (!pool || pool.length === 0) return;
  // Round-robin: módulo del pool.length para ciclar si el índice supera el número de samples
  const idx = _drumRR[name] % pool.length;
  _drumRR[name]++;
  // AudioBufferSourceNode: solo puede usarse una vez (one-shot). Cada golpe crea uno nuevo.
  const src = audioCtx.createBufferSource();
  const g   = audioCtx.createGain();
  src.buffer = pool[idx];             // asigna el AudioBuffer del sample seleccionado
  if (pitch != null) src.playbackRate.value = pitch;  // pitch > 1 = más agudo y corto
  const clampedVol = Math.max(0, Math.min(1.5, vol));
  const t = time ?? audioCtx.currentTime;
  if (fadeTime) {
    // Para el crash: automación de ganancia en el reloj AC.
    // setValueAtTime fija el valor inicial; exponentialRampToValueAtTime baja de forma
    // logarítmica hasta 0.001 (el mínimo no-cero que acepta la API).
    g.gain.setValueAtTime(clampedVol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + fadeTime);
  } else {
    g.gain.value = clampedVol;
  }
  // Cadena: source → gain → rhythmBus. El rhythmBus envía al master y al reverb/delay.
  src.connect(g); g.connect(rhythmBus);
  src.start(t);   // programa el inicio en el reloj AC — sample-accurate
  // stop() DEBE llamarse después de start() — la Web Audio API lanza InvalidStateError si no
  if (!fadeTime && stopTime != null && stopTime > t) src.stop(stopTime);
}

// Dispara el fill automático de toms al final de cada ciclo de 2 barras.
// La posición 13 (beat 5) recibe el tom agudo/medio — se eligió esta posición
// porque el beat 6 (pos 14) tiene la caja, y si los toms sonasen ahí el resultado
// era un "rimshot" involuntario (snare + highTom simultáneos).
// La posición 15 (beat 7) recibe el tom de piso y, opcionalmente, el crash.
// El crash del fill solo suena si cymbalLevel >= 2 (mano izquierda en máxima densidad).
function _playDrumFill(intensity, cymbalLevel, time) {
  const pos = _drumBeat % 16;   // posición 0–15 dentro de la ventana de 2 barras
  if (pos === 13 && intensity >= 1) {
    _playDrum('highTom', 0.48 + intensity * 0.08, null, time);
    if (intensity >= 2) _playDrum('midTom', 0.42, null, time);
  }
  if (pos === 15 && intensity >= 1) {
    _playDrum('floorTom', 0.52 + intensity * 0.06, null, time);
    if (intensity >= 2 && cymbalLevel >= 2) _playDrum('crash', 0.22, null, time, null, _beatMs() / 1000 * 1.5);
  }
}

// ── Ciclo de vida de las capas ────────────────────────────────────────────────

// Activa una capa: crea y conecta sus nodos Web Audio.
// setLayerMode es el punto de entrada habitual; esta función es llamada desde ahí.
function activateLayer(key) {
  if (!audioCtx) return;
  switch (key) {
    case 'pad':   _activatePad();   break;
    case 'bass':  _activateBass();  break;
    case 'synth': _activateSynth(); break;
    case 'perc':  break;   // perc usa samples, no osciladores — no hay nada que crear aquí
    case 'lead':  _activateLead();  break;
  }
}

// Desactiva una capa: desvanece el audio, desconecta nodos y limpia referencias.
// También borra el buffer del bucle y cancela cualquier grabación activa.
// Los nodos se desconectan después de un pequeño timeout para evitar clicks.
function deactivateLayer(key) {
  if (!audioCtx) return;
  _layerMode[key]    = 'off';
  _layerMuted[key]   = false;
  _layerFxMode[key]  = false;
  _layerLoopBuf[key] = null;
  if (_recordTarget === key) { _recordTarget = null; _recordedSteps = 0; }
  const t = audioCtx.currentTime;

  switch (key) {
    case 'pad':
      // Desvanece cada oscilador (tau=0.15s) y los desconecta 700ms después
      _padOscs.forEach(o => {
        o.env.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(() => { try { o.osc.stop(); } catch(_) {} o.osc.disconnect(); o.env.disconnect(); o.gain.disconnect(); }, 700);
      });
      _padOscs = [];
      if (_padTremoloLFO)  { try { _padTremoloLFO.stop(); } catch(_) {} _padTremoloLFO = null; }
      [_padBus, _padFxFilter, _padFxDrive, _padReverbSend, _padDelaySend].forEach(n => n?.disconnect());
      _padBus = _padFxFilter = _padFxDrive = _padReverbSend = _padDelaySend = null;
      break;
    case 'bass':
      if (_bassEnv) {
        _bassEnv.gain.setTargetAtTime(0, t, 0.08);
        if (_bassTremoloLFO) { try { _bassTremoloLFO.stop(); } catch(_) {} }
        [_bassTremoloLFO, _bassTremoloGain].forEach(n => n?.disconnect());
        _bassTremoloLFO = _bassTremoloGain = null;
        setTimeout(() => { try { _bassOsc?.stop(); } catch(_) {} [_bassOsc,_bassEnv,_bassFilter,_bassMuteGain,_bassReverbSend,_bassDelaySend,_bassDrive].forEach(n => n?.disconnect()); }, 400);
        _bassOsc = _bassEnv = _bassFilter = _bassMuteGain = _bassReverbSend = _bassDelaySend = _bassDrive = null;
      }
      break;
    case 'synth':
      if (_synthEnv) {
        _synthEnv.gain.setTargetAtTime(0, t, 0.08);
        if (_synthTremoloLFO) { try { _synthTremoloLFO.stop(); } catch(_) {} }
        [_synthTremoloLFO, _synthTremoloGain].forEach(n => n?.disconnect());
        _synthTremoloLFO = _synthTremoloGain = null;
        setTimeout(() => { try { _synthOsc?.stop(); } catch(_) {} [_synthOsc,_synthEnv,_synthFilter,_synthMuteGain,_synthReverbSend,_synthDelaySend,_synthDrive].forEach(n => n?.disconnect()); }, 400);
        _synthOsc = _synthEnv = _synthFilter = _synthMuteGain = _synthReverbSend = _synthDelaySend = _synthDrive = null;
      }
      break;
    case 'lead':
      if (_leadEnv) {
        _leadEnv.gain.setTargetAtTime(0, t, 0.08);
        setTimeout(() => { try { _leadOsc?.stop(); } catch(_) {} [_leadOsc,_leadEnv].forEach(n => n?.disconnect()); }, 400);
        _leadOsc = _leadEnv = null;
      }
      if (_leadTremoloLFO) { try { _leadTremoloLFO.stop(); } catch(_) {} _leadTremoloLFO = null; }
      [_leadBus, _leadFxFilter, _leadFxDrive, _leadReverbSend, _leadDelaySend].forEach(n => n?.disconnect());
      _leadBus = _leadFxFilter = _leadFxDrive = _leadReverbSend = _leadDelaySend = null;
      break;
  }
}

// Transición de estado de una capa. Punto de entrada principal desde main.js.
// Al pasar a 'off' llama a deactivateLayer (que limpia nodos y loop buffer).
// Al pasar de 'off' a cualquier otro estado llama a activateLayer (crea nodos).
function setLayerMode(key, mode) {
  if (!_layerMode.hasOwnProperty(key)) return;  // clave inválida — ignorar
  const prev = _layerMode[key];
  if (prev === mode) return;   // ya está en ese estado — sin cambio
  // Pasar a 'off' siempre pasa por deactivateLayer, que limpia nodos y buffer.
  if (mode === 'off') { deactivateLayer(key); return; }
  _layerMode[key] = mode;
  // Si venía de 'off' (inactivo), hay que crear los nodos de audio ahora.
  // Si venía de 'editing' o 'looping', los nodos ya existen — solo cambia el estado.
  if (prev === 'off') activateLayer(key);
}

// Getters simples del estado de capa.
function getLayerMode(key)  { return _layerMode[key] || 'off'; }
function hasLayerLoop(key)  { return _layerLoopBuf[key] !== null; }

// Elimina el bucle grabado de una capa sin desactivarla.
// Si estaba en 'looping', vuelve a 'editing' (el usuario puede retomar el control directo).
function clearLayerLoop(key) {
  _layerLoopBuf[key] = null;
  if (_layerMode[key] === 'looping') _layerMode[key] = 'editing';
}

// Desactiva todas las capas a la vez (botón CLR de la paleta).
function deactivateAllLayers() {
  _recordTarget = null; _recordedSteps = 0;
  for (const key of Layers.TYPE_ORDER) {
    if (_layerMode[key] !== 'off') deactivateLayer(key);
    Layers.setActive(key, false);
  }
}

// ── Helpers de mute y volumen ─────────────────────────────────────────────────
// Centraliza la búsqueda del nodo de gain que controla mute y volumen de cada capa.
// perc no tiene señal continua (usa samples disparados), por eso devuelve null.
// Usado por setLayerMuted y setLayerVolume para evitar duplicar el switch.
function _getMuteNode(key) {
  switch (key) {
    case 'pad':   return _padBus;
    case 'bass':  return _bassMuteGain;
    case 'synth': return _synthMuteGain;
    case 'lead':  return _leadBus;
    default:      return null;
  }
}

// Silencia o restaura una capa. Al restaurar usa el volumen almacenado (no siempre 1).
// tau=0.04s evita clicks en la transición mute/unmute.
function setLayerMuted(key, muted) {
  if (_layerMuted[key] === muted) return;
  _layerMuted[key] = muted;
  if (!audioCtx) return;
  const val = muted ? 0 : (_layerVolume[key] ?? 1);
  _getMuteNode(key)?.gain.setTargetAtTime(val, audioCtx.currentTime, 0.04);
}
function isLayerMuted(key) { return _layerMuted[key] ?? false; }

// Ajusta el volumen de salida de una capa (0–1.2). Solo tiene efecto si la capa
// no está silenciada. tau=0.06s para un cambio suave sin salto audible.
function setLayerVolume(key, val) {
  _layerVolume[key] = Math.max(0, Math.min(1.2, val));
  if (!audioCtx || _layerMuted[key]) return;
  _getMuteNode(key)?.gain.setTargetAtTime(_layerVolume[key], audioCtx.currentTime, 0.06);
}
function getLayerVolume(key) { return _layerVolume[key] ?? 1; }

// ── Modo FX ───────────────────────────────────────────────────────────────────
// Al activar FX mode, las manos dejan de controlar expresión y pasan a controlar
// efectos: mano derecha = drive (por defecto), mano izquierda = delay.
// Los valores arrancan en neutro y el usuario los esculpe en tiempo real.
// Al desactivar, todo vuelve a neutro y los slots se vacían.
function setLayerFxMode(key, on) {
  if (!_layerFxMode.hasOwnProperty(key)) return;
  _layerFxMode[key] = !!on;   // !! convierte cualquier valor a boolean estricto
  if (on) {
    // Asignación de slots por defecto: drive en la mano derecha, delay en la izquierda.
    // El usuario puede cambiarlos desde el menú izquierdo.
    _fxSlots[key] = { right: 'drive', left: 'delay' };
    // Valores iniciales neutros: reverb=0, filter=1 (abierto=transparente), drive=0...
    // filter arranca en 1 porque 0 sería el filtro completamente cerrado (sin sonido).
    _fxVal[key] = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };
    // Aplica los valores neutros a los nodos inmediatamente para tener una base limpia.
    _applyAllFx(key);
  } else {
    // Al salir del modo FX, vaciar los slots y volver a valores neutros.
    _fxSlots[key] = { right: null, left: null };
    _fxVal[key]   = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };
    // Aplica el reset para que reverb/delay/drive bajen a 0 inmediatamente.
    _applyAllFx(key);
  }
}
function getLayerFxMode(key) { return _layerFxMode[key] ?? false; }

// Asigna o elimina un efecto de un slot de mano.
// Al cambiar de efecto, el anterior se resetea inmediatamente a su valor neutro
// para que no siga sonando en segundo plano.
// filter es especial: su neutro es 1 (abierto) en vez de 0 (cerrado).
function setFxSlot(key, hand, fxKey) {
  if (!_fxSlots[key]) return;
  const prev = _fxSlots[key][hand];
  if (prev === fxKey) return;
  if (prev && audioCtx) {
    const neutral = prev === 'filter' ? 1 : 0;
    _fxVal[key][prev] = neutral;
    _applyFxParam(key, prev, neutral);
  }
  _fxSlots[key][hand] = fxKey || null;
}
function getFxSlot(key, hand) { return _fxSlots[key]?.[hand] ?? null; }

// Aplica un efecto basado en la posición Y de la mano (intensidad).
// normY: 0=mano abajo (sin efecto), 1=mano arriba (máximo).
// openness se recibe pero no se usa — se simplificó porque multiplicar por openness
// hacía que el efecto fuera casi imperceptible cuando la mano no estaba completamente abierta.
// El valor efectivo se almacena en _fxVal para grabarlo en el buffer de bucle.
function applyFx(key, hand, normY, openness) {
  const slot = _fxSlots[key]?.[hand];
  if (!slot || !audioCtx) return;
  const effVal = Math.max(0, Math.min(1, normY));
  _fxVal[key][slot] = effVal;
  _applyFxParam(key, slot, effVal);
}

// Aplica el valor de un efecto concreto a los nodos de audio de la capa.
// tau=0.10s suaviza la transición para que los cambios no suenen bruscos.
// reverb: controla la ganancia del send hacia el convolucionador (máx ×2 para que sea muy audible).
// filter: mapea 0(80Hz oscuro) → 1(16kHz brillante) con una escala logarítmica.
// drive: actualiza la curva del WaveShaper (tanh con preGain variable).
// delay: controla la ganancia del send hacia el nodo de delay global.
// flutter: modula la profundidad del tremolo LFO (pad/lead). bass/synth usan un LFO separado.
function _applyFxParam(key, fx, val) {
  if (!audioCtx) return;
  const t   = audioCtx.currentTime;
  const tau = 0.10;   // constante de tiempo del suavizado (~0.1s para llegar al 63% del valor)
  switch (fx) {
    case 'reverb': {
      // El send de reverb es un GainNode cuya ganancia controla cuánta señal se manda
      // al convolucionador. val*2.0 porque el reverb audible requiere más ganancia que [0,1].
      let send;
      switch (key) { case 'pad': send=_padReverbSend; break; case 'bass': send=_bassReverbSend; break; case 'synth': send=_synthReverbSend; break; case 'lead': send=_leadReverbSend; break; }
      if (send) send.gain.setTargetAtTime(val * 2.0, t, tau);
      break;
    }
    case 'filter': {
      // Escala logarítmica: 80 × 200^val.
      // val=0 → 80×1=80 Hz (muy oscuro). val=1 → 80×200=16000 Hz (muy brillante).
      // Se usa exponencial (no lineal) porque el oído percibe la frecuencia de forma logarítmica.
      const freq = 80 * Math.pow(200, Math.max(0, Math.min(1, val)));
      switch (key) {
        case 'pad':   if (_padFxFilter)   _padFxFilter.frequency.setTargetAtTime(freq, t, tau); break;
        case 'bass':  if (_bassFilter)    _bassFilter.frequency.setTargetAtTime(freq, t, tau); break;
        case 'synth': if (_synthFilter)   _synthFilter.frequency.setTargetAtTime(freq, t, tau); break;
        case 'lead':  if (_leadFxFilter)  _leadFxFilter.frequency.setTargetAtTime(freq, t, tau); break;
      }
      break;
    }
    case 'drive': {
      // WaveShaper.curve: tabla de lookup que transforma el audio sample a sample.
      // Asignar una nueva curva cambia el carácter de saturación de forma instantánea.
      // No usa setTargetAtTime porque el WaveShaper no tiene parámetros de AudioParam.
      const curve = _makeDriveCurve(val);
      switch (key) {
        case 'pad':   if (_padFxDrive)   _padFxDrive.curve   = curve; break;
        case 'bass':  if (_bassDrive)    _bassDrive.curve    = curve; break;
        case 'synth': if (_synthDrive)   _synthDrive.curve   = curve; break;
        case 'lead':  if (_leadFxDrive)  _leadFxDrive.curve  = curve; break;
      }
      break;
    }
    case 'delay': {
      // El send de delay funciona igual que el de reverb: GainNode → delayNode global.
      // val directamente (sin multiplicar) porque el delay a 1.0 ya suena muy presente.
      let send;
      switch (key) { case 'pad': send=_padDelaySend; break; case 'bass': send=_bassDelaySend; break; case 'synth': send=_synthDelaySend; break; case 'lead': send=_leadDelaySend; break; }
      if (send) send.gain.setTargetAtTime(val, t, tau);
      break;
    }
    case 'flutter': {
      // Flutter modula la profundidad (depth) del LFO de tremolo.
      // _padTremoloGain.gain es el AudioParam que escala la salida del LFO.
      // depth=0 → el LFO no tiene efecto (ganancia del modulador = 0 = sin tremolo).
      // depth=0.95 → el LFO modula el 95% del rango del gain del tremoloMod.
      // bass y synth tienen su propio LFO de gate — flutter no los controla directamente.
      const depth = val * 0.95;
      if (key === 'pad'  && _padTremoloGain)  _padTremoloGain.gain.setTargetAtTime(depth, t, tau);
      if (key === 'lead' && _leadTremoloGain) _leadTremoloGain.gain.setTargetAtTime(depth, t, tau);
      break;
    }
  }
}

// Aplica todos los efectos de una capa de una vez. Se usa al entrar/salir de modo FX
// para asegurarse de que todos los nodos están en el estado correcto.
function _applyAllFx(key) {
  for (const fx of FX_OPTIONS) _applyFxParam(key, fx, _fxVal[key][fx] ?? 0);
}

// ── Forma de onda ─────────────────────────────────────────────────────────────
// Cambia el tipo de onda del oscilador de una capa en tiempo real.
// try/catch es necesario porque cambiar el tipo de un OscillatorNode detenido lanza excepción.
function setLayerWaveform(key, type) {
  _layerWaveform[key] = type;
  const validTypes = ['sine','triangle','sawtooth','square'];
  if (!validTypes.includes(type)) return;
  switch (key) {
    case 'pad':   _padOscs.forEach(o => { try { o.osc.type = type; } catch(_) {} }); break;
    case 'bass':  if (_bassOsc)  { try { _bassOsc.type  = type; } catch(_) {} } break;
    case 'synth': if (_synthOsc) { try { _synthOsc.type = type; } catch(_) {} } break;
    case 'lead':  if (_leadOsc)  { try { _leadOsc.type  = type; } catch(_) {} } break;
  }
}
function getLayerWaveform(key) { return _layerWaveform[key] || 'sine'; }

// ── Metrónomo ─────────────────────────────────────────────────────────────────
// Genera un clic de metrónomo anclado al tiempo exacto del AudioContext.
// Se usa tanto en el pre-roll (4 clics antes de grabar) como durante la grabación
// (un clic por negra para que el performer se mantenga en tiempo).
// El clic es una onda sinusoidal de 1400 Hz con ataque de 3ms y caída de 75ms.
function _playClickAt(t) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.connect(env); env.connect(audioCtx.destination);
  osc.type = 'sine'; osc.frequency.value = 1400;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.55, t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
  osc.start(t); osc.stop(t + 0.09);
}

// Punto de entrada externo para el metrónomo manual (slider de tempo en main.js).
function tickMetronomeClick() { _playClickAt(audioCtx?.currentTime ?? 0); }

// ── Sistema de grabación ──────────────────────────────────────────────────────
// Inicia la grabación de una capa con una barra de pre-roll de metrónomo.
// Funciona para:
//   A) Capa en modo 'editing' → graba los parámetros de expresión en tiempo real.
//   B) Capa en modo 'looping' con FX mode → graba automatización de efectos encima.
// El pre-roll es de 8 pasos (1 barra) para que el performer entre sincronizado.
function startRecording(key) {
  if (!key || !_layerMode.hasOwnProperty(key)) return;
  const mode = _layerMode[key];
  const isFxOverdub = mode === 'looping' && _layerFxMode[key];
  if (mode !== 'editing' && !isFxOverdub) return;
  if (!audioCtx) return;

  // Cancela cualquier pre-roll anterior si había uno pendiente
  _prerollStepsLeft = 0;
  _prerollTarget    = null;

  const stepMs    = _beatMs();       // duración de una corchea en ms
  const quarterMs = stepMs * 2;      // una negra = 2 corcheas
  const barMs     = stepMs * 8;      // 1 compás = 8 corcheas
  const t0        = audioCtx.currentTime;

  // Programa los 4 clics del metrónomo (uno por negra) de forma precisa en el AC
  for (let i = 0; i < 4; i++) {
    _playClickAt(t0 + (i * quarterMs) / 1000);
  }

  // Cuenta regresiva en pasos: _tick la decrementa; cuando llega a 0 empieza a grabar
  _prerollTarget    = key;
  _prerollStartAC   = t0;
  _prerollMs        = barMs;
  _prerollStepsLeft = 8;
}

// Getters del estado de grabación y pre-roll para la UI.
function isRecording()        { return _recordTarget  !== null; }
function getRecordTarget()    { return _recordTarget; }
function isPrerolling()       { return _prerollTarget !== null; }
function getPrerollTarget()   { return _prerollTarget; }
function getPrerollProgress() {
  if (!_prerollTarget || !audioCtx) return 0;
  return Math.min(1, ((audioCtx.currentTime - _prerollStartAC) * 1000) / _prerollMs);
}
function cancelPreroll() {
  _prerollStepsLeft = 0;
  _prerollTarget    = null;
}

// Toma una instantánea del estado actual de una capa para almacenarla en el buffer
// de bucle. Incluye todos los parámetros de expresión + el estado de FX (para
// que la automatización de efectos también quede grabada).
function _snapLayer(key) {
  let base;
  switch (key) {
    case 'pad':   base = { chordIdx: _layerRt.pad.chordIdx, tremolo: _layerRt.pad.tremolo, filterNorm: _layerRt.pad.filterNorm }; break;
    case 'bass':  base = { grooveIdx: _layerRt.bass.grooveIdx, filterNorm: _layerRt.bass.filterNorm, gateNorm: _layerRt.bass.gateNorm }; break;
    case 'synth': base = { arpLen: _layerRt.synth.arpLen, filterNorm: _layerRt.synth.filterNorm, tremolo: _layerRt.synth.tremolo }; break;
    case 'perc':  base = { intensity: _layerRt.perc.intensity, cymbalLevel: _layerRt.perc.cymbalLevel }; break;
    case 'lead':  base = { midi: _layerRt.lead.midi, tremolo: _layerRt.lead.tremolo, filterNorm: _layerRt.lead.filterNorm }; break;
    default: return null;
  }
  // Siempre guarda el estado de FX para que la automatización quede en el bucle
  base.fxSlots = { ..._fxSlots[key] };
  base.fxVals  = { ..._fxVal[key] };
  return base;
}

// Reproduce la automatización de FX grabada en un paso del bucle.
// Solo actúa si la capa está en modo FX. Restaura los slots y aplica los valores.
function _applyLoopFx(key, snap) {
  if (!snap?.fxVals || !_layerFxMode[key]) return;
  if (snap.fxSlots) Object.assign(_fxSlots[key], snap.fxSlots);
  for (const [fx, val] of Object.entries(snap.fxVals)) {
    _fxVal[key][fx] = val;
    _applyFxParam(key, fx, val);
  }
}

// ── PAD — acorde de séptima continuo con tremolo y FX ────────────────────────
// Crea 4 osciladores (una nota cada uno), filtro en cadena (siempre activo),
// drive y tremolo. La cadena de señal es:
// oscs → padBus → fxFilter → fxDrive → tremoloMod → melodyBus → masterOut
//                                      ↘ reverbSend → reverbNode
//                                      ↘ delaySend  → _delayNode
function _activatePad() {
  if (_padOscs.length) return;

  // Filtro pasa-baja (empieza en 20kHz = transparente; se mueve con filtro FX o expresión)
  _padFxFilter = audioCtx.createBiquadFilter();
  _padFxFilter.type = 'lowpass'; _padFxFilter.frequency.value = 20000; _padFxFilter.Q.value = 0.8;

  // Saturador tanh (empieza sin saturación)
  _padFxDrive = audioCtx.createWaveShaper();
  _padFxDrive.curve = _makeDriveCurve(0); _padFxDrive.oversample = '4x';

  // Submódulo de tremolo: LFO sinusoidal modula la ganancia del tremoloMod
  _padTremoloLFO  = audioCtx.createOscillator();
  _padTremoloGain = audioCtx.createGain();
  const tremoloMod = audioCtx.createGain(); tremoloMod.gain.value = 1.0;
  _padTremoloLFO.type = 'sine'; _padTremoloLFO.frequency.value = 4.5; _padTremoloGain.gain.value = 0;
  _padTremoloLFO.connect(_padTremoloGain); _padTremoloGain.connect(tremoloMod.gain);

  // Bus de mute/volumen
  _padBus = audioCtx.createGain(); _padBus.gain.value = _layerMuted.pad ? 0 : (_layerVolume.pad ?? 1);

  // Sends de reverb y delay (empiezan en 0, se activan con los efectos)
  _padReverbSend = audioCtx.createGain(); _padReverbSend.gain.value = 0;
  _padDelaySend  = audioCtx.createGain(); _padDelaySend.gain.value  = 0;

  _padBus.connect(_padFxFilter); _padFxFilter.connect(_padFxDrive);
  _padFxDrive.connect(tremoloMod); tremoloMod.connect(melodyBus);
  _padFxDrive.connect(_padReverbSend); _padReverbSend.connect(reverbNode);
  _padFxDrive.connect(_padDelaySend);  _padDelaySend.connect(_delayNode);
  _padTremoloLFO.start();

  // 4 osciladores para el acorde diatónico de séptima
  const notes = _chordNotes(_layerRt.pad.chordIdx);
  notes.forEach(midi => {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    const g   = audioCtx.createGain();
    osc.type = _layerWaveform.pad; osc.frequency.value = midiToHz(midi);
    env.gain.value = 0; g.gain.value = 0.22;
    osc.connect(env); env.connect(g); g.connect(_padBus);
    osc.start(); env.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.8);  // fade in 0.8s
    _padOscs.push({ osc, env, gain: g });
  });
}

// Actualiza las frecuencias del acorde del pad. La transición es suave (tau=0.25s)
// para evitar saltos bruscos de afinación.
function _padSetChord(idx) {
  if (!_padOscs.length) return;
  const notes = _chordNotes(idx);
  notes.forEach((midi, i) => { if (_padOscs[i]) _padOscs[i].osc.frequency.setTargetAtTime(midiToHz(midi), audioCtx.currentTime, 0.25); });
}

// Tremolo sincronizado al tempo, compartido por pad y synth.
// La fórmula adapta la velocidad del LFO al BPM actual:
//   normY=0 (mano arriba, casi): flutter rápido (beatHz×4)
//   normY=1 (mano abajo): gate lento a medio tempo (beatHz/2)
// Umbral de 0.04 para evitar que un tremolo muy sutil siempre esté activo.
function _setTremoloGated(lfoNode, gainNode, normY) {
  if (!lfoNode || !gainNode) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) { gainNode.gain.setTargetAtTime(0, t, 0.18); return; }
  const beatHz = getCurrentTempo() / 60;
  lfoNode.frequency.setTargetAtTime(Math.max(0.25, beatHz / 2 + (1 - normY) * beatHz * 3.5), t, 0.28);
  gainNode.gain.setTargetAtTime(0.25 + normY * 0.63, t, 0.10);
}

// Tremolo del pad: normY=0 → sin tremolo; normY=1 → gate techno pesado.
function _padSetTremolo(normY) { _setTremoloGated(_padTremoloLFO, _padTremoloGain, normY); }

// ── BAJO — oscilador con envolvente, filtro resonante, gate y FX ──────────────
// Cadena: osc → env → vol(0.75) → filter → drive → gateGain → muteGain → rhythmBus
//                                           ↘ reverbSend / delaySend
function _activateBass() {
  if (_bassOsc) return;
  _bassFilter = audioCtx.createBiquadFilter(); _bassFilter.type = 'lowpass'; _bassFilter.frequency.value = 800; _bassFilter.Q.value = 1.2;
  _bassDrive  = audioCtx.createWaveShaper();   _bassDrive.curve = _makeDriveCurve(0); _bassDrive.oversample = '4x';
  _bassMuteGain = audioCtx.createGain(); _bassMuteGain.gain.value = _layerMuted.bass ? 0 : (_layerVolume.bass ?? 1);
  _bassReverbSend = audioCtx.createGain(); _bassReverbSend.gain.value = 0;
  _bassDelaySend  = audioCtx.createGain(); _bassDelaySend.gain.value  = 0;

  // Submódulo de gate/tremolo:
  // _bassTremoloLFO genera una onda sinusoidal (en Hz, controlada por _bassSetGate).
  // _bassTremoloGain escala esa onda: su valor es la profundidad del efecto (0=sin efecto).
  // bassGateMod.gain empieza en 1.0; el LFO se suma a ese valor, oscilando arriba y abajo.
  // Resultado: cuando el LFO está activo, bassGateMod.gain varía entre (1-depth) y (1+depth),
  // creando el efecto de gate/tremolo.
  _bassTremoloLFO  = audioCtx.createOscillator();
  _bassTremoloGain = audioCtx.createGain();
  const bassGateMod = audioCtx.createGain(); bassGateMod.gain.value = 1.0;
  _bassTremoloLFO.type = 'sine'; _bassTremoloLFO.frequency.value = 4.0; _bassTremoloGain.gain.value = 0;
  _bassTremoloLFO.connect(_bassTremoloGain); _bassTremoloGain.connect(bassGateMod.gain);
  _bassTremoloLFO.start();

  _bassOsc = audioCtx.createOscillator(); _bassEnv = audioCtx.createGain();
  const vol = audioCtx.createGain(); vol.gain.value = 0.75;  // atenuación fija pre-filtro
  // El oscilador arranca en la nota raíz del acorde actual para no sonar disonante al activarse.
  _bassOsc.type = _layerWaveform.bass; _bassOsc.frequency.value = midiToHz(_scaleNote(CHORD_ROOTS[_currentChordIdx] || 0));
  _bassEnv.gain.value = 0;  // empieza en silencio; las notas se disparan con _bassTriggerNote

  _bassOsc.connect(_bassEnv); _bassEnv.connect(vol); vol.connect(_bassFilter);
  _bassFilter.connect(_bassDrive); _bassDrive.connect(bassGateMod); bassGateMod.connect(_bassMuteGain); _bassMuteGain.connect(rhythmBus);
  _bassDrive.connect(_bassReverbSend); _bassReverbSend.connect(reverbNode);
  _bassDrive.connect(_bassDelaySend);  _bassDelaySend.connect(_delayNode);
  _bassOsc.start();
}

// Filtro pasa-baja del bajo con resonancia tipo wah.
// Mapeo: norm=0 (mano cerrada) → 60Hz muy oscuro con Q=6.3 (resonante)
//        norm=1 (mano abierta) → ~16.8kHz brillante con Q=0.8 (plano)
// La Q alta en los graves da el carácter "wah" característico del bajo filtrado.
function _bassSetFilter(norm) {
  if (!_bassFilter) return;
  const n    = Math.max(0, Math.min(1, norm));
  const freq = 60 * Math.pow(280, n);
  const q    = 0.8 + (1 - n) * 5.5;
  _bassFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  _bassFilter.Q.setTargetAtTime(q, audioCtx.currentTime, 0.06);
}

// Gate/tremolo del bajo, sincronizado al tempo.
// normY=0 (mano arriba): sin gate (sustain largo)
// normY=1 (mano abajo): gate duro a ~2× la velocidad de negra
function _bassSetGate(normY) {
  if (!_bassTremoloLFO || !_bassTremoloGain) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) {
    _bassTremoloGain.gain.setTargetAtTime(0, t, 0.18);
    return;
  }
  const tempo  = getCurrentTempo();
  const beatHz = tempo / 60;
  const rate   = beatHz * (0.5 + normY * 1.5);
  const depth  = 0.25 + normY * 0.70;
  _bassTremoloLFO.frequency.setTargetAtTime(Math.max(0.2, rate), t, 0.20);
  _bassTremoloGain.gain.setTargetAtTime(depth, t, 0.08);
}

// Dispara una nota del bajo: actualiza la frecuencia del oscilador y aplica una
// envolvente con ataque rápido (12ms) y sustain largo (3.5 corcheas).
// Las notas densas del groove se interrumpen mutuamente (cancelScheduledValues),
// lo que da el carácter staccato natural de un bajo real.
function _bassTriggerNote(midi, time) {
  if (!_bassOsc || !_bassEnv || _layerMuted.bass) return;
  const t  = time ?? audioCtx.currentTime;
  const bl = _beatMs() / 1000;   // duración de una corchea en segundos al tempo actual
  // setTargetAtTime(freq, t, 0.010): glide suave de 10ms hacia la nueva nota.
  // Evita clicks de frecuencia bruscos cuando el oscilador continuo cambia de nota.
  _bassOsc.frequency.setTargetAtTime(midiToHz(midi), t, 0.010);
  // cancelScheduledValues borra cualquier automatización de ganancia pendiente
  // (de la nota anterior que todavía puede estar en el buffer del AC).
  // setValueAtTime(0, t): fija la ganancia a 0 exactamente en t, como punto de partida.
  _bassEnv.gain.cancelScheduledValues(t); _bassEnv.gain.setValueAtTime(0, t);
  // linearRampToValueAtTime: sube linealmente hasta 0.90 en 12ms (ataque del bajo).
  _bassEnv.gain.linearRampToValueAtTime(0.90, t + 0.012);
  // setTargetAtTime(0, inicio, tau): decaimiento exponencial (tau=0.12s).
  // El decay empieza 3.5 corcheas después — las notas densas del groove retriggerean
  // antes de que expire y el cancelScheduledValues lo interrumpe. Esto genera el carácter
  // staccato natural: notas cortas en grooves rápidos, largas en grooves lentos.
  _bassEnv.gain.setTargetAtTime(0, t + bl * 3.5, 0.12);
}

// ── SYNTH — arpegio melódico con filtro ácido y FX ────────────────────────────
// Cadena: osc → env → vol(0.30) → filter → drive → tremoloMod → muteGain → melodyBus
function _activateSynth() {
  if (_synthOsc) return;
  _synthFilter = audioCtx.createBiquadFilter(); _synthFilter.type = 'lowpass'; _synthFilter.frequency.value = 2000; _synthFilter.Q.value = 1.5;
  _synthDrive  = audioCtx.createWaveShaper();   _synthDrive.curve = _makeDriveCurve(0); _synthDrive.oversample = '4x';
  _synthMuteGain = audioCtx.createGain(); _synthMuteGain.gain.value = _layerMuted.synth ? 0 : (_layerVolume.synth ?? 1);
  _synthReverbSend = audioCtx.createGain(); _synthReverbSend.gain.value = 0;
  _synthDelaySend  = audioCtx.createGain(); _synthDelaySend.gain.value  = 0;

  // Tremolo con el mismo esquema que el pad
  _synthTremoloLFO  = audioCtx.createOscillator();
  _synthTremoloGain = audioCtx.createGain();
  const synthTremoloMod = audioCtx.createGain(); synthTremoloMod.gain.value = 1.0;
  _synthTremoloLFO.type = 'sine'; _synthTremoloLFO.frequency.value = 4.5; _synthTremoloGain.gain.value = 0;
  _synthTremoloLFO.connect(_synthTremoloGain); _synthTremoloGain.connect(synthTremoloMod.gain);
  _synthTremoloLFO.start();

  _synthOsc = audioCtx.createOscillator(); _synthEnv = audioCtx.createGain();
  const vol = audioCtx.createGain(); vol.gain.value = 0.30;
  _synthOsc.type = _layerWaveform.synth; _synthOsc.frequency.value = 440; _synthEnv.gain.value = 0;

  _synthOsc.connect(_synthEnv); _synthEnv.connect(vol); vol.connect(_synthFilter);
  _synthFilter.connect(_synthDrive); _synthDrive.connect(synthTremoloMod); synthTremoloMod.connect(_synthMuteGain); _synthMuteGain.connect(melodyBus);
  _synthDrive.connect(_synthReverbSend); _synthReverbSend.connect(reverbNode);
  _synthDrive.connect(_synthDelaySend);  _synthDelaySend.connect(_delayNode);
  _synthOsc.start(); _synthArpStep = 0;
}

// Filtro ácido del synth: Q muy alto en los graves (sonido acid/303).
// norm=0 → 120Hz con Q=8 (oscuro, resonante, tipo 303 cerrado)
// norm=1 → ~19kHz con Q=1 (brillante, completamente abierto)
function _synthSetFilter(norm) {
  if (!_synthFilter) return;
  const n    = Math.max(0, Math.min(1, norm));
  const freq = 120 * Math.pow(160, n);
  const q    = 1.0 + (1 - n) * 7.0;
  _synthFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  _synthFilter.Q.setTargetAtTime(q, audioCtx.currentTime, 0.06);
}

// Dispara una nota del synth con envolvente corta (carácter percusivo de arpegio).
// El ataque es casi instantáneo (10ms), con un pequeño peak y caída en dos etapas.
function _synthTriggerNote(midi, time) {
  if (!_synthOsc || !_synthEnv || _layerMuted.synth) return;
  const t  = time ?? audioCtx.currentTime;
  const bl = (60 / getCurrentTempo()) * 0.5;   // duración de una corchea en segundos
  // Glide de frecuencia muy rápido (tau=8ms): cambia casi instantáneamente pero sin click.
  _synthOsc.frequency.setTargetAtTime(midiToHz(midi), t, 0.008);
  _synthEnv.gain.cancelScheduledValues(t); _synthEnv.gain.setValueAtTime(0, t);
  // Envolvente en 3 etapas:
  // 1) Ataque: 0 → 0.92 en 10ms (casi inmediato — carácter percusivo del arpegio).
  _synthEnv.gain.linearRampToValueAtTime(0.92, t + 0.010);
  // 2) Decay rápido: 0.92 → 0.20 en ~25ms (tau=70ms); el synth "pica" y baja.
  _synthEnv.gain.setTargetAtTime(0.20, t + 0.025, 0.07);
  // 3) Release: 0.20 → 0 empezando en 0.65 corcheas (al 65% de la duración del paso),
  //    tau=70ms. Esto deja un pequeño silencio antes de la siguiente nota del arpegio.
  _synthEnv.gain.setTargetAtTime(0, t + bl * 0.65, 0.07);
}

// ── LEAD — melodía continua con tremolo melódico propio y FX ─────────────────
// Cadena: osc → env → vol(0.60) → leadBus → fxFilter → fxDrive → tremoloMod → melodyBus
// El lead tiene su propio LFO de tremolo (rango 2.5–12.5 Hz) independiente del pad/synth.
function _activateLead() {
  if (_leadOsc) return;
  _leadFxFilter = audioCtx.createBiquadFilter(); _leadFxFilter.type = 'lowpass'; _leadFxFilter.frequency.value = 20000; _leadFxFilter.Q.value = 0.8;
  _leadFxDrive  = audioCtx.createWaveShaper();   _leadFxDrive.curve = _makeDriveCurve(0); _leadFxDrive.oversample = '4x';

  _leadTremoloLFO  = audioCtx.createOscillator(); _leadTremoloGain = audioCtx.createGain();
  const tremoloMod = audioCtx.createGain(); tremoloMod.gain.value = 1.0;
  _leadTremoloLFO.type = 'sine'; _leadTremoloLFO.frequency.value = 5.5; _leadTremoloGain.gain.value = 0;
  _leadTremoloLFO.connect(_leadTremoloGain); _leadTremoloGain.connect(tremoloMod.gain);

  _leadBus = audioCtx.createGain(); _leadBus.gain.value = _layerMuted.lead ? 0 : (_layerVolume.lead ?? 1);
  _leadReverbSend = audioCtx.createGain(); _leadReverbSend.gain.value = 0;
  _leadDelaySend  = audioCtx.createGain(); _leadDelaySend.gain.value  = 0;

  _leadBus.connect(_leadFxFilter); _leadFxFilter.connect(_leadFxDrive);
  _leadFxDrive.connect(tremoloMod); tremoloMod.connect(melodyBus);
  _leadFxDrive.connect(_leadReverbSend); _leadReverbSend.connect(reverbNode);
  _leadFxDrive.connect(_leadDelaySend);  _leadDelaySend.connect(_delayNode);
  _leadTremoloLFO.start();

  _leadOsc = audioCtx.createOscillator(); _leadEnv = audioCtx.createGain();
  const vol = audioCtx.createGain(); vol.gain.value = 0.60;
  _leadOsc.type = _layerWaveform.lead; _leadOsc.frequency.value = midiToHz(_layerRt.lead.midi);
  _leadEnv.gain.value = 0;
  _leadOsc.connect(_leadEnv); _leadEnv.connect(vol); vol.connect(_leadBus);
  _leadOsc.start(); _leadEnv.gain.setTargetAtTime(0.85, audioCtx.currentTime, 0.35);
}

// Actualiza la frecuencia del lead suavemente (tau=0.06s para portamento corto).
function _leadSetPitch(midi) {
  if (!_leadOsc) return;
  _leadOsc.frequency.setTargetAtTime(midiToHz(midi), audioCtx.currentTime, 0.06);
}

// Tremolo del lead: va de vibrato lento (2.5Hz, normY bajo) a gate rápido (12.5Hz, normY alto).
// Es independiente del tempo — el lead tiene un carácter más libre y expresivo.
function _leadSetTremolo(normY) {
  if (!_leadTremoloLFO || !_leadTremoloGain) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) {
    _leadTremoloGain.gain.setTargetAtTime(0, t, 0.15);
    return;
  }
  const rate  = 2.5 + normY * 10.0;
  const depth = 0.20 + normY * 0.60;
  _leadTremoloLFO.frequency.setTargetAtTime(rate, t, 0.18);
  _leadTremoloGain.gain.setTargetAtTime(depth, t, 0.08);
}

// ── Helpers de expresión compartidos ─────────────────────────────────────────
// Filtro de expresión para pad y lead: misma curva, nodo diferente.
// Mapeo: norm=0 (mano cerrada) → 80Hz oscuro/resonante
//        norm=1 (mano abierta) → 16kHz brillante/abierto
// La escala es logarítmica (pow(200,n)) para que suene natural al mover la mano.
function _setLayerFilter(filterNode, norm) {
  if (!filterNode) return;
  const n = Math.max(0, Math.min(1, norm));
  filterNode.frequency.setTargetAtTime(80 * Math.pow(200, n), audioCtx.currentTime, 0.08);
  filterNode.Q.setTargetAtTime(0.6 + (1 - n) * 2.0, audioCtx.currentTime, 0.10);
}
function _padSetFilter(norm)  { _setLayerFilter(_padFxFilter,  norm); }
function _leadSetFilter(norm) { _setLayerFilter(_leadFxFilter, norm); }

// Tremolo del synth — usa la misma función que el pad (misma fórmula, nodos distintos).
function _synthSetTremolo(normY) { _setTremoloGated(_synthTremoloLFO, _synthTremoloGain, normY); }

// ── Secuenciador ──────────────────────────────────────────────────────────────
// Arranca el scheduler de lookahead. Resetea contadores y programa la primera nota
// ligeramente en el futuro (50ms) para dar margen al primer batch de programación.
function startSequencer() {
  stopSequencer();
  _drumBeat     = 0;
  _loopPos      = 0;
  _nextNoteTime = audioCtx.currentTime + 0.05;
  _schedulerLoop();
}
// Detiene el scheduler limpiamente.
function stopSequencer() {
  if (_scheduleTimer) { clearTimeout(_scheduleTimer); _scheduleTimer = null; }
}

// Bucle de lookahead: se despierta cada LOOKAHEAD_MS ms y programa todos los pasos
// que caen dentro de los próximos SCHEDULE_AHEAD segundos usando el reloj AC.
// Si setTimeout se retrasa, el while se ejecuta más veces para ponerse al día.
// Las notas ya programadas con src.start(t) no se ven afectadas por el retraso.
function _schedulerLoop() {
  while (_nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    _tick(_nextNoteTime);
    _nextNoteTime += _beatMs() / 1000;   // avanza un paso (re-lee el tempo en cada iteración)
  }
  _scheduleTimer = setTimeout(_schedulerLoop, LOOKAHEAD_MS);
}

// Duración de una corchea en milisegundos al tempo actual.
// getCurrentTempo()*2 porque el scheduler trabaja a resolución de corchea.
function _beatMs() { return (60 / (getCurrentTempo() * 2)) * 1000; }

// Procesa un paso del secuenciador. 'time' es el momento AudioContext exacto en que
// deben sonar los elementos de este paso. Todos los disparos usan este tiempo.
// El orden de procesado es: pre-roll → grabación → pad → bajo → synth → perc → lead.
function _tick(time) {
  // Pre-roll: decrementa el contador de pasos. Cuando llega a 0 arranca la grabación
  // sincronizada al inicio de la siguiente barra.
  if (_prerollStepsLeft > 0) {
    _prerollStepsLeft--;
    if (_prerollStepsLeft === 0 && _prerollTarget) {
      const key          = _prerollTarget;
      _prerollTarget     = null;
      // Reset sincronizado: ambos contadores a 0 para que la grabación empiece en el tiempo 1
      _loopPos           = 0;
      _drumBeat          = 0;
      _recordTarget      = null;
      _recordedSteps     = 0;
      _layerLoopBuf[key] = new Array(_LOOP_STEPS).fill(null);
      _recordTarget      = key;
    }
  }

  const beat  = _drumBeat % 8;           // posición en el patrón de 8 pasos (0–7)
  const scale = ATMOSPHERES[_atmoKey].scale;

  // El destello visual del beat 1 se retrasa para coincidir con el audio (no con el tick JS)
  if (beat === 0) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    if (delayMs < 2) { _beatPulse = 1.0; }
    else             { setTimeout(() => { _beatPulse = 1.0; }, delayMs); }
  }

  // Clic de metrónomo: una negra (cada 2 corcheas) mientras se graba
  if (_recordTarget && _drumBeat % 2 === 0) _playClickAt(time);

  // 1. Resuelve el acorde activo: lo establece el pad (en editing o looping)
  // y lo leen el bajo y el synth para harmonizar.
  if (_layerMode.pad === 'editing') {
    _currentChordIdx = _layerRt.pad.chordIdx;
  } else if (_layerMode.pad === 'looping' && _layerLoopBuf.pad) {
    const snap = _layerLoopBuf.pad[_loopPos];
    if (snap != null) _currentChordIdx = snap.chordIdx;
  }

  // 2. Grabación: guarda la instantánea del estado actual en el buffer del bucle.
  // Cuando se han grabado _LOOP_STEPS pasos, la capa pasa automáticamente a 'looping'.
  if (_recordTarget) {
    const buf = _layerLoopBuf[_recordTarget];
    if (buf) buf[_loopPos] = _snapLayer(_recordTarget);
    _recordedSteps++;
    if (_recordedSteps >= _LOOP_STEPS) {
      const key = _recordTarget; _recordTarget = null; _recordedSteps = 0;
      _layerMode[key] = 'looping';
    }
  }

  // 3. PAD — en editing: usa valores en tiempo real. En looping: lee el bucle.
  // Cuando FX mode está activo, no se toca el filtro de expresión (las manos controlan FX).
  if (_layerMode.pad !== 'off' && _padOscs.length) {
    let chordIdx, tremolo, filterNorm, snap = null;
    if (_layerMode.pad === 'editing') { chordIdx = _layerRt.pad.chordIdx; tremolo = _layerRt.pad.tremolo; filterNorm = _layerRt.pad.filterNorm; }
    else { snap = _layerLoopBuf.pad?.[_loopPos]; chordIdx = snap?.chordIdx ?? _currentChordIdx; tremolo = snap?.tremolo ?? 0; filterNorm = snap?.filterNorm ?? 1.0; }
    _padSetChord(chordIdx); _padSetTremolo(tremolo);
    if (!_layerFxMode.pad) _padSetFilter(filterNorm);
    if (snap && !_layerFxMode.pad) _applyLoopFx('pad', snap);
  }

  // 4. BAJO — dispara la nota según el groove activo en cada paso.
  // El offset del groove se suma al grado raíz del acorde para obtener la nota.
  if (_layerMode.bass !== 'off' && _bassOsc) {
    let grooveIdx, filterNorm, gateNorm, snap = null;
    if (_layerMode.bass === 'editing') { grooveIdx = _layerRt.bass.grooveIdx; filterNorm = _layerRt.bass.filterNorm; gateNorm = _layerRt.bass.gateNorm; }
    else { snap = _layerLoopBuf.bass?.[_loopPos]; grooveIdx = snap?.grooveIdx ?? 0; filterNorm = snap?.filterNorm ?? 0.8; gateNorm = snap?.gateNorm ?? 0; }
    if (!_layerFxMode.bass) _bassSetFilter(filterNorm);
    _bassSetGate(gateNorm);
    if (snap && !_layerFxMode.bass) _applyLoopFx('bass', snap);
    if (!_layerMuted.bass) {
      const groove = BASS_GROOVES[Math.max(0,Math.min(3,grooveIdx))] || BASS_GROOVES[0];
      // beat % groove.length: los grooves son arrays de 8, beat va 0–7, por lo que
      // coinciden perfectamente. El módulo es por seguridad si groove tuviera otro tamaño.
      const offset = groove[beat % groove.length];
      if (offset !== null) {
        // rootDeg: grado de la escala de la raíz del acorde actual.
        // rootDeg + offset: navega por la escala desde la raíz con el intervalo del groove.
        // scale[...]: convierte el grado a MIDI usando la escala de la atmósfera.
        const rootDeg = CHORD_ROOTS[_currentChordIdx] || 0;
        _bassTriggerNote(scale[Math.min(scale.length-1, Math.max(0, rootDeg + offset))], time);
      }
    }
  }

  // 5. SYNTH — arpegio diatónico sobre el acorde actual.
  // arpLen controla cuántas notas tiene el arpegio (1–4).
  // _synthArpStep avanza en cada tick, creando el arpegio.
  if (_layerMode.synth !== 'off' && _synthOsc) {
    let arpLen, filterNorm, tremolo, snap = null;
    if (_layerMode.synth === 'editing') { arpLen = _layerRt.synth.arpLen; filterNorm = _layerRt.synth.filterNorm; tremolo = _layerRt.synth.tremolo; }
    else { snap = _layerLoopBuf.synth?.[_loopPos]; arpLen = snap?.arpLen ?? 2; filterNorm = snap?.filterNorm ?? 0.8; tremolo = snap?.tremolo ?? 0; }
    if (!_layerFxMode.synth) _synthSetFilter(filterNorm);
    _synthSetTremolo(tremolo);
    if (snap && !_layerFxMode.synth) _applyLoopFx('synth', snap);
    if (!_layerMuted.synth) {
      const clamped  = Math.max(1, Math.min(4, arpLen));
      const rootDeg  = CHORD_ROOTS[_currentChordIdx] || 0;
      const arpNotes = [];
      for (let i = 0; i < clamped; i++) {
        // CHORD_OFFSETS[i % 4] = 0,2,4,6 → raíz, 3ª, 5ª, 7ª del acorde actual.
        // i >= 3 ? 7 : 0: si el arpegio tiene 4 notas, la 4ª sube una octava más (+7 grados).
        // +7 al final: coloca el arpegio en la octava del synth (igual que _chordNotes).
        const deg = rootDeg + CHORD_OFFSETS[i % CHORD_OFFSETS.length] + (i >= 3 ? 7 : 0);
        arpNotes.push(_scaleNote(deg + 7));
      }
      // Módulo sobre arpNotes.length: cicla por las notas del arpegio indefinidamente.
      _synthTriggerNote(arpNotes[_synthArpStep % arpNotes.length], time);
      _synthArpStep = (_synthArpStep + 1) % arpNotes.length;
    }
  }

  // 6. PERC — batería de samples.
  // iCl (mano derecha): selecciona el patrón rítmico (0=mínimo, 2=complejo)
  // cCl (mano izquierda): selecciona el patrón de platillos (0=solo hihat, 2=hihat+abierto+crash)
  if (_layerMode.perc !== 'off' && !_layerMuted.perc) {
    let intensity, cymbalLevel, snap = null;
    if (_layerMode.perc === 'editing') {
      intensity    = _layerRt.perc.intensity;
      cymbalLevel  = _layerRt.perc.cymbalLevel;
    } else {
      snap         = _layerLoopBuf.perc?.[_loopPos];
      intensity    = snap?.intensity   ?? 0;
      cymbalLevel  = snap?.cymbalLevel ?? 0;
    }
    const iCl  = Math.max(0, Math.min(2, intensity));
    const cCl  = Math.max(0, Math.min(2, cymbalLevel));
    const bpm  = getCurrentTempo();
    const rPat = _getRhythmPattern(iCl, bpm);   // patrón de mano derecha: kick/snare/clap/ghost
    const cPat = _getCymbalPattern(cCl, bpm);   // patrón de mano izquierda: hihat/openhat/crash

    // Elementos rítmicos (mano derecha)
    // La pequeña variación aleatoria de volumen humaniza el groove (evita rigidez mecánica)
    if (rPat.kick[beat])    _playDrum('kick',      0.70 + Math.random() * 0.06, null, time);
    if (rPat.snare[beat])   _playDrum('snare',     0.60 + Math.random() * 0.06, null, time);
    if (rPat.clap?.[beat])  _playDrum('clap',      0.38 + Math.random() * 0.05, null, time);
    if (rPat.ghost?.[beat]) _playDrum('snare',     0.16 + Math.random() * 0.06, null, time); // ghost = caja suave

    // Elementos de platillos (mano izquierda)
    if (cPat.hihat[beat])
      _playDrum('hihat', 0.13 + cCl * 0.02 + Math.random() * 0.03, null, time);
    if (cPat.openhat?.[beat])
      // stopTime = siguiente tick: el siguiente hihat cerrado "cierra" el hihat abierto (choke)
      _playDrum('openhat', 0.28 + Math.random() * 0.04, null, time, time + _beatMs() / 1000);
    // Crash: solo cada 4 barras (drumBeat % 32) para no sobreusarlo.
    // fadeTime = 1.5 corcheas para que la cola no tape la caja del beat 2.
    if (cPat.crash?.[beat] && _drumBeat % 32 === 0)
      _playDrum('crash', 0.22, null, time, null, _beatMs() / 1000 * 1.5);

    // Fill automático de toms cada 2 barras (crash solo si cCl=2)
    _playDrumFill(iCl, cCl, time);
  }

  // 7. LEAD — melodía continua. Solo actualiza parámetros en cada tick
  // (no dispara notas, el oscilador es continuo).
  if (_layerMode.lead !== 'off' && _leadOsc) {
    let midi, tremolo, filterNorm, snap = null;
    if (_layerMode.lead === 'editing') { midi = _layerRt.lead.midi; tremolo = _layerRt.lead.tremolo; filterNorm = _layerRt.lead.filterNorm; }
    else { snap = _layerLoopBuf.lead?.[_loopPos]; midi = snap?.midi ?? _layerRt.lead.midi; tremolo = snap?.tremolo ?? 0; filterNorm = snap?.filterNorm ?? 1.0; }
    _leadSetPitch(midi); _leadSetTremolo(tremolo);
    if (!_layerFxMode.lead) _leadSetFilter(filterNorm);
    if (snap && !_layerFxMode.lead) _applyLoopFx('lead', snap);
  }

  // Avanza los contadores al final del tick (no al principio, para que las capas lean
  // el paso correcto antes de que cambie).
  _loopPos = (_loopPos + 1) % _LOOP_STEPS;
  _drumBeat++;
}

// ── Setters públicos de parámetros de expresión ───────────────────────────────
// Llamados desde main.js en cada frame de MediaPipe.
// Almacenan el valor en _layerRt y, si la capa está en editing, lo aplican inmediatamente.

// PAD: mano derecha en Y → acorde (alto=acorde alto, bajo=acorde bajo)
function setPadChord(normY) {
  const idx = Math.min(6, Math.floor((1 - normY) * 7));
  _layerRt.pad.chordIdx = idx;
  if (_layerMode.pad === 'editing') { _currentChordIdx = idx; _padSetChord(idx); }
}
// PAD: mano izquierda en Y → tremolo (alto=más tremolo)
function setPadTremolo(normY) {
  _layerRt.pad.tremolo = normY;
  if (_layerMode.pad === 'editing') _padSetTremolo(normY);
}
// BAJO: mano derecha en Y → groove (alto=groove más complejo)
function setBassGroove(normY) { _layerRt.bass.grooveIdx = Math.min(3, Math.floor(normY * 4)); }
// BAJO: apertura de mano izquierda → filtro (abierto=brillante, cerrado=oscuro)
function setBassFilter(normY) {
  _layerRt.bass.filterNorm = normY;
  if (_layerMode.bass === 'editing' && !_layerFxMode.bass) _bassSetFilter(normY);
}
// BAJO: mano izquierda en Y → gate (alto=gate más pronunciado)
function setBassGate(normY) {
  _layerRt.bass.gateNorm = Math.max(0, Math.min(1, normY));
  if (_layerMode.bass === 'editing') _bassSetGate(_layerRt.bass.gateNorm);
}
// SYNTH: mano derecha en Y → longitud del arpegio (alto=más notas, 1–4)
// (1-normY)*4: invierte Y para que mano arriba=4 notas. Math.floor → entero. Min(3) clampea a 3 extra → máximo 1+3=4.
function setSynthArpLen(normY) { _layerRt.synth.arpLen = 1 + Math.min(3, Math.floor((1 - normY) * 4)); }
// SYNTH: apertura de mano izquierda → filtro (solo aplica si está en editing y sin FX mode)
function setSynthFilter(normY) {
  _layerRt.synth.filterNorm = normY;
  if (_layerMode.synth === 'editing' && !_layerFxMode.synth) _synthSetFilter(normY);
}
// PERC: mano derecha en Y → complejidad del ritmo (0=mínima, 2=máxima)
// Math.floor(normY*3): divide [0,1] en tres franjas iguales → 0, 1 o 2.
// Math.min(2,...) evita que llegue a 3 si normY=1.0 exacto.
function setPercIntensity(normY)   { _layerRt.perc.intensity   = Math.min(2, Math.floor(normY * 3)); }
// PERC: mano izquierda en Y → densidad de platillos (mismo esquema de cuantización que intensity)
function setPercCymbalLevel(normY) { _layerRt.perc.cymbalLevel = Math.min(2, Math.floor(normY * 3)); }
// LEAD: mano derecha en Y → nota (alto=nota más alta de la escala)
// deg: grado de la escala entre 7 y 14 (las 8 notas de la octava superior de la escala).
// (1-normY)*7: mano arriba → deg=14 (nota alta), mano abajo → deg=7 (nota baja).
// Math.round en vez de Floor para que la nota cambie a mitad del recorrido (no al final).
function setLeadNote(normY) {
  const deg  = 7 + Math.round((1 - normY) * 7);
  const midi = _scaleNote(Math.max(7, Math.min(14, deg)));  // clampea al rango válido
  _layerRt.lead.midi = midi;
  if (_layerMode.lead === 'editing') _leadSetPitch(midi);
}
// LEAD: mano izquierda en Y → tremolo (alto=más tremolo/vibrato)
function setLeadTremolo(normY) {
  _layerRt.lead.tremolo = normY;
  if (_layerMode.lead === 'editing') _leadSetTremolo(normY);
}

// Setters de filtro en modo expresión (apertura de mano izquierda)
function setPadFilter(normY) {
  _layerRt.pad.filterNorm = Math.max(0, Math.min(1, normY));
  if (_layerMode.pad === 'editing' && !_layerFxMode.pad) _padSetFilter(_layerRt.pad.filterNorm);
}
function setSynthTremolo(normY) {
  _layerRt.synth.tremolo = Math.max(0, Math.min(1, normY));
  if (_layerMode.synth === 'editing') _synthSetTremolo(_layerRt.synth.tremolo);
}
function setLeadFilter(normY) {
  _layerRt.lead.filterNorm = Math.max(0, Math.min(1, normY));
  if (_layerMode.lead === 'editing' && !_layerFxMode.lead) _leadSetFilter(_layerRt.lead.filterNorm);
}

// Devuelve el BPM actual: el override manual si hay uno, si no el de la atmósfera.
function getCurrentTempo() { return (_tempoOverride !== null) ? _tempoOverride : (ATMOSPHERES[_atmoKey]?.tempo || 100); }
// Establece un BPM manual (40–200). Si bpm es null, borra el override y usa el de la atmósfera.
function setBPM(bpm) { if (bpm === null) { _tempoOverride = null; return; } _tempoOverride = Math.round(Math.max(40, Math.min(200, bpm))); }
// Cambia la atmósfera: reinicia el secuenciador y borra el override de tempo.
function setAtmosphere(key) { if (!ATMOSPHERES[key]) return; _atmoKey = key; _tempoOverride = null; stopSequencer(); startSequencer(); }
function getCurrentAtmo()  { return ATMOSPHERES[_atmoKey]; }
// Decae el pulso visual del beat 1 (llamado cada frame desde renderLoop).
function decayBeatPulse(dt){ _beatPulse = Math.max(0, _beatPulse - dt * 5); }
function getBeatPulse()    { return _beatPulse; }

// ── Exportación pública ───────────────────────────────────────────────────────
// Toda la API de audio accesible desde main.js y ui.js como window.Audio.XXX
window.Audio = {
  init, startSequencer, stopSequencer,
  activateLayer, deactivateLayer, deactivateAllLayers,
  setLayerMode, getLayerMode, hasLayerLoop, clearLayerLoop,
  setLayerMuted, isLayerMuted,
  setLayerVolume, getLayerVolume,
  setLayerFxMode, getLayerFxMode,
  setFxSlot, getFxSlot, applyFx,
  setLayerWaveform, getLayerWaveform,
  setAtmosphere, getCurrentAtmo,
  setPadChord, setPadTremolo, setPadFilter,
  setBassGroove, setBassFilter, setBassGate,
  setSynthArpLen, setSynthFilter, setSynthTremolo,
  setPercIntensity, setPercCymbalLevel,
  setLeadNote, setLeadTremolo, setLeadFilter,
  startRecording, isRecording, getRecordTarget,
  isPrerolling, getPrerollTarget, getPrerollProgress, cancelPreroll,
  tickMetronomeClick,
  getLoopPos()  { return _loopPos; },
  getLoopSteps(){ return _LOOP_STEPS; },
  getCurrentTempo, setBPM,
  decayBeatPulse, getBeatPulse,
  ATMOSPHERES,
  FX_OPTIONS, FX_LABELS, FX_COLORS,
  WAVEFORM_OPTIONS,
  get currentChordName() { return CHORD_NAMES[_currentChordIdx] || 'I'; },
};

})();
