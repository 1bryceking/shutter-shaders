#version 300 es
// Fullscreen quad — no vertex buffer needed. Matches fluid_vertex in FluidShader.metal.
out vec2 vUV;

void main() {
    // gl_VertexID: 0=BL, 1=BR, 2=TL, 3=TR
    float x = float(gl_VertexID & 1) * 2.0 - 1.0;
    float y = float((gl_VertexID >> 1) & 1) * 2.0 - 1.0;
    // Vertex maps screen-bottom (clip y=-1) → UV.y=0, screen-top (y=1) →
    // UV.y=1. Touch handler in FluidShader.js mirrors this — it flips
    // clientY when converting top-down screen coords into shader UV space,
    // so a pointer at the top of the canvas drives the warp at the top
    // of the image. (Old layout flipped Y here, which rendered the image
    // upside down; matches the fix in FluidShader.metal.)
    vUV = vec2(
        float(gl_VertexID & 1),
        float((gl_VertexID >> 1) & 1)
    );
    gl_Position = vec4(x, y, 0.0, 1.0);
}
