console.log('SDGB-29: main.js loaded');
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Planet } from './Planet.js';
import { CometTail } from './CometTail.js';
import { Stars } from './Stars.js';

class BreakEmitter {
    constructor(scene, direction, origin) {
        this.scene = scene;
        this.direction = direction.clone().normalize();
        this.maxParticles = 2000;
        this.particles = new Float32Array(this.maxParticles * 3);
        this.lifetimes = new Float32Array(this.maxParticles);
        this.ages = new Float32Array(this.maxParticles);
        this.velocities = new Float32Array(this.maxParticles * 3);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.particles, 3));
        const material = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.15,
            transparent: false,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.points = new THREE.Points(geometry, material);
        this.scene.add(this.points);
        this.active = true;
        this.spawnIndex = 0;
        
        // Initial setup of particles to avoid visible jump
        for(let i=0; i<this.maxParticles; i++) {
            this.particles[i*3] = 10000;
            this.lifetimes[i] = 0;
        }
    }

    update(deltaTime, currentPos) {
        if (!this.active) return;

        // Spawn new particles at current position
        const spawnCount = 5;
        for (let i = 0; i < spawnCount; i++) {
            const idx = this.spawnIndex * 3;
            
            // Hollow circle logic: slightly wider than piece, hole 1/3 size
            const radius = 25.5; 
            const innerRadius = radius / 3;
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random() * (1 - Math.pow(innerRadius/radius, 2)) + Math.pow(innerRadius/radius, 2)) * radius;
            
            // Create a coordinate system relative to direction
            const up = new THREE.Vector3(0, 1, 0);
            const tangent = new THREE.Vector3().crossVectors(this.direction, up);
            if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
            tangent.normalize();
            const bitangent = new THREE.Vector3().crossVectors(this.direction, tangent).normalize();

            const offset = new THREE.Vector3()
                .addScaledVector(tangent, Math.cos(angle) * r)
                .addScaledVector(bitangent, Math.sin(angle) * r);

            this.particles[idx] = currentPos.x + offset.x;
            this.particles[idx+1] = currentPos.y + offset.y;
            this.particles[idx+2] = currentPos.z + offset.z;

            // Velocity is mostly in break direction but with some spread
            const v = this.direction.clone().multiplyScalar(1.0).add(offset.multiplyScalar(0.005));
            this.velocities[idx] = v.x;
            this.velocities[idx+1] = v.y;
            this.velocities[idx+2] = v.z;

            this.lifetimes[this.spawnIndex] = 1.0 + Math.random() * 1.5;
            this.ages[this.spawnIndex] = 0;
            if (this.points.material.opacity < 1.0) this.points.material.opacity = 1.0;
            this.spawnIndex = (this.spawnIndex + 1) % this.maxParticles;
        }

        // Update existing particles
        const pos = this.points.geometry.attributes.position.array;
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.ages[i] < this.lifetimes[i]) {
                const idx = i * 3;
                pos[idx] += this.velocities[idx] * deltaTime;
                pos[idx+1] += this.velocities[idx+1] * deltaTime;
                pos[idx+2] += this.velocities[idx+2] * deltaTime;
                this.ages[i] += deltaTime;
            } else {
                pos[i*3] = currentPos.x; pos[i*3+1] = currentPos.y; pos[i*3+2] = currentPos.z;
            }
        }
        this.points.geometry.attributes.position.needsUpdate = true;
    }

    destroy() {
        this.active = false;
        this.scene.remove(this.points);
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points = null;
    }
}

let orbitPathPoints = [];
let cometOrbitLine;
const maxOrbitPoints = 500;
const orbitLineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 });
let showCometPath = false;


// --- Scene Setup ---
const scene = new THREE.Scene();
const textureLoader = new THREE.TextureLoader();
let showPlanetLabels = false;
window.showPlanetLabels = showPlanetLabels;

// Milky Way Skybox (SD23) - moved up to avoid multiple loaders
const milkyWayTexture = textureLoader.load('assets/8k_stars_milky_way.jpg');
milkyWayTexture.colorSpace = THREE.SRGBColorSpace;
milkyWayTexture.minFilter = THREE.LinearFilter; // Faster than mipmapping for skybox

// Loading Manager for better UI/feedback
const loadingManager = new THREE.LoadingManager();
let debugStats = true;
const statsPanel = document.getElementById('stats-panel');
loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    console.log(`Loading: ${Math.round(itemsLoaded / itemsTotal * 100)}%`);
};
const gltfLoader = new GLTFLoader(loadingManager);

// --- Performance Stats Variables ---
let lastStatsTime = performance.now();
let frames = 0;

// SDGF-25: Cosmic Root Object (the stationary point)
const cosmicRoot = new THREE.Group();
scene.add(cosmicRoot);

// Parse URL for journey type
const urlParams = new URLSearchParams(window.location.search);
const journeyType = urlParams.get('journey') || 'normal';
console.log(`Starting ${journeyType} journey...`);

// W1/W2: run-phase state machine.
//   'menu'    -> start overlay is showing, sim paused (only the comet renders behind it)
//   'intro'   -> staged just off the home planet, waiting for the player to hit thrust (W2)
//   'playing' -> normal run
// A journey is chosen by navigating to ?journey=<type>; on that reload the menu is skipped.
const journeyChosen = urlParams.has('journey');
let gamePhase = journeyChosen ? 'intro' : 'menu';

// Wire the start overlay (element lives in index.html). Each card sets journeyType via a reload,
// which is the safe client-side path given planetData is built from journeyType at module load.
const startScreenEl = document.getElementById('start-screen');
if (startScreenEl) {
    if (gamePhase === 'menu') {
        startScreenEl.classList.remove('hidden');
        startScreenEl.querySelectorAll('.journey-card').forEach((card) => {
            card.addEventListener('click', () => {
                const chosen = card.getAttribute('data-journey') || 'normal';
                const params = new URLSearchParams(window.location.search);
                params.set('journey', chosen);
                window.location.search = params.toString();
            });
        });
    } else {
        startScreenEl.classList.add('hidden');
    }
}

// Starfield background
// Starfield background (now handled by Stars.js particle system)
// Milky Way Skybox (SD23)
const skyboxGeometry = new THREE.SphereGeometry(5000000, 32, 32); // Large sphere for Milky Way
const skyboxMaterial = new THREE.MeshBasicMaterial({ map: milkyWayTexture, side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false });
console.log('SDGB-48: Skybox Material Properties:', {
    map: skyboxMaterial.map,
    side: skyboxMaterial.side,
    transparent: skyboxMaterial.transparent,
    opacity: skyboxMaterial.opacity,
    depthTest: skyboxMaterial.depthTest,
    depthWrite: skyboxMaterial.depthWrite
});
const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial);

// --- Fog ---
scene.fog = new THREE.FogExp2(0x000000, 0.00005); // Reduced fog density significantly

// --- Clock ---
const clock = new THREE.Clock();
let mixer;
let walkAction, idleAction, runAction;
let currentAction;

function transitionTo(nextAction, duration) {
    if (nextAction && nextAction !== currentAction) {
        const previousAction = currentAction;
        currentAction = nextAction;

        // Reset the new animation so it starts from the beginning
        currentAction.enabled = true;
        currentAction.time = 0;
        currentAction.setEffectiveWeight(1);
        currentAction.setEffectiveTimeScale(1);

        // Crossfade: fade out old, fade in new
        if (previousAction) {
            previousAction.crossFadeTo(currentAction, duration, true);
        }
        
        currentAction.play();
    }
}

// --- Graphics & Quality Settings (SDGF-19) ---
const qualitySettings = {
    LOW: { shadows: false, antialias: false, particleTTL: 0.5, shadowMapSize: 256, pixelRatio: 0.7, geometryScale: 0.5 },
    MEDIUM: { shadows: true, antialias: true, particleTTL: 1.0, shadowMapSize: 512, pixelRatio: 0.9, geometryScale: 0.8 },
    ULTRA: { shadows: true, antialias: true, particleTTL: 2.0, shadowMapSize: 1024, pixelRatio: window.devicePixelRatio || 1.0, geometryScale: 1.0 }
};

window.currentQuality = qualitySettings.LOW; // Default to LOW for better first load

function applyQuality(preset) {
    console.log(`Applying quality preset: ${preset}`);
    window.currentQuality = qualitySettings[preset];
    
    if (renderer) {
        renderer.setPixelRatio(window.currentQuality.pixelRatio);
        renderer.shadowMap.enabled = window.currentQuality.shadows;
        renderer.shadowMap.type = THREE.BasicShadowMap; // Faster than PCFSoft
        
        // Re-generate geometry at lower res if needed? (Too complex for simple preset toggle)
    }
    
    // Update existing materials/lights if necessary
    scene.traverse(node => {
        if (node.isLight) {
            node.castShadow = window.currentQuality.shadows;
            if (node.shadow) {
                node.shadow.mapSize.set(window.currentQuality.shadowMapSize, window.currentQuality.shadowMapSize);
                if (node.shadow.map) {
                    node.shadow.map.dispose();
                    node.shadow.map = null;
                }
            }
        }
    });
}


// --- Camera Setup ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10000);
camera.position.set(0, 0.5, 1);
scene.add(skybox); console.log('SDGB-48: Skybox added to scene. Initial visible:', skybox.visible); // Milky Way Skybox added to scene
camera.far = 9999999;
camera.updateProjectionMatrix(); // Always call this after manual changes!
// --- Renderer Setup ---
const renderer = new THREE.WebGLRenderer({ 
    antialias: window.currentQuality.antialias,
    powerPreference: "high-performance" 
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = window.currentQuality.shadows;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.setPixelRatio(window.currentQuality.pixelRatio);
document.body.appendChild(renderer.domElement);

// const stars = new Stars(scene, camera); // Temporarily disabled for debugging Milky Way
// const stars = new Stars(scene, camera); 


// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Much darker ambient
scene.add(ambientLight);

// SDGF-40: Global sunlight direction (Sun is at origin in cosmicRoot)
const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0); // Increased intensity
directionalLight.castShadow = true;
scene.add(directionalLight);

// The Sun will be the main light source (added later in the Sun section)

// --- Screen Shake Effect ---
let shakeIntensity = 0;
function triggerShake(intensity = 0.5) {
    shakeIntensity = intensity;
    playSound('collision');
}

// --- Audio System (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'jump') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(15, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'collision') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(10, now);
        osc.frequency.exponentialRampToValueAtTime(4, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'fuel') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'ufo') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(20, now);
        osc.frequency.sineCurveToValueAtTime = (f, t) => {
             for(let i=0; i<10; i++) osc.frequency.setValueAtTime(f + Math.sin(i)*5, t + i*0.05);
        };
        osc.frequency.setValueAtTime(20, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
    }
}

function updateShake(deltaTime) {
    if (shakeIntensity > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity -= deltaTime * 2;
    }
}

function triggerMilestoneEffect(planetName, bonus) {
    const effect = document.createElement('div');
    effect.style.position = 'absolute';
    effect.style.left = '50%';
    effect.style.top = '20%';
    effect.style.transform = 'translate(-50%, -50%)';
    effect.style.color = '#ffff00';
    effect.style.fontFamily = 'Arial, sans-serif';
    effect.style.fontSize = '40px';
    effect.style.fontWeight = 'bold';
    effect.style.textShadow = '2px 2px #ff0000';
    effect.style.pointerEvents = 'none';
    effect.innerHTML = `${planetName} REACHED!<br>+${bonus}`;
    console.log('[SDGB-26] Created Milestone Effect Element', effect);
    document.body.appendChild(effect);

    playSound('fuel'); // Use fuel sound for reward

    let opacity = 1;
    const interval = setInterval(() => {
        opacity -= 0.02;
        effect.style.opacity = opacity;
        effect.style.top = (parseFloat(effect.style.top) - 0.5) + '%';
        if (opacity <= 0) {
            clearInterval(interval);
            document.body.removeChild(effect);
        }
    }, 20);
}

// --- Collectibles (Fuel) ---
const collectibles = [];
function spawnFuel() {
    const geo = new THREE.OctahedronGeometry(0.04);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x888800 });
    const mesh = new THREE.Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    mesh.position.set(Math.sin(angle) * (cometRadius + 0.1), 0.1, Math.cos(angle) * (cometRadius + 0.1));
    scene.add(mesh);
    collectibles.push(mesh);
}

// --- Game Title ---
const titleElement = document.createElement('div');
titleElement.style.position = 'absolute';
titleElement.style.top = '20px';
titleElement.style.right = '20px';
titleElement.style.color = 'white';
titleElement.style.fontFamily = 'Arial, sans-serif';
titleElement.style.fontSize = '32px';
titleElement.style.fontWeight = 'bold';
titleElement.innerHTML = 'COMET REX';
document.body.appendChild(titleElement);

// --- Scoring ---
let score = 0;
let highestScore = 0;
const scoreElement = document.createElement('div');
scoreElement.style.position = 'absolute';
scoreElement.style.top = '20px';
scoreElement.style.left = '20px';
scoreElement.style.color = 'white';
scoreElement.style.fontFamily = 'Arial, sans-serif';
scoreElement.style.fontSize = '24px';
scoreElement.innerHTML = 'Score: 0';
document.body.appendChild(scoreElement);

const multiplierElement = document.createElement('div');
multiplierElement.style.position = 'absolute';
multiplierElement.style.top = '50px';
multiplierElement.style.left = '20px';
multiplierElement.style.color = '#00ff00';
multiplierElement.style.fontFamily = 'Arial, sans-serif';
multiplierElement.style.fontSize = '18px';
multiplierElement.style.fontWeight = 'bold';
multiplierElement.innerHTML = 'Multiplier: 1.0x';
document.body.appendChild(multiplierElement);

let scoreMultiplier = 1.0;
let survivalTime = 0;
const milestoneBasePoints = 5000;

function updateScore(deltaTime) {
    survivalTime += deltaTime;

    // Survival time adds to score
    const baseGain = deltaTime * 100;

    // Multiplier increases slightly over time
    scoreMultiplier = 1.0 + (survivalTime * 0.05);

    // Cap multiplier
    if (scoreMultiplier > 10.0) scoreMultiplier = 10.0;

    score += baseGain * scoreMultiplier;

    if (score > highestScore) highestScore = score;

    scoreElement.innerHTML = `Score: ${Math.floor(score)}`;
    multiplierElement.innerHTML = `Multiplier: ${scoreMultiplier.toFixed(1)}x`;
}

// --- Game Objects ---


// W3: recessed cave pockets. Directions/size/depth are populated just before the comet
// is built (see the `cometCaves = [...]` assignment near the comet section).
let cometCaves = [];

// W3: how far (world units) to push the surface INWARD at `dir` to carve a cave, plus a
// 0..1 "insideness" factor used to darken the cave interior. Deliberately kept as a
// single-valued radial term so each chunk stays a displaced sphere. The break system
// (chunkCenter-based drift) and the player physics (radial ray from above finds one
// surface) both depend on that contract, so caves are bowl/pocket concavities rather than
// true boolean tunnels.
function caveInfluence(dir) {
    let depth = 0;
    let factor = 0;
    for (let c = 0; c < cometCaves.length; c++) {
        const cave = cometCaves[c];
        const ang = dir.angleTo(cave.dir);
        if (ang < cave.radius) {
            const t = ang / cave.radius;              // 0 at cave center -> 1 at rim
            const bowl = Math.cos(t * Math.PI * 0.5); // smooth 1 -> 0 falloff
            const f = bowl * bowl;
            depth += cave.depth * f;
            if (f > factor) factor = f;
        }
    }
    return { depth, factor };
}

