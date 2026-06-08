(function () {
'use strict';

// Referencias al DOM
const videoEl    = document.getElementById('video');
const mainCanvas = document.getElementById('mainCanvas');
const tutorialEl = document.getElementById('tutorial');

// Estado general de la app
let running     = false;
let handsModel  = null;  // instancia del modelo MediaPipe Hands
let camera      = null;  // instancia de Camera que envía frames al modelo
let frameHands  = [];    // resultado del último frame: array de objetos de mano
let lastFrameTs = 0;     // timestamp del último frame (para calcular dt)

// Teclas 1–5 cambian la atmósfera desde el teclado (solo en escritorio)
const ATMO_KEYS = { '1':'void', '2':'pulse', '3':'float', '4':'bloom', '5':'storm' };

// Posición Y suavizada de cada mano (0=arriba, 1=abajo).
// Se usa un filtro de paso bajo para evitar saltos bruscos al controlar audio.
// Y_SMOOTH y VEL_SMOOTH son las constantes del filtro EMA.
const _handY    = { Right: 0.5, Left: 0.5 };
const _handVelY = { Right: 0,   Left: 0   };
const Y_SMOOTH   = 0.12;
const VEL_SMOOTH = 0.20;

// Capa que está editándose ahora mismo (las manos la controlan en directo).
// _selectedLayer persiste después de que la capa pasa a 'looping', para que el
// menú de contexto de la mano izquierda siga visible.
let _editingLayer  = null;
let _selectedLayer = null;

// Parámetros del menú radial de pinch (índice+pulgar)
const PINCH_MENU_DWELL_MS   = 500;  // tiempo de pinch para abrir el menú (ms)
const MENU_RADIUS_PX        = 125;  // radio del menú en píxeles
const MENU_HOVER_PX         = 46;   // radio de detección de hover por ítem
const PINCH_OPEN_THRESHOLD  = 0.60; // fuerza mínima para empezar a contar
const PINCH_CLOSE_THRESHOLD = 0.28; // fuerza mínima para mantener abierto (histéresis)

// Ítems de la paleta derecha: los 5 instrumentos + botón de limpiar todo
const RIGHT_MENU_ITEMS = [...Layers.TYPE_ORDER, 'clear'];

// Geometría del submenú (debe coincidir con las constantes de ui.js)
const SUB_RADIUS   = 70;
const SUB_ARC      = 52 * Math.PI / 180;
const SUB_HOVER_PX = 32;

// Umbral de detección para corazón y anular (menos precisos que el índice)
const PINCH_FINGER_THRESHOLD = 0.35;

// Lleva la cuenta de qué slot de FX se cambió más recientemente por capa.
// Si ambos slots están ocupados, el nuevo efecto reemplaza el que lleva más tiempo.
const _lastFxSlotChanged = { pad:'right', bass:'right', synth:'right', perc:'right', lead:'right' };

// Crea el estado inicial del gesto de paleta para una mano
function _initHandState() {
  return {
    pinchMenuStart:  0,
    pinchMenuDwell:  0,
    pinchMenuOpen:   false,
    pinchMenuOrigin: null,
    pinchMenuHover:  null,
    subMenuHover:    null,
  };
}
const _hand = { Right: _initHandState(), Left: _initHandState() };

// Necesario para detectar cuándo termina un overdub de FX (ver renderLoop)
let _prevRecordTarget = null;

// Modo fader de volumen: se activa al seleccionar VOL en el submenú de una capa
let _volFaderActive = false;
let _volFaderLayer  = null;

// Dwell del pinch de corazón (REC) — solo mano derecha
const _midPinch = { Right: { start:0, dwell:0 }, Left: { start:0, dwell:0 } };

// Dwell del pinch de anular (BPM/tempo).
// RING_LATCH_MS: período de gracia para no apagar el slider si MediaPipe pierde
// el dedo brevemente durante movimientos rápidos.
const _ringPinch = {
  Right: { start:0, dwell:0, latchEnd:0 },
  Left:  { start:0, dwell:0, latchEnd:0 },
};
const RING_LATCH_MS = 150;
let _tempoSliderActive = false;
let _tempoBPM          = 100;
let _metroClickLast    = 0;

// Inicializa el modelo de manos de MediaPipe.
// modelComplexity=1 es el más preciso. Umbrales en 0.70 dan buen balance
// entre estabilidad y capacidad de respuesta.
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

// Inicia la cámara y empieza a enviar frames al modelo.
// _frameProcessing evita encolar frames si MediaPipe aún no terminó el anterior,
// lo que causaría acumulación de memoria y un eventual crash del tab.
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

// Callback de MediaPipe: se llama en cada frame procesado.
// MediaPipe invierte las etiquetas de mano porque la imagen está en espejo,
// así que se corrige: 'Left' de MediaPipe → 'Right' en nuestro sistema y viceversa.
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
    _processFxModeExit();
    _processMiddlePinch();
    _processRingPinch();
    _processMetroClick();
    _processVolFader();
  } catch (e) { console.error('[onHandResults]', e); }
}

