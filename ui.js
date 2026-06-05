(function () {
'use strict';

// Referencias al canvas y al elemento de vídeo
let mainCanvas, mainCtx, videoEl;

// Color de fondo actual y color objetivo (interpolados suavemente al cambiar de atmósfera).
// BG_LERP determina la velocidad de la interpolación: 0.018 ≈ ~2s de transición.
let _bgColor  = { r: 0,  g: 0,  b: 0   };
let _tgtColor = { r: 20, g: 80, b: 100 };
const BG_LERP = 0.018;

// ── Iconos de la paleta ───────────────────────────────────────────────────────
// SVGs precargados y rasterizados en offscreen canvases para uso sin lag.
// Las claves sin entrada (reverb, filter, waveforms) siguen usando fillText.
const _ICON_PATHS = {
  pad:      'svg/icons/icon_piano.svg',
  bass:     'svg/icons/icon_bass.svg',
  synth:    'svg/icons/icon_synth.svg',
  perc:     'svg/icons/icon_drum.svg',
  lead:     'svg/icons/icon_wave.svg',
  drive:    'svg/icons/icon_dist.svg',
  delay:    'svg/icons/icon_delay.svg',
  flutter:  'svg/icons/icon_trem.svg',
  clear:    'svg/icons/icon_mute.svg',
  clearFx:  'svg/icons/icon_mute.svg',
  hintMenu:     'svg/icons/icon_palette.svg',
  hintMenuLeft: 'svg/icons/left_palette.svg',
  hintRec:      'svg/icons/icon_record.svg',
  hintBpm:      'svg/icons/icon_tempo.svg',
};
const _icons = {};   // key → offscreen HTMLCanvasElement (rasterizado 64×64)

function _loadIcons() {
  const SIZE    = 64;
  const byPath  = {};   // evita crear dos canvases para el mismo archivo (mute compartido)
  Object.entries(_ICON_PATHS).forEach(([key, src]) => {
    if (byPath[src]) { _icons[key] = byPath[src]; return; }
    const oc  = document.createElement('canvas');
    oc.width  = SIZE; oc.height = SIZE;
    const img = new Image();
    img.onload = () => oc.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
    img.src    = src;
    byPath[src]  = oc;
    _icons[key]  = oc;
  });
}

// ── Inicialización ────────────────────────────────────────────────────────────

// Guarda las referencias al canvas y al vídeo, obtiene el contexto 2D.
function init(video, canvas) {
  videoEl    = video;
  mainCanvas = canvas;
  _loadIcons();
  mainCtx    = canvas.getContext('2d');
}

// Adapta el canvas al tamaño actual de la ventana. Se llama en inicio y en resize.
function resize() {
  mainCanvas.width  = window.innerWidth;
  mainCanvas.height = window.innerHeight;
}

// ── Renderizado principal ─────────────────────────────────────────────────────
// Se llama en cada frame del bucle de animación (~60fps) con el snapshot de estado.
// El orden de dibujo determina la superposición (z-order):
//   1. Vídeo espejado (fondo)
//   2. Tinte atmosférico (semitransparente encima del vídeo)
//   3. Divisor de secciones
//   4. Auras de capas activas
//   5. Destello del beat 1
//   6. Barra de bucle (arriba)
//   7. Nombre del acorde (cuando el pad está activo)
//   8. Slider de tempo / fader de volumen (si están activos)
//   9. Menús radiales de pinch
//  10. Cursores de mano
//  11. Barra de estado de capas (abajo)
function renderFrame(snapshot) {
  const W = mainCanvas.width;
  const H = mainCanvas.height;
  mainCtx.clearRect(0, 0, W, H);

  const {
    frameHands, hands, handY, handVelY,
    loopPos, loopSteps, recording, recordTarget, hasAnyLoop,
    editingLayer, layerModes, layerMuted, layerFxModes, layerVolumes,
    tempoSliderActive, tempoBPM,
    midPinchDwell, ringPinchDwell,
    chordName, handFxSlots,
    prerolling, prerollTarget, prerollProgress,
    volFaderActive, volFaderLayer,
  } = snapshot;

  // 1. Imagen de cámara espejada (scale(-1,1) invierte horizontalmente)
  mainCtx.save();
  mainCtx.scale(-1, 1);
  mainCtx.drawImage(videoEl, -W, 0, W, H);
  mainCtx.restore();

  // 2. Tinte de fondo de la atmósfera
  _drawBackground(W, H);

  // 3. Línea divisoria entre melodía (derecha) y ritmo (izquierda)
  _drawSectionDivider(W, H);

  // 4. Auras de capas activas
  _drawLayerAuras(W, H);

  // 5. Destello del beat 1
  const bp = Audio.getBeatPulse();
  if (bp > 0.01) _drawBeatPulse(W, H, bp);

  // 6. Barra de progreso del bucle (parte superior)
  _drawLoopBar(W, loopPos, loopSteps, recording, recordTarget, hasAnyLoop);

  // 7. Nombre del acorde (solo cuando el pad está activo)
  if (layerModes && layerModes.pad !== 'off' && chordName) {
    _drawChordName(W, H, chordName);
  }

  // 8. Sliders de tempo y volumen (se muestran en el centro de la pantalla)
  if (tempoSliderActive) {
    _drawTempoSlider(W, H, tempoBPM, frameHands);
  }
  if (volFaderActive && volFaderLayer) {
    _drawVolFader(W, H, volFaderLayer, layerVolumes, handY);
  }

  // 9. Menús radiales de pinch (paleta derecha + contexto izquierdo)
  _drawPinchMenus(W, H, hands);

  // 10. Cursores de mano (puntas, indicadores de gesto, glow, carril vertical)
  for (const h of frameHands) {
    _drawHandCursor(W, H, h, handY, handVelY, midPinchDwell, ringPinchDwell, handFxSlots);
  }

  // 11. Barra de chips de capas (parte inferior)
  _drawLayerBar(W, H, editingLayer, layerModes, layerMuted, recordTarget, layerFxModes, layerVolumes, prerollTarget, prerollProgress);
}

// ── Fondo atmosférico ─────────────────────────────────────────────────────────
// Interpola el color de fondo actual hacia el color objetivo de la atmósfera activa.
// El tinte es semitransparente (alpha=0.18) para que el vídeo de cámara siga visible.
function _drawBackground(W, H) {
  _bgColor.r += (_tgtColor.r - _bgColor.r) * BG_LERP;
  _bgColor.g += (_tgtColor.g - _bgColor.g) * BG_LERP;
  _bgColor.b += (_tgtColor.b - _bgColor.b) * BG_LERP;
  const { r, g, b } = _bgColor;
  mainCtx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.18)`;
  mainCtx.fillRect(0, 0, W, H);
}

// ── Divisor de secciones ──────────────────────────────────────────────────────
// Línea punteada vertical en el centro que separa visualmente los instrumentos
// melódicos (pad/synth/lead, lado derecho) de los rítmicos (bass/perc, lado izquierdo).
function _drawSectionDivider(W, H) {
  mainCtx.save();
  mainCtx.setLineDash([4, 14]);
  mainCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  mainCtx.lineWidth   = 1;
  mainCtx.beginPath();
  mainCtx.moveTo(W / 2, 48);
  mainCtx.lineTo(W / 2, H - 60);
  mainCtx.stroke();
  mainCtx.setLineDash([]);
  mainCtx.restore();
}

// ── Auras de secciones activas ────────────────────────────────────────────────
// Gradiente azul suave en la mitad derecha cuando hay capas melódicas activas.
// Gradiente morado suave en la mitad izquierda cuando hay capas rítmicas activas.
// Estas auras dan una señal visual de qué sección está "viva" sin ser intrusivas.
function _drawLayerAuras(W, H) {
  const active = Layers.activeLayers();
  const melody = active.filter(l => l.type.section === 'melody');
  const rhythm = active.filter(l => l.type.section === 'rhythm');
  if (melody.length) {
    const g = mainCtx.createLinearGradient(W, 0, W * 0.55, 0);
    g.addColorStop(0, 'rgba(80,160,255,0.05)');
    g.addColorStop(1, 'rgba(80,160,255,0)');
    mainCtx.fillStyle = g;
    mainCtx.fillRect(0, 0, W, H);
  }
  if (rhythm.length) {
    const g = mainCtx.createLinearGradient(0, 0, W * 0.45, 0);
    g.addColorStop(0, 'rgba(180,80,255,0.05)');
    g.addColorStop(1, 'rgba(180,80,255,0)');
    mainCtx.fillStyle = g;
    mainCtx.fillRect(0, 0, W, H);
  }
}

// ── Destello del beat 1 ───────────────────────────────────────────────────────
// Un flash radial semitransparente que se expande desde el centro en el tiempo 1.
// El valor 'pulse' (0–1) viene de audio.js y se decae en renderLoop con decayBeatPulse().
// El radio del gradiente crece ligeramente en el momento del beat (factor 1+pulse*0.14)
// para dar una sensación de "explosión" que vuelve a su tamaño en el decay.
function _drawBeatPulse(W, H, pulse) {
  const cx = W / 2, cy = H / 2;
  const r  = Math.min(W, H) * 0.44 * (1 + (1 - pulse) * 0.14);
  const g  = mainCtx.createRadialGradient(cx, cy, r * 0.86, cx, cy, r);
  g.addColorStop(0,   'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${pulse * 0.022})`);
  g.addColorStop(1,   'rgba(255,255,255,0)');
  mainCtx.fillStyle = g;
  mainCtx.beginPath();
  mainCtx.arc(cx, cy, r, 0, Math.PI * 2);
  mainCtx.fill();
}

