import { FluidShader } from '../src/FluidShader.js';

const SLIDERS = [
  { key: 'distortion',      label: 'Distortion',        min: 0,    max: 0.12, step: 0.001, def: 0.016 },
  { key: 'patternScale',    label: 'Pattern Scale',     min: 0.1,  max: 3.0,  step: 0.05,  def: 0.5   },
  { key: 'timeScale',       label: 'Time Scale',        min: 0.05, max: 2.0,  step: 0.05,  def: 0.5   },
  { key: 'touchRadius',     label: 'Touch Radius',      min: 0.01, max: 0.5,  step: 0.005, def: 0.25  },
  { key: 'touchPull',       label: 'Touch Pull',        min: 0,    max: 0.08, step: 0.001, def: 0.012 },
  { key: 'rippleStrength',  label: 'Ripple Strength',   min: 0,    max: 0.15, step: 0.001, def: 0.045 },
  { key: 'refractStrength', label: 'Refract',           min: 0,    max: 4.0,  step: 0.05,  def: 1.4   },
  { key: 'chromaticSpread', label: 'Chromatic Split',   min: 0,    max: 0.8,  step: 0.01,  def: 0.22  },
  { key: 'causticStrength', label: 'Caustic Intensity', min: 0,    max: 2.0,  step: 0.01,  def: 0.55  },
  { key: 'causticSharpness',label: 'Caustic Sharpness', min: 1.0,  max: 8.0,  step: 0.1,   def: 2.4   },
  { key: 'causticScale',    label: 'Caustic Scale',     min: 1,    max: 60,   step: 0.5,   def: 28    },
];

const canvas = document.getElementById('canvas');
const fluid  = new FluidShader(canvas);
fluid.start();

// Sliders
const container = document.getElementById('sliders');
for (const s of SLIDERS) {
  const row   = document.createElement('div');
  row.className = 'slider-row';
  const lbl   = document.createElement('label');
  lbl.textContent = s.label;
  const valEl = document.createElement('span');
  valEl.className = 'val';
  const fmt = v => v.toFixed(s.step < 0.01 ? 3 : s.step < 0.1 ? 2 : 1);
  valEl.textContent = fmt(s.def);
  const input = document.createElement('input');
  input.type = 'range'; input.min = s.min; input.max = s.max;
  input.step = s.step; input.value = s.def;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    fluid.setParams({ [s.key]: v });
    valEl.textContent = fmt(v);
  });
  row.append(lbl, input, valEl);
  container.appendChild(row);
}

// Image pickers
document.querySelectorAll('input[type=file]').forEach(input => {
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (input.dataset.slot === 'a') await fluid.setTextureA(url);
    else                            await fluid.setTextureB(url);
    input.closest('.slot').classList.add('loaded');
  });
});

document.getElementById('btn-transition').addEventListener('click', () => fluid.transition(1200));
document.getElementById('btn-ripple').addEventListener('click', () => fluid.addRipple(0.5, 0.5, 1.0));

// Panel toggle
const toggle = document.getElementById('panel-toggle');
const body   = document.getElementById('panel-body');
toggle.addEventListener('click', () => {
  body.classList.toggle('hidden');
  toggle.classList.toggle('collapsed');
});
