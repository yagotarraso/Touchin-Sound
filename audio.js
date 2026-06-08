(function () {
'use strict';

// Cada atmósfera define el contexto musical completo:
// - scale:  16 notas MIDI (dos octavas) que usan todas las melodías y el bajo
// - color:  tinte RGB del fondo
// - tempo:  BPM por defecto (puede sobreescribirse con el slider)
const ATMOSPHERES = {
  void:  { name:'Void',  scale:[28,30,32,33,35,37,38,  40,42,44,45,47,49,50,52,53], color:{r:30, g:20, b:80},  tempo:72  },
  pulse: { name:'Pulse', scale:[38,40,41,43,45,47,48,  50,52,53,55,57,59,60,62,64], color:{r:120,g:20, b:40},  tempo:110 },
  float: { name:'Float', scale:[53,55,57,59,60,62,64,  65,67,69,71,72,74,76,77,79], color:{r:20, g:80, b:100}, tempo:80  },
  bloom: { name:'Bloom', scale:[43,45,47,49,50,52,54,  55,57,59,61,62,64,66,67,69], color:{r:80, g:100,b:20},  tempo:95  },
  storm: { name:'Storm', scale:[35,36,38,40,41,43,45,  47,48,50,52,53,55,57,59,60], color:{r:100,g:40, b:10},  tempo:130 },
};

// Grados de la escala que actúan como raíz de cada acorde (I–VII).
// CHORD_OFFSETS: intervalos de la voicing de 4 notas (raíz, 3ª, 5ª, 7ª diatónicas).
const CHORD_ROOTS   = [0, 1, 2, 3, 4, 5, 6];
const CHORD_NAMES   = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const CHORD_OFFSETS = [0, 2, 4, 6];

// Patrones de groove del bajo: 8 posiciones (una por corchea del compás).
// null = silencio. Los números son desplazamientos diatónicos desde la raíz del acorde.
// 0=raíz, 2=tercera, 4=quinta, 5=sexta, 7=octava.
const BASS_GROOVES = [
  [0, null, null, null, 0, null, null, null], // mínimo: solo raíz en los tiempos fuertes
  [0, null, 4,    null, 0, null, 4,    null], // raíz + quinta dos veces por compás
  [0, 2,    4,    2,    0, 4,    7,    4   ], // línea ascendente en corcheas
  [0, 2,    4,    5,    4, 2,    0,    2   ], // línea con bordaduras — más sincopado
];

// Patrones rítmicos organizados por rango de BPM (slow/med/fast) y nivel de complejidad (0–2).
// 8 posiciones = 8 corcheas = 1 compás de 4/4.
// ghost: golpe de caja suave para humanizar el groove.
// El clap solo aparece en fast y siempre se suma a la snare (nunca la sustituye).
const RHYTHM_PATTERNS = {
  slow: [ // ≤85 BPM — hip-hop / boom-bap / trap
    { kick:[1,0,0,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    { kick:[1,0,0,1, 0,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
    { kick:[1,1,0,0, 0,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,1, 0,0,0,1] },
  ],
  med: [ // 86–125 BPM — rock / funk
    { kick:[1,0,0,0, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    { kick:[1,0,0,1, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
    { kick:[1,0,0,1, 1,0,1,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,1,0,0, 0,0,0,0] },
  ],
  fast: [ // >125 BPM — electrónico / broken-beat
    { kick:[1,0,0,0, 1,0,0,0], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,0,0, 0,0,0,0], ghost:[0,0,0,0, 0,0,0,0] },
    { kick:[1,0,0,0, 1,0,0,1], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,1,0, 0,0,1,0], ghost:[0,0,0,0, 0,0,0,0] },
    { kick:[1,1,0,0, 1,0,0,1], snare:[0,0,1,0, 0,0,1,0], clap:[0,0,1,0, 0,0,1,0], ghost:[0,0,0,1, 0,0,0,0] },
  ],
};

// Patrones de platillos por rango de BPM y nivel de densidad (0–2).
// c0: solo hihat cerrado. c1: hihat + abierto suave. c2: hihat + abierto + crash cada 4 barras.
const CYMBAL_PATTERNS = {
  slow: [
    { hihat:[1,0,1,0, 1,0,1,0], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[1,0,0,0, 0,0,0,0] },
  ],
  med: [
    { hihat:[1,0,1,0, 1,0,1,0], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,0, 1,1,1,1], openhat:[0,0,0,1, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,0, 1,1,1,1], openhat:[0,0,0,1, 0,0,0,0], crash:[1,0,0,0, 0,0,0,0] },
  ],
  fast: [
    { hihat:[0,1,0,1, 0,1,0,1], openhat:[0,0,0,0, 0,0,0,0], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[0,0,0,0, 0,0,0,0] },
    { hihat:[1,1,1,1, 1,1,1,0], openhat:[0,0,0,0, 0,0,0,1], crash:[1,0,0,0, 0,0,0,0] },
  ],
};

// Clasifica el BPM en uno de los tres rangos para seleccionar el patrón correcto
function _bpmBucket(bpm) { return bpm <= 85 ? 'slow' : bpm <= 125 ? 'med' : 'fast'; }

function _getRhythmPattern(complexity, bpm) { return RHYTHM_PATTERNS[_bpmBucket(bpm)][Math.max(0, Math.min(2, complexity))]; }
function _getCymbalPattern(level,      bpm) { return CYMBAL_PATTERNS [_bpmBucket(bpm)][Math.max(0, Math.min(2, level))];      }

// Catálogo de samples de batería: carpeta, prefijo de archivo y número de samples.
// 'start' permite que los archivos no empiecen en 1 (openhat empieza en 10).
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

// Efectos y formas de onda disponibles por capa
const FX_OPTIONS = ['reverb', 'drive', 'delay', 'flutter'];
const FX_LABELS  = { reverb:'Verb', drive:'Drive', delay:'Delay', flutter:'Flutter' };
const FX_COLORS  = { reverb:[100,180,255], drive:[255,80,80], delay:[140,255,180], flutter:[200,100,255] };

// perc no tiene oscilador — sus samples no tienen forma de onda que cambiar
const WAVEFORM_OPTIONS = {
  pad:  ['sine', 'triangle', 'sawtooth'],
  bass: ['triangle', 'sawtooth', 'square', 'sine'],
  synth:['sawtooth', 'square', 'triangle', 'sine'],
  lead: ['triangle', 'sine', 'sawtooth', 'square'],
  perc: [],
};

// Nodos de bus compartidos del grafo de audio Web Audio API.
// Topología:
//   melodyBus → masterOut → dryGain → destination
//   rhythmBus → masterOut
//   melodyBus/rhythmBus → sends de reverb → reverbNode → reverbGain → destination
//   sends de delay → _delayNode (con feedback) → _delayWet → masterOut
let audioCtx   = null;
let masterOut  = null;
let melodyBus  = null;
let rhythmBus  = null;
let reverbNode = null;
let reverbGain = null;
let dryGain    = null;
let _delayNode     = null;
let _delayFeedback = null;
let _delayWet      = null;

// Nodos del pad (4 osciladores en acorde, tremolo, filtro, drive)
let _padOscs        = [];
let _padTremoloLFO  = null;
let _padTremoloGain = null;
let _padBus         = null;
let _padFxFilter    = null;
let _padFxDrive     = null;
let _padReverbSend  = null;
let _padDelaySend   = null;

// Nodos del bajo (oscilador continuo, filtro resonante, gate LFO, drive)
let _bassOsc         = null;
let _bassEnv         = null;
let _bassFilter      = null;
let _bassMuteGain    = null;
let _bassReverbSend  = null;
let _bassDelaySend   = null;
let _bassDrive       = null;
let _bassTremoloLFO  = null;
let _bassTremoloGain = null;

// Nodos del synth (oscilador + arpeggiator, filtro ácido, tremolo)
let _synthOsc         = null;
let _synthEnv         = null;
let _synthFilter      = null;
let _synthMuteGain    = null;
let _synthReverbSend  = null;
let _synthDelaySend   = null;
let _synthDrive       = null;
let _synthArpStep     = 0;
let _synthTremoloLFO  = null;
let _synthTremoloGain = null;

// Nodos del lead (oscilador continuo, tremolo propio, filtro, drive)
let _leadOsc         = null;
let _leadEnv         = null;
let _leadTremoloLFO  = null;
let _leadTremoloGain = null;
let _leadBus         = null;
let _leadFxFilter    = null;
let _leadFxDrive     = null;
let _leadReverbSend  = null;
let _leadDelaySend   = null;

// Pools de samples de batería y contadores de round-robin (varían el sample en cada golpe)
const _drumPools = {};
const _drumRR    = {};

// Estado de cada capa: 'off' | 'editing' | 'looping'
const _layerMode   = { pad:'off', bass:'off', synth:'off', perc:'off', lead:'off' };
const _layerMuted  = { pad:false, bass:false, synth:false, perc:false, lead:false };
// Volumen 0–1.2 (1.2 permite +20% de ganancia)
const _layerVolume = { pad:1.0,  bass:1.0,  synth:1.0,  perc:1.0,  lead:1.0  };
const _layerFxMode = { pad:false, bass:false, synth:false, perc:false, lead:false };
const _layerWaveform = { pad:'sine', bass:'triangle', synth:'sawtooth', lead:'triangle', perc:'' };

// Slots de efecto por mano y por capa. 'right' y 'left' = mano derecha e izquierda.
const _fxSlots = {
  pad:  { right:null, left:null },
  bass: { right:null, left:null },
  synth:{ right:null, left:null },
  perc: { right:null, left:null },
  lead: { right:null, left:null },
};

// Valores actuales de cada efecto por capa (se graban en el bucle para automatización).
// filter arranca en 1 (filtro abierto = transparente, no en 0 que sería sin sonido).
const _fxVal = {};
for (const k of Layers.TYPE_ORDER) _fxVal[k] = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };

// Parámetros de expresión en tiempo real — se actualizan desde main.js cada frame
const _layerRt = {
  pad:  { chordIdx:0, tremolo:0,  filterNorm:1.0 },
  bass: { grooveIdx:0, filterNorm:0.8, gateNorm:0 },
  synth:{ arpLen:2,   filterNorm:0.8, tremolo:0   },
  perc: { intensity:0, cymbalLevel:0 },
  lead: { midi:60, tremolo:0,    filterNorm:1.0 },
};

// Sistema de grabación de bucles.
// Cada capa graba un bucle de _LOOP_STEPS pasos (16 corcheas = 2 compases de 4/4).
// En cada tick se guarda una snapshot del estado. Al reproducir, se lee esa snapshot.
const _LOOP_STEPS = 16;
const _layerLoopBuf = { pad:null, bass:null, synth:null, perc:null, lead:null };

let _recordTarget  = null; // clave de la capa que se está grabando
let _recordedSteps = 0;
let _loopPos       = 0;    // posición actual en el bucle (0 a _LOOP_STEPS-1)
let _currentChordIdx = 0;  // acorde global que leen el bajo y el synth para harmonizar

// Pre-roll: 4 clics de metrónomo antes de grabar para que el usuario entre sincronizado
let _prerollTarget    = null;
let _prerollStepsLeft = 0;
let _prerollStartAC   = 0;
let _prerollMs        = 0;

let _drumBeat      = 0;      // contador absoluto de pasos (nunca se resetea)
let _atmoKey       = 'float';
let _tempoOverride = null;   // BPM manual (null = usa el tempo de la atmósfera)
let _beatPulse     = 0;      // valor del flash visual del beat 1 (decae en renderLoop)

// Scheduler de lookahead para timing preciso con Web Audio API.
// En vez de depender de setTimeout (impreciso, puede retrasarse ±20ms),
// se fija el tiempo exacto de cada nota con audioCtx.currentTime.
// El scheduler se despierta cada LOOKAHEAD_MS ms y programa notas hasta
// SCHEDULE_AHEAD segundos por adelantado.
const LOOKAHEAD_MS   = 25.0;
const SCHEDULE_AHEAD = 0.10;
let   _nextNoteTime  = 0;
let   _scheduleTimer = null;

// Convierte nota MIDI a Hz. Fórmula estándar: A4 (MIDI 69) = 440 Hz.
function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Devuelve la nota MIDI en la posición degreeIdx de la escala de la atmósfera activa.
function _scaleNote(degreeIdx) {
  const scale = ATMOSPHERES[_atmoKey].scale;
  return scale[Math.max(0, Math.min(scale.length - 1, degreeIdx))];
}

// Calcula las 4 notas MIDI de un acorde diatónico de séptima (raíz, 3ª, 5ª, 7ª).
// +7 desplaza el acorde una octava arriba para que el pad suene en el rango medio-agudo.
function _chordNotes(chordIdx) {
  const root = CHORD_ROOTS[Math.max(0, Math.min(CHORD_ROOTS.length - 1, chordIdx))] || 0;
  return CHORD_OFFSETS.map(off => _scaleNote(root + off + 7));
}

// Genera la curva de saturación tanh para el WaveShaper de drive.
// preGain va de 1 (sin distorsión) a 21 (saturación extrema).
// La curva se cachea para no crear un Float32Array en cada frame.
let _driveCurveCache = { amount: -1, buf: null };
function _makeDriveCurve(amount) {
  if (_driveCurveCache.buf && Math.abs(amount - _driveCurveCache.amount) < 0.001)
    return _driveCurveCache.buf;
  const n   = 256;
  const buf = _driveCurveCache.buf ?? new Float32Array(n);
  if (amount < 0.01) {
    for (let i = 0; i < n; i++) buf[i] = (i * 2) / (n - 1) - 1; // lineal (sin saturación)
  } else {
    const preGain = 1 + amount * 20;
    for (let i = 0; i < n; i++) buf[i] = Math.tanh(((i * 2) / (n - 1) - 1) * preGain);
  }
  _driveCurveCache = { amount, buf };
  return buf;
}

// Inicializa el contexto de audio y todos los nodos de bus compartidos.
// Solo se llama una vez (requiere gesto del usuario en Chrome/Safari).
function init() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Buffer silencioso para desbloquear el AudioContext en iOS
  // (sin esto el contexto queda suspendido aunque esté en estado 'running')
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

  // Delay global de 375ms (~corchea a 80 BPM), feedback 35%, wet 40%
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

  // La melodía recibe más reverb que la batería (0.28 vs 0.05 — los drums suenan más secos)
  const melodyRevSend = audioCtx.createGain(); melodyRevSend.gain.value = 0.28;
  const drumRevSend   = audioCtx.createGain(); drumRevSend.gain.value   = 0.05;
  melodyBus.connect(melodyRevSend); melodyRevSend.connect(reverbNode);
  rhythmBus.connect(drumRevSend);   drumRevSend.connect(reverbNode);

  _buildReverb('large');
  _loadDrums();
}

// Genera un impulso de reverb procedural (ruido blanco con envolvente exponencial).
// No necesita archivo externo. 'large' da ~4.5s de cola.
function _buildReverb(size) {
  const dur   = { small:0.8, medium:2.0, large:4.5 }[size] || 2.0;
  const decay = { small:1.5, medium:2.5, large:4.0 }[size] || 2.5;
  const sr  = audioCtx.sampleRate;
  const len = Math.floor(sr * dur);
  const buf = audioCtx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // ruido blanco × envolvente exponencial decreciente
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  reverbNode.buffer = buf;
}

// Carga todos los samples del catálogo de forma asíncrona con fetch + decodeAudioData.
// Los archivos que no existen se saltan silenciosamente.
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

// Reproduce un sample de batería anclado al reloj del AudioContext (sample-accurate).
// Round-robin: avanza el índice para variar el sample y evitar el efecto de máquina de coser.
// stopTime: detiene el source en ese tiempo AC (para choke del hihat abierto).
// fadeTime: fade exponencial para la cola del crash.
function _playDrum(name, vol, pitch, time, stopTime, fadeTime) {
  const pool = _drumPools[name];
  if (!pool || pool.length === 0) return;
  const idx = _drumRR[name] % pool.length;
  _drumRR[name]++;
  const src = audioCtx.createBufferSource();
  const g   = audioCtx.createGain();
  src.buffer = pool[idx];
  if (pitch != null) src.playbackRate.value = pitch;
  const clampedVol = Math.max(0, Math.min(1.5, vol));
  const t = time ?? audioCtx.currentTime;
  if (fadeTime) {
    g.gain.setValueAtTime(clampedVol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + fadeTime);
  } else {
    g.gain.value = clampedVol;
  }
  src.connect(g); g.connect(rhythmBus);
  src.start(t);
  if (!fadeTime && stopTime != null && stopTime > t) src.stop(stopTime);
}

// Fill automático de toms al final de cada ciclo de 2 barras.
// Tom agudo en pos 13, tom de piso en pos 15. El crash del fill solo suena si cymbalLevel >= 2.
function _playDrumFill(intensity, cymbalLevel, time) {
  const pos = _drumBeat % 16;
  if (pos === 13 && intensity >= 1) {
    _playDrum('highTom', 0.48 + intensity * 0.08, null, time);
    if (intensity >= 2) _playDrum('midTom', 0.42, null, time);
  }
  if (pos === 15 && intensity >= 1) {
    _playDrum('floorTom', 0.52 + intensity * 0.06, null, time);
    if (intensity >= 2 && cymbalLevel >= 2) _playDrum('crash', 0.22, null, time, null, _beatMs() / 1000 * 1.5);
  }
}

// Activa una capa: crea sus nodos Web Audio y los conecta al grafo
function activateLayer(key) {
  if (!audioCtx) return;
  switch (key) {
    case 'pad':   _activatePad();   break;
    case 'bass':  _activateBass();  break;
    case 'synth': _activateSynth(); break;
    case 'perc':  break; // perc usa samples, no tiene osciladores que crear
    case 'lead':  _activateLead();  break;
  }
}

// Desactiva una capa: desvanece el audio, desconecta nodos y limpia el bucle grabado.
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
      _padOscs.forEach(o => {
        o.env.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(() => { try { o.osc.stop(); } catch(_) {} o.osc.disconnect(); o.env.disconnect(); o.gain.disconnect(); }, 700);
      });
      _padOscs = [];
      if (_padTremoloLFO) { try { _padTremoloLFO.stop(); } catch(_) {} _padTremoloLFO = null; }
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
function setLayerMode(key, mode) {
  if (!_layerMode.hasOwnProperty(key)) return;
  const prev = _layerMode[key];
  if (prev === mode) return;
  if (mode === 'off') { deactivateLayer(key); return; }
  _layerMode[key] = mode;
  if (prev === 'off') activateLayer(key); // si venía de off, hay que crear los nodos
}

function getLayerMode(key)  { return _layerMode[key] || 'off'; }
function hasLayerLoop(key)  { return _layerLoopBuf[key] !== null; }

function clearLayerLoop(key) {
  _layerLoopBuf[key] = null;
  if (_layerMode[key] === 'looping') _layerMode[key] = 'editing';
}

function deactivateAllLayers() {
  _recordTarget = null; _recordedSteps = 0;
  for (const key of Layers.TYPE_ORDER) {
    if (_layerMode[key] !== 'off') deactivateLayer(key);
    Layers.setActive(key, false);
  }
}

// Devuelve el nodo de gain que controla mute y volumen de cada capa.
// perc usa samples one-shot, no tiene señal continua que silenciar.
function _getMuteNode(key) {
  switch (key) {
    case 'pad':   return _padBus;
    case 'bass':  return _bassMuteGain;
    case 'synth': return _synthMuteGain;
    case 'lead':  return _leadBus;
    default:      return null;
  }
}

// tau=0.04s evita clicks al cambiar entre mute y unmute
function setLayerMuted(key, muted) {
  if (_layerMuted[key] === muted) return;
  _layerMuted[key] = muted;
  if (!audioCtx) return;
  const val = muted ? 0 : (_layerVolume[key] ?? 1);
  _getMuteNode(key)?.gain.setTargetAtTime(val, audioCtx.currentTime, 0.04);
}
function isLayerMuted(key) { return _layerMuted[key] ?? false; }

// Volumen 0–1.2. tau=0.06s para cambio suave sin salto audible.
function setLayerVolume(key, val) {
  _layerVolume[key] = Math.max(0, Math.min(1.2, val));
  if (!audioCtx || _layerMuted[key]) return;
  _getMuteNode(key)?.gain.setTargetAtTime(_layerVolume[key], audioCtx.currentTime, 0.06);
}
function getLayerVolume(key) { return _layerVolume[key] ?? 1; }

// Al activar FX mode, las manos controlan efectos en lugar de expresión.
// Por defecto: drive en la mano derecha, delay en la izquierda.
// Al desactivar, todo vuelve a neutro.
function setLayerFxMode(key, on) {
  if (!_layerFxMode.hasOwnProperty(key)) return;
  _layerFxMode[key] = !!on;
  if (on) {
    _fxSlots[key] = { right: 'drive', left: 'delay' };
    _fxVal[key]   = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };
    _applyAllFx(key);
  } else {
    _fxSlots[key] = { right: null, left: null };
    _fxVal[key]   = { reverb:0, filter:1, drive:0, delay:0, flutter:0 };
    _applyAllFx(key);
  }
}
function getLayerFxMode(key) { return _layerFxMode[key] ?? false; }

// Asigna o elimina un efecto de un slot de mano.
// Al cambiar de efecto, el anterior vuelve a su valor neutro para que no siga sonando.
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

// Aplica un efecto según la posición Y de la mano (normY: 0=abajo, 1=arriba = máximo).
// El valor se guarda en _fxVal para que también quede grabado en el bucle.
function applyFx(key, hand, normY, openness) {
  const slot = _fxSlots[key]?.[hand];
  if (!slot || !audioCtx) return;
  const effVal = Math.max(0, Math.min(1, normY));
  _fxVal[key][slot] = effVal;
  _applyFxParam(key, slot, effVal);
}

// Aplica el valor de un efecto concreto a los nodos de audio de la capa.
// tau=0.10s suaviza los cambios para que no suenen bruscos.
function _applyFxParam(key, fx, val) {
  if (!audioCtx) return;
  const t   = audioCtx.currentTime;
  const tau = 0.10;
  switch (fx) {
    case 'reverb': {
      // GainNode del send → convolucionador. val*2 porque el reverb audible requiere más ganancia.
      let send;
      switch (key) { case 'pad': send=_padReverbSend; break; case 'bass': send=_bassReverbSend; break; case 'synth': send=_synthReverbSend; break; case 'lead': send=_leadReverbSend; break; }
      if (send) send.gain.setTargetAtTime(val * 2.0, t, tau);
      break;
    }
    case 'filter': {
      // Escala logarítmica: val=0 → 80 Hz (muy oscuro), val=1 → 16 kHz (muy brillante).
      // Logarítmica porque el oído percibe la frecuencia así, no linealmente.
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
      // WaveShaper.curve = tabla de lookup que transforma la señal sample a sample.
      // No tiene AudioParam, así que el cambio es instantáneo.
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
      let send;
      switch (key) { case 'pad': send=_padDelaySend; break; case 'bass': send=_bassDelaySend; break; case 'synth': send=_synthDelaySend; break; case 'lead': send=_leadDelaySend; break; }
      if (send) send.gain.setTargetAtTime(val, t, tau);
      break;
    }
    case 'flutter': {
      // Flutter modula la profundidad del LFO de tremolo del pad o lead.
      // depth=0 → sin tremolo. depth=0.95 → tremolo al máximo.
      const depth = val * 0.95;
      if (key === 'pad'  && _padTremoloGain)  _padTremoloGain.gain.setTargetAtTime(depth, t, tau);
      if (key === 'lead' && _leadTremoloGain) _leadTremoloGain.gain.setTargetAtTime(depth, t, tau);
      break;
    }
  }
}

// Aplica todos los efectos de una capa a la vez (al entrar/salir de modo FX)
function _applyAllFx(key) {
  for (const fx of FX_OPTIONS) _applyFxParam(key, fx, _fxVal[key][fx] ?? 0);
}

// Cambia el tipo de onda del oscilador en tiempo real.
// try/catch porque cambiar el tipo de un OscillatorNode detenido lanza excepción.
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

// Clic de metrónomo: onda sinusoidal de 1400 Hz, 3ms de ataque, 75ms de caída.
// Se usa en el pre-roll y también durante la grabación (un clic por negra).
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

function tickMetronomeClick() { _playClickAt(audioCtx?.currentTime ?? 0); }

// Inicia el pre-roll (4 clics) y, al terminar, comienza la grabación sincronizada.
// Funciona tanto para capas en editing como para overdub de FX en looping.
function startRecording(key) {
  if (!key || !_layerMode.hasOwnProperty(key)) return;
  const mode = _layerMode[key];
  const isFxOverdub = mode === 'looping' && _layerFxMode[key];
  if (mode !== 'editing' && !isFxOverdub) return;
  if (!audioCtx) return;

  _prerollStepsLeft = 0;
  _prerollTarget    = null;

  const stepMs    = _beatMs();
  const quarterMs = stepMs * 2;
  const barMs     = stepMs * 8;
  const t0        = audioCtx.currentTime;

  // 4 clics, uno por negra, anclados al reloj AC
  for (let i = 0; i < 4; i++) {
    _playClickAt(t0 + (i * quarterMs) / 1000);
  }

  _prerollTarget    = key;
  _prerollStartAC   = t0;
  _prerollMs        = barMs;
  _prerollStepsLeft = 8;
}

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

// Toma una snapshot del estado actual de una capa para guardarla en el buffer del bucle.
// Incluye parámetros de expresión y estado de FX (para que la automatización se grabe).
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
  base.fxSlots = { ..._fxSlots[key] };
  base.fxVals  = { ..._fxVal[key] };
  return base;
}

// Reproduce la automatización de FX grabada en un paso del bucle
function _applyLoopFx(key, snap) {
  if (!snap?.fxVals || !_layerFxMode[key]) return;
  if (snap.fxSlots) Object.assign(_fxSlots[key], snap.fxSlots);
  for (const [fx, val] of Object.entries(snap.fxVals)) {
    _fxVal[key][fx] = val;
    _applyFxParam(key, fx, val);
  }
}

// PAD: 4 osciladores (acorde de séptima), tremolo, filtro, drive.
// Cadena: oscs → padBus → fxFilter → fxDrive → tremoloMod → melodyBus
//                                   ↘ reverbSend / delaySend
function _activatePad() {
  if (_padOscs.length) return;

  _padFxFilter = audioCtx.createBiquadFilter();
  _padFxFilter.type = 'lowpass'; _padFxFilter.frequency.value = 20000; _padFxFilter.Q.value = 0.8;

  _padFxDrive = audioCtx.createWaveShaper();
  _padFxDrive.curve = _makeDriveCurve(0); _padFxDrive.oversample = '4x';

  // Tremolo: LFO sinusoidal modula la ganancia del tremoloMod
  _padTremoloLFO  = audioCtx.createOscillator();
  _padTremoloGain = audioCtx.createGain();
  const tremoloMod = audioCtx.createGain(); tremoloMod.gain.value = 1.0;
  _padTremoloLFO.type = 'sine'; _padTremoloLFO.frequency.value = 4.5; _padTremoloGain.gain.value = 0;
  _padTremoloLFO.connect(_padTremoloGain); _padTremoloGain.connect(tremoloMod.gain);

  _padBus = audioCtx.createGain(); _padBus.gain.value = _layerMuted.pad ? 0 : (_layerVolume.pad ?? 1);

  _padReverbSend = audioCtx.createGain(); _padReverbSend.gain.value = 0;
  _padDelaySend  = audioCtx.createGain(); _padDelaySend.gain.value  = 0;

  _padBus.connect(_padFxFilter); _padFxFilter.connect(_padFxDrive);
  _padFxDrive.connect(tremoloMod); tremoloMod.connect(melodyBus);
  _padFxDrive.connect(_padReverbSend); _padReverbSend.connect(reverbNode);
  _padFxDrive.connect(_padDelaySend);  _padDelaySend.connect(_delayNode);
  _padTremoloLFO.start();

  // 4 osciladores para el acorde diatónico de séptima, con fade-in de 0.8s
  const notes = _chordNotes(_layerRt.pad.chordIdx);
  notes.forEach(midi => {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    const g   = audioCtx.createGain();
    osc.type = _layerWaveform.pad; osc.frequency.value = midiToHz(midi);
    env.gain.value = 0; g.gain.value = 0.22;
    osc.connect(env); env.connect(g); g.connect(_padBus);
    osc.start(); env.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.8);
    _padOscs.push({ osc, env, gain: g });
  });
}

// Actualiza las frecuencias del acorde con transición suave (tau=0.25s)
function _padSetChord(idx) {
  if (!_padOscs.length) return;
  const notes = _chordNotes(idx);
  notes.forEach((midi, i) => { if (_padOscs[i]) _padOscs[i].osc.frequency.setTargetAtTime(midiToHz(midi), audioCtx.currentTime, 0.25); });
}

// Tremolo sincronizado al tempo: normY=0 → lento, normY=1 → gate rápido.
// La fórmula adapta la velocidad del LFO al BPM actual.
function _setTremoloGated(lfoNode, gainNode, normY) {
  if (!lfoNode || !gainNode) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) { gainNode.gain.setTargetAtTime(0, t, 0.18); return; }
  const beatHz = getCurrentTempo() / 60;
  lfoNode.frequency.setTargetAtTime(Math.max(0.25, beatHz / 2 + (1 - normY) * beatHz * 3.5), t, 0.28);
  gainNode.gain.setTargetAtTime(0.25 + normY * 0.63, t, 0.10);
}

function _padSetTremolo(normY) { _setTremoloGated(_padTremoloLFO, _padTremoloGain, normY); }

// BAJO: oscilador continuo con envolvente, filtro resonante tipo wah, gate LFO y drive.
// Cadena: osc → env → vol(0.75) → filter → drive → gateGain → muteGain → rhythmBus
function _activateBass() {
  if (_bassOsc) return;
  _bassFilter = audioCtx.createBiquadFilter(); _bassFilter.type = 'lowpass'; _bassFilter.frequency.value = 800; _bassFilter.Q.value = 1.2;
  _bassDrive  = audioCtx.createWaveShaper();   _bassDrive.curve = _makeDriveCurve(0); _bassDrive.oversample = '4x';
  _bassMuteGain = audioCtx.createGain(); _bassMuteGain.gain.value = _layerMuted.bass ? 0 : (_layerVolume.bass ?? 1);
  _bassReverbSend = audioCtx.createGain(); _bassReverbSend.gain.value = 0;
  _bassDelaySend  = audioCtx.createGain(); _bassDelaySend.gain.value  = 0;

  // Gate LFO: oscila la ganancia para crear el efecto de gate/tremolo del bajo
  _bassTremoloLFO  = audioCtx.createOscillator();
  _bassTremoloGain = audioCtx.createGain();
  const bassGateMod = audioCtx.createGain(); bassGateMod.gain.value = 1.0;
  _bassTremoloLFO.type = 'sine'; _bassTremoloLFO.frequency.value = 4.0; _bassTremoloGain.gain.value = 0;
  _bassTremoloLFO.connect(_bassTremoloGain); _bassTremoloGain.connect(bassGateMod.gain);
  _bassTremoloLFO.start();

  _bassOsc = audioCtx.createOscillator(); _bassEnv = audioCtx.createGain();
  const vol = audioCtx.createGain(); vol.gain.value = 0.75;
  _bassOsc.type = _layerWaveform.bass; _bassOsc.frequency.value = midiToHz(_scaleNote(CHORD_ROOTS[_currentChordIdx] || 0));
  _bassEnv.gain.value = 0; // empieza en silencio; las notas se disparan con _bassTriggerNote

  _bassOsc.connect(_bassEnv); _bassEnv.connect(vol); vol.connect(_bassFilter);
  _bassFilter.connect(_bassDrive); _bassDrive.connect(bassGateMod); bassGateMod.connect(_bassMuteGain); _bassMuteGain.connect(rhythmBus);
  _bassDrive.connect(_bassReverbSend); _bassReverbSend.connect(reverbNode);
  _bassDrive.connect(_bassDelaySend);  _bassDelaySend.connect(_delayNode);
  _bassOsc.start();
}

// Filtro pasa-baja del bajo con resonancia tipo wah.
// norm=0 → 60 Hz oscuro con Q alto (resonante), norm=1 → ~17 kHz brillante y plano.
function _bassSetFilter(norm) {
  if (!_bassFilter) return;
  const n    = Math.max(0, Math.min(1, norm));
  const freq = 60 * Math.pow(280, n);
  const q    = 0.8 + (1 - n) * 5.5;
  _bassFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  _bassFilter.Q.setTargetAtTime(q, audioCtx.currentTime, 0.06);
}

// Gate/tremolo del bajo sincronizado al tempo
function _bassSetGate(normY) {
  if (!_bassTremoloLFO || !_bassTremoloGain) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) { _bassTremoloGain.gain.setTargetAtTime(0, t, 0.18); return; }
  const beatHz = getCurrentTempo() / 60;
  const rate   = beatHz * (0.5 + normY * 1.5);
  const depth  = 0.25 + normY * 0.70;
  _bassTremoloLFO.frequency.setTargetAtTime(Math.max(0.2, rate), t, 0.20);
  _bassTremoloGain.gain.setTargetAtTime(depth, t, 0.08);
}