// ── Barra de progreso del bucle ───────────────────────────────────────────────
// Una barra horizontal en la parte superior de la pantalla que muestra:
// - El progreso del bucle actual (0 a 1 barra), con el punto de reproducción.
// - Verde con "▶ LOOP" cuando hay un bucle reproduciéndose.
// - Rojo pulsante con "● REC CAPA" cuando se está grabando.
// - Se oculta (sin dibujar relleno) si no hay ningún bucle ni grabación activa.
// Las marcas verticales indican los tiempos del compás (cada 8 pasos = 1 barra).
const LOOP_BAR_H  = 9;    // altura de la barra en px
const LOOP_BAR_Y  = 12;   // distancia al borde superior en px
const LOOP_BAR_PX = 16;   // margen horizontal en px

function _drawLoopBar(W, loopPos, loopSteps, recording, recordTarget, hasAnyLoop) {
  const barW = W - LOOP_BAR_PX * 2;
  const x    = LOOP_BAR_PX;
  const y    = LOOP_BAR_Y;
  const fill = (loopPos / loopSteps) * barW;  // anchura del relleno según la posición
  const now  = performance.now();

  mainCtx.save();

  // Sombra cartoon
  mainCtx.globalAlpha = 0.28;
  mainCtx.fillStyle   = '#000';
  _roundRect(x + 2, y + 3, barW, LOOP_BAR_H, 3);
  mainCtx.fill();
  mainCtx.globalAlpha = 1;

  // Pista de fondo (siempre visible) con outline negro cartoon
  mainCtx.fillStyle = 'rgba(30,30,40,0.72)';
  _roundRect(x, y, barW, LOOP_BAR_H, 3);
  mainCtx.fill();
  mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
  mainCtx.lineWidth   = 2;
  _roundRect(x, y, barW, LOOP_BAR_H, 3);
  mainCtx.stroke();

  // Marcas de tiempo (una por cada 8 pasos = cada negra)
  for (let i = 0; i < loopSteps; i += 8) {
    const mx = x + (i / loopSteps) * barW;
    mainCtx.fillStyle = 'rgba(255,255,255,0.10)';
    mainCtx.fillRect(mx, y, 1, LOOP_BAR_H);
  }

  // Si no hay bucle ni grabación activa, solo se muestra la pista vacía
  if (!hasAnyLoop && !recording) {
    mainCtx.restore();
    return;
  }

  // Relleno de progreso: rojo pulsante si grabando, verde si reproduciendo
  let fillColor;
  if (recording) {
    const alpha = 0.65 + Math.sin(now * 0.006) * 0.25;   // pulsación ~0.9 Hz
    fillColor   = `rgba(255,60,60,${alpha})`;
  } else {
    fillColor = 'rgba(60,200,120,0.70)';
  }
  mainCtx.fillStyle = fillColor;
  _roundRect(x, y, Math.max(4, fill), LOOP_BAR_H, 2);
  mainCtx.fill();

  // Punto de reproducción (cabezal)
  const headX = x + fill;
  mainCtx.fillStyle = recording ? 'rgba(255,120,120,1)' : 'rgba(120,255,180,1)';
  mainCtx.beginPath();
  mainCtx.arc(headX, y + LOOP_BAR_H / 2, 5, 0, Math.PI * 2);
  mainCtx.fill();

  // Etiqueta de estado a la derecha de la barra
  let labelText;
  if (recording && recordTarget) {
    const layerName = Layers.TYPES[recordTarget]?.name?.toUpperCase() ?? recordTarget.toUpperCase();
    labelText = `● REC ${layerName}`;
  } else {
    labelText = '▶ LOOP';
  }
  mainCtx.fillStyle    = recording ? 'rgba(255,100,100,0.85)' : 'rgba(80,220,140,0.65)';
  mainCtx.font         = 'bold 8px Montserrat, sans-serif';
  mainCtx.textAlign    = 'right';
  mainCtx.textBaseline = 'middle';
  mainCtx.fillText(labelText, W - LOOP_BAR_PX, y + LOOP_BAR_H / 2);

  mainCtx.restore();
}

// ── Nombre del acorde ─────────────────────────────────────────────────────────
// Muestra el grado del acorde actual (I, II... VII) en grande y semitransparente
// en el lado melódico de la pantalla. Ayuda a entender la armonía en directo.
function _drawChordName(W, H, chordName) {
  mainCtx.save();
  mainCtx.fillStyle    = 'rgba(70,130,255,0.40)';
  mainCtx.font         = `bold ${Math.round(H * 0.12)}px Montserrat, sans-serif`;
  mainCtx.textAlign    = 'center';
  mainCtx.textBaseline = 'middle';
  mainCtx.fillText(chordName, W * 0.75, H / 2);
  mainCtx.restore();
}

