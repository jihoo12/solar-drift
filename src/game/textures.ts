import * as THREE from 'three';

export interface ProceduralTextureBundle {
  trackAlbedo: THREE.CanvasTexture;
  rockAlbedo: THREE.CanvasTexture;
  rockRoughness: THREE.CanvasTexture;
  chevronRamp: THREE.CanvasTexture;
  hazardStripe: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  particleGlow: THREE.CanvasTexture;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureBundle {
  const anisotropy = Math.max(1, Math.min(maxAnisotropy, 16));

  // 1. Track / Canyon Floor Texture (paved sandstone racing corridor + crisp subtle guide lines)
  const trackCanvas = document.createElement('canvas');
  trackCanvas.width = 512;
  trackCanvas.height = 512;
  const tctx = trackCanvas.getContext('2d')!;
  const rand = seededRand(4021);

  tctx.fillStyle = '#c4966c';
  tctx.fillRect(0, 0, 512, 512);

  // Subtle sedimentary grain & tire/thruster wear bands
  for (let i = 0; i < 1600; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const w = 4 + rand() * 26;
    const h = 2 + rand() * 8;
    const shade = rand() > 0.5 ? 'rgba(255,244,225,0.06)' : 'rgba(54,32,18,0.08)';
    tctx.fillStyle = shade;
    tctx.fillRect(x, y, w, h);
  }

  // Dark slate racing corridor center strip
  const corridorGrad = tctx.createLinearGradient(0, 0, 512, 0);
  corridorGrad.addColorStop(0.0, 'rgba(72, 48, 34, 0.25)');
  corridorGrad.addColorStop(0.14, 'rgba(34, 38, 46, 0.62)');
  corridorGrad.addColorStop(0.5, 'rgba(42, 47, 56, 0.68)');
  corridorGrad.addColorStop(0.86, 'rgba(34, 38, 46, 0.62)');
  corridorGrad.addColorStop(1.0, 'rgba(72, 48, 34, 0.25)');
  tctx.fillStyle = corridorGrad;
  tctx.fillRect(0, 0, 512, 512);

  // Longitudinal expansion seams & side shoulder rumble lines
  tctx.fillStyle = 'rgba(245, 178, 72, 0.85)';
  tctx.fillRect(62, 0, 8, 512);
  tctx.fillRect(442, 0, 8, 512);

  // Dashed lane guides (3 subtle lanes)
  tctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  for (let y = 16; y < 512; y += 64) {
    tctx.fillRect(190, y, 4, 34);
    tctx.fillRect(318, y, 4, 34);
  }

  // Subtle center directional chevron markers
  tctx.strokeStyle = 'rgba(255, 222, 160, 0.16)';
  tctx.lineWidth = 4;
  for (let y = 64; y < 512; y += 128) {
    tctx.beginPath();
    tctx.moveTo(232, y + 20);
    tctx.lineTo(256, y);
    tctx.lineTo(280, y + 20);
    tctx.stroke();
  }

  // Transverse slab seams
  tctx.fillStyle = 'rgba(18, 20, 26, 0.22)';
  for (let y = 0; y < 512; y += 128) {
    tctx.fillRect(62, y, 388, 3);
  }

  const trackAlbedo = new THREE.CanvasTexture(trackCanvas);
  trackAlbedo.colorSpace = THREE.SRGBColorSpace;
  trackAlbedo.wrapS = THREE.RepeatWrapping;
  trackAlbedo.wrapT = THREE.RepeatWrapping;
  trackAlbedo.anisotropy = anisotropy;

  // 2. Stratified Sandstone Cliff & Rock Texture
  const rockCanvas = document.createElement('canvas');
  rockCanvas.width = 512;
  rockCanvas.height = 512;
  const rctx = rockCanvas.getContext('2d')!;
  const rockRand = seededRand(8871);

  rctx.fillStyle = '#c8835e';
  rctx.fillRect(0, 0, 512, 512);

  // Horizontal geological strata bands
  for (let y = 0; y < 512; y += 6) {
    const bandH = 4 + rockRand() * 14;
    const tone = Math.floor(135 + rockRand() * 65);
    const r = Math.min(255, tone + 28);
    const g = Math.floor(tone * 0.72);
    const b = Math.floor(tone * 0.56);
    rctx.fillStyle = `rgb(${r},${g},${b})`;
    rctx.fillRect(0, y, 512, bandH);
  }

  // Cracks & mineral speckles
  for (let i = 0; i < 1400; i++) {
    const x = rockRand() * 512;
    const y = rockRand() * 512;
    const w = 2 + rockRand() * 20;
    const h = 1 + rockRand() * 4;
    rctx.fillStyle = rockRand() > 0.45 ? 'rgba(42,20,12,0.16)' : 'rgba(255,235,210,0.12)';
    rctx.fillRect(x, y, w, h);
  }

  const rockAlbedo = new THREE.CanvasTexture(rockCanvas);
  rockAlbedo.colorSpace = THREE.SRGBColorSpace;
  rockAlbedo.wrapS = THREE.RepeatWrapping;
  rockAlbedo.wrapT = THREE.RepeatWrapping;
  rockAlbedo.repeat.set(2, 2);
  rockAlbedo.anisotropy = anisotropy;

  // 3. Rock Roughness Map (linear data texture — NoColorSpace)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rgctx = roughCanvas.getContext('2d')!;
  rgctx.fillStyle = '#d4d4d4';
  rgctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    const v = Math.floor(175 + rockRand() * 70);
    rgctx.fillStyle = `rgb(${v},${v},${v})`;
    rgctx.fillRect(0, y, 256, 4);
  }
  const rockRoughness = new THREE.CanvasTexture(roughCanvas);
  rockRoughness.wrapS = THREE.RepeatWrapping;
  rockRoughness.wrapT = THREE.RepeatWrapping;
  rockRoughness.repeat.set(2, 2);