// Dispara una nota del bajo: actualiza frecuencia y aplica envolvente ADSR simplificada.
// cancelScheduledValues borra automaciones pendientes para interrumpir la nota anterior,
// lo que da el carácter staccato natural de las líneas de bajo densas.
function _bassTriggerNote(midi, time) {
  if (!_bassOsc || !_bassEnv || _layerMuted.bass) return;
  const t  = time ?? audioCtx.currentTime;
  const bl = _beatMs() / 1000;
  _bassOsc.frequency.setTargetAtTime(midiToHz(midi), t, 0.010); // glide de 10ms
  _bassEnv.gain.cancelScheduledValues(t); _bassEnv.gain.setValueAtTime(0, t);
  _bassEnv.gain.linearRampToValueAtTime(0.90, t + 0.012);        // ataque 12ms
  _bassEnv.gain.setTargetAtTime(0, t + bl * 3.5, 0.12);          // decay exponencial
}

// SYNTH: arpegio melódico con filtro ácido y tremolo.
// Cadena: osc → env → vol(0.30) → filter → drive → tremoloMod → muteGain → melodyBus
function _activateSynth() {
  if (_synthOsc) return;
  _synthFilter = audioCtx.createBiquadFilter(); _synthFilter.type = 'lowpass'; _synthFilter.frequency.value = 2000; _synthFilter.Q.value = 1.5;
  _synthDrive  = audioCtx.createWaveShaper();   _synthDrive.curve = _makeDriveCurve(0); _synthDrive.oversample = '4x';
  _synthMuteGain = audioCtx.createGain(); _synthMuteGain.gain.value = _layerMuted.synth ? 0 : (_layerVolume.synth ?? 1);
  _synthReverbSend = audioCtx.createGain(); _synthReverbSend.gain.value = 0;
  _synthDelaySend  = audioCtx.createGain(); _synthDelaySend.gain.value  = 0;

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

// Filtro ácido: Q muy alto en los graves, estilo 303.
// norm=0 → 120 Hz con Q=8 (oscuro, resonante). norm=1 → ~19 kHz con Q=1 (abierto).
function _synthSetFilter(norm) {
  if (!_synthFilter) return;
  const n    = Math.max(0, Math.min(1, norm));
  const freq = 120 * Math.pow(160, n);
  const q    = 1.0 + (1 - n) * 7.0;
  _synthFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  _synthFilter.Q.setTargetAtTime(q, audioCtx.currentTime, 0.06);
}

// Nota del synth con envolvente percusiva: pica rápido y decae en dos etapas.
function _synthTriggerNote(midi, time) {
  if (!_synthOsc || !_synthEnv || _layerMuted.synth) return;
  const t  = time ?? audioCtx.currentTime;
  const bl = (60 / getCurrentTempo()) * 0.5;
  _synthOsc.frequency.setTargetAtTime(midiToHz(midi), t, 0.008);
  _synthEnv.gain.cancelScheduledValues(t); _synthEnv.gain.setValueAtTime(0, t);
  _synthEnv.gain.linearRampToValueAtTime(0.92, t + 0.010); // ataque casi instantáneo
  _synthEnv.gain.setTargetAtTime(0.20, t + 0.025, 0.07);   // decay rápido — carácter percusivo
  _synthEnv.gain.setTargetAtTime(0, t + bl * 0.65, 0.07);  // release antes de la siguiente nota
}

// LEAD: melodía continua con tremolo propio, filtro y drive.
// Cadena: osc → env → vol(0.60) → leadBus → fxFilter → fxDrive → tremoloMod → melodyBus
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
  _leadOsc.start(); _leadEnv.gain.setTargetAtTime(0.85, audioCtx.currentTime, 0.35); // fade-in suave
}

