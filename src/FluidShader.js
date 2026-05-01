/**
 * FluidShader — WebGL 2.0 port of FluidShader.metal.
 *
 * Works in plain browsers (no bundler required) and with Vite/Rollup.
 * Shader sources are inlined so there are no external fetches.
 *
 * Usage:
 *   const fluid = new FluidShader(canvas, { distortion: 0.02 });
 *   await fluid.setTextureA('img-a.jpg');
 *   await fluid.setTextureB('img-b.jpg');
 *   fluid.start();
 */

const MAX_RIPPLES = 16;

// Defaults synced from iOS FluidShaderParams (164debf — tuned ship values)
const DEFAULTS = {
  patternScale:    0.37,
  timeScale:       0.86,
  distortion:      0.080,
  touchRadius:     0.27,
  touchPull:       0.051,
  rippleStrength:  0.078,
  refractStrength: 2.87,
  chromaticSpread: 0.42,
  causticStrength: 1.25,
  causticSharpness:2.01,
  causticScale:    65.9,
  touchSensitivity:0.32,
  blurSigma:       28.3,
};

// ── Inlined GLSL sources ──────────────────────────────────────────────────────

const VERT_SRC = /* glsl */`#version 300 es
out vec2 vUV;
void main() {
  float x = float(gl_VertexID & 1) * 2.0 - 1.0;
  float y = float((gl_VertexID >> 1) & 1) * 2.0 - 1.0;
  vUV = vec2(float(gl_VertexID & 1), 1.0 - float((gl_VertexID >> 1) & 1));
  gl_Position = vec4(x, y, 0.0, 1.0);
}`;

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uTime;
uniform float uAlphaA;
uniform float uAlphaB;
uniform float uDistortion;
uniform vec2  uTouchUV;
uniform float uTouchStrength;
uniform float uPatternScale;
uniform float uTimeScale;
uniform float uTouchRadius;
uniform float uTouchPull;
uniform float uRippleStrength;
uniform float uRefractStrength;
uniform float uChromaticSpread;
uniform float uCausticStrength;
uniform float uCausticSharpness;
uniform float uCausticScale;
uniform vec2  uTouchVelocity;
uniform int   uRippleCount;
uniform vec4  uRipples[${MAX_RIPPLES}];

