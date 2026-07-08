import * as THREE from 'three';

class Planet {
    constructor(scene, texture, size, distance, data) {
        this.scene = scene;
        this.texture = texture;
        this.size = size;
        this.distance = distance;
        this.data = data;

        this.geometry = new THREE.SphereGeometry(this.size, 32, 32);
        
        const materialParams = { 
            map: this.texture,
            roughness: 0.8,
            metalness: 0.1
        };

        // SDGF-76: Use asset textures if provided
        if (data.texturePath) {
            const loader = new THREE.TextureLoader();
            materialParams.map = loader.load(data.texturePath);
            materialParams.map.colorSpace = THREE.SRGBColorSpace;
        }

        this.material = new THREE.MeshStandardMaterial(materialParams);
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.moons = [];
        this.labelGroup = new THREE.Group();
        this.mesh.add(this.labelGroup);
        this.createLabel(); // Call createLabel in the constructor

        this.mesh.position.z = -this.distance;
        
        // Orbital parameters
        this.orbitalAngle = Math.random() * Math.PI * 2;
        this.orbitSpeed = 0.05 / (this.data.period || 1);
    }

    createLabel() {
        const labelText = this.data.name;
        if (!labelText) return;

        // Text Label (Sprite)
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const fontSize = 32;
        context.font = `${fontSize}px Arial`;
        const metrics = context.measureText(labelText);
        canvas.width = metrics.width + 10;
        canvas.height = fontSize + 10;
        context.font = `${fontSize}px Arial`; // Redraw after canvas resize
        context.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Semi-transparent black background
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = 'green'; // Border color
        context.lineWidth = 2;
        context.strokeRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'green';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(labelText, canvas.width / 2, canvas.height / 2);
        //console.log(`Main Label Canvas for ${labelText}:`, canvas.toDataURL());
        //console.log(`Main Label Canvas Size for ${labelText}: Width=${canvas.width}, Height=${canvas.height}`);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, opacity: 1.0});
        this.textSprite = new THREE.Sprite(material);
        const mainLabelHeight = this.size * 0.15;
        this.textSprite.scale.set(mainLabelHeight * (canvas.width / canvas.height), mainLabelHeight, 1); 
        console.log(`Main Label Sprite Scale for ${labelText}: X=${this.textSprite.scale.x}, Y=${this.textSprite.scale.y}, Z=${this.textSprite.scale.z}`);

        // Position text label
        const offset = (this.size * 1.2) * 2; // Offset from planet surface
        this.textSprite.position.set(offset, this.size * 0.8, 0);
        console.log(`Main Label Sprite Position for ${labelText}: X=${this.textSprite.position.x}, Y=${this.textSprite.position.y}, Z=${this.textSprite.position.z}, Planet Size=${this.size}`);
        this.labelGroup.add(this.textSprite);

        // SDGF-66: Attached Body Label (bordered area)
        const attachedToTextContent = `Body: ${this.data.name}`;
        console.log(`Planet Label Created: ${this.data.name}, Attached To: ${attachedToTextContent}`);
        const attachedToFontSize = 36; // Smaller font size
        const attachedToCanvas = document.createElement('canvas');
        const attachedToContext = attachedToCanvas.getContext('2d');
        attachedToContext.font = `${attachedToFontSize}px Arial`;
        const attachedToMetrics = attachedToContext.measureText(attachedToTextContent);
        const padding = 8;
        attachedToCanvas.width = attachedToMetrics.width + padding * 2;
        attachedToCanvas.height = attachedToFontSize + padding * 2;
        attachedToContext.font = `${attachedToFontSize}px Arial`; // Redraw after resize
        attachedToContext.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Semi-transparent black background
        attachedToContext.fillRect(0, 0, attachedToCanvas.width, attachedToCanvas.height);
        attachedToContext.strokeStyle = 'lime'; // Border color
        attachedToContext.lineWidth = 2;
        attachedToContext.strokeRect(0, 0, attachedToCanvas.width, attachedToCanvas.height);
        attachedToContext.fillStyle = 'white';
        attachedToContext.shadowColor = 'lime';
        attachedToContext.shadowBlur = 8;
        attachedToContext.textAlign = 'center';
        attachedToContext.textBaseline = 'middle';
        attachedToContext.fillText(attachedToTextContent, attachedToCanvas.width / 2, attachedToCanvas.height / 2);
        //console.log(`Attached To Label Canvas for ${this.data.name}:`, attachedToCanvas.toDataURL());
        //console.log(`Attached To Label Canvas Size for ${this.data.name}: Width=${attachedToCanvas.width}, Height=${attachedToCanvas.height}`);

        const attachedToTexture = new THREE.CanvasTexture(attachedToCanvas);
        const attachedToMaterial = new THREE.SpriteMaterial({ map: attachedToTexture, transparent: true, depthTest: false, renderOrder: 1, emissive: 0x00ff00, emissiveIntensity: 0.6 });
        this.attachedToSprite = new THREE.Sprite(attachedToMaterial);
        const attachedLabelHeight = this.size * 0.09;
        this.attachedToSprite.scale.set(attachedLabelHeight * (attachedToCanvas.width / attachedToCanvas.height), attachedLabelHeight, 1);
        console.log(`Attached To Label Sprite Scale for ${this.data.name}: X=${this.attachedToSprite.scale.x}, Y=${this.attachedToSprite.scale.y}, Z=${this.attachedToSprite.scale.z}`);

        // Position the attachedToSprite below the main textSprite, further out from the planet
        this.attachedToSprite.position.set(
            offset, // Use the same horizontal offset as the main label
            this.size * 0.6, // Position slightly lower than the main label
            0
        );
        console.log(`Attached To Label Sprite Position for ${this.data.name}: X=${this.attachedToSprite.position.x}, Y=${this.attachedToSprite.position.y}, Z=${this.attachedToSprite.position.z}, Planet Size=${this.size}`);

        // Circle
		const points = [];
		const segments = 128;
		const radius = this.size * 1.15; // Mid-point between 1.1 and 1.2
		for (let i = 0; i <= segments; i++) {
			const angle = (i / segments) * Math.PI * 2;
			points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
		}
		const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const ringMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
        this.circle = new THREE.LineLoop(ringGeometry, ringMaterial);
        this.labelGroup.add(this.circle);

        // Line connecting circle to text
        const connectorPoints = [];
        connectorPoints.push(new THREE.Vector3(this.size * 1.15, 0, 0)); // Point on the circle
        connectorPoints.push(new THREE.Vector3(this.size * 1.15 + this.size * 0.5, 0)); // Corner of the L
        connectorPoints.push(new THREE.Vector3(this.textSprite.position.x, (this.textSprite.position.y - this.size * 0.07), 0)); // End at start of label box
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(connectorPoints);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
        this.connectorLine = new THREE.Line(lineGeometry, lineMaterial);
        this.labelGroup.add(this.connectorLine);

        this.labelGroup.visible = true; // Start visible for debugging SDGF-66
    }

    toggleLabelVisibility(visible) {
        this.labelGroup.visible = visible;
    }

    update(deltaTime, orbitalTime) {
        // Orbit logic
        if (this.data && !this.data.isStatic) {
            // FBF-39: Use a fixed angle for the tour so the route actually passes it
            if (window.location.search.includes('journey=tour') && this.data.tourZ !== undefined) {
                this.orbitalAngle = 0; // Align with the route
            } else {
                this.orbitalAngle += this.orbitSpeed * deltaTime * 0.1;
            }
            const x = Math.cos(this.orbitalAngle) * this.distance;
            const z = Math.sin(this.orbitalAngle) * this.distance;
            this.mesh.position.set(x, 0, z);
        }
        
        // Update moons
        this.moons.forEach(moon => moon.update(deltaTime, orbitalTime));

        // Self rotation
        this.mesh.rotation.y += deltaTime * this.data.rotationSpeed * 0.1;
    }
}

export { Planet };