// Portamento corto del lead (tau=0.06s)
function _leadSetPitch(midi) {
  if (!_leadOsc) return;
  _leadOsc.frequency.setTargetAtTime(midiToHz(midi), audioCtx.currentTime, 0.06);
}

// Tremolo del lead: independiente del tempo — va de vibrato lento a gate rápido.
function _leadSetTremolo(normY) {
  if (!_leadTremoloLFO || !_leadTremoloGain) return;
  const t = audioCtx.currentTime;
  if (normY < 0.04) { _leadTremoloGain.gain.setTargetAtTime(0, t, 0.15); return; }
  const rate  = 2.5 + normY * 10.0;
  const depth = 0.20 + normY * 0.60;
  _leadTremoloLFO.frequency.setTargetAtTime(rate, t, 0.18);
  _leadTremoloGain.gain.setTargetAtTime(depth, t, 0.08);
}

// Filtro de expresión compartido por pad y lead (misma curva, nodo diferente).
// Escala logarítmica: mano cerrada → oscuro (80 Hz), mano abierta → brillante (16 kHz).
function _setLayerFilter(filterNode, norm) {
  if (!filterNode) return;
  const n = Math.max(0, Math.min(1, norm));
  filterNode.frequency.setTargetAtTime(80 * Math.pow(200, n), audioCtx.currentTime, 0.08);
  filterNode.Q.setTargetAtTime(0.6 + (1 - n) * 2.0, audioCtx.currentTime, 0.10);
}
function _padSetFilter(norm)      { _setLayerFilter(_padFxFilter,  norm); }
function _leadSetFilter(norm)     { _setLayerFilter(_leadFxFilter, norm); }
function _synthSetTremolo(normY)  { _setTremoloGated(_synthTremoloLFO, _synthTremoloGain, normY); }

