(function () {
'use strict';

// ── Geometría ────────────────────────────────────────────────────────────────

// Distancia euclidiana 3D entre dos landmarks de MediaPipe.
// Las coordenadas x,y están normalizadas entre 0 y 1 (relativas al frame de vídeo).
// La coordenada z es una estimación de profundidad — positiva = más cerca de la cámara.
function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Calcula el centro aproximado de la palma a partir de cinco landmarks clave:
// muñeca (0), base del índice (5), base del medio (9), base del anular (13), base del meñique (17).
// El resultado es el promedio XY de esos cinco puntos — suficientemente estable para
// controlar el volumen y las transiciones de expresión.
function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17];
  const pts = ids.map(i => lm[i]);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

// ── Detección de pinch (pellizco) ────────────────────────────────────────────

// Versión 3D — usada para índice+pulgar porque MediaPipe estima bien la z de ese par.
// Calcula la distancia 3D entre las puntas de dos dedos (tipIdA, tipIdB) y la normaliza
// respecto a la distancia muñeca-base-del-medio (lm[0] a lm[9]), que es una referencia
// estable del tamaño de la mano en el frame.
// Devuelve:
//   pinching: boolean — si el pellizco está completamente cerrado (norm < 0.26)
//   strength: 0 (dedos separados) a 1 (completamente juntos) — valor suavizado
//   norm:     distancia normalizada cruda (útil para depurar)
//   point:    punto medio entre las dos puntas — donde se dibuja el cursor de pinch
function _twoFingerPinch(lm, tipIdA, tipIdB) {
  const a    = lm[tipIdA];
  const b    = lm[tipIdB];
  const d    = dist3(a, b);
  const ref  = dist3(lm[0], lm[9]);
  const norm = ref > 0.01 ? d / ref : d / 0.15;
  return {
    pinching: norm < 0.26,
    strength: Math.max(0, Math.min(1, 1 - (norm - 0.05) / 0.28)),
    norm,
    point: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 },
  };
}

// Versión 2D — usada para corazón+pulgar (grabar) y anular+pulgar (tempo).
// Cuando la mano está de cara a la cámara, esos dedos se aproximan principalmente
// en el eje Z (profundidad), que MediaPipe estima con ruido para dedos no índice.
// Usar solo XY da detección consistente independientemente de la orientación de la mano
// (frontal o lateral).
// La referencia de escala es la distancia 2D muñeca-base-del-medio, que se mantiene
// proporcional al tamaño aparente de la mano en pantalla.
function _twoFingerPinch2D(lm, tipIdA, tipIdB) {
  const a   = lm[tipIdA];
  const b   = lm[tipIdB];
  const dx  = a.x - b.x, dy = a.y - b.y;
  const d   = Math.sqrt(dx * dx + dy * dy);
  const rx  = lm[0].x - lm[9].x, ry = lm[0].y - lm[9].y;
  const ref = Math.sqrt(rx * rx + ry * ry);
  const norm = ref > 0.01 ? d / ref : d / 0.15;
  return {
    pinching: norm < 0.28,
    strength: Math.max(0, Math.min(1, 1 - (norm - 0.04) / 0.30)),
    norm,
    point: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 },
  };
}

// ── Seguimiento de velocidad ──────────────────────────────────────────────────

// Índices de los cinco dedos en el array de landmarks de MediaPipe:
// 4=pulgar, 8=índice, 12=corazón, 16=anular, 20=meñique.
const TIP_IDS    = [4, 8, 12, 16, 20];

// Historial de posiciones y velocidades — un objeto por etiqueta de mano ('Right'/'Left').
const _prevTips  = {};   // posición de las puntas en el frame anterior
const _velTips   = {};   // velocidad suavizada de cada punta
const _prevPalm  = {};   // posición del centro de palma en el frame anterior
const _velPalm   = {};   // velocidad suavizada de la palma

// Factor de suavizado de velocidad (0=sin suavizado, 1=completamente suavizado).
// 0.55 da una respuesta rápida pero sin espikes de un solo frame.
const VEL_SMOOTH = 0.55;

