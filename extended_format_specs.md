# 📘 VSL Extended Format Specifications

This document outlines future extensions to the Visual Scene Language (VSL).

## 🎨 Style
- `opacity`: 0.0 to 1.0
- `shadow`: parameters for drop-shadow (x, y, blur, color)
- `font`: font family, size, weight (for text)
- `stroke`: width, color, dash pattern

## 🧱 Material
- `texture`: URL or pattern reference
- `reflectivity`: 0.0 to 1.0
- `roughness`: 0.0 to 1.0

## 🌀 Animation
- `animate`: keyframe list (position, size, opacity over time)
- `duration`: ms
- `loop`: boolean
- `trigger`: event name

## 🧭 3D Coordinates
- `z`: depth
- `rotation`: angle in degrees or quaternion
- `perspective`: boolean or parameters
- `camera`: position, target, fov

## ⚙️ Behavior (future logic)
- `on_click`: action or transition
- `on_hover`: style change
- `condition`: if-else logic based on variables
- `stateful`: store and recall previous states

These extensions aim to provide semantic richness and dynamic interaction within scenes described for and by LLMs.
