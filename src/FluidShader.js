/**
 * FluidShader — WebGL 2.0 port of FluidShader.metal.
 *
 * Renders a curl-noise fluid warp with caustics, touch interaction,
 * expanding ripples, and A/B image cross-fade on a <canvas> element.
 *
 * Usage:
 *   const fluid = new FluidShader(canvas, { distortion: 0.02 });
 *   await fluid.setTextureA('img-a.jpg');
 *   await fluid.setTextureB('img-b.jpg');
 *   fluid.start();
 */

import VERT_SRC from './shaders/fluid.vert.glsl?raw';
import FRAG_SRC from './shaders/fluid.frag.glsl?raw';

const MAX_RIPPLES = 16;

const DEFAULTS = {
  patternScale:    0.5,
  timeScale:       0.5,
  distortion:      0.016,
  touchRadius:     0.25,
  touchPull:       0.012,
  rippleStrength:  0.045,
  refractStrength: 1.4,
  chromaticSpread: 0.22,
  causticStrength: 0.55,
  causticSharpness:2.4,
  causticScale:    28.0,
  touchSensitivity:0.45,
};

export class FluidShader {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Partial<typeof DEFAULTS>} options
   */
  constructor(canvas, options = {}) {
    this._canvas  = canvas;
    this._params  = { ...DEFAULTS, ...options };
    this._alphaA  = 1.0;
    this._alphaB  = 0.0;
    this._running = false;
    this._raf     = null;
    this._startT  = null;

    // Touch state
    this._touchUV       = [-1, -1];
    this._touchStrength = 0.0;
    this._touchVelocity = [0, 0];
    this._lastTouchUV   = null;
    this._lastTouchTime = null;

    // Ripple ring buffer
    this._ripples     = new Float32Array(MAX_RIPPLES * 4); // vec4 per ripple
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

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Load an image (URL, HTMLImageElement, or HTMLCanvasElement) into slot A. */
  async setTextureA(source) {
    this._texA = await this._loadTexture(source, this._texA);
  }

  /** Load an image into slot B. */
  async setTextureB(source) {
    this._texB = await this._loadTexture(source, this._texB);
  }

  /** Live-update any subset of parameters. */
  setParams(patch) {
    Object.assign(this._params, patch);
  }

  /**
   * Cross-fade from texture A to texture B over `durationMs` milliseconds.
   * After the transition, A and B are swapped so the next call fades again.
   */
  transition(durationMs = 1200) {
    const startA  = this._alphaA;
    const startB  = this._alphaB;
    const begin   = performance.now();
    const tick    = (now) => {
      const t = Math.min((now - begin) / durationMs, 1.0);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out quad
      this._alphaA = startA * (1 - ease);
      this._alphaB = startB + (1 - startB) * ease;
      if (t < 1.0) requestAnimationFrame(tick);
      else {
        // Swap so next transition goes back the other way
        [this._texA, this._texB] = [this._texB, this._texA];
        this._alphaA = 1.0;
        this._alphaB = 0.0;
      }
    };
    requestAnimationFrame(tick);
  }

  /**
   * Fire a ripple at UV coordinates (0-1 range).
   * @param {number} u
   * @param {number} v
   * @param {number} strength  0..1
   */
  addRipple(u, v, strength = 1.0) {
    const now  = this._elapsed();
    const base = this._rippleHead * 4;
    this._ripples[base]     = u;
    this._ripples[base + 1] = v;
    this._ripples[base + 2] = now;
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

  // ── WebGL init ────────────────────────────────────────────────────────────

  _init() {
    const gl = this._canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL 2.0 not supported');
    this._gl = gl;

    const prog = this._compile(VERT_SRC, FRAG_SRC);
    this._prog = prog;

    // Cache uniform locations
    const uniformNames = [
      'uTexA','uTexB','uTime','uAlphaA','uAlphaB',
      'uDistortion','uTouchUV','uTouchStrength','uPatternScale','uTimeScale',
      'uTouchRadius','uTouchPull','uRippleStrength','uRefractStrength',
      'uChromaticSpread','uCausticStrength','uCausticSharpness','uCausticScale',
      'uTouchVelocity','uRippleCount',
    ];
    for (let i = 0; i < MAX_RIPPLES; i++) uniformNames.push(`uRipples[${i}]`);

    gl.useProgram(prog);
    for (const name of uniformNames) {
      this._locs[name] = gl.getUniformLocation(prog, name);
    }

    // Texture units
    gl.uniform1i(this._locs['uTexA'], 0);
    gl.uniform1i(this._locs['uTexB'], 1);

    // Empty VAO for the fullscreen triangle-strip draw
    this._vao = gl.createVertexArray();

    // Create 1×1 placeholder textures so the shader has something to sample
    this._texA = this._placeholderTex([30, 30, 60, 255]);
    this._texB = this._placeholderTex([60, 20, 80, 255]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _compile(vertSrc, fragSrc) {
    const gl = this._gl;
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS))
      throw new Error('Vert: ' + gl.getShaderInfoLog(vert));

    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS))
      throw new Error('Frag: ' + gl.getShaderInfoLog(frag));

    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));

    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return prog;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render(now) {
    const gl = this._gl;
    const canvas = this._canvas;

    // Match canvas pixel size to display size
    const dpr = window.devicePixelRatio || 1;
    const w   = Math.round(canvas.clientWidth  * dpr);
    const h   = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this._prog);
    gl.bindVertexArray(this._vao);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._texB);

    const t  = this._elapsed();
    const p  = this._params;
    const lc = this._locs;

    gl.uniform1f(lc['uTime'],            t);
    gl.uniform1f(lc['uAlphaA'],          this._alphaA);
    gl.uniform1f(lc['uAlphaB'],          this._alphaB);
    gl.uniform1f(lc['uDistortion'],      p.distortion);
    gl.uniform2fv(lc['uTouchUV'],        this._touchUV);
    gl.uniform1f(lc['uTouchStrength'],   this._touchStrength);
    gl.uniform1f(lc['uPatternScale'],    p.patternScale);
    gl.uniform1f(lc['uTimeScale'],       p.timeScale);
    gl.uniform1f(lc['uTouchRadius'],     p.touchRadius);
    gl.uniform1f(lc['uTouchPull'],       p.touchPull);
    gl.uniform1f(lc['uRippleStrength'],  p.rippleStrength);
    gl.uniform1f(lc['uRefractStrength'], p.refractStrength);
    gl.uniform1f(lc['uChromaticSpread'],p.chromaticSpread);
    gl.uniform1f(lc['uCausticStrength'], p.causticStrength);
    gl.uniform1f(lc['uCausticSharpness'],p.causticSharpness);
    gl.uniform1f(lc['uCausticScale'],    p.causticScale);
    gl.uniform2fv(lc['uTouchVelocity'], this._touchVelocity);
    gl.uniform1i(lc['uRippleCount'],     this._rippleCount);

    // Upload ripple ring buffer as individual vec4 uniforms
    for (let i = 0; i < this._rippleCount; i++) {
      const key = `uRipples[${i}]`;
      if (lc[key]) {
        const base = i * 4;
        gl.uniform4f(lc[key],
          this._ripples[base], this._ripples[base+1],
          this._ripples[base+2], this._ripples[base+3]);
      }
    }

    // Fullscreen quad as triangle strip (4 verts, no index buffer)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── Texture loading ───────────────────────────────────────────────────────

  async _loadTexture(source, existing) {
    const gl = this._gl;
    const tex = existing ?? gl.createTexture();

    let img;
    if (typeof source === 'string') {
      img = await new Promise((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload  = () => res(i);
        i.onerror = rej;
        i.src = source;
      });
    } else {
      img = source;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  _placeholderTex(rgba) {
    const gl = this._gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ── Input handling ────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this._canvas;
    this._onMouseMove  = this._handleMove.bind(this);
    this._onMouseDown  = this._handleDown.bind(this);
    this._onMouseUp    = this._handleUp.bind(this);
    this._onTouchMove  = (e) => { e.preventDefault(); this._handleMove(e.touches[0]); };
    this._onTouchStart = (e) => { e.preventDefault(); this._handleDown(e.touches[0]); };
    this._onTouchEnd   = (e) => { e.preventDefault(); this._handleUp(); };
    this._onClick      = this._handleClick.bind(this);

    c.addEventListener('mousemove',  this._onMouseMove);
    c.addEventListener('mousedown',  this._onMouseDown);
    c.addEventListener('mouseup',    this._onMouseUp);
    c.addEventListener('mouseleave', this._onMouseUp);
    c.addEventListener('touchmove',  this._onTouchMove,  { passive: false });
    c.addEventListener('touchstart', this._onTouchStart, { passive: false });
    c.addEventListener('touchend',   this._onTouchEnd,   { passive: false });
    c.addEventListener('click',      this._onClick);
  }

  _unbindEvents() {
    const c = this._canvas;
    c.removeEventListener('mousemove',  this._onMouseMove);
    c.removeEventListener('mousedown',  this._onMouseDown);
    c.removeEventListener('mouseup',    this._onMouseUp);
    c.removeEventListener('mouseleave', this._onMouseUp);
    c.removeEventListener('touchmove',  this._onTouchMove);
    c.removeEventListener('touchstart', this._onTouchStart);
    c.removeEventListener('touchend',   this._onTouchEnd);
    c.removeEventListener('click',      this._onClick);
  }

  _canvasUV(clientX, clientY) {
    const r = this._canvas.getBoundingClientRect();
    return [
      (clientX - r.left)  / r.width,
      (clientY - r.top)   / r.height,
    ];
  }

  _handleMove(e) {
    const uv  = this._canvasUV(e.clientX, e.clientY);
    const now = performance.now();

    if (this._lastTouchUV && this._lastTouchTime) {
      const dt  = Math.max((now - this._lastTouchTime) / 1000, 0.001);
      const raw = [
        (uv[0] - this._lastTouchUV[0]) / dt,
        (uv[1] - this._lastTouchUV[1]) / dt,
      ];
      const α = this._params.touchSensitivity;
      this._touchVelocity[0] = this._touchVelocity[0] * (1 - α) + raw[0] * α;
      this._touchVelocity[1] = this._touchVelocity[1] * (1 - α) + raw[1] * α;
    }
    this._touchUV       = uv;
    this._lastTouchUV   = uv;
    this._lastTouchTime = now;
  }

  _handleDown(e) {
    this._touchStrength = 1.0;
    this._handleMove(e);
  }

  _handleUp() {
    this._touchStrength  = 0.0;
    this._touchVelocity  = [0, 0];
    this._lastTouchUV    = null;
    this._lastTouchTime  = null;
  }

  _handleClick(e) {
    const uv = this._canvasUV(e.clientX, e.clientY);
    this.addRipple(uv[0], uv[1], 1.0);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _elapsed() {
    if (!this._startT) return 0;
    return (performance.now() - this._startT) / 1000;
  }
}

export default FluidShader;
