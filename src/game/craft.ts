import * as THREE from 'three';
import { LIVERIES, type LiveryId } from './types';

export interface HoverCraftRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  contactShadow: THREE.Mesh;
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  leftCoreFlame: THREE.Mesh;
  rightCoreFlame: THREE.Mesh;
  thrusterLight: THREE.PointLight;
  setLivery: (id: LiveryId) => void;
  updateVisuals: (
    time: number,
    dt: number,
    speedRatio: number,
    isBoosting: boolean,
    altitude: number,
    invulnTimer: number,
  ) => void;
  dispose: () => void;
}

export function createHoverCraft(
  contactShadowTex: THREE.Texture,
  initialLivery: LiveryId,
  isSoftwareGl: boolean,
): HoverCraftRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const livery = LIVERIES.find((l) => l.id === initialLivery) ?? LIVERIES[0];

  // Distinct PBR materials with >= 0.25 roughness/metalness contrast
  const primaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: livery.primaryHex,
      metalness: 0.68,
      roughness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    }),
  );

  const chassisMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: livery.secondaryHex,
      metalness: 0.35,
      roughness: 0.68,
    }),
  );

  const accentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: livery.accentHex,
      metalness: 0.55,
      roughness: 0.28,
    }),
  );

  const brushedMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      metalness: 0.88,
      roughness: 0.36,
    }),
  );

  const canopyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0c1a2e,
      metalness: 0.15,
      roughness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: isSoftwareGl ? 0.86 : 0.92,
    }),
  );

  const thrusterRingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: livery.emissiveHex,
      emissive: livery.emissiveHex,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.1,
    }),
  );

  const headlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff8e1,
      emissive: 0xfff0c2,
      emissiveIntensity: 2.2,
      roughness: 0.1,
    }),
  );

  const flameOuterMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: livery.emissiveHex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const flameCoreMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  // 1. Primary Sculpted Fuselage (ExtrudeGeometry with smooth bevels, nose along -Z)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, -2.55); // Sleek nose tip
  hullShape.quadraticCurveTo(0.46, -1.6, 0.72, -0.35);
  hullShape.lineTo(0.84, 1.25);
  hullShape.lineTo(0.56, 1.85);
  hullShape.lineTo(-0.56, 1.85);
  hullShape.lineTo(-0.84, 1.25);
  hullShape.lineTo(-0.72, -0.35);
  hullShape.quadraticCurveTo(-0.46, -1.6, 0, -2.55);

  const hullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullShape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.09,
      bevelSegments: 3,
      curveSegments: 14,
    }),
  );
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.translate(0, 0.56, 0);

  const hullMesh = new THREE.Mesh(hullGeo, primaryMat);
  hullMesh.castShadow = !isSoftwareGl;
  hullMesh.receiveShadow = true;
  bodyGroup.add(hullMesh);

  // 2. Lower Dark Carbon Underbody Chassis & Repulsor Skirts
  const underGeo = trackGeo(new THREE.BoxGeometry(1.18, 0.24, 3.1));
  const underMesh = new THREE.Mesh(underGeo, chassisMat);
  underMesh.position.set(0, 0.26, 0.12);
  underMesh.castShadow = !isSoftwareGl;
  bodyGroup.add(underMesh);

  // 3. Forward Aerodynamic Nose Splitter & Intake Cowling
  const noseSplitGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.12, 1.05));
  const noseSplit = new THREE.Mesh(noseSplitGeo, chassisMat);
  noseSplit.position.set(0, 0.24, -1.68);
  bodyGroup.add(noseSplit);

  const noseStripeGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.06, 2.2));
  const noseStripe = new THREE.Mesh(noseStripeGeo, accentMat);
  noseStripe.position.set(0, 0.69, -0.95);
  bodyGroup.add(noseStripe);

  // 4. Sculpted Tinted Cockpit Canopy (Lathe/stretched hemisphere)
  const canopyGeo = trackGeo(new THREE.SphereGeometry(0.46, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55));
  canopyGeo.scale(0.88, 0.72, 2.35);
  const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
  canopyMesh.position.set(0, 0.62, -0.15);
  bodyGroup.add(canopyMesh);

  // Canopy structural arch frame
  const canopyArchGeo = trackGeo(new THREE.TorusGeometry(0.42, 0.04, 8, 18, Math.PI));
  const canopyArch = new THREE.Mesh(canopyArchGeo, chassisMat);
  canopyArch.position.set(0, 0.64, -0.12);
  bodyGroup.add(canopyArch);

  // 5. Swept Delta Side Wings (Left & Right ExtrudeGeometry)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.65);
  wingShape.lineTo(1.65, 0.75);
  wingShape.lineTo(1.52, 1.25);
  wingShape.lineTo(0, 0.95);
  wingShape.closePath();

  const wingGeo = trackGeo(
    new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.09,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    }),
  );
  wingGeo.rotateX(Math.PI / 2);

  const rightWing = new THREE.Mesh(wingGeo, primaryMat);
  rightWing.position.set(0.66, 0.44, 0.35);
  rightWing.rotation.z = -0.1;
  rightWing.castShadow = !isSoftwareGl;
  bodyGroup.add(rightWing);

  const leftWing = new THREE.Mesh(wingGeo, primaryMat);
  leftWing.scale.x = -1;
  leftWing.position.set(-0.66, 0.44, 0.35);
  leftWing.rotation.z = 0.1;
  leftWing.castShadow = !isSoftwareGl;
  bodyGroup.add(leftWing);

  // 6. Canted Vertical Wingtip Stabilizer Fins + Accent Trim
  const finGeo = trackGeo(new THREE.BoxGeometry(0.08, 0.62, 0.92));
  const finAccentGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.12, 0.88));
  [-1, 1].forEach((side) => {
    const finGroup = new THREE.Group();
    finGroup.position.set(side * 2.18, 0.52, 1.22);
    finGroup.rotation.z = side * -0.24;
    finGroup.rotation.y = side * -0.08;

    const fin = new THREE.Mesh(finGeo, chassisMat);
    fin.castShadow = !isSoftwareGl;
    finGroup.add(fin);

    const trim = new THREE.Mesh(finAccentGeo, accentMat);
    trim.position.set(0, 0.24, 0);
    finGroup.add(trim);

    bodyGroup.add(finGroup);
  });

  // 7. Twin LatheGeometry Turbine Engine Nacelles
  const nacelleProfile = [
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(0.32, 0.12),
    new THREE.Vector2(0.34, 0.95),
    new THREE.Vector2(0.27, 1.48),
    new THREE.Vector2(0.22, 1.56),
  ];
  const nacelleGeo = trackGeo(new THREE.LatheGeometry(nacelleProfile, 18));
  nacelleGeo.rotateX(Math.PI / 2);

  const thrusterRingGeo = trackGeo(new THREE.TorusGeometry(0.23, 0.042, 10, 20));
  const flameOuterGeo = trackGeo(new THREE.ConeGeometry(0.22, 1.65, 14, 1, true));
  flameOuterGeo.rotateX(Math.PI / 2);
  flameOuterGeo.translate(0, 0, 0.82);

  const flameCoreGeo = trackGeo(new THREE.ConeGeometry(0.12, 1.05, 12, 1, true));
  flameCoreGeo.rotateX(Math.PI / 2);
  flameCoreGeo.translate(0, 0, 0.52);

  const flames: THREE.Mesh[] = [];
  const coreFlames: THREE.Mesh[] = [];

  [-0.56, 0.56].forEach((xOff) => {
    const nacelle = new THREE.Mesh(nacelleGeo, brushedMetalMat);
    nacelle.position.set(xOff, 0.45, 0.42);
    nacelle.castShadow = !isSoftwareGl;
    bodyGroup.add(nacelle);

    const ring = new THREE.Mesh(thrusterRingGeo, thrusterRingMat);
    ring.position.set(xOff, 0.45, 1.98);
    bodyGroup.add(ring);

    const flame = new THREE.Mesh(flameOuterGeo, flameOuterMat);
    flame.position.set(xOff, 0.45, 1.98);
    bodyGroup.add(flame);
    flames.push(flame);

    const core = new THREE.Mesh(flameCoreGeo, flameCoreMat);
    core.position.set(xOff, 0.45, 1.98);
    bodyGroup.add(core);
    coreFlames.push(core);
  });

  // 8. Dual Forward LED Headlight Strips
  const headGeo = trackGeo(new THREE.BoxGeometry(0.3, 0.07, 0.14));
  [-0.52, 0.52].forEach((xOff) => {
    const lightStrip = new THREE.Mesh(headGeo, headlightMat);
    lightStrip.position.set(xOff, 0.42, -1.48);
    lightStrip.rotation.y = xOff < 0 ? 0.32 : -0.32;
    bodyGroup.add(lightStrip);
  });

  // 9. Rear Thruster Glow PointLight (adds dynamic illumination on track behind craft)
  const thrusterLight = new THREE.PointLight(livery.emissiveHex, 2.2, 14, 1.8);
  thrusterLight.position.set(0, 0.55, 2.5);
  bodyGroup.add(thrusterLight);

  // 10. Grounded Radial Contact Shadow Plane (sits flush at Y = 0.04 above track)
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(4.8, 5.4));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.05;
  root.add(contactShadow);

  const setLivery = (id: LiveryId) => {
    const cfg = LIVERIES.find((l) => l.id === id) ?? LIVERIES[0];
    primaryMat.color.setHex(cfg.primaryHex);
    chassisMat.color.setHex(cfg.secondaryHex);
    accentMat.color.setHex(cfg.accentHex);
    thrusterRingMat.color.setHex(cfg.emissiveHex);
    thrusterRingMat.emissive.setHex(cfg.emissiveHex);
    flameOuterMat.color.setHex(cfg.emissiveHex);
    thrusterLight.color.setHex(cfg.emissiveHex);
  };

  const updateVisuals = (
    time: number,
    _dt: number,
    speedRatio: number,
    isBoosting: boolean,
    altitude: number,
    invulnTimer: number,
  ) => {
    // Subtle hover oscillation
    const hoverBob = Math.sin(time * 5.2) * 0.065;
    bodyGroup.position.y = 0.72 + altitude + hoverBob;

    // Grounded contact shadow stays flush on track and softens with altitude
    contactShadow.position.y = 0.05;
    const altScale = 1 + altitude * 0.14;
    contactShadow.scale.set(altScale, 1, altScale);
    shadowMat.opacity = THREE.MathUtils.clamp(0.55 - altitude * 0.08, 0.12, 0.55);

    // Flicker flame scale based on speed & boost
    const flicker = 0.92 + Math.sin(time * 48) * 0.08 + Math.cos(time * 73) * 0.05;
    const lenScale = (0.75 + speedRatio * 0.85 + (isBoosting ? 1.35 : 0)) * flicker;
    const radScale = (isBoosting ? 1.32 : 0.95) * (0.95 + flicker * 0.06);

    flames[0].scale.set(radScale, radScale, lenScale);
    flames[1].scale.set(radScale, radScale, lenScale);
    coreFlames[0].scale.set(radScale * 0.9, radScale * 0.9, lenScale * 0.92);
    coreFlames[1].scale.set(radScale * 0.9, radScale * 0.9, lenScale * 0.92);

    thrusterLight.intensity = isBoosting ? 5.2 : 1.8 + speedRatio * 1.4;

    // Invulnerability visibility strobe after hit
    if (invulnTimer > 0) {
      bodyGroup.visible = Math.floor(time * 18) % 2 === 0;
    } else {
      bodyGroup.visible = true;
    }
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };

  return {
    root,
    bodyGroup,
    contactShadow,
    leftFlame: flames[0],
    rightFlame: flames[1],
    leftCoreFlame: coreFlames[0],
    rightCoreFlame: coreFlames[1],
    thrusterLight,
    setLivery,
    updateVisuals,
    dispose,
  };
}