// ── Slider de tempo ───────────────────────────────────────────────────────────
// Se muestra en el centro de la pantalla mientras el slider de anular+pulgar está activo.
// Una línea vertical con un thumb (punto + línea horizontal) indica el BPM actual.
// El badge con el BPM numérico flota encima del thumb para lectura instantánea.
function _drawTempoSlider(W, H, bpm, frameHands) {
  mainCtx.save();
  const sliderH  = H * 0.6;
  const sliderX  = W / 2;
  const sliderY0 = H / 2 - sliderH / 2;
  const sliderY1 = H / 2 + sliderH / 2;

  // Pista vertical
  mainCtx.strokeStyle = 'rgba(255,210,80,0.22)';
  mainCtx.lineWidth   = 3;
  mainCtx.lineCap     = 'round';
  mainCtx.beginPath();
  mainCtx.moveTo(sliderX, sliderY0);
  mainCtx.lineTo(sliderX, sliderY1);
  mainCtx.stroke();

  // Thumb: posición calculada del BPM en el rango 50–180
  const normBPM = (bpm - 50) / 130;
  const thumbY  = sliderY1 - normBPM * sliderH;
  mainCtx.strokeStyle = 'rgba(255,210,80,0.90)';
  mainCtx.lineWidth   = 2.5;
  mainCtx.beginPath();
  mainCtx.moveTo(sliderX - 18, thumbY);
  mainCtx.lineTo(sliderX + 18, thumbY);
  mainCtx.stroke();

  mainCtx.fillStyle = 'rgba(255,220,80,0.90)';
  mainCtx.beginPath();
  mainCtx.arc(sliderX, thumbY, 6, 0, Math.PI * 2);
  mainCtx.fill();

  // Badge con el BPM numérico, posicionado encima del thumb
  const badgeW = 90, badgeH = 26;
  const bx     = sliderX - badgeW / 2;
  const by     = thumbY - 36;
  mainCtx.fillStyle   = 'rgba(220,170,50,0.18)';
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.fill();
  mainCtx.strokeStyle = 'rgba(220,170,50,0.75)';
  mainCtx.lineWidth   = 1;
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.stroke();
  mainCtx.fillStyle    = 'rgba(255,255,255,0.92)';
  mainCtx.font         = 'bold 11px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center';
  mainCtx.textBaseline = 'middle';
  mainCtx.fillText(`${bpm} BPM`, sliderX, by + badgeH / 2);

  mainCtx.restore();
}