// --- Shared radial displacement field (all shells conform to this) ---
function radialDisplacement(dir) {
    const freq1 = 2.5;        // Large scale noise
    const amp1  = 5.2;        // W3: stronger relief for the larger, more detailed comet (was 4.0)

    const freq2 = 8.0;        // Medium scale noise
    const amp2  = 1.6;        // W3: (was 1.25)

    const freq3 = 20.0;       // Fine surface noise
    const amp3  = 0.9;        // W3: (was 0.75)

    const freq4 = 42.0;       // W3: extra fine crag detail
    const amp4  = 0.35;

    const n1 = Math.sin(dir.x * freq1) + Math.cos(dir.y * freq1) + Math.sin(dir.z * freq1);
    const n2 = Math.sin(dir.x * freq2 + 1.2) + Math.sin(dir.y * freq2 + 0.5) + Math.sin(dir.z * freq2);
    const n3 = Math.cos(dir.x * freq3 + 0.7) + Math.cos(dir.y * freq3) + Math.cos(dir.z * freq3 + 2.1);
    const n4 = Math.sin(dir.x * freq4 + 2.3) + Math.cos(dir.z * freq4 + 1.1);

    // SDGB-2: Clamp the negative displacement so cracks aren't infinitely deep
    let noiseVal = (n1 * amp1) + (n2 * amp2) + (n3 * amp3) + (n4 * amp4);
    const maxCrackDepth = -0.4; // SDGF-43: Reduced crack depth to tighten gaps
    if (noiseVal < maxCrackDepth) noiseVal = maxCrackDepth;

    // W3: carve caves AFTER the crack clamp so pockets can be genuinely recessed.
    noiseVal -= caveInfluence(dir).depth;

    return noiseVal;
}

// Optimization: Shared Bump Map to save memory and CPU
let sharedBumpTex = null;
function getSharedBumpTex() {
    if (sharedBumpTex) return sharedBumpTex;
    
    const bumpCanvas = document.createElement('canvas');
    const size = 512;
    bumpCanvas.width = size; 
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d');
    
    // 1. Base icy noise
    const bData = bCtx.createImageData(size, size);
    for (let j = 0; j < bData.data.length; j += 4) {
        const v = 128 + (Math.random() - 0.5) * 50;
        bData.data[j] = bData.data[j+1] = bData.data[j+2] = v;
        bData.data[j+3] = 255;
    }
    bCtx.putImageData(bData, 0, 0);

    // 2. Add high-contrast craters (pockmarks)
    for (let j = 0; j < 60; j++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = 2 + Math.random() * 12;
        
        const grad = bCtx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, 'rgba(0,0,0,0.8)');      // Deep pit
        grad.addColorStop(0.7, 'rgba(50,50,50,0.4)');
        grad.addColorStop(0.9, 'rgba(255,255,255,0.6)'); // Bright rim
        grad.addColorStop(1, 'rgba(128,128,128,0)');
        
        bCtx.fillStyle = grad;
        bCtx.beginPath();
        bCtx.arc(x, y, radius, 0, Math.PI * 2);
        bCtx.fill();
    }

    // 3. Add sharp ice cracks
    bCtx.strokeStyle = 'rgba(255,255,255,0.4)'; // Light cracks (ridges)
    bCtx.lineWidth = 1;
    for (let j = 0; j < 25; j++) {
        bCtx.beginPath();
        bCtx.moveTo(Math.random() * size, Math.random() * size);
        bCtx.lineTo(Math.random() * size, Math.random() * size);
        bCtx.stroke();
    }
    
    bCtx.strokeStyle = 'rgba(0,0,0,0.5)'; // Dark cracks (crevasses)
    for (let j = 0; j < 25; j++) {
        bCtx.beginPath();
        bCtx.moveTo(Math.random() * size, Math.random() * size);
        bCtx.lineTo(Math.random() * size, Math.random() * size);
        bCtx.stroke();
    }
    
    sharedBumpTex = new THREE.CanvasTexture(bumpCanvas);
    sharedBumpTex.wrapS = sharedBumpTex.wrapT = THREE.RepeatWrapping;
    sharedBumpTex.repeat.set(2, 2);
    return sharedBumpTex;
}


// Comet
const cometRadius = 40; // W3: bigger, more detailed body (was 30)
window.cometRadius = cometRadius; // Share for CometTail.js
// SDGF-78: Inverse gravity state for comet break pieces
window.cometCurrentVelocity = new THREE.Vector3(0, 0, 0);
const cometLayers = 1;   
const cometSections = [];
const shellThickness = 1.0; // Increased for larger comet

// SDGB-3: Jigsaw Voronoi-style Chunking to avoid polar join points
const numChunks = 16; 
const chunkCenters = [];
for (let i = 0; i < numChunks; i++) {
    // Generate random points on a sphere for Voronoi centers
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.acos(2 * Math.random() - 1);
    chunkCenters.push(new THREE.Vector3().setFromSphericalCoords(1, theta, phi));
}

const oblongScale = new THREE.Vector3(1.3, 1.0, 0.8); // SDGF-41: Oblong shape

// W3: 2-3 recessed cave pockets. Directions are chosen away from the player's +Y spawn
// point and the embedded saucer so nothing spawns inside a pit.
cometCaves = [
    { dir: new THREE.Vector3( 0.85, 0.25, 0.20).normalize(), radius: 0.55, depth: 11 },
    { dir: new THREE.Vector3(-0.70,-0.20, 0.60).normalize(), radius: 0.50, depth: 10 },
    { dir: new THREE.Vector3( 0.10,-0.85,-0.45).normalize(), radius: 0.48, depth: 9  },
];

// W3: comet-detail quality toggle. Segments/chunk drives triangle count; a full sphere is
// generated per chunk and non-owned verts collapse to the origin (degenerate), so segment
// count is the dominant perf lever. 32=LOW, 48=MED (default), 64=HIGH.
let cometDetailSegments = 48;

// W3: build the 16 Voronoi jigsaw chunks. Returns fresh meshes; each keeps userData.chunkCenter
// so the existing break system (breakCometSection/updateCometSections) works unchanged.
function buildCometSections(segments) {
    const sections = [];
    for (let i = 0; i < numChunks; i++) {
        // Full sphere, then filter vertices by nearest Voronoi center (jigsaw pieces that meet
        // at arbitrary points, avoiding polar seams).
        const fullSphereGeo = new THREE.SphereGeometry(cometRadius, segments, segments);
        const posAttr = fullSphereGeo.attributes.position;
        const center = chunkCenters[i];

        // W3: per-vertex colours so cave interiors read as dark recessed pockets.
        const colors = new Float32Array(posAttr.count * 3);

        for (let j = 0; j < posAttr.count; j++) {
            const tempPos = new THREE.Vector3().fromBufferAttribute(posAttr, j).normalize();

            let closestIdx = -1;
            let minDist = Infinity;
            for (let k = 0; k < numChunks; k++) {
                const d = tempPos.distanceTo(chunkCenters[k]);
                if (d < minDist) { minDist = d; closestIdx = k; }
            }

            const dir = tempPos.clone();
            if (closestIdx === i) {
                // Apply displacement (relief + caves) then oblong scaling.
                const surfaceRadius = cometRadius + radialDisplacement(dir);
                posAttr.setXYZ(j,
                    dir.x * surfaceRadius * oblongScale.x,
                    dir.y * surfaceRadius * oblongScale.y,
                    dir.z * surfaceRadius * oblongScale.z
                );
                // Darken toward cave interiors (0 outside -> deep inside).
                const cf = caveInfluence(dir).factor;
                const shade = 1.0 - cf * 0.78;
                colors[j * 3] = shade; colors[j * 3 + 1] = shade; colors[j * 3 + 2] = shade;
            } else {
                // Collapse unused vertices.
                posAttr.setXYZ(j, 0, 0, 0);
                colors[j * 3] = colors[j * 3 + 1] = colors[j * 3 + 2] = 1;
            }
        }

        fullSphereGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        fullSphereGeo.computeVertexNormals();
        fullSphereGeo.normalizeNormals();

        const sectionMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x88aaff),
            roughness: 0.6, // SDGF-40: Increased roughness for better lighting response
            metalness: 0.2,
            emissive: 0x112244,
            emissiveIntensity: 0.2,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            vertexColors: true
        });
        sectionMat.bumpMap = getSharedBumpTex();
        sectionMat.bumpScale = 1.2;

        const sectionMesh = new THREE.Mesh(fullSphereGeo, sectionMat);
        sectionMesh.userData.chunkCenter = center.clone(); // Store for drift calculation
        sections.push(sectionMesh);
    }
    return sections;
}

buildCometSections(cometDetailSegments).forEach(s => cometSections.push(s));

const comet = new THREE.Group();

// SDGB-42: Removed extra moon companion
const snowCore = new THREE.Mesh(
    new THREE.SphereGeometry(cometRadius - (cometRadius / 2), 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
);
cometSections.forEach(s => comet.add(s));
comet.add(snowCore);
const orbitPathGeometry = new THREE.BufferGeometry().setFromPoints(orbitPathPoints);
cometOrbitLine = new THREE.Line(orbitPathGeometry, orbitLineMaterial);
// W5: parent the orbit path to cosmicRoot so it shares the solar-system frame (the comet is
// pinned at the origin while cosmicRoot moves the world past it). Points/colour set in initOrbitPath().
cosmicRoot.add(cometOrbitLine);
scene.add(comet);
// SDGF-65: Initialize Comet Orbit Line
comet.position.set(0, 0, 0);

// Feature SD-B9 Fix: Add local lights to comet so it's always visible
const cometLight = new THREE.PointLight(0x88aaff, 1, 160); // W3: range bumped for larger comet
comet.add(cometLight);
const cometLight2 = new THREE.PointLight(0xffffff, 0.5, 160); // W3: range bumped
cometLight2.position.set(0, 60, 0); // Moved up for larger comet
comet.add(cometLight2);

// --- W3: rebuild comet at a new detail level (quality toggle) ---
function rebuildComet(segments) {
    cometDetailSegments = segments;
    // Tear down current sections wherever they live (still on the comet, or mid-break in the scene).
    cometSections.forEach(s => {
        if (s.userData.breakEmitter) { s.userData.breakEmitter.destroy(); s.userData.breakEmitter = null; }
        if (s.parent) s.parent.remove(s);
        if (s.geometry) s.geometry.dispose();
        if (s.material) s.material.dispose();
    });
    cometSections.length = 0;
    buildCometSections(segments).forEach(s => { cometSections.push(s); comet.add(s); });
    if (typeof respawnCometPickups === 'function') respawnCometPickups();
    console.log(`W3: comet rebuilt at ${segments} segments/chunk`);
}
window.rebuildComet = rebuildComet;

// --- W4: on-comet crystal pickups placed in/around the caves ---
const cometPickups = [];
let crystalsCollected = 0;
let chunksMined = 0;
let pickupRespawnPending = false;

const crystalHud = document.createElement('div');
crystalHud.style.position = 'absolute';
crystalHud.style.top = '84px';
crystalHud.style.left = '20px';
crystalHud.style.color = '#66ffcc';
crystalHud.style.fontFamily = 'Arial, sans-serif';
crystalHud.style.fontSize = '16px';
crystalHud.style.fontWeight = 'bold';
crystalHud.innerHTML = 'Crystals: 0 | Mined: 0';
document.body.appendChild(crystalHud);
function updateCrystalHud() {
    crystalHud.innerHTML = `Crystals: ${crystalsCollected} | Mined: ${chunksMined}`;
}

// Local surface point (comet space) for a given outward direction.
function surfacePoint(dir) {
    const d = dir.clone().normalize();
    const r = cometRadius + radialDisplacement(d);
    return new THREE.Vector3(d.x * r * oblongScale.x, d.y * r * oblongScale.y, d.z * r * oblongScale.z);
}

function makeCrystal() {
    const geo = new THREE.OctahedronGeometry(1.7, 0);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x66ffcc, emissive: 0x228866, emissiveIntensity: 0.9,
        roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.95
    });
    const m = new THREE.Mesh(geo, mat);
    m.add(new THREE.PointLight(0x66ffcc, 0.6, 34));
    return m;
}

function spawnCometPickups() {
    cometCaves.forEach((cave) => {
        // one at the cave floor, two around the rim
        const spots = [cave.dir.clone()];
        for (let k = 0; k < 2; k++) {
            const t = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            const tangent = new THREE.Vector3().crossVectors(cave.dir, t).normalize();
            spots.push(cave.dir.clone().addScaledVector(tangent, cave.radius * 0.6).normalize());
        }
        spots.forEach(sdir => {
            const m = makeCrystal();
            const base = surfacePoint(sdir).add(sdir.clone().multiplyScalar(2.0)); // sit on the surface
            m.position.copy(base);
            comet.add(m);
            cometPickups.push(m);
        });
    });
    updateCrystalHud();
}

function respawnCometPickups() {
    for (let i = cometPickups.length - 1; i >= 0; i--) {
        const m = cometPickups[i];
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }
    cometPickups.length = 0;
    spawnCometPickups();
}

// W4 input #3: walk into a crystal (proximity) to collect it -> score + state.
function updateCometPickups(deltaTime) {
    if (!player) return;
    for (let i = cometPickups.length - 1; i >= 0; i--) {
        const m = cometPickups[i];
        m.rotation.y += deltaTime * 1.5;
        m.rotation.x += deltaTime * 0.7;
        const wp = new THREE.Vector3();
        m.getWorldPosition(wp);
        if (wp.distanceTo(player.position) < 3.5) {
            if (m.parent) m.parent.remove(m);
            m.geometry.dispose(); m.material.dispose();
            cometPickups.splice(i, 1);
            crystalsCollected++;
            score += 750;
            playSound('fuel');
            triggerShake(0.15);
            updateCrystalHud();
        }
    }
    if (cometPickups.length === 0 && !pickupRespawnPending) {
        pickupRespawnPending = true;
        setTimeout(() => { respawnCometPickups(); pickupRespawnPending = false; }, 4000);
    }
}

spawnCometPickups();

// --- Sun ---
const sun = new THREE.Group();
sun.position.set(0, 0, 0); // Sun is at the center
cosmicRoot.add(sun);

// Sun Visuals
const sunGeometry = new THREE.SphereGeometry(150, 64, 64);
const sunTexture = textureLoader.load('assets/8k_sun.jpg');
sunTexture.colorSpace = THREE.SRGBColorSpace;
const sunMaterial = new THREE.MeshBasicMaterial({ 
    map: sunTexture,
    fog: false, 
    depthTest: false, 
    depthWrite: false 
});
const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
sunMesh.renderOrder = -1; // Render before other objects
// Sun light - This is the primary light source
const sunLight = new THREE.PointLight(0xffffff, 10, 200000); 
sunLight.castShadow = true;
scene.add(sunLight); // SDGB-35: Move to scene to avoid nested parent matrices if any

// Feature SD-B14 & SD21 Fix: Enhanced Sun Glare/Flare
const sunGlowGroup = new THREE.Group();
sun.add(sunGlowGroup);

sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 200000;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
// Internal hot core
// const coreGlowGeo = new THREE.SphereGeometry(42000, 32, 32);
// const coreGlowMat = new THREE.MeshBasicMaterial({
//     color: 0xffffff,
//     transparent: true,
//     opacity: 0.8,
//     blending: THREE.AdditiveBlending,
//     fog: false
// });
// const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
// sunGlowGroup.add(coreGlow);

// Feature SD21 Refined: Screen-space aligned Lens Flare Sprite
const flareTexture = textureLoader.load('assets/sun_flare.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
});
// If you don't have the asset yet, we'll use a procedural canvas flare
const flareCanvas = document.createElement('canvas');
flareCanvas.width = 512;
flareCanvas.height = 512;
const flareCtx = flareCanvas.getContext('2d');
const gradient = flareCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
gradient.addColorStop(0.1, 'rgba(255, 255, 220, 0.4)');
gradient.addColorStop(0.3, 'rgba(255, 200, 100, 0.05)');
gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
flareCtx.fillStyle = gradient;
flareCtx.fillRect(0, 0, 512, 512);

