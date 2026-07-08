// sim/worldmodel.js
// ---------------------------------------------------------------------------
// Comet Rex — PURE world-model mirror (P1 + P6).
//
// This module contains NO THREE.js and NO DOM. It mirrors the world-model math
// implemented in main.js so the world can be reasoned about / iterated on as
// TEXT, with no renderer. It is:
//   * require()-able in Node (CommonJS)      -> sim/harness.js
//   * loadable in the browser via <script>   -> window.CometWorldModel
// The live game (main.js) runs the SAME stepState() integration each frame and
// drives cosmicRoot from it, so the game and this module are a single source of
// world-model truth.
//
// ---- The world model, in one paragraph (P6: weaving grand tour) ------------
// The comet is pinned at the render origin. The solar system lives under a
// `cosmicRoot` group whose position is translated to move the world past the
// comet ("world-anchor" model): the comet's position in the SOLAR frame is
// exactly -cosmicRoot.position. Instead of a straight z-cruise, the comet now
// STEERS: it holds a constant cruise speed but turns its velocity toward the
// CURRENT position of its next target planet with a BOUNDED turn rate
// (TURN_RATE rad/s). Planets keep riding their circular orbits every step, so
// the comet curves to fly close by each moving planet in turn. When the comet
// reaches a target (inside that planet's flyby radius, or just after passing
// its closest approach) it retargets the nearest not-yet-visited planet. The
// home world is treated as already-departed at launch. Because the target set
// is finite and inside the system and the speed/turn are capped, the path is
// bounded and cannot spiral away. Once every planet is visited the comet coasts
// straight. This mirrors the ACTIVE game model; the dormant Keplerian
// updateCometOrbit() path in main.js is intentionally disabled.
// ---------------------------------------------------------------------------

