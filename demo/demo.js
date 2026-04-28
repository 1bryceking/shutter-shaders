/**
 * Demo page for FluidShader.
 * Loads the module, wires up sliders + image pickers + buttons.
 *
 * The demo works without a bundler: shaders are imported as raw strings
 * via a tiny inline Vite-style shim defined below.
 */

// ── Inline shader sources (avoids needing a bundler for the demo) ─────────────
// In a real project you'd use `import src from './shaders/fluid.vert.glsl?raw'`
// with Vite/Rollup. For the plain-HTML demo we fetch them at runtime.

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return r.text();
}

// Patch the module so it accepts inline shader strings instead of import.meta
import('../src/FluidShader.js').then(async ({ FluidShader: _Base }) => {
  // We need shader sources; fetch them relative to this file's location.
  const [vertSrc, fragSrc] = await Promise.all([
    fetchText('../src/shaders/fluid.vert.glsl'),
    fetchText('../src/shaders/fluid.frag.glsl'),
  ]);

  // Extend FluidShader to inject the fetched sources
  class FluidShader extends _Base {
    _init() {
      const gl = this._canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
      if (!gl) throw new Error('WebGL 2.0 not supported in this browser.');
      this._gl = gl;
      const prog = this._compile(vertSrc, fragSrc);
      this._prog = prog;
      const uniformNames = [
        'uTexA','uTexB','uTime','uAlphaA','uAlphaB',
        'uDistortion','uTouchUV','uTouchStrength','uPatternScale','uTimeScale',
        'uTouchRadius','uTouchPull','uRippleStrength','uRefractStrength',
        'uChromaticSpread','uCausticStrength','uCausticSharpness','uCausticScale',
        'uTouchVelocity','uRippleCount',
      ];
      for (let i = 0; i < 16; i++) uniformNames.push(`uRipples[${i}]`);
      gl.useProgram(prog);
      for (const name of uniformNames) this._locs[name] = gl.getUniformLocation(prog, name);
      gl.uniform1i(this._locs['uTexA'], 0);
      gl.uniform1i(this._locs['uTexB'], 1);
      this._vao  = gl.createVertexArray();
      this._texA = this._placeholderTex([18, 18, 40, 255]);
      this._texB = this._placeholderTex([40, 12, 60, 255]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  initDemo(FluidShader);
});

// ── Parameter config ───────────────────────────────────────────────────────────

const SLIDERS = [
  { key: 'distortion',      label: 'Distortion',       min: 0,    max: 0.12,  step: 0.001,  def: 0.016 },
  { key: 'patternScale',    label: 'Pattern Scale',    min: 0.1,  max: 3.0,   step: 0.05,   def: 0.5   },
  { key: 'timeScale',       label: 'Time Scale',       min: 0.05, max: 2.0,   step: 0.05,   def: 0.5   },
  { key: 'touchRadius',     label: 'Touch Radius',     min: 0.01, max: 0.5,   step: 0.005,  def: 0.25  },
  { key: 'touchPull',       label: 'Touch Pull',       min: 0,    max: 0.08,  step: 0.001,  def: 0.012 },
  { key: 'rippleStrength',  label: 'Ripple Strength',  min: 0,    max: 0.15,  step: 0.001,  def: 0.045 },
  { key: 'refractStrength', label: 'Refract',          min: 0,    max: 4.0,   step: 0.05,   def: 1.4   },
  { key: 'chromaticSpread', label: 'Chromatic Split',  min: 0,    max: 0.8,   step: 0.01,   def: 0.22  },
  { key: 'causticStrength', label: 'Caustic Intensity',min: 0,    max: 2.0,   step: 0.01,   def: 0.55  },
  { key: 'causticSharpness',label: 'Caustic Sharpness',min: 1.0,  max: 8.0,   step: 0.1,    def: 2.4   },
  { key: 'causticScale',    label: 'Caustic Scale',    min: 1,    max: 60,    step: 0.5,    def: 28    },
];

// ── Demo wiring ────────────────────────────────────────────────────────────────

function initDemo(FluidShader) {
  const canvas = document.getElementById('canvas');
  const fluid  = new FluidShader(canvas);
  fluid.start();

  // Sliders
  const container = document.getElementById('sliders');
  for (const s of SLIDERS) {
    const row  = document.createElement('div');
    row.className = 'slider-row';

    const lbl = document.createElement('label');
    lbl.textContent = s.label;

    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = s.def.toFixed(s.step < 0.01 ? 3 : s.step < 0.1 ? 2 : 1);

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = s.min;
    input.max   = s.max;
    input.step  = s.step;
    input.value = s.def;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      fluid.setParams({ [s.key]: v });
      val.textContent = v.toFixed(s.step < 0.01 ? 3 : s.step < 0.1 ? 2 : 1);
    });

    row.append(lbl, input, val);
    container.appendChild(row);
  }

  // Image pickers
  document.querySelectorAll('input[type=file]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const url  = URL.createObjectURL(file);
      const slot = input.dataset.slot;
      if (slot === 'a') await fluid.setTextureA(url);
      else              await fluid.setTextureB(url);
      input.closest('.slot').classList.add('loaded');
    });
  });

  // Buttons
  document.getElementById('btn-transition').addEventListener('click', () => {
    fluid.transition(1200);
  });
  document.getElementById('btn-ripple').addEventListener('click', () => {
    fluid.addRipple(0.5, 0.5, 1.0);
  });

  // Panel collapse
  const toggle = document.getElementById('panel-toggle');
  const body   = document.getElementById('panel-body');
  toggle.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggle.classList.toggle('collapsed');
  });
}