const proceduralFlareTex = new THREE.CanvasTexture(flareCanvas);
const flareMaterial = new THREE.SpriteMaterial({
    map: proceduralFlareTex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9, 
    fog: false,
    depthTest: false, // Disabling again to favor raycast-only occlusion
    depthWrite: false
});

const sunFlare = new THREE.Sprite(flareMaterial);
sunFlare.scale.set(40000, 40000, 1); // FBF-48: Increased flare size
sunFlare.userData.baseOpacity = 0.9;
sunGlowGroup.add(sunFlare);

// Add some smaller secondary artifacts for the "lens" look
for (let i = 0; i < 3; i++) {
    const baseOpacity = 0.3;
    const artifact = new THREE.Sprite(new THREE.SpriteMaterial({
        map: proceduralFlareTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: baseOpacity,
        color: new THREE.Color().setHSL(0.1, 0.5, 0.5),
        fog: false,
        depthTest: false // FBF-48: Ensure artifacts are also overlayed
    }));
    artifact.scale.set(8000, 8000, 1);
    artifact.userData.offset = (i + 1) * 0.2;
    artifact.userData.baseOpacity = baseOpacity;
    sunGlowGroup.add(artifact);
}

sunGlowGroup.position.copy(sun.position);

// Sun light handled above in Sun section

// --- Dynamic Sun Shadow Update (SDGF-40) ---
function updateSunShadows() {
    const sunWorldPos = new THREE.Vector3();
    sun.getWorldPosition(sunWorldPos);
    
    // Position the global directional light to always point FROM the Sun's world position
    // toward the comet (origin). 
    directionalLight.position.copy(sunWorldPos).normalize();

    // SDGB-35: Update the PointLight to the Sun's world position
    sunLight.position.copy(sunWorldPos);

    // Occlusion check for labels
    if (showPlanetLabels) {
        planetManager.planets.forEach(p => {
            if (p.instance && p.mesh) {
                const planetWorldPos = new THREE.Vector3();
                p.mesh.getWorldPosition(planetWorldPos);
                
                const dirToPlanet = planetWorldPos.clone().sub(camera.position);
                const currentDistToPlanet = dirToPlanet.length();
                dirToPlanet.normalize();
                
                raycaster.set(camera.position, dirToPlanet);
                raycaster.far = currentDistToPlanet;
                
                // Only occlude if the planet is blocked by ANOTHER planet or the comet
                const occluders = [comet, ...planetManager.planets.filter(other => other !== p && !other.isBelt && other.mesh).map(other => other.mesh)];
                const intersects = raycaster.intersectObjects(occluders, true);
                
                p.instance.toggleLabelVisibility(intersects.length === 0);
            }
        });
    }
}

// Dynamic Comet Rotation
let cometRotationX = 0;
let cometRotationY = 0;
const rotationSpeed = 0.02; // Degrees per frame roughly

// Section Breaking Logic
function breakCometSection(byPlayer = false) {
    //eject a piece of the comet
    console.log("Comet Break Logic Triggered...");
    // Find an active section
    const activeSections = cometSections.filter(s => s.parent === comet);
    console.log(`Active sections remaining: ${activeSections.length}`);
    
    if (activeSections.length <= 1) {
        console.log("Only one section left. Stopping breakups.");
        return; 
    }

    const sectionToBreak = activeSections[Math.floor(Math.random() * activeSections.length)];
    
    // Feature SD-B34 Fix: Don't break the section the player is currently standing on!
    const worldPos = new THREE.Vector3();
    sectionToBreak.getWorldPosition(worldPos);
    const distToPlayer = (player && player.position) ? worldPos.distanceTo(player.position) : Infinity;
    
    if (distToPlayer < 3) {
        console.log(`Skipping section break: Too close to player (${distToPlayer.toFixed(2)}m)`);
        return; 
    }

    console.log("Breaking section away from comet!");
    const worldQuat = new THREE.Quaternion();
    sectionToBreak.getWorldQuaternion(worldQuat);
    
    // SDGF-26: Peel effect variables
    const centerDir = sectionToBreak.position.clone().normalize();
    // Use a fixed axis for peeling that's perpendicular to "up" and "forward" 
    // to ensure it peels backwards away from the solar wind
    const crossAxis = new THREE.Vector3(1, 0, 0).cross(centerDir);
    sectionToBreak.userData.peelAxis = crossAxis.lengthSq() > 0.0001 ? crossAxis.normalize() : new THREE.Vector3(1, 0, 0);
    sectionToBreak.userData.peelTime = 0; // Fix: SDGB-44: Start at 0 so it actually peels
    sectionToBreak.userData.peelDuration = 3.5; // Much slower peel
    sectionToBreak.userData.state = 'drifting';
    
    const sectionWorldPos = new THREE.Vector3();
    sectionToBreak.getWorldPosition(sectionWorldPos);
    sectionToBreak.userData.worldBreakOrigin = sectionWorldPos.clone();

    scene.attach(sectionToBreak);

    sectionToBreak.position.copy(sectionWorldPos);
    sectionToBreak.updateMatrixWorld();

    // SDGB-45: Attach temporary emitter
    const breakDir = sectionToBreak.userData.chunkCenter ? sectionToBreak.userData.chunkCenter.clone().normalize() : centerDir.clone().normalize();
    sectionToBreak.userData.breakEmitter = new BreakEmitter(scene, breakDir, sectionWorldPos);

    // Set final drift velocity (applied after peeling)
    // SDGF-35: Kick pieces out in the direction of their normal from the sphere center
    const outwardDir = centerDir.clone().normalize();
    const kickSpeed = 0.1; // Outward velocity
    const backwardSpeed = 0; // SDGB-40: Drift velocity now handled by gravity logic
    
    sectionToBreak.userData.velocity = outwardDir.multiplyScalar(kickSpeed).add(new THREE.Vector3(0, 0, backwardSpeed));
    
    sectionToBreak.userData.rotationVel = new THREE.Vector3(0, 0, 0); // SDGF-78: No rotation
    const oldRotationVel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2
    );
    sectionToBreak.userData.isBreaking = true;

    triggerShake(3.5);

    // W4 input #2: player-triggered mining rewards score/state (auto-breaks do not).
    if (byPlayer) {
        chunksMined++;
        score += 300;
        if (typeof updateCrystalHud === 'function') updateCrystalHud();
        triggerMilestoneEffect('CHUNK MINED', 300);
    }
}




function updateCometSections(deltaTime) {
    cometSections.forEach(s => {
        if (s.userData.isBreaking) {
            if (s.userData.state === 'peeling') {
                console.log("peeling");
                s.userData.peelTime += deltaTime;
                const progress = s.userData.peelTime / s.userData.peelDuration;
                
                // 1. Peel back: Rotate around hinge axis and move outward
                const centerDir = s.position.clone().normalize();
                
                // Apply peel rotation manually (relative to original orientation)
                s.position.add(centerDir.multiplyScalar(0.02)); // Much slower outward lift
                s.rotateOnAxis(s.userData.peelAxis, 0.005); // Much slower incremental rotation
                
                if (s.userData.peelTime >= s.userData.peelDuration) {
                    s.userData.state = "drifting";
                    s.userData.driftTime = 0;
                    playSound("collision");
                }
            } else {
                s.userData.driftTime += deltaTime;
                
                // SDGB-45: Calculate vector from comet center (0,0,0) through the chunk's original center
                let driftDir = new THREE.Vector3(0, 1, 0);
                if (s.userData.chunkCenter) {
                    driftDir.copy(s.userData.chunkCenter).normalize();
                } else if (s.userData.worldBreakOrigin) {
                    driftDir.copy(s.userData.worldBreakOrigin).normalize();
                }
                const driftspeed = 4.0;
                s.position.add(driftDir.multiplyScalar(driftspeed * deltaTime));

                // Update emitter
                if (s.userData.breakEmitter) {
                    const currentPos = new THREE.Vector3();
                    s.getWorldPosition(currentPos);
                    s.userData.breakEmitter.update(deltaTime, currentPos);
                }
            }

            // Cleanup after 60 seconds (approx) or far distance
            // Increased cleanup distance and added time-based check
            if (s.position.length() > 200 || (s.userData.driftTime > 600)) {
                if (s.userData.breakEmitter) {
                    s.userData.breakEmitter.destroy();
                    s.userData.breakEmitter = null;
                }
                scene.remove(s);
            }
        }
    });
}




// Flying Saucer (Easter Egg)
let saucer = null;
const saucerRadius = 0.45;
// Create a more "saucer-like" shape using a squashed cylinder
const saucerGeometry = new THREE.CylinderGeometry(saucerRadius, saucerRadius, 0.04, 32);
saucerGeometry.scale(1, 0.5, 1);
const saucerMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.6,
    emissive: 0x00ff00,
    emissiveIntensity: 0.5
});
saucer = new THREE.Mesh(saucerGeometry, saucerMaterial);

// Add a dome to the saucer
const domeGeometry = new THREE.SphereGeometry(saucerRadius * 0.6, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
const domeMaterial = new THREE.MeshStandardMaterial({ color: 0x88ff88, transparent: true, opacity: 0.4 });
const dome = new THREE.Mesh(domeGeometry, domeMaterial);
dome.position.y = 0.01;
saucer.add(dome);

// Add a light to the saucer
const saucerLight = new THREE.PointLight(0x00ff00, 0.5, 1);
saucer.add(saucerLight);

// Position it partially embedded in the comet
const saucerAngle = Math.PI / 4; // 45 degrees
const saucerDistance = cometRadius - 0.25;
saucer.position.set(
    Math.sin(saucerAngle) * saucerDistance * oblongScale.x,
    0,
    Math.cos(saucerAngle) * saucerDistance * oblongScale.z
);
comet.add(saucer);

// Comet Tail
const cometTail = new CometTail(scene, comet, -0.1);

// Player
let player;
const playerRadius = 0.5;
const playerHeight = 2; // Approximate height of the dino model

// Function to create a procedural dino
function createProceduralDino() {
    const playerGroup = new THREE.Group();

    const bodyGeometry = new THREE.CapsuleGeometry(playerRadius, playerHeight, 4, 8);
    const playerMaterial = new THREE.MeshStandardMaterial({
        color: 0x32CD32,
        emissive: 0x330000,
        roughness: 0.5,
        side: THREE.DoubleSide
    });
    const antennaGeometry = new THREE.CapsuleGeometry(0.005, 0.04, 4, 8);
    const antennaMaterial = new THREE.MeshStandardMaterial({
        color: 0xA9A9A9,
        emissive: 0x00000,
        roughness: 0.5
    });
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna.position.set(-0.03, playerHeight - 0.04, 0);
    playerGroup.add(antenna);

    const antennaGeometryTop = new THREE.CapsuleGeometry(0.01, 0.01, 4, 8);
    const antennaMaterialTop = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x000000,
        roughness: 0.5
    });
    const antennaTop = new THREE.Mesh(antennaGeometryTop, antennaMaterialTop);
    antennaTop.position.set(-0.03, playerHeight - 0.02, 0);
    playerGroup.add(antennaTop);

    // Astronaut Helmet
    const helmetGeometry = new THREE.SphereGeometry(playerRadius * 1.5, 16, 16);
    const helmetMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: false, opacity: 0.5 });
    const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
    helmet.position.set(0, playerHeight * 0.4, -0.01);
    playerGroup.add(helmet);

    // Astronaut Helmet Shield
    const shieldGeometry = new THREE.SphereGeometry(playerRadius * 0.8, 16, 16);
    const shieldMaterial = new THREE.MeshStandardMaterial({ color: 0xEFBF04, transparent: true, opacity: 0.8 });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.set(0, playerHeight * 0.4, 0.04);
    playerGroup.add(shield);

    // Tail
    const tailGeometry = new THREE.ConeGeometry(0.03, 0.1, 8);
    const tail = new THREE.Mesh(tailGeometry, playerMaterial);
    tail.position.set(0, -0.02, -0.06);
    tail.rotation.x = -Math.PI / 4;
    playerGroup.add(tail);

    // Legs
    const legGeometry = new THREE.ConeGeometry(0.05, 0.3, 14);
    const leg = new THREE.Mesh(legGeometry, playerMaterial);
    leg.position.set(0.02, -0.12, 0);
    leg.rotation.z = Math.PI / 7;
    playerGroup.add(leg);

    const rleg = new THREE.Mesh(legGeometry, playerMaterial);
    rleg.position.set(-0.02, -0.12, 0);
    rleg.rotation.z = -Math.PI / 7;
    playerGroup.add(rleg);

    // Arms
    const armGeometry = new THREE.ConeGeometry(0.005, 0.1, 14);
    const arm = new THREE.Mesh(armGeometry, playerMaterial);
    arm.position.set(0.02, 0.02, 0.02);
    arm.rotation.z = Math.PI / 3;
    arm.rotation.x = -Math.PI / 3;
    playerGroup.add(arm);

    const rarm = new THREE.Mesh(armGeometry, playerMaterial);
    rarm.position.set(-0.02, 0.02, 0.02);
    rarm.rotation.z = -Math.PI / 3;
    rarm.rotation.x = -Math.PI / 3;
    playerGroup.add(rarm);

    // Add small helmet light
    const helmetLight = new THREE.PointLight(0xffffff, 0.1, 1.5);
    helmetLight.position.set(0.06, 0.05, 0.05);
    playerGroup.add(helmetLight);
    
    playerGroup.scale.set(0.1, 0.1, 0.1); // Adjust scale to match GLB
    return playerGroup;
}


let playerAngle = 0; // Angle around the comet's y-axis
// --- Updated Physics Variables ---
let playerVelocity = new THREE.Vector3();
const moveAcceleration = 12.0;
const airControlFactor = 0.5;
const friction = 15.0;
const gravityForce = 15.0; // Reduced to allow better jumping
const jumpImpulse = 20;  // Increased for higher jump



// Initialize cosmicRoot distance
//cosmicRoot.position.set(15000, -15000, 15000);
let timeScaleExponent = 0; // Log10 of 20 // Changed to let for slider control
const celestialScale = 0.1; // Global scale for celestial distances