(function (root, factory) {
    var mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod; // Node
    if (root) root.CometWorldModel = mod;                                   // browser
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ---- Constants mirrored verbatim from main.js / Planet.js ----
    var COMET_CRUISE_BASE = 1400;      // main.js: world units/sec at worldSpeedMult=1
    var BASE_COMET_RADIUS = 40;        // main.js: cometRadius
    var ORBIT_SPEED_K     = 0.05;      // Planet.js: orbitSpeed = 0.05 / period
    var ORBIT_ANGLE_RATE  = 0.1;       // Planet.js: orbitalAngle += orbitSpeed * dt * 0.1
    var ORBITAL_TIME_RATE = 0.1;       // main.js:   orbitalTime += dt * timeScale * 0.1 * secondsPerYear
    var SECONDS_PER_YEAR  = 31557600;  // main.js
    var GOLDEN_ANGLE      = 2.399963229728653; // deterministic, well-spread planet start angles

    // ---- P6 steering parameters (the tunables the harness iterates on) ----
    // TURN_RADIUS: the comet's MINIMUM turning radius in world units. The per-step
    //   angular cap is derived as omega = cruiseSpeed / TURN_RADIUS, so a faster
    //   journey turns proportionally faster and every journey shares the SAME
    //   geometric turning circle. This is the real bound that keeps the path from
    //   spiralling/running away. Smaller = tighter weaves + closer flybys; larger =
    //   grander arcs but risks skimming small inner worlds. 900 u nails a close
    //   flyby of every planet on all four journeys (see sim/harness.js output).
    var TURN_RADIUS = 700;
    // Effective turn rate at the base cruise speed, exposed for readouts only.
    var TURN_RATE = COMET_CRUISE_BASE / TURN_RADIUS; // ~2.0 rad/s at worldSpeedMult=1
    // Flyby retarget radius = a fraction of each planet's own visit threshold; the
    // comet also retargets the instant it passes closest approach (but only once it
    // is genuinely close — see CAPTURE_MULT), so it neither orbits a world forever
    // nor abandons a distant target on a spurious mid-course distance wobble.
    var FLYBY_FRACTION = 0.55;
    // A "passed closest approach" retarget only counts once the comet is within
    // CAPTURE_MULT * flybyThreshold of the target; farther than that, a temporary
    // distance increase is just mid-course curvature, so keep pursuing.
    var CAPTURE_MULT = 4;

    // ---- Planet datasets (orbital / scale fields mirrored from main.js) ----
    // Only the fields the world model needs (name, a, size, period, belt bounds).
    var planetDataNormal = [
        { name: 'Neptune', a: 232000, size: 630, period: 165 },
        { name: 'Uranus',  a: 148000, size: 650, period: 84 },
        { name: 'Saturn',  a: 74000,  size: 500, period: 29 },
        { name: 'Jupiter', a: 40000,  size: 600, period: 12 },
        { name: 'Asteroid Belt', isBelt: true, a_min: 12000, a_max: 38000, count: 20000 },
        { name: 'Mars',    a: 11800,  size: 85,  period: 1.88 },
        { name: 'Earth',   a: 7700,   size: 160, period: 1.0 },
        { name: 'Venus',   a: 5600,   size: 150, period: 0.62 },
        { name: 'Mercury', a: 3000,   size: 60,  period: 0.24 }
    ];
    var planetDataTour = [
        { name: 'Neptune', a: 11000, size: 300, period: 165, tourZ: 10000 },
        { name: 'Uranus',  a: 9500,  size: 320, period: 84,  tourZ: 8500 },
        { name: 'Saturn',  a: 17000, size: 500, period: 29 },
        { name: 'Jupiter', a: 13000, size: 600, period: 12 },
        { name: 'Asteroid Belt', isBelt: true, a_min: 4000, a_max: 4200, count: 1000 },
        { name: 'Mars',    a: 3000,  size: 150, period: 1.88, tourZ: 3000 },
        { name: 'Mercury', a: 300,   size: 60,  period: 0.24, tourZ: 300 },
        { name: 'Venus',   a: 550,   size: 200, period: 0.62, tourZ: 550 },
        { name: 'Earth',   a: 800,   size: 180, period: 1.0,  tourZ: 800 }
    ];
    var planetDataOortCloud = [
        { name: 'Neptune', a: 25000, size: 3000, period: 165 },
        { name: 'Uranus',  a: 21000, size: 320,  period: 84 },
        { name: 'Saturn',  a: 17000, size: 500,  period: 29 },
        { name: 'Jupiter', a: 13000, size: 600,  period: 12 },
        { name: 'Asteroid Belt', isBelt: true, a_min: 9000, a_max: 11000, count: 2000 },
        { name: 'Mars',    a: 6000,  size: 200,  period: 1.88 },
        { name: 'Mercury', a: 300,   size: 60,   period: 0.24 },
        { name: 'Venus',   a: 550,   size: 200,  period: 0.62 },
        { name: 'Earth',   a: 800,   size: 180,  period: 1.0 }
    ];

    // ---- Per-journey profiles (mirrors main.js journeyProfiles) ----
    var JOURNEY_PROFILES = {
        'normal':       { label: 'Inner Planets', home: 'Neptune', worldSpeedMult: 1,   camDist: 4 },
        'tour':         { label: 'Grand Tour',    home: 'Earth',   worldSpeedMult: 2,   camDist: 6 },
        'reverse-tour': { label: 'Reverse Tour',  home: 'Mercury', worldSpeedMult: 2,   camDist: 6 },
        'oort-cloud':   { label: 'Oort Cloud',    home: 'Uranus',  worldSpeedMult: 1.5, camDist: 9 }
    };

    function datasetFor(journey) {
        if (journey === 'tour' || journey === 'reverse-tour') return planetDataTour;
        if (journey === 'oort-cloud') return planetDataOortCloud;
        return planetDataNormal;
    }
    function profileFor(journey) {
        return JOURNEY_PROFILES[journey] || JOURNEY_PROFILES['normal'];
    }
    function realPlanets(journey) {
        return datasetFor(journey).filter(function (p) { return !p.isBelt; });
    }
    function planetByName(journey, name) {
        var ds = datasetFor(journey);
        for (var i = 0; i < ds.length; i++) if (ds[i].name === name) return ds[i];
        return null;
    }

    // ---- tiny vec3 helpers (plain objects, no THREE) ----
    function v3(x, y, z) { return { x: x, y: y, z: z }; }
    function add(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
    function sub(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
    function neg(a) { return v3(-a.x, -a.y, -a.z); }
    function scale(a, s) { return v3(a.x * s, a.y * s, a.z * s); }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function cross(a, b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
    function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
    function normalize(a) { var l = len(a); return l > 1e-12 ? v3(a.x / l, a.y / l, a.z / l) : v3(0, 0, 0); }
    function clampNum(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
    function copy(a) { return v3(a.x, a.y, a.z); }
    function fmt(a, d) { d = d == null ? 1 : d; return '(' + a.x.toFixed(d) + ', ' + a.y.toFixed(d) + ', ' + a.z.toFixed(d) + ')'; }

    // Closest distance from point p to segment [a,b], plus the closest point.
    function segPointClosest(a, b, p) {
        var ab = sub(b, a);
        var abLen2 = dot(ab, ab);
        var t = abLen2 > 1e-12 ? clampNum(dot(sub(p, a), ab) / abLen2, 0, 1) : 0;
        var q = add(a, scale(ab, t));
        return { dist: len(sub(p, q)), point: q, t: t };
    }

    // ---- Deterministic per-planet starting orbital angle ----
    function journeyOffset(journey) {
        var s = 0;
        for (var i = 0; i < journey.length; i++) s += journey.charCodeAt(i) * (i + 1);
        return (s % 360) * Math.PI / 180;
    }
    function planetAngle0(journey, name) {
        var planets = realPlanets(journey);
        var idx = 0;
        for (var i = 0; i < planets.length; i++) if (planets[i].name === name) { idx = i; break; }
        var a = journeyOffset(journey) + idx * GOLDEN_ANGLE;
        a = a % (Math.PI * 2);
        if (a < 0) a += Math.PI * 2;
        return a;
    }

    // ---- Planet position in the SOLAR frame (mirrors Planet.update) ----
    function planetLocalPos(journey, name, elapsed) {
        var p = planetByName(journey, name);
        if (!p || p.isBelt) return null;
        var angle;
        if (journey === 'tour' && p.tourZ !== undefined) {
            angle = 0; // main.js Planet.update locks tour planets to angle 0
        } else {
            var orbitSpeed = ORBIT_SPEED_K / (p.period || 1);
            angle = planetAngle0(journey, name) + orbitSpeed * ORBIT_ANGLE_RATE * elapsed;
        }
        return v3(Math.cos(angle) * p.a, 0, Math.sin(angle) * p.a);
    }

    // ---- Cruise speed (mirrors COMET_CRUISE_BASE * worldSpeedMult) ----
    function cruiseSpeed(journey) {
        return COMET_CRUISE_BASE * profileFor(journey).worldSpeedMult;
    }
    // Initial launch velocity: along -z at cruise speed (matches the legacy launch
    // so the comet visibly departs the staged home world), then steering curves it.
    function cometVelocity(journey) {
        return v3(0, 0, -cruiseSpeed(journey));
    }

    // ---- Comet start (mirrors stageHomePlanet) ----
    // stageHomePlanet places the home world at `desired` off the comet; since
    // comet_solar = -cosmicRoot and cosmicRoot0 = desired - homeLocal0, we get
    // comet_solar0 = homeLocal0 - desired.
    function cometStartSolar(journey, cometRadius) {
        var prof = profileFor(journey);
        var ds = datasetFor(journey);
        var home = planetByName(journey, prof.home);
        if (!home || home.isBelt) {
            for (var i = 0; i < ds.length; i++) { if (!ds[i].isBelt) { home = ds[i]; break; } }
        }
        var homeSize = home.size || 100;
        var r = (cometRadius == null ? BASE_COMET_RADIUS : cometRadius);
        var homeLocal0 = planetLocalPos(journey, home.name, 0);
        var homeDist = homeSize * 2.2 + r + 120;              // main.js stageHomePlanet
        var desired = v3(homeSize * 0.6, -homeSize * 0.4, -homeDist);
        return sub(homeLocal0, desired);
    }
    function cosmicRootStart(journey, cometRadius) {
        return neg(cometStartSolar(journey, cometRadius));
    }

    // ---- Per-planet visit / flyby thresholds ----
    // A "close flyby" threshold that scales with the planet: a small multiple of
    // its rendered size OR a fraction of its orbital radius (whichever is larger),
    // with a floor so tiny inner worlds still get a defensible margin. The harness
    // asserts closest approach < flybyThreshold; the steering retargets inside
    // FLYBY_FRACTION of it.
    function flybyThreshold(journey, name) {
        var p = planetByName(journey, name);
        if (!p) return 1000;
        return Math.max((p.size || 100) * 6, (p.a || 0) * 0.12, 800);
    }
    function flybyRadius(journey, name) {
        return flybyThreshold(journey, name) * FLYBY_FRACTION;
    }

    // ---- Turn the velocity toward `desired` by at most maxDelta radians ----
    // Bounded, 3D, stable even when current & desired are antiparallel.
    function steerToward(vel, desired, speed, maxDelta) {
        var cur = normalize(vel);
        var des = normalize(desired);
        if (len(des) < 1e-9) return scale(cur, speed);
        var d = clampNum(dot(cur, des), -1, 1);
        var ang = Math.acos(d);
        if (ang <= maxDelta || ang < 1e-6) return scale(des, speed); // can reach desired this step
        // Rotate `cur` toward `des` by maxDelta about their common perpendicular.
        var axis = cross(cur, des);
        if (len(axis) < 1e-9) {
            // (near) antiparallel: pick any stable perpendicular axis to start the turn
            axis = cross(cur, v3(0, 1, 0));
            if (len(axis) < 1e-9) axis = cross(cur, v3(1, 0, 0));
        }
        axis = normalize(axis);
        // Rodrigues rotation of cur about axis by maxDelta
        var c = Math.cos(maxDelta), s = Math.sin(maxDelta);
        var term1 = scale(cur, c);
        var term2 = scale(cross(axis, cur), s);
        var term3 = scale(axis, dot(axis, cur) * (1 - c));
        var out = normalize(add(add(term1, term2), term3));
        return scale(out, speed);
    }

    // ---- Steering state (used by harness stepping AND by the live game) ----
    function allVisited(state) {
        var planets = realPlanets(state.journey);
        for (var i = 0; i < planets.length; i++) {
            if (!state.visited[planets[i].name]) return false;
        }
        return true;
    }
    // Nearest not-yet-visited planet to `pos` at time `elapsed`.
    function pickTarget(state) {
        var planets = realPlanets(state.journey);
        var best = null, bestD = Infinity;
        for (var i = 0; i < planets.length; i++) {
            var nm = planets[i].name;
            if (state.visited[nm]) continue;
            var d = len(sub(planetLocalPos(state.journey, nm, state.elapsed), state.cometPos));
            if (d < bestD) { bestD = d; best = nm; }
        }
        state.target = best;
        state.approaching = false;
        state.prevTargDist = Infinity;
        return best;
    }

    function createInitialState(journey, opts) {
        opts = opts || {};
        var sizeScale = opts.sizeScale == null ? 1 : opts.sizeScale;
        var cometRadius = opts.cometRadius == null ? BASE_COMET_RADIUS * sizeScale : opts.cometRadius;
        var pos = opts.startPos ? copy(opts.startPos) : cometStartSolar(journey, cometRadius);
        var speed = cruiseSpeed(journey);
        var state = {
            journey: journey,
            phase: opts.phase || 'playing',
            elapsed: 0,
            orbitalTime: 650 / 2,                 // main.js: orbitalPeriodYears/2
            sizeScale: sizeScale,
            cometRadius: cometRadius,
            speed: speed,
            cometPos: pos,
            cometVel: v3(0, 0, -speed),           // launch along -z
            cosmicRoot: neg(pos),
            target: null,
            visited: {},
            approaching: false,
            prevTargDist: Infinity,
            pathLen: 0,
            closest: {},
            done: false
        };
        // Home world counts as already departed at launch.
        state.visited[profileFor(journey).home] = true;
        realPlanets(journey).forEach(function (p) {
            state.closest[p.name] = { dist: Infinity, t: 0, point: copy(pos) };
        });
        pickTarget(state);
        if (state.target) {
            var tp0 = planetLocalPos(journey, state.target, 0);
            var dir0 = normalize(sub(tp0, pos));
            if (len(dir0) > 1e-9) state.cometVel = scale(dir0, speed);
        }
        return state;
    }

    // One integration step of the steering model. Identical logic runs in the
    // Node harness (via simulate) and in the live game (via step). dt = seconds.
    function stepState(state, dt) {
        if (dt <= 0) return state;
        var journey = state.journey;
        var planets = realPlanets(journey);

        // 1) steer velocity toward the current target's CURRENT position
        if (state.target) {
            var tp = planetLocalPos(journey, state.target, state.elapsed);
            var desired = sub(tp, state.cometPos);
            var maxDelta = (state.speed / TURN_RADIUS) * dt; // bounded, constant-radius turn
            state.cometVel = steerToward(state.cometVel, desired, state.speed, maxDelta);
        }
        // 2) advance position at constant cruise speed
        var newPos = add(state.cometPos, scale(state.cometVel, dt));
        var newElapsed = state.elapsed + dt;

        // 3) record closest approach to EVERY planet along this segment (robust to
        //    step size; planet sampled at the segment's end time).
        for (var i = 0; i < planets.length; i++) {
            var nm = planets[i].name;
            var pp = planetLocalPos(journey, nm, newElapsed);
            var c = segPointClosest(state.cometPos, newPos, pp);
            if (c.dist < state.closest[nm].dist) {
                state.closest[nm] = { dist: c.dist, t: state.elapsed + c.t * dt, point: copy(c.point) };
            }
        }

        // 4) retarget logic: reached target if inside its flyby radius, OR the
        //    instant we pass closest approach (distance stopped decreasing).
        if (state.target) {
            var tEnd = planetLocalPos(journey, state.target, newElapsed);
            var td = len(sub(tEnd, newPos));
            if (td < state.prevTargDist - 1e-6) state.approaching = true;
            var thr = flybyThreshold(journey, state.target);
            var reached = td <= thr * FLYBY_FRACTION;
            var passed = state.approaching && td > state.prevTargDist + 1e-6 && td < thr * CAPTURE_MULT;
            if (reached || passed) {
                state.visited[state.target] = true;
                pickTarget(state);
            } else {
                state.prevTargDist = td;
            }
        }

        state.pathLen += len(sub(newPos, state.cometPos));
        state.cometPos = newPos;
        state.elapsed = newElapsed;
        state.cosmicRoot = neg(newPos);
        state.orbitalTime += dt * ORBITAL_TIME_RATE * SECONDS_PER_YEAR;
        if (allVisited(state)) state.done = true;
        return state;
    }
    // Public step alias (the live game calls this each frame).
    function step(state, dt) { return stepState(state, dt); }

    // ---- Full run simulation (harness + path preview share this) ----
    function autoMaxTime(journey) {
        var maxA = 0;
        realPlanets(journey).forEach(function (p) { if (p.a > maxA) maxA = p.a; });
        return 24 * (maxA / cruiseSpeed(journey)) + 300; // generous safety cap
    }
    // Memoized so worldStateText()/pathSummary()/cometPathSolar() don't re-run the
    // whole integration at 5 Hz in the live game. Keyed by journey + radius + dt.
    var _simCache = {};
    function simulate(journey, opts) {
        opts = opts || {};
        var cometRadius = opts.cometRadius == null ? BASE_COMET_RADIUS : opts.cometRadius;
        var dt = opts.dt == null ? 0.25 : opts.dt;
        var coastSteps = opts.coastSteps == null ? 8 : opts.coastSteps;
        var key = journey + '|' + cometRadius.toFixed(3) + '|' + dt + '|' + coastSteps;
        if (!opts.noCache && _simCache[key]) return _simCache[key];

        var maxTime = opts.maxTime == null ? autoMaxTime(journey) : opts.maxTime;
        var state = createInitialState(journey, { cometRadius: cometRadius, startPos: opts.startPos });
        var samples = [{ t: 0, x: state.cometPos.x, y: state.cometPos.y, z: state.cometPos.z }];
        var maxCoord = len(state.cometPos);
        var coast = 0;
        while (state.elapsed < maxTime) {
            stepState(state, dt);
            samples.push({ t: state.elapsed, x: state.cometPos.x, y: state.cometPos.y, z: state.cometPos.z });
            var r = len(state.cometPos);
            if (r > maxCoord) maxCoord = r;
            if (state.done) { coast++; if (coast >= coastSteps) break; }
        }
        var result = {
            journey: journey,
            samples: samples,
            closest: state.closest,
            visited: state.visited,
            allVisited: allVisited(state),
            elapsed: state.elapsed,
            pathLen: state.pathLen,
            maxCoord: maxCoord,
            finalPos: copy(state.cometPos)
        };
        if (!opts.noCache) _simCache[key] = result;
        return result;
    }
    function clearSimCache() { _simCache = {}; }

    // ---- Derived quantities from a live state ----
    function cometSolar(state) { return state.cometPos ? copy(state.cometPos) : neg(state.cosmicRoot); }
    function planetDistances(state) {
        var out = [];
        var planets = realPlanets(state.journey);
        var comet = cometSolar(state);
        for (var i = 0; i < planets.length; i++) {
            var local = planetLocalPos(state.journey, planets[i].name, state.elapsed);
            out.push({ name: planets[i].name, dist: len(sub(local, comet)), world: add(state.cosmicRoot, local), solar: local });
        }
        out.sort(function (a, b) { return a.dist - b.dist; });
        return out;
    }
    function nearestPlanet(state) {
        var d = planetDistances(state);
        return d.length ? d[0] : null;
    }
    function distanceTraveled(state) {
        if (state.pathLen != null) return state.pathLen; // true arc-length while stepping
        var start = cometStartSolar(state.journey, state.cometRadius);
        return len(sub(cometSolar(state), start));
    }

    // ---- Full path preview (P2) — now the STEERED (curved) path ----
    function defaultHorizon(journey) {
        return simulate(journey).elapsed;
    }
    // Sampled comet path in SOLAR coordinates. These points double as cosmicRoot-
    // local coordinates for the in-game polyline (comet slides through them as the
    // world scrolls). Resampled to `samples` points for the drawn polyline.
    function cometPathSolar(journey, opts) {
        opts = opts || {};
        var cometRadius = opts.cometRadius == null ? BASE_COMET_RADIUS : opts.cometRadius;
        var samples = opts.samples == null ? 64 : opts.samples;
        var sim = simulate(journey, { cometRadius: cometRadius });
        var src = sim.samples;
        if (src.length <= samples) return src.map(function (p) { return { t: p.t, x: p.x, y: p.y, z: p.z }; });
        var out = [];
        for (var i = 0; i <= samples; i++) {
            var idx = Math.round((i / samples) * (src.length - 1));
            var p = src[idx];
            out.push({ t: p.t, x: p.x, y: p.y, z: p.z });
        }
        return out;
    }
    // Path summary: length, and each real planet's closest approach + time + point,
    // ordered by pass time -> the "planets passed in order" list.
    function pathSummary(journey, opts) {
        opts = opts || {};
        var cometRadius = opts.cometRadius == null ? BASE_COMET_RADIUS : opts.cometRadius;
        var sim = simulate(journey, { cometRadius: cometRadius });
        var per = realPlanets(journey).map(function (p) {
            var c = sim.closest[p.name];
            return { name: p.name, minDist: c.dist, tClosest: c.t, point: copy(c.point) };
        });
        per.sort(function (a, b) { return a.tClosest - b.tClosest; });
        return {
            journey: journey,
            length: sim.pathLen,
            duration: sim.elapsed,
            speed: cruiseSpeed(journey),
            maxCoord: sim.maxCoord,
            allVisited: sim.allVisited,
            waypoints: cometPathSolar(journey, { cometRadius: cometRadius, samples: opts.pathSamples || 32 }),
            planetsInPassOrder: per
        };
    }

    // ---- Text + JSON snapshots ----
    function worldStateJSON(state) {
        var prof = profileFor(state.journey);
        var comet = cometSolar(state);
        var near = nearestPlanet(state);
        var summary = pathSummary(state.journey, { cometRadius: state.cometRadius });
        return {
            journey: state.journey,
            journeyLabel: prof.label,
            phase: state.phase,
            elapsed: state.elapsed,
            orbitalTimeYears: state.orbitalTime,
            cometRadius: state.cometRadius,
            sizeScale: state.sizeScale,
            cometPosSolar: comet,
            cometVelocity: state.cometVel ? copy(state.cometVel) : cometVelocity(state.journey),
            cometSpeed: cruiseSpeed(state.journey),
            target: state.target || null,
            distanceTraveled: distanceTraveled(state),
            pathLength: summary.length,
            nearestPlanet: near ? { name: near.name, dist: near.dist } : null,
            planetDistances: planetDistances(state).map(function (p) { return { name: p.name, dist: p.dist }; }),
            planetsInPassOrder: summary.planetsInPassOrder.map(function (p) {
                return { name: p.name, minDist: p.minDist, tClosest: p.tClosest };
            })
        };
    }

    function worldStateText(state) {
        var prof = profileFor(state.journey);
        var comet = cometSolar(state);
        var near = nearestPlanet(state);
        var dists = planetDistances(state);
        var summary = pathSummary(state.journey, { cometRadius: state.cometRadius });
        var L = [];
        L.push('COMET REX — world state');
        L.push('journey : ' + prof.label + ' (' + state.journey + ')   phase: ' + state.phase);
        L.push('elapsed : ' + state.elapsed.toFixed(1) + ' s    orbital: ' + state.orbitalTime.toFixed(1) + ' yr');
        L.push('comet   : R=' + state.cometRadius.toFixed(1) + '  (size ' + state.sizeScale.toFixed(2) + 'x)');
        L.push('pos     : ' + fmt(comet, 0) + '  [solar frame]');
        L.push('vel     : ' + fmt(state.cometVel || cometVelocity(state.journey), 0) + '  speed ' + cruiseSpeed(state.journey).toFixed(0) + ' u/s');
        L.push('target  : ' + (state.target || 'coasting (all visited)'));
        L.push('traveled: ' + distanceTraveled(state).toFixed(0) + ' u  (full steered path len ' + summary.length.toFixed(0) + ' u)');
        L.push('nearest : ' + (near ? near.name + '  d=' + near.dist.toFixed(0) + ' u' : 'n/a'));
        L.push('planets (by current distance):');
        for (var i = 0; i < dists.length; i++) {
            L.push('   ' + pad(dists[i].name, 8) + ' d=' + pad(dists[i].dist.toFixed(0), 9) + '  ' + fmt(dists[i].world, 0));
        }
        var order = summary.planetsInPassOrder.map(function (p) {
            return p.name + '(' + p.minDist.toFixed(0) + '@' + p.tClosest.toFixed(0) + 's)';
        });
        L.push('path    : ' + summary.waypoints.length + ' waypoints; flyby order -> ' + order.join(' > '));
        return L.join('\n');
    }
    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    // ---- Public API ----
    return {
        // constants / data
        COMET_CRUISE_BASE: COMET_CRUISE_BASE,
        BASE_COMET_RADIUS: BASE_COMET_RADIUS,
        TURN_RATE: TURN_RATE,
        FLYBY_FRACTION: FLYBY_FRACTION,
        JOURNEY_PROFILES: JOURNEY_PROFILES,
        datasetFor: datasetFor,
        profileFor: profileFor,
        realPlanets: realPlanets,
        // math
        planetAngle0: planetAngle0,
        planetLocalPos: planetLocalPos,
        cruiseSpeed: cruiseSpeed,
        cometStartSolar: cometStartSolar,
        cometVelocity: cometVelocity,
        cosmicRootStart: cosmicRootStart,
        cometSolar: cometSolar,
        planetDistances: planetDistances,
        nearestPlanet: nearestPlanet,
        distanceTraveled: distanceTraveled,
        flybyThreshold: flybyThreshold,
        flybyRadius: flybyRadius,
        // steering / state
        createInitialState: createInitialState,
        stepState: stepState,
        step: step,
        pickTarget: pickTarget,
        allVisited: allVisited,
        simulate: simulate,
        clearSimCache: clearSimCache,
        // path (P2/P6)
        defaultHorizon: defaultHorizon,
        cometPathSolar: cometPathSolar,
        pathSummary: pathSummary,
        // snapshots
        worldStateText: worldStateText,
        worldStateJSON: worldStateJSON
    };
});
