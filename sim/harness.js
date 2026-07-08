// sim/harness.js
// ---------------------------------------------------------------------------
// Comet Rex — world-model harness (P1 + P6). Node-only tooling.
//
//   node sim/harness.js            -> run all journeys
//   node sim/harness.js normal     -> run one journey
//
// Steps the PURE world model (sim/worldmodel.js, THREE-free) over a full run and
// asserts the P6 "weaving grand tour" invariants:
//   1. path length > 0
//   2. the comet achieves a CLOSE FLYBY of EVERY planet: closest approach along
//      the whole run is below that planet's flybyThreshold (a small multiple of
//      its size / a fraction of its orbital radius, floored).
//   3. every planet is actually visited (the steering retargets through them all).
//   4. the path stays BOUNDED — no runaway to huge coordinates (maxCoord below a
//      multiple of the outermost planet's orbital radius).
//   5. the comet clearly DEPARTS the home world at launch (its distance from home
//      grows well past the staging gap early in the run).
// Prints each planet's closest-approach distance + time. Exits non-zero on any
// assertion failure.
// ---------------------------------------------------------------------------

var W = require('./worldmodel.js');

var JOURNEYS = ['normal', 'tour', 'reverse-tour', 'oort-cloud'];
var arg = process.argv[2];
if (arg) JOURNEYS = [arg];

var SIM_DT = 0.15;            // fine integration for accurate closest-approach
var TRACE_ROWS = 12;
var failures = [];

function assert(cond, journey, msg) {
    if (!cond) failures.push('[' + journey + '] ' + msg);
    return cond;
}

function runJourney(journey) {
    var prof = W.profileFor(journey);
    var planets = W.realPlanets(journey);
    var maxA = 0;
    planets.forEach(function (p) { if (p.a > maxA) maxA = p.a; });

    var sim = W.simulate(journey, { dt: SIM_DT, noCache: true });

    console.log('\n============================================================');
    console.log(' JOURNEY: ' + prof.label + ' (' + journey + ')');
    console.log('   home=' + prof.home + '  worldSpeedMult=' + prof.worldSpeedMult +
                '  cruise=' + W.cruiseSpeed(journey).toFixed(0) + ' u/s' +
                '  TURN_RATE=' + W.TURN_RATE + ' rad/s  dt=' + SIM_DT + 's');
    console.log('   run: ' + sim.elapsed.toFixed(1) + 's  steered path len ' +
                sim.pathLen.toFixed(0) + ' u  maxCoord ' + sim.maxCoord.toFixed(0) + ' u' +
                '  allVisited=' + sim.allVisited);
    console.log('============================================================');

    // ---- Per-planet closest approach (the P6 metric) ----
    console.log(' Closest approach to each planet (flyby order):');
    console.log('   planet    |  closest u |   thresh u | @ t(s) | flyby?');
    console.log('   ----------+------------+------------+--------+-------');
    var order = W.realPlanets(journey).map(function (p) {
        var c = sim.closest[p.name];
        return { name: p.name, dist: c.dist, t: c.t, thresh: W.flybyThreshold(journey, p.name) };
    }).sort(function (a, b) { return a.t - b.t; });

    order.forEach(function (o) {
        var ok = o.dist < o.thresh;
        console.log('   ' + rpad(o.name, 9) + ' | ' + lpad(o.dist.toFixed(0), 10) + ' | ' +
                    lpad(o.thresh.toFixed(0), 10) + ' | ' + lpad(o.t.toFixed(1), 6) + ' | ' +
                    (ok ? 'YES' : '**NO**'));
    });

    // ---- Coarse step trace ----
    console.log('\n   t(s)   |    comet_solar (x,y,z)          | traveled | target   | nearest (dist)');
    console.log('   -------+---------------------------------+----------+----------+----------------');
    var traceState = W.createInitialState(journey);
    var traceDt = sim.elapsed / TRACE_ROWS;
    for (var i = 0; i <= TRACE_ROWS; i++) {
        var comet = W.cometSolar(traceState);
        var near = W.nearestPlanet(traceState);
        console.log('   ' + lpad(traceState.elapsed.toFixed(1), 6) + '  | ' +
                    rpad('(' + comet.x.toFixed(0) + ',' + comet.y.toFixed(0) + ',' + comet.z.toFixed(0) + ')', 31) + ' | ' +
                    lpad(W.distanceTraveled(traceState).toFixed(0), 8) + ' | ' +
                    rpad(traceState.target || '(coast)', 8) + ' | ' +
                    rpad(near.name, 8) + ' ' + near.dist.toFixed(0));
        if (i < TRACE_ROWS) {
            // advance the trace state to the next trace time in fine sub-steps
            var target = (i + 1) * traceDt;
            while (traceState.elapsed < target - 1e-9) {
                W.stepState(traceState, Math.min(SIM_DT, target - traceState.elapsed));
            }
        }
    }

    console.log('\n --- worldStateText() at end of run ---');
    console.log(indent(W.worldStateText(traceState)));

    // ---- Invariants ----
    var boundLimit = maxA * 2.5 + 5000;
    var homeStart = W.cometStartSolar(journey);
    var homeClosest = sim.closest[prof.home];
    // How far the comet ends up from where it started (clear departure).
    var departure = 0;
    sim.samples.forEach(function (s) {
        var d = Math.sqrt((s.x - homeStart.x) * (s.x - homeStart.x) +
                          (s.y - homeStart.y) * (s.y - homeStart.y) +
                          (s.z - homeStart.z) * (s.z - homeStart.z));
        if (d > departure) departure = d;
    });

    assert(sim.pathLen > 0, journey, 'path length must be > 0 (got ' + sim.pathLen + ')');
    var allClose = true;
    order.forEach(function (o) {
        var ok = assert(o.dist < o.thresh, journey,
            'planet ' + o.name + ' closest ' + o.dist.toFixed(0) + ' u must be < threshold ' + o.thresh.toFixed(0) + ' u');
        if (!ok) allClose = false;
    });
    assert(sim.allVisited, journey, 'every planet must be visited by the steering retarget logic');
    assert(sim.maxCoord < boundLimit, journey,
        'path must stay bounded: maxCoord ' + sim.maxCoord.toFixed(0) + ' u must be < ' + boundLimit.toFixed(0) + ' u');
    assert(departure > 1000, journey,
        'comet must clearly depart home at launch (max departure ' + departure.toFixed(0) + ' u)');

    console.log('\n invariants: pathLen>0=' + (sim.pathLen > 0) +
                '  allCloseFlybys=' + allClose +
                '  allVisited=' + sim.allVisited +
                '  bounded=' + (sim.maxCoord < boundLimit) +
                '  departsHome=' + (departure > 1000) +
                '   (maxCoord ' + sim.maxCoord.toFixed(0) + ' < ' + boundLimit.toFixed(0) + ')');
}

function rpad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function indent(s) { return s.split('\n').map(function (l) { return '   ' + l; }).join('\n'); }

JOURNEYS.forEach(runJourney);

console.log('\n============================================================');
if (failures.length) {
    console.log(' RESULT: FAIL (' + failures.length + ' invariant violation(s))');
    failures.forEach(function (f) { console.log('   - ' + f); });
    process.exit(1);
} else {
    console.log(' RESULT: PASS — every planet gets a close flyby; path bounded for ' + JOURNEYS.length + ' journey(s).');
    process.exit(0);
}
