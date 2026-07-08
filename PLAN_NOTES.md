# Comet Rex — Audit Notes (A1)

Audit of `main.js` (2537 lines) plus `index.html`, `style.css`. File/line references are to the
pre-W1 state of `showcase/comet-rex/`.

## journeyType — where it is set and read
- **Parsed** from URL at `main.js:143-144`: `const journeyType = urlParams.get('journey') || 'normal'`.
  It is a `const`, fixed at module load. Never reassigned.
- **Dataset selection** at `main.js:1087`:
  `const planetData = (journeyType === 'tour' || 'reverse-tour') ? planetDataTour : (journeyType === 'oort-cloud' ? planetDataOortCloud : planetDataNormal)`.
  Datasets: `planetDataNormal` (1051), `planetDataTour` (1063), `planetDataOortCloud` (1075).
- **Speed multipliers** read at `main.js:2037` (planetManager.update: `tour`/`reverse-tour` → 2×) and
  `main.js:2176` (debrisManager.update: `tour`/`reverse-tour` → 15×).
- **Logs only**: 145, 900-ish, 1900.
- **KEY CONSEQUENCE:** `planetData` and every dependent object (milestone label `1139`, teleport
  dropdown `1383`, `planetManager` `1909`, rotation-speed assignment `1109`) are built at module load
  from the const `journeyType`. There is **no runtime path** to re-choose the journey without
  re-running module init. This drives the W1 design decision (see below).

## Comet mesh construction
- Radius: `cometRadius = 30` at `main.js:515` (`window.cometRadius` shared with CometTail).
- Shared radial noise field: `radialDisplacement(dir)` `429-449` (3-octave sine noise, crack depth clamped).
- Shared procedural bump texture: `getSharedBumpTex()` `452-511` (512² canvas, craters + cracks).
- Body = 16 Voronoi "jigsaw" chunks (`numChunks = 16`, `524`). Loop `535-609`: each chunk is a full
  `SphereGeometry(30, 64, 64)`, vertices not belonging to the chunk collapsed to origin, kept vertices
  displaced by `radialDisplacement` and scaled by `oblongScale (1.3,1.0,0.8)` `533`. Material `593-604`.
  Meshes pushed to `cometSections[]` `520`.
- `snowCore` inner sphere `614-617`; all sections + core added to `comet` Group `611/618-619`.
- Comet added to scene at origin `623-625`; local point lights `628-632`.
- **Breakable-section system:** `breakCometSection()` `773-841` (peels/drifts a random chunk,
  spawns a `BreakEmitter` `9-105`); `updateCometSections(deltaTime)` `846-898` (peel → drift → cleanup).
  Triggered by key `b` (`1575`) and randomly each frame (`2358`).

## Input handler
- Movement state object `playerMovement` `1517-1523` (`forward/backward/left/right/jump` + ad-hoc
  `moving`/`sprinting`).
- `keydown` `1568-1589`: WASD/arrows → move; `space` → jump; `b` → `breakCometSection()`;
  `v` → toggle orbit line + planet labels; `shift` → sprint.
- `keyup` `1590-1598` clears the same.
- Mouse: `mousedown/up` set `isPanning` `1539-1540`; `mousemove` orbit yaw/pitch `1541-1553`;
  `wheel` zoom `1556-1563`.
- Touch: thirds-of-screen left/jump/right `1601-1616`.
- Global restart click handler `2530-2534` (reloads page when not `playing`).

## Main loop
- `animate()` `2275-2528`, self-scheduled via `requestAnimationFrame` `2277`; kicked off at `2536`.
- Stats/HUD block `2279-2319` (FPS/triangles/draw-calls into `#fps-val`/`#tri-val`/`#draw-val`,
  top-5 geometries into `#top-geos`).
- Game logic gated by `if (planetManager.gameState === 'playing')` `2324`:
  `planetManager.update` `2328` → `updatePlayerPosition` `2332` → anim mixer `2335-2347` →
  `updateScore` `2348` → cometTail/debris/sections `2349-2351` → occasional `spawnFuel`/`breakCometSection`
  `2355-2358` → `updateSunShadows` `2360` → lose check `2367-2378`. Then `won` `2379`/`lost` `2385` branches.
