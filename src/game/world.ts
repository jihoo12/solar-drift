import * as THREE from 'three';
import type { ProceduralTextureBundle } from './textures';

export const TRACK_HALF_WIDTH = 13.5;
export const PLAYER_MAX_OFFSET = 10.6;
export const SEGMENT_LENGTH = 26;
export const SEGMENT_COUNT = 20;

export type EntityKind = 'spire' | 'pylon' | 'arch' | 'ring' | 'crystal' | 'ramp' | 'repair';

export interface WorldEntity {
  id: number;
  kind: EntityKind;
  mesh: THREE.Group;
  z: number;
  offsetX: number; // Relative to trackCenterX(z)
  y: number;
  radius: number; // Horizontal collision/interaction radius
  height: number; // Height from y
  collected: boolean;
  nearMissed: boolean;
  spinSpeed: number;
  bobPhase: number;
  spinner?: THREE.Object3D;
}

/** Smooth continuous canyon spline center X for any world Z (player moves toward -Z). */
export function trackCenterX(z: number): number {
  return Math.sin(z * 0.0065) * 20 + Math.cos(z * 0.0155) * 9.5;
}

/** First derivative dX/dZ for aligning segments, props, and heading angle. */
export function trackSlopeX(z: number): number {
  return Math.cos(z * 0.0065) * 20 * 0.0065 - Math.sin(z * 0.0155) * 9.5 * 0.0155;
}

interface TerrainSegment {
  group: THREE.Group;
  zStart: number; // Nearer Z (more positive)
  floorMesh: THREE.Mesh;
  leftCliff: THREE.Mesh;
  rightCliff: THREE.Mesh;
  leftMesa: THREE.Mesh;
  rightMesa: THREE.Mesh;
  waterLeft: THREE.Mesh;
  waterRight: THREE.Mesh;
  boulders: THREE.InstancedMesh;
}

export class CanyonWorld {
  public readonly root = new THREE.Group();
  public readonly entities: WorldEntity[] = [];

