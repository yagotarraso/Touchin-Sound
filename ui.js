(function () {
'use strict';

// Referencias al canvas y al vídeo
let mainCanvas, mainCtx, videoEl;

// Color de fondo actual e interpolación suave hacia el color objetivo de la atmósfera.
// BG_LERP controla la velocidad: 0.018 ≈ ~2s de transición.
let _bgColor  = { r: 0,  g: 0,  b: 0   };
let _tgtColor = { r: 20, g: 80, b: 100 };
const BG_LERP = 0.018;

// Rutas a los iconos SVG que se usan en la paleta y los cursores de mano.
// Se precargan como imágenes rasterizadas en offscreen canvases para evitar lag al dibujar.
const _ICON_PATHS = {
  pad:          'svg/icons/icon_piano.svg',
  bass:         'svg/icons/icon_bass.svg',
  synth:        'svg/icons/icon_synth.svg',
  perc:         'svg/icons/icon_drum.svg',
  lead:         'svg/icons/icon_wave.svg',
  drive:        'svg/icons/icon_dist.svg',
  delay:        'svg/icons/icon_delay.svg',
  flutter:      'svg/icons/icon_trem.svg',
  clear:        'svg/icons/icon_mute.svg',
  clearFx:      'svg/icons/icon_mute.svg',
  hintMenu:     'svg/icons/icon_palette.svg',
  hintMenuLeft: 'svg/icons/left_palette.svg',
  hintRec:      'svg/icons/icon_record.svg',
  hintBpm:      'svg/icons/icon_tempo.svg',
};
const _icons = {}; // clave → offscreen canvas rasterizado a 64×64

function _loadIcons() {
  const SIZE   = 64;
  const byPath = {}; // evita crear dos canvases si dos claves apuntan al mismo archivo
  Object.entries(_ICON_PATHS).forEach(([key, src]) => {
    if (byPath[src]) { _icons[key] = byPath[src]; return; }
    const oc  = document.createElement('canvas');
    oc.width  = SIZE; oc.height = SIZE;
    const img = new Image();
    img.onload = () => oc.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
    img.src    = src;
    byPath[src] = oc;
    _icons[key] = oc;
  });
}

// Guarda las referencias al canvas y el vídeo, y precarga los iconos
function init(video, canvas) {
  videoEl    = video;
  mainCanvas = canvas;
  _loadIcons();
  mainCtx    = canvas.getContext('2d');
}

// Ajusta el canvas al tamaño de la ventana. Se llama al inicio y en cada resize.
function resize() {
  mainCanvas.width  = window.innerWidth;
  mainCanvas.height = window.innerHeight;
}

// Dibuja un frame completo con el estado actual de la app.
// El orden importa: cada capa se superpone a la anterior.
//   1. Vídeo espejado (fondo)
//   2. Tinte de atmósfera (semitransparente)
//   3. Línea divisoria central
//   4. Auras de secciones activas
//   5. Destello del beat 1
//   6. Barra de progreso del bucle
//   7. Nombre del acorde
//   8. Sliders de tempo y volumen
//   9. Menús radiales de pinch
//  10. Cursores de mano
//  11. Chips de capas (barra inferior)
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

  // Imagen de cámara espejada horizontalmente con scale(-1, 1)
  mainCtx.save();
  mainCtx.scale(-1, 1);
  mainCtx.drawImage(videoEl, -W, 0, W, H);
  mainCtx.restore();

  _drawBackground(W, H);
  _drawSectionDivider(W, H);
  _drawLayerAuras(W, H);

  const bp = Audio.getBeatPulse();
  if (bp > 0.01) _drawBeatPulse(W, H, bp);

  _drawLoopBar(W, loopPos, loopSteps, recording, recordTarget, hasAnyLoop);

  if (layerModes && layerModes.pad !== 'off' && chordName) {
    _drawChordName(W, H, chordName);
  }

  if (tempoSliderActive) {
    _drawTempoSlider(W, H, tempoBPM, frameHands);
  }
  if (volFaderActive && volFaderLayer) {
    _drawVolFader(W, H, volFaderLayer, layerVolumes, handY);
  }

  _drawPinchMenus(W, H, hands);

  for (const h of frameHands) {
    _drawHandCursor(W, H, h, handY, handVelY, midPinchDwell, ringPinchDwell, handFxSlots);
  }

  _drawLayerBar(W, H, editingLayer, layerModes, layerMuted, recordTarget, layerFxModes, layerVolumes, prerollTarget, prerollProgress);
}

// Interpola el color de fondo hacia la atmósfera activa y dibuja el tinte semitransparente.
// El alpha 0.18 deja ver el vídeo de cámara por debajo.
function _drawBackground(W, H) {
  _bgColor.r += (_tgtColor.r - _bgColor.r) * BG_LERP;
  _bgColor.g += (_tgtColor.g - _bgColor.g) * BG_LERP;
  _bgColor.b += (_tgtColor.b - _bgColor.b) * BG_LERP;
  const { r, g, b } = _bgColor;
  mainCtx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.18)`;
  mainCtx.fillRect(0, 0, W, H);
}

// Línea punteada en el centro: separa visualmente melodía (derecha) de ritmo (izquierda)
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

// Gradiente suave en cada mitad de pantalla cuando hay capas activas en esa sección
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

// Flash radial en el tiempo 1 del compás. 'pulse' viene de audio.js y decae cada frame.
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

// Barra de progreso del bucle en la parte superior de la pantalla.
// Verde con "▶ LOOP" cuando reproduce, rojo pulsante con "● REC" durante la grabación.
const LOOP_BAR_H  = 9;
const LOOP_BAR_Y  = 12;
const LOOP_BAR_PX = 16;

function _drawLoopBar(W, loopPos, loopSteps, recording, recordTarget, hasAnyLoop) {
  const barW = W - LOOP_BAR_PX * 2;
  const x    = LOOP_BAR_PX;
  const y    = LOOP_BAR_Y;
  const fill = (loopPos / loopSteps) * barW;
  const now  = performance.now();

  mainCtx.save();

  // Sombra cartoon
  mainCtx.globalAlpha = 0.28;
  mainCtx.fillStyle   = '#000';
  _roundRect(x + 2, y + 3, barW, LOOP_BAR_H, 3);
  mainCtx.fill();
  mainCtx.globalAlpha = 1;

  // Pista de fondo
  mainCtx.fillStyle = 'rgba(30,30,40,0.72)';
  _roundRect(x, y, barW, LOOP_BAR_H, 3);
  mainCtx.fill();
  mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
  mainCtx.lineWidth   = 2;
  _roundRect(x, y, barW, LOOP_BAR_H, 3);
  mainCtx.stroke();

  // Marcas de tiempo: una cada 8 pasos (= una negra)
  for (let i = 0; i < loopSteps; i += 8) {
    const mx = x + (i / loopSteps) * barW;
    mainCtx.fillStyle = 'rgba(255,255,255,0.10)';
    mainCtx.fillRect(mx, y, 1, LOOP_BAR_H);
  }

  if (!hasAnyLoop && !recording) {
    mainCtx.restore();
    return;
  }

  // Relleno de progreso
  let fillColor;
  if (recording) {
    const alpha = 0.65 + Math.sin(now * 0.006) * 0.25; // pulsa ~0.9 Hz
    fillColor   = `rgba(255,60,60,${alpha})`;
  } else {
    fillColor = 'rgba(60,200,120,0.70)';
  }
  mainCtx.fillStyle = fillColor;
  _roundRect(x, y, Math.max(4, fill), LOOP_BAR_H, 2);
  mainCtx.fill();

  // Cabezal de reproducción
  const headX = x + fill;
  mainCtx.fillStyle = recording ? 'rgba(255,120,120,1)' : 'rgba(120,255,180,1)';
  mainCtx.beginPath();
  mainCtx.arc(headX, y + LOOP_BAR_H / 2, 5, 0, Math.PI * 2);
  mainCtx.fill();

  // Etiqueta de estado
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

// Nombre del acorde actual (I–VII) en grande y semitransparente en el lado melódico
function _drawChordName(W, H, chordName) {
  mainCtx.save();
  mainCtx.fillStyle    = 'rgba(70,130,255,0.40)';
  mainCtx.font         = `bold ${Math.round(H * 0.12)}px Montserrat, sans-serif`;
  mainCtx.textAlign    = 'center';
  mainCtx.textBaseline = 'middle';
  mainCtx.fillText(chordName, W * 0.75, H / 2);
  mainCtx.restore();
}

// Slider vertical de tempo. Aparece en el centro mientras el pinch anular está activo.
function _drawTempoSlider(W, H, bpm, frameHands) {
  mainCtx.save();
  const sliderH  = H * 0.6;
  const sliderX  = W / 2;
  const sliderY0 = H / 2 - sliderH / 2;
  const sliderY1 = H / 2 + sliderH / 2;

  // Pista
  mainCtx.strokeStyle = 'rgba(255,210,80,0.22)';
  mainCtx.lineWidth   = 3;
  mainCtx.lineCap     = 'round';
  mainCtx.beginPath();
  mainCtx.moveTo(sliderX, sliderY0);
  mainCtx.lineTo(sliderX, sliderY1);
  mainCtx.stroke();

  // Thumb: posición según BPM en rango 50–180
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

  // Badge con el BPM numérico
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

// Fader de volumen: aparece cuando se activa el botón VOL del submenú de una capa.
// La mano derecha controla el nivel con su altura en pantalla.
function _drawVolFader(W, H, layerKey, layerVolumes, handY) {
  const type = Layers.TYPES[layerKey];
  if (!type) return;
  const { r, g, b } = type.color;
  const vol   = Math.max(0, Math.min(1.2, layerVolumes?.[layerKey] ?? 1));
  const normV = vol / 1.2;

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

  // Marca de unity (vol=1.0 = posición al 83% del rango)
  const unityY = sliderY1 - (1.0 / 1.2) * sliderH;
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.50)`;
  mainCtx.lineWidth   = 1;
  mainCtx.beginPath(); mainCtx.moveTo(sliderX - 12, unityY); mainCtx.lineTo(sliderX + 12, unityY); mainCtx.stroke();

  // Thumb
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.90)`;
  mainCtx.lineWidth   = 2.5;
  mainCtx.beginPath(); mainCtx.moveTo(sliderX - 18, thumbY); mainCtx.lineTo(sliderX + 18, thumbY); mainCtx.stroke();
  mainCtx.fillStyle = `rgba(${r},${g},${b},0.90)`;
  mainCtx.beginPath(); mainCtx.arc(sliderX, thumbY, 6, 0, Math.PI * 2); mainCtx.fill();

  // Badge con nombre y porcentaje
  const pct    = Math.round(vol * 100);
  const badgeW = 100, badgeH = 26;
  const bx     = sliderX - badgeW / 2;
  const by     = Math.max(sliderY0 + 4, thumbY - 36);
  mainCtx.fillStyle   = `rgba(${r},${g},${b},0.18)`;
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.fill();
  mainCtx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
  mainCtx.lineWidth   = 1;
  _roundRect(bx, by, badgeW, badgeH, 5); mainCtx.stroke();
  mainCtx.fillStyle    = 'rgba(255,255,255,0.92)';
  mainCtx.font         = 'bold 11px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
  mainCtx.fillText(`${type.name.toUpperCase()}  ${pct}%`, sliderX, by + badgeH / 2);

  // Instrucción
  mainCtx.fillStyle    = `rgba(${r},${g},${b},0.45)`;
  mainCtx.font         = '9px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'top';
  mainCtx.fillText('move hand ↕  ·  pinch to confirm', sliderX, sliderY1 + 8);

  mainCtx.restore();
}

// Radio del círculo de ítems y radio de cada botón circular de la paleta
const MENU_RADIUS_PX = 135;
const MENU_ITEM_R    = 36;

// Geometría del submenú (debe coincidir con las constantes de main.js)
const SUB_RADIUS = 70;
const SUB_ARC    = 52 * Math.PI / 180;
const SUB_BTN_R  = 15;

// Dibuja los menús radiales de ambas manos.
// Derecha: paleta de instrumentos. Izquierda: menú de contexto (FX o formas de onda).
// Mientras se acumula el dwell, muestra solo un arco de progreso.
function _drawPinchMenus(W, H, menuHands) {
  for (const menu of menuHands) {
    if (!menu.origin && menu.dwell <= 0) continue;

    const isRight  = menu.label === 'Right';
    const colorStr = isRight ? '200,130,255' : '70,210,145'; // morado para la derecha, verde para la izquierda
    const menuItems = menu.items || [];

    // Arco de dwell: muestra el progreso antes de que el menú se abra
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

    // Fondo circular del menú
    const bgR = MENU_RADIUS_PX + MENU_ITEM_R + 14;
    mainCtx.save();
    mainCtx.globalAlpha = 0.25;
    mainCtx.fillStyle   = '#000';
    mainCtx.beginPath(); mainCtx.arc(ox + 4, oy + 5, bgR, 0, Math.PI * 2); mainCtx.fill();
    mainCtx.restore();
    mainCtx.strokeStyle = 'rgba(0,0,0,0.65)';
    mainCtx.lineWidth   = 4;
    mainCtx.beginPath(); mainCtx.arc(ox, oy, bgR, 0, Math.PI * 2); mainCtx.stroke();
    mainCtx.fillStyle = 'rgba(15,15,25,0.78)';
    mainCtx.beginPath(); mainCtx.arc(ox, oy, bgR, 0, Math.PI * 2); mainCtx.fill();

    // Etiqueta central del menú izquierdo
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
      // Distribuye los ítems en 360° empezando desde arriba (-π/2)
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const ix    = ox + MENU_RADIUS_PX * Math.cos(angle);
      const iy    = oy + MENU_RADIUS_PX * Math.sin(angle);
      const hov   = menu.hover === key;
      const itemR = MENU_ITEM_R;

      let cr, cg, cb, label;
      let active = false, editing = false, fxHand = null;

      if (key === 'clear') {
        cr = 255; cg = 55; cb = 55; label = 'CLR';
      } else if (key === 'clearFx') {
        cr = 255; cg = 80; cb = 30; label = '✕ FX';
      } else if (Layers.TYPES[key]) {
        const td = Layers.TYPES[key];
        cr = td.color.r; cg = td.color.g; cb = td.color.b;
        label   = td.name.toUpperCase();
        const mode = Audio.getLayerMode(key) || 'off';
        active  = mode !== 'off';
        editing = mode === 'editing';
      } else if (Audio.FX_COLORS && Audio.FX_COLORS[key]) {
        [cr, cg, cb] = Audio.FX_COLORS[key];
        label = Audio.FX_LABELS[key] || key.toUpperCase();
        if (menu.fxSlots) {
          const onR = menu.fxSlots.right === key;
          const onL = menu.fxSlots.left  === key;
          active  = onR || onL;
          fxHand  = onR ? 'R' : (onL ? 'L' : null);
        }
      } else {
        // Forma de onda del menú izquierdo
        cr = 160; cg = 180; cb = 220;
        label  = key.slice(0, 3).toUpperCase();
        active = menu.currentWaveform === key;
      }

      // Opacidad según estado: editing > active > hover > inactivo
      const bodyA = editing
        ? (hov ? 1.0 : 0.85)
        : active
          ? (hov ? 1.0 : 0.55)
          : (hov ? 0.55 : 0.25);

      // Línea desde el centro al ítem
      mainCtx.strokeStyle = 'rgba(255,255,255,0.07)';
      mainCtx.lineWidth   = 1;
      mainCtx.beginPath(); mainCtx.moveTo(ox, oy); mainCtx.lineTo(ix, iy); mainCtx.stroke();

      mainCtx.save();
      mainCtx.restore();

      // Anillo de estado: outline negro + color
      if (active) {
        const ringR = itemR + 6;
        mainCtx.strokeStyle = `rgba(0,0,0,${editing ? 0.85 : 0.50})`;
        mainCtx.lineWidth   = editing ? 5 : 4;
        mainCtx.setLineDash([]);
        mainCtx.beginPath(); mainCtx.arc(ix, iy, ringR, 0, Math.PI * 2); mainCtx.stroke();
        mainCtx.strokeStyle = editing
          ? 'rgba(255,255,255,0.92)'
          : `rgba(${cr},${cg},${cb},0.85)`;
        mainCtx.lineWidth   = editing ? 2.5 : 2;
        if (!editing) mainCtx.setLineDash([4, 4]);
        mainCtx.beginPath(); mainCtx.arc(ix, iy, ringR, 0, Math.PI * 2); mainCtx.stroke();
        mainCtx.setLineDash([]);
      }

      // Anillo de hover
      if (hov) {
        mainCtx.strokeStyle = 'rgba(255,255,255,0.70)';
        mainCtx.lineWidth   = 1.5;
        mainCtx.beginPath(); mainCtx.arc(ix, iy, itemR + 1.5, 0, Math.PI * 2); mainCtx.stroke();
      }

      // Icono o texto del ítem
      const labelOffY  = (!isRight && fxHand) ? -3 : 0;
      const iconCanvas = _icons[key];
      if (iconCanvas) {
        const iSz = itemR * 1.80;
        mainCtx.save();
        mainCtx.globalAlpha = 1.0;
        mainCtx.drawImage(iconCanvas, ix - iSz / 2, iy - iSz / 2, iSz, iSz);
        mainCtx.restore();
      } else {
        // Fallback texto para ítems sin icono (reverb, formas de onda...)
        mainCtx.fillStyle    = `rgba(255,255,255,${active ? 0.95 : (hov ? 0.90 : 0.60)})`;
        mainCtx.font         = `${hov ? 'bold ' : ''}${hov ? 9 : 7}px Montserrat, sans-serif`;
        mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
        mainCtx.fillText(label, ix, iy + labelOffY);
      }

      // Badge L/R: indica qué mano controla este efecto FX
      if (!isRight && fxHand) {
        const badgeColor = fxHand === 'R' ? '160,200,255' : '200,130,255';
        mainCtx.fillStyle    = `rgba(${badgeColor},0.95)`;
        mainCtx.font         = `bold 6px Montserrat, sans-serif`;
        mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
        mainCtx.fillText(fxHand, ix, iy + 7);
      }

      // Punto cian en la esquina si la capa tiene FX activo
      if (isRight && Layers.TYPES[key] && Audio.getLayerFxMode(key)) {
        mainCtx.fillStyle = 'rgba(100,210,255,0.90)';
        mainCtx.beginPath(); mainCtx.arc(ix + itemR * 0.55, iy - itemR * 0.55, 4, 0, Math.PI * 2); mainCtx.fill();
      }

      // Submenú de la paleta derecha (al hacer hover sobre un instrumento)
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

// Dibuja el submenú de tres botones en abanico alrededor de un instrumento.
// ✕ (desactivar) | VOL (volumen) | ⊕FX (efectos)
// VOL y FX aparecen bloqueados (grises) si la capa no tiene bucle grabado.
function _drawSubMenu(ix, iy, angle, subHover, hasLoop) {
  function _drawSubBtn(bx, by, rFill, gFill, bFill, label, hov, fontSize) {
    // Sombra
    mainCtx.save();
    mainCtx.globalAlpha = 0.30;
    mainCtx.fillStyle   = '#000';
    mainCtx.beginPath(); mainCtx.arc(bx + 2, by + 3, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();
    mainCtx.restore();

    mainCtx.fillStyle = `rgba(${rFill},${gFill},${bFill},${hov ? 0.95 : 0.75})`;
    mainCtx.beginPath(); mainCtx.arc(bx, by, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();

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

  // ✕ — desactivar (siempre disponible)
  const muteX   = ix + SUB_RADIUS * Math.cos(angle - SUB_ARC);
  const muteY   = iy + SUB_RADIUS * Math.sin(angle - SUB_ARC);
  _drawSubBtn(muteX, muteY, 255, 60, 60, '✕', subHover === 'mute', 10);

  // VOL — fader de volumen (solo si hay bucle grabado)
  const volX = ix + SUB_RADIUS * Math.cos(angle);
  const volY = iy + SUB_RADIUS * Math.sin(angle);
  if (hasLoop) {
    _drawSubBtn(volX, volY, 255, 210, 80, 'VOL', subHover === 'vol', 8);
  } else {
    _drawSubBtn(volX, volY, 100, 100, 100, 'VOL', false, 8);
    mainCtx.fillStyle = 'rgba(160,160,160,0.50)';
    mainCtx.font      = '6px Montserrat, sans-serif';
    mainCtx.textAlign = 'center'; mainCtx.textBaseline = 'top';
    mainCtx.fillText('🔒', volX, volY + SUB_BTN_R + 2);
  }

  // ⊕FX — modo efectos (solo si hay bucle grabado; sin bucle aparece fantasma)
  const fxX = ix + SUB_RADIUS * Math.cos(angle + SUB_ARC);
  const fxY = iy + SUB_RADIUS * Math.sin(angle + SUB_ARC);
  const fxA = hasLoop ? 1.0 : 0.25; // opacidad reducida si no hay bucle

  mainCtx.save();
  mainCtx.globalAlpha = fxA;

  mainCtx.save();
  mainCtx.globalAlpha = 0.30 * fxA;
  mainCtx.fillStyle   = '#000';
  mainCtx.beginPath(); mainCtx.arc(fxX + 2, fxY + 3, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();
  mainCtx.restore();

  mainCtx.fillStyle = `rgba(80,200,255,${subHover === 'fx' ? 0.95 : 0.75})`;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R, 0, Math.PI * 2); mainCtx.fill();

  mainCtx.strokeStyle = 'rgba(0,0,0,0.80)';
  mainCtx.lineWidth   = 3;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R, 0, Math.PI * 2); mainCtx.stroke();

  mainCtx.save();
  mainCtx.globalAlpha = subHover === 'fx' ? 0.45 : 0.28;
  mainCtx.strokeStyle = 'rgba(255,255,255,0.85)';
  mainCtx.lineWidth   = 1.5;
  mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R * 0.62, Math.PI * 1.05, Math.PI * 1.72); mainCtx.stroke();
  mainCtx.restore();

  if (subHover === 'fx') {
    mainCtx.strokeStyle = 'rgba(255,255,255,0.70)';
    mainCtx.lineWidth   = 1.5;
    mainCtx.beginPath(); mainCtx.arc(fxX, fxY, SUB_BTN_R + 4, 0, Math.PI * 2); mainCtx.stroke();
  }

  mainCtx.fillStyle    = `rgba(255,255,255,${subHover === 'fx' ? 1.0 : 0.90})`;
  mainCtx.font         = '7px Montserrat, sans-serif';
  mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
  mainCtx.fillText(hasLoop ? '⊕ FX' : '○ FX', fxX, fxY);

  mainCtx.restore();
}

// Dibuja todo el cursor visual de una mano:
// puntas de dedo, indicadores de gesto, glow, círculo de pinch y arcos de dwell.
function _drawHandCursor(W, H, hand, handY, handVelY, midPinchDwell, ringPinchDwell, handFxSlots) {
  const isRight  = hand.label === 'Right';
  const colorStr = isRight ? '160,200,255' : '200,130,255';
  const pcx      = (1 - hand.center.x) * W; // espejado
  const pcy      = hand.center.y * H;
  const vel      = handVelY[hand.label];

  mainCtx.save();

  // Umbrales para mostrar los indicadores de cada dedo
  const PINCH_SHOW  = 0.50;
  const MIDDLE_SHOW = 0.30;
  const RING_SHOW   = 0.30;

  const md          = midPinchDwell[hand.label];
  const rd          = ringPinchDwell[hand.label];
  const menuActive  = hand.pinch.strength > PINCH_SHOW;
  const anySelection = md > 0 || rd > 0 || menuActive;

  // Puntas de dedo con indicadores de gesto
  // j=0 pulgar | j=1 índice | j=2 corazón | j=3 anular | j=4 meñique
  if (hand.fingertips) {
    const now = performance.now();
    for (let j = 0; j < hand.fingertips.length; j++) {
      const tip = hand.fingertips[j];
      const tx  = (1 - tip.x) * W;
      const ty  = tip.y * H;

      const isPinching = (j === 1 && hand.pinch.strength       > PINCH_SHOW)
                      || (j === 2 && hand.middlePinch.strength > MIDDLE_SHOW)
                      || (j === 3 && hand.ringPinch.strength   > RING_SHOW);

      if (!isPinching && j !== 1 && !anySelection) {
        mainCtx.fillStyle = `rgba(${colorStr},0.28)`;
        mainCtx.beginPath(); mainCtx.arc(tx, ty, 3.5, 0, Math.PI * 2); mainCtx.fill();
      }

      const isMenuFinger = j === 1;           // índice → MENU
      const isRecFinger  = j === 2 && isRight; // corazón → REC (solo derecha)
      const isBpmFinger  = j === 3 && isRight; // anular → BPM (solo derecha)

      const isRelevant = md > 0 ? isRecFinger
                       : rd > 0 ? isBpmFinger
                       : menuActive ? isMenuFinger
                       : true;

      if ((isMenuFinger || isRecFinger || isBpmFinger) && !isPinching && isRelevant) {
        const hintIconKey = isRecFinger ? 'hintRec'
                          : isBpmFinger ? 'hintBpm'
                          : isRight     ? 'hintMenu'
                          :               'hintMenuLeft';
        const hintIcon = _icons[hintIconKey];
        // Pulso lento con offset por dedo para que no se sincronicen entre sí
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

  // Círculo del pinch índice+pulgar (aparece a partir del 50% de fuerza)
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

  // Glow de palma: crece con la velocidad de movimiento
  const velGlow = Math.min(1, vel * 30);
  const glowR   = 30 + velGlow * 25;
  const glowA   = 0.06 + velGlow * 0.18;
  const glow    = mainCtx.createRadialGradient(pcx, pcy, 0, pcx, pcy, glowR);
  glow.addColorStop(0, `rgba(${colorStr},${glowA})`);
  glow.addColorStop(1, `rgba(${colorStr},0)`);
  mainCtx.fillStyle = glow;
  mainCtx.beginPath(); mainCtx.arc(pcx, pcy, glowR, 0, Math.PI * 2); mainCtx.fill();

  // Punto de aproximación corazón+pulgar (REC) y su arco de dwell
  if (hand.middlePinch.strength > MIDDLE_SHOW) {
    const mpx = (1 - hand.middlePinch.point.x) * W;
    const mpy = hand.middlePinch.point.y * H;
    const ms  = Math.max(0, (hand.middlePinch.strength - MIDDLE_SHOW) / (1 - MIDDLE_SHOW));
    mainCtx.fillStyle = `rgba(255,60,60,${0.25 + ms * 0.50})`;
    mainCtx.beginPath(); mainCtx.arc(mpx, mpy, 3 + ms * 4, 0, Math.PI * 2); mainCtx.fill();
  }
  if (md > 0) {
    const mpx      = (1 - hand.middlePinch.point.x) * W;
    const mpy      = hand.middlePinch.point.y * H;
    const endAngle = -Math.PI / 2 + md * Math.PI * 2;
    mainCtx.strokeStyle = 'rgba(255,60,60,0.75)';
    mainCtx.lineWidth   = 3; mainCtx.lineCap = 'round';
    mainCtx.beginPath(); mainCtx.arc(mpx, mpy, 22, -Math.PI / 2, endAngle); mainCtx.stroke();
    mainCtx.fillStyle    = 'rgba(255,60,60,0.45)';
    mainCtx.font         = '6px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText('REC', mpx, mpy + 30);
  }

  // Punto de aproximación anular+pulgar (BPM) y su arco de dwell
  if (hand.ringPinch.strength > RING_SHOW) {
    const rpx = (1 - hand.ringPinch.point.x) * W;
    const rpy = hand.ringPinch.point.y * H;
    const rs  = Math.max(0, (hand.ringPinch.strength - RING_SHOW) / (1 - RING_SHOW));
    mainCtx.fillStyle = `rgba(255,210,80,${0.25 + rs * 0.50})`;
    mainCtx.beginPath(); mainCtx.arc(rpx, rpy, 3 + rs * 4, 0, Math.PI * 2); mainCtx.fill();
  }
  if (rd > 0) {
    const rpx      = (1 - hand.ringPinch.point.x) * W;
    const rpy      = hand.ringPinch.point.y * H;
    const endAngle = -Math.PI / 2 + rd * Math.PI * 2;
    mainCtx.strokeStyle = 'rgba(255,210,80,0.75)';
    mainCtx.lineWidth   = 3; mainCtx.lineCap = 'round';
    mainCtx.beginPath(); mainCtx.arc(rpx, rpy, 22, -Math.PI / 2, endAngle); mainCtx.stroke();
    mainCtx.fillStyle    = 'rgba(255,210,80,0.45)';
    mainCtx.font         = '6px Montserrat, sans-serif';
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText('BPM', rpx, rpy + 30);
  }

  // Badge del efecto FX activo en esta mano
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
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText(fxLabel, pcx, by + bh / 2);
  }

  mainCtx.restore();
}

// Barra inferior con un chip por capa activa.
// Cada chip muestra nombre, modo (EDIT/LOOP/REC/...) y una barra de volumen.
// Si no hay capas activas, muestra un mensaje de ayuda.
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
  let   x      = (W - totalW) / 2;
  const cy     = H - 32;
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
    const midX      = x + chipW / 2;

    // Sombra
    mainCtx.globalAlpha = 0.30;
    mainCtx.fillStyle   = '#000';
    _roundRect(x + 2, cy - chipH / 2 + 3, chipW, chipH, 5);
    mainCtx.fill();
    mainCtx.globalAlpha = 1;

    // Fondo del chip
    const fillA = isMuted ? 0.10 : (isEdit ? 0.35 : 0.18);
    if (isMuted) {
      mainCtx.fillStyle = `rgba(80,80,80,${fillA})`;
    } else if (isFx) {
      mainCtx.fillStyle = `rgba(${Math.round(r*0.4+60)},${Math.round(g*0.4+130)},${Math.round(b*0.4+180)},${fillA + 0.06})`;
    } else {
      mainCtx.fillStyle = `rgba(${r},${g},${b},${fillA})`;
    }
    _roundRect(x, cy - chipH / 2, chipW, chipH, 5); mainCtx.fill();

    // Borde cartoon
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
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText(type.name.toUpperCase(), midX, cy - 2);

    // Etiqueta de modo
    let tag, tagColor;
    if (isMuted)       { tag = '✦ MUTED'; tagColor = 'rgba(180,180,180,0.60)'; }
    else if (isFx)     { tag = '⚡ FX';   tagColor = 'rgba(80,210,255,0.95)'; }
    else if (isPreroll){ tag = '▶ COUNT'; tagColor = 'rgba(255,200,80,0.95)'; }
    else if (isRec)    { tag = '● REC';   tagColor = 'rgba(255,100,100,0.90)'; }
    else if (isEdit)   { tag = '✎ EDIT';  tagColor = 'rgba(255,255,255,0.55)'; }
    else               { tag = '↻ LOOP';  tagColor = `rgba(${r},${g},${b},0.70)`; }
    mainCtx.fillStyle    = tagColor;
    mainCtx.font         = `${isFx ? 'bold ' : ''}6px Montserrat, sans-serif`;
    mainCtx.textAlign    = 'center'; mainCtx.textBaseline = 'middle';
    mainCtx.fillText(tag, midX, cy + 9);

    // Animación de pre-roll: arco dorado que barre el chip y número de beat (1–4).
    // prog*4 convierte el progreso global (0–1) a beats; (prog*4) % 1 es la fracción
    // dentro del beat actual, que controla cuánto avanza el arco en ese beat.
    if (isPreroll && prerollProgress > 0) {
      const prog     = prerollProgress ?? 0;
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

    // Barra de volumen en el borde inferior del chip
    const vol     = Math.max(0, Math.min(1.2, (layerVolumes?.[key] ?? 1)));
    const volBarW = Math.round((chipW - 8) * Math.min(1, vol));
    const volBarX = x + 4;
    const volBarY = cy + chipH / 2 - 4;
    mainCtx.fillStyle = `rgba(${r},${g},${b},0.18)`;
    mainCtx.fillRect(volBarX, volBarY, chipW - 8, 2);
    mainCtx.fillStyle = isMuted ? 'rgba(120,120,120,0.55)' : `rgba(${r},${g},${b},0.75)`;
    if (volBarW > 0) mainCtx.fillRect(volBarX, volBarY, volBarW, 2);

    x += chipW + gap;
  }

  mainCtx.restore();
}

// Dibuja un rectángulo con esquinas redondeadas.
// Usar con fill() o stroke() después de llamar a esta función.
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

// Actualiza el color objetivo del fondo (llamado desde main.js al cambiar de atmósfera)
function setAtmoColor(color) { _tgtColor = color; }

window.UI = { init, resize, renderFrame, setAtmoColor };

})();
