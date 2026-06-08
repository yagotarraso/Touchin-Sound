(function () {
'use strict';

// Referencias a elementos del DOM
const videoEl    = document.getElementById('video');      // vídeo de la cámara (espejado en el canvas)
const mainCanvas = document.getElementById('mainCanvas'); // canvas principal donde se dibuja todo
const tutorialEl = document.getElementById('tutorial');   // overlay del tutorial (se oculta al iniciar)

// Estado global de la aplicación
let running     = false;   // true después de que el usuario pulsa "Comenzar"
let handsModel  = null;    // instancia del modelo MediaPipe Hands
let camera      = null;    // instancia de Camera que alimenta frames al modelo
let frameHands  = [];      // resultado del frame actual: array de objetos de mano analizados
let lastFrameTs = 0;       // timestamp del último frame de renderizado (para calcular dt)

// Mapa de teclas de atmósfera (teclado físico)
const ATMO_KEYS = { '1':'void', '2':'pulse', '3':'float', '4':'bloom', '5':'storm' };

// ── Posición Y suavizada por mano ─────────────────────────────────────────────
// Las manos controlan parámetros de audio con su altura en pantalla.
// Se suaviza con un filtro de paso bajo para evitar saltos bruscos.
// Y_SMOOTH: factor de suavizado (0=sin suavizado, mayor=más suavizado).
// VEL_SMOOTH: factor de suavizado para la velocidad de la palma.
const _handY    = { Right: 0.5, Left: 0.5 };   // valor suavizado (0=arriba, 1=abajo)
const _handVelY = { Right: 0,   Left: 0   };   // velocidad vertical suavizada (para el glow)
const Y_SMOOTH   = 0.12;
const VEL_SMOOTH = 0.20;

// ── Estado de edición de capas ────────────────────────────────────────────────
// Solo una capa puede estar en modo 'editing' a la vez.
// _editingLayer: la capa que las manos controlan en tiempo real ahora mismo.
// _selectedLayer: la última capa seleccionada explícitamente. Persiste después de que
//   la capa termina de grabar y pasa a 'looping'. Permite que el menú de contexto de
//   la mano izquierda siga apareciendo aunque no haya capa en editing.
let _editingLayer  = null;
let _selectedLayer = null;

// ── Menú radial de pinch (índice+pulgar) ─────────────────────────────────────
// La paleta se activa al mantener índice+pulgar 0.5s.
// Umbrales de apertura/cierre con histéresis para evitar oscilaciones.
const PINCH_MENU_DWELL_MS   = 500;    // tiempo mínimo de pinch para abrir el menú (ms)
const MENU_RADIUS_PX        = 125;    // radio del círculo radial en píxeles
const MENU_HOVER_PX         = 46;     // radio de detección hover de cada elemento
const PINCH_OPEN_THRESHOLD  = 0.60;   // strength mínimo para empezar a contar (apertura)
const PINCH_CLOSE_THRESHOLD = 0.28;   // strength mínimo para mantener activo (cierre/histéresis)

// Elementos de la paleta derecha: los 5 instrumentos + botón de limpiar todo
const RIGHT_MENU_ITEMS = [...Layers.TYPE_ORDER, 'clear'];

// Geometría del submenú de cada elemento de la paleta.
// Los tres botones (✕ VOL ⊕FX) se distribuyen en abanico a igual radio.
// SUB_ARC es el ángulo de separación (52°) entre cada botón.
const SUB_RADIUS   = 70;                    // px desde el centro del elemento hasta cada botón
const SUB_ARC      = 52 * Math.PI / 180;   // 52° en radianes
const SUB_HOVER_PX = 32;                   // radio de detección hover para los botones del submenú

// Umbral de activación para los dedos corazón y anular (menos precisos que el índice).
// Es más bajo que PINCH_OPEN_THRESHOLD porque estos pinches son más difíciles de hacer.
const PINCH_FINGER_THRESHOLD = 0.35;

// Rastrea qué slot de FX se modificó más recientemente por capa.
// Cuando los dos slots están ocupados, el nuevo efecto reemplaza el que lleva más tiempo.
const _lastFxSlotChanged = { pad:'right', bass:'right', synth:'right', perc:'right', lead:'right' };

// Crea el estado inicial de un gesto de paleta para una mano.
function _makeHGS() {
  return {
    pinchMenuStart:  0,      // performance.now() cuando empezó el pinch (0 = no contando)
    pinchMenuDwell:  0,      // progreso del dwell 0–1 (para la animación del arco)
    pinchMenuOpen:   false,  // true = el menú radial está visible
    pinchMenuOrigin: null,   // { x, y } normalizados donde se fijó el origen del menú
    pinchMenuHover:  null,   // string del elemento actualmente bajo el cursor
    subMenuHover:    null,   // 'mute' | 'vol' | 'fx' | null — solo mano derecha
  };
}
const _hand = { Right: _makeHGS(), Left: _makeHGS() };

// Rastrea el target de grabación del frame anterior para detectar cuando termina
// un overdub de FX (en ese caso el target pasa de algo a null y la capa sigue 'looping').
let _prevRecordTarget = null;

// ── Modo fader de volumen ─────────────────────────────────────────────────────
// Se activa al seleccionar el botón VOL del submenú de una capa con bucle grabado.
// La mano derecha controla el volumen continuamente hasta que se abre la paleta de nuevo.
let _volFaderActive = false;
let _volFaderLayer  = null;

// ── Pinch del dedo corazón → grabar ──────────────────────────────────────────
// El mismo dwell de 0.5s que la paleta. Solo mano derecha.
const _midPinch    = { Right: { start:0, dwell:0 }, Left: { start:0, dwell:0 } };

// ── Pinch del dedo anular → slider de tempo ──────────────────────────────────
// El slider se activa tras 0.5s de pinch y se mantiene mientras el pinch está activo.
// RING_LATCH_MS: período de gracia (150ms) que evita que el slider se apague cuando
// MediaPipe pierde la detección brevemente durante movimientos rápidos.
const _ringPinch        = {
  Right: { start:0, dwell:0, latchEnd:0 },   // solo la mano derecha actúa
  Left:  { start:0, dwell:0, latchEnd:0 },   // se inicializa por simetría pero no se usa
};
const RING_LATCH_MS = 150;  // ms de gracia para bridgear dropouts del slider en movimiento rápido
let _tempoSliderActive  = false;
let _tempoBPM           = 100;
let _metroClickLast     = 0;   // performance.now() del último clic del metrónomo

// ── MediaPipe ─────────────────────────────────────────────────────────────────
// Inicializa el modelo de detección de manos de MediaPipe Hands.
// modelComplexity=1 es el modelo más preciso (vs 0 que es más rápido pero menos exacto).
// Los umbrales de confianza en 0.70 dan un balance entre estabilidad y capacidad de respuesta.
function initHands() {
  handsModel = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  handsModel.setOptions({
    maxNumHands: 2, modelComplexity: 1,
    minDetectionConfidence: 0.70, minTrackingConfidence: 0.70,
  });
  handsModel.onResults(onHandResults);
}

// Inicia la cámara y comienza a enviar frames al modelo de manos.
// _frameProcessing: lock que evita encolar frames si MediaPipe aún no terminó el anterior.
// Sin este lock, los frames se acumulan en memoria (~3.5MB cada uno) hasta crashear el tab.
let _frameProcessing = false;
function startCamera() {
  camera = new Camera(videoEl, {
    onFrame: async () => {
      if (!running || _frameProcessing) return;
      _frameProcessing = true;
      try {
        await handsModel.send({ image: videoEl });
      } finally {
        _frameProcessing = false;
      }
    },
    width: 1280, height: 720,
  });
  camera.start();
}

// Callback que dispara MediaPipe en cada frame procesado.
// MediaPipe invierte las etiquetas de mano (porque la imagen del vídeo está en espejo),
// por eso se corrige: 'Left' de MediaPipe → 'Right' en nuestro sistema y viceversa.
// Para cada mano detectada, llama a Gestures.analyse() para obtener pinches y velocidades.
// Para las manos no detectadas, llama a _onHandLost() para limpiar el estado.
function onHandResults(results) {
  try {
    frameHands = [];
    const seen = new Set();
    if (results.multiHandLandmarks && results.multiHandedness) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const lm    = results.multiHandLandmarks[i];
        const label = results.multiHandedness[i].label === 'Left' ? 'Right' : 'Left';
        frameHands.push(Gestures.analyse(label, lm));
        seen.add(label);
      }
    }
    for (const label of ['Right', 'Left']) {
      if (!seen.has(label)) _onHandLost(label);
    }
    _updateHandPositions();
    _processRtControl();
    _processPlayVolume();
    _processPinchMenu();
    _processFxModeExit();   // sale del modo FX en cuanto empieza un pinch de índice
    _processMiddlePinch();
    _processRingPinch();
    _processMetroClick();
    _processVolFader();
  } catch (e) { console.error('[onHandResults]', e); }
}

