#version 300 es
// Port of FluidShader.metal — curl-noise warp + caustics + touch + ripples + A/B cross-fade.
// Ported from Metal (half→float, float2→vec2, atan2(y,x)→atan(y,x), etc.)

precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;

// Mirrors FluidUniforms / FluidShaderParams from FluidShaderView.swift
uniform float uTime;
uniform float uAlphaA;
uniform float uAlphaB;
uniform float uDistortion;
uniform vec2  uTouchUV;          // (-1,-1) = no touch
uniform float uTouchStrength;    // 0..1
uniform float uPatternScale;
uniform float uTimeScale;
uniform float uTouchRadius;      // Gaussian σ² denominator
uniform float uTouchPull;
uniform float uRippleStrength;
uniform float uRefractStrength;
uniform float uChromaticSpread;
uniform float uCausticStrength;
uniform float uCausticSharpness;
uniform float uCausticScale;
uniform vec2  uTouchVelocity;

#define MAX_RIPPLES 16
uniform vec4  uRipples[MAX_RIPPLES]; // (origin.x, origin.y, startTime, strength)
uniform int   uRippleCount;

// ── Noise helpers (ported from fluid_hash2 / fluid_noise / fluid_fbm) ──────────

vec2 fluid_hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float fluid_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(fluid_hash2(i),                f);
    float b = dot(fluid_hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(fluid_hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(fluid_hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3-octave FBM — intentionally soft/liquid rather than granular.
float fluid_fbm(vec2 p) {
    float v = 0.0, amp = 0.55;
    for (int i = 0; i < 3; i++) {
        v  += amp * fluid_noise(p);
        p   = p * 2.0 + vec2(1.7, 9.2);
        amp *= 0.4;
    }
    return v;
}

// Curl of a 2D noise field — divergence-free fluid rotation.
vec2 fluid_curl(vec2 p, float t) {
    const float eps = 0.005;
    vec2 tp = p + vec2(0.0, t * 0.12);
    float n1 = fluid_fbm(tp + vec2(0.0,  eps));
    float n2 = fluid_fbm(tp + vec2(0.0, -eps));
    float n3 = fluid_fbm(tp + vec2( eps, 0.0));
    float n4 = fluid_fbm(tp + vec2(-eps, 0.0));
    return vec2((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

void main() {
    vec2 uv = vUV;

    // ── Ambient curl-noise warp ─────────────────────────────────────────────
    vec2 base  = uv * uPatternScale;
    float ts   = uTimeScale;

    vec2 dw = vec2(
        fluid_fbm(base * 0.55 + vec2(0.0, uTime * 0.04 * ts)),
        fluid_fbm(base * 0.55 + vec2(5.2, uTime * 0.04 * ts))
    ) * 0.6;

    vec2 scroll     = vec2(uTime * 0.09 * ts, uTime * 0.14 * ts);
    vec2 ambientWarp = fluid_curl(base + dw + scroll, uTime * ts) * uDistortion;

    // ── Touch warp — velocity-driven blob, not a radial pinch ─────────────
    vec2 touchWarp = vec2(0.0);
    if (uTouchStrength > 0.001) {
        vec2  d       = uTouchUV - uv;
        float falloff = exp(-dot(d, d) / max(uTouchRadius, 1e-4));
        touchWarp = uTouchVelocity * falloff * uTouchStrength * uTouchPull;
    }

    // ── Ripple sum ──────────────────────────────────────────────────────────
    vec2 rippleWarp = vec2(0.0);
    for (int i = 0; i < MAX_RIPPLES; i++) {
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

    // ── Caustic / refractive-glass modifier ────────────────────────────────
    vec2  cBase = (base + dw + scroll) + vec2(0.0, uTime * 0.12 * ts);
    const float epsC = 0.004;
    float h  = fluid_fbm(cBase);
    float hE = fluid_fbm(cBase + vec2( epsC, 0.0));
    float hW = fluid_fbm(cBase + vec2(-epsC, 0.0));
    float hN = fluid_fbm(cBase + vec2(0.0,  epsC));
    float hS = fluid_fbm(cBase + vec2(0.0, -epsC));

    vec2  nrm       = vec2(hE - hW, hN - hS) / (2.0 * epsC);
    float refractMag = uDistortion * uRefractStrength;
    vec2  offR = nrm * refractMag * (1.0 + uChromaticSpread);
    vec2  offG = nrm * refractMag;
    vec2  offB = nrm * refractMag * (1.0 - uChromaticSpread);

    float rA = texture(uTexA, warpedUV + offR).r;
    float gA = texture(uTexA, warpedUV + offG).g;
    float bA = texture(uTexA, warpedUV + offB).b;
    float rB = texture(uTexB, warpedUV + offR).r;
    float gB = texture(uTexB, warpedUV + offG).g;
    float bB = texture(uTexB, warpedUV + offB).b;

    vec3 color = vec3(
        rA * uAlphaA + rB * uAlphaB,
        gA * uAlphaA + gB * uAlphaB,
        bA * uAlphaA + bB * uAlphaB
    );

    // Caustic streaks: discrete Laplacian of height field
    float lap     = (hE + hW + hN + hS) * 0.25 - h;
    float caustic = max(0.0, -lap * uCausticScale);
    caustic       = pow(min(caustic, 1.6), uCausticSharpness) * uCausticStrength;

    vec3  causticTint = vec3(0.92, 0.97, 1.06);
    float globalAlpha = max(uAlphaA, uAlphaB);
    color += causticTint * caustic * globalAlpha;

    fragColor = vec4(color, uAlphaA + uAlphaB);
}
