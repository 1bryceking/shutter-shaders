#version 300 es
// Fullscreen quad — no vertex buffer needed. Matches fluid_vertex in FluidShader.metal.
out vec2 vUV;

void main() {
    // gl_VertexID: 0=BL, 1=BR, 2=TL, 3=TR
    float x = float(gl_VertexID & 1) * 2.0 - 1.0;
    float y = float((gl_VertexID >> 1) & 1) * 2.0 - 1.0;
    // UV: Metal convention — origin top-left, Y flipped from clip space
    vUV = vec2(
        float(gl_VertexID & 1),
        1.0 - float((gl_VertexID >> 1) & 1)
    );
    gl_Position = vec4(x, y, 0.0, 1.0);
}
