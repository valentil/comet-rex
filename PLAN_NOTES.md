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

## Polish round P1–P5 (implementation notes)

### P1 — Textual world-state validation (THE ENABLER)
- New pure module `sim/worldmodel.js` (THREE-free, UMD): `require()`s in Node and, in the browser,
  attaches `window.CometWorldModel` (loaded via `<script src="sim/worldmodel.js">` in `index.html`
  before the `main.js` module). It mirrors the ACTIVE world model (not the dormant Keplerian
  `updateCometOrbit`): comet pinned at render origin; `comet_solar = -cosmicRoot.position`; straight
  cruise drift `cosmicRoot.z += COMET_CRUISE_BASE(1400) * worldSpeedMult * dt`; planet circular orbits
  radius `a`, angle `= startAngle + (0.05/period)*0.1*elapsed` (tour+tourZ locked to 0); staging math
  mirrored from `stageHomePlanet()` (`comet_solar0 = homeLocal0 - desired`). Exposes
  `worldStateText()`, `worldStateJSON()`, `createInitialState()/step()`, `nearestPlanet()`,
  `cometPathSolar()/pathSummary()`, and `planetAngle0()`.
- Single source of truth: `main.js` seeds each planet's `data.startAngle =
  CometWorldModel.planetAngle0(journeyType, name)` (was `Math.random()`), and `Planet.js` honours it.
  So the live game's planet positions match the harness. `window.getWorldState()` /
  `window.getWorldStateText()` and a toggleable on-screen panel (`#worldstate-panel`, key **G**) read
  the SAME module from live state (journey, phase, `worldElapsed`, `cosmicRoot.position`, size).
- `sim/harness.js` steps the model per journey, prints a state trace + full-path summary, and asserts:
  path length > 0; `distanceTraveled` strictly increasing; `comet_solar.z` strictly decreasing; home
  world nearest at launch; every nearest entry a real planet; nearest changes ≥ once. `node
  sim/harness.js` -> RESULT: PASS for all 4 journeys.

### P2 — Full comet path preview
- `rebuildCometPath()` builds a magenta polyline from `CometWorldModel.cometPathSolar(journeyType)`
  (64 samples of the cruise line) + yellow closest-approach waypoint markers per planet, parented to
  `cosmicRoot` (so the comet at the origin slides along it). Toggled with the existing **V** key
  alongside the decorative W5 orbit ring. The same pass-order/lengths appear in the world-state text.

### P3 — Comet size options
- `cometRadius` is now `let cometRadius = BASE_COMET_RADIUS(40) * cometSizeScale`. `applyCometSize(scale)`
  (presets S/M/L/XL = 0.6/1.0/1.6/2.4, in Graphics Options) rescales radius, cave depths
  (`BASE_CAVE_DEPTHS`), snow core, rim glow, rebuilds the body+pickups via `rebuildComet`, refreshes the
  path preview, and updates camera framing via `followDist() = activeProfile.camDist * cometSizeScale`.
  Colliders/lose-check/camera-clip read `cometRadius` live so they track size. Size is reported in the
  world-state text/JSON (`cometRadius`, `sizeScale`). (Saucer easter-egg distance is a load-time const
  and does not rescale — intentional, negligible.)

