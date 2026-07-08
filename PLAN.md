# Comet Rex — Improvement Plan

**Canonical source:** `showcase/comet-rex/` → after each work item, re-sync to `website/cloudflare/examples/comet-rex/`.
**Executor note:** Do ONE work item at a time. After each, run the acceptance check and update the checkbox. Do not start the next item until the current one passes. This keeps a subagent from drifting.

## Assessment (current state)

- `main.js` (~2,537 lines) already contains: a `planetManager`, breakable comet sections (`breakCometSection`, `updateCometSections`), a `BreakEmitter` particle system, a scoring/fuel loop, sun shadows, and — importantly — a **`journeyType`** concept with three datasets: `planetDataNormal`, `planetDataTour`, `planetDataOortCloud` (plus `reverse-tour`).
- **Gap:** `journeyType` is set in code, not chosen by the player. There is no start screen. The run begins mid-flight rather than launching from a planet. On-comet interactivity is limited, and the comet geometry is simple (no surface detail/caves).

## Performance / usability / features audit (do first)

- [x] **A1. Audit pass.** Read `main.js` end-to-end and write findings to `PLAN_NOTES.md`: where `journeyType` is read, how the comet mesh is built, the input handler, the main loop, and the current start/init sequence. List measured triangle counts from the HUD at boot. Acceptance: `PLAN_NOTES.md` exists with file/line references for each subsystem below.

## Work items

- [x] **W1 — Start screen + trajectory select.** Add a start overlay (HTML/CSS, hidden `#start-screen`) offering the existing journeys as cards: *Inner Planets*, *Grand Tour*, *Reverse Tour*, *Oort Cloud*. Selecting one sets `journeyType` and begins the run. Pause the sim until a choice is made. Acceptance: page loads to the menu; each choice starts a run using the matching `planetData*`; no console errors.
- [x] **W2 — Launch from outside a planet.** Add an intro state where the comet starts stationary just off a "home" planet's surface, then accelerates onto the trajectory when the player hits thrust. Reuse planet meshes; add a short camera ease-in. Acceptance: every run visibly begins beside a planet and departs on thrust.
- [x] **W3 — Bigger, detailed comet with caves.** Comet radius 30→40, stronger multi-octave relief (added a 4th noise octave), and 2–3 recessed cave pockets carved by a single-valued radial term (`caveInfluence`) applied after the crack clamp; cave interiors darkened via per-vertex colours. The 16-chunk Voronoi break system is preserved: `buildCometSections(segments)` still emits per-chunk displaced-sphere meshes carrying `userData.chunkCenter`, so `breakCometSection`/`updateCometSections` are unchanged. Added a **Comet Detail** quality toggle (32/48/64 segments-per-chunk) in Graphics Options that rebuilds the body; default lowered to 48 (was 64) to cut the triangle budget. Note: caves are bowl/pocket concavities, not boolean tunnels — a true tunnel would break the single-valued radial assumption the player-raycast and break system depend on. Acceptance: comet is visibly larger with surface relief and three cave openings; FPS not measurable in this no-browser sandbox (default detail lowered from prior state, so budget is reduced).
- [x] **W4 — More on-comet interactivity.** Three distinct inputs wired to score/state: (a) **Q/E strafe** added to the tangent move-intent (locomotion, enables collection), (b) **B** now player-triggers a section break that awards +300 and increments a "Mined" counter (auto-breaks stay unscored), (c) **crystal pickups** placed in/around each cave (`spawnCometPickups`), auto-collected on proximity for +750 and a "Crystals" counter, respawning ~4s after the last is taken. New HUD line shows Crystals/Mined. Acceptance: three distinct on-comet inputs affect score/state.
- [x] **W5 — Trajectory variety polish.** Added `journeyProfiles` (camera follow distance, camera height, world-speed mult, debris speed/interval, orbit colour) selected by `journeyType` into `activeProfile`, wired into camera framing, launch-ease target, `planetManager`/`debrisManager` speeds. The orbit path (`cometOrbitLine`) is now populated (`initOrbitPath` builds an inclined ring scaled to the active dataset's outermost planet, coloured per journey), parented to `cosmicRoot`, and shown by default (toggle `v`). Acceptance: the four journeys differ in framing/pace; orbit ring scales to the active dataset.

## Guardrails
- Keep it 100% client-side (Three.js via the existing import map). No new server calls.
- After W1–W5, run the movement test specs and do a manual boot check; then re-sync to `examples/comet-rex/` and confirm assets still resolve.