- Camera framing block `2402-2447` runs **unconditionally** (surface-relative orbit cam), then
  `renderer.render` `2464`, then sun-flare occlusion/scaling `2465-2526`.

## Current start / init sequence (module top-to-bottom, no explicit init function)
1. Imports `1-7`; `BreakEmitter` class `9-105`.
2. Scene/loaders/skybox/fog/clock `114-166`; `cosmicRoot` group `139`.
3. `journeyType` parsed `144`.
4. Quality presets `191-225`; camera `229`; renderer `235-243`; lights `250-256`.
5. Audio/shake/score/collectibles UI `260-423`.
6. Comet build `428-632`; sun build `634-729`.
7. Saucer easter egg `903-937`; comet tail `940`; player physics constants `1035-1043`.
8. Planet datasets + `planetData` selection `1051-1087`; rotation speeds `1089-1124`.
9. HUD/options/graphics/teleport UI (all created in JS) `1132-1461`.
10. `initializePlayerAndCamera()` def `1465-1484`; async GLTF load of dino `1486-1514`
    (falls back to `createProceduralDino()` `948-1032` on error). Player added asynchronously.
11. Input listeners `1516-1616`.
12. `planetManager` object `1909-2120` — **planets are spawned lazily** inside `update()` the first
    time it runs (`currentPlanetIndex === 0` block `2000-2026`), not at module load.
13. Resize handler `2122`; debris manager `2130-2221`; comet-orbit helpers `2223-2272`.
14. `animate()` defined `2275`; global restart click `2530`; `animate()` invoked `2536`.

**Notable:** the world anchor `cosmicRoot` is **never translated** in the active code path
(the `cosmicRoot.position.z -= ...` line `2075` and `updateCometOrbit()` call `2330` are commented out).
The comet is permanently at the origin; the sense of a "journey" comes from planets orbiting the sun
(via `orbitalTime`) and debris drifting past. This matters for W2: "launching from a planet" is
achieved by offsetting `cosmicRoot` so a home planet sits near the origin during an intro hold, then
releasing orbital-time advancement on thrust so the planet visibly recedes.

## Triangle counts (HUD)
Could **NOT** be measured from the live HUD — this Linux sandbox has no browser and no network access
to the Three.js CDN, so the scene cannot render and `renderer.info.render.triangles` is unavailable.
Code-derived estimates (per-geometry, matching how the HUD's `#top-geos` traversal counts):
- Comet: 16 chunks × `SphereGeometry(30,64,64)` ≈ 16 × 8,192 ≈ **131,072 tris** (collapsed verts still
  counted as degenerate tris), plus `snowCore` `SphereGeometry` 64×64 ≈ **8,192**.
- Sun: `SphereGeometry(150,64,64)` ≈ **8,192**; skybox `SphereGeometry(...,32,32)` ≈ **2,048**.
- Asteroid belt: `InstancedMesh(DodecahedronGeometry(15,0))` — geometry counted once (~36 tris) but
  instance count is 20,000 (normal) / 1,000 (tour) / 2,000 (oort). Real GPU load is high; HUD per-mesh
  view under-reports instanced meshes.
These are estimates only; treat measured numbers as unknown until a browser run is possible.

## W1 design decision (recorded here, implemented below)
Because `journeyType` is a module-load `const` feeding a pervasive `planetData` const, the safest
100%-client-side way to let the player choose a journey is: show a start overlay on first load (no
`?journey=` param) with the sim paused, and have each card navigate to `?journey=<type>` (a reload).
On reload the param is present, the correct `planetData*` is built, the menu is skipped, and the run
begins. This avoids a large, error-prone lazy-init refactor of every `planetData`-dependent object and
satisfies the acceptance ("page loads to the menu; each choice starts a run using the matching
planetData*; no console errors"). Trade-off: choosing a journey costs one page reload rather than an
in-place swap. Documented as an intentional, low-risk choice.
