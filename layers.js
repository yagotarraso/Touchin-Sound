(function () {
'use strict';

// ── Registro de capas ────────────────────────────────────────────────────────
// Cada capa representa un instrumento o sección de la performance.
// - name:    nombre para mostrar en la UI.
// - color:   RGB usado en visualizaciones (barra de estado, auras, paleta).
// - section: agrupa las capas en dos zonas visuales:
//     'melody' → lado derecho de la pantalla (pad, synth, lead)
//     'rhythm' → lado izquierdo (bass, perc)

const TYPES = {
  pad:  { name: 'Pad',   color: { r: 70,  g: 130, b: 255 }, section: 'melody' },
  bass: { name: 'Bajo',  color: { r: 140, g: 55,  b: 230 }, section: 'rhythm' },
  synth:{ name: 'Synth', color: { r: 255, g: 108, b: 28  }, section: 'melody' },
  perc: { name: 'Perc',  color: { r: 255, g: 48,  b: 88  }, section: 'rhythm' },
  lead: { name: 'Lead',  color: { r: 44,  g: 218, b: 108 }, section: 'melody' },
};

// Orden fijo de iteración — determina la posición en la paleta radial y la barra
// de estado. Se exporta para que audio.js y ui.js itcren siempre en el mismo orden.
const TYPE_ORDER = ['pad', 'bass', 'synth', 'perc', 'lead'];

// Estado de activación de cada capa. 'active' indica si la capa aparece en la
// barra inferior y en la paleta. No confundir con el modo de audio (off/editing/looping).
const _state = {};
for (const key of TYPE_ORDER) {
  _state[key] = { active: false };
}

// Alterna el estado activo de una capa. Devuelve el nuevo valor de active.
function toggle(key) {
  if (!TYPES[key]) return false;
  _state[key].active = !_state[key].active;
  return _state[key].active;
}

// Establece el estado activo directamente (sin alternar).
function setActive(key, val) { if (_state[key]) _state[key].active = !!val; }

// Devuelve true si la capa está marcada como activa.
function isActive(key)       { return _state[key]?.active ?? false; }

// Devuelve un array con las capas activas, cada una como { key, type }.
// Usado por ui.js para saber qué dibujar en las auras y la barra de estado.
function activeLayers() {
  return TYPE_ORDER
    .filter(k => _state[k].active)
    .map(k => ({ key: k, type: TYPES[k] }));
}

// Número total de capas activas. Útil para calcular el ancho de los chips en la barra.
function activeCount() { return TYPE_ORDER.filter(k => _state[k].active).length; }

window.Layers = { TYPES, TYPE_ORDER, toggle, setActive, isActive, activeLayers, activeCount };

})();
