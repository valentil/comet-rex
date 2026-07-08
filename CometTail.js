import * as THREE from 'three';

class CometTail {
    constructor(scene, comet, particleDriftSpeed) {
        this.scene = scene;
        this.comet = comet;
        this.maxParticles = 99999;
        this.particleDriftSpeed = particleDriftSpeed;
        this.particles = new Float32Array(this.maxParticles * 3);
        this.velocities = new Float32Array(this.maxParticles * 3);
        this.lifetimes = new Float32Array(this.maxParticles);
        this.ages = new Float32Array(this.maxParticles);
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.particles, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0xDDDDDD, // Icy blue
            size: 0.06,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.points = new THREE.Points(geometry, material);
        this.scene.add(this.points);
        
        this.spawnIndex = 0;
        this.spawnRate = 100; // particles per frame
        this.tick = 0;
    }

    createSphericalTail(particleCount, radius, zneg, velocityScalar, lifeTimeScalar, innerRadius = 1.5) {
    const worldPos = new THREE.Vector3();
    this.comet.getWorldPosition(worldPos);
    
    // SDGB-13: Transform world position into scene space (cosmicRoot relative)
    // to ensure particles are spawned correctly relative to the current scene origin
    const scenePos = worldPos.clone();
    
    // Offset the center point
    scenePos.z -= zneg;

    for (let i = 0; i < particleCount; i++) {
        const idx = this.spawnIndex * 3;

        // --- Hollow Circle Logic ---
        const angle = Math.random() * Math.PI * 2;
        
        // Map random value between innerRadius and the outer radius
        // We use Math.sqrt to maintain uniform distribution across the area
        const r = Math.sqrt(Math.random() * (1 - Math.pow(innerRadius / radius, 2)) + Math.pow(innerRadius / radius, 2)) * radius;

        const offsetX = Math.cos(angle) * r;
        const offsetY = Math.sin(angle) * r;

        // Apply positions
        this.particles[idx]     = scenePos.x + offsetX;
        this.particles[idx + 1] = scenePos.y + offsetY;
        this.particles[idx + 2] = scenePos.z + (Math.random() - 0.5) * 20;

        // Backward velocity
        this.velocities[idx]     = (Math.random() - 0.5) * velocityScalar;
        this.velocities[idx + 1] = (Math.random() - 0.5) * velocityScalar ;
        this.velocities[idx + 2] = (-1 * this.particleDriftSpeed) - Math.random() * velocityScalar * 10;

        this.lifetimes[this.spawnIndex] = (3 + Math.random() * 2 * lifeTimeScalar) * (window.currentQuality ? window.currentQuality.particleTTL : 1.0);
        this.ages[this.spawnIndex] = 0;

        this.spawnIndex = (this.spawnIndex + 1) % this.maxParticles;
    }
}

