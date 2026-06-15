#!/usr/bin/env python3
"""Generate Groundtruth extension icons (no third-party deps).

A rounded-square deep-graphite tile (matching the app's Iris dark palette
bg-base #0e0f13) with the Groundtruth 3-node network mark:
  - Three colored nodes on a circle: contradicted orange, accent violet, crosscheck teal
  - A bright center dot
  - Thin connector lines between the nodes

Run: python3 generate_icons.py
"""
import struct
import zlib
import math

SIZES = [16, 48, 128]

# Iris dark palette colors
BG_COLOR = (0x0E, 0x0F, 0x13)       # --bg-base
ACCENT    = (0x7C, 0x5C, 0xFF)       # --accent (iris violet)
C_CONTR   = (0xF8, 0x84, 0x3A)       # --v-contradicted (orange)
C_CHECK   = (0x2D, 0xD4, 0xBF)       # --v-crosscheck (teal)
C_WHITE   = (0xED, 0xEE, 0xF3)       # --text-primary (near-white)
C_LINE    = (0x6D, 0x70, 0x80)       # --text-muted (line color)


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def smoothstep(e0, e1, x):
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def build(size):
    radius_corner = size * 0.22
    f = 1.5 / size   # feather width in normalized units

    # Node positions in normalized [0,1] coords — same as SVG in the app
    # top-center, bottom-left, bottom-right  (equilateral triangle on circle r=0.35)
    cx, cy, cr = 0.5, 0.5, 0.35
    nodes = [
        (cx + cr * math.cos(math.radians(-90)),      cy + cr * math.sin(math.radians(-90)),      C_CONTR),   # top
        (cx + cr * math.cos(math.radians(-90 + 120)), cy + cr * math.sin(math.radians(-90 + 120)), ACCENT),    # bottom-left
        (cx + cr * math.cos(math.radians(-90 + 240)), cy + cr * math.sin(math.radians(-90 + 240)), C_CHECK),   # bottom-right
    ]
    center_node = (cx, cy, C_WHITE)

    # Node radii in normalized coords
    node_r   = 0.085
    center_r = 0.065

    # Line half-thickness
    line_half = 0.018

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter byte
        for x in range(size):
            # Start with background
            r, g, b = BG_COLOR
            alpha = 255.0

            # Rounded corner mask
            px_norm = x / max(size - 1, 1)
            py_norm = y / max(size - 1, 1)

            corner_x = min(x, size - 1 - x)
            corner_y = min(y, size - 1 - y)
            if corner_x < radius_corner and corner_y < radius_corner:
                d = math.hypot(radius_corner - corner_x, radius_corner - corner_y)
                alpha = 255.0 * (1.0 - smoothstep(radius_corner - 1.2, radius_corner + 0.2, d))

            # Draw connector lines between each pair of nodes (below nodes in z-order)
            for i in range(3):
                nx1, ny1, _ = nodes[i]
                nx2, ny2, _ = nodes[(i + 1) % 3]
                d_line = dist_to_segment(px_norm, py_norm, nx1, ny1, nx2, ny2)
                line_mask = 1.0 - smoothstep(line_half - f, line_half + f, d_line)
                if line_mask > 0.01:
                    r = int(lerp_color((r, g, b), C_LINE, line_mask)[0])
                    g = int(lerp_color((r, g, b), C_LINE, line_mask)[1])
                    b = int(lerp_color((r, g, b), C_LINE, line_mask)[2])
                    # recompute after first channel (simplified — just blend toward line color)
                    bg_r, bg_g, bg_b = BG_COLOR
                    r = int(bg_r + (C_LINE[0] - bg_r) * line_mask)
                    g = int(bg_g + (C_LINE[1] - bg_g) * line_mask)
                    b = int(bg_b + (C_LINE[2] - bg_b) * line_mask)

            # Draw outer nodes
            for nx, ny, nc in nodes:
                d_node = math.hypot(px_norm - nx, py_norm - ny)
                node_mask = 1.0 - smoothstep(node_r - f, node_r + f, d_node)
                if node_mask > 0.01:
                    r = int(r + (nc[0] - r) * node_mask)
                    g = int(g + (nc[1] - g) * node_mask)
                    b = int(b + (nc[2] - b) * node_mask)

            # Draw center node (on top)
            d_center = math.hypot(px_norm - center_node[0], py_norm - center_node[1])
            center_mask = 1.0 - smoothstep(center_r - f, center_r + f, d_center)
            if center_mask > 0.01:
                nc = center_node[2]
                r = int(r + (nc[0] - r) * center_mask)
                g = int(g + (nc[1] - g) * center_mask)
                b = int(b + (nc[2] - b) * center_mask)

            rows += bytes((
                max(0, min(255, r)),
                max(0, min(255, g)),
                max(0, min(255, b)),
                max(0, min(255, int(alpha + 0.5))),
            ))
    return bytes(rows)


def png_chunk(tag, data):
    chunk = tag + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)


def write_png(path, size):
    raw = build(size)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", ihdr)
    png += png_chunk(b"IDAT", zlib.compress(raw, 9))
    png += png_chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote", path, size)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for s in SIZES:
        write_png(os.path.join(here, f"icon{s}.png"), s)