// Arranca el scheduler de lookahead y resetea los contadores de posición.
function startSequencer() {
  stopSequencer();
  _drumBeat     = 0;
  _loopPos      = 0;
  _nextNoteTime = audioCtx.currentTime + 0.05;
  _schedulerLoop();
}
function stopSequencer() {
  if (_scheduleTimer) { clearTimeout(_scheduleTimer); _scheduleTimer = null; }
}

// Bucle del scheduler: programa todos los pasos que caen en la ventana de lookahead.
// Si setTimeout se retrasa, el while se ejecuta más veces para ponerse al día.
function _schedulerLoop() {
  while (_nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    _tick(_nextNoteTime);
    _nextNoteTime += _beatMs() / 1000;
  }
  _scheduleTimer = setTimeout(_schedulerLoop, LOOKAHEAD_MS);
}

// Duración de una corchea en ms al tempo actual
function _beatMs() { return (60 / (getCurrentTempo() * 2)) * 1000; }

// Procesa un paso del secuenciador: pre-roll, grabación, y reproducción de cada instrumento.
// 'time' es el momento AudioContext exacto en que deben sonar los elementos del paso.
function _tick(time) {
  // Pre-roll: decrementa el contador; cuando llega a 0, inicia la grabación sincronizada
  if (_prerollStepsLeft > 0) {
    _prerollStepsLeft--;
    if (_prerollStepsLeft === 0 && _prerollTarget) {
      const key          = _prerollTarget;
      _prerollTarget     = null;
      _loopPos           = 0; // reset sincronizado para que la grabación empiece en el tiempo 1
      _drumBeat          = 0;
      _recordTarget      = null;
      _recordedSteps     = 0;
      _layerLoopBuf[key] = new Array(_LOOP_STEPS).fill(null);
      _recordTarget      = key;
    }
  }

  const beat  = _drumBeat % 8;
  const scale = ATMOSPHERES[_atmoKey].scale;

  // Flash visual del beat 1, retrasado para que coincida con el audio (no con el tick JS)
  if (beat === 0) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    if (delayMs < 2) { _beatPulse = 1.0; }
    else             { setTimeout(() => { _beatPulse = 1.0; }, delayMs); }
  }

  // Clic del metrónomo durante la grabación (una negra = cada 2 corcheas)
  if (_recordTarget && _drumBeat % 2 === 0) _playClickAt(time);

  // El pad establece el acorde global; el bajo y el synth lo leen para harmonizar
  if (_layerMode.pad === 'editing') {
    _currentChordIdx = _layerRt.pad.chordIdx;
  } else if (_layerMode.pad === 'looping' && _layerLoopBuf.pad) {
    const snap = _layerLoopBuf.pad[_loopPos];
    if (snap != null) _currentChordIdx = snap.chordIdx;
  }

  // Grabación: guarda la snapshot en el buffer; al completar _LOOP_STEPS, pasa a looping
  if (_recordTarget) {
    const buf = _layerLoopBuf[_recordTarget];
    if (buf) buf[_loopPos] = _snapLayer(_recordTarget);
    _recordedSteps++;
    if (_recordedSteps >= _LOOP_STEPS) {
      const key = _recordTarget; _recordTarget = null; _recordedSteps = 0;
      _layerMode[key] = 'looping';
    }
  }

  // PAD — en editing usa valores en tiempo real, en looping lee el bucle
  if (_layerMode.pad !== 'off' && _padOscs.length) {
    let chordIdx, tremolo, filterNorm, snap = null;
    if (_layerMode.pad === 'editing') { chordIdx = _layerRt.pad.chordIdx; tremolo = _layerRt.pad.tremolo; filterNorm = _layerRt.pad.filterNorm; }
    else { snap = _layerLoopBuf.pad?.[_loopPos]; chordIdx = snap?.chordIdx ?? _currentChordIdx; tremolo = snap?.tremolo ?? 0; filterNorm = snap?.filterNorm ?? 1.0; }
    _padSetChord(chordIdx); _padSetTremolo(tremolo);
    if (!_layerFxMode.pad) _padSetFilter(filterNorm);
    if (snap && !_layerFxMode.pad) _applyLoopFx('pad', snap);
  }

  // BAJO — dispara la nota según el groove activo en cada paso
  if (_layerMode.bass !== 'off' && _bassOsc) {
    let grooveIdx, filterNorm, gateNorm, snap = null;
    if (_layerMode.bass === 'editing') { grooveIdx = _layerRt.bass.grooveIdx; filterNorm = _layerRt.bass.filterNorm; gateNorm = _layerRt.bass.gateNorm; }
    else { snap = _layerLoopBuf.bass?.[_loopPos]; grooveIdx = snap?.grooveIdx ?? 0; filterNorm = snap?.filterNorm ?? 0.8; gateNorm = snap?.gateNorm ?? 0; }
    if (!_layerFxMode.bass) _bassSetFilter(filterNorm);
    _bassSetGate(gateNorm);
    if (snap && !_layerFxMode.bass) _applyLoopFx('bass', snap);
    if (!_layerMuted.bass) {
      const groove  = BASS_GROOVES[Math.max(0,Math.min(3,grooveIdx))] || BASS_GROOVES[0];
      const offset  = groove[beat % groove.length];
      if (offset !== null) {
        const rootDeg = CHORD_ROOTS[_currentChordIdx] || 0;
        _bassTriggerNote(scale[Math.min(scale.length-1, Math.max(0, rootDeg + offset))], time);
      }
    }
  }

  // SYNTH — arpegio diatónico sobre el acorde actual
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
        // CHORD_OFFSETS da las notas del acorde (0=raíz, 2=3ª, 4=5ª, 6=7ª).
        // Si el arpegio tiene 4 notas, la última sube una octava (+7 grados).
        const deg = rootDeg + CHORD_OFFSETS[i % CHORD_OFFSETS.length] + (i >= 3 ? 7 : 0);
        arpNotes.push(_scaleNote(deg + 7));
      }
      _synthTriggerNote(arpNotes[_synthArpStep % arpNotes.length], time);
      _synthArpStep = (_synthArpStep + 1) % arpNotes.length;
    }
  }

  // PERC — batería de samples
  if (_layerMode.perc !== 'off' && !_layerMuted.perc) {
    let intensity, cymbalLevel, snap = null;
    if (_layerMode.perc === 'editing') {
      intensity   = _layerRt.perc.intensity;
      cymbalLevel = _layerRt.perc.cymbalLevel;
    } else {
      snap        = _layerLoopBuf.perc?.[_loopPos];
      intensity   = snap?.intensity   ?? 0;
      cymbalLevel = snap?.cymbalLevel ?? 0;
    }
    const iCl  = Math.max(0, Math.min(2, intensity));
    const cCl  = Math.max(0, Math.min(2, cymbalLevel));
    const bpm  = getCurrentTempo();
    const rPat = _getRhythmPattern(iCl, bpm);
    const cPat = _getCymbalPattern(cCl, bpm);

    // Pequeña variación aleatoria de volumen para humanizar el groove
    if (rPat.kick[beat])    _playDrum('kick',   0.70 + Math.random() * 0.06, null, time);
    if (rPat.snare[beat])   _playDrum('snare',  0.60 + Math.random() * 0.06, null, time);
    if (rPat.clap?.[beat])  _playDrum('clap',   0.38 + Math.random() * 0.05, null, time);
    if (rPat.ghost?.[beat]) _playDrum('snare',  0.16 + Math.random() * 0.06, null, time); // ghost snare

    if (cPat.hihat[beat])
      _playDrum('hihat', 0.13 + cCl * 0.02 + Math.random() * 0.03, null, time);
    if (cPat.openhat?.[beat])
      // stopTime = siguiente tick: el hihat cerrado siguiente lo "cierra" (choke)
      _playDrum('openhat', 0.28 + Math.random() * 0.04, null, time, time + _beatMs() / 1000);
    // Crash solo cada 4 barras (drumBeat % 32) para no sobreusarlo
    if (cPat.crash?.[beat] && _drumBeat % 32 === 0)
      _playDrum('crash', 0.22, null, time, null, _beatMs() / 1000 * 1.5);

    _playDrumFill(iCl, cCl, time); // fill automático de toms cada 2 barras
  }

  // LEAD — melodía continua: solo actualiza parámetros, el oscilador no se retriggera
  if (_layerMode.lead !== 'off' && _leadOsc) {
    let midi, tremolo, filterNorm, snap = null;
    if (_layerMode.lead === 'editing') { midi = _layerRt.lead.midi; tremolo = _layerRt.lead.tremolo; filterNorm = _layerRt.lead.filterNorm; }
    else { snap = _layerLoopBuf.lead?.[_loopPos]; midi = snap?.midi ?? _layerRt.lead.midi; tremolo = snap?.tremolo ?? 0; filterNorm = snap?.filterNorm ?? 1.0; }
    _leadSetPitch(midi); _leadSetTremolo(tremolo);
    if (!_layerFxMode.lead) _leadSetFilter(filterNorm);
    if (snap && !_layerFxMode.lead) _applyLoopFx('lead', snap);
  }

  // Los contadores avanzan al final del tick (no al principio, para que las capas lean el paso correcto)
  _loopPos = (_loopPos + 1) % _LOOP_STEPS;
  _drumBeat++;
}

