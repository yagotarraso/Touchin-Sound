(function() {
'use strict';

// Tipos de capa disponibles. Cada una tiene un nombre corto, color RGB y
// sección visual: 'melody' va al lado derecho, 'rhythm' al izquierdo.
const TYPES = {
  pad:   { name: 'Pad',   color: { r: 70,  g: 130, b: 255 }, section: 'melody' },
  bass:  { name: 'Bajo',  color: { r: 140, g: 55,  b: 230 }, section: 'rhythm' },
  synth: { name: 'Synth', color: { r: 255, g: 108, b: 28  }, section: 'melody' },
  perc:  { name: 'Perc',  color: { r: 255, g: 48,  b: 88  }, section: 'rhythm' },
  lead:  { name: 'Lead',  color: { r: 44,  g: 218, b: 108 }, section: 'melody' },
};

// Orden fijo de iteración — la paleta, la barra inferior y audio.js lo usan para
// recorrer siempre las capas en el mismo orden.
const TYPE_ORDER = ['pad', 'bass', 'synth', 'perc', 'lead'];

// Estado de activación por capa. 'active' solo indica si aparece en la UI,
// no si está sonando (eso lo gestiona audio.js con sus propios modos).
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

function setActive(key, val) {
  if (_state[key]) _state[key].active = !!val;
}

function isActive(key) {
  return _state[key]?.active ?? false;
}

// Devuelve un array con todas las capas que están activas como { key, type }.
// ui.js lo usa para saber qué dibujar en la barra y en las auras.
function activeLayers() {
  return TYPE_ORDER
    .filter(k => _state[k].active)
    .map(k => ({ key: k, type: TYPES[k] }));
}

function activeCount() {
  return TYPE_ORDER.filter(k => _state[k].active).length;
}

window.Layers = { TYPES, TYPE_ORDER, toggle, setActive, isActive, activeLayers, activeCount };

})();