### P4 — More detail (additive, within budget)
- Comet: additive `BackSide` rim glow sphere (~1 draw call, scales with size). Scene: two additive
  nebula billboard sprites far out in `cosmicRoot` (procedural radial-gradient canvas textures, ~2 draw
  calls). Body material / Milky Way skybox untouched (Lewis's look preserved).

### P5 — Polish grab-bag
- Persistent keys legend (bottom-right) + start-screen controls updated for V/G. World-state panel
  itself is the main HUD-clarity win. None of P5 touches world-model math (harness unaffected).

## P6 — Weaving grand-tour trajectory (steering / pursuit model)

**What changed.** The straight z-cruise is gone. In the pure `sim/worldmodel.js` the comet now holds a
constant cruise speed but *steers*: each step it turns its velocity toward the CURRENT position of its
next target planet, with a bounded turning radius, so it curves to fly close by each moving planet in
turn, then retargets. Planets keep orbiting every step. The world-anchor model is unchanged
(`cosmicRoot = -cometSolarPosition`; comet pinned at the render origin), and the game runs the SAME
`stepState()` the harness validates — single source of truth.

**The model, precisely (all in `sim/worldmodel.js`):**
- **State** (`createInitialState` / `stepState`): `cometPos`, `cometVel` (|v| = cruise speed), `target`,
  `visited{}`, per-planet `closest{}` (min distance + time + point), `approaching`, `prevTargDist`,
  derived `cosmicRoot = -cometPos`.
- **Steer** (`steerToward`): rotate the velocity toward `desired = targetPos - cometPos` by at most
  `omega*dt` radians, where `omega = cruiseSpeed / TURN_RADIUS` (Rodrigues rotation; antiparallel-safe).
  Using a constant `TURN_RADIUS` means faster journeys turn proportionally faster and every journey
  shares one geometric turning circle — this is the cap that keeps the path from spiralling/running away.
- **Target order** (`pickTarget`): nearest **not-yet-visited** planet by current position (dynamic
  greedy). Home world is marked visited at launch; the comet launches toward its first target (so it
  clearly departs home on a curve).
- **Retarget**: mark visited + repick when the comet is inside `FLYBY_FRACTION * threshold` of the
  target, OR the instant it passes closest approach (`approaching && distance rising`) **but only once
  it is genuinely close** (`distance < CAPTURE_MULT * threshold`) — the closeness gate is what stops a
  distant target being abandoned on a mid-course distance wobble (that bug made `normal` Uranus "visited"
  at 144 715 u before the fix). Once all planets are visited the comet coasts straight.
- **Per-planet close-flyby threshold** (`flybyThreshold`): `max(size*6, a*0.12, 800)` — a small multiple
  of the planet's size / a fraction of its orbital radius, floored so tiny inner worlds still get a
  defensible margin. Harness asserts closest approach < this for every planet.
- **Tuned params:** `TURN_RADIUS = 700`, `FLYBY_FRACTION = 0.55`, `CAPTURE_MULT = 4`. Iterated in the
  harness: `TURN_RADIUS` 900 left `tour` Mars at 1147 u (thr 900); 700/600/500 all PASS — 700 chosen to
  keep the arcs as grand as possible while every planet still passes.

**Path preview (P2) is now the steered curve.** `cometPathSolar` resamples the integrated `simulate()`
samples (a weaving polyline, not a ray); `pathSummary().planetsInPassOrder` carries each planet's actual
closest-approach `point`, so `main.js rebuildCometPath()` draws the curved path and places the yellow
waypoint markers on the real fly-by points. `simulate()` is memoized so the live 5 Hz debug panel /
preview don't re-integrate every call.

**Game wiring (`main.js`, all past the mount read cap):**
- `planetManager.update`: replaced `cosmicRoot.position.z += CRUISE*dt` with
  `CometWorldModel.stepState(worldSim, deltaTime)` + `cosmicRoot.position.set(worldSim.cosmicRoot…)`.
  `deltaTime` there is the scaled world dt, matching the planet-mesh updates and the `worldElapsed`
  clock, so steering and orbits stay in lockstep (planet angles use the same `startAngle` seed +
  `elapsed`). Straight-cruise kept only as a fallback if the module fails to load.
- `launchRun()`: creates `worldSim` seeded to the EXACT staged position (`-cosmicRoot.position`) so there
  is no jump/size change at launch, re-aims via `pickTarget`, and launches toward the first target.
- `rebuildCometPath()`: markers now use `p.point` (steered closest-approach) instead of a straight-line
  projection; the polyline uses the curved `cometPathSolar`.
- Untouched and still working: phase chain (menu/intro/playing/won/lost), break system, home staging,
  size options (S/M/L/XL), debug world-state panel (G), path/orbit toggle (V).

**Harness (`sim/harness.js`) rewrite + ACTUAL result.** For each journey it runs the full `simulate()`
and asserts: (1) path length > 0; (2) a CLOSE flyby of EVERY planet (closest approach < `flybyThreshold`);
(3) every planet visited; (4) bounded path (`maxCoord < 2.5*maxA + 5000`); (5) clear departure from home.
It prints each planet's closest-approach distance + time. **`node sim/harness.js` → RESULT: PASS for all
4 journeys.** Representative closest-approach numbers (u):
- normal: Neptune 809, Jupiter 1951, Earth 104, Mercury 109, Venus 100, Mars 266, Saturn 4169,
  Uranus 8127 (thresholds 27840/4800/960/800/900/1416/8880/17760); maxCoord 233 489 < 585 000.
- tour: Earth 261, Venus 89, Mercury 76, Mars 79, Uranus 6, Neptune 327, Saturn 987, Jupiter 5;
  maxCoord 16 032 < 47 500.
- reverse-tour: Mercury 295, Earth 701, Venus 121, Mars 216, Uranus 424, Jupiter 1357, Neptune 368,
  Saturn 2; maxCoord 18 376 < 47 500.
- oort-cloud: Uranus 887, Mars 312, Earth 252, Mercury 171, Venus 576, Jupiter 1503, Neptune 9250,
  Saturn 2; maxCoord 21 319 < 67 500.
The step trace shows the comet's `comet_solar (x,z)` swinging around (weaving), not a monotone z-line.

## Verification notes (no-browser + mount cap)
- `node --check` PASSES for `sim/worldmodel.js`, `sim/harness.js`, `Planet.js`. `node sim/harness.js`
  RESULT: PASS (4 journeys), now asserting a CLOSE FLYBY of every planet + bounded path (see P6 above).
- The Linux mount hard-caps `main.js` reads at the original ~110,609 bytes (positioned reads past the
  cap return 0), so a whole-file `node --check main.js` on the mount only validates up to ~line 2473.
  That range PASSES and covers the pre-cap edits (size scale, angle-sync, glow, nebula, applyCometSize,
  size UI, V/G handlers). The one substantial past-cap block (the P1 world-state/P2 path block) was
  syntax-checked standalone (PASS). All `main.js` changes were made via exact-match edits at statement
  boundaries. Could NOT verify in-browser rendering/booting (no browser in sandbox).
- **P6 (2026-07):** the four P6 `main.js` edits (steered cruise in `planetManager.update`, `let worldSim`,
  `launchRun` sim init, `rebuildCometPath` markers) all land past the ~line-2474 cap, so they are NOT
  visible to a mount `node --check`. Verified instead as prior runs did: `node --check main.js` PASSES the
  pre-cap range (1..2474), and all four authored P6 blocks were extracted and `node --check`ed standalone
  (PASS). `sim/worldmodel.js` + `sim/harness.js` were rewritten larger than their capped originals, so
  they were re-installed via a native (bash) write to reset the mount read cap; both then `node --check`
  PASS in full and `node sim/harness.js` runs the whole file. No browser available to confirm the live
  weave renders, but the game runs the identical `stepState()` the harness proves.

## HUD cleanup (2026-07-08) — hide debug panels, de-clutter/de-overlap the on-screen HUD
Pure HUD/CSS/default-visibility pass. **No game logic, physics, world model (`sim/`), cruise, break
system, size options, or pickups were touched.** Changes:
- **Debug stats panel OFF by default.** `main.js` `let debugStats = true;` -> `false` (~line 127). Also
  added `display: none;` to the inline `#stats-panel` rule in `index.html` (belt-and-suspenders so there
  is no first-frame flash before the animate loop runs). Visibility is still gated on `debugStats` in the
  animate loop (`statsPanel.style.display = debugStats ? 'block' : 'none'`) and toggled live by the
  "Performance Stats" checkbox in Graphics Options (`statsCheckbox.checked = debugStats` reflects the new
  default; its `onchange` still flips both). `Top Geometries` / `Debug:` readouts are debug-only, so they
  are hidden with the panel. The COMET REX title (top-right) no longer sits under the stats panel.
- **World-state panel (`G` key) already OFF by default** — confirmed, no change needed: `#worldstate-panel`
  is `display:none` in `index.html` and `let showWorldState = false;` in `main.js` (~line 2806). `G` still
  toggles it via `updateWorldStatePanel()`.
- **Gameplay HUD re-stacked as a tidy top-left column** (all `left:20px`), moved BELOW the menu-button row
  (Options / Graphics Options live at `top:20px`) so nothing overlaps the menu or each other. New `top`
  values in `main.js`: `scoreElement` 20->**68px**, `multiplierElement` 50->**102px**,
  `milestoneElement` (Approaching / SOI line) 60->**132px**, `crystalHud` (Crystals | Mined) 84->**164px**.
  Previously `multiplier`(50) and `milestone`(60) overlapped, and the whole column collided with
  `optionsMenuContainer` at `top:20px/left:20px`.
- **Menu panels made mutually exclusive.** `toggleOptionsButton` and `graphicsOptionsToggleButton` click
  handlers now hide the other panel when opening one, so the Options panel and the Graphics Options panel
  can never stack on top of each other — only ONE clean overlay shows at a time; closing returns cleanly.

### Verification (HUD pass)
- `node --check` on `main.js`: NOTE a gotcha — because `main.js` uses top-level ESM `import`, `node --check
  main.js` (CJS mode) silently passes even on a broken file (an appended unterminated `{` still exits 0).
  So it was checked as an ES module: `cp main.js /tmp/main.mjs && node --check /tmp/main.mjs` -> **exit 0
  (PASS)**, and the negative control (same file + `let zzz = {`) correctly **exit 1**, proving the check is
  real. This validated the WHOLE file (3167 lines), not just the pre-~2474 mount-cap range — `node` reads
  from disk directly, so the Read-tool 110KB cap does not apply to `node --check`.
- ID cross-check: every `getElementById` in `main.js` (`stats-panel`, `fps-val`, `tri-val`, `draw-val`,
  `top-geos`, `worldstate-panel`, `start-screen`) resolves to an id present in `index.html`. `debug-info`
  exists in HTML as an empty display-only div (no JS ref) — harmless, left as-is.
- Toggle-default consistency confirmed: `debugStats=false` <-> `statsCheckbox.checked=false` <-> CSS
  `display:none` <-> animate-loop gate; `showWorldState=false` <-> `#worldstate-panel display:none`.
- **Could NOT visually confirm in a browser** (no browser/CDN in the sandbox, and Three.js loads from a
  CDN import map). Layout `top` offsets were chosen with headroom vs. font sizes (24/18/20/16px) but the
  exact pixel spacing is unverified on-screen.
