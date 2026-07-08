# Comet Rex 🦖☄️

[![Made with FeatureBoard](https://img.shields.io/badge/Made_with-FeatureBoard-00c8ff?style=flat-square)](https://featureboard.ai) [![License: MIT](https://img.shields.io/badge/License-MIT-3fb950?style=flat-square)](./LICENSE)

A browser-based 3D space runner built with **Three.js** and **WebGL**. You ride a dino-astronaut on a comet, streaking past photo-textured planets of the solar system with a real-time particle comet tail, starfield, and sun flare. Runs entirely client-side — no server, no build step.

> One of the example projects built with [FeatureBoard](https://featureboard.ai).

## Live demo

Open `index.html` in any modern browser (or serve the folder statically). All rendering happens on the client via the GPU.

```bash
# any static server works, e.g.
npx serve .
# then open http://localhost:3000
```

## What's inside

| File | Role |
|------|------|
| `index.html` | Entry point; loads Three.js via import map + `stats.js` overlay |
| `main.js` | Game loop, scene assembly, input, camera, HUD |
| `Planet.js` | Textured planet bodies (day maps, rings, atmosphere) |
| `Stars.js` | Procedural starfield / milky-way backdrop |
| `CometTail.js` | GPU particle comet tail |
| `assets/` | Planet/sun textures and the `combo_dino_fixed.glb` rider model |

## Tech

- **Three.js 0.160** (loaded from CDN via `<script type="importmap">`)
- WebGL2, glTF (`.glb`) model loading, real 8K planetary texture maps
- Live FPS / triangle / draw-call stats overlay

## Notes

Only the assets actually referenced by the code ship here — the original working folder held ~245 MB of duplicate `.glb` exports and unused texture variants, which have been pruned. The playable build is self-contained.

## License

MIT © Lewis Valentine

## The AI-native approach

Built the FeatureBoard way — see [How We Build](https://featureboard.ai/approach.html):

- **Planning & metadata as substrate** — the game grew from a living `featurelist.md`/`TASKS.md`, not ad-hoc edits.
- **Radical verbosity** — a live FPS / triangle / draw-call / top-geometry HUD makes render provenance visible at runtime.
- **Validation over review** — feature and movement behaviour covered by executable test specs.