// ── Suavizado de la posición Y de la mano ────────────────────────────────────
// Aplica un filtro de paso bajo a la posición Y del centro de palma.
// La fórmula equivale a un filtro EMA (Exponential Moving Average):
//   newY = prevY + (rawY - prevY) × alpha
// donde alpha = 1/(1 + Y_SMOOTH×60) ≈ 0.12 → respuesta rápida pero sin spikes.
function _updateHandPositions() {
  for (const hand of frameHands) {
    const rawY  = hand.center.y;
    const prevY = _handY[hand.label];
    // Filtro EMA (Exponential Moving Average): newY = prevY + (rawY - prevY) × alpha.
    // alpha = 1/(1 + Y_SMOOTH×60): cuando Y_SMOOTH=0.12 y el frame rate ≈ 60fps,
    // alpha ≈ 1/(1+7.2) ≈ 0.122. Cuanto menor alpha, más lento reacciona (más suave).
    const newY  = prevY + (rawY - prevY) * (1 / (1 + Y_SMOOTH * 60));
    // La velocidad también se suaviza con EMA usando VEL_SMOOTH (0.20 = más reactivo).
    // Math.abs porque solo nos importa la magnitud del movimiento, no la dirección.
    const vel   = _handVelY[hand.label] + (Math.abs(hand.palmVel.y) - _handVelY[hand.label]) * VEL_SMOOTH;
    _handY[hand.label]    = newY;
    _handVelY[hand.label] = vel;
  }
}