// ── Fader de volumen ──────────────────────────────────────────────────────────
// Se muestra en el centro de la pantalla cuando el usuario activa el modo fader
// de volumen (botón VOL del submenú). La mano derecha controla el volumen.
// Incluye: pista vertical, relleno desde el fondo hasta el thumb,
// marca de unity (0 dB = vol 1.0) y badge con el nombre de la capa + porcentaje.
function _drawVolFader(W, H, layerKey, layerVolumes, handY) {
  const type = Layers.TYPES[layerKey];
  if (!type) return;
  const { r, g, b } = type.color;
  const vol   = Math.max(0, Math.min(1.2, layerVolumes?.[layerKey] ?? 1));
  const normV = vol / 1.2;   // normalizado a 0–1 para la posición del thumb

  mainCtx.save();
  const sliderH  = H * 0.60;
  const sliderX  = W / 2;
  const sliderY0 = H / 2 - sliderH / 2;
  const sliderY1 = H / 2 + sliderH / 2;

  // Pista de fondo
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.22)`;
  mainCtx.lineWidth   = 3;
  mainCtx.lineCap     = 'round';
  mainCtx.beginPath(); mainCtx.moveTo(sliderX, sliderY0); mainCtx.lineTo(sliderX, sliderY1); mainCtx.stroke();

  // Relleno desde el fondo hasta el thumb
  const thumbY = sliderY1 - normV * sliderH;
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
  mainCtx.lineWidth   = 3;
  mainCtx.beginPath(); mainCtx.moveTo(sliderX, sliderY1); mainCtx.lineTo(sliderX, thumbY); mainCtx.stroke();

  // Marca de unity (vol=1.0 = 100%), posicionada al 83% del rango (1.0/1.2)
  const unityY = sliderY1 - (1.0 / 1.2) * sliderH;
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.50)`;
  mainCtx.lineWidth   = 1;
  mainCtx.beginPath(); mainCtx.moveTo(sliderX - 12, unityY); mainCtx.lineTo(sliderX + 12, unityY); mainCtx.stroke();

  // Thumb (línea + punto)
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.90)`;
  mainCtx.lineWidth   = 2.5;
  mainCtx.beginPath(); mainCtx.moveTo(sliderX - 18, thumbY); mainCtx.lineTo(sliderX + 18, thumbY); mainCtx.stroke();
  mainCtx.fillStyle = `rgba(${r},${g},${b},0.90)`;
  mainCtx.beginPath(); mainCtx.arc(sliderX, thumbY, 6, 0, Math.PI * 2); mainCtx.fill();

  // Badge con nombre de capa y porcentaje
  const pct     = Math.round(vol * 100);
  const badgeW  = 100, badgeH = 26;
  const bx      = sliderX - badgeW / 2;
  const by      = Math.max(sliderY0 + 4, thumbY - 36);
  mainCtx.fillStyle   = `rgba(${r},${g},${b},0.18)`;
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.fill();
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
  mainCtx.lineWidth   = 1;
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.stroke();
  mainCtx.fillStyle    = 'rgba(255,255,255,0.92)';
  mainCtx.font         = 'bold 11px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
  mainCtx.fillText(`${type.name.toUpperCase()}  ${pct}%`, sliderX, by + badgeH / 2);

  // Instrucción al pie del slider
  mainCtx.fillStyle    = `rgba(${r},${g},${b},0.45)`;
  mainCtx.font         = '9px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'top';
  mainCtx.fillText('move hand ↕  ·  pinch to confirm', sliderX, sliderY1 + 8);

  mainCtx.restore();
}

// ── Menús radiales de pinch ───────────────────────────────────────────────────
// Dibuja el menú de la mano derecha (paleta de capas) y el de la mano izquierda
// (opciones de FX o formas de onda). El estado de cada menú viene del snapshot.
// Mientras se acumula el dwell, se muestra un arco de progreso (no el menú completo).

const MENU_RADIUS_PX = 135;   // radio del círculo de elementos
const MENU_ITEM_R    = 36;    // radio de cada botón circular

// Geometría del submenú (debe coincidir con las constantes de main.js)
const SUB_RADIUS = 70;                    // px del centro del ítem a cada botón del submenú
const SUB_ARC    = 52 * Math.PI / 180;   // 52° de separación angular
const SUB_BTN_R  = 15;                   // radio de cada botón del submenú

function _drawPinchMenus(W, H, menuHands) {
  for (const menu of menuHands) {
    if (!menu.origin && menu.dwell <= 0) continue;

    const isRight   = menu.label === 'Right';
    // Colores distintos por mano: derecha=azul/lila, izquierda=verde/teal
    const colorStr  = isRight ? '200,130,255' : '70,210,145';
    const menuItems = menu.items || [];

    // Arco de dwell (pre-apertura): muestra el progreso mientras se acumula el pinch
    if (!menu.open && menu.dwell > 0 && menu.preOrigin) {
      const ox  = menu.preOrigin.x * W;
      const oy  = menu.preOrigin.y * H;
      const end = -Math.PI / 2 + menu.dwell * Math.PI * 2;
      mainCtx.save();
      mainCtx.lineWidth   = 3; mainCtx.lineCap = 'round';
      mainCtx.strokeStyle = `rgba(${colorStr},0.14)`;
      mainCtx.beginPath(); mainCtx.arc(ox, oy, 22, 0, Math.PI * 2); mainCtx.stroke();
      mainCtx.strokeStyle = `rgba(${colorStr},0.88)`;
      mainCtx.beginPath(); mainCtx.arc(ox, oy, 22, -Math.PI / 2, end); mainCtx.stroke();
      mainCtx.restore();
      continue;
    }

    if (!menu.open || !menu.origin || menuItems.length === 0) continue;

    const ox = menu.origin.x * W;
    const oy = menu.origin.y * H;
    const n  = menuItems.length;

    mainCtx.save();

    // Disco de fondo semiopaco para mejorar la legibilidad
    // Disco de fondo del menú — estilo cartoon
    const bgR = MENU_RADIUS_PX + MENU_ITEM_R + 14;
    // Sombra
    mainCtx.save();
    mainCtx.globalAlpha = 0.25;
    mainCtx.fillStyle   = '#000';
    mainCtx.beginPath(); mainCtx.arc(ox + 4, oy + 5, bgR, 0, Math.PI * 2); mainCtx.fill();
    mainCtx.restore();
    // Outline
    mainCtx.strokeStyle = 'rgba(0,0,0,0.65)';
    mainCtx.lineWidth   = 4;
    mainCtx.beginPath(); mainCtx.arc(ox, oy, bgR, 0, Math.PI * 2); mainCtx.stroke();
    // Fill
    mainCtx.fillStyle = 'rgba(15,15,25,0.78)';
    mainCtx.beginPath(); mainCtx.arc(ox, oy, bgR, 0, Math.PI * 2); mainCtx.fill();

    // Etiqueta central del menú izquierdo: EFECTOS o SONIDO según el modo
    if (!isRight) {
      const ctxLabel = (menuItems === Audio.FX_OPTIONS || Audio.FX_OPTIONS.includes(menuItems[0]))
        ? 'EFECTOS'
        : 'SONIDO';
      mainCtx.fillStyle    = `rgba(${colorStr},0.35)`;
      mainCtx.font         = 'bold 8px Montserrat, sans-serif';
      mainCtx.textAlign    = 'center';
      mainCtx.textBaseline = 'middle';
      mainCtx.fillText(ctxLabel, ox, oy);
    }

    for (let i = 0; i < n; i++) {
      const key   = menuItems[i];
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;  // distribuye 360° equitativamente
      const ix    = ox + MENU_RADIUS_PX * Math.cos(angle);
      const iy    = oy + MENU_RADIUS_PX * Math.sin(angle);
      const hov   = menu.hover === key;
      const itemR = MENU_ITEM_R;

      // Determinar tipo de elemento y sus propiedades visuales
      let cr, cg, cb, label;
      let active = false, editing = false, fxHand = null;

      if (key === 'clear') {
        // Botón CLR: desactivar todo
        cr = 255; cg = 55; cb = 55; label = 'CLR';
      } else if (key === 'clearFx') {
        // Botón ✕ FX: limpiar efectos (menú izquierdo en modo FX)
        cr = 255; cg = 80; cb = 30; label = '✕ FX';
      } else if (Layers.TYPES[key]) {
        // Instrumento de la paleta derecha
        const td = Layers.TYPES[key];
        cr = td.color.r; cg = td.color.g; cb = td.color.b;
        label   = td.name.toUpperCase();
        const mode = Audio.getLayerMode(key) || 'off';
        active  = mode !== 'off';
        editing = mode === 'editing';
      } else if (Audio.FX_COLORS && Audio.FX_COLORS[key]) {
        // Efecto FX del menú izquierdo
        [cr, cg, cb] = Audio.FX_COLORS[key];
        label = Audio.FX_LABELS[key] || key.toUpperCase();
        // Resaltar si este FX está asignado a un slot; anotar qué mano (R/L)
        if (menu.fxSlots) {
          const onR = menu.fxSlots.right === key;
          const onL = menu.fxSlots.left  === key;
          active  = onR || onL;
          fxHand  = onR ? 'R' : (onL ? 'L' : null);
        }
      } else {
        // Forma de onda del menú izquierdo en modo play/edit
        cr = 160; cg = 180; cb = 220;
        label = key.slice(0, 3).toUpperCase();
        active = menu.currentWaveform === key;  // resaltar la forma activa
      }

      // Opacidad del cuerpo según estado (editing > active > hover > inactive)
      // bodyA: opacidad del cuerpo del botón según su estado.
      // editing → máxima presencia (está siendo controlado ahora mismo).
      // active pero no editing → looping: visible pero no tan prominente.
      // hover en cualquier estado → sube la opacidad para dar feedback al usuario.
      // inactivo sin hover → muy tenue, solo sugiere que existe la opción.
      const bodyA = editing
        ? (hov ? 1.0 : 0.85)
        : active
          ? (hov ? 1.0 : 0.55)
          : (hov ? 0.55 : 0.25);

      // Línea de conexión desde el centro del menú al ítem
      mainCtx.strokeStyle = 'rgba(255,255,255,0.07)';
      mainCtx.lineWidth   = 1;
      mainCtx.beginPath(); mainCtx.moveTo(ox, oy); mainCtx.lineTo(ix, iy); mainCtx.stroke();

      // Sin círculo de fondo — solo icono flotante
      mainCtx.save();
      mainCtx.restore();

      // Anillo de estado cartoon: outline negro + color encima
      if (active) {
        const ringR = itemR + 6;
        // Outline negro
        mainCtx.strokeStyle = `rgba(0,0,0,${editing ? 0.85 : 0.50})`;
        mainCtx.lineWidth   = editing ? 5 : 4;
        mainCtx.setLineDash([]);
        mainCtx.beginPath(); mainCtx.arc(ix, iy, ringR, 0, Math.PI * 2); mainCtx.stroke();
        // Color por encima
        mainCtx.strokeStyle = editing
          ? 'rgba(255,255,255,0.92)'
          : `rgba(${cr},${cg},${cb},0.85)`;
        mainCtx.lineWidth   = editing ? 2.5 : 2;
        if (!editing) mainCtx.setLineDash([4, 4]);
        mainCtx.beginPath(); mainCtx.arc(ix, iy, ringR, 0, Math.PI * 2); mainCtx.stroke();
        mainCtx.setLineDash([]);
      }

      // Hover: anillo blanco fino adicional
      if (hov) {
        mainCtx.strokeStyle = 'rgba(255,255,255,0.70)';
        mainCtx.lineWidth   = 1.5;
        mainCtx.beginPath(); mainCtx.arc(ix, iy, itemR + 1.5, 0, Math.PI * 2); mainCtx.stroke();
      }

      // Icono o texto label
      const labelOffY = (!isRight && fxHand) ? -3 : 0;
      const iconCanvas = _icons[key];
      if (iconCanvas) {
        // Icono SVG prerasterizado, tamaño grande sin círculo de fondo
        const iSz = itemR * 1.80;
        mainCtx.save();
        mainCtx.globalAlpha = 1.0;
        mainCtx.drawImage(iconCanvas, ix - iSz / 2, iy - iSz / 2, iSz, iSz);
        mainCtx.restore();
      } else {
        // Fallback texto para claves sin icono (reverb, filter, waveforms)
        mainCtx.fillStyle    = `rgba(255,255,255,${active ? 0.95 : (hov ? 0.90 : 0.60)})`;
        mainCtx.font         = `${hov ? 'bold ' : ''}${hov ? 9 : 7}px Montserrat, sans-serif`;
        mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
        mainCtx.fillText(label, ix, iy + labelOffY);
      }

      // Badge L/R para efectos FX asignados (indica qué mano controla ese efecto)
      if (!isRight && fxHand) {
        const badgeColor = fxHand === 'R' ? '160,200,255' : '200,130,255';
        mainCtx.fillStyle    = `rgba(${badgeColor},0.95)`;
        mainCtx.font         = `bold 6px Montserrat, sans-serif`;
        mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
        mainCtx.fillText(fxHand, ix, iy + 7);
      }

      // Punto indicador de FX activo (pequeño círculo cian en la esquina del instrumento)
      if (isRight && Layers.TYPES[key] && Audio.getLayerFxMode(key)) {
        mainCtx.fillStyle = 'rgba(100,210,255,0.90)';
        mainCtx.beginPath(); mainCtx.arc(ix + itemR * 0.55, iy - itemR * 0.55, 4, 0, Math.PI * 2); mainCtx.fill();
      }

      // Submenú (solo paleta derecha, sobre un instrumento en hover)
      if (isRight && hov && Layers.TYPES[key]) {
        _drawSubMenu(ix, iy, angle, menu.subHover, Audio.hasLayerLoop(key));
      }
    }

    // Punto central del menú
    mainCtx.fillStyle = `rgba(${colorStr},0.45)`;
    mainCtx.beginPath(); mainCtx.arc(ox, oy, 5, 0, Math.PI * 2); mainCtx.fill();

    mainCtx.restore();
  }
}

// ── Submenú de un instrumento ─────────────────────────────────────────────────
// Tres botones en abanico a igual radio alrededor del instrumento:
//   ✕ (izquierda del arco) | VOL (centro, recto hacia fuera) | ⊕FX (derecha del arco)
// VOL y ⊕FX se muestran bloqueados (grises, con candado) si la capa no tiene bucle grabado.
function _drawSubMenu(ix, iy, angle, subHover, hasLoop) {
  // Helper interno para dibujar cada botón circular del submenú
  function _drawSubBtn(bx, by, rFill, gFill, bFill, label, hov, fontSize) {
    // Sombra cartoon
    mainCtx.save();
    mainCtx.globalAlpha = 0.30;
    mainCtx.fillStyle   = '#000';
    mainCtx.beginPath(); mainCtx.arc(bx + 2, by + 3, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();
    mainCtx.restore();

    // Fill de color plano
    mainCtx.fillStyle = `rgba(${rFill},${gFill},${bFill},${hov ? 0.95 : 0.75})`;
    mainCtx.beginPath(); mainCtx.arc(bx, by, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();

    // Outline negro
    mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
    mainCtx.lineWidth   = 3;
    mainCtx.beginPath(); mainCtx.arc(bx, by, SUB_BTN_R, 0, Math.PI * 2); mainCtx.stroke();

    // Highlight top-left
    mainCtx.save();
    mainCtx.globalAlpha  = hov ? 0.45 : 0.28;
    mainCtx.strokeStyle  = 'rgba(255,255,255,0.85)';
    mainCtx.lineWidth    = 1.5;
    mainCtx.beginPath();
    mainCtx.arc(bx, by, SUB_BTN_R * 0.62, Math.PI * 1.05, Math.PI * 1.72);
    mainCtx.stroke();
    mainCtx.restore();

    // Anillo hover
    if (hov) {
      mainCtx.strokeStyle = 'rgba(255,255,255,0.70)';
      mainCtx.lineWidth   = 1.5;
      mainCtx.beginPath(); mainCtx.arc(bx, by, SUB_BTN_R + 4, 0, Math.PI * 2); mainCtx.stroke();
    }

    mainCtx.fillStyle    = `rgba(255,255,255,${hov ? 1.0 : 0.90})`;
    mainCtx.font         = `${fontSize}px Montserrat, sans-serif`;
    mainCtx.textAlign    = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillText(label, bx, by);
  }

  // ✕ — desactivar la capa (siempre disponible, en rojo)
  const muteX   = ix + SUB_RADIUS * Math.cos(angle - SUB_ARC);
  const muteY   = iy + SUB_RADIUS * Math.sin(angle - SUB_ARC);
  const muteHov = subHover === 'mute';
  _drawSubBtn(muteX, muteY, 255, 60, 60, '✕', muteHov, 10);

  // VOL — fader de volumen (solo activo si hay bucle; si no, gris con candado)
  const volX   = ix + SUB_RADIUS * Math.cos(angle);
  const volY   = iy + SUB_RADIUS * Math.sin(angle);
  const volHov = subHover === 'vol';
  if (hasLoop) {
    _drawSubBtn(volX, volY, 255, 210, 80, 'VOL', volHov, 8);
  } else {
    _drawSubBtn(volX, volY, 100, 100, 100, 'VOL', false, 8);
    mainCtx.fillStyle = 'rgba(160,160,160,0.50)';
    mainCtx.font      = '6px Montserrat, sans-serif';
    mainCtx.textAlign = 'center'; mainCtx.textBaseline = 'top';
    mainCtx.fillText('🔒', volX, volY + SUB_BTN_R + 2);
  }

  // ⊕ FX — activar modo efectos (solo activo si hay bucle grabado en la capa)
  const fxX   = ix + SUB_RADIUS * Math.cos(angle + SUB_ARC);  // a +SUB_ARC del centro
  const fxY   = iy + SUB_RADIUS * Math.sin(angle + SUB_ARC);
  const fxHov = subHover === 'fx';
  // fxA: multiplicador de opacidad. Sin bucle → 0.25 (aspecto bloqueado/fantasma).
  // Con bucle → 1.0 (aspecto normal, activo).
  // Multiplicar todos los alphas por fxA hace el botón transparente sin condicionales extra.
  const fxA   = hasLoop ? 1.0 : 0.25;

  // Botón FX con estilo cartoon (cian), opacidad reducida si no hay bucle
  mainCtx.save();
  mainCtx.globalAlpha = fxA;

  // Sombra
  mainCtx.save();
  mainCtx.globalAlpha = 0.30 * fxA;
  mainCtx.fillStyle   = '#000';
  mainCtx.beginPath(); mainCtx.arc(fxX + 2, fxY + 3, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();
  mainCtx.restore();

  // Fill cian
  mainCtx.fillStyle = `rgba(80,200,255,${fxHov ? 0.95 : 0.75})`;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();

  // Outline negro
  mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
  mainCtx.lineWidth   = 3;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R, 0, Math.PI * 2); mainCtx.stroke();

  // Highlight
  mainCtx.save();
  mainCtx.globalAlpha = fxHov ? 0.45 : 0.28;
  mainCtx.strokeStyle = 'rgba(255,255,255,0.85)';
  mainCtx.lineWidth   = 1.5;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R * 0.62, Math.PI * 1.05, Math.PI * 1.72); mainCtx.stroke();
  mainCtx.restore();

  if (fxHov) {
    mainCtx.strokeStyle = 'rgba(255,255,255,0.70)';
    mainCtx.lineWidth   = 1.5;
    mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R + 4, 0, Math.PI * 2); mainCtx.stroke();
  }

  mainCtx.fillStyle    = `rgba(255,255,255,${fxHov ? 1.0 : 0.90})`;
  mainCtx.font         = '7px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
  mainCtx.fillText(hasLoop ? '⊕ FX' : '○ FX', fxX, fxY);

  mainCtx.restore();
}

// ── Cursor de mano ────────────────────────────────────────────────────────────
// Dibuja toda la representación visual de una mano:
// - Puntos de punta de dedo (con indicadores de gesto: MENU/REC/BPM)
// - Círculo de pinch (índice+pulgar) cuando supera el umbral
// - Glow reactivo al movimiento (más intenso cuanto más rápida la mano)
// - Carril vertical con thumb que indica la posición Y actual de la palma
// - Arcos de dwell para corazón (REC, verde) y anular (BPM, dorado)
// - Badge del efecto FX activo (cuando la mano controla un efecto)
function _drawHandCursor(W, H, hand, handY, handVelY, midPinchDwell, ringPinchDwell, handFxSlots) {
  const isRight  = hand.label === 'Right';
  // Azul para la mano derecha, morado para la izquierda
  const colorStr = isRight ? '160,200,255' : '200,130,255';
  const pcx      = (1 - hand.center.x) * W;   // espejado horizontalmente
  const pcy      = hand.center.y * H;
  const vel      = handVelY[hand.label];

  mainCtx.save();

  // Umbrales para suprimir los indicadores de dedo cuando el pinch está activo.
  // Evitan que el círculo del dedo y el círculo del pinch se solapen.
  const PINCH_SHOW  = 0.50;   // umbral para mostrar el círculo de índice+pulgar
  const MIDDLE_SHOW = 0.30;   // umbral para mostrar el punto de corazón+pulgar
  const RING_SHOW   = 0.30;   // umbral para mostrar el punto de anular+pulgar

  // Pre-calcular dwells para usarlos en la supresión de indicadores
  const md = midPinchDwell[hand.label];
  const rd = ringPinchDwell[hand.label];
  const menuActive = hand.pinch.strength > PINCH_SHOW;
  const anySelection = md > 0 || rd > 0 || menuActive;

  // Puntas de dedo con indicadores de gesto
  // j=0 pulgar | j=1 índice | j=2 corazón | j=3 anular | j=4 meñique
  // Mientras hay una selección activa, solo se muestra el indicador del dedo relevante.
  if (hand.fingertips) {
    const now = performance.now();
    for (let j = 0; j < hand.fingertips.length; j++) {
      const tip = hand.fingertips[j];
      const tx  = (1 - tip.x) * W;
      const ty  = tip.y * H;

      // ¿Está este dedo realizando un pinch ahora mismo?
      const isPinching = (j === 1 && hand.pinch.strength       > PINCH_SHOW)
                      || (j === 2 && hand.middlePinch.strength > MIDDLE_SHOW)
                      || (j === 3 && hand.ringPinch.strength   > RING_SHOW);

      // Punto pequeño de punta: ocultar durante cualquier selección activa
      if (!isPinching && j !== 1 && !anySelection) {
        mainCtx.fillStyle = `rgba(${colorStr},0.28)`;
        mainCtx.beginPath(); mainCtx.arc(tx, ty, 3.5, 0, Math.PI * 2); mainCtx.fill();
      }

      const isMenuFinger = j === 1;              // índice — MENU, ambas manos
      const isRecFinger  = j === 2 && isRight;   // corazón — REC, solo derecha
      const isBpmFinger  = j === 3 && isRight;   // anular — BPM, solo derecha

      // Qué dedo es relevante según la selección activa
      const isRelevant = md > 0 ? isRecFinger
                       : rd > 0 ? isBpmFinger
                       : menuActive ? isMenuFinger
                       : true;

      // Icono pulsante: solo mostrar si no hay otra selección activa en otro dedo
      if ((isMenuFinger || isRecFinger || isBpmFinger) && !isPinching && isRelevant) {
        const hintIconKey = isRecFinger ? 'hintRec'
                          : isBpmFinger ? 'hintBpm'
                          : isRight     ? 'hintMenu'
                          :               'hintMenuLeft';
        const hintIcon = _icons[hintIconKey];

        // Pulso lento (~0.6 Hz) con offset por dedo para que no se sincronicen
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.0038 + j * 1.3);

        if (hintIcon) {
          const iSz = 38;
          mainCtx.save();
          mainCtx.globalAlpha = 0.40 + pulse * 0.50;
          mainCtx.drawImage(hintIcon, tx - iSz / 2, ty - iSz / 2, iSz, iSz);
          mainCtx.restore();
        }
      }
    }
  }

  // Círculo del pinch de índice+pulgar
  // Solo visible cuando supera PINCH_SHOW (50%). Crece con la fuerza.
  // Cuando está completamente cerrado (hand.pinch.pinching=true) añade anillo exterior.
  if (hand.pinch.strength > PINCH_SHOW) {
    const ppx  = (1 - hand.pinch.point.x) * W;
    const ppy  = hand.pinch.point.y * H;
    const s    = Math.max(0, (hand.pinch.strength - PINCH_SHOW) / (1 - PINCH_SHOW));
    const dotR = 4 + s * 5;
    mainCtx.fillStyle = `rgba(${colorStr},${0.30 + s * 0.55})`;
    mainCtx.beginPath(); mainCtx.arc(ppx, ppy, dotR, 0, Math.PI * 2); mainCtx.fill();
    if (hand.pinch.pinching) {
      mainCtx.strokeStyle = `rgba(${colorStr},0.70)`;
      mainCtx.lineWidth   = 1.5;
      mainCtx.beginPath(); mainCtx.arc(ppx, ppy, dotR + 6, 0, Math.PI * 2); mainCtx.stroke();
    }
  }

  // Glow de palma: gradiente radial centrado en la palma que crece con la velocidad.
  // vel viene de handVelY (velocidad suavizada). vel×30 convierte a un rango 0–1 útil.
  // glowR: radio del gradiente (30px base + hasta 25px extra con velocidad máxima).
  // glowA: alpha del centro del gradiente (0.06 base + hasta 0.18 extra).
  // createRadialGradient(x,y,r_inner, x,y,r_outer): el gradiente va de r_inner a r_outer.
  // r_inner=0: el centro del glow es sólido; la opacidad baja a 0 en r_outer.
  const velGlow  = Math.min(1, vel * 30);
  const glowR    = 30 + velGlow * 25;
  const glowA    = 0.06 + velGlow * 0.18;
  const glow     = mainCtx.createRadialGradient(pcx, pcy, 0, pcx, pcy, glowR);
  glow.addColorStop(0, `rgba(${colorStr},${glowA})`);
  glow.addColorStop(1, `rgba(${colorStr},0)`);
  mainCtx.fillStyle = glow;
  mainCtx.beginPath(); mainCtx.arc(pcx, pcy, glowR, 0, Math.PI * 2); mainCtx.fill();


  // Punto de aproximación del pinch corazón+pulgar (REC, verde)
  // Aparece gradualmente al acercar los dedos, antes de que empiece el dwell.
  if (hand.middlePinch.strength > MIDDLE_SHOW) {
    const mpx = (1 - hand.middlePinch.point.x) * W;
    const mpy = hand.middlePinch.point.y * H;
    const ms  = Math.max(0, (hand.middlePinch.strength - MIDDLE_SHOW) / (1 - MIDDLE_SHOW));
    mainCtx.fillStyle = `rgba(255,60,60,${0.25 + ms * 0.50})`;
    mainCtx.beginPath(); mainCtx.arc(mpx, mpy, 3 + ms * 4, 0, Math.PI * 2); mainCtx.fill();
  }
  // Arco de dwell del corazón (REC): barre 360° mientras se acumula el dwell
  if (md > 0) {
    const mpx      = (1 - hand.middlePinch.point.x) * W;
    const mpy      = hand.middlePinch.point.y * H;
    const endAngle = -Math.PI / 2 + md * Math.PI * 2;
    mainCtx.strokeStyle = 'rgba(255,60,60,0.75)';
    mainCtx.lineWidth   = 3;
    mainCtx.lineCap     = 'round';
    mainCtx.beginPath(); mainCtx.arc(mpx, mpy, 22, -Math.PI / 2, endAngle); mainCtx.stroke();
    mainCtx.fillStyle    = 'rgba(255,60,60,0.45)';
    mainCtx.font         = '6px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText('REC', mpx, mpy + 30);
  }

  // Punto de aproximación del pinch anular+pulgar (BPM, dorado)
  if (hand.ringPinch.strength > RING_SHOW) {
    const rpx = (1 - hand.ringPinch.point.x) * W;
    const rpy = hand.ringPinch.point.y * H;
    const rs  = Math.max(0, (hand.ringPinch.strength - RING_SHOW) / (1 - RING_SHOW));
    mainCtx.fillStyle = `rgba(255,210,80,${0.25 + rs * 0.50})`;
    mainCtx.beginPath(); mainCtx.arc(rpx, rpy, 3 + rs * 4, 0, Math.PI * 2); mainCtx.fill();
  }
  // Arco de dwell del anular (BPM): mismo esquema que el corazón
  if (rd > 0) {
    const rpx      = (1 - hand.ringPinch.point.x) * W;
    const rpy      = hand.ringPinch.point.y * H;
    const endAngle = -Math.PI / 2 + rd * Math.PI * 2;
    mainCtx.strokeStyle = 'rgba(255,210,80,0.75)';
    mainCtx.lineWidth   = 3;
    mainCtx.lineCap     = 'round';
    mainCtx.beginPath(); mainCtx.arc(rpx, rpy, 22, -Math.PI / 2, endAngle); mainCtx.stroke();
    mainCtx.fillStyle    = 'rgba(255,210,80,0.45)';
    mainCtx.font         = '6px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText('BPM', rpx, rpy + 30);
  }

  // Badge del efecto FX activo: pequeña etiqueta con color del efecto,
  // visible debajo de la palma cuando la mano está controlando un efecto.
  const activeFx = handFxSlots?.[hand.label];
  if (activeFx && Audio.FX_LABELS?.[activeFx]) {
    const fxLabel = Audio.FX_LABELS[activeFx];
    const [fcr, fcg, fcb] = Audio.FX_COLORS?.[activeFx] ?? [200, 200, 255];
    const bw = 44, bh = 16, bx = pcx - bw / 2, by = pcy + 18;
    mainCtx.fillStyle   = `rgba(${fcr},${fcg},${fcb},0.22)`;
    _roundRect(bx, by, bw, bh, 4); mainCtx.fill();
    mainCtx.strokeStyle = `rgba(${fcr},${fcg},${fcb},0.80)`;
    mainCtx.lineWidth   = 1;
    _roundRect(bx, by, bw, bh, 4); mainCtx.stroke();
    mainCtx.fillStyle    = `rgba(${fcr},${fcg},${fcb},1.0)`;
    mainCtx.font         = 'bold 7px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillText(fxLabel, pcx, by + bh / 2);
  }

  mainCtx.restore();
}

// ── Barra de estado de capas ──────────────────────────────────────────────────
// Fila de chips en la parte inferior de la pantalla, uno por cada capa activa.
// Cada chip muestra:
// - El nombre de la capa (más brillante si está en editing).
// - Una etiqueta de modo: MUTED / ⚡ FX / ▶ COUNT / ● REC / ✎ EDIT / ↻ LOOP.
// - Una barra de volumen en el borde inferior del chip.
// - Un arco de pre-roll animado con el número de beat (1–4) cuando se está contando.
// Si no hay capas activas, muestra el mensaje de ayuda para abrir la paleta.
function _drawLayerBar(W, H, editingLayer, layerModes, layerMuted, recordTarget, layerFxModes, layerVolumes, prerollTarget, prerollProgress) {
  const visibleKeys = Layers.TYPE_ORDER.filter(k => layerModes && layerModes[k] !== 'off');

  if (visibleKeys.length === 0) {
    mainCtx.fillStyle    = 'rgba(255,255,255,0.12)';
    mainCtx.font         = '11px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillText('pellizca para activar instrumentos', W / 2, H - 32);
    return;
  }

  const chipW  = 80, chipH = 30, gap = 7;
  const totalW = visibleKeys.length * chipW + (visibleKeys.length - 1) * gap;
  let   x      = (W - totalW) / 2;   // centrado horizontalmente
  const cy     = H - 32;             // posición vertical (cerca del borde inferior)
  const now    = performance.now();

  mainCtx.save();

  for (const key of visibleKeys) {
    const type    = Layers.TYPES[key];
    const { r, g, b } = type.color;
    const mode      = layerModes[key];
    const isEdit    = mode === 'editing';
    const isRec     = key === recordTarget;
    const isPreroll = key === prerollTarget;
    const isMuted   = layerMuted?.[key]    ?? false;
    const isFx      = layerFxModes?.[key] ?? false;
    const midX      = x + chipW / 2;   // centro horizontal del chip

    // Sombra cartoon
    mainCtx.globalAlpha = 0.30;
    mainCtx.fillStyle   = '#000';
    _roundRect(x + 2, cy - chipH / 2 + 3, chipW, chipH, 5);
    mainCtx.fill();
    mainCtx.globalAlpha = 1;

    // Fondo del chip: gris si muted, cian-tinted si FX, color de la capa si normal
    const fillA = isMuted ? 0.10 : (isEdit ? 0.35 : 0.18);
    if (isMuted) {
      mainCtx.fillStyle = `rgba(80,80,80,${fillA})`;
    } else if (isFx) {
      mainCtx.fillStyle = `rgba(${Math.round(r*0.4+60)},${Math.round(g*0.4+130)},${Math.round(b*0.4+180)},${fillA + 0.06})`;
    } else {
      mainCtx.fillStyle = `rgba(${r},${g},${b},${fillA})`;
    }
    _roundRect(x, cy - chipH / 2, chipW, chipH, 5); mainCtx.fill();

    // Borde cartoon: outline negro primero, luego color encima
    mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
    mainCtx.lineWidth   = 3;
    mainCtx.setLineDash([]);
    _roundRect(x, cy - chipH / 2, chipW, chipH, 5); mainCtx.stroke();

    if (isRec) {
      const alpha = 0.80 + Math.sin(now * 0.006) * 0.20;
      mainCtx.strokeStyle = `rgba(255,60,60,${alpha})`;
      mainCtx.lineWidth   = 1.5;
    } else if (isEdit) {
      mainCtx.strokeStyle = isFx ? 'rgba(100,210,255,0.90)' : 'rgba(255,255,255,0.90)';
      mainCtx.lineWidth   = 1.5;
    } else if (isFx) {
      mainCtx.strokeStyle = 'rgba(80,190,240,0.70)';
      mainCtx.lineWidth   = 1.5;
    } else {
      mainCtx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
      mainCtx.lineWidth   = 1.5;
    }
    _roundRect(x, cy - chipH / 2, chipW, chipH, 5); mainCtx.stroke();
    mainCtx.setLineDash([]);

    // Nombre de la capa
    mainCtx.fillStyle    = `rgba(255,255,255,${isEdit ? 0.95 : 0.65})`;
    mainCtx.font         = `${isEdit ? 'bold ' : ''}9px Montserrat, sans-serif`;
    mainCtx.textAlign    = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillText(type.name.toUpperCase(), midX, cy - 2);

    // Etiqueta de modo en la parte inferior del chip
    let tag, tagColor;
    if (isMuted)       { tag = '✦ MUTED'; tagColor = 'rgba(180,180,180,0.60)'; }
    else if (isFx)     { tag = '⚡ FX';   tagColor = 'rgba(80,210,255,0.95)'; }
    else if (isPreroll){ tag = '▶ COUNT'; tagColor = 'rgba(255,200,80,0.95)'; }
    else if (isRec)    { tag = '● REC';   tagColor = 'rgba(255,100,100,0.90)'; }
    else if (isEdit)   { tag = '✎ EDIT';  tagColor = 'rgba(255,255,255,0.55)'; }
    else               { tag = '↻ LOOP';  tagColor = `rgba(${r},${g},${b},0.70)`; }
    mainCtx.fillStyle    = tagColor;
    mainCtx.font         = `${isFx ? 'bold ' : ''}6px Montserrat, sans-serif`;
    mainCtx.textAlign    = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillText(tag, midX, cy + 9);

    // Animación de pre-roll: arco dorado que barre el chip + número de beat (1–4).
    // prerollProgress va de 0 a 1 a lo largo de los 4 beats del pre-roll.
    // prog×4: convierte el progreso total (0–1) a beats (0–4).
    // Math.floor(prog×4)+1: beat actual como entero 1, 2, 3 o 4.
    // (prog×4) % 1: fracción dentro del beat actual (0=inicio, 1=final del beat).
    // arcEnd: el arco empieza en -π/2 (arriba) y avanza en sentido horario.
    //   beatFrac × 2π: barre el círculo completo en un beat (parte de 0 y llega a 2π).
    // El alpha del trazo (0.55+beatFrac×0.35) hace que el arco pulse al final de cada beat.
    if (isPreroll && prerollProgress > 0) {
      const prog = prerollProgress ?? 0;
      const beatIdx  = Math.floor(prog * 4) + 1;
      const beatFrac = (prog * 4) % 1;
      const arcEnd   = -Math.PI / 2 + beatFrac * Math.PI * 2;
      mainCtx.strokeStyle = `rgba(255,200,80,${0.55 + beatFrac * 0.35})`;
      mainCtx.lineWidth   = 2; mainCtx.lineCap = 'round';
      mainCtx.beginPath();
      mainCtx.arc(midX, cy, chipH * 0.42, -Math.PI / 2, arcEnd);
      mainCtx.stroke();
      mainCtx.fillStyle    = 'rgba(255,220,100,0.95)';
      mainCtx.font         = 'bold 10px Montserrat, sans-serif';
      mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
      mainCtx.fillText(beatIdx, midX, cy - 1);
    }

    // Barra de volumen: franja horizontal de 2px en el borde inferior del chip.
    // Math.min(1, vol): clampea a 1 para el ancho de la barra (vol puede llegar a 1.2,
    // pero el chip solo puede mostrar hasta el 100%); el exceso no se visualiza.
    const vol      = Math.max(0, Math.min(1.2, (layerVolumes?.[key] ?? 1)));
    const volBarW  = Math.round((chipW - 8) * Math.min(1, vol));
    const volBarX  = x + 4;
    const volBarY  = cy + chipH / 2 - 4;
    mainCtx.fillStyle = `rgba(${r},${g},${b},0.18)`;
    mainCtx.fillRect(volBarX, volBarY, chipW - 8, 2);   // pista de fondo
    mainCtx.fillStyle = isMuted ? 'rgba(120,120,120,0.55)' : `rgba(${r},${g},${b},0.75)`;
    if (volBarW > 0) mainCtx.fillRect(volBarX, volBarY, volBarW, 2);   // relleno

    x += chipW + gap;
  }

  mainCtx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Dibuja un rectángulo con esquinas redondeadas usando quadraticCurveTo.
// Se usa con fill() o stroke() después de llamar a esta función.
function _roundRect(x, y, w, h, r) {
  mainCtx.beginPath();
  mainCtx.moveTo(x + r, y);
  mainCtx.lineTo(x + w - r, y);
  mainCtx.quadraticCurveTo(x + w, y, x + w, y + r);
  mainCtx.lineTo(x + w, y + h - r);
  mainCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  mainCtx.lineTo(x + r, y + h);
  mainCtx.quadraticCurveTo(x, y + h, x, y + h - r);
  mainCtx.lineTo(x, y + r);
  mainCtx.quadraticCurveTo(x, y, x + r, y);
  mainCtx.closePath();
}

// Actualiza el color objetivo del fondo. Llamado desde main.js cuando cambia la atmósfera.
function setAtmoColor(color) { _tgtColor = color; }

window.UI = { init, resize, renderFrame, setAtmoColor };

})();