    update(deltaTime) {
        const r = window.cometRadius || 4.5;
        const scale = r / 4.5;

        // SDGF-81: Get comet velocity vector to orient the tail
        // SDGF-82: Confirmed emitter orientation changes with comet vector.
        const velocity = window.cometCurrentVelocity || new THREE.Vector3(0, 0, 0);
        const velocityLength = velocity.length();
        
        // Calculate the backward vector (opposite of velocity)
        // If speed is near zero, default to -Z (standard tail behavior)
        const backDir = velocityLength > 0.001 
            ? velocity.clone().normalize().multiplyScalar(-1) 
            : new THREE.Vector3(0, 0, -1);
        //if (Math.random() < 0.01) console.log('[SDGF-81-DEBUG] Tail BackDir:', backDir.x.toFixed(2), backDir.y.toFixed(2), backDir.z.toFixed(2));

        // Define a coordinate system based on the backward direction
        const up = Math.abs(backDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const tangent = new THREE.Vector3().crossVectors(backDir, up).normalize();
        const bitangent = new THREE.Vector3().crossVectors(backDir, tangent).normalize();

        const spawnRateScale = 1.0;
        
        const createOrientedTail = (particleCount, radius, offsetDist, velocityScalar, lifeTimeScalar, innerRadius = 1.5) => {
            const worldPos = new THREE.Vector3();
            this.comet.getWorldPosition(worldPos);
            
            // Base spawn position (world center of comet)
            const baseSpawnPos = worldPos.clone();
            
            // Offset the center point along the tail axis (backDir)
            baseSpawnPos.addScaledVector(backDir, offsetDist);

            for (let i = 0; i < Math.floor(particleCount * spawnRateScale); i++) {
                const idx = this.spawnIndex * 3;

                const angle = Math.random() * Math.PI * 2;
                const rPart = Math.sqrt(Math.random() * (1 - Math.pow(innerRadius / radius, 2)) + Math.pow(innerRadius / radius, 2)) * radius;

                // Offset in the plane perpendicular to backDir
                const planeOffset = tangent.clone().multiplyScalar(Math.cos(angle) * rPart)
                    .add(bitangent.clone().multiplyScalar(Math.sin(angle) * rPart));

                // Apply positions
                this.particles[idx]     = baseSpawnPos.x + planeOffset.x;
                this.particles[idx + 1] = baseSpawnPos.y + planeOffset.y;
                this.particles[idx + 2] = baseSpawnPos.z + planeOffset.z;

                // Velocity logic: drift backward + slight jitter
                const jitter = new THREE.Vector3(
                    (Math.random() - 0.5) * velocityScalar,
                    (Math.random() - 0.5) * velocityScalar,
                    (Math.random() - 0.5) * velocityScalar
                );
                
                // Final velocity = drift in backDir + jitter
                const v = backDir.clone().multiplyScalar(this.particleDriftSpeed + Math.random() * velocityScalar * 10).add(jitter);
                
                this.velocities[idx]     = v.x;
                this.velocities[idx + 1] = v.y;
                this.velocities[idx + 2] = v.z;

                this.lifetimes[this.spawnIndex] = (3 + Math.random() * 2 * lifeTimeScalar) * (window.currentQuality ? window.currentQuality.particleTTL : 1.0);
                this.ages[this.spawnIndex] = 0;

                this.spawnIndex = (this.spawnIndex + 1) % this.maxParticles;
            }
        };

        // Spawn oriented tail sections
        // Parameters: particleCount, radius, offsetDist, velocityScalar, lifeTimeScalar, innerRadius
        createOrientedTail(10, r, r * 0.6, 0.1, 10);
        createOrientedTail(10, r * 1.1, 0, 0.1, 10);
        createOrientedTail(25, r * 1.2, 0, 0.8, 100);

        createOrientedTail(2, r, -r * 0.3, 0.2, 5);
        createOrientedTail(1, r * 0.5, -r * 0.35, 0.2, 5);

        createOrientedTail(2, r * 1.4, -r * 0.3, 0.16, 5);
        createOrientedTail(2, r * 1.6, -r * 0.4, 0.18, 5);


        createOrientedTail(1, r * 1.8, -r * 0.28, 0.2, 5);
        createOrientedTail(1, r * 2.2, -r * 0.22, 0.2, 5);

        const outwardDriftMagnitude = 0.005; 
        const cometWorldPos = new THREE.Vector3();
        this.comet.getWorldPosition(cometWorldPos);

        // Update existing particles
        const positions = this.points.geometry.attributes.position.array;
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.ages[i] < this.lifetimes[i]) {
                const idx = i * 3;

                // --- NEW INVERSE GRAVITY LOGIC ---
                const particlePos = new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2]);
                const directionVector = new THREE.Vector3().subVectors(particlePos, cometWorldPos).normalize();
                
                // Apply existing velocities
                positions[idx] += this.velocities[idx] * deltaTime;
                positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
                positions[idx + 2] += this.velocities[idx + 2] * deltaTime;

                // Apply outward drift
                positions[idx] += directionVector.x * outwardDriftMagnitude * deltaTime;
                positions[idx + 1] += directionVector.y * outwardDriftMagnitude * deltaTime;
                positions[idx + 2] += directionVector.z * outwardDriftMagnitude * deltaTime;
                // --- END NEW LOGIC ---

                this.ages[i] += deltaTime;
                
                // Fade out/shrink could be added here if using a custom shader
            } else {
                // // Move dead particles far away
                // const idx = i * 3;
                // positions[idx] = 10000; // SDGB-13: Increased distance to move dead particles outside visible scene
                // positions[idx + 1] = 10000;
                // positions[idx + 2] = 10000;
            }
        }
        
        this.points.geometry.attributes.position.needsUpdate = true;
    }
}

export { CometTail };