// ── Apertura de mano ──────────────────────────────────────────────────────────
// Calcula cuánto está abierta la mano basándose en la distancia media de las
// puntas de los dedos al centro de la palma.
// Rango típico: ~0.04 (puño cerrado) a ~0.22 (mano completamente abierta).
// Se normaliza a 0–1. Usado para el filtro de expresión (pad/lead/bass).
function _getHandOpenness(hand) {
  // Si no hay mano o fingertips, devolver 1 (mano "abierta" por defecto = no filtrar el sonido).
  if (!hand || !hand.fingertips || hand.fingertips.length === 0) return 1;
  const cx = hand.center.x, cy = hand.center.y;
  let total = 0;
  for (const tip of hand.fingertips) {
    // Distancia euclidiana 2D de cada punta de dedo al centro de la palma.
    // Las coordenadas están normalizadas (0–1), así que las distancias son fracciones del frame.
    const dx = tip.x - cx, dy = tip.y - cy;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  // avg: distancia media de las 5 puntas al centro.
  const avg = total / hand.fingertips.length;
  // Normalización empírica: puño cerrado ≈ 0.04, mano abierta ≈ 0.22.
  // (avg - 0.04) / 0.18 mapea ese rango a [0, 1].
  // Math.max/min clampea para no salir del rango aunque la mano sea inusualmente grande o pequeña.
  return Math.max(0, Math.min(1, (avg - 0.04) / 0.18));
}

// ── Control de expresión en tiempo real ──────────────────────────────────────
// Se ejecuta en cada frame de MediaPipe. Prioridad de control:
//   1. Vol fader activo → no cambiar expresión (las manos están en el fader)
//   2. Modo FX activo → las manos sculpting los efectos de la capa
//   3. Modo editing → las manos controlan expresión (acorde, filtro, tremolo, etc.)
//   4. Puño derecho → silenciar la capa editando
function _processRtControl() {
  // Si el submenú de VOL está abierto, las manos deben controlar el fader, no la expresión
  if (_hand.Right.pinchMenuOpen && _hand.Right.subMenuHover === 'vol') return;

  const rHand = frameHands.find(h => h.label === 'Right');
  const lHand = frameHands.find(h => h.label === 'Left');
  const rY    = _handY.Right;
  const lY    = _handY.Left;

  // Resolver la capa FX: preferencia a _editingLayer si tiene FX activo,
  // luego a _selectedLayer (que persiste aunque la capa haya pasado a looping).
  const fxKey = (_editingLayer  && Audio.getLayerFxMode(_editingLayer))  ? _editingLayer
              : (_selectedLayer && Audio.getLayerFxMode(_selectedLayer)) ? _selectedLayer
              : null;

  if (fxKey) {
    // Modo FX: altura de mano = intensidad, apertura de mano = wet/dry (no usada actualmente)
    Audio.applyFx(fxKey, 'right', 1 - rY, _getHandOpenness(rHand));
    Audio.applyFx(fxKey, 'left',  1 - lY, _getHandOpenness(lHand));
    return;
  }

  // Solo actúa si hay una capa en editing
  if (!_editingLayer) return;
  const key = _editingLayer;

  // Puño derecho → silenciar la capa (soltar el puño la restaura)
  const fistMute = rHand ? rHand.isFist : false;
  Audio.setLayerMuted(key, fistMute);
  if (fistMute) return;

  // Sin mano derecha → la capa suena a 0 (la derecha es la mano de volumen)
  if (!rHand) {
    Audio.setLayerVolume(key, 0);
    return;
  }

  // Apertura de mano calculada una sola vez para ambas manos
  const rOpen = _getHandOpenness(rHand);
  const lOpen = _getHandOpenness(lHand);

  // Convención de dirección: mano ARRIBA (Y pequeña) = más de todo.
  // Por eso se pasa (1-rY) cuando la función espera "más = mayor valor".
  // Por ejemplo: setPadChord recibe rY directamente porque internamente hace (1-normY).
  switch (key) {
    case 'pad':
      Audio.setPadChord(rY);           // mano derecha arriba = acorde alto (I..VII)
      Audio.setPadTremolo(1 - lY);     // mano izquierda arriba = más tremolo
      Audio.setLayerVolume('pad',   Math.min(1.2, rOpen * 1.2));
      break;
    case 'bass':
      Audio.setBassGroove(1 - rY);     // mano derecha arriba = groove más complejo
      Audio.setBassGate(1 - lY);       // mano izquierda arriba = más gate/pulso
      Audio.setLayerVolume('bass',  Math.min(1.2, rOpen * 1.2));
      break;
    case 'synth':
      Audio.setSynthArpLen(rY);        // mano derecha arriba = arpegio más largo
      Audio.setSynthTremolo(1 - lY);   // mano izquierda arriba = más tremolo
      Audio.setLayerVolume('synth', Math.min(1.2, rOpen * 1.2));
      break;
    case 'perc':
      Audio.setPercIntensity(1 - rY);      // mano derecha arriba = ritmo más complejo
      Audio.setPercCymbalLevel(1 - lY);    // mano izquierda arriba = más platillos
      break;
    case 'lead':
      Audio.setLeadNote(rY);           // mano derecha arriba = nota más alta
      Audio.setLeadTremolo(1 - lY);    // mano izquierda arriba = más tremolo
      Audio.setLayerVolume('lead',  Math.min(1.2, rOpen * 1.2));
      break;
  }
}

// ── Volumen en tiempo real durante la actuación en directo ────────────────────
// Solo activo cuando la capa está en editing SIN bucle grabado (tocando en vivo).
// Una vez grabado el bucle, el volumen se controla con el fader del submenú VOL.
// Modo FX excluido porque la apertura de mano ya controla la mezcla de efectos.
function _processPlayVolume() {
  if (_hand.Right.pinchMenuOpen) return;   // paleta abierta — manos ocupadas
  const key = _editingLayer;
  if (!key) return;
  if (Audio.getLayerMode(key) !== 'editing') return;
  if (Audio.hasLayerLoop(key)) return;     // hay bucle grabado — no sobreescribir
  if (Audio.getLayerFxMode(key)) return;   // apertura de mano = mezcla FX en este modo
  const rHand = frameHands.find(h => h.label === 'Right');
  if (!rHand) return;
  const openness = _getHandOpenness(rHand);
  Audio.setLayerVolume(key, Math.min(1.2, openness * 1.2));
}

// ── Transiciones de estado de capas ──────────────────────────────────────────
// Guarda automáticamente el estado de una capa que estaba en editing.
// Si tiene bucle grabado → pasa a 'looping' (el bucle se reproduce).
// Si no tiene bucle → pasa a 'off' (se desactiva, no había nada que guardar).
function _autoSaveEditing(key) {
  if (Audio.getLayerMode(key) !== 'editing') return;
  Audio.setLayerMuted(key, false);
  if (Audio.hasLayerLoop(key)) {
    Audio.setLayerMode(key, 'looping');
    Layers.setActive(key, true);
  } else {
    Audio.setLayerMode(key, 'off');
    Layers.setActive(key, false);
  }
}

// Selecciona una capa para editarla en directo.
// Si había otra capa en editing, la guarda automáticamente antes de cambiar.
function _selectForEditing(key) {
  if (_editingLayer && _editingLayer !== key) {
    Audio.setLayerMuted(_editingLayer, false);
    _autoSaveEditing(_editingLayer);
  }
  Audio.setLayerMode(key, 'editing');
  Audio.setLayerMuted(key, false);
  Layers.setActive(key, true);
  _editingLayer  = key;
  _selectedLayer = key;   // persiste para que el menú izquierdo siga activo en looping
}

// ── Elementos del menú de contexto de la mano izquierda ──────────────────────
// Devuelve la lista de elementos que debe mostrar el menú izquierdo según el contexto.
// En modo FX: muestra los 5 efectos disponibles + botón de limpiar.
// En modo play/edit: muestra las formas de onda de la capa seleccionada.
// Sin capa seleccionada: array vacío (el menú no se abre).
function _getLeftMenuItems() {
  const key = _selectedLayer;
  if (!key) return [];
  if (Audio.getLayerFxMode(key)) return [...Audio.FX_OPTIONS, 'clearFx'];
  return Audio.WAVEFORM_OPTIONS[key] || [];
}

// ── Menú radial de pinch (índice+pulgar) ─────────────────────────────────────
// Mano derecha → paleta de capas con submenús (✕ VOL ⊕FX).
// Mano izquierda → menú de contexto (efectos FX o formas de onda).
// El menú se abre al mantener el pinch 0.5s. Mientras está abierto, el cursor
// del pinch se mueve por el círculo y al soltar se confirma el elemento sobre el que estaba.
function _processPinchMenu() {
  const W   = mainCanvas.width;
  const H   = mainCanvas.height;
  const now = performance.now();

  for (const hand of frameHands) {
    const hs      = _hand[hand.label];
    const isRight = hand.label === 'Right';

    // Puño = cerrar menú inmediatamente
    if (hand.isFist) { _closePinchMenu(hand.label); continue; }

    // La mano izquierda no empieza a contar si no hay elementos de contexto disponibles
    if (!isRight && !hs.pinchMenuOpen) {
      const items = _getLeftMenuItems();
      if (items.length === 0) {
        if (hs.pinchMenuStart > 0) _closePinchMenu(hand.label);
        continue;
      }
    }

    // Coordenadas del punto de pinch (espejadas horizontalmente: x → 1-x)
    const ppx = 1 - hand.pinch.point.x;
    const ppy = hand.pinch.point.y;
    // Histéresis: una vez contando, el umbral de mantenimiento es más bajo (CLOSE < OPEN)
    const wasCounting = hs.pinchMenuStart > 0 || hs.pinchMenuOpen;
    const isPinching  = hand.pinch.strength > (wasCounting ? PINCH_CLOSE_THRESHOLD : PINCH_OPEN_THRESHOLD);

    if (isPinching) {
      if (!hs.pinchMenuOpen) {
        // Contando el dwell (0.5s de pinch para abrir)
        if (hs.pinchMenuStart === 0) hs.pinchMenuStart = now;
        hs.pinchMenuDwell = Math.min(1, (now - hs.pinchMenuStart) / PINCH_MENU_DWELL_MS);
        if ((now - hs.pinchMenuStart) >= PINCH_MENU_DWELL_MS) {
          hs.pinchMenuOpen   = true;
          hs.pinchMenuOrigin = { x: ppx, y: ppy };
          hs.pinchMenuHover  = null;
          hs.subMenuHover    = null;
          // Abrir la paleta derecha siempre limpia el estado de selección.
          // Esto garantiza que el usuario empiece desde cero sin estados residuales.
          if (isRight) {
            if (_editingLayer) _autoSaveEditing(_editingLayer);
            _editingLayer   = null;
            _selectedLayer  = null;
            _volFaderActive = false;
            _volFaderLayer  = null;
          }
        }
      } else {
        // Menú abierto: detectar sobre qué elemento está el cursor
        const menuItems = isRight ? RIGHT_MENU_ITEMS : _getLeftMenuItems();

        // Si los elementos de contexto desaparecen mientras el menú está abierto, cerrarlo
        if (!isRight && menuItems.length === 0) { _closePinchMenu(hand.label); continue; }

        const ox = hs.pinchMenuOrigin.x * W;
        const oy = hs.pinchMenuOrigin.y * H;
        const px = ppx * W;
        const py = ppy * H;
        const n  = menuItems.length;
        const distFromCenter = Math.sqrt((px - ox) ** 2 + (py - oy) ** 2);

        // Detección de hover: calcula la posición de cada ítem en el círculo y comprueba
        // si el cursor está dentro de su radio de detección (MENU_HOVER_PX).
        // Los n ítems se distribuyen uniformemente en 360° empezando desde arriba (-π/2).
        // angle = -π/2 + (i/n)×2π: el ítem 0 queda en el norte, los demás en sentido horario.
        // ix/iy: posición del centro del ítem en píxeles (polar → cartesiano).
        // Distancia cursor-ítem: si < MENU_HOVER_PX → hover sobre ese ítem.
        let newHover = null;
        for (let i = 0; i < n; i++) {
          const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const ix    = ox + MENU_RADIUS_PX * Math.cos(angle);
          const iy    = oy + MENU_RADIUS_PX * Math.sin(angle);
          if (Math.sqrt((px - ix) ** 2 + (py - iy) ** 2) < MENU_HOVER_PX) {
            newHover = menuItems[i]; break;
          }
        }
        // newHover===null puede significar "cursor entre ítems" o "cursor en el centro".
        // Solo se borra el hover si el cursor está en el 50% central (zona muerta),
        // así el ítem seleccionado se mantiene cuando el cursor está entre ítems.
        if (newHover !== null)                             hs.pinchMenuHover = newHover;
        else if (distFromCenter < MENU_RADIUS_PX * 0.50)  hs.pinchMenuHover = null;

        // Solo mano derecha: detectar submenú cuando se está sobre un instrumento.
        // Tres botones en abanico: ✕ (desactivar) | VOL (volumen) | ⊕FX (efectos).
        // VOL y ⊕FX solo se activan si la capa tiene un bucle grabado.
        if (isRight) {
          const hov = hs.pinchMenuHover;
          if (hov && hov !== 'clear') {
            const i       = RIGHT_MENU_ITEMS.indexOf(hov);
            const angle   = -Math.PI / 2 + (i / n) * Math.PI * 2;
            const ix      = ox + MENU_RADIUS_PX * Math.cos(angle);
            const iy      = oy + MENU_RADIUS_PX * Math.sin(angle);
            const hasLoop = Audio.hasLayerLoop(hov);
            const muteX = ix + SUB_RADIUS * Math.cos(angle - SUB_ARC);
            const muteY = iy + SUB_RADIUS * Math.sin(angle - SUB_ARC);
            const volX  = ix + SUB_RADIUS * Math.cos(angle);
            const volY  = iy + SUB_RADIUS * Math.sin(angle);
            const fxX   = ix + SUB_RADIUS * Math.cos(angle + SUB_ARC);
            const fxY   = iy + SUB_RADIUS * Math.sin(angle + SUB_ARC);
            if (Math.sqrt((px - muteX) ** 2 + (py - muteY) ** 2) < SUB_HOVER_PX) {
              hs.subMenuHover = 'mute';
            } else if (hasLoop && Math.sqrt((px - volX) ** 2 + (py - volY) ** 2) < SUB_HOVER_PX) {
              hs.subMenuHover = 'vol';
            } else if (hasLoop && Math.sqrt((px - fxX) ** 2 + (py - fxY) ** 2) < SUB_HOVER_PX) {
              hs.subMenuHover = 'fx';
            } else {
              hs.subMenuHover = null;
            }
          } else {
            hs.subMenuHover = null;
          }
        }
      }
    } else {
      // Pinch soltado → confirmar la selección si hay un elemento en hover
      if (hs.pinchMenuOpen && hs.pinchMenuHover) {
        const item = hs.pinchMenuHover;
        if (isRight) {
          _applyRightMenuSelection(item, hs.subMenuHover);
        } else {
          _applyLeftMenuSelection(item);
        }
      }
      _closePinchMenu(hand.label);
    }
  }
}

// ── Confirmación de la paleta derecha ─────────────────────────────────────────
// Se llama al soltar el pinch sobre un elemento de la paleta derecha.
function _applyRightMenuSelection(item, subChoice) {
  if (item === 'clear') {
    // CLR: desactiva todas las capas y limpia la selección
    Audio.deactivateAllLayers();
    _editingLayer  = null;
    _selectedLayer = null;
    return;
  }

  if (subChoice === 'mute') {
    // ✕: desactiva la capa por completo (modo off + borra el bucle)
    if (_editingLayer  === item) _editingLayer  = null;
    if (_selectedLayer === item) _selectedLayer = null;
    Audio.setLayerFxMode(item, false);
    Audio.setLayerMode(item, 'off');   // esto llama a deactivateLayer que borra el buffer
    Layers.setActive(item, false);
    return;
  }

  if (subChoice === 'vol') {
    // VOL: entra en modo fader — la mano derecha controla el volumen continuamente
    _editingLayer   = null;
    _selectedLayer  = null;
    _volFaderActive = true;
    _volFaderLayer  = item;
    return;
  }

  if (subChoice === 'fx') {
    // ⊕FX: alterna el modo de efectos de la capa
    // Si la capa estaba off, la activa en editing primero
    const cur  = Audio.getLayerFxMode(item);
    const mode = Audio.getLayerMode(item);
    if (mode === 'off') _selectForEditing(item);
    Audio.setLayerFxMode(item, !cur);
    // Mantener la capa como seleccionada para que los badges y el menú izquierdo sigan visibles
    if (!cur) _selectedLayer = item;
    return;
  }

  // Selección normal (sin submenú): activa, edita o re-edita la capa
  _applyPaletteSelection(item);
}

// Lógica de selección sin submenú:
// - off → entra en editing (activa la capa y las manos la controlan)
// - editing (misma capa) → guarda el bucle y deja de editar
// - editing (otra capa) → guarda la anterior y empieza a editar esta
// - looping → re-entra en editing (las manos vuelven a controlar la capa)
function _applyPaletteSelection(item) {
  const currentMode = Audio.getLayerMode(item);

  if (currentMode === 'off') {
    _selectForEditing(item);
  } else if (currentMode === 'editing') {
    if (item === _editingLayer) {
      _autoSaveEditing(item);
      _editingLayer = null;
    } else {
      _selectForEditing(item);
    }
  } else if (currentMode === 'looping') {
    _selectForEditing(item);
  }
}

// ── Confirmación del menú de contexto de la mano izquierda ───────────────────
// Se llama al soltar el pinch sobre un elemento del menú izquierdo.
function _applyLeftMenuSelection(item) {
  const key = _selectedLayer;
  if (!key) return;

  if (Audio.getLayerFxMode(key)) {
    // Modo FX: el menú izquierdo muestra efectos y el botón de limpiar
    if (item === 'clearFx') {
      // ✕ FX: elimina ambos slots de efectos
      Audio.setFxSlot(key, 'right', null);
      Audio.setFxSlot(key, 'left',  null);
      return;
    }
    const slotR = Audio.getFxSlot(key, 'right');
    const slotL = Audio.getFxSlot(key, 'left');

    if (slotR === item) {
      // El efecto ya estaba en el slot derecho → quitarlo (toggle off)
      // Registrar que el slot derecho fue el último modificado.
      Audio.setFxSlot(key, 'right', null);
      _lastFxSlotChanged[key] = 'right';
    } else if (slotL === item) {
      // El efecto ya estaba en el slot izquierdo → quitarlo (toggle off)
      Audio.setFxSlot(key, 'left', null);
      _lastFxSlotChanged[key] = 'left';
    } else {
      // Efecto nuevo: asignarlo al primer slot libre (prioridad: derecho → izquierdo).
      // Si ambos slots están ocupados, reemplazar el que se modificó más recientemente
      // (_lastFxSlotChanged[key]). El otro slot queda "fijo" porque lleva más tiempo.
      // Esta lógica evita que el efecto "sticky" de una mano se pierda accidentalmente.
      const targetSlot = (slotR === null) ? 'right'
                       : (slotL === null) ? 'left'
                       : _lastFxSlotChanged[key];
      Audio.setFxSlot(key, targetSlot, item);
      _lastFxSlotChanged[key] = targetSlot;
    }
  } else {
    // Modo play/edit: el menú izquierdo cambia la forma de onda del oscilador
    Audio.setLayerWaveform(key, item);
  }
}

// Cierra el menú radial de una mano y limpia todo su estado.
function _closePinchMenu(label) {
  const hs           = _hand[label];
  hs.pinchMenuOpen   = false;
  hs.pinchMenuStart  = 0;
  hs.pinchMenuDwell  = 0;
  hs.pinchMenuOrigin = null;
  hs.pinchMenuHover  = null;
  hs.subMenuHover    = null;
}

// ── Dedo corazón+pulgar → grabar ─────────────────────────────────────────────
// Solo mano derecha. Requiere 0.5s de dwell como la paleta.
// Funciona para dos casos:
//   A) Hay una capa en editing → graba sus parámetros de expresión.
//   B) La capa seleccionada está en looping + FX mode → graba automatización de FX.
// Se bloquea si la paleta está abierta, no hay target, ya se está grabando, o en pre-roll.
function _processMiddlePinch() {
  const now = performance.now();
  for (const hand of frameHands) {
    const isRight = hand.label === 'Right';
    const mp = hand.middlePinch;
    const st = _midPinch[hand.label];

    // El gesto de grabar es solo de la mano derecha
    if (!isRight) { st.start = 0; st.dwell = 0; continue; }

    // Overdub de FX: la capa seleccionada está en looping + modo FX
    const fxOverdub = !_editingLayer && _selectedLayer
      && Audio.getLayerFxMode(_selectedLayer)
      && Audio.getLayerMode(_selectedLayer) === 'looping';
    const recTarget = _editingLayer || (fxOverdub ? _selectedLayer : null);

    // Bloqueos: paleta abierta / sin target / ya grabando / en pre-roll
    if (_hand[hand.label].pinchMenuOpen || !recTarget ||
        Audio.isRecording() || Audio.isPrerolling()) {
      st.start = 0; st.dwell = 0; continue;
    }

    // Umbral más bajo que el índice (corazón+pulgar es un gesto menos preciso)
    const wasCounting = st.start > 0;
    const isPinching  = mp.strength > (wasCounting ? PINCH_CLOSE_THRESHOLD : PINCH_FINGER_THRESHOLD);

    if (isPinching) {
      if (st.start === 0) st.start = now;
      st.dwell = Math.min(1, (now - st.start) / PINCH_MENU_DWELL_MS);
      if ((now - st.start) >= PINCH_MENU_DWELL_MS) {
        Audio.startRecording(recTarget);
        st.start = 0; st.dwell = 0;
      }
    } else {
      st.start = 0; st.dwell = 0;
    }
  }
}

// ── Dedo anular+pulgar → slider de tempo ─────────────────────────────────────
// Solo mano derecha. Tras 0.5s de dwell, la altura de la mano controla el BPM
// en un rango de 50 a 180 BPM (mano arriba = rápido, mano abajo = lento).
// LATCH: cuando el pinch cae (MediaPipe pierde el dedo en movimiento rápido),
// el slider no se apaga inmediatamente — espera RING_LATCH_MS.
// Si el pinch vuelve antes de que expire el latch, el slider continúa sin re-hacer el dwell.
// Si la mano desaparece completamente del frame, también se aplica el latch.
function _processRingPinch() {
  const now       = performance.now();
  const rightHand = frameHands.find(h => h.label === 'Right');
  const st        = _ringPinch.Right;

  if (rightHand && !_hand.Right.pinchMenuOpen) {
    const rp          = rightHand.ringPinch;
    // Una vez el slider está activo, el umbral de cierre (histéresis) es PINCH_CLOSE_THRESHOLD
    const wasCounting = st.start > 0 || _tempoSliderActive;
    const isPinching  = rp.strength > (wasCounting ? PINCH_CLOSE_THRESHOLD : PINCH_FINGER_THRESHOLD);

    if (isPinching) {
      st.latchEnd = 0;   // cancelar cualquier latch pendiente — el pinch ha vuelto

      if (st.start === 0) {
        // Recuperación dentro de la ventana de latch: saltar el dwell, continuar el slider
        if (_tempoSliderActive) st.dwell = 1.0;
        st.start = now;
      }
      st.dwell = Math.min(1, (now - st.start) / PINCH_MENU_DWELL_MS);

      if (st.dwell >= 1.0) {
        _tempoSliderActive = true;
        // Mapeo: Y=0 (arriba) → 180 BPM, Y=1 (abajo) → 50 BPM
        const normY = Math.max(0, Math.min(1, rightHand.center.y));
        _tempoBPM   = Math.round(50 + (1 - normY) * 130);
        Audio.setBPM(_tempoBPM);
      }
    } else {
      // El pinch ha caído — iniciar latch en vez de apagar inmediatamente
      if (_tempoSliderActive) {
        if (st.latchEnd === 0) st.latchEnd = now + RING_LATCH_MS;
      } else {
        st.start = 0; st.dwell = 0; st.latchEnd = 0;
      }
    }
  } else {
    // La mano derecha no está en el frame — aplicar latch igualmente
    if (_tempoSliderActive && st.latchEnd === 0) st.latchEnd = now + RING_LATCH_MS;
  }

  // Caducidad del latch: solo ahora se apaga realmente el slider
  if (_tempoSliderActive && st.latchEnd > 0 && now >= st.latchEnd) {
    _tempoSliderActive = false;
    st.start = 0; st.dwell = 0; st.latchEnd = 0;
  }
}

// ── Clic de metrónomo durante el slider de tempo ──────────────────────────────
// Mientras el slider está activo, reproduce un clic en cada negra para que el
// usuario escuche el nuevo tempo antes de soltarlo.
// Usa acumulación de tiempo para evitar deriva (en vez de comparar con 'now' solo).
function _processMetroClick() {
  if (!_tempoSliderActive) { _metroClickLast = 0; return; }
  const now    = performance.now();
  const beatMs = 60000 / Math.max(1, _tempoBPM);
  if (_metroClickLast === 0 || now - _metroClickLast >= beatMs) {
    _metroClickLast = _metroClickLast === 0 ? now : _metroClickLast + beatMs;
    Audio.tickMetronomeClick();
  }
}

// ── Salida rápida del modo FX ─────────────────────────────────────────────────
// Mientras las manos están sculpting FX en vivo, cualquier inicio de pinch de índice
// (aunque no llegue al dwell completo) sale del modo FX inmediatamente.
// Esto evita que el usuario quede "atrapado" en modo FX.
function _processFxModeExit() {
  const fxKey = (_editingLayer  && Audio.getLayerFxMode(_editingLayer))  ? _editingLayer
              : (_selectedLayer && Audio.getLayerFxMode(_selectedLayer)) ? _selectedLayer
              : null;
  if (!fxKey) return;
  if (_hand.Right.pinchMenuStart > 0 || _hand.Right.pinchMenuOpen) {
    _editingLayer  = null;
    _selectedLayer = null;
  }
}

// ── Fader de volumen: mano derecha en Y controla el volumen ──────────────────
// Activo después de que el usuario confirma el botón VOL del submenú.
// Se desactiva en cuanto empieza un nuevo pinch de índice (apertura de paleta).
// Mapeo: mano arriba (Y=0) → volumen máximo (1.2 = +20%), mano abajo (Y=1) → 0%.
function _processVolFader() {
  if (!_volFaderActive || !_volFaderLayer) return;
  // Cualquier inicio de pinch en la mano derecha sale del modo fader
  if (_hand.Right.pinchMenuStart > 0 || _hand.Right.pinchMenuOpen) {
    _volFaderActive = false;
    _volFaderLayer  = null;
    return;
  }
  const vol = Math.max(0, Math.min(1.2, (1 - _handY.Right) * 1.2));
  Audio.setLayerVolume(_volFaderLayer, vol);
}

// Limpieza cuando una mano desaparece del frame.
// Cierra su menú y resetea los contadores de pinch para evitar estados residuales.
function _onHandLost(label) {
  _closePinchMenu(label);
  _midPinch[label].start  = 0; _midPinch[label].dwell  = 0;
  _ringPinch[label].start = 0; _ringPinch[label].dwell = 0; _ringPinch[label].latchEnd = 0;
}

// ── Snapshot para el renderizador ─────────────────────────────────────────────
// Construye un objeto con todo el estado que ui.js necesita para dibujar el frame.
// Separa claramente el estado de la lógica de renderizado.
function _getSnapshot() {
  // Datos del menú por mano
  const menuHands = ['Right', 'Left'].map(label => {
    const hs      = _hand[label];
    const isRight = label === 'Right';
    const hand    = frameHands.find(h => h.label === label);

    // preOrigin: la posición del pinch durante el dwell (antes de que el menú se abra).
    // ui.js la usa para dibujar el arco de progreso en la posición correcta.
    // Solo existe si el menú está en fase de dwell (no abierto) Y hay mano visible.
    // 1 - hand.pinch.point.x: espeja X porque el canvas está en modo espejo.
    const preOrigin = (!hs.pinchMenuOpen && hs.pinchMenuDwell > 0 && hand)
      ? { x: 1 - hand.pinch.point.x, y: hand.pinch.point.y } : null;

    // Los ítems del menú se calculan en tiempo real porque pueden cambiar (ej: al entrar en FX mode).
    const items = isRight ? RIGHT_MENU_ITEMS : _getLeftMenuItems();

    // fxSlots: qué efecto tiene cada mano asignado — solo relevante para el menú izquierdo.
    // Se usa para resaltar los ítems ya seleccionados y mostrar el badge L/R.
    const contextLayer = _selectedLayer;
    const fxSlots = (!isRight && contextLayer)
      ? { right: Audio.getFxSlot(contextLayer, 'right'), left: Audio.getFxSlot(contextLayer, 'left') }
      : null;

    // currentWaveform: forma de onda activa de la capa — para resaltarla en el menú izquierdo.
    const currentWaveform = (!isRight && contextLayer)
      ? Audio.getLayerWaveform(contextLayer)
      : null;

    return {
      label,
      open:          hs.pinchMenuOpen,
      dwell:         hs.pinchMenuDwell,
      origin:        hs.pinchMenuOrigin,
      preOrigin,
      hover:         hs.pinchMenuHover,
      subHover:      hs.subMenuHover,
      items,
      fxSlots,
      currentWaveform,
    };
  });

  // Estado de todas las capas
  const layerModes    = {};
  const layerMuted    = {};
  const layerFxModes  = {};
  const layerVolumes  = {};
  for (const k of Layers.TYPE_ORDER) {
    layerModes[k]   = Audio.getLayerMode(k);
    layerMuted[k]   = Audio.isLayerMuted(k);
    layerFxModes[k] = Audio.getLayerFxMode(k);
    layerVolumes[k] = Audio.getLayerVolume(k);
  }

  const hasAnyLoop = Layers.TYPE_ORDER.some(k => Audio.hasLayerLoop(k));

  // Qué efecto está activo en cada mano (para el badge del cursor)
  const fxLayer = _selectedLayer;
  const handFxSlots = {
    Right: (fxLayer && Audio.getLayerFxMode(fxLayer)) ? Audio.getFxSlot(fxLayer, 'right') : null,
    Left:  (fxLayer && Audio.getLayerFxMode(fxLayer)) ? Audio.getFxSlot(fxLayer, 'left')  : null,
  };

  return {
    frameHands,
    hands:             menuHands,
    handY:             { ..._handY },
    handVelY:          { ..._handVelY },
    loopPos:           Audio.getLoopPos(),
    loopSteps:         Audio.getLoopSteps(),
    recording:         Audio.isRecording(),
    recordTarget:      Audio.getRecordTarget(),
    hasAnyLoop,
    editingLayer:      _editingLayer,
    layerModes,
    layerMuted,
    layerFxModes,
    layerVolumes,
    handFxSlots,
    tempoSliderActive: _tempoSliderActive,
    tempoBPM:          _tempoBPM,
    midPinchDwell: {
      Right: _midPinch.Right.dwell,
      Left:  _midPinch.Left.dwell,
    },
    ringPinchDwell: {
      Right: _ringPinch.Right.dwell,
      Left:  _ringPinch.Left.dwell,
    },
    chordName:        Audio.currentChordName,
    prerolling:       Audio.isPrerolling(),
    prerollTarget:    Audio.getPrerollTarget(),
    prerollProgress:  Audio.getPrerollProgress(),
    volFaderActive:   _volFaderActive,
    volFaderLayer:    _volFaderLayer,
  };
}

// ── Bucle de renderizado ──────────────────────────────────────────────────────
// Se ejecuta en cada frame del navegador (~60fps).
// Calcula el delta de tiempo (dt, máximo 100ms para evitar saltos grandes),
// decae el pulso visual del beat, detecta transiciones de estado de las capas
// y pide a UI que dibuje el frame con el snapshot actual.
function renderLoop(ts) {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  try {
    // dt: tiempo en segundos desde el último frame. Min(0.1) evita saltos grandes si
    // el navegador pausa el bucle (pestaña en segundo plano, pantalla bloqueada, etc.).
    const dt    = Math.min((ts - lastFrameTs) / 1000, 0.1);
    lastFrameTs = ts;
    // El pulso visual del beat decae 5 unidades por segundo: a dt=1/60s cae 5/60≈0.083 por frame.
    Audio.decayBeatPulse(dt);

    // Cuando audio.js completa la grabación (_recordedSteps >= _LOOP_STEPS), cambia
    // el modo de la capa internamente de 'editing' a 'looping'. Lo detectamos aquí
    // para limpiar _editingLayer y devolver las manos a su estado neutral.
    if (_editingLayer && Audio.getLayerMode(_editingLayer) === 'looping') {
      _editingLayer = null;
    }

    // Detección de fin de overdub de FX: durante el overdub, recordTarget apunta a la capa.
    // Al terminar, recordTarget vuelve a null. Como la capa sigue en 'looping', no podemos
    // detectarlo con la comprobación anterior — necesitamos comparar el frame actual con el anterior.
    // _prevRecordTarget !== null: había una grabación el frame pasado.
    // curRecordTarget === null: esa grabación terminó ahora.
    // getLayerFxMode: confirma que era un overdub de FX (no una grabación normal).
    const curRecordTarget = Audio.getRecordTarget();
    if (_prevRecordTarget !== null && curRecordTarget === null &&
        Audio.getLayerFxMode(_prevRecordTarget)) {
      // El overdub de FX terminó — volver al estado neutral
      _editingLayer  = null;
      _selectedLayer = null;
    }
    _prevRecordTarget = curRecordTarget;

    UI.renderFrame(_getSnapshot());
  } catch (e) { console.error('[renderLoop]', e); }
}

// Oculta el tutorial, inicializa el audio y arranca el bucle de renderizado.
// Guard: si ya está corriendo, solo ocultar el tutorial (evita doble renderLoop).
function start() {
  tutorialEl.classList.add('hidden');
  if (running) return;
  running = true;
  Audio.init();
  Audio.startSequencer();
  _tempoBPM = Audio.getCurrentTempo();
  requestAnimationFrame(ts => { lastFrameTs = ts; renderLoop(ts); });
}

// ── Navegación del tutorial por escenas ──────────────────────────────────────
// El tutorial tiene 4 escenas. Se puede avanzar con el botón "Siguiente" o con
// cualquier tecla alfanumérica/enter/espacio/flecha.
// En la última escena el botón cambia a "Comenzar" y lanza la app.
const scenes     = Array.from(document.querySelectorAll('.tutorial-scene'));
const dots       = Array.from(document.querySelectorAll('.tutorial-dot'));
const tutHint    = document.getElementById('tutHint');
const LAST_SCENE = scenes.length - 1;
let   _tutScene  = 0;

// Inicializar el texto del hint según el dispositivo (el HTML tiene el texto de teclado por defecto)
const _isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (_isTouch && tutHint) tutHint.textContent = '— Tap to continue —';

// Navega a una escena concreta: actualiza clases CSS y el texto del hint.
function _tutGoTo(idx) {
  scenes[_tutScene].classList.remove('active');
  dots[_tutScene].classList.remove('active');
  _tutScene = Math.max(0, Math.min(LAST_SCENE, idx));
  scenes[_tutScene].classList.add('active');
  dots[_tutScene].classList.add('active');
  tutHint.textContent = _tutScene === LAST_SCENE
    ? (_isTouch ? '— Tap to start —'    : '— Press any key to start —')
    : (_isTouch ? '— Tap to continue —' : '— Press any key to continue —');
}

// ── Pantalla completa + orientación landscape ─────────────────────────────────
// Se solicita en la primera interacción del tutorial (toque o tecla).
// Requiere un "user gesture" — por eso no se llama en el load.
// screen.orientation.lock('landscape') anula el bloqueo de rotación del SO.
let _fullscreenDone = false;
async function _requestFullscreenLandscape() {
  if (_fullscreenDone) return;
  _fullscreenDone = true;

  // 1. Pedir permiso de cámara ANTES del fullscreen.
  //    Si lo pedimos después, el navegador sale del fullscreen para mostrar el diálogo
  //    y ya no vuelve. Al pedirlo aquí, el diálogo aparece antes de entrar en fullscreen.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop()); // solo queremos el permiso, no el stream
  } catch (_) { /* permiso denegado o desktop sin cámara — continuar */ }

  // 2. Fullscreen (ya sin interrupción de permisos)
  try {
    const el = document.documentElement;
    if      (el.requestFullscreen)       await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch (_) { /* desktop o iOS — ignorar */ }

  // 3. Bloquear orientación landscape (anula el bloqueo de rotación del SO)
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch (_) { /* ignorar si el navegador no lo permite */ }
}

// Avanza una escena o, si ya estamos en la última, lanza la aplicación.
function _tutAdvance() {
  _requestFullscreenLandscape();
  if (_tutScene < LAST_SCENE) {
    _tutGoTo(_tutScene + 1);
  } else {
    // Última escena: inicializar MediaPipe y arrancar
    if (!handsModel) {
      initHands();
      UI.init(videoEl, mainCanvas);
      UI.resize();
      startCamera();
    }
    start();
  }
}

// Toque en el tutorial (móvil).
// Usamos touchstart Y click para máxima compatibilidad con Safari iOS.
// El debounce de 400ms evita que ambos eventos disparen _tutAdvance dos veces en el mismo toque.
let _lastTutTouch = 0;
function _tutTap() {
  const now = Date.now();
  if (now - _lastTutTouch < 400) return;
  _lastTutTouch = now;
  _tutAdvance();
}

// touchstart: respuesta inmediata sin delay de 300ms
tutorialEl.addEventListener('touchstart', e => {
  e.preventDefault();
  _tutTap();
}, { passive: false, capture: true });

// click: fallback para Safari y otros navegadores donde touchstart puede fallar
tutorialEl.addEventListener('click', () => _tutTap());

// Listener global de teclado:
// - Con el tutorial visible: cualquier tecla imprimible/enter/espacio/flecha avanza escena.
// - Con la app corriendo: teclas 1-5 cambian la atmósfera, H/Escape reabre el tutorial.
window.addEventListener('keydown', e => {
  if (!tutorialEl.classList.contains('hidden')) {
    // No interceptar teclas modificadoras (Shift, Ctrl, Alt...) ni combinaciones del navegador
    if (e.key.length === 1 || ['Enter','ArrowRight','ArrowDown',' '].includes(e.key)) {
      e.preventDefault();
      _tutAdvance();
      return;
    }
    return;
  }
  // Atajos de la app
  if (e.key in ATMO_KEYS) {
    const key = ATMO_KEYS[e.key];
    Audio.setAtmosphere(key);
    UI.setAtmoColor(Audio.getCurrentAtmo().color);
    const el = document.getElementById('atmoLabel');
    if (el) el.textContent = Audio.getCurrentAtmo().name;
    return;
  }
  if (e.key.toLowerCase() === 'h' || e.key === 'Escape') {
    tutorialEl.classList.remove('hidden');
    _tutGoTo(0);  // siempre reabre desde la primera escena
  }
});

window.addEventListener('resize', () => UI.resize());

// ── Safari: instrucciones para ocultar la barra antes del tutorial ───────────
// Solo Safari iOS (no Chrome/Firefox/otros en iOS que también reportan "safari").
// Muestra un overlay con pasos escritos + botón "Continuar".
// Bonus: si se detecta que la barra ya se ocultó (height increase), se descarta solo.
(function initSafariHint() {
  const ua = navigator.userAgent;
  // Safari iOS: contiene "Safari" pero NO contiene Chrome, CriOS (Chrome iOS),
  // FxiOS (Firefox iOS), OPiOS (Opera iOS), ni "Android"
  const isSafariMobile = /safari/i.test(ua)
    && !/crios|fxios|opios|chrome|android/i.test(ua)
    && _isTouch;

  if (!isSafariMobile) return;

  const hint = document.getElementById('safari-hint');
  const btn  = document.getElementById('safari-hint-btn');
  if (!hint) return;

  // Mostrar el overlay; mantener tutorial oculto (pointer-events off) hasta que se descarte
  hint.style.display              = 'flex';
  tutorialEl.style.opacity        = '0';
  tutorialEl.style.pointerEvents  = 'none';
  tutorialEl.style.transition     = 'opacity 0.5s ease';

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    hint.classList.add('hiding');
    window.removeEventListener('resize', onResize);
    setTimeout(() => {
      hint.remove();
      tutorialEl.style.opacity      = '1';
      tutorialEl.style.pointerEvents = '';
    }, 520);
  }

  // Botón "Continuar" → descarta manualmente
  if (btn) {
    btn.addEventListener('touchstart', e => { e.preventDefault(); dismiss(); }, { passive: false });
    btn.addEventListener('click', dismiss);
  }

  // Auto-detección bonus: si la barra se oculta sola (landscape + height increase)
  let baseH = 0;
  function onResize() {
    if (dismissed) return;
    if (window.innerWidth <= window.innerHeight) { baseH = 0; return; } // portrait → reset
    if (baseH === 0) { baseH = window.innerHeight; return; }            // primera medición
    if (window.innerHeight >= baseH + 25) dismiss();                    // barra oculta
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 350));
  onResize(); // comprobación inicial
})();

})();