const planetDataNormal = [
    { name: 'Neptune', texturePath: 'assets/2k_neptune.jpg', color1: '#3d5a9d', color2: { r: 80, g: 110, b: 180 }, size: 630, a: 232000, e: 0.008, period: 165, mass: 100 },
    { name: 'Uranus', texturePath: 'assets/2k_uranus.jpg', color1: '#b0e0e6', color2: { r: 190, g: 230, b: 230 }, size: 650, a: 148000, e: 0.046, period: 84, mass: 80 },
    { name: 'Saturn', texturePath: 'assets/8k_saturn.jpg', color1: '#f0e68c', color2: { r: 245, g: 235, b: 180 }, size: 500, a: 74000, e: 0.054, period: 29, mass: 500, hasRings: true, moons: [ { name: 'Titan', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 30, a: 2500, e: 0.00, period: 0.02, mass: 3 }, { name: 'Rhea', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 15, a: 2700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Iapetus', color1: '#bbbbbb', color2: { r: 190, g: 190, b: 190 }, size: 13, a: 3000, e: 0.00, period: 0.01, mass: 1 }, { name: 'Dione', color1: '#dddddd', color2: { r: 210, g: 210, b: 210 }, size: 11, a: 2800, e: 0.00, period: 0.005, mass: 1 } ] },
    { name: 'Jupiter', texturePath: 'assets/8k_jupiter.jpg', color1: '#D8C8A8', color2: { r: 168, g: 141, b: 105 }, size: 600, a: 40000, e: 0.048, period: 12, mass: 1000, moons: [ { name: 'Io', color1: '#ffcc00', color2: { r: 255, g: 204, b: 0 }, size: 20, a: 1500, e: 0.00, period: 0.005, mass: 1 }, { name: 'Europa', color1: '#aaccff', color2: { r: 170, g: 204, b: 255 }, size: 18, a: 1700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Ganymede', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 25, a: 2000, e: 0.00, period: 0.01, mass: 2 }, { name: 'Callisto', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 23, a: 2300, e: 0.00, period: 0.015, mass: 2 } ] },
    { name: 'Asteroid Belt', isBelt: true, a_min: 12000, a_max: 38000, count: 20000 },
    { name: 'Mars', texturePath: 'assets/8k_mars.jpg', color1: '#c1440e', color2: { r: 200, g: 100, b: 80 }, size: 85, a: 11800, e: 0.093, period: 1.88, mass: 10 },
    { name: 'Earth', texturePath: 'assets/8k_earth_daymap.jpg', color1: '#4d94ff', color2: { r: 255, g: 255, b: 255 }, size: 160, a: 7700, e: 0.017, period: 1.0, mass: 1, moons: [{ name: 'Moon', texturePath: 'assets/8k_moon.jpg', color1: '#aaaaaa', color2: { r: 150, g: 150, b: 150 }, size: 43, a: 400, e: 0.05, period: 0.07, mass: 0.01 }] },
    { name: 'Venus', texturePath: 'assets/4k_venus_atmosphere.jpg', color1: '#e6b800', color2: { r: 255, g: 200, b: 0 }, size: 150, a: 5600, e: 0.007, period: 0.62, mass: 0.8 },
    { name: 'Mercury', texturePath: 'assets/8k_mercury.jpg', color1: '#a9a9a9', color2: { r: 150, g: 150, b: 150 }, size: 60, a: 3000, e: 0.205, period: 0.24, mass: 0.05 },
];

const planetDataTour = [
    { name: 'Neptune', texturePath: 'assets/2k_neptune.jpg', color1: '#3d5a9d', color2: { r: 80, g: 110, b: 180 }, size: 300, a: 11000, e: 0.008, period: 165, mass: 100, tourZ: 10000 },
    { name: 'Uranus', texturePath: 'assets/2k_uranus.jpg', color1: '#b0e0e6', color2: { r: 190, g: 230, b: 230 }, size: 320, a: 9500, e: 0.046, period: 84, mass: 80, tourZ: 8500 },
    { name: 'Saturn', texturePath: 'assets/8k_saturn.jpg', color1: '#f0e68c', color2: { r: 245, g: 235, b: 180 }, size: 500, a: 17000, e: 0.054, period: 29, mass: 500, hasRings: true, moons: [ { name: 'Titan', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 30, a: 2500, e: 0.00, period: 0.02, mass: 3 }, { name: 'Rhea', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 15, a: 2700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Iapetus', color1: '#bbbbbb', color2: { r: 190, g: 190, b: 190 }, size: 13, a: 3000, e: 0.00, period: 0.01, mass: 1 }, { name: 'Dione', color1: '#dddddd', color2: { r: 210, g: 210, b: 210 }, size: 11, a: 2800, e: 0.00, period: 0.005, mass: 1 } ] },
    { name: 'Jupiter', texturePath: 'assets/8k_jupiter.jpg', color1: '#D8C8A8', color2: { r: 168, g: 141, b: 105 }, size: 600, a: 13000, e: 0.048, period: 12, mass: 1000, moons: [ { name: 'Io', color1: '#ffcc00', color2: { r: 255, g: 204, b: 0 }, size: 20, a: 1500, e: 0.00, period: 0.005, mass: 1 }, { name: 'Europa', color1: '#aaccff', color2: { r: 170, g: 204, b: 255 }, size: 18, a: 1700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Ganymede', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 25, a: 2000, e: 0.00, period: 0.01, mass: 2 }, { name: 'Callisto', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 23, a: 2300, e: 0.00, period: 0.015, mass: 2 } ] },
    { name: 'Asteroid Belt', isBelt: true, a_min: 4000, a_max: 4200, count: 1000 },
    { name: 'Mars', texturePath: 'assets/8k_mars.jpg', color1: '#c1440e', color2: { r: 200, g: 100, b: 80 }, size: 150, a: 3000, e: 0.093, period: 1.88, mass: 10, tourZ: 3000 },
    { name: 'Mercury', texturePath: 'assets/8k_mercury.jpg', color1: '#a9a9a9', color2: { r: 150, g: 150, b: 150 }, size: 60, a: 300, e: 0.205, period: 0.24, mass: 0.05, tourZ: 300 },
    { name: 'Venus', texturePath: 'assets/4k_venus_atmosphere.jpg', color1: '#e6b800', color2: { r: 255, g: 200, b: 0 }, size: 200, a: 550, e: 0.007, period: 0.62, mass: 0.8, tourZ: 550 },
    { name: 'Earth', texturePath: 'assets/8k_earth_daymap.jpg', color1: '#4d94ff', color2: { r: 255, g: 255, b: 255 }, size: 180, a: 800, e: 0.017, period: 1.0, mass: 1, tourZ: 800, moons: [{ name: 'Moon', texturePath: 'assets/8k_moon.jpg', color1: '#aaaaaa', color2: { r: 150, g: 150, b: 150 }, size: 43, a: 400, e: 0.05, period: 0.07, mass: 0.01 }] },
];

const planetDataOortCloud = [
    { name: 'Neptune', texturePath: 'assets/2k_neptune.jpg', color1: '#3d5a9d', color2: { r: 80, g: 110, b: 180 }, size: 3000, a: 25000, e: 0.008, period: 165, mass: 100 },
    { name: 'Uranus', texturePath: 'assets/2k_uranus.jpg', color1: '#b0e0e6', color2: { r: 190, g: 230, b: 230 }, size: 320, a: 21000, e: 0.046, period: 84, mass: 80 },
    { name: 'Saturn', texturePath: 'assets/8k_saturn.jpg', color1: '#f0e68c', color2: { r: 245, g: 235, b: 180 }, size: 500, a: 17000, e: 0.054, period: 29, mass: 500, hasRings: true, moons: [ { name: 'Titan', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 30, a: 2500, e: 0.00, period: 0.02, mass: 3 }, { name: 'Rhea', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 15, a: 2700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Iapetus', color1: '#bbbbbb', color2: { r: 190, g: 190, b: 190 }, size: 13, a: 3000, e: 0.00, period: 0.01, mass: 1 }, { name: 'Dione', color1: '#dddddd', color2: { r: 210, g: 210, b: 210 }, size: 11, a: 2800, e: 0.00, period: 0.005, mass: 1 } ] },
    { name: 'Jupiter', texturePath: 'assets/8k_jupiter.jpg', color1: '#D8C8A8', color2: { r: 168, g: 141, b: 105 }, size: 600, a: 13000, e: 0.048, period: 12, mass: 1000, moons: [ { name: 'Io', color1: '#ffcc00', color2: { r: 255, g: 204, b: 0 }, size: 20, a: 1500, e: 0.00, period: 0.005, mass: 1 }, { name: 'Europa', color1: '#aaccff', color2: { r: 170, g: 204, b: 255 }, size: 18, a: 1700, e: 0.00, period: 0.008, mass: 1 }, { name: 'Ganymede', color1: '#cccccc', color2: { r: 200, g: 200, b: 200 }, size: 25, a: 2000, e: 0.00, period: 0.01, mass: 2 }, { name: 'Callisto', color1: '#aaaaaa', color2: { r: 180, g: 180, b: 180 }, size: 23, a: 2300, e: 0.00, period: 0.015, mass: 2 } ] },
    { name: 'Asteroid Belt', isBelt: true, a_min: 9000, a_max: 11000, count: 2000 },
    { name: 'Mars', texturePath: 'assets/8k_mars.jpg', color1: '#c1440e', color2: { r: 200, g: 100, b: 80 }, size: 200, a: 6000, e: 0.093, period: 1.88, mass: 10 },
    { name: 'Mercury', texturePath: 'assets/8k_mercury.jpg', color1: '#a9a9a9', color2: { r: 150, g: 150, b: 150 }, size: 60, a: 300, e: 0.205, period: 0.24, mass: 0.05 },
    { name: 'Venus', texturePath: 'assets/4k_venus_atmosphere.jpg', color1: '#e6b800', color2: { r: 255, g: 200, b: 0 }, size: 200, a: 550, e: 0.007, period: 0.62, mass: 0.8 },
    { name: 'Earth', texturePath: 'assets/8k_earth_daymap.jpg', color1: '#4d94ff', color2: { r: 255, g: 255, b: 255 }, size: 180, a: 800, e: 0.017, period: 1.0, mass: 1, moons: [{ name: 'Moon', texturePath: 'assets/8k_moon.jpg', color1: '#aaaaaa', color2: { r: 150, g: 150, b: 150 }, size: 43, a: 400, e: 0.05, period: 0.07, mass: 0.01 }] },
];

const planetData = (journeyType === 'tour' || journeyType === 'reverse-tour') ? planetDataTour : (journeyType === 'oort-cloud' ? planetDataOortCloud : planetDataNormal);

// --- W5: per-journey camera framing + speed profile ---
const journeyProfiles = {
    'normal':       { camDist: 4,  camHeight: 0.30, worldSpeedMult: 1,   debrisSpeedMult: 1,  debrisInterval: 1.2, orbitColor: 0x33ff88, label: 'Inner Planets', home: 'Neptune' },
    'tour':         { camDist: 6,  camHeight: 0.45, worldSpeedMult: 2,   debrisSpeedMult: 12, debrisInterval: 0.7, orbitColor: 0x33ffdd, label: 'Grand Tour',   home: 'Earth' },
    'reverse-tour': { camDist: 6,  camHeight: 0.45, worldSpeedMult: 2,   debrisSpeedMult: 8,  debrisInterval: 0.9, orbitColor: 0xffcc33, label: 'Reverse Tour', home: 'Mercury' },
    'oort-cloud':   { camDist: 9,  camHeight: 0.60, worldSpeedMult: 1.5, debrisSpeedMult: 3,  debrisInterval: 1.6, orbitColor: 0x66aaff, label: 'Oort Cloud',   home: 'Uranus' },
};
const activeProfile = journeyProfiles[journeyType] || journeyProfiles['normal'];
console.log('W5: active journey profile:', activeProfile.label);

// W5: draw an orbit ring scaled to the active dataset's outermost planet, in the cosmicRoot
// (solar-system) frame, coloured per journey. Makes the chosen trajectory read clearly.
function initOrbitPath() {
    const realPlanets = planetData.filter(p => !p.isBelt && p.a);
    const maxA = realPlanets.length ? Math.max(...realPlanets.map(p => p.a)) : 20000;
    const aa = maxA * 1.15;
    const ecc = 0.35;
    const b = aa * Math.sqrt(1 - ecc * ecc);
    const incl = 0.34;
    const pts = [];
    for (let i = 0; i <= maxOrbitPoints; i++) {
        const th = (i / maxOrbitPoints) * Math.PI * 2;
        const x = Math.cos(th) * aa - aa * ecc; // shift so a focus sits near the sun/origin
        const z = Math.sin(th) * b;
        const y = Math.sin(th) * Math.sin(incl) * b * 0.35;
        pts.push(new THREE.Vector3(x, y, z));
    }
    orbitPathPoints = pts;
    if (cometOrbitLine) {
        cometOrbitLine.geometry.dispose();
        cometOrbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        cometOrbitLine.visible = true;
    }
    orbitLineMaterial.color.setHex(activeProfile.orbitColor);
}
initOrbitPath();
showCometPath = true;

// SDGB-33: Assign rotational speeds based on real-world relative speeds
const planetRotationSpeeds = {
    'Mercury': 0.05,
    'Venus': 0.02,
    'Earth': 0.2,
    'Mars': 0.18,
    'Jupiter': 0.35,
    'Saturn': 0.32,
    'Uranus': 0.15,
    'Neptune': 0.12,
    'Titan': 0.08,
    'Rhea': 0.07,
    'Iapetus': 0.06,
    'Dione': 0.09,
    'Io': 0.1,
    'Europa': 0.09,
    'Ganymede': 0.11,
    'Callisto': 0.07
};

planetData.forEach(planet => {
    if (planetRotationSpeeds[planet.name]) {
        planet.rotationSpeed = planetRotationSpeeds[planet.name];
    } else {
        planet.rotationSpeed = 0.1; // Default speed if not found
    }
    if (planet.moons) {
        planet.moons.forEach(moon => {
            if (planetRotationSpeeds[moon.name]) {
                moon.rotationSpeed = planetRotationSpeeds[moon.name];
            } else {
                moon.rotationSpeed = 0.1; // Default speed for moons
            }
        });
    }
});

const sunMass = 100000;

function calculateSOI(a, planetMass, starMass) {
    return a * Math.pow(planetMass / starMass, 2/5);
}

const milestoneElement = document.createElement('div');
milestoneElement.style.position = 'absolute';
milestoneElement.style.top = '60px';
milestoneElement.style.left = '20px';
milestoneElement.style.color = 'yellow';
milestoneElement.style.fontFamily = 'Arial, sans-serif';
milestoneElement.style.fontSize = '20px';
milestoneElement.innerHTML = `Approaching: ${planetData[0].name}`;
document.body.appendChild(milestoneElement);

function solveKepler(M, e) {
    let E = M;
    for (let i = 0; i < 5; i++) {
        E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return E;
}

// --- Speed Control UI ---

// --- Speed Control UI ---
const speedUI = document.createElement('div');
speedUI.style.position = 'absolute';
speedUI.style.bottom = '70px';
speedUI.style.right = '20px';
speedUI.style.display = 'flex';
speedUI.style.flexDirection = 'column';
speedUI.style.gap = '5px';
speedUI.style.background = 'rgba(0,0,0,0.5)';
speedUI.style.padding = '10px';
speedUI.style.borderRadius = '5px';
speedUI.style.color = 'white';
speedUI.style.fontFamily = 'Arial, sans-serif';
document.body.appendChild(speedUI);

const speedLabel = document.createElement('label');
speedLabel.innerHTML = `Time Scale: ${Math.round(Math.pow(10, 0))}x`;
speedUI.appendChild(speedLabel);

const speedSlider = document.createElement('input');
speedSlider.type = 'range';
speedSlider.min = 0;
speedSlider.max = 3; // Log10(30000)
speedSlider.step = 0.001;
speedSlider.value = 0;
speedSlider.oninput = (e) => {
    timeScaleExponent = parseFloat(e.target.value);
    speedLabel.innerHTML = `Time Scale: ${Math.round(Math.pow(10, timeScaleExponent))}x`;
};
speedUI.appendChild(speedSlider);

// --- Options Menu (SDGF-49: Moved from HTML to JS) ---
const optionsMenuContainer = document.createElement('div');
optionsMenuContainer.id = 'options-menu-container';
optionsMenuContainer.style.display = 'flex';
optionsMenuContainer.style.position = 'absolute';
optionsMenuContainer.style.top = '20px';
optionsMenuContainer.style.left = '20px';
optionsMenuContainer.style.transform = 'none';
optionsMenuContainer.style.zIndex = '1000';
optionsMenuContainer.style.fontFamily = 'Arial, sans-serif';
document.body.appendChild(optionsMenuContainer);

const toggleOptionsButton = document.createElement('button');
toggleOptionsButton.id = 'toggle-options-button';
toggleOptionsButton.innerHTML = 'Options';
toggleOptionsButton.style.padding = '10px 15px';
toggleOptionsButton.style.background = 'rgba(0,0,0,0.7)';
toggleOptionsButton.style.color = 'white';
toggleOptionsButton.style.border = '1px solid white';
toggleOptionsButton.style.borderRadius = '5px';
toggleOptionsButton.style.cursor = 'pointer';
optionsMenuContainer.appendChild(toggleOptionsButton);
toggleOptionsButton.style.marginRight = '10px';

const optionsPanel = document.createElement('div');
optionsPanel.id = 'options-panel';
optionsPanel.classList.add('hidden'); // This class needs to be in style.css
optionsPanel.style.position = 'absolute';
optionsPanel.style.top = '50px';
optionsPanel.style.left = '0';
optionsPanel.style.background = 'rgba(0,0,0,0.9)';
optionsPanel.style.padding = '15px';
optionsPanel.style.borderRadius = '5px';
optionsPanel.style.display = 'flex';
optionsPanel.style.flexDirection = 'column';
optionsPanel.style.gap = '10px';
optionsPanel.style.color = 'white';
optionsPanel.style.display = 'none'; // Ensure panel is hidden initially
optionsMenuContainer.appendChild(optionsPanel);

toggleOptionsButton.addEventListener('click', () => {
    optionsPanel.classList.toggle('hidden');
    // Also toggle display property directly for robustness
    optionsPanel.style.display = optionsPanel.classList.contains('hidden') ? 'none' : 'flex';
});

// --- Graphics Options (SDGF-52: Moved to new right-side menu) ---
const graphicsMenuRightContainer = document.createElement('div');
graphicsMenuRightContainer.id = 'graphics-menu-right-container';
graphicsMenuRightContainer.style.position = 'absolute';
graphicsMenuRightContainer.style.top = '20px';
graphicsMenuRightContainer.style.right = '20px';
graphicsMenuRightContainer.style.zIndex = '1000';
graphicsMenuRightContainer.style.fontFamily = 'Arial, sans-serif';
document.body.appendChild(graphicsMenuRightContainer);

const graphicsOptionsToggleButton = document.createElement('button');
graphicsOptionsToggleButton.id = 'graphics-options-button'; // Use the requested ID
graphicsOptionsToggleButton.innerHTML = 'Graphics Options';
graphicsOptionsToggleButton.style.padding = '10px 15px';
graphicsOptionsToggleButton.style.background = 'rgba(0,0,0,0.7)';
graphicsOptionsToggleButton.style.color = '#00ff00';
graphicsOptionsToggleButton.style.border = '1px solid #00ff00';
graphicsOptionsToggleButton.style.borderRadius = '5px';
graphicsOptionsToggleButton.style.cursor = 'pointer';
graphicsOptionsToggleButton.style.fontFamily = "'Courier New', Courier, monospace";
graphicsOptionsToggleButton.style.fontSize = '12px';
graphicsOptionsToggleButton.style.position = 'relative'; // Position explicitly
graphicsOptionsToggleButton.style.top = '0';
graphicsOptionsToggleButton.style.right = '0'; // Align with stats-panel
graphicsOptionsToggleButton.style.zIndex = '1000';
optionsMenuContainer.appendChild(graphicsOptionsToggleButton);

graphicsOptionsToggleButton.addEventListener('click', () => {
    const isHidden = graphicsOptionsPanel.style.display === 'none';
    graphicsOptionsPanel.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
        console.log('Opening Graphics Options Menu');
    }
});

// --- Quality UI ---
const graphicsOptionsPanel = document.createElement('div');
graphicsOptionsPanel.id = 'graphics-options-panel';
graphicsOptionsPanel.style.position = 'absolute';
graphicsOptionsPanel.style.top = '50px';
graphicsOptionsPanel.style.left = '0';
graphicsOptionsPanel.style.background = 'rgba(0,0,0,0.9)';
graphicsOptionsPanel.style.padding = '15px';
graphicsOptionsPanel.style.borderRadius = '5px';
graphicsOptionsPanel.style.display = 'none'; // Ensure panel is hidden initially
graphicsOptionsPanel.style.flexDirection = 'column';
graphicsOptionsPanel.style.gap = '5px';
optionsMenuContainer.appendChild(graphicsOptionsPanel); // Append to the new container


['LOW', 'MEDIUM', 'ULTRA'].forEach(level => {
    const btn = document.createElement('button');
    btn.innerHTML = level;
    btn.style.padding = '8px 12px';
    btn.style.background = 'rgba(0,0,0,0.5)';
    btn.style.color = 'white';
    btn.style.border = '1px solid white';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = 'Arial, sans-serif';
    btn.onclick = (e) => {
        e.stopPropagation();
        applyQuality(level);
        // Highlight active button
        Array.from(graphicsOptionsPanel.children).forEach(b => b.style.background = 'rgba(0,0,0,0.5)');
        btn.style.background = 'rgba(255,255,255,0.3)';
    };
    if (level === 'LOW') btn.style.background = 'rgba(255,255,255,0.3)';
    graphicsOptionsPanel.appendChild(btn);
});

// --- W3: Comet Detail toggle (rebuilds comet geometry / triangle budget) ---
const cometDetailContainer = document.createElement('div');
cometDetailContainer.style.display = 'flex';
cometDetailContainer.style.flexDirection = 'column';
cometDetailContainer.style.gap = '4px';
cometDetailContainer.style.padding = '5px 0';
const cometDetailLabel = document.createElement('span');
cometDetailLabel.innerHTML = 'Comet Detail:';
cometDetailLabel.style.fontSize = '12px';
cometDetailLabel.style.color = 'white';
cometDetailContainer.appendChild(cometDetailLabel);
const cometDetailSelect = document.createElement('select');
cometDetailSelect.style.padding = '4px';
cometDetailSelect.style.background = 'rgba(0,0,0,0.7)';
cometDetailSelect.style.color = 'white';
cometDetailSelect.style.border = '1px solid white';
cometDetailSelect.style.borderRadius = '3px';
cometDetailSelect.style.cursor = 'pointer';
[['Low (fast)', 32], ['Medium', 48], ['High', 64]].forEach(([lbl, seg]) => {
    const o = document.createElement('option');
    o.value = String(seg);
    o.innerHTML = lbl;
    if (seg === cometDetailSegments) o.selected = true;
    cometDetailSelect.appendChild(o);
});
cometDetailSelect.addEventListener('change', (e) => {
    e.stopPropagation();
    if (typeof rebuildComet === 'function') rebuildComet(parseInt(e.target.value, 10));
});
cometDetailContainer.appendChild(cometDetailSelect);
graphicsOptionsPanel.appendChild(cometDetailContainer);

// --- Performance Stats Toggle (SDGF-75) ---
const statsToggleContainer = document.createElement("div");
statsToggleContainer.style.display = "flex";
statsToggleContainer.style.alignItems = "center";
statsToggleContainer.style.gap = "10px";
statsToggleContainer.style.padding = "5px 0";

const performanceLabel = document.createElement("span");
performanceLabel.innerHTML = "Performance Stats:";
performanceLabel.style.fontSize = "12px";
performanceLabel.style.color = "white";

const statsCheckbox = document.createElement("input");
statsCheckbox.type = "checkbox";
statsCheckbox.checked = debugStats;
statsCheckbox.style.cursor = "pointer";
const skyboxToggleContainer = document.createElement("div");
skyboxToggleContainer.style.display = "flex";
skyboxToggleContainer.style.alignItems = "center";
skyboxToggleContainer.style.gap = "10px";
skyboxToggleContainer.style.padding = "5px 0";

const skyboxLabel = document.createElement("span");
skyboxLabel.innerHTML = "Skybox Visible:";
skyboxLabel.style.fontSize = "12px";
skyboxLabel.style.color = "white";

const skyboxCheckbox = document.createElement("input");
skyboxCheckbox.type = "checkbox";
skyboxCheckbox.checked = true; // Skybox is visible by default
skyboxCheckbox.style.cursor = "pointer";
skyboxCheckbox.onchange = (e) => {
    if (typeof skybox !== 'undefined') {
        skybox.visible = e.target.checked;
    }
};

skyboxToggleContainer.appendChild(skyboxLabel);
skyboxToggleContainer.appendChild(skyboxCheckbox);
graphicsOptionsPanel.appendChild(skyboxToggleContainer);

statsCheckbox.onchange = (e) => {
    debugStats = e.target.checked;
    if (statsPanel) {
        statsPanel.style.display = debugStats ? "block" : "none";
    }
};

statsToggleContainer.appendChild(performanceLabel);
statsToggleContainer.appendChild(statsCheckbox);
graphicsOptionsPanel.appendChild(statsToggleContainer);

const newGameButton = document.createElement('button');
newGameButton.id = 'new-game-button';
newGameButton.innerHTML = 'New Game';
newGameButton.style.padding = '8px 12px';
newGameButton.style.background = 'rgba(0,0,0,0.5)';
newGameButton.style.color = 'white';
newGameButton.style.border = '1px solid white';
newGameButton.style.borderRadius = '3px';
newGameButton.style.cursor = 'pointer';
optionsPanel.appendChild(newGameButton);

const teleportMenuContainer = document.createElement('div');
teleportMenuContainer.style.display = 'flex';
teleportMenuContainer.style.flexDirection = 'column';
teleportMenuContainer.style.gap = '5px';
teleportMenuContainer.style.padding = '5px 0';

const teleportLabel = document.createElement('span');
teleportLabel.innerHTML = 'Teleport to Planet:';
teleportLabel.style.fontSize = '12px';
teleportLabel.style.color = 'white';
teleportMenuContainer.appendChild(teleportLabel);

const teleportSelect = document.createElement('select');
teleportSelect.style.padding = '5px';
teleportSelect.style.background = 'rgba(0,0,0,0.7)';
teleportSelect.style.color = 'white';
teleportSelect.style.border = '1px solid white';
teleportSelect.style.borderRadius = '3px';
teleportSelect.style.cursor = 'pointer';
teleportSelect.style.fontFamily = 'Arial, sans-serif';

planetData.forEach(planet => {
    if (!planet.isBelt) { // Don't allow teleporting to asteroid belts
        const option = document.createElement('option');
        option.value = planet.name;
        option.innerHTML = planet.name;
        teleportSelect.appendChild(option);
    }
});
teleportMenuContainer.appendChild(teleportSelect);
optionsPanel.appendChild(teleportMenuContainer);

teleportSelect.addEventListener('change', (e) => {
    const selectedPlanetName = e.target.value;
    teleportComet(selectedPlanetName);
});

/**
 * [FIX] Teleport with comprehensive debugging
 */
function teleportComet(planetName) {
    // Use the find logic you confirmed works
    const planetObject = planetManager.planets.find(p => p.name === planetName);
    
    if (!planetObject || !planetObject.mesh) {
        console.error("DEBUG: Target planet not found in planetManager.planets:", planetName);
        return;
    }

    // 1. Capture Target State
    const targetPos = new THREE.Vector3();
    planetObject.mesh.getWorldPosition(targetPos);
    
    console.log(`DEBUG START: Teleporting to ${planetName}`);
    console.log("DEBUG: Target World Position (Expected):", targetPos);
    console.log("DEBUG: cosmicRoot Position Before:", cosmicRoot.position.clone());
    console.log("DEBUG: cometCurrentPosition Before:", cometCurrentPosition.clone());

    // 2. Sync the Orbital Clock
    const angle = Math.atan2(targetPos.z, targetPos.x);
    const p = cometTourOrbitParameters;
    const periodInSeconds = p.orbitalPeriodYears * 31557600;
    const meanMotion = (2 * Math.PI) / periodInSeconds;
    
    let targetM = angle; 
    if (targetM < 0) targetM += Math.PI * 2;
    
    const newOrbitalTime = (targetM - p.meanAnomalyAtEpoch) / meanMotion;
    planetManager.orbitalTime = newOrbitalTime;
    console.log("DEBUG: New Orbital Time set to:", newOrbitalTime);

    // 3. Force override of the persistent position variable
    // We add 1200 Y offset to avoid being inside the planet
    cometCurrentPosition.set(
        targetPos.x,
        targetPos.y , 
        targetPos.z 
    );

    // 4. Force immediate update of the world anchor
    cosmicRoot.position.copy(cometCurrentPosition).multiplyScalar(-1);

    // 5. Verify Final State
    console.log("DEBUG END: Teleport completed.");
    console.log("DEBUG: cometCurrentPosition After:", cometCurrentPosition.clone());
    console.log("DEBUG: cosmicRoot Position After:", cosmicRoot.position.clone());
    
    // Check if cosmicRoot matches -cometCurrentPosition
    const mismatch = cosmicRoot.position.x !== -cometCurrentPosition.x;
    if (mismatch) {
        console.warn("DEBUG: Potential Race Condition! cosmicRoot does not match negative cometCurrentPosition.");
    }
}

newGameButton.addEventListener('click', () => {
    location.reload();
});

// Initially hide the options panel (it's part of optionsMenuContainer)
optionsPanel.classList.add('hidden'); // Ensure panel is hidden initially

// --- Quality UI ---

function initializePlayerAndCamera() {
    // Spawn player relative to comet (Local Space)
    const spawnLocalPos = new THREE.Vector3(0, cometRadius + (playerHeight / 2) + 0.005, 0);
    // SDGF-25: Comet is at 0,0,0
    player.position.copy(comet.position).add(spawnLocalPos);

    // Sync initial velocity with comet journey speed (scaled for per-second physics)
    
    playerVelocity.set(0, 0, 0); // SDGF-25: Stationary relative to comet
    // Remove any radial component from starting velocity
    const localUpStart = player.position.clone().sub(comet.position).normalize();
    const radialStart = playerVelocity.dot(localUpStart);
    playerVelocity.sub(localUpStart.multiplyScalar(radialStart));

    // --- Initialize Camera Position ---
    const initialOffset = new THREE.Vector3(0, 2, 4);
    initialOffset.applyQuaternion(player.quaternion);
    camera.position.copy(player.position).add(initialOffset);
    camera.lookAt(player.position);
}

const loader = new GLTFLoader(loadingManager);
loader.load('assets/combo_dino_fixed.glb', (gltf) => {
    player = gltf.scene;

    player.traverse((node) => {
        if (node.isMesh) {
            node.material.depthWrite = true;
            node.material.transparent = false;
            node.material.side = THREE.DoubleSide;
            node.material.shadowSide = THREE.DoubleSide;
        }
    });

    mixer = new THREE.AnimationMixer(player);
    idleAction = mixer.clipAction(gltf.animations[0]); 
    walkAction = mixer.clipAction(gltf.animations[1]);
    runAction = mixer.clipAction(gltf.animations[2]);

    idleAction.play();
    currentAction = idleAction;

    scene.add(player);
    initializePlayerAndCamera();
}, undefined, (error) => {
    console.error('Error loading combo_dino_fixed.glb model, falling back to procedural dino:', error);
    player = createProceduralDino();
    scene.add(player);
    initializePlayerAndCamera();
});

// --- Player Movement ---
const playerMovement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
};


let isPanning = false;
let previousMouseX = 0;
let previousMouseY = 0;
let cameraOrbitYaw = 0;   // Horizontal rotation
let cameraOrbitPitch = 0; // Vertical rotation (limited)
// --- Refined Camera Parameters ---
let cameraDistance = activeProfile.camDist; // W5: per-journey follow distance
const minZoom = -5.5;   // Allows you to get much closer
const maxZoom = 200;
const zoomSensitivity = 5.5;


// Mouse listeners
document.addEventListener('mousedown', (e) => { if (e.button === 0) isPanning = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) isPanning = false; });
document.addEventListener('mousemove', (e) => {
    if (isPanning) {
        const deltaX = e.clientX - previousMouseX;
        const deltaY = e.clientY - previousMouseY;

        // SD-B19 & SD-B23 & SD-B26: Standard Orbit Camera Rotation
        cameraOrbitYaw -= deltaX * 0.005;
        // Expanded pitch range
        cameraOrbitPitch = THREE.MathUtils.clamp(cameraOrbitPitch - deltaY * 0.005, -1.5, 1.5);
    }
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
});

// --- Zoom Logic ---
document.addEventListener('wheel', (event) => {
    // Only zoom if we aren't in the UFO easter egg (optional)
    if (!isInSaucer) {
        const delta = Math.sign(event.deltaY);
        cameraDistance += delta * zoomSensitivity;
        cameraDistance = THREE.MathUtils.clamp(cameraDistance, minZoom, maxZoom);
    }
}, { passive: true });

let isInSaucer = false;

// Keyboard controls
document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    // W2: first thrust launches the comet off its home world.
    if (gamePhase === 'intro' && (key === ' ' || key === 'w' || key === 'arrowup')) { launchRun(); }
    if (key === 'a' || key === 'arrowleft') { playerMovement.left = true; playerMovement.moving = true; }
    if (key === 'd' || key === 'arrowright') { playerMovement.right = true;playerMovement.moving = true; }
    if (key === 'w' || key === 'arrowup') { playerMovement.forward = true;playerMovement.moving = true; }
    if (key === 's' || key === 'arrowdown') { playerMovement.backward = true;playerMovement.moving = true; }
    // W4 input #1: dedicated lateral strafe (independent of facing), keys Q / E.
    if (key === 'q') { playerMovement.strafeLeft = true; playerMovement.moving = true; }
    if (key === 'e') { playerMovement.strafeRight = true; playerMovement.moving = true; }
    if (key === ' ') { playerMovement.jump = true; playerMovement.moving = true; }
        if (key === 'b') { breakCometSection(true); }
    if (key === 'v') {
        showCometPath = !showCometPath;
        cometOrbitLine.visible = showCometPath;
        console.log(`Comet Orbital Path: ${showCometPath ? 'ON' : 'OFF'}`);
        showPlanetLabels = !showPlanetLabels;
        console.log(`Planet Labels: ${showPlanetLabels ? 'ON' : 'OFF'}`);
        planetManager.planets.forEach(p => {
            if (p.instance) {
                p.instance.toggleLabelVisibility(showPlanetLabels);
            }
        });
    }
    if (key === 'shift') { playerMovement.sprinting = true;}
});
document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'arrowleft') { playerMovement.left = false; playerMovement.moving = false; }
    if (key === 'd' || key === 'arrowright') { playerMovement.right = false; playerMovement.moving = false; }
    if (key === 'w' || key === 'arrowup') { playerMovement.forward = false; playerMovement.moving = false; }
    if (key === 's' || key === 'arrowdown') { playerMovement.backward = false; playerMovement.moving = false; }
    if (key === 'q') { playerMovement.strafeLeft = false; }
    if (key === 'e') { playerMovement.strafeRight = false; }
    if (key === ' ') { playerMovement.jump = false; playerMovement.moving = false; }
    if (key === 'shift') { playerMovement.sprinting = false;}
});

// Touch/Click Controls for Toddlers (Screen splits)
document.addEventListener('touchstart', (event) => {
    const x = event.touches[0].clientX;
    if (x < window.innerWidth / 3) {
        playerMovement.left = true;
    } else if (x > (window.innerWidth / 3) * 2) {
        playerMovement.right = true;
    } else {
        playerMovement.jump = true;
    }
});

document.addEventListener('touchend', () => {
    playerMovement.left = false;
    playerMovement.right = false;
    playerMovement.jump = false;
});

let currentSOI = 'Sun';

const raycaster = new THREE.Raycaster();

function updatePlayerPosition(deltaTime) {
    if (clock.elapsedTime < 0.2 || !player) return;
    if (isInSaucer) return;

    // Feature SD35 & SD-B30: Fixed rotational frame of reference (Local Space Physics)
    comet.updateMatrixWorld();
    const invCometMat = new THREE.Matrix4().copy(comet.matrixWorld).invert();

    // 1. Convert current world position to Comet-Local space
    const localPos = player.position.clone().applyMatrix4(invCometMat);

    // 2. Convert world velocity to local velocity to stay relative to turning ground
    const localVelocity = playerVelocity.clone().applyQuaternion(comet.quaternion.clone().invert());

    // 3. Calculate local 'Up' and 'Gravity' directions
    const localDistanceToCenter = localPos.length();
    const localUp = localPos.clone().normalize();
    const localGravityDir = localUp.clone().multiplyScalar(-1);

    // 4. Local Surface Collision (Geometric check)
    let rayHit = false;
    let currentMinDistance = cometRadius;

    // SDGB-4 Fix: Define worldGravityDir explicitly as pointing to the comet center (0,0,0)
    const worldGravityDir = new THREE.Vector3().copy(player.position).multiplyScalar(-1).normalize();

    // Start ray from significantly above the dino to catch peaks
    const rayOrigin = player.position.clone().add(localUp.clone().applyQuaternion(comet.quaternion).multiplyScalar(2));
    raycaster.set(rayOrigin, worldGravityDir);
    raycaster.far = 12; 
    
    const intersects = raycaster.intersectObject(comet, true);
    if (intersects.length > 0) {
        const bestHit = intersects[0];
        const localHitPoint = bestHit.point.clone().applyMatrix4(invCometMat);
        currentMinDistance = localHitPoint.length();
        rayHit = true;
    }

    const isGrounded = rayHit && (localDistanceToCenter <= currentMinDistance + 0.1); 

    // 5. View-Relative Input
    const camMatrix = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const worldCamForward = new THREE.Vector3(0, 0, -1).applyMatrix4(camMatrix);
    const worldCamRight = new THREE.Vector3(1, 0, 0).applyMatrix4(camMatrix);

    const invCometQuat = new THREE.Quaternion();
    comet.getWorldQuaternion(invCometQuat).invert();
    const localCamForward = worldCamForward.clone().applyQuaternion(invCometQuat);
    const localCamRight = worldCamRight.clone().applyQuaternion(invCometQuat);

    // Filter move intent to be TANGENT to local center (ignore current slope)
    // This allows movement across crags without "digging" into them
    const forwardProj = localCamForward.clone().sub(localUp.clone().multiplyScalar(localCamForward.dot(localUp))).normalize();
    const rightProj = localCamRight.clone().sub(localUp.clone().multiplyScalar(localCamRight.dot(localUp))).normalize();

    const moveIntent = new THREE.Vector3(0, 0, 0);
    if (playerMovement.forward) moveIntent.add(forwardProj);
    if (playerMovement.backward) moveIntent.sub(forwardProj);
    if (playerMovement.left) moveIntent.sub(rightProj);
    if (playerMovement.right) moveIntent.add(rightProj);
    if (playerMovement.strafeLeft) moveIntent.sub(rightProj);   // W4 input #1
    if (playerMovement.strafeRight) moveIntent.add(rightProj);  // W4 input #1
    if (moveIntent.lengthSq() > 0.001) moveIntent.normalize();

    // 6. Apply Local Acceleration
    const hillBoost = isGrounded ? 3.0 : 1.0; 
    const currentAccel = isGrounded ? moveAcceleration * hillBoost : moveAcceleration * airControlFactor;
    if (moveIntent.lengthSq() > 0) {
        localVelocity.add(moveIntent.clone().multiplyScalar(currentAccel * deltaTime));
    }

    // --- ACCUMULATION FIX & ANTI-PINBALL ---
    const localVerticalVelLimit = localUp.clone().multiplyScalar(localVelocity.dot(localUp));
    let localHorizontalVelLimit = localVelocity.clone().sub(localVerticalVelLimit);

    if (isGrounded) {
        const groundDamping = 10.0; 
       localHorizontalVelLimit.multiplyScalar(Math.exp(-groundDamping * deltaTime));

        // MAX SPEED LIMIT
        const maxWalkingSpeed = 1.5; 
        if (!playerMovement.sprinting && localHorizontalVelLimit.length() > maxWalkingSpeed) {
            localHorizontalVelLimit.setLength(maxWalkingSpeed);
        }
        else if(playerMovement.sprinting){
            localHorizontalVelLimit.setLength(maxWalkingSpeed * 1.8);
        }
    }
    
    localVelocity.copy(localVerticalVelLimit).add(localHorizontalVelLimit);

    // 8. Gravity & Jump
    if (!isGrounded) {
        localVelocity.add(localGravityDir.multiplyScalar(gravityForce * deltaTime));
    } else if (playerMovement.jump) {
        localVelocity.set(0,0,0).add(localUp.clone().multiplyScalar(jumpImpulse));
        playSound('jump');
        playerMovement.jump = false;
    }

    // 9. Integration (Projected - SDGF-37)
    let nextLocalPos = localPos.clone().add(localVelocity.clone().multiplyScalar(deltaTime));

    // SDGF-37: Step-Up/Slope Traversal Logic
    const nextWorldGravityDir = new THREE.Vector3().copy(nextLocalPos).applyMatrix4(comet.matrixWorld).multiplyScalar(-1).normalize();
    raycaster.set(nextLocalPos.clone().applyMatrix4(comet.matrixWorld), nextWorldGravityDir);
    const futureIntersects = raycaster.intersectObject(comet, true);
    if (futureIntersects.length > 0) {
        const futureHitPoint = futureIntersects[0].point.clone().applyMatrix4(invCometMat);
        const futureMinDistance = futureHitPoint.length();
        
        // If our next move takes us below the new terrain height, HARD LOCK to surface
        if (nextLocalPos.length() < futureMinDistance) {
            nextLocalPos.setLength(futureMinDistance);
            
            // Project velocity to new slope normal

            const surfaceNormal = futureIntersects[0].face.normal.clone().applyQuaternion(comet.quaternion.clone().invert());
            const projectVel = localVelocity.clone().sub(surfaceNormal.multiplyScalar(localVelocity.dot(surfaceNormal)));
            localVelocity.copy(projectVel);
        }
    }
    localPos.copy(nextLocalPos);

    // 10. CRITICAL: Hard Surface Locking (FORTIFIED - SDGB-4)
    if (rayHit && !playerMovement.jump) {
        // We are on or below the surface. We MUST stay at or above currentMinDistance.
        // If we are below the surface, or within the "magnetic" snapping zone (5.0 units),
        // we pull the player back to the surface.
        if (localPos.length() < currentMinDistance + 0.05) { 
            localPos.setLength(currentMinDistance + 0.01);
            
            // Kill radial velocity so he doesn't "bounce" or sink
            const radialVel = localVelocity.dot(localUp);
            if (radialVel < 0) { 
                localVelocity.sub(localUp.clone().multiplyScalar(radialVel));
            }
        }
    }
    
    // Safety floor: Ensure localPos never goes below comet center core
    if (localPos.length() < cometRadius - 1) {
        localPos.setLength(cometRadius + 0.1);
    }
   


    // 11. Re-project back to World Space for rendering and camera
    // CRITICAL FIX (SD-B34): Update world matrix before projecting local to world
    comet.updateMatrixWorld(true);
    player.position.copy(localPos).applyMatrix4(comet.matrixWorld);
     if (Math.abs(playerVelocity.x) > 0.1 || Math.abs(playerVelocity.z) > 0.1) {
        const targetAngle = Math.atan2(playerVelocity.x, playerVelocity.z);

        // 2. Smoothly rotate the mesh
        // 'model' is your loaded GLB scene
        const epsilon = 0.05; // Smoothness factor
        
        // This handles the 360 -> 0 degree wrap-around correctly
        let diff = targetAngle - player.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        player.rotation.y += diff * epsilon;
    }

    // Keep world velocity vector updated for external systems (debris, scoring)
    // Use the world matrix rotation to correctly orient local velocity
    const cometWorldRot = new THREE.Quaternion();
    comet.getWorldQuaternion(cometWorldRot);
    playerVelocity.copy(localVelocity).applyQuaternion(cometWorldRot);

    // 12. Dino Orientation (World Basis)
    const worldUpDir = new THREE.Vector3().copy(localUp).applyQuaternion(cometWorldRot).normalize();
    const localHorizontalVelSync = localVelocity.clone().sub(localUp.clone().multiplyScalar(localVelocity.dot(localUp)));

    if (localHorizontalVelSync.length() > 0.1) {
        const worldMoveDir = localHorizontalVelSync.clone().applyQuaternion(cometWorldRot).normalize();
        const right = new THREE.Vector3().crossVectors(worldMoveDir, worldUpDir).normalize();
        const actualForward = new THREE.Vector3().crossVectors(worldUpDir, right).normalize();
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.makeBasis(right.multiplyScalar(-1), worldUpDir, actualForward);
        player.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(rotationMatrix), 0.1);
    } else {
        // Match comet's rotation exactly when standing still
        // Align forward with the comet's current rotation basis to ensure it spins with the asteroid
        const cometForward = new THREE.Vector3(0, 0, 1).applyQuaternion(cometWorldRot);
        const right = new THREE.Vector3().crossVectors(cometForward, worldUpDir).normalize();
        const correctedForward = new THREE.Vector3().crossVectors(worldUpDir, right).normalize();

        const finalRotationMatrix = new THREE.Matrix4();
        finalRotationMatrix.makeBasis(right.multiplyScalar(-1), worldUpDir, correctedForward);
        player.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(finalRotationMatrix), 0.1);
    }
}
// --- Planet Creation ---
function createPlanetTexture(color1, color2) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; // Reduced from 1024
    canvas.height = 256; // Reduced from 512
    const context = canvas.getContext('2d');

    // Base color
    context.fillStyle = color1;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Bands
    for (let i = 0; i < 12; i++) { // Reduced from 20
        context.fillStyle = `rgba(${color2.r}, ${color2.g}, ${color2.b}, ${Math.random() * 0.3 + 0.1})`;
        const y = Math.random() * canvas.height;
        const height = Math.random() * 30 + 5;
        context.fillRect(0, y, canvas.width, height);
    }

    // Add craters/spots for extra detail
    for (let i = 0; i < 20; i++) { // Reduced from 50
        context.fillStyle = `rgba(${color2.r}, ${color2.g}, ${color2.b}, ${Math.random() * 0.2})`;
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const radius = Math.random() * 15;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    }

    return new THREE.CanvasTexture(canvas);
}


window.cometOrbitParameters = {
    initialPosition: new THREE.Vector3(50000, 10000, 500000), // Far out, up high
    initialVelocity: new THREE.Vector3(-10, -2, -500), // Coming inwards
    gravityCenter: new THREE.Vector3(0, 0, 0), // Sun is at cosmicRoot's origin
    minApproachDistance: 1000, // Closest approach to the Sun
    gravitationalConstant: 0.2, // Adjust for desired pull
};

const cometTourOrbitParameters = {
    semiMajorAxis: 10000, // Large semi-major axis for a wide ellipse
    eccentricity: 0.9,    // Highly eccentric orbit
    inclination: Math.PI / 3, // 60 degrees inclination to the ecliptic plane
    longitudeOfAscendingNode: Math.PI / 4, // 45 degrees
    argumentOfPeriapsis: Math.PI / 2, // Periapsis at highest point (90 degrees from ascending node)
    meanAnomalyAtEpoch: Math.PI, // Start at apoapsis (was 0 for periapsis)
    orbitalPeriodYears: 650, // Long period for a cometary orbit
    gravitationalParameter: 10000000 // A placeholder for Sun's GM, adjust as needed for scale
};

function calculateCometEllipticalPosition(orbitalTime) {
    const { semiMajorAxis, eccentricity, inclination, longitudeOfAscendingNode, argumentOfPeriapsis, meanAnomalyAtEpoch, orbitalPeriodYears, gravitationalParameter } = cometTourOrbitParameters;

    // Convert orbital time to years (assuming orbitalTime is in seconds, period in years)
    const timeInYears = orbitalTime / (60 * 60 * 24 * 365.25); 
    const n = 2 * Math.PI / orbitalPeriodYears; // Mean motion (radians per year)
    const M = meanAnomalyAtEpoch + n * timeInYears; // Mean Anomaly

    let E = solveKepler(M, eccentricity); // Solve Kepler's Equation for Eccentric Anomaly

    const r = semiMajorAxis * (1 - eccentricity * Math.cos(E)); // Radial distance from Sun

    // True anomaly (v)
    const v = 2 * Math.atan2(Math.sqrt(1 + eccentricity) * Math.sin(E / 2), Math.sqrt(1 - eccentricity) * Math.cos(E / 2));

    // Position in orbital plane (relative to periapsis)
    const x_orbital = r * Math.cos(v);
    const y_orbital = r * Math.sin(v);

    // Apply Argument of Periapsis
    const xp_peri = x_orbital * Math.cos(argumentOfPeriapsis) - y_orbital * Math.sin(argumentOfPeriapsis);
    const yp_peri = x_orbital * Math.sin(argumentOfPeriapsis) + y_orbital * Math.cos(argumentOfPeriapsis);

    // Apply Inclination and Longitude of Ascending Node to get 3D coordinates
    const x = xp_peri * Math.cos(longitudeOfAscendingNode) - yp_peri * Math.cos(inclination) * Math.sin(longitudeOfAscendingNode);
    const y = xp_peri * Math.sin(inclination) * Math.sin(longitudeOfAscendingNode) + yp_peri * Math.cos(inclination);
    const z = -xp_peri * Math.sin(longitudeOfAscendingNode) - yp_peri * Math.cos(inclination) * Math.cos(longitudeOfAscendingNode);

    return new THREE.Vector3(x, y, z);
}

console.log("journeyType",journeyType);



function printCometDebugInfo(){
    
}


const planetManager = {
    planets: [],
    currentPlanetIndex: 0,
    spawnDistance: 1000,
    gameState: 'playing', // 'playing', 'won', 'lost'
    orbitalTime: cometTourOrbitParameters.orbitalPeriodYears / 2 ,
    debugLogged: false,
    gravitationalParameter: cometTourOrbitParameters.gravitationalParameter,

    spawnNextPlanet: function() {
        if (this.currentPlanetIndex < planetData.length) {
            const data = planetData[this.currentPlanetIndex];
            
            if (data.isSun) {
                this.currentPlanetIndex++;
                return;
            }

            // FBF-46: Handle Asteroid Belt spawning
            if (data.isBelt) {
                const asteroidGeo = new THREE.DodecahedronGeometry(15, 0); 
                const asteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
                
                const count = data.count;
                const instancedAsteroids = new THREE.InstancedMesh(asteroidGeo, asteroidMat, count);
                
                const dummy = new THREE.Object3D();
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = data.a_min + Math.random() * (data.a_max - data.a_min);
                    const x = Math.cos(angle) * r;
                    const z = Math.sin(angle) * r;
                    const y = (Math.random() - 0.5) * 50; 
                    
                    dummy.position.set(x, y, z);
                    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                    const s = 0.5 + Math.random() * 2.5;
                    dummy.scale.set(s, s, s);
                    dummy.updateMatrix();
                    instancedAsteroids.setMatrixAt(i, dummy.matrix);
                }
                cosmicRoot.add(instancedAsteroids);
                this.planets.push({ name: data.name, isBelt: true, mesh: instancedAsteroids });
                this.currentPlanetIndex++;
                return;
            }

            const texture = createPlanetTexture(data.color1, data.color2);
            const planet = new Planet(scene, texture, data.size, data.a, data); 
            cosmicRoot.add(planet.mesh);

            if (data.hasRings) {
                const ringGeometry = new THREE.RingGeometry(data.size * 1.2, data.size * 1.8, 64);
                const ringMaterialParams = { color: 0xaaaaaa, side: THREE.DoubleSide, transparent: true, opacity: 0.6 };
                if (data.name === 'Saturn') {
                    const ringLoader = new THREE.TextureLoader();
                    ringMaterialParams.map = ringLoader.load('assets/8k_saturn_ring_alpha.png');
                    ringMaterialParams.alphaMap = ringMaterialParams.map;
                }
                const ringMaterial = new THREE.MeshBasicMaterial(ringMaterialParams);
                const ring = new THREE.Mesh(ringGeometry, ringMaterial);
                ring.rotation.x = Math.PI / 2;
                planet.mesh.add(ring);
            }

            if (data.moons) {
                data.moons.forEach(moonData => {
                    const moonTexture = createPlanetTexture(moonData.color1, moonData.color2);
                    const moon = new Planet(scene, moonTexture, moonData.size, moonData.a, moonData);
                    planet.mesh.add(moon.mesh);
                    planet.moons.push(moon);
                });
            }

            this.planets.push({
                instance: planet,
                mesh: planet.mesh,
                name: data.name,
                a: data.a,
                e: data.e,
                period: data.period,
                mass: data.mass,
                soi: calculateSOI(data.a, data.mass, sunMass),
                m0: Math.random() * Math.PI * 2 
            });
            this.currentPlanetIndex++;
        }
    },

    update: function(deltaTime) {
        
        if (this.currentPlanetIndex === 0 && planetData.length > 0) {
            console.log("--- Planetary System Scale Debug ---");
            console.log(`Comet Radius: ${cometRadius}`);
            console.log(`Sun Radius: ${sunGeometry.parameters.radius}`);
            console.log(`Celestial Scale: ${celestialScale}`);
            planetData.forEach(p => {
                if (!p.isBelt) {
                    console.log(`${p.name} - Size: ${p.size}, Semi-major Axis (a): ${p.a}`);
                }
            });
            console.log("--- End Planetary System Scale Debug ---");
            console.log(`Sun Spawn Location: X:${sun.position.x}, Y:${sun.position.y}, Z:${sun.position.z}`);
            console.log(`Comet Spawn Location: X:${comet.position.x}, Y:${comet.position.y}, Z:${comet.position.z}`);
            planetData.forEach(p => {
                if (!p.isBelt) {
                    // Get world position for spawned planets
                    const worldPlanetPos = new THREE.Vector3();
                    if (p.mesh) { // Check if the mesh exists (it will after spawnNextPlanet)
                         p.mesh.getWorldPosition(worldPlanetPos);
                    } else { // For the initial log before actual mesh creation, use its 'a' property as a proxy
                        worldPlanetPos.set(p.a, 0, 0); // Placeholder for initial radial position
                    }
                    console.log(`${p.name} - Spawn Location: X:${worldPlanetPos.x}, Y:${worldPlanetPos.y}, Z:${worldPlanetPos.z}`);
                }
            });
            console.log("-----------------------------------------");
            for(let i=0; i<planetData.length; i++) this.spawnNextPlanet();
            console.log("--- Cosmic Root Global Initial Position Debug ---");
            console.log(`Cosmic Root Global Initial Position: X:${cosmicRoot.position.x.toFixed(2)}, Y:${cosmicRoot.position.y.toFixed(2)}, Z:${cosmicRoot.position.z.toFixed(2)}`);
            console.log("-----------------------------------------");
        }

        const timeScale = Math.pow(10, timeScaleExponent);
        //console.log("tscale",timeScale);
        this.orbitalTime += (deltaTime * timeScale * 0.1) * 60 * 60 * 24 * 365.25;
    
        // SDGF-25: Move the celestial sphere (cosmicRoot) instead of the comet
        const speedMultiplier = activeProfile.worldSpeedMult; // W5: per-journey world speed
        const currentSpeed = timeScale * speedMultiplier;
        
        // Initial cosmicRoot position to start outside Neptune

        // Tour Route Logic: Follow the elliptical orbit
        // if (journeyType === 'tour') {
            // const cometAbsolutePosition = calculateCometEllipticalPosition(this.orbitalTime);
            
            // // SDGF-81: Derive velocity from the change in ABSOLUTE position
            // // This represents the comet's travel vector through the solar system.
            // if (this.lastAbsolutePosition) {
            //     const derivedVelocity = cometAbsolutePosition.clone().sub(this.lastAbsolutePosition);
            //     if (derivedVelocity.lengthSq() > 0) {
            //         window.cometCurrentVelocity.copy(derivedVelocity.normalize().multiplyScalar(100));
            //     }
            // }
            // this.lastAbsolutePosition = cometAbsolutePosition.clone();

            // // The cosmicRoot moves inversely to the comet's actual position to keep the comet (and player) centered
            // cosmicRoot.position.copy(cometAbsolutePosition).multiplyScalar(-1);
            //console.log("Current Time:", this.orbitalTime, "Position:", cometAbsolutePosition);
            // Log debug information once when starting a new game (or when comet data is first available)
            if (!this.debugLogged) {
               printCometDebugInfo();
                planetData.forEach(p => {
                    if (!p.isBelt) {
                        const planetWorldPos = new THREE.Vector3(p.a, 0, 0); 
                        planetWorldPos.applyAxisAngle(new THREE.Vector3(0,1,0), this.orbitalTime * 0.001); // Simple rotation for planets
                        planetWorldPos.add(cosmicRoot.position);
                        console.log(`${p.name} - Initial World Position: X:${planetWorldPos.x.toFixed(2)}, Y:${planetWorldPos.y.toFixed(2)}, Z:${planetWorldPos.z.toFixed(2)}, Size: ${p.size}, Semi-major Axis (a): ${p.a}`);
                    }
                });
                console.log("--- End Comet Elliptical Orbit Debug ---");
                this.debugLogged = true;
            }
        // } 
        // }

        // ── BUG FIX (comet looked parked): the comet now actually TRAVELS. Previously the
        //    Keplerian updateCometOrbit() call was commented out AND this drift was disabled, so
        //    only the planets orbited while the comet sat at the origin. We cruise the world past
        //    the comet every frame, scaled per-journey via worldSpeedMult.
        //    TUNING: raise/lower COMET_CRUISE_BASE for faster/slower travel. If the world scrolls
        //    the WRONG way (planets recede instead of approach), flip the sign below (+= → -=).
        const COMET_CRUISE_BASE = 1400; // world units / second at worldSpeedMult = 1
        cosmicRoot.position.z += COMET_CRUISE_BASE * speedMultiplier * deltaTime;

        let closestPlanet = null;
        let minDist = Infinity;
        let newSOI = 'Sun';

        this.planets.forEach((p) => {
            if (p.isBelt) return;

            // Update planet position via its class instance
            if (p.instance) {
                p.instance.update(deltaTime, this.orbitalTime);
            }

            const worldPlanetPos = new THREE.Vector3();
            p.mesh.getWorldPosition(worldPlanetPos);
            const dist = worldPlanetPos.distanceTo(comet.position);

            if (p.soi && dist < p.soi) {
                newSOI = p.name;
            }

            if (!p.reached && dist < p.size * 2 && p.name !== 'Earth') {
                p.reached = true;
                const milestoneBonus = milestoneBasePoints;
                score += milestoneBonus;
                triggerMilestoneEffect(p.name, milestoneBonus);
            }

            if (dist < minDist) {
                minDist = dist;
                closestPlanet = p.name;
            }

            if (p.name === 'Earth' && dist < 200) {
                if (this.gameState === 'playing') this.gameState = 'won';
            }
        });

        currentSOI = newSOI;
        if (closestPlanet) {
            milestoneElement.innerHTML = `Approaching: ${closestPlanet} (${Math.floor(minDist)}m) [SOI: ${currentSOI}]`;
        }
    }
};

// --- Handle Window Resizing ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Debris System (Physics/Obstacles) ---
const debrisManager = {
    debris: [],
    spawnTimer: 0,
    spawnInterval: activeProfile.debrisInterval, // W5: per-journey spawn cadence

    spawnDebris: function() {
        const isShard = Math.random() > 0.7; // 30% chance for fast shards
        const size = isShard ? (0.2 + Math.random() * 0.3) : (0.6 + Math.random() * 0.8);
        const geometry = isShard ? new THREE.IcosahedronGeometry(size, 0) : new THREE.DodecahedronGeometry(size, 0);
        const color = isShard ? 0xccffff : 0xaaaaaa;
        const material = new THREE.MeshStandardMaterial({ color: color, emissive: isShard ? 0x224444 : 0x000000 });
        const mesh = new THREE.Mesh(geometry, material);

        const angle = Math.random() * Math.PI * 2;
        const startDistance = cometRadius;

        // Spawn relative to comet's current position
        const localSpawnPos = new THREE.Vector3(
            Math.sin(angle) * startDistance,
            0,
            Math.cos(angle) * startDistance
        );
        mesh.position.copy(localSpawnPos).applyMatrix4(comet.matrixWorld);

        // Shards move much faster
        const speedMult = isShard ? 2.5 : 1.0;
        const localVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            Math.random() * 5 + 5,
            (15 + Math.random() * 15) * speedMult
        );
        const worldVelocity = localVelocity.clone().applyQuaternion(comet.quaternion);

        scene.add(mesh);
        this.debris.push({ mesh, velocity: worldVelocity, angle, distance: startDistance, size, isShard });
    },

    update: function(deltaTime) {
        this.spawnTimer += deltaTime;
        if (this.spawnTimer > this.spawnInterval) {
            this.spawnDebris();
            this.spawnTimer = 0;
        }
        const timeScale = Math.pow(10, timeScaleExponent);
        // SDGF-25: Debris velocity is now relative to the stationary comet origin.
        // We subtract the game speed from the Z velocity so they drift back as they move.
        const speedMultiplier = activeProfile.debrisSpeedMult; // W5: per-journey debris speed
        const currentSpeed = timeScale * speedMultiplier;
        const drift = new THREE.Vector3(0, 0, -currentSpeed);

        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];

            // Movement
            d.mesh.position.add(d.velocity.clone().add(drift).multiplyScalar(deltaTime));
            d.mesh.rotation.x += deltaTime * 2;
            d.mesh.rotation.y += deltaTime * 1;

            // Simple Collision Check with Player
            const distToPlayer = (player && player.position) ? d.mesh.position.distanceTo(player.position) : Infinity;
            if (distToPlayer < (d.size + playerRadius)) {
                console.log("Collision!");
                // Trigger screen shake
                triggerShake(0.8);
                // Apply knockback to player velocity instead of angle
                const knockback = d.velocity.clone().normalize().multiplyScalar(5);
                playerVelocity.add(knockback);

                // Visual feedback: flash player
                // Using a more robust way to find the material
                player.traverse(child => {
                    if (child.isMesh && child.material.emissive) {
                        child.material.emissive.setHex(0xff0000);
                        setTimeout(() => child.material.emissive.setHex(0x000000), 100);
                    }
                });

                // Remove debris on hit
                scene.remove(d.mesh);
                this.debris.splice(i, 1);
                continue;
            }

            // Cleanup
            const distFromComet = d.mesh.position.distanceTo(comet.position);
            if (distFromComet > 500) {
                scene.remove(d.mesh);
                this.debris.splice(i, 1);
            }
        }
    }
};

// Comet Orbit State (for Oort Cloud journey)
let cometCurrentPosition = cometOrbitParameters.initialPosition.clone();
let cometCurrentVelocity = cometOrbitParameters.initialVelocity.clone();

/**
 * [FIX] Updated updateCometOrbit
 * Synchronizes the comet's virtual absolute position with its Keplarian orbital parameters
 * and updates the cosmicRoot to move the world around the stationary comet.
 */
function updateCometOrbit(deltaTime) {
    const time = planetManager.orbitalTime;
    const p = cometTourOrbitParameters;

    const periodInSeconds = p.orbitalPeriodYears * 31557600;
    const meanMotion = (2 * Math.PI) / periodInSeconds;
    const M = p.meanAnomalyAtEpoch + (meanMotion * time);

    // Keplarian position
    const x = Math.cos(M) * p.semiMajorAxis;
    const z = Math.sin(M) * p.semiMajorAxis;
    
    // Calculate Y based on inclination to ensure it matches the 3D orbit
    const y = Math.sin(M) * (p.semiMajorAxis * Math.sin(p.inclination));

    // Update the persistent variable
    cometCurrentPosition.set(x, y, z);
    
    // SYNC the world anchor to the new position
    cosmicRoot.position.copy(cometCurrentPosition).multiplyScalar(-1);
}


const cometDebugStart = () => {
    // Capture the state before any orbital math or physics runs
    console.log("--- FRAME START ---");
    console.log("Comet Source (Pre-Math):", cometCurrentPosition.clone());
    console.log("World Anchor (Pre-Math):", cosmicRoot.position.clone());
};
const cometDebugEnd = () => {
    // Capture the state after updateCometOrbit has done its work
    console.log("Comet Source (Post-Math):", cometCurrentPosition.clone());
    console.log("World Anchor (Post-Math):", cosmicRoot.position.clone());
    
    // Check for the "Teleport Erasure" - if the anchor doesn't match the negative source
    const expectedX = -cometCurrentPosition.x;
    if (Math.abs(cosmicRoot.position.x - expectedX) > 0.1) {
        console.error("CRITICAL: cosmicRoot position was overwritten/drifted from cometCurrentPosition!");
    }
    console.log("--- FRAME END ---");
};

// --- W2: Launch-from-planet intro state ---
let worldSpawned = false;
let launchEaseActive = false;
let launchEaseT = 0;
const LAUNCH_EASE_DURATION = 2.2;

// Launch prompt UI (shown only during the 'intro' phase; styled by #launch-prompt in style.css)
const launchPrompt = document.createElement('div');
launchPrompt.id = 'launch-prompt';
launchPrompt.style.display = 'none';
launchPrompt.innerHTML = 'Press <b>SPACE</b> or <b>W</b> to launch';
document.body.appendChild(launchPrompt);

// Spawn the planetary system once (planetManager spawns lazily on its first update), then stage
// the home planet beside the comet so every run visibly begins next to a world.
function ensureWorldSpawned() {
    if (worldSpawned) return;
    planetManager.update(0);
    worldSpawned = true;
    stageHomePlanet();
}

function stageHomePlanet() {
    // The comet is fixed at the origin and cosmicRoot is otherwise never translated, so we offset
    // cosmicRoot to bring the home planet for THIS journey up beside us. Previously this always
    // grabbed the first non-belt planet (Neptune) for every trajectory — hence "always Neptune".
    const homeName = activeProfile.home;
    const home = planetManager.planets.find((p) => p.name === homeName && !p.isBelt && p.mesh)
              || planetManager.planets.find((p) => !p.isBelt && p.mesh);
    if (!home) return;
    const homeData = planetData.find((p) => p.name === home.name) || {};
    const homeSize = homeData.size || 100;
    const homeWorld = new THREE.Vector3();
    home.mesh.getWorldPosition(homeWorld);
    // Place the home world in front of + slightly below the comet, a safe distance off its surface.
    const homeDist = homeSize * 2.2 + cometRadius + 120;
    const desired = new THREE.Vector3(homeSize * 0.6, -homeSize * 0.4, -homeDist);
    cosmicRoot.position.add(desired.clone().sub(homeWorld));
    // Wide "on the launch pad" framing; eased back to the follow distance on thrust.
    cameraDistance = Math.min(maxZoom, cometRadius + homeSize * 0.6 + 40);
    if (milestoneElement) milestoneElement.innerHTML = `Home: ${home.name} — ready to launch`;
    if (launchPrompt) launchPrompt.style.display = 'block';
}

function launchRun() {
    if (gamePhase !== 'intro') return;
    gamePhase = 'playing';
    launchEaseActive = true;
    launchEaseT = 0;
    if (launchPrompt) launchPrompt.style.display = 'none';
    playSound('jump');
    console.log('W2: launch! Departing home world.');
}

// --- Animation Loop ---
function animate() {
    //cometDebugStart();
    requestAnimationFrame(animate);
    raycaster.camera = camera; // Ensure raycaster has the camera set for all subsequent operations
    if (statsPanel) {
        statsPanel.style.display = debugStats ? 'block' : 'none';
        if (debugStats) {
            frames++;
            const time = performance.now();
            if (time >= lastStatsTime + 1000) {
                const fps = Math.round((frames * 1000) / (time - lastStatsTime));
                const fpsEl = document.getElementById('fps-val');
                if (fpsEl) fpsEl.innerText = fps;
                
                lastStatsTime = time;
                frames = 0;
                
                if (renderer) {
                    const triEl = document.getElementById('tri-val');
                    const drawEl = document.getElementById('draw-val');
                    if (triEl) triEl.innerText = renderer.info.render.triangles;
                    if (drawEl) drawEl.innerText = renderer.info.render.calls;

                    // Update Top Geometries (SDGF-75)
                    const geosEl = document.getElementById('top-geos');
                    if (geosEl) {
                        const meshes = [];
                        scene.traverse(node => {
                            if (node.isMesh && node.geometry) {
                                meshes.push({
                                    name: node.name || node.constructor.name,
                                    tris: node.geometry.index ? node.geometry.index.count / 3 : node.geometry.attributes.position.count / 3
                                });
                            }
                        });
                        meshes.sort((a, b) => b.tris - a.tris);
                        geosEl.innerHTML = meshes.slice(0, 5)
                            .map(m => `<div style="display:flex; justify-content:space-between;"><span>${m.name.substring(0, 15)}:</span> <span>${Math.round(m.tris)}</span></div>`)
                            .join('');
                    }
                }
                
            }
        }
    }
    const timeScale = Math.pow(10, timeScaleExponent);
    const deltaTime = clock.getDelta();
    const scaledDeltaTime = deltaTime * timeScale;

    if (gamePhase === 'menu') {
        // W1: sim paused behind the start overlay; the comet still renders via the camera block below.
    } else if (gamePhase === 'intro') {
        // W2: staged beside the home planet, waiting for thrust. Let the dino settle on the surface
        // and keep shadows/idle animation alive, but do NOT advance orbital time, scoring, or debris.
        ensureWorldSpawned();
        updatePlayerPosition(deltaTime);
        if (player && mixer) { transitionTo(idleAction, 1.5); mixer.update(deltaTime); }
        updateSunShadows();
        comet.rotation.set(0, 0, 0);
    } else if (gamePhase === 'playing' && planetManager.gameState === 'playing') {
        // SDGF-64: Comet Orbit Modeling

        // Move comet first so physics conversions are accurate
        planetManager.update(scaledDeltaTime);

        //updateCometOrbit(scaledDeltaTime);
        // Update physics and player pos
        updatePlayerPosition(deltaTime);

        // Check movement state
        if (player) {
            if(playerMovement.moving && playerMovement.sprinting){
                transitionTo(runAction, 2);
            }
            else if (playerMovement.moving) {
                transitionTo(walkAction, 1);
            }
            
            else {
                transitionTo(idleAction, 1.5);
            }
            if (mixer) mixer.update(deltaTime);
        }
        updateScore(scaledDeltaTime);
        if (cometTail) cometTail.update(scaledDeltaTime);
        debrisManager.update(scaledDeltaTime);
        updateCometSections(scaledDeltaTime);
        updateCometPickups(deltaTime); // W4: crystal collection
        // if (stars) stars.update(deltaTime, camera); // Temporarily disabled for debugging Milky Way

        // Spawn fuel occasionally
        if (Math.random() < 0.005 * timeScale) spawnFuel();

        // Break comet sections occasionally (very rare)
        if (Math.random() < 0.001 ) breakCometSection();

        updateSunShadows(); // FBF-48: Update shadow casting direction

        // Rotate comet (applied to the comet group)
        // cometRotationX += deltaTime * rotationSpeed;
        // cometRotationY += deltaTime * (rotationSpeed * 0.5);
        comet.rotation.set(0, 0, 0);

        // Check for Lose Condition (Distance check now in LOCAL space)
        comet.updateMatrixWorld();
        const invCometMat = new THREE.Matrix4().copy(comet.matrixWorld).invert();
        const localPos = player ? player.position.clone().applyMatrix4(invCometMat) : new THREE.Vector3(0,0,0);

        // SDGF-41: Adjusted threshold for "Lost in Space" to handle larger comet radius.
        // The cometRadius is 30, so we check if player is significantly far from the surface.
        if (score > 500 && player) {
            if (localPos.length() > cometRadius + 35) {
                 planetManager.gameState = 'lost';
            }
        }
    } else if (planetManager.gameState === 'won') {
        scoreElement.innerHTML = `DESTINATION REACHED! Final Score: ${Math.floor(score)}`;
        scoreElement.style.left = '50%';
        scoreElement.style.transform = 'translateX(-50%)';
        scoreElement.style.top = '40%';
        scoreElement.style.fontSize = '48px';
    } else if (planetManager.gameState === 'lost') {
        scoreElement.innerHTML = `LOST IN SPACE! Final Score: ${Math.floor(score)}<br><small>Click to Restart</small>`;
        scoreElement.style.left = '50%';
        scoreElement.style.transform = 'translateX(-50%)';
        scoreElement.style.top = '40%';
        scoreElement.style.fontSize = '48px';
        scoreElement.style.textAlign = 'center';

        // Let the dino drift away
        if (player) {
            player.position.y += 0.1;
            player.position.z += 0.1;
            player.rotation.x += 0.01;
        }
    }


    // 1. Calculate the 'Up' direction (radial from comet center)
    const radialUp = player ? player.position.clone().sub(comet.position).normalize() : new THREE.Vector3(0, 1, 0);

    // 2. Calculate the total rotation of the comet for perspective sync
    const cometQuat = comet.quaternion.clone();

    // 3. Define the "Base" backward vector (default camera position behind player)
    // We want the baseOffset to be oriented relative to the radialUp basis
    const baseOffset = new THREE.Vector3(0, 0, 1);

    // Pitch around the local X axis (horizontal)
    const pitchAxis = new THREE.Vector3(1, 0, 0);
    baseOffset.applyAxisAngle(pitchAxis, cameraOrbitPitch);

    // Yaw around the local Y axis (vertical)
    const yawAxis = new THREE.Vector3(0, 1, 0);
    baseOffset.applyAxisAngle(yawAxis, cameraOrbitYaw);

    // Crucially: Transform this baseOffset from local basis space into the radialUp space
    const worldUp = new THREE.Vector3(0, 1, 0);
    const basisQuat = new THREE.Quaternion().setFromUnitVectors(worldUp, radialUp);

    // Feature SD-B35: Ensure the camera's orbital frame rotates WITH the comet.
    // We combine the surface-basis with the comet's own rotation.
    baseOffset.applyQuaternion(basisQuat);

    // W2: camera ease-in after launch — pull from the wide launch framing back to the follow distance.
    if (launchEaseActive) {
        launchEaseT += deltaTime;
        cameraDistance = THREE.MathUtils.lerp(cameraDistance, activeProfile.camDist, Math.min(1, deltaTime * 1.8));
        if (launchEaseT >= LAUNCH_EASE_DURATION) launchEaseActive = false;
    }

    // 4. Calculate final position
    const finalCameraDistance = cameraDistance;
    const targetCameraPosition = (player ? player.position.clone() : new THREE.Vector3(0, cometRadius * 2, 0))
        .add(radialUp.clone().multiplyScalar(finalCameraDistance * activeProfile.camHeight)) // W5: per-journey height boost
        .add(baseOffset.multiplyScalar(finalCameraDistance));

    // 5. Smoothly move and look
    camera.position.lerp(targetCameraPosition, 0.8);

    // Feature SD-B27: Prevention against camera clipping into the comet
    const camToComet = camera.position.clone().sub(comet.position);
    const camDistFromCenter = camToComet.length();
    if (camDistFromCenter < cometRadius + 1.0) {
        camera.position.copy(comet.position).add(camToComet.normalize().multiplyScalar(cometRadius + 1.0));
    }

    // Feature SD32: Alien-style camera (Surface = Down)
    // Lerp the camera's up vector to match the surface normal
    camera.up.lerp(radialUp, 0.1);
    if (player) camera.lookAt(player.position);

    // SDGB-38: Stress test draw calls when looking towards gas giants or away from inner planets
    // We force 10,000 extra render calls by re-rendering the scene.
    // This targets 10,000 draw calls regardless of asteroid count.
    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const sunWorldPosForStress = new THREE.Vector3();
    sun.getWorldPosition(sunWorldPosForStress);
    const dirToSun = sunWorldPosForStress.clone().sub(camera.position).normalize();
    const dotToSunStress = viewDir.dot(dirToSun);



    // SDGB-48: Keep skybox centered on camera to prevent clipping/missing
    if (typeof skybox !== 'undefined') {
        skybox.position.copy(camera.position);
    }
    renderer.render(scene, camera);
    if (sunGlowGroup) {
        const sunWorldPos = new THREE.Vector3();
        sun.getWorldPosition(sunWorldPos); 
        
        const sunDir = new THREE.Vector3().subVectors(sunWorldPos, camera.position).normalize();
        const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const dot = sunDir.dot(viewDir);

        // SDGB-14: Calculate distance to scale flare for far-away visibility
        const distToSun = camera.position.distanceTo(sunWorldPos);
        const distScaleFactor = Math.max(1, distToSun / 50000); 

        // Visibility based on camera frustum (dot product)
        let flareOpacity = dot > 0 ? 1.0 : 0.0; 

        // Occlusion Check: Raycast from camera to sun
        if (flareOpacity > 0) {
            const rayToSun = new THREE.Vector3().subVectors(sunWorldPos, camera.position);
            const rayDir = rayToSun.clone().normalize();
            
            // Start ray slightly offset from camera to avoid self-intersection with near plane
        raycaster.camera = camera;
                    raycaster.set(camera.position, rayDir);
                    raycaster.far = distToSun;
                    
                    // Check for hits against the comet or other planets
                    // FBF-48: Filter out objects that shouldn't occlude (like the flare itself)
                    const occluders = [comet, ...planetManager.planets.filter(p => !p.isBelt && p.mesh).map(p => p.mesh)];
                    const intersects = raycaster.intersectObjects(occluders, true);
                    
                    if (intersects.length > 0) {
                        // Only occlude if the intersection is significantly closer than the sun
                        if (intersects[0].distance < distToSun - 100) {
                            flareOpacity = 0.0; 
                        }
                    }
                }

                sunGlowGroup.children.forEach(child => {
                    if (child.isSprite) {
                        child.material.opacity = (child.userData.baseOpacity || 0.9) * flareOpacity;

                        // SDGB-14: Dynamic Scaling
                        const baseScale = child.userData.offset ? 8000 : 40000;
                        const dynamicScale = baseScale * distScaleFactor;
                        child.scale.set(dynamicScale, dynamicScale, 1);

                        if (child.userData.offset) {
                            const vector = sunWorldPos.clone().project(camera);
                            const screenPos = new THREE.Vector3(vector.x, vector.y, 0);
                            const center = new THREE.Vector3(0, 0, 0);
                            const offsetDir = new THREE.Vector3().subVectors(center, screenPos);

                            const artifactPos = screenPos.clone().add(offsetDir.multiplyScalar(child.userData.offset));
                            artifactPos.unproject(camera);
                            child.position.copy(artifactPos);
                        }
                    }
                });

                
            }
            //cometDebugEnd();
}
        // --- Start Animation ---
        document.addEventListener('click', () => {
            if (planetManager.gameState !== 'playing') {
                location.reload();
        }
});

animate();
// W3-W5 (caves + on-comet interactivity + trajectory polish) applied.