  private readonly segments: TerrainSegment[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  public readonly floorMat: THREE.MeshStandardMaterial;
  public readonly cliffMat: THREE.MeshStandardMaterial;
  public readonly waterMat: THREE.MeshPhysicalMaterial;

  private readonly spireMat: THREE.MeshStandardMaterial;
  private readonly pylonSteelMat: THREE.MeshStandardMaterial;
  private readonly pylonHazardMat: THREE.MeshStandardMaterial;
  private readonly pylonBeaconMat: THREE.MeshStandardMaterial;
  private readonly ringMetalMat: THREE.MeshStandardMaterial;
  private readonly ringGlowMat: THREE.MeshStandardMaterial;
  private readonly crystalMat: THREE.MeshPhysicalMaterial;
  private readonly crystalFrameMat: THREE.MeshStandardMaterial;
  private readonly repairMat: THREE.MeshStandardMaterial;
  private readonly rampDeckMat: THREE.MeshStandardMaterial;
  private readonly rampRailMat: THREE.MeshStandardMaterial;
  private readonly boulderMat: THREE.MeshStandardMaterial;

  private readonly isSoftwareGl: boolean;
  private nextSpawnZ = -65;
  private nextEntityId = 1;
  private patternIndex = 0;

  // Shared reusable obstacle geometries
  private readonly rockCoreGeo: THREE.DodecahedronGeometry;
  private readonly rockBaseGeo: THREE.CylinderGeometry;
  private readonly rockCapGeo: THREE.ConeGeometry;
  private readonly boulderGeo: THREE.DodecahedronGeometry;
  private readonly ringOuterGeo: THREE.TorusGeometry;
  private readonly ringInnerGeo: THREE.TorusGeometry;
  private readonly ringBracketGeo: THREE.BoxGeometry;
  private readonly crystalCoreGeo: THREE.OctahedronGeometry;
  private readonly crystalGimbalGeo: THREE.TorusGeometry;

  private readonly _dummy = new THREE.Object3D();
  private readonly _color = new THREE.Color();

  constructor(textures: ProceduralTextureBundle, isSoftwareGl: boolean) {
    this.isSoftwareGl = isSoftwareGl;

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };

    // Core terrain materials
    textures.trackAlbedo.repeat.set(1, 2);
    this.floorMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.trackAlbedo,
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.08,
      }),
    );

    this.cliffMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.rockAlbedo,
        roughnessMap: textures.rockRoughness,
        color: 0xc26e48,
        roughness: 0.92,
        metalness: 0.04,
        flatShading: true,
      }),
    );

    this.waterMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x2a8899,
        roughness: 0.14,
        metalness: 0.18,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
      }),
    );

    this.boulderMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.rockAlbedo,
        color: 0xb86e4b,
        roughness: 0.9,
        metalness: 0.05,
        flatShading: true,
      }),
    );

    // Obstacle & collectible materials
    this.spireMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.rockAlbedo,
        roughnessMap: textures.rockRoughness,
        color: 0xa65336,
        roughness: 0.88,
        metalness: 0.06,
        flatShading: true,
      }),
    );

    this.pylonSteelMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.42,
        metalness: 0.78,
      }),
    );

    this.pylonHazardMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.hazardStripe,
        roughness: 0.55,
        metalness: 0.25,
      }),
    );

    this.pylonBeaconMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff5a36,
        emissive: 0xff451a,
        emissiveIntensity: 2.2,
        roughness: 0.2,
      }),
    );

    this.ringMetalMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd4a348,
        metalness: 0.86,
        roughness: 0.24,
      }),
    );

    this.ringGlowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.4,
        roughness: 0.18,
      }),
    );

    this.crystalMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 1.35,
        metalness: 0.2,
        roughness: 0.1,
        clearcoat: 1.0,
      }),
    );

    this.crystalFrameMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        metalness: 0.85,
        roughness: 0.28,
      }),
    );

    this.repairMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x10b981,
        emissiveIntensity: 2.0,
        roughness: 0.2,
        metalness: 0.3,
      }),
    );

    this.rampDeckMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: textures.chevronRamp,
        emissiveMap: textures.chevronRamp,
        emissive: 0x67e8f9,
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.55,
      }),
    );

    this.rampRailMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.38,
        metalness: 0.82,
      }),
    );

    // Shared obstacle geometries
    this.rockCoreGeo = trackGeo(new THREE.DodecahedronGeometry(1.5, 1));
    this.rockBaseGeo = trackGeo(new THREE.CylinderGeometry(1.65, 2.35, 1.4, 8));
    this.rockCapGeo = trackGeo(new THREE.ConeGeometry(1.35, 2.8, 7));
    this.boulderGeo = trackGeo(new THREE.DodecahedronGeometry(1.15, 0));
    this.ringOuterGeo = trackGeo(new THREE.TorusGeometry(3.25, 0.28, 12, 32));
    this.ringInnerGeo = trackGeo(new THREE.TorusGeometry(2.86, 0.1, 8, 28));
    this.ringBracketGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.92, 0.52));
    this.crystalCoreGeo = trackGeo(new THREE.OctahedronGeometry(0.82, 0));
    this.crystalGimbalGeo = trackGeo(new THREE.TorusGeometry(1.18, 0.08, 8, 20));

    // Build reusable canyon terrain segments
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const zStart = 42 - i * SEGMENT_LENGTH;
      const seg = this.createTerrainSegment(zStart);
      this.segments.push(seg);
      this.root.add(seg.group);
    }

    this.reset(0);
  }

  private createTerrainSegment(zStart: number): TerrainSegment {
    const group = new THREE.Group();

    const floorGeo = this.createCurvedStripGeometry(
      zStart,
      SEGMENT_LENGTH,
      -TRACK_HALF_WIDTH,
      TRACK_HALF_WIDTH,
      0,
      0,
      8,
    );
    const floorMesh = new THREE.Mesh(floorGeo, this.floorMat);
    floorMesh.receiveShadow = true;
    group.add(floorMesh);

    // Left & right sculpted canyon cliff walls (multi-terrace natural profile extending outward)
    const leftCliffGeo = this.createCliffGeometry(zStart, SEGMENT_LENGTH, -1);
    const leftCliff = new THREE.Mesh(leftCliffGeo, this.cliffMat);
    leftCliff.receiveShadow = true;
    leftCliff.castShadow = !this.isSoftwareGl;
    group.add(leftCliff);

    const rightCliffGeo = this.createCliffGeometry(zStart, SEGMENT_LENGTH, 1);
    const rightCliff = new THREE.Mesh(rightCliffGeo, this.cliffMat);
    rightCliff.receiveShadow = true;
    rightCliff.castShadow = !this.isSoftwareGl;
    group.add(rightCliff);

    // Far outer desert mesas / canyon rim extensions (no void drop-off!)
    const leftMesaGeo = this.createOuterMesaGeometry(zStart, SEGMENT_LENGTH, -1);
    const leftMesa = new THREE.Mesh(leftMesaGeo, this.cliffMat);
    group.add(leftMesa);

    const rightMesaGeo = this.createOuterMesaGeometry(zStart, SEGMENT_LENGTH, 1);
    const rightMesa = new THREE.Mesh(rightMesaGeo, this.cliffMat);
    group.add(rightMesa);

    // Shimmering side canyon river channels nestled between track shoulder and cliff base
    const waterLeftGeo = this.createCurvedStripGeometry(
      zStart,
      SEGMENT_LENGTH,
      -TRACK_HALF_WIDTH - 6.5,
      -TRACK_HALF_WIDTH + 0.2,
      -0.38,
      -0.38,
      4,
    );
    const waterLeft = new THREE.Mesh(waterLeftGeo, this.waterMat);
    group.add(waterLeft);

    const waterRightGeo = this.createCurvedStripGeometry(
      zStart,
      SEGMENT_LENGTH,
      TRACK_HALF_WIDTH - 0.2,
      TRACK_HALF_WIDTH + 6.5,
      -0.38,
      -0.38,
      4,
    );
    const waterRight = new THREE.Mesh(waterRightGeo, this.waterMat);
    group.add(waterRight);

    // Instanced side boulders along cliff edges (with subtle color & scale variation)
    const boulderCount = 12;
    const boulders = new THREE.InstancedMesh(this.boulderGeo, this.boulderMat, boulderCount);
    boulders.frustumCulled = false;
    boulders.receiveShadow = true;
    this.populateSegmentBoulders(boulders, zStart);
    group.add(boulders);

    return {
      group,
      zStart,
      floorMesh,
      leftCliff,
      rightCliff,
      leftMesa,
      rightMesa,
      waterLeft,
      waterRight,
      boulders,
    };
  }

  private createCurvedStripGeometry(
    zStart: number,
    length: number,
    xLeftOffset: number,
    xRightOffset: number,
    yLeft: number,
    yRight: number,
    zSteps: number,
  ): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((zSteps + 1) * 2 * 3);
    const uvs = new Float32Array((zSteps + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i <= zSteps; i++) {
      const t = i / zSteps;
      const z = zStart - t * length;
      const cx = trackCenterX(z);
      const v = i * 2;
      positions[v * 3] = cx + xLeftOffset;
      positions[v * 3 + 1] = yLeft;
      positions[v * 3 + 2] = z;

      positions[(v + 1) * 3] = cx + xRightOffset;
      positions[(v + 1) * 3 + 1] = yRight;
      positions[(v + 1) * 3 + 2] = z;

      uvs[v * 2] = 0;
      uvs[v * 2 + 1] = t;
      uvs[(v + 1) * 2] = 1;
      uvs[(v + 1) * 2 + 1] = t;

      if (i < zSteps) {
        const a = v;
        const b = v + 1;
        const c = v + 2;
        const d = v + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private updateCurvedStripGeometry(
    geo: THREE.BufferGeometry,
    zStart: number,
    length: number,
    xLeftOffset: number,
    xRightOffset: number,
    yLeft: number,
    yRight: number,
    zSteps: number,
  ): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= zSteps; i++) {
      const t = i / zSteps;
      const z = zStart - t * length;
      const cx = trackCenterX(z);
      const v = i * 2;
      pos.setXYZ(v, cx + xLeftOffset, yLeft, z);
      pos.setXYZ(v + 1, cx + xRightOffset, yRight, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  private cliffProfileHeight(z: number, tier: number, side: number): number {
    // Organic geological strata heights along Z
    const wave1 = Math.sin(z * 0.043 + side * 1.4) * 3.8;
    const wave2 = Math.cos(z * 0.11 - side * 2.1) * 2.1;
    const wave3 = Math.sin(z * 0.019 + side * 0.6) * 5.2;
    if (tier === 0) return -0.5;
    if (tier === 1) return Math.max(2.2, 5.2 + wave2 * 0.7);
    if (tier === 2) return Math.max(7.5, 13.5 + wave1 + wave2);
    if (tier === 3) return Math.max(12.5, 22.0 + wave1 * 1.3 + wave3);
    return Math.max(9.0, 16.0 + wave3 * 1.4);
  }

  private createCliffGeometry(zStart: number, length: number, side: -1 | 1): THREE.BufferGeometry {
    const zSteps = 6;
    const tiers = 5;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((zSteps + 1) * tiers * 3);
    const uvs = new Float32Array((zSteps + 1) * tiers * 2);
    const indices: number[] = [];

    this.writeCliffVertices(positions, uvs, zStart, length, side, zSteps);

    for (let i = 0; i < zSteps; i++) {
      for (let t = 0; t < tiers - 1; t++) {
        const a = i * tiers + t;
        const b = a + 1;
        const c = (i + 1) * tiers + t;
        const d = c + 1;
        if (side === 1) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private writeCliffVertices(
    positions: Float32Array,
    uvs: Float32Array | null,
    zStart: number,
    length: number,
    side: -1 | 1,
    zSteps: number,
  ): void {
    const tierOffsets = [
      TRACK_HALF_WIDTH + 4.2,
      TRACK_HALF_WIDTH + 8.5,
      TRACK_HALF_WIDTH + 16.0,
      TRACK_HALF_WIDTH + 28.0,
      TRACK_HALF_WIDTH + 48.0,
    ];
    const tiers = tierOffsets.length;

    for (let i = 0; i <= zSteps; i++) {
      const frac = i / zSteps;
      const z = zStart - frac * length;
      const cx = trackCenterX(z);
      const jitter = Math.sin(z * 0.085 + side * 3.1) * 1.9;

      for (let t = 0; t < tiers; t++) {
        const idx = i * tiers + t;
        const x = cx + side * (tierOffsets[t] + (t > 0 ? jitter : 0));
        const y = this.cliffProfileHeight(z, t, side);
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;

        if (uvs) {
          uvs[idx * 2] = t / (tiers - 1);
          uvs[idx * 2 + 1] = frac;
        }
      }
    }
  }

  private createOuterMesaGeometry(zStart: number, length: number, side: -1 | 1): THREE.BufferGeometry {
    const zSteps = 4;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((zSteps + 1) * 2 * 3);
    const uvs = new Float32Array((zSteps + 1) * 2 * 2);
    const indices: number[] = [];

    this.writeOuterMesaVertices(positions, uvs, zStart, length, side, zSteps);

    for (let i = 0; i < zSteps; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (side === 1) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private writeOuterMesaVertices(
    positions: Float32Array,
    uvs: Float32Array | null,
    zStart: number,
    length: number,
    side: -1 | 1,
    zSteps: number,
  ): void {
    for (let i = 0; i <= zSteps; i++) {
      const frac = i / zSteps;
      const z = zStart - frac * length;
      const cx = trackCenterX(z);
      const innerY = this.cliffProfileHeight(z, 4, side);
      const outerY = 4 + Math.sin(z * 0.025 + side * 2.3) * 6;

      const v = i * 2;
      positions[v * 3] = cx + side * (TRACK_HALF_WIDTH + 46);
      positions[v * 3 + 1] = innerY - 0.5;
      positions[v * 3 + 2] = z;

      positions[(v + 1) * 3] = cx + side * (TRACK_HALF_WIDTH + 135);
      positions[(v + 1) * 3 + 1] = outerY;
      positions[(v + 1) * 3 + 2] = z;

      if (uvs) {
        uvs[v * 2] = 0;
        uvs[v * 2 + 1] = frac;
        uvs[(v + 1) * 2] = 1;
        uvs[(v + 1) * 2 + 1] = frac;
      }
    }
  }

  private populateSegmentBoulders(mesh: THREE.InstancedMesh, zStart: number): void {
    const count = mesh.count;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = zStart - ((i + 0.5) / count) * SEGMENT_LENGTH;
      const hash = Math.abs(Math.sin(z * 12.9898 + i * 78.233) * 43758.5453) % 1;
      const cx = trackCenterX(z);
      const xOff = side * (TRACK_HALF_WIDTH + 1.4 + hash * 4.5);
      const scale = 0.85 + hash * 1.15;

      this._dummy.position.set(cx + xOff, scale * 0.48 - 0.3, z);
      this._dummy.rotation.set(hash * 2.1, hash * 5.2, hash * 1.3);
      this._dummy.scale.set(scale * 1.1, scale * 0.78, scale);
      this._dummy.updateMatrix();
      mesh.setMatrixAt(i, this._dummy.matrix);

      // Subtle per-instance mineral color variation
      this._color.setHSL(0.055 + (hash - 0.5) * 0.03, 0.42, 0.46 + (hash - 0.5) * 0.14);
      mesh.setColorAt(i, this._color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private recycleSegment(seg: TerrainSegment, newZStart: number): void {
    seg.zStart = newZStart;
    this.updateCurvedStripGeometry(
      seg.floorMesh.geometry,
      newZStart,
      SEGMENT_LENGTH,
      -TRACK_HALF_WIDTH,
      TRACK_HALF_WIDTH,
      0,
      0,
      8,
    );
    this.updateCurvedStripGeometry(
      seg.waterLeft.geometry,
      newZStart,
      SEGMENT_LENGTH,
      -TRACK_HALF_WIDTH - 6.5,
      -TRACK_HALF_WIDTH + 0.2,
      -0.38,
      -0.38,
      4,
    );
    this.updateCurvedStripGeometry(
      seg.waterRight.geometry,
      newZStart,
      SEGMENT_LENGTH,
      TRACK_HALF_WIDTH - 0.2,
      TRACK_HALF_WIDTH + 6.5,
      -0.38,
      -0.38,
      4,
    );

    const leftPos = seg.leftCliff.geometry.attributes.position as THREE.BufferAttribute;
    this.writeCliffVertices(leftPos.array as Float32Array, null, newZStart, SEGMENT_LENGTH, -1, 6);
    leftPos.needsUpdate = true;
    seg.leftCliff.geometry.computeVertexNormals();
    seg.leftCliff.geometry.computeBoundingSphere();

    const rightPos = seg.rightCliff.geometry.attributes.position as THREE.BufferAttribute;
    this.writeCliffVertices(rightPos.array as Float32Array, null, newZStart, SEGMENT_LENGTH, 1, 6);
    rightPos.needsUpdate = true;
    seg.rightCliff.geometry.computeVertexNormals();
    seg.rightCliff.geometry.computeBoundingSphere();

    const leftMesaPos = seg.leftMesa.geometry.attributes.position as THREE.BufferAttribute;
    this.writeOuterMesaVertices(leftMesaPos.array as Float32Array, null, newZStart, SEGMENT_LENGTH, -1, 4);
    leftMesaPos.needsUpdate = true;
    seg.leftMesa.geometry.computeVertexNormals();
    seg.leftMesa.geometry.computeBoundingSphere();

    const rightMesaPos = seg.rightMesa.geometry.attributes.position as THREE.BufferAttribute;
    this.writeOuterMesaVertices(rightMesaPos.array as Float32Array, null, newZStart, SEGMENT_LENGTH, 1, 4);
    rightMesaPos.needsUpdate = true;
    seg.rightMesa.geometry.computeVertexNormals();
    seg.rightMesa.geometry.computeBoundingSphere();

    this.populateSegmentBoulders(seg.boulders, newZStart);
  }

  // ---- Composite 3D Entity Builders ----

  private buildRockSpire(): THREE.Group {
    const g = new THREE.Group();
    // 1. Grounded rock plinth base
    const base = new THREE.Mesh(this.rockBaseGeo, this.spireMat);
    base.position.y = 0.65;
    base.castShadow = !this.isSoftwareGl;
    base.receiveShadow = true;
    g.add(base);

    // 2. Sculpted mid boulder block
    const mid = new THREE.Mesh(this.rockCoreGeo, this.spireMat);
    mid.position.set(0.1, 2.3, -0.08);
    mid.scale.set(1.05, 1.35, 0.95);
    mid.rotation.set(0.15, 0.8, 0.08);
    mid.castShadow = !this.isSoftwareGl;
    mid.receiveShadow = true;
    g.add(mid);

    // 3. Weathered jagged spire cap
    const cap = new THREE.Mesh(this.rockCapGeo, this.spireMat);
    cap.position.set(-0.08, 4.7, 0.05);
    cap.rotation.y = 0.4;
    cap.castShadow = !this.isSoftwareGl;
    g.add(cap);

    // 4. Side buttress rock
    const sideRock = new THREE.Mesh(this.boulderGeo, this.boulderMat);
    sideRock.position.set(1.35, 0.72, 0.65);
    sideRock.scale.set(0.85, 0.75, 0.9);
    g.add(sideRock);

    return g;
  }

  private buildCanyonPylon(): THREE.Group {
    const g = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(2.6, 0.55, 2.6);
    const colGeo = new THREE.BoxGeometry(1.45, 5.2, 1.45);
    const bandGeo = new THREE.BoxGeometry(1.58, 1.05, 1.58);
    const capGeo = new THREE.CylinderGeometry(0.45, 0.85, 0.7, 8);
    const beaconGeo = new THREE.OctahedronGeometry(0.45, 0);

    // Grounded concrete-steel pedestal
    const base = new THREE.Mesh(baseGeo, this.pylonSteelMat);
    base.position.y = 0.275;
    base.castShadow = !this.isSoftwareGl;
    base.receiveShadow = true;
    g.add(base);

    // Main steel column
    const col = new THREE.Mesh(colGeo, this.pylonSteelMat);
    col.position.y = 3.1;
    col.castShadow = !this.isSoftwareGl;
    col.receiveShadow = true;
    g.add(col);

    // Warning chevron collar
    const band = new THREE.Mesh(bandGeo, this.pylonHazardMat);
    band.position.y = 2.1;
    g.add(band);

    // Top housing + glowing warning beacon
    const cap = new THREE.Mesh(capGeo, this.pylonSteelMat);
    cap.position.y = 6.0;
    g.add(cap);

    const beacon = new THREE.Mesh(beaconGeo, this.pylonBeaconMat);
    beacon.position.y = 6.75;
    g.add(beacon);

    g.userData.ownedGeos = [baseGeo, colGeo, bandGeo, capGeo, beaconGeo];
    return g;
  }

  private buildNaturalArch(): THREE.Group {
    const g = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(2.0, 3.1, 14, 8);
    const spanGeo = new THREE.TorusGeometry(TRACK_HALF_WIDTH + 1.2, 2.35, 7, 14, Math.PI);

    const leftPillar = new THREE.Mesh(pillarGeo, this.cliffMat);
    leftPillar.position.set(-TRACK_HALF_WIDTH - 1.2, 6.5, 0);
    g.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, this.cliffMat);
    rightPillar.position.set(TRACK_HALF_WIDTH + 1.2, 6.5, 0);
    g.add(rightPillar);

    const span = new THREE.Mesh(spanGeo, this.cliffMat);
    span.position.set(0, 12.2, 0);
    span.scale.set(1, 0.72, 1.3);
    g.add(span);

    g.userData.ownedGeos = [pillarGeo, spanGeo];
    return g;
  }

  private buildBoostRing(): { group: THREE.Group; spinner: THREE.Group } {
    const group = new THREE.Group();
    const spinner = new THREE.Group();
    group.add(spinner);

    // Outer metallic ring
    const outer = new THREE.Mesh(this.ringOuterGeo, this.ringMetalMat);
    spinner.add(outer);

    // Inner glowing plasma ring
    const inner = new THREE.Mesh(this.ringInnerGeo, this.ringGlowMat);
    spinner.add(inner);

    // 4 architectural brass clamping brackets around circumference
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const b = new THREE.Mesh(this.ringBracketGeo, this.pylonSteelMat);
      b.position.set(Math.cos(ang) * 3.3, Math.sin(ang) * 3.3, 0);
      b.rotation.z = ang;
      spinner.add(b);
    }

    return { group, spinner };
  }

  private buildCrystal(isRepair: boolean): { group: THREE.Group; spinner: THREE.Group } {
    const group = new THREE.Group();
    const spinner = new THREE.Group();
    group.add(spinner);

    const core = new THREE.Mesh(this.crystalCoreGeo, isRepair ? this.repairMat : this.crystalMat);
    core.scale.set(0.85, 1.35, 0.85);
    spinner.add(core);

    const gimbal = new THREE.Mesh(this.crystalGimbalGeo, this.crystalFrameMat);
    gimbal.rotation.x = Math.PI / 3;
    spinner.add(gimbal);

    return { group, spinner };
  }

  private buildJumpRamp(): THREE.Group {
    const g = new THREE.Group();
    // Sloped ramp shape extruded along X
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(7.4, 0);
    shape.lineTo(7.4, 1.85);
    shape.lineTo(0, 0.14);
    shape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 4.4,
      bevelEnabled: false,
    });
    // Orient so ramp rises toward -Z (higher edge at -Z, low entry at +Z)
    wedgeGeo.translate(-3.7, 0, -2.2);
    wedgeGeo.rotateY(Math.PI / 2);

    const deckGeo = new THREE.PlaneGeometry(4.4, 7.6);
    deckGeo.rotateX(-Math.PI / 2 + 0.235);

    const railGeo = new THREE.BoxGeometry(0.24, 0.42, 7.6);

    const wedge = new THREE.Mesh(wedgeGeo, this.rampRailMat);
    wedge.castShadow = !this.isSoftwareGl;
    wedge.receiveShadow = true;
    g.add(wedge);

    const deck = new THREE.Mesh(deckGeo, this.rampDeckMat);
    deck.position.set(0, 1.03, 0);
    g.add(deck);

    [-2.25, 2.25].forEach((rx) => {
      const rail = new THREE.Mesh(railGeo, this.rampRailMat);
      rail.position.set(rx, 1.08, 0);
      rail.rotation.x = 0.235;
      g.add(rail);
    });

    g.userData.ownedGeos = [wedgeGeo, deckGeo, railGeo];
    return g;
  }

  private addEntity(
    kind: EntityKind,
    z: number,
    offsetX: number,
    y: number,
    radius: number,
    height: number,
    mesh: THREE.Group,
    spinner?: THREE.Object3D,
    spinSpeed = 0,
  ): void {
    const cx = trackCenterX(z);
    const slope = trackSlopeX(z);
    mesh.position.set(cx + offsetX, y, z);
    mesh.rotation.y = Math.atan(-slope);

    this.root.add(mesh);
    this.entities.push({
      id: this.nextEntityId++,
      kind,
      mesh,
      z,
      offsetX,
      y,
      radius,
      height,
      collected: false,
      nearMissed: false,
      spinSpeed,
      bobPhase: Math.random() * Math.PI * 2,
      spinner,
    });
  }

  private disposeEntityMesh(entity: WorldEntity): void {
    this.root.remove(entity.mesh);
    const owned = entity.mesh.userData.ownedGeos as THREE.BufferGeometry[] | undefined;
    if (owned) {
      owned.forEach((g) => g.dispose());
    }
  }

  public reset(playerZ: number): void {
    for (const e of this.entities) {
      this.disposeEntityMesh(e);
    }
    this.entities.length = 0;
    this.patternIndex = 0;

    // Reposition all terrain segments smoothly ahead of playerZ
    for (let i = 0; i < this.segments.length; i++) {
      const zStart = playerZ + 42 - i * SEGMENT_LENGTH;
      this.recycleSegment(this.segments[i], zStart);
    }

    this.nextSpawnZ = playerZ - 62;
    this.spawnAhead(playerZ, 0);
  }

  public spawnAhead(playerZ: number, difficulty: number): void {
    const horizonZ = playerZ - 360;
    while (this.nextSpawnZ > horizonZ) {
      this.spawnPattern(this.nextSpawnZ, difficulty);
      const spacing = THREE.MathUtils.lerp(56, 38, difficulty);
      this.nextSpawnZ -= spacing;
    }
  }

  private spawnPattern(z: number, difficulty: number): void {
    const p = this.patternIndex++;
    const laneChoices = [-7.2, 0, 7.2];

    // Scenic stone archway every 4th pattern for dramatic scale & depth
    if (p % 4 === 2) {
      const arch = this.buildNaturalArch();
      this.addEntity('arch', z - 12, 0, 0, 0, 0, arch);
    }

    const patternType = p % 5;

    if (patternType === 0) {
      // Slalom rock spires + guiding golden boost ring
      const openLaneIdx = (p * 2) % 3;
      const openOffset = laneChoices[openLaneIdx];
      laneChoices.forEach((off, idx) => {
        if (idx !== openLaneIdx) {
          this.addEntity('spire', z, off + (Math.random() - 0.5) * 1.4, 0, 2.0, 5.8, this.buildRockSpire());
        }
      });
      const ring = this.buildBoostRing();
      this.addEntity('ring', z - 12, openOffset, 3.3, 3.35, 3.35, ring.group, ring.spinner, 1.5);

      // Trail of 3 crystals leading into the ring
      for (let c = 0; c < 3; c++) {
        const crys = this.buildCrystal(false);
        this.addEntity('crystal', z + 14 - c * 7, openOffset, 1.5, 1.8, 2.0, crys.group, crys.spinner, 2.4);
      }
    } else if (patternType === 1) {
      // Jump Ramp launching through a High-Altitude Bonus Ring over Canyon Pylons!
      const rampLane = laneChoices[(p + 1) % 3];
      this.addEntity('ramp', z + 8, rampLane, 0, 2.6, 1.8, this.buildJumpRamp());

      // Pylons directly behind ramp (jump right over them!)
      this.addEntity('pylon', z - 6, rampLane, 0, 1.5, 6.2, this.buildCanyonPylon());
      const altLane = rampLane === 0 ? -7.0 : 0;
      this.addEntity('spire', z - 6, altLane, 0, 2.0, 5.8, this.buildRockSpire());

      // Elevated reward ring
      const highRing = this.buildBoostRing();
      this.addEntity('ring', z - 14, rampLane, 6.1, 3.6, 3.6, highRing.group, highRing.spinner, 2.1);
    } else if (patternType === 2) {
      // Twin Pylon Canyon Gate — narrow high-risk boost corridor in the middle
      const centerShift = ((p % 3) - 1) * 3.0;
      this.addEntity('pylon', z, centerShift - 5.2, 0, 1.5, 6.4, this.buildCanyonPylon());
      this.addEntity('pylon', z, centerShift + 5.2, 0, 1.5, 6.4, this.buildCanyonPylon());

      const ring = this.buildBoostRing();
      this.addEntity('ring', z - 2, centerShift, 3.2, 3.3, 3.3, ring.group, ring.spinner, -1.6);

      // Extra spire further ahead on higher difficulty
      if (difficulty > 0.22) {
        const extraOff = centerShift > 0 ? -6.8 : 6.8;
        this.addEntity('spire', z - 20, extraOff, 0, 2.0, 5.8, this.buildRockSpire());
      }
    } else if (patternType === 3) {
      // Sweeping S-Curve Crystal Ribbon + staggered boulders
      const dir = p % 2 === 0 ? 1 : -1;
      for (let i = 0; i < 4; i++) {
        const off = Math.sin((i / 3) * Math.PI) * 6.8 * dir;
        const crys = this.buildCrystal(false);
        this.addEntity('crystal', z + 10 - i * 8, off, 1.55, 1.85, 2.0, crys.group, crys.spinner, 2.6);
      }
      this.addEntity('spire', z + 2, -5.5 * dir, 0, 2.0, 5.8, this.buildRockSpire());
      this.addEntity('pylon', z - 14, 5.8 * dir, 0, 1.5, 6.4, this.buildCanyonPylon());
    } else {
      // Repair Core or High-Value Ring surrounded by flanking spires
      const safeLane = laneChoices[Math.floor(Math.random() * 3)];
      const spawnRepair = p % 10 === 9;
      if (spawnRepair) {
        const rep = this.buildCrystal(true);
        this.addEntity('repair', z - 4, safeLane, 1.8, 2.1, 2.2, rep.group, rep.spinner, 3.0);
      } else {
        const ring = this.buildBoostRing();
        this.addEntity('ring', z - 6, safeLane, 3.3, 3.35, 3.35, ring.group, ring.spinner, 1.8);
      }

      laneChoices.forEach((off) => {
        if (Math.abs(off - safeLane) > 3) {
          const isPylon = Math.random() > 0.45;
          if (isPylon) {
            this.addEntity('pylon', z, off, 0, 1.5, 6.4, this.buildCanyonPylon());
          } else {
            this.addEntity('spire', z, off, 0, 2.0, 5.8, this.buildRockSpire());
          }
        }
      });
    }
  }

  public update(playerZ: number, time: number, dt: number, difficulty: number): void {
    // Recycle terrain segments that have passed behind the camera
    let minZStart = Infinity;
    for (const seg of this.segments) {
      if (seg.zStart < minZStart) minZStart = seg.zStart;
    }

    for (const seg of this.segments) {
      if (seg.zStart - SEGMENT_LENGTH > playerZ + 44) {
        minZStart -= SEGMENT_LENGTH;
        this.recycleSegment(seg, minZStart);
      }
    }

    // Spawn upcoming obstacles & collectibles
    this.spawnAhead(playerZ, difficulty);

    // Animate collectibles & prune passed entities
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.z > playerZ + 38) {
        this.disposeEntityMesh(e);
        this.entities.splice(i, 1);
        continue;
      }

      if (e.spinner) {
        if (e.kind === 'ring') {
          e.spinner.rotation.z += e.spinSpeed * dt;
        } else {
          e.spinner.rotation.y += e.spinSpeed * dt;
          e.mesh.position.y = e.y + Math.sin(time * 3.4 + e.bobPhase) * 0.25;
        }
      }
    }
  }

  public dispose(): void {
    for (const e of this.entities) {
      this.disposeEntityMesh(e);
    }
    this.entities.length = 0;

    for (const seg of this.segments) {
      seg.floorMesh.geometry.dispose();
      seg.leftCliff.geometry.dispose();
      seg.rightCliff.geometry.dispose();
      seg.leftMesa.geometry.dispose();
      seg.rightMesa.geometry.dispose();
      seg.waterLeft.geometry.dispose();
      seg.waterRight.geometry.dispose();
    }
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
