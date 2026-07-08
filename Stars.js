
import * as THREE from 'three';

export class Stars {
    constructor(scene, camera, numberOfStars = 500) {
        this.scene = scene;
        this.camera = camera; // Store camera reference
        this.stars = [];
        this.starGroup = new THREE.Group();
        this.speed = { near: 0.0, mid: 0.0, far: 0.0 }; // Further increased speeds for stronger parallax

        this.generateStars(numberOfStars);
        this.scene.add(this.starGroup);
    }

    generateStars(count) {
        // Simplified materials without external texture to rule out loading issues
        const materialNear = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        const materialMid = new THREE.SpriteMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 });
        const materialFar = new THREE.SpriteMaterial({ color: 0x999999, transparent: true, opacity: 0.4 });

        for (let i = 0; i < count; i++) {
            const depth = Math.random(); // 0 to 1 for depth effect
            let material, size, layer;

            if (depth < 0.3) {
                material = materialNear;
                size = Math.random() * 0.2 + 0.1; // Larger stars
                layer = 'near';
            } else if (depth < 0.7) {
                material = materialMid;
                size = Math.random() * 0.15 + 0.075; // Larger stars
                layer = 'mid';
            } else {
                material = materialFar;
                size = Math.random() * 0.1 + 0.04; // Larger stars
                layer = 'far';
            }

            const star = new THREE.Sprite(material);
            star.scale.set(size, size, 1);

            star.position.x = (Math.random() - 0.5) * 800; // Even wider X range
            star.position.y = (Math.random() - 0.5) * 800; // Even wider Y range
            // Initial Z position: now from significantly behind to significantly in front
            star.position.z = (Math.random() * 5000) - 2500; // From -2500 to +2500 (huge range)

            this.starGroup.add(star);
            this.stars.push({ sprite: star, layer: layer, initialZ: star.position.z });
        }
    }

    update(deltaTime, camera) {
        this.stars.forEach(star => {
            let moveSpeed;
            switch (star.layer) {
                case 'near':
                    moveSpeed = this.speed.near;
                    break;
                case 'mid':
                    moveSpeed = this.speed.mid;
                    break;
                case 'far':
                    moveSpeed = this.speed.far;
                    break;
            }
            star.sprite.position.z -= moveSpeed * deltaTime * 100; // Even more significantly faster overall movement

            // If star goes significantly *behind* the camera, reset it much further *in front*
            if (star.sprite.position.z < camera.position.z - 500) { // Reset if 5000 units behind
                star.sprite.position.z = camera.position.z + 5000; // Reset 50000 units ahead
            }
        });
    }
}