  // 4. Jump Ramp Glowing Chevron Texture
  const rampCanvas = document.createElement('canvas');
  rampCanvas.width = 256;
  rampCanvas.height = 512;
  const mpctx = rampCanvas.getContext('2d')!;
  mpctx.fillStyle = '#1d2432';
  mpctx.fillRect(0, 0, 256, 512);

  // Metallic deck ribs
  mpctx.fillStyle = '#2b3446';
  for (let y = 0; y < 512; y += 16) {
    mpctx.fillRect(14, y, 228, 6);
  }

  // Bright cyan-amber chevrons pointing forward
  for (let i = 0; i < 4; i++) {
    const baseY = 76 + i * 114;
    mpctx.strokeStyle = i % 2 === 0 ? '#38bdf8' : '#fbbf24';
    mpctx.lineWidth = 22;
    mpctx.lineCap = 'square';
    mpctx.beginPath();
    mpctx.moveTo(46, baseY + 52);
    mpctx.lineTo(128, baseY);
    mpctx.lineTo(210, baseY + 52);
    mpctx.stroke();
  }

  // Side rails
  mpctx.fillStyle = '#f59e0b';
  mpctx.fillRect(0, 0, 14, 512);
  mpctx.fillRect(242, 0, 14, 512);

  const chevronRamp = new THREE.CanvasTexture(rampCanvas);
  chevronRamp.colorSpace = THREE.SRGBColorSpace;
  chevronRamp.anisotropy = anisotropy;

  // 5. Industrial Hazard Stripe Texture (for Canyon Gate Pylons)
  const hazCanvas = document.createElement('canvas');
  hazCanvas.width = 256;
  hazCanvas.height = 256;
  const hctx = hazCanvas.getContext('2d')!;
  hctx.fillStyle = '#1f2633';
  hctx.fillRect(0, 0, 256, 256);
  hctx.fillStyle = '#f59e0b';
  for (let i = -256; i < 512; i += 64) {
    hctx.beginPath();
    hctx.moveTo(i, 0);
    hctx.lineTo(i + 30, 0);
    hctx.lineTo(i + 30 + 256, 256);
    hctx.lineTo(i + 256, 256);
    hctx.closePath();
    hctx.fill();
  }
  const hazardStripe = new THREE.CanvasTexture(hazCanvas);
  hazardStripe.colorSpace = THREE.SRGBColorSpace;
  hazardStripe.wrapS = THREE.RepeatWrapping;
  hazardStripe.wrapT = THREE.RepeatWrapping;
  hazardStripe.anisotropy = anisotropy;

  // 6. Soft Radial Contact Shadow Texture
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d')!;
  const sgrad = sctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  sgrad.addColorStop(0, 'rgba(8, 10, 16, 0.78)');
  sgrad.addColorStop(0.55, 'rgba(8, 10, 16, 0.36)');
  sgrad.addColorStop(1, 'rgba(8, 10, 16, 0.0)');
  sctx.fillStyle = sgrad;
  sctx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(shadowCanvas);

  // 7. Particle Soft Glow Sprite
  const partCanvas = document.createElement('canvas');
  partCanvas.width = 64;
  partCanvas.height = 64;
  const pctx = partCanvas.getContext('2d')!;
  const pgrad = pctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  pgrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  pgrad.addColorStop(0.4, 'rgba(255, 240, 200, 0.8)');
  pgrad.addColorStop(1, 'rgba(255, 200, 120, 0)');
  pctx.fillStyle = pgrad;
  pctx.fillRect(0, 0, 64, 64);
  const particleGlow = new THREE.CanvasTexture(partCanvas);
  particleGlow.colorSpace = THREE.SRGBColorSpace;

  return {
    trackAlbedo,
    rockAlbedo,
    rockRoughness,
    chevronRamp,
    hazardStripe,
    contactShadow,
    particleGlow,
    dispose: () => {
      trackAlbedo.dispose();
      rockAlbedo.dispose();
      rockRoughness.dispose();
      chevronRamp.dispose();
      hazardStripe.dispose();
      contactShadow.dispose();
      particleGlow.dispose();
    },
  };
}