// Filtro EMA (Exponential Moving Average) para la posición Y de la palma.
// newY = prevY + (rawY - prevY) × alpha  →  suaviza sin desfase excesivo.
function _updateHandPositions() {
  for (const hand of frameHands) {
    const rawY  = hand.center.y;
    const prevY = _handY[hand.label];
    const newY  = prevY + (rawY - prevY) * (1 / (1 + Y_SMOOTH * 60));
    const vel   = _handVelY[hand.label] + (Math.abs(hand.palmVel.y) - _handVelY[hand.label]) * VEL_SMOOTH;
    _handY[hand.label]    = newY;
    _handVelY[hand.label] = vel;
  }
}

// Apertura de mano: distancia media de las puntas al centro de la palma, normalizada.
// Rango típico: ~0.04 (puño) a ~0.22 (mano abierta). Se mapea a 0–1.
function _getHandOpenness(hand) {
  if (!hand || !hand.fingertips || hand.fingertips.length === 0) return 1;
  const cx = hand.center.x, cy = hand.center.y;
  let total = 0;
  for (const tip of hand.fingertips) {
    const dx = tip.x - cx, dy = tip.y - cy;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  const avg = total / hand.fingertips.length;
  return Math.max(0, Math.min(1, (avg - 0.04) / 0.18));
}

// Control en tiempo real de la capa en editing.
// Prioridad: modo fader activo → modo FX → modo editing normal → puño (mute).
function _processRtControl() {
  if (_hand.Right.pinchMenuOpen && _hand.Right.subMenuHover === 'vol') return;

  const rHand = frameHands.find(h => h.label === 'Right');
  const lHand = frameHands.find(h => h.label === 'Left');
  const rY    = _handY.Right;
  const lY    = _handY.Left;

  // Si hay una capa con FX activo, las manos controlan los efectos en lugar de la expresión
  const fxKey = (_editingLayer  && Audio.getLayerFxMode(_editingLayer))  ? _editingLayer
              : (_selectedLayer && Audio.getLayerFxMode(_selectedLayer)) ? _selectedLayer
              : null;

  if (fxKey) {
    Audio.applyFx(fxKey, 'right', 1 - rY, _getHandOpenness(rHand));
    Audio.applyFx(fxKey, 'left',  1 - lY, _getHandOpenness(lHand));
    return;
  }

  if (!_editingLayer) return;
  const key = _editingLayer;

  // Puño derecho → silenciar mientras dure el puño
  const fistMute = rHand ? rHand.isFist : false;
  Audio.setLayerMuted(key, fistMute);
  if (fistMute) return;

  if (!rHand) {
    Audio.setLayerVolume(key, 0);
    return;
  }

  const rOpen = _getHandOpenness(rHand);
  const lOpen = _getHandOpenness(lHand);

  // Mano arriba (Y pequeña) = más de todo en la mayoría de los parámetros
  switch (key) {
    case 'pad':
      Audio.setPadChord(rY);
      Audio.setPadTremolo(1 - lY);
      Audio.setPadFilter(lOpen);
      Audio.setLayerVolume('pad',   Math.min(1.2, rOpen * 1.2));
      break;
    case 'bass':
      Audio.setBassGroove(1 - rY);
      Audio.setBassGate(1 - lY);
      Audio.setBassFilter(lOpen);
      Audio.setLayerVolume('bass',  Math.min(1.2, rOpen * 1.2));
      break;
    case 'synth':
      Audio.setSynthArpLen(rY);
      Audio.setSynthTremolo(1 - lY);
      Audio.setSynthFilter(lOpen);
      Audio.setLayerVolume('synth', Math.min(1.2, rOpen * 1.2));
      break;
    case 'perc':
      Audio.setPercIntensity(1 - rY);
      Audio.setPercCymbalLevel(1 - lY);
      break;
    case 'lead':
      Audio.setLeadNote(rY);
      Audio.setLeadTremolo(1 - lY);
      Audio.setLeadFilter(lOpen);
      Audio.setLayerVolume('lead',  Math.min(1.2, rOpen * 1.2));
      break;
  }
}

// Volumen en tiempo real cuando la capa está en editing SIN bucle grabado todavía.
// Una vez grabado el bucle, el volumen se controla con el fader del submenú.
function _processPlayVolume() {
  if (_hand.Right.pinchMenuOpen) return;
  const key = _editingLayer;
  if (!key) return;
  if (Audio.getLayerMode(key) !== 'editing') return;
  if (Audio.hasLayerLoop(key)) return;     // si ya hay bucle, no tocar el volumen
  if (Audio.getLayerFxMode(key)) return;   // en modo FX la apertura de mano va a otro sitio
  const rHand = frameHands.find(h => h.label === 'Right');
  if (!rHand) return;
  Audio.setLayerVolume(key, Math.min(1.2, _getHandOpenness(rHand) * 1.2));
}

// Guarda automáticamente una capa que estaba en editing cuando se deja de editar.
// Si tiene bucle → pasa a 'looping'. Si no → pasa a 'off' (sin sonido que guardar).
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

// Pone una capa en modo editing. Si había otra en editing, la guarda primero.
function _selectForEditing(key) {
  if (_editingLayer && _editingLayer !== key) {
    Audio.setLayerMuted(_editingLayer, false);
    _autoSaveEditing(_editingLayer);
  }
  Audio.setLayerMode(key, 'editing');
  Audio.setLayerMuted(key, false);
  Layers.setActive(key, true);
  _editingLayer  = key;
  _selectedLayer = key;
}

// Contenido del menú izquierdo según el contexto de la capa seleccionada.
// En modo FX: lista de efectos disponibles + botón de limpiar.
// En modo normal: formas de onda de la capa.
function _getLeftMenuItems() {
  const key = _selectedLayer;
  if (!key) return [];
  if (Audio.getLayerFxMode(key)) return [...Audio.FX_OPTIONS, 'clearFx'];
  return Audio.WAVEFORM_OPTIONS[key] || [];
}

// Gestiona el menú radial de pinch de ambas manos.
// Derecha → paleta de instrumentos. Izquierda → FX o formas de onda.
// El menú se abre al mantener el pinch 0.5s. Al soltar sobre un ítem se confirma.
function _processPinchMenu() {
  const W   = mainCanvas.width;
  const H   = mainCanvas.height;
  const now = performance.now();

  for (const hand of frameHands) {
    const hs      = _hand[hand.label];
    const isRight = hand.label === 'Right';

    if (hand.isFist) { _closePinchMenu(hand.label); continue; }

    // La mano izquierda no abre el menú si no hay ítems de contexto
    if (!isRight && !hs.pinchMenuOpen) {
      const items = _getLeftMenuItems();
      if (items.length === 0) {
        if (hs.pinchMenuStart > 0) _closePinchMenu(hand.label);
        continue;
      }
    }

    const ppx = 1 - hand.pinch.point.x; // espejado
    const ppy = hand.pinch.point.y;
    // Histéresis: threshold más bajo una vez que se está contando (evita oscilaciones)
    const wasCounting = hs.pinchMenuStart > 0 || hs.pinchMenuOpen;
    const isPinching  = hand.pinch.strength > (wasCounting ? PINCH_CLOSE_THRESHOLD : PINCH_OPEN_THRESHOLD);

    if (isPinching) {
      if (!hs.pinchMenuOpen) {
        // Fase de dwell: contar hasta 0.5s
        if (hs.pinchMenuStart === 0) hs.pinchMenuStart = now;
        hs.pinchMenuDwell = Math.min(1, (now - hs.pinchMenuStart) / PINCH_MENU_DWELL_MS);
        if ((now - hs.pinchMenuStart) >= PINCH_MENU_DWELL_MS) {
          hs.pinchMenuOpen   = true;
          hs.pinchMenuOrigin = { x: ppx, y: ppy };
          hs.pinchMenuHover  = null;
          hs.subMenuHover    = null;
          // Abrir la paleta derecha siempre limpia el estado de edición
          if (isRight) {
            if (_editingLayer) _autoSaveEditing(_editingLayer);
            _editingLayer   = null;
            _selectedLayer  = null;
            _volFaderActive = false;
            _volFaderLayer  = null;
          }
        }
      } else {
        // Menú abierto: detectar sobre qué ítem está el cursor
        const menuItems = isRight ? RIGHT_MENU_ITEMS : _getLeftMenuItems();
        if (!isRight && menuItems.length === 0) { _closePinchMenu(hand.label); continue; }

        const ox = hs.pinchMenuOrigin.x * W;
        const oy = hs.pinchMenuOrigin.y * H;
        const px = ppx * W;
        const py = ppy * H;
        const n  = menuItems.length;
        const distFromCenter = Math.sqrt((px - ox) ** 2 + (py - oy) ** 2);

        // Comprueba si el cursor está dentro del radio de cada ítem
        let newHover = null;
        for (let i = 0; i < n; i++) {
          const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const ix    = ox + MENU_RADIUS_PX * Math.cos(angle);
          const iy    = oy + MENU_RADIUS_PX * Math.sin(angle);
          if (Math.sqrt((px - ix) ** 2 + (py - iy) ** 2) < MENU_HOVER_PX) {
            newHover = menuItems[i]; break;
          }
        }
        // Zona muerta central: solo borra el hover si el cursor vuelve al 50% interior
        if (newHover !== null)                             hs.pinchMenuHover = newHover;
        else if (distFromCenter < MENU_RADIUS_PX * 0.50)  hs.pinchMenuHover = null;

        // Submenú de la paleta derecha (✕ VOL ⊕FX)
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
      // Pinch soltado → confirmar la selección
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

// Confirma la selección de un ítem de la paleta derecha
function _applyRightMenuSelection(item, subChoice) {
  if (item === 'clear') {
    Audio.deactivateAllLayers();
    _editingLayer  = null;
    _selectedLayer = null;
    return;
  }

  if (subChoice === 'mute') {
    // Desactiva la capa completamente (borra el bucle también)
    if (_editingLayer  === item) _editingLayer  = null;
    if (_selectedLayer === item) _selectedLayer = null;
    Audio.setLayerFxMode(item, false);
    Audio.setLayerMode(item, 'off');
    Layers.setActive(item, false);
    return;
  }

  if (subChoice === 'vol') {
    // Activa el fader de volumen continuo
    _editingLayer   = null;
    _selectedLayer  = null;
    _volFaderActive = true;
    _volFaderLayer  = item;
    return;
  }

  if (subChoice === 'fx') {
    // Alterna el modo FX de la capa
    const cur  = Audio.getLayerFxMode(item);
    const mode = Audio.getLayerMode(item);
    if (mode === 'off') _selectForEditing(item);
    Audio.setLayerFxMode(item, !cur);
    if (!cur) _selectedLayer = item;
    return;
  }

  _applyPaletteSelection(item);
}

// Lógica de selección simple desde la paleta (sin submenú):
// off → editing | editing misma → guardar | editing otra → cambiar | looping → re-editar
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

// Confirma la selección del menú izquierdo (FX o formas de onda)
function _applyLeftMenuSelection(item) {
  const key = _selectedLayer;
  if (!key) return;

  if (Audio.getLayerFxMode(key)) {
    if (item === 'clearFx') {
      Audio.setFxSlot(key, 'right', null);
      Audio.setFxSlot(key, 'left',  null);
      return;
    }
    const slotR = Audio.getFxSlot(key, 'right');
    const slotL = Audio.getFxSlot(key, 'left');

    if (slotR === item) {
      Audio.setFxSlot(key, 'right', null);
      _lastFxSlotChanged[key] = 'right';
    } else if (slotL === item) {
      Audio.setFxSlot(key, 'left', null);
      _lastFxSlotChanged[key] = 'left';
    } else {
      // Si los dos slots están ocupados, reemplaza el que se cambió más recientemente
      const targetSlot = (slotR === null) ? 'right'
                       : (slotL === null) ? 'left'
                       : _lastFxSlotChanged[key];
      Audio.setFxSlot(key, targetSlot, item);
      _lastFxSlotChanged[key] = targetSlot;
    }
  } else {
    Audio.setLayerWaveform(key, item);
  }
}

// Cierra el menú radial y limpia todo el estado de esa mano
function _closePinchMenu(label) {
  const hs           = _hand[label];
  hs.pinchMenuOpen   = false;
  hs.pinchMenuStart  = 0;
  hs.pinchMenuDwell  = 0;
  hs.pinchMenuOrigin = null;
  hs.pinchMenuHover  = null;
  hs.subMenuHover    = null;
}

// Pinch corazón+pulgar → grabar (solo mano derecha, dwell de 0.5s igual que la paleta).
// Funciona tanto para grabar expresión (capa en editing) como para overdub de FX
// (capa en looping + FX mode). Se bloquea si la paleta está abierta o ya se graba.
function _processMiddlePinch() {
  const now = performance.now();
  for (const hand of frameHands) {
    const isRight = hand.label === 'Right';
    const mp = hand.middlePinch;
    const st = _midPinch[hand.label];

    if (!isRight) { st.start = 0; st.dwell = 0; continue; }

    const fxOverdub = !_editingLayer && _selectedLayer
      && Audio.getLayerFxMode(_selectedLayer)
      && Audio.getLayerMode(_selectedLayer) === 'looping';
    const recTarget = _editingLayer || (fxOverdub ? _selectedLayer : null);

    if (_hand[hand.label].pinchMenuOpen || !recTarget ||
        Audio.isRecording() || Audio.isPrerolling()) {
      st.start = 0; st.dwell = 0; continue;
    }

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

// Pinch anular+pulgar → slider de tempo (solo mano derecha).
// La altura de la mano controla el BPM entre 50 y 180.
// El latch de 150ms evita que el slider se apague por dropouts breves de MediaPipe.
function _processRingPinch() {
  const now       = performance.now();
  const rightHand = frameHands.find(h => h.label === 'Right');
  const st        = _ringPinch.Right;

  if (rightHand && !_hand.Right.pinchMenuOpen) {
    const rp          = rightHand.ringPinch;
    const wasCounting = st.start > 0 || _tempoSliderActive;
    const isPinching  = rp.strength > (wasCounting ? PINCH_CLOSE_THRESHOLD : PINCH_FINGER_THRESHOLD);

    if (isPinching) {
      st.latchEnd = 0; // cancelar latch pendiente — el pinch ha vuelto

      if (st.start === 0) {
        if (_tempoSliderActive) st.dwell = 1.0; // recuperación dentro del latch: saltar el dwell
        st.start = now;
      }
      st.dwell = Math.min(1, (now - st.start) / PINCH_MENU_DWELL_MS);

      if (st.dwell >= 1.0) {
        _tempoSliderActive = true;
        // Mano arriba (Y=0) → 180 BPM, mano abajo (Y=1) → 50 BPM
        const normY = Math.max(0, Math.min(1, rightHand.center.y));
        _tempoBPM   = Math.round(50 + (1 - normY) * 130);
        Audio.setBPM(_tempoBPM);
      }
    } else {
      if (_tempoSliderActive) {
        if (st.latchEnd === 0) st.latchEnd = now + RING_LATCH_MS;
      } else {
        st.start = 0; st.dwell = 0; st.latchEnd = 0;
      }
    }
  } else {
    if (_tempoSliderActive && st.latchEnd === 0) st.latchEnd = now + RING_LATCH_MS;
  }

  // Si el latch expiró, apagar el slider
  if (_tempoSliderActive && st.latchEnd > 0 && now >= st.latchEnd) {
    _tempoSliderActive = false;
    st.start = 0; st.dwell = 0; st.latchEnd = 0;
  }
}

// Reproduce un clic de metrónomo en cada negra mientras el slider está activo,
// para que el usuario escuche el tempo antes de soltarlo.
function _processMetroClick() {
  if (!_tempoSliderActive) { _metroClickLast = 0; return; }
  const now    = performance.now();
  const beatMs = 60000 / Math.max(1, _tempoBPM);
  if (_metroClickLast === 0 || now - _metroClickLast >= beatMs) {
    _metroClickLast = _metroClickLast === 0 ? now : _metroClickLast + beatMs;
    Audio.tickMetronomeClick();
  }
}

// Cualquier inicio de pinch de índice sale del modo FX inmediatamente,
// para que el usuario no quede "atrapado" esculpiendo efectos.
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

// Modo fader de volumen: mano derecha en Y controla el volumen de _volFaderLayer.
// Se desactiva en cuanto empieza un nuevo pinch (apertura de paleta).
function _processVolFader() {
  if (!_volFaderActive || !_volFaderLayer) return;
  if (_hand.Right.pinchMenuStart > 0 || _hand.Right.pinchMenuOpen) {
    _volFaderActive = false;
    _volFaderLayer  = null;
    return;
  }
  const vol = Math.max(0, Math.min(1.2, (1 - _handY.Right) * 1.2));
  Audio.setLayerVolume(_volFaderLayer, vol);
}

// Limpieza cuando una mano desaparece del frame: cierra su menú y resetea dwells
function _onHandLost(label) {
  _closePinchMenu(label);
  _midPinch[label].start  = 0; _midPinch[label].dwell  = 0;
  _ringPinch[label].start = 0; _ringPinch[label].dwell = 0; _ringPinch[label].latchEnd = 0;
}

// Construye el snapshot de estado que ui.js necesita para dibujar el frame.
// Separa claramente el estado de la lógica de renderizado.
function _getSnapshot() {
  const menuHands = ['Right', 'Left'].map(label => {
    const hs      = _hand[label];
    const isRight = label === 'Right';
    const hand    = frameHands.find(h => h.label === label);

    // Posición del pinch durante el dwell (para el arco de progreso antes de abrir el menú)
    const preOrigin = (!hs.pinchMenuOpen && hs.pinchMenuDwell > 0 && hand)
      ? { x: 1 - hand.pinch.point.x, y: hand.pinch.point.y } : null;

    const items = isRight ? RIGHT_MENU_ITEMS : _getLeftMenuItems();

    const contextLayer = _selectedLayer;
    const fxSlots = (!isRight && contextLayer)
      ? { right: Audio.getFxSlot(contextLayer, 'right'), left: Audio.getFxSlot(contextLayer, 'left') }
      : null;

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

  const layerModes   = {};
  const layerMuted   = {};
  const layerFxModes = {};
  const layerVolumes = {};
  for (const k of Layers.TYPE_ORDER) {
    layerModes[k]   = Audio.getLayerMode(k);
    layerMuted[k]   = Audio.isLayerMuted(k);
    layerFxModes[k] = Audio.getLayerFxMode(k);
    layerVolumes[k] = Audio.getLayerVolume(k);
  }

  const hasAnyLoop = Layers.TYPE_ORDER.some(k => Audio.hasLayerLoop(k));

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

// Bucle de renderizado (~60fps). Calcula dt, decae el pulso del beat,
// detecta transiciones de estado de las capas y pide a UI que dibuje el frame.
function renderLoop(ts) {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  try {
    // dt en segundos, limitado a 0.1 para evitar saltos grandes si el navegador pausó
    const dt    = Math.min((ts - lastFrameTs) / 1000, 0.1);
    lastFrameTs = ts;
    Audio.decayBeatPulse(dt);

    // Cuando audio.js termina la grabación, cambia el modo de la capa a 'looping'
    // sin pasar por aquí. Lo detectamos para limpiar _editingLayer.
    if (_editingLayer && Audio.getLayerMode(_editingLayer) === 'looping') {
      _editingLayer = null;
    }

    // Detección de fin de overdub de FX: el recordTarget pasa de algo a null
    // mientras la capa sigue en looping. No se puede detectar con lo anterior.
    const curRecordTarget = Audio.getRecordTarget();
    if (_prevRecordTarget !== null && curRecordTarget === null &&
        Audio.getLayerFxMode(_prevRecordTarget)) {
      _editingLayer  = null;
      _selectedLayer = null;
    }
    _prevRecordTarget = curRecordTarget;

    UI.renderFrame(_getSnapshot());
  } catch (e) { console.error('[renderLoop]', e); }
}

// Inicializa el audio, arranca el secuenciador y el bucle de renderizado.
// Guard para no ejecutarlo dos veces si ya está corriendo.
function start() {
  tutorialEl.classList.add('hidden');
  if (running) return;
  running = true;
  Audio.init();
  Audio.startSequencer();
  _tempoBPM = Audio.getCurrentTempo();
  requestAnimationFrame(ts => { lastFrameTs = ts; renderLoop(ts); });
}

// Tutorial: 4 escenas. Se avanza con botón, teclado o tap.
const scenes     = Array.from(document.querySelectorAll('.tutorial-scene'));
const dots       = Array.from(document.querySelectorAll('.tutorial-dot'));
const tutHint    = document.getElementById('tutHint');
const LAST_SCENE = scenes.length - 1;
let   _tutScene  = 0;

const _isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (_isTouch && tutHint) tutHint.textContent = '— Tap to continue —';

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

// Permiso de cámara: se pide una sola vez, antes de que MediaPipe la necesite.
let _cameraPermDone = false;
async function _requestCameraPermission() {
  if (_cameraPermDone) return;
  _cameraPermDone = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop());
  } catch (_) { /* denegado o sin cámara — MediaPipe lo gestionará después */ }
}

// Fullscreen + lock de orientación landscape. Separado del permiso de cámara
// para evitar condiciones de carrera en iOS.
let _fullscreenDone = false;
async function _requestFullscreenLandscape() {
  if (_fullscreenDone) return;
  _fullscreenDone = true;
  try {
    const el = document.documentElement;
    if      (el.requestFullscreen)       await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch (_) { /* desktop o iOS — ignorar */ }
  try {
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch (_) { }
}

// Avanza una escena del tutorial o lanza la app si ya estamos en la última
function _tutAdvance() {
  _requestFullscreenLandscape();
  if (_tutScene < LAST_SCENE) {
    _tutGoTo(_tutScene + 1);
  } else {
    console.log('[tut] última escena — arrancando...');
    try {
      if (!handsModel) {
        initHands();
        UI.init(videoEl, mainCanvas);
        UI.resize();
        startCamera();
      }
      start();
      console.log('[tut] iniciado');
    } catch (err) {
      console.error('[tut] ERROR al arrancar:', err);
      // Mostrar el error en pantalla para poder depurar en móvil sin consola
      const dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;inset:0;background:#000;color:#f55;font:14px monospace;padding:20px;z-index:99999;overflow:auto;white-space:pre-wrap;';
      dbg.textContent = 'ERROR AL ARRANCAR:\n' + (err?.stack || err);
      document.body.appendChild(dbg);
    }
  }
}

// Navegación del tutorial por toque (con debounce)
let _safariHintActive = false;
let _lastTutTouch = 0;
function _tutTap() {
  if (_safariHintActive) return;
  if (running) return;
  if (tutorialEl.classList.contains('hidden')) return;
  const now = Date.now();
  if (now - _lastTutTouch < 500) return;
  _lastTutTouch = now;
  _tutAdvance();
}

tutorialEl.addEventListener('touchend', () => _tutTap(), { passive: true });
tutorialEl.addEventListener('click', () => _tutTap());

// Teclado: teclas imprimibles / enter / espacio / flechas avanzan el tutorial.
// Con la app corriendo: 1–5 cambian atmósfera, H/Escape reabre el tutorial.
window.addEventListener('keydown', e => {
  if (!tutorialEl.classList.contains('hidden')) {
    if (e.key.length === 1 || ['Enter','ArrowRight','ArrowDown',' '].includes(e.key)) {
      e.preventDefault();
      _tutAdvance();
      return;
    }
    return;
  }
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
    _tutGoTo(0);
  }
});

window.addEventListener('resize', () => UI.resize());

// Hints de iOS: silent mode → barra de Safari → tutorial
// El silent-hint ya está visible en iOS via CSS (html.ios #silent-hint).
(function() {
  const ua       = navigator.userAgent;
  const isIOS    = /iphone|ipad|ipod/i.test(ua);
  const isSafari = isIOS
                   && /safari/i.test(ua)
                   && !/crios|fxios|opios|chrome|android/i.test(ua);

  if (!isIOS) return;

  _safariHintActive = true;

  const silentHint = document.getElementById('silent-hint');
  const silentBtn  = document.getElementById('silent-hint-btn');
  const safariHint = document.getElementById('safari-hint');
  const safariBtn  = document.getElementById('safari-hint-btn');

  function showSafariHint() {
    if (!safariHint) { _safariHintActive = false; return; }
    safariHint.style.display = 'flex';
    _safariHintActive = true;

    let done = false;
    function onContinue() {
      if (done) return;
      done = true;
      _requestCameraPermission();
      safariHint.style.display = 'none';
      _safariHintActive = false;
    }
    if (safariBtn) {
      safariBtn.addEventListener('touchstart', e => { e.preventDefault(); onContinue(); }, { passive: false });
      safariBtn.addEventListener('click', onContinue);
    }
  }

  let silentDone = false;
  function onSilentContinue() {
    if (silentDone) return;
    silentDone = true;
    if (silentHint) silentHint.style.display = 'none';
    if (isSafari) {
      showSafariHint();
    } else {
      _safariHintActive = false;
    }
  }
  if (silentBtn) {
    silentBtn.addEventListener('touchstart', e => { e.preventDefault(); onSilentContinue(); }, { passive: false });
    silentBtn.addEventListener('click', onSilentContinue);
  }
})();

})();
