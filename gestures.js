(function () {
'use strict';

// Distancia euclidiana 3D entre dos landmarks de MediaPipe.
// x e y están normalizados entre 0 y 1 (relativos al frame de vídeo).
// z es profundidad estimada — positivo = más cerca de la cámara.
function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Centro aproximado de la palma: promedio XY de muñeca (0) y las 4 bases de dedo (5,9,13,17).
// Es suficientemente estable para usarlo como referencia de posición de la mano.
function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17];
  const pts = ids.map(i => lm[i]);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

// Detecta el pellizco entre dos dedos en 3D.
// Normaliza la distancia respecto a la longitud muñeca-base-del-medio (lm[0] a lm[9]),
// que es una referencia estable del tamaño aparente de la mano en pantalla.
// Usada para índice+pulgar porque MediaPipe estima bien la z de ese par.
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

// Versión 2D del pellizco — solo usa x e y, ignora z.
// Para corazón+pulgar y anular+pulgar, la z que da MediaPipe es poco fiable,
// así que trabajar en 2D da una detección más consistente.
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

// Puntas de los 5 dedos según el esquema de landmarks de MediaPipe
const TIP_IDS = [4, 8, 12, 16, 20]; // pulgar, índice, corazón, anular, meñique

// Historial de posiciones y velocidades suavizadas por etiqueta de mano ('Right'/'Left')
const _prevTips = {};
const _velTips  = {};
const _prevPalm = {};
const _velPalm  = {};

// Factor de suavizado para la velocidad (0 = sin suavizar, 1 = completamente suavizado).
// 0.55 da respuesta rápida sin spikes de un solo frame.
const VEL_SMOOTH = 0.55;

// Analiza todos los landmarks de una mano y devuelve un objeto con toda la información
// gestual que necesitan main.js y ui.js.
// label: 'Right' o 'Left' (ya corregido — MediaPipe los invierte porque la imagen está en espejo)
function analyse(label, lm) {
  const center = palmCenter(lm);

  // Índice+pulgar en 3D, el resto en 2D (ver comentarios de las funciones de arriba)
  const pinch       = _twoFingerPinch(lm, 4, 8);
  const middlePinch = _twoFingerPinch2D(lm, 4, 12);
  const ringPinch   = _twoFingerPinch2D(lm, 4, 16);

  // Velocidad suavizada de cada punta con un filtro EMA (Exponential Moving Average).
  // Más estable que la diferencia cruda para detectar movimientos bruscos.
  const currXY = TIP_IDS.map(i => ({ x: lm[i].x, y: lm[i].y }));
  const prevXY = _prevTips[label] || currXY;
  const prevV  = _velTips[label]  || currXY.map(() => ({ x: 0, y: 0 }));
  const vels   = currXY.map((p, j) => ({
    x: prevV[j].x + ((p.x - prevXY[j].x) - prevV[j].x) * VEL_SMOOTH,
    y: prevV[j].y + ((p.y - prevXY[j].y) - prevV[j].y) * VEL_SMOOTH,
  }));
  _prevTips[label] = currXY;
  _velTips[label]  = vels;

  // Velocidad de la palma: usada para el glow reactivo al movimiento del cursor
  const prevPC = _prevPalm[label] || center;
  const prevPV = _velPalm[label]  || { x: 0, y: 0 };
  const palmVel = {
    x: prevPV.x + ((center.x - prevPC.x) - prevPV.x) * VEL_SMOOTH,
    y: prevPV.y + ((center.y - prevPC.y) - prevPV.y) * VEL_SMOOTH,
  };
  _prevPalm[label] = { x: center.x, y: center.y };
  _velPalm[label]  = palmVel;
  const palmSpeed = Math.sqrt(palmVel.x * palmVel.x + palmVel.y * palmVel.y);

  // Array de puntas con posición y velocidad para que ui.js dibuje los indicadores
  const fingertips = TIP_IDS.map((id, j) => ({
    x: lm[id].x, y: lm[id].y,
    dvx: vels[j].x, dvy: vels[j].y,
  }));

  // Detección de puño: un dedo está encogido si su punta está más cerca de la muñeca
  // que la base de ese dedo × 1.15 (margen para dedos semi-flexionados).
  // isFist = true cuando al menos 3 de los 4 dedos largos están encogidos → mute.
  const wrist      = lm[0];
  const d2         = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const fingerDefs = [[8,5],[12,9],[16,13],[20,17]];
  const curled     = fingerDefs.filter(([t,m]) => d2(lm[t], wrist) < d2(lm[m], wrist) * 1.15).length;
  const isFist     = curled >= 3;

  return { label, center, pinch, middlePinch, ringPinch, fingertips, palmVel, palmSpeed, isFist };
}

window.Gestures = { analyse, palmCenter };

})();
