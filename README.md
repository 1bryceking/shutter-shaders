# shutter-shaders

WebGL 2.0 port of the fluid shader from the Shutter iOS app.

Renders a curl-noise fluid warp with caustics, chromatic aberration, touch-driven
interaction, expanding ripples, and A/B image cross-fade — all on a `<canvas>`.

## Demo

```bash
npx serve .
# open http://localhost:3000/demo/
```

Drop images into slots A and B, drag to warp, click to ripple, hit "Transition" to cross-fade.

## Module usage

```js
import { FluidShader } from './src/index.js';

const fluid = new FluidShader(document.querySelector('canvas'), {
  distortion:      0.016,
  patternScale:    0.5,
  timeScale:       0.5,
  touchRadius:     0.25,
  touchPull:       0.012,
  rippleStrength:  0.045,
  refractStrength: 1.4,
  chromaticSpread: 0.22,
  causticStrength: 0.55,
  causticSharpness:2.4,
  causticScale:    28,
});

await fluid.setTextureA('photo-a.jpg');
await fluid.setTextureB('photo-b.jpg');
fluid.start();

// Cross-fade A → B over 1.2s
fluid.transition(1200);

// Fire a ripple at UV center
fluid.addRipple(0.5, 0.5, 1.0);

// Live-update any parameter
fluid.setParams({ distortion: 0.04, causticStrength: 1.2 });
```

Touch and mouse interaction are wired automatically: drag to push fluid, click/tap to ripple.

## Parameters

| Parameter | Default | Range | Description |
|---|---|---|---|
| `patternScale` | 0.5 | 0.1–3.0 | Curl noise zoom (smaller = more zoomed in) |
| `timeScale` | 0.5 | 0.05–2.0 | Overall motion speed |
| `distortion` | 0.016 | 0–0.12 | Ambient warp magnitude |
| `touchRadius` | 0.25 | 0.01–0.5 | Gaussian falloff radius of touch warp |
| `touchPull` | 0.012 | 0–0.08 | Touch warp magnitude |
| `touchSensitivity` | 0.45 | 0.05–0.95 | Low-pass blend for velocity smoothing |
| `rippleStrength` | 0.045 | 0–0.15 | Expanding ring warp magnitude |
| `refractStrength` | 1.4 | 0–4.0 | Refractive-glass UV offset scale |
| `chromaticSpread` | 0.22 | 0–0.8 | R/B channel split vs. G (prism fringe) |
| `causticStrength` | 0.55 | 0–2.0 | Additive caustic highlight intensity |
| `causticSharpness` | 2.4 | 1.0–8.0 | Power-curve exponent on caustic ramp |
| `causticScale` | 28 | 1–60 | Laplacian multiplier for caustic detection |

## API

```ts
new FluidShader(canvas: HTMLCanvasElement, options?: Partial<Params>)

setTextureA(source: string | HTMLImageElement | HTMLCanvasElement): Promise<void>
setTextureB(source: string | HTMLImageElement | HTMLCanvasElement): Promise<void>
setParams(patch: Partial<Params>): void
transition(durationMs?: number): void   // default 1200ms
addRipple(u: number, v: number, strength?: number): void
start(): void
stop(): void
destroy(): void
```

## Browser support

Requires WebGL 2.0 — Chrome 56+, Firefox 51+, Safari 15+, Edge 79+.

## Origin

Ported from `FluidShader.metal` in the [Shutter](https://github.com/1bryceking/shutter) iOS app.