// Setters de expresión: llamados desde main.js en cada frame de MediaPipe.
// Almacenan el valor en _layerRt y, si la capa está en editing, lo aplican inmediatamente.

function setPadChord(normY) {
  const idx = Math.min(6, Math.floor((1 - normY) * 7)); // mano arriba = acorde alto
  _layerRt.pad.chordIdx = idx;
  if (_layerMode.pad === 'editing') { _currentChordIdx = idx; _padSetChord(idx); }
}
function setPadTremolo(normY) {
  _layerRt.pad.tremolo = normY;
  if (_layerMode.pad === 'editing') _padSetTremolo(normY);
}
function setBassGroove(normY) { _layerRt.bass.grooveIdx = Math.min(3, Math.floor(normY * 4)); }
function setBassFilter(normY) {
  _layerRt.bass.filterNorm = normY;
  if (_layerMode.bass === 'editing' && !_layerFxMode.bass) _bassSetFilter(normY);
}
function setBassGate(normY) {
  _layerRt.bass.gateNorm = Math.max(0, Math.min(1, normY));
  if (_layerMode.bass === 'editing') _bassSetGate(_layerRt.bass.gateNorm);
}
// (1-normY)*4: mano arriba = 4 notas del arpegio, mano abajo = 1 nota
function setSynthArpLen(normY) { _layerRt.synth.arpLen = 1 + Math.min(3, Math.floor((1 - normY) * 4)); }
function setSynthFilter(normY) {
  _layerRt.synth.filterNorm = normY;
  if (_layerMode.synth === 'editing' && !_layerFxMode.synth) _synthSetFilter(normY);
}
function setPercIntensity(normY)   { _layerRt.perc.intensity   = Math.min(2, Math.floor(normY * 3)); }
function setPercCymbalLevel(normY) { _layerRt.perc.cymbalLevel = Math.min(2, Math.floor(normY * 3)); }
// deg entre 7 y 14: las 8 notas de la octava superior de la escala
function setLeadNote(normY) {
  const deg  = 7 + Math.round((1 - normY) * 7);
  const midi = _scaleNote(Math.max(7, Math.min(14, deg)));
  _layerRt.lead.midi = midi;
  if (_layerMode.lead === 'editing') _leadSetPitch(midi);
}
function setLeadTremolo(normY) {
  _layerRt.lead.tremolo = normY;
  if (_layerMode.lead === 'editing') _leadSetTremolo(normY);
}
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

function getCurrentTempo() { return (_tempoOverride !== null) ? _tempoOverride : (ATMOSPHERES[_atmoKey]?.tempo || 100); }
function setBPM(bpm) { if (bpm === null) { _tempoOverride = null; return; } _tempoOverride = Math.round(Math.max(40, Math.min(200, bpm))); }
function setAtmosphere(key) { if (!ATMOSPHERES[key]) return; _atmoKey = key; _tempoOverride = null; stopSequencer(); startSequencer(); }
function getCurrentAtmo()  { return ATMOSPHERES[_atmoKey]; }
function decayBeatPulse(dt){ _beatPulse = Math.max(0, _beatPulse - dt * 5); }
function getBeatPulse()    { return _beatPulse; }

// API pública: todo lo que main.js y ui.js necesitan del motor de audio
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