vec2 fluid_hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float fluid_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(fluid_hash2(i),                f);
  float b = dot(fluid_hash2(i + vec2(1,0)), f - vec2(1,0));
  float c = dot(fluid_hash2(i + vec2(0,1)), f - vec2(0,1));
  float d = dot(fluid_hash2(i + vec2(1,1)), f - vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float fluid_fbm(vec2 p) {
  float v = 0.0, amp = 0.55;
  for (int i = 0; i < 3; i++) {
    v += amp * fluid_noise(p);
    p  = p * 2.0 + vec2(1.7, 9.2);
    amp *= 0.4;
  }
  return v;
}

vec2 fluid_curl(vec2 p, float t) {
  const float eps = 0.005;
  vec2 tp = p + vec2(0.0, t * 0.12);
  float n1 = fluid_fbm(tp + vec2(0.0,  eps));
  float n2 = fluid_fbm(tp + vec2(0.0, -eps));
  float n3 = fluid_fbm(tp + vec2( eps, 0.0));
  float n4 = fluid_fbm(tp + vec2(-eps, 0.0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * eps);
}

void main() {
  vec2 uv   = vUV;
  vec2 base = uv * uPatternScale;
  float ts  = uTimeScale;

  vec2 dw = vec2(
    fluid_fbm(base * 0.55 + vec2(0.0, uTime * 0.04 * ts)),
    fluid_fbm(base * 0.55 + vec2(5.2, uTime * 0.04 * ts))
  ) * 0.6;
  vec2 scroll      = vec2(uTime * 0.09 * ts, uTime * 0.14 * ts);
  vec2 ambientWarp = fluid_curl(base + dw + scroll, uTime * ts) * uDistortion;

  vec2 touchWarp = vec2(0.0);
  if (uTouchStrength > 0.001) {
    vec2 d = uTouchUV - uv;
    float falloff = exp(-dot(d,d) / max(uTouchRadius, 1e-4));
    touchWarp = uTouchVelocity * falloff * uTouchStrength * uTouchPull;
  }

  vec2 rippleWarp = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4  r   = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 2.0) continue;
    vec2  d      = uv - r.xy;
    float dist   = length(d);
    float radius = age * 0.45;
    float ring   = exp(-pow((dist - radius) / 0.08, 2.0));
    float decay  = exp(-age * 1.4) * r.w;
    float emerge = smoothstep(0.04, 0.12, radius);
    vec2  dir    = dist > 1e-4 ? d / dist : vec2(0.0);
    rippleWarp  += dir * ring * decay * emerge * uRippleStrength;
  }

  vec2 warpedUV = uv + ambientWarp + touchWarp + rippleWarp;

  vec2  cBase = (base + dw + scroll) + vec2(0.0, uTime * 0.12 * ts);
  const float epsC = 0.004;
  float h  = fluid_fbm(cBase);
  float hE = fluid_fbm(cBase + vec2( epsC, 0.0));
  float hW = fluid_fbm(cBase + vec2(-epsC, 0.0));
  float hN = fluid_fbm(cBase + vec2(0.0,  epsC));
  float hS = fluid_fbm(cBase + vec2(0.0, -epsC));

  vec2  nrm        = vec2(hE - hW, hN - hS) / (2.0 * epsC);
  float refractMag = uDistortion * uRefractStrength;
  vec2  offR = nrm * refractMag * (1.0 + uChromaticSpread);
  vec2  offG = nrm * refractMag;
  vec2  offB = nrm * refractMag * (1.0 - uChromaticSpread);

  vec3 color = vec3(
    texture(uTexA, warpedUV + offR).r * uAlphaA + texture(uTexB, warpedUV + offR).r * uAlphaB,
    texture(uTexA, warpedUV + offG).g * uAlphaA + texture(uTexB, warpedUV + offG).g * uAlphaB,
    texture(uTexA, warpedUV + offB).b * uAlphaA + texture(uTexB, warpedUV + offB).b * uAlphaB
  );

  float lap     = (hE + hW + hN + hS) * 0.25 - h;
  float caustic = max(0.0, -lap * uCausticScale);
  caustic       = pow(min(caustic, 1.6), uCausticSharpness) * uCausticStrength;
  color += vec3(0.92, 0.97, 1.06) * caustic * max(uAlphaA, uAlphaB);

  fragColor = vec4(color, uAlphaA + uAlphaB);
}`;

// ── Main class ────────────────────────────────────────────────────────────────

export class FluidShader {
  constructor(canvas, options = {}) {
    this._canvas  = canvas;
    this._params  = { ...DEFAULTS, ...options };
    this._alphaA  = 1.0;
    this._alphaB  = 0.0;
    this._running = false;
    this._raf     = null;
    this._startT  = null;

    this._touchUV       = [-1, -1];
    this._touchStrength = 0.0;
    this._touchVelocity = [0, 0];
    this._lastTouchUV   = null;
    this._lastTouchTime = null;

    this._ripples     = new Float32Array(MAX_RIPPLES * 4);
    this._rippleCount = 0;
    this._rippleHead  = 0;

    this._gl   = null;
    this._prog = null;
    this._locs = {};
    this._texA = null;
    this._texB = null;
    this._vao  = null;

    this._init();
    this._bindEvents();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async setTextureA(source) { this._texA = await this._loadTexture(source, this._texA); }
  async setTextureB(source) { this._texB = await this._loadTexture(source, this._texB); }

  setParams(patch) { Object.assign(this._params, patch); }

  transition(durationMs = 1200) {
    const startA = this._alphaA, startB = this._alphaB, begin = performance.now();
    const tick = (now) => {
      const t    = Math.min((now - begin) / durationMs, 1.0);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      this._alphaA = startA * (1 - ease);
      this._alphaB = startB + (1 - startB) * ease;
      if (t < 1.0) {
        requestAnimationFrame(tick);
      } else {
        [this._texA, this._texB] = [this._texB, this._texA];
        this._alphaA = 1.0; this._alphaB = 0.0;
      }
    };
    requestAnimationFrame(tick);
  }

  addRipple(u, v, strength = 1.0) {
    const base = this._rippleHead * 4;
    this._ripples[base]     = u;
    this._ripples[base + 1] = v;
    this._ripples[base + 2] = this._elapsed();
    this._ripples[base + 3] = strength;
    this._rippleHead  = (this._rippleHead + 1) % MAX_RIPPLES;
    this._rippleCount = Math.min(this._rippleCount + 1, MAX_RIPPLES);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startT  = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      this._render(now);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this.stop();
    this._unbindEvents();
    const gl = this._gl;
    if (!gl) return;
    gl.deleteProgram(this._prog);
    gl.deleteTexture(this._texA);
    gl.deleteTexture(this._texB);
    gl.deleteVertexArray(this._vao);
  }

  // ── WebGL init ──────────────────────────────────────────────────────────────

  _init() {
    const gl = this._canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL 2.0 not supported');
    this._gl = gl;

    this._prog = this._compile(VERT_SRC, FRAG_SRC);

    const names = [
      'uTexA','uTexB','uTime','uAlphaA','uAlphaB',
      'uDistortion','uTouchUV','uTouchStrength','uPatternScale','uTimeScale',
      'uTouchRadius','uTouchPull','uRippleStrength','uRefractStrength',
      'uChromaticSpread','uCausticStrength','uCausticSharpness','uCausticScale',
      'uTouchVelocity','uRippleCount',
    ];
    for (let i = 0; i < MAX_RIPPLES; i++) names.push(`uRipples[${i}]`);

    gl.useProgram(this._prog);
    for (const n of names) this._locs[n] = gl.getUniformLocation(this._prog, n);
    gl.uniform1i(this._locs['uTexA'], 0);
    gl.uniform1i(this._locs['uTexB'], 1);

    this._vao  = gl.createVertexArray();
    this._texA = this._gradientTex(['#1a0533','#3d1a78','#7b2fff','#c77dff']);
    this._texB = this._gradientTex(['#0d2b52','#1a6b8a','#2ec4b6','#cbf3f0']);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _compile(vertSrc, fragSrc) {
    const gl = this._gl;
    const mkShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   vertSrc));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog));
    return prog;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  _render() {
    const gl = this._gl, c = this._canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._texA);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._texB);

    const t = this._elapsed(), p = this._params, l = this._locs;
    gl.uniform1f(l['uTime'],             t);
    gl.uniform1f(l['uAlphaA'],           this._alphaA);
    gl.uniform1f(l['uAlphaB'],           this._alphaB);
    gl.uniform1f(l['uDistortion'],       p.distortion);
    gl.uniform2fv(l['uTouchUV'],         this._touchUV);
    gl.uniform1f(l['uTouchStrength'],    this._touchStrength);
    gl.uniform1f(l['uPatternScale'],     p.patternScale);
    gl.uniform1f(l['uTimeScale'],        p.timeScale);
    gl.uniform1f(l['uTouchRadius'],      p.touchRadius);
    gl.uniform1f(l['uTouchPull'],        p.touchPull);
    gl.uniform1f(l['uRippleStrength'],   p.rippleStrength);
    gl.uniform1f(l['uRefractStrength'],  p.refractStrength);
    gl.uniform1f(l['uChromaticSpread'],  p.chromaticSpread);
    gl.uniform1f(l['uCausticStrength'],  p.causticStrength);
    gl.uniform1f(l['uCausticSharpness'], p.causticSharpness);
    gl.uniform1f(l['uCausticScale'],     p.causticScale);
    gl.uniform2fv(l['uTouchVelocity'],   this._touchVelocity);
    gl.uniform1i(l['uRippleCount'],      this._rippleCount);

    for (let i = 0; i < this._rippleCount; i++) {
      const loc = l[`uRipples[${i}]`];
      if (loc) {
        const b = i * 4;
        gl.uniform4f(loc, this._ripples[b], this._ripples[b+1], this._ripples[b+2], this._ripples[b+3]);
      }
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── Texture helpers ─────────────────────────────────────────────────────────

  async _loadTexture(source, existing) {
    const gl = this._gl;
    const tex = existing ?? gl.createTexture();
    let img;
    if (typeof source === 'string') {
      img = await new Promise((res, rej) => {
        const i = new Image(); i.crossOrigin = 'anonymous';
        i.onload = () => res(i); i.onerror = rej; i.src = source;
      });
    } else {
      img = source;
    }

    // Apply Gaussian blur matching iOS MPSImageGaussianBlur at ingest time.
    // Draw into an OffscreenCanvas with CSS blur filter so the shader receives
    // a pre-blurred image, just like the Metal renderer does.
    const sigma = this._params.blurSigma;
    let uploadSrc = img;
    if (sigma > 0) {
      const w = img.naturalWidth  || img.width  || 512;
      const h = img.naturalHeight || img.height || 512;
      const oc  = new OffscreenCanvas(w, h);
      const ctx = oc.getContext('2d');
      ctx.filter = `blur(${sigma}px)`;
      ctx.drawImage(img, 0, 0, w, h);
      uploadSrc = oc;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSrc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // Generate a diagonal gradient texture so the fluid warp is visible immediately.
  _gradientTex(stops) {
    const SIZE = 256;
    const c = new OffscreenCanvas(SIZE, SIZE);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    stops.forEach((color, i) => g.addColorStop(i / (stops.length - 1), color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const gl = this._gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this._canvas;
    // Desktop: hover activates warp (no click required), click fires ripple
    this._onEnter  = this._handleEnter.bind(this);
    this._onMove   = this._handleMove.bind(this);
    this._onLeave  = this._handleLeave.bind(this);
    this._onClick  = this._handleClick.bind(this);
    // Touch: contact activates warp, lift deactivates
    this._onTMove  = (e) => { e.preventDefault(); this._handleMove(e.touches[0]); };
    this._onTDown  = (e) => { e.preventDefault(); this._touchStrength = 1.0; this._handleMove(e.touches[0]); };
    this._onTEnd   = (e) => { e.preventDefault(); this._handleLeave(); };
    c.addEventListener('mouseenter', this._onEnter);
    c.addEventListener('mousemove',  this._onMove);
    c.addEventListener('mouseleave', this._onLeave);
    c.addEventListener('click',      this._onClick);
    c.addEventListener('touchmove',  this._onTMove,  { passive: false });
    c.addEventListener('touchstart', this._onTDown,  { passive: false });
    c.addEventListener('touchend',   this._onTEnd,   { passive: false });
  }

  _unbindEvents() {
    const c = this._canvas;
    c.removeEventListener('mouseenter', this._onEnter);
    c.removeEventListener('mousemove',  this._onMove);
    c.removeEventListener('mouseleave', this._onLeave);
    c.removeEventListener('click',      this._onClick);
    c.removeEventListener('touchmove',  this._onTMove);
    c.removeEventListener('touchstart', this._onTDown);
    c.removeEventListener('touchend',   this._onTEnd);
  }

  _uv(clientX, clientY) {
    const r = this._canvas.getBoundingClientRect();
    // Vertex shader maps screen-top → UV.y=1 and screen-bottom → UV.y=0
    // (see fluid.vert.glsl), so flip the top-down clientY here when
    // producing shader UV — a pointer at the top of the canvas should
    // drive the warp at the top of the image.
    return [(clientX - r.left) / r.width, 1 - (clientY - r.top) / r.height];
  }

  _handleEnter(e) {
    this._touchStrength = 1.0;
    this._handleMove(e);
  }

  _handleMove(e) {
    const uv = this._uv(e.clientX, e.clientY), now = performance.now();
    if (this._lastTouchUV && this._lastTouchTime) {
      const dt = Math.max((now - this._lastTouchTime) / 1000, 0.001);
      const α  = this._params.touchSensitivity;
      this._touchVelocity[0] = this._touchVelocity[0] * (1-α) + ((uv[0] - this._lastTouchUV[0]) / dt) * α;
      this._touchVelocity[1] = this._touchVelocity[1] * (1-α) + ((uv[1] - this._lastTouchUV[1]) / dt) * α;
    }
    this._touchUV = uv; this._lastTouchUV = uv; this._lastTouchTime = now;
  }

  _handleLeave() {
    this._touchStrength = 0.0; this._touchVelocity = [0, 0];
    this._lastTouchUV = null; this._lastTouchTime = null;
  }

  _handleClick(e) {
    const uv = this._uv(e.clientX, e.clientY);
    this.addRipple(uv[0], uv[1], 1.0);
  }

  _elapsed() { return this._startT ? (performance.now() - this._startT) / 1000 : 0; }
}

export default FluidShader;