// ── API pública ───────────────────────────────────────────────────────────────

// Analiza todos los landmarks de una mano y devuelve un objeto con toda la información
// gestual necesaria para el resto del sistema.
// - label:       'Right' o 'Left' (ya invertido respecto a MediaPipe — ver main.js)
// - center:      centro de palma normalizado (XY)
// - pinch:       resultado índice+pulgar (3D)
// - middlePinch: resultado corazón+pulgar (2D)
// - ringPinch:   resultado anular+pulgar (2D)
// - fingertips:  array de 5 puntas con posición y vector de velocidad
// - palmVel:     velocidad vectorial del centro de palma
// - palmSpeed:   módulo de palmVel (escalar)
// - isFist:      true si al menos 3 dedos están encogidos (mano cerrada = mute)
function analyse(label, lm) {
  const center = palmCenter(lm);

  // Índice+pulgar usa versión 3D porque MediaPipe estima bien la z de ese par.
  // Corazón y anular usan 2D porque su z es poco fiable en muchas orientaciones.
  const pinch       = _twoFingerPinch(lm, 4, 8);
  const middlePinch = _twoFingerPinch2D(lm, 4, 12);
  const ringPinch   = _twoFingerPinch2D(lm, 4, 16);

  // Velocidad por punta: suavizado exponencial sobre la diferencia frame-a-frame.
  // La velocidad suavizada es más estable que la diferencia cruda para detectar
  // movimientos bruscos (restrike del pad, activación de efectos).
  const currXY = TIP_IDS.map(i => ({ x: lm[i].x, y: lm[i].y }));
  const prevXY = _prevTips[label] || currXY;
  const prevV  = _velTips[label]  || currXY.map(() => ({ x: 0, y: 0 }));
  const vels   = currXY.map((p, j) => ({
    x: prevV[j].x + ((p.x - prevXY[j].x) - prevV[j].x) * VEL_SMOOTH,
    y: prevV[j].y + ((p.y - prevXY[j].y) - prevV[j].y) * VEL_SMOOTH,
  }));
  _prevTips[label] = currXY;
  _velTips[label]  = vels;

  // Velocidad de la palma completa — usada para el glow reactivo al movimiento
  // en el cursor de mano y para detectar restrikes (el pad resuena al mover la mano).
  const prevPC = _prevPalm[label] || center;
  const prevPV = _velPalm[label]  || { x: 0, y: 0 };
  const palmVel = {
    x: prevPV.x + ((center.x - prevPC.x) - prevPV.x) * VEL_SMOOTH,
    y: prevPV.y + ((center.y - prevPC.y) - prevPV.y) * VEL_SMOOTH,
  };
  _prevPalm[label] = { x: center.x, y: center.y };
  _velPalm[label]  = palmVel;
  const palmSpeed = Math.sqrt(palmVel.x * palmVel.x + palmVel.y * palmVel.y);

  // Array de puntas con posición y velocidad — usado por ui.js para dibujar los
  // círculos de dedo y los indicadores de gesto.
  const fingertips = TIP_IDS.map((id, j) => ({
    x: lm[id].x, y: lm[id].y,
    dvx: vels[j].x, dvy: vels[j].y,
  }));

  // Detección de puño: un dedo está "encogido" si su punta está más cerca de la
  // muñeca que la base de ese dedo × 1.15 (margen para dedos semi-flexionados).
  // Si al menos 3 de los 4 dedos largos están encogidos → isFist = true → mute.
  const wrist      = lm[0];
  const d2         = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const fingerDefs = [[8,5],[12,9],[16,13],[20,17]];
  const curled     = fingerDefs.filter(([t,m]) => d2(lm[t], wrist) < d2(lm[m], wrist) * 1.15).length;
  const isFist     = curled >= 3;

  return { label, center, pinch, middlePinch, ringPinch, fingertips, palmVel, palmSpeed, isFist };
}

window.Gestures = { analyse, palmCenter };

})();
