import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createHoverCraft, type HoverCraftRig } from './craft';
import { SoundEngine } from './sound';
import { createProceduralTextures, type ProceduralTextureBundle } from './textures';
import {
  BIOMES,
  type CalloutEvent,
  type CameraMode,
  type GamePhase,
  type HudSnapshot,
  type LiveryId,
} from './types';
import { CanyonWorld, PLAYER_MAX_OFFSET, trackCenterX, trackSlopeX } from './world';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onCallout: (event: CalloutEvent) => void;
  onContextLost: (lost: boolean) => void;
  onRecordSaved: (bestScore: number, bestDistance: number, bestCombo: number) => void;
}

export interface EngineInitOptions {
  container: HTMLElement;
  initialLivery: LiveryId;
  initialCameraMode: CameraMode;
  initialMuted: boolean;
  initialBestScore: number;
  callbacks: EngineCallbacks;
}

const MAX_PARTICLES = 240;
const SPEED_DUST_COUNT = 120;
const MAX_SHIELDS = 3;

export class SolarDriftEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: EngineCallbacks;
  private readonly isSoftwareGl: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly textures: ProceduralTextureBundle;
  private readonly craft: HoverCraftRig;
  private readonly world: CanyonWorld;
  private readonly sound: SoundEngine;

  // Lighting & Sky
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly skyFog: THREE.FogExp2;
  private readonly skyColor: THREE.Color;
  private readonly sunDisc: THREE.Mesh;

  // Burst Particle Pool (zero GC in loop)
  private readonly particles: Particle[] = [];
  private readonly particleGeo: THREE.BufferGeometry;
  private readonly particlePosArr: Float32Array;
  private readonly particleColArr: Float32Array;
  private readonly particlePoints: THREE.Points;
  private readonly particleMat: THREE.PointsMaterial;

  // Ambient Speed Lines / Canyon Dust
  private readonly dustGeo: THREE.BufferGeometry;
  private readonly dustPosArr: Float32Array;
  private readonly dustMat: THREE.PointsMaterial;
  private readonly dustPoints: THREE.Points;

  // Pre-allocated math helpers (zero GC)
  private readonly _camDesiredPos = new THREE.Vector3();
  private readonly _camDesiredLook = new THREE.Vector3();
  private readonly _camLookCurrent = new THREE.Vector3();
  private readonly _tmpColorA = new THREE.Color();
  private readonly _tmpColorB = new THREE.Color();

  // Game State
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode;
  private bestScore: number;
  private bestDistance = 0;
  private bestCombo = 0;

  private playerZ = 0;
  private offsetX = 0;
  private lateralVel = 0;
  private altitude = 0;
  private verticalVel = 0;
  private isGrounded = true;
  private rollAngle = 0;
  private pitchAngle = 0;

  private speed = 58; // world units / sec
  private baseSpeed = 58;
  private score = 0;
  private distance = 0;
  private combo = 1;
  private maxCombo = 1;
  private comboTimer = 0;
  private shields = MAX_SHIELDS;
  private boost = 45;
  private isBoosting = false;
  private invulnTimer = 0;
  private ringsCleared = 0;
  private nearMisses = 0;
  private isNewRecord = false;
  private cameraShake = 0;

  // Input flags
  private keyLeft = false;
  private keyRight = false;
  private keyJump = false;
  private keyDive = false;
  private keyBoost = false;
  private touchSteer = 0; // -1..1
  private touchBoost = false;
  private jumpQueued = false;

  // Loop & Timers
  private disposed = false;
  private frameId = 0;
  private lastTimestamp = 0;
  private elapsedTime = 0;
  private hudEmitAccum = 0;
  private calloutId = 1;
  private resizeObserver: ResizeObserver;

  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly handleKeyUpBound: (e: KeyboardEvent) => void;
  private readonly handleContextLostBound: (e: Event) => void;
  private readonly handleContextRestoredBound: () => void;

  constructor(options: EngineInitOptions) {
    this.container = options.container;
    this.callbacks = options.callbacks;
    this.cameraMode = options.initialCameraMode;
    this.bestScore = options.initialBestScore;

    // Detect software WebGL strictly from renderer string
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // Scene, Environment Reflection & Horizon-Matched Fog
    this.scene = new THREE.Scene();
    const initialBiome = BIOMES[0];
    this.skyColor = new THREE.Color(initialBiome.skyColor);
    this.scene.background = this.skyColor;
    this.skyFog = new THREE.FogExp2(initialBiome.fogColor, initialBiome.fogDensity);
    this.scene.fog = this.skyFog;

    // Mandatory studio environment map via RoomEnvironment on every device
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 420);

    // 3-Point Balanced Outdoor Canyon Lighting (Warm Key + Cool Hemisphere Fill + Rim)
    this.hemiLight = new THREE.HemisphereLight(initialBiome.hemiSky, initialBiome.hemiGround, 0.95);
    this.hemiLight.position.set(0, 80, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(initialBiome.sunColor, initialBiome.sunIntensity);
    this.sunLight.position.set(36, 56, 22);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 180;
    const d = 44;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x88ccff, 0.65);
    this.rimLight.position.set(-28, 22, -45);
    this.scene.add(this.rimLight);

    // Warm Horizon Sun Disc (always rides far ahead of player)
    const sunGeo = new THREE.CircleGeometry(26, 28);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfff3cf,
      fog: false,
      transparent: true,
      opacity: 0.92,
    });
    this.sunDisc = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunDisc);

    // Procedural Textures, World & Composite Craft
    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.world = new CanyonWorld(this.textures, this.isSoftwareGl);
    this.scene.add(this.world.root);

    this.craft = createHoverCraft(this.textures.contactShadow, options.initialLivery, this.isSoftwareGl);
    this.scene.add(this.craft.root);

    // Burst Particle System
    this.particlePosArr = new Float32Array(MAX_PARTICLES * 3);
    this.particleColArr = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        r: 1,
        g: 1,
        b: 1,
      });
      this.particlePosArr[i * 3 + 1] = -999;
    }
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePosArr, 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColArr, 3));
    this.particleMat = new THREE.PointsMaterial({
      size: 1.45,
      map: this.textures.particleGlow,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);

    // Ambient Speed Dust Stream
    this.dustPosArr = new Float32Array(SPEED_DUST_COUNT * 3);
    for (let i = 0; i < SPEED_DUST_COUNT; i++) {
      const z = -Math.random() * 140;
      this.dustPosArr[i * 3] = trackCenterX(z) + (Math.random() - 0.5) * 34;
      this.dustPosArr[i * 3 + 1] = 0.6 + Math.random() * 11;
      this.dustPosArr[i * 3 + 2] = z;
    }
    this.dustGeo = new THREE.BufferGeometry();
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPosArr, 3));
    this.dustMat = new THREE.PointsMaterial({
      size: 0.52,
      map: this.textures.particleGlow,
      color: 0xffe8c2,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(this.dustGeo, this.dustMat);
    this.dustPoints.frustumCulled = false;
    this.scene.add(this.dustPoints);

    // Procedural Sound Engine
    this.sound = new SoundEngine(options.initialMuted);

    // Position craft & camera cleanly on frame 0
    this.syncCraftTransform(0);
    this.snapCameraToCraft();

    // Pre-warm shaders once on real GPU
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Event Listeners
    this.handleKeyDownBound = this.handleKeyDown.bind(this);
    this.handleKeyUpBound = this.handleKeyUp.bind(this);
    this.handleContextLostBound = (e: Event) => {
      e.preventDefault();
      this.callbacks.onContextLost(true);
    };
    this.handleContextRestoredBound = () => {
      this.callbacks.onContextLost(false);
    };

    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.emitHud();
    this.lastTimestamp = performance.now();
    this.tick(this.lastTimestamp);
  }

  // ---- Public Control API ----

  public startGame(): void {
    this.sound.unlock();
    this.phase = 'playing';
    this.playerZ = 0;
    this.offsetX = 0;
    this.lateralVel = 0;
    this.altitude = 0;
    this.verticalVel = 0;
    this.isGrounded = true;
    this.rollAngle = 0;
    this.pitchAngle = 0;

    this.baseSpeed = 62;
    this.speed = 62;
    this.score = 0;
    this.distance = 0;
    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.shields = MAX_SHIELDS;
    this.boost = 50;
    this.isBoosting = false;
    this.invulnTimer = 0;
    this.ringsCleared = 0;
    this.nearMisses = 0;
    this.isNewRecord = false;
    this.cameraShake = 0;

    this.world.reset(0);
    this.syncCraftTransform(0);
    this.snapCameraToCraft();
    this.emitHud();
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.sound.updateEngine(0, false, false);
      this.emitHud();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.lastTimestamp = performance.now();
      this.emitHud();
    }
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  public setLivery(livery: LiveryId): void {
    this.craft.setLivery(livery);
  }

  public setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  public setTouchSteer(dir: number): void {
    this.touchSteer = THREE.MathUtils.clamp(dir, -1, 1);
  }

  public triggerJump(): void {
    this.sound.unlock();
    this.jumpQueued = true;
  }

  public setTouchBoost(active: boolean): void {
    this.sound.unlock();
    this.touchBoost = active;
  }

  // ---- Input Handlers ----

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      this.keyLeft = true;
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      this.keyRight = true;
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (this.phase === 'playing') {
        e.preventDefault();
        this.jumpQueued = true;
      }
      this.keyJump = true;
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      this.keyDive = true;
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keyBoost = true;
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause();
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyLeft = false;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyRight = false;
    else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.keyJump = false;
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.keyDive = false;
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keyBoost = false;
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // ---- Render Loop with Software-WebGL Pacing ----

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (now: number): void => {
    if (this.disposed) return;

    const rawDt = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.065);

    if (this.phase !== 'paused') {
      this.elapsedTime += dt;
      this.stepSimulation(dt);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick(performance.now()));
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  // ---- Core Gameplay & Physics Step ----

  private stepSimulation(dt: number): void {
    const isPlaying = this.phase === 'playing';
    const isTitle = this.phase === 'title';

    if (isTitle) {
      // Smooth autopilot demo glide through canyon on Title screen
      this.stepAutopilot(dt);
    } else if (isPlaying) {
      this.stepPlayerControl(dt);
    } else if (this.phase === 'gameover') {
      // Smooth deceleration after game over
      this.speed = THREE.MathUtils.damp(this.speed, 0, 2.8, dt);
      this.playerZ -= this.speed * dt;
      this.rollAngle = THREE.MathUtils.damp(this.rollAngle, 0.25, 3, dt);
      this.sound.updateEngine(0, false, false);
    }

    const difficulty = THREE.MathUtils.clamp(this.distance / 3200, 0, 1);

    // Update biome atmosphere smoothly every ~900m
    this.updateBiomeAtmosphere(dt);

    // Update terrain & obstacles
    this.world.update(this.playerZ, this.elapsedTime, dt, difficulty);

    // Sync craft world transform & visual effects
    this.syncCraftTransform(dt);

    // Update lights & horizon sun to track player
    const cx = trackCenterX(this.playerZ);
    this.sunLight.position.set(cx + 36, 56, this.playerZ + 22);
    this.sunLight.target.position.set(cx, 0, this.playerZ - 26);
    this.sunDisc.position.set(trackCenterX(this.playerZ - 340) + 52, 58, this.playerZ - 340);
    this.sunDisc.lookAt(this.camera.position);

    // Update particles & speed dust
    this.updateParticles(dt);
    this.updateSpeedDust(dt);

    // Update camera
    this.updateCamera(dt);

    // Emit HUD snapshot at ~18Hz to keep React ultra-light
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.055) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private stepAutopilot(dt: number): void {
    this.speed = 46;
    this.playerZ -= this.speed * dt;

    // Look ahead for nearest hazard and glide cleanly around it
    let targetOffset = Math.sin(this.elapsedTime * 0.65) * 4.5;
    for (const e of this.world.entities) {
      const dz = this.playerZ - e.z;
      if (dz > 4 && dz < 46) {
        if (e.kind === 'ring') {
          targetOffset = e.offsetX;
          break;
        }
        if ((e.kind === 'spire' || e.kind === 'pylon') && Math.abs(e.offsetX - targetOffset) < 4.2) {
          targetOffset = e.offsetX > 0 ? -6.5 : 6.5;
        }
      }
    }

    const prevOff = this.offsetX;
    this.offsetX = THREE.MathUtils.damp(this.offsetX, targetOffset, 3.2, dt);
    this.lateralVel = (this.offsetX - prevOff) / dt;
    this.altitude = THREE.MathUtils.damp(this.altitude, 0.35, 3, dt);
    this.rollAngle = THREE.MathUtils.damp(this.rollAngle, -this.lateralVel * 0.032, 6, dt);
    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, 0.02, 5, dt);
  }

  private stepPlayerControl(dt: number): void {
    const difficulty = THREE.MathUtils.clamp(this.distance / 3200, 0, 1);
    this.baseSpeed = THREE.MathUtils.lerp(62, 114, difficulty);

    // Boost logic
    const wantsBoost = (this.keyBoost || this.touchBoost) && this.boost > 4;
    if (wantsBoost && !this.isBoosting && this.boost >= 12) {
      this.isBoosting = true;
      this.sound.playBoostStart();
    } else if (!wantsBoost || this.boost <= 0.5) {
      this.isBoosting = false;
    }

    if (this.isBoosting) {
      this.boost = Math.max(0, this.boost - 32 * dt);
    } else {
      this.boost = Math.min(100, this.boost + 4.8 * dt);
    }

    const targetSpeed = this.isBoosting ? this.baseSpeed * 1.48 : this.baseSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, this.isBoosting ? 7.5 : 4.2, dt);

    // Advance forward along -Z
    const stepDist = this.speed * dt;
    this.playerZ -= stepDist;
    this.distance += stepDist * 0.55;
    this.score += stepDist * 0.75 * this.combo * (this.isBoosting ? 1.5 : 1);

    // Steering input
    let steerInput = 0;
    if (this.keyLeft) steerInput -= 1;
    if (this.keyRight) steerInput += 1;
    if (Math.abs(this.touchSteer) > 0.01) steerInput = this.touchSteer;

    const maxLatSpeed = this.isBoosting ? 31 : 25.5;
    const targetLatVel = steerInput * maxLatSpeed;
    this.lateralVel = THREE.MathUtils.damp(this.lateralVel, targetLatVel, 12.5, dt);
    this.offsetX += this.lateralVel * dt;

    // Soft canyon wall cushion bounce
    if (this.offsetX < -PLAYER_MAX_OFFSET) {
      this.offsetX = -PLAYER_MAX_OFFSET;
      this.lateralVel = Math.max(0, this.lateralVel * -0.35);
    } else if (this.offsetX > PLAYER_MAX_OFFSET) {
      this.offsetX = PLAYER_MAX_OFFSET;
      this.lateralVel = Math.min(0, this.lateralVel * -0.35);
    }

    // Vertical physics (Hover Jump + Dive + Jump Ramps)
    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (this.isGrounded) {
        this.verticalVel = 15.8;
        this.isGrounded = false;
        this.sound.playJump();
        this.spawnBurst(
          trackCenterX(this.playerZ) + this.offsetX,
          0.5,
          this.playerZ + 0.8,
          14,
          0x38bdf8,
          7,
        );
      }
    }

    const gravity = this.keyDive && !this.isGrounded ? 68 : 34;
    if (!this.isGrounded || this.verticalVel > 0) {
      this.verticalVel -= gravity * dt;
      this.altitude += this.verticalVel * dt;
      if (this.altitude <= 0) {
        this.altitude = 0;
        this.verticalVel = 0;
        this.isGrounded = true;
      }
    }

    // Craft banking roll & pitch feel
    const targetRoll = THREE.MathUtils.clamp(-this.lateralVel * 0.024, -0.52, 0.52);
    const targetPitch = THREE.MathUtils.clamp(
      this.verticalVel * 0.022 + (this.isBoosting ? 0.045 : 0),
      -0.32,
      0.38,
    );
    this.rollAngle = THREE.MathUtils.damp(this.rollAngle, targetRoll, 11, dt);
    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, targetPitch, 9, dt);

    // Combo decay timer
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
      }
    }

    // Invulnerability & camera shake decay
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.8);

    // Thruster exhaust particles when boosting
    if (this.isBoosting && Math.random() < 0.7) {
      const wx = trackCenterX(this.playerZ) + this.offsetX;
      this.spawnBurst(wx + (Math.random() - 0.5) * 1.1, 1.0 + this.altitude, this.playerZ + 2.2, 2, 0xfbbf24, 5);
    }

    // Update engine audio pitch
    const speedRatio = THREE.MathUtils.clamp((this.speed - 55) / 85, 0, 1);
    this.sound.updateEngine(speedRatio, this.isBoosting, true);

    // Collision, Ring Pass, Ramp Launch, Crystal & Near-Miss detection
    this.evaluateCollisions();

    // Live record check
    if (Math.floor(this.score) > this.bestScore && this.bestScore > 0 && !this.isNewRecord) {
      this.isNewRecord = true;
      this.emitCallout('신기록 달성!', '최고 점수를 경신했습니다', 'emerald');
    }
  }

  private evaluateCollisions(): void {
    const craftY = 0.9 + this.altitude;
    const craftWorldX = trackCenterX(this.playerZ) + this.offsetX;

    for (const e of this.world.entities) {
      if (e.collected || e.kind === 'arch') continue;

      const dz = Math.abs(e.z - this.playerZ);
      const dx = Math.abs(e.offsetX - this.offsetX);

      if (e.kind === 'ring') {
        if (dz < 3.4) {
          const dy = Math.abs(e.y - craftY);
          const radialDist = Math.hypot(dx, dy);
          if (radialDist < e.radius + 0.85) {
            e.collected = true;
            e.mesh.visible = false;
            this.ringsCleared++;
            this.combo = Math.min(8, this.combo + 1);
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.comboTimer = 5.5;
            const bonus = 250 * this.combo;
            this.score += bonus;
            this.boost = Math.min(100, this.boost + 24);
            this.speed = Math.min(this.baseSpeed * 1.55, this.speed + 16);
            this.sound.playRingPass(this.combo);
            this.spawnBurst(craftWorldX, craftY, this.playerZ - 1.5, 28, 0xfbbf24, 14);
            this.emitCallout(`부스트 링 +${bonus}`, `${this.combo}배 콤보`, 'amber');
          }
        }
      } else if (e.kind === 'crystal' || e.kind === 'repair') {
        if (dz < 2.8 && dx < e.radius + 0.9 && Math.abs(e.y - craftY) < 2.4) {
          e.collected = true;
          e.mesh.visible = false;
          if (e.kind === 'repair') {
            this.shields = Math.min(MAX_SHIELDS, this.shields + 1);
            this.boost = Math.min(100, this.boost + 25);
            this.score += 300;
            this.sound.playRepair();
            this.spawnBurst(craftWorldX, craftY, this.playerZ, 26, 0x34d399, 12);
            this.emitCallout('실드 복구 +1', '에너지 충전', 'emerald');
          } else {
            const pts = 80 * this.combo;
            this.score += pts;
            this.boost = Math.min(100, this.boost + 11);
            this.comboTimer = Math.max(this.comboTimer, 3.8);
            this.sound.playCrystal();
            this.spawnBurst(craftWorldX, craftY, this.playerZ, 14, 0x38bdf8, 10);
          }
        }
      } else if (e.kind === 'ramp') {
        if (dz < 4.0 && dx < e.radius + 0.6 && this.altitude < 2.2) {
          e.collected = true;
          this.verticalVel = 24.5;
          this.isGrounded = false;
          this.boost = Math.min(100, this.boost + 18);
          this.score += 180 * this.combo;
          this.sound.playJump();
          this.spawnBurst(craftWorldX, craftY, this.playerZ, 22, 0x38bdf8, 13);
          this.emitCallout('슈퍼 점프!', '+180', 'cyan');
        }
      } else if (e.kind === 'spire' || e.kind === 'pylon') {
        const hitZ = 2.4;
        const hitX = e.radius + 0.95;
        const clearedAbove = this.altitude > e.height - 0.6;

        if (dz < hitZ && dx < hitX && !clearedAbove) {
          if (this.invulnTimer <= 0) {
            e.collected = true;
            this.handleHazardImpact(craftWorldX, craftY);
          }
        } else if (!e.nearMissed && e.z > this.playerZ + 1.5 && e.z < this.playerZ + 6.5) {
          // Near-miss bonus when grazing closely past an obstacle!
          if (!clearedAbove && dx >= hitX && dx < hitX + 2.35) {
            e.nearMissed = true;
            this.nearMisses++;
            const bonus = 150 * this.combo;
            this.score += bonus;
            this.boost = Math.min(100, this.boost + 16);
            this.comboTimer = Math.max(this.comboTimer, 4.2);
            this.cameraShake = Math.max(this.cameraShake, 0.22);
            this.sound.playNearMiss();
            this.spawnBurst(craftWorldX, craftY, this.playerZ, 16, 0xf97316, 11);
            this.emitCallout(`아슬아슬! +${bonus}`, '부스트 충전', 'cyan');
          }
        }
      }
    }
  }

  private handleHazardImpact(wx: number, wy: number): void {
    this.shields -= 1;
    this.combo = 1;
    this.comboTimer = 0;
    this.isBoosting = false;
    this.cameraShake = 0.85;
    this.speed = Math.max(40, this.speed * 0.62);

    this.spawnBurst(wx, wy, this.playerZ, 44, 0xff5a36, 18);

    if (this.shields <= 0) {
      this.sound.playCollision(true);
      this.phase = 'gameover';
      const finalScore = Math.floor(this.score);
      const finalDist = Math.floor(this.distance);
      if (finalScore > this.bestScore) {
        this.bestScore = finalScore;
        this.isNewRecord = true;
      }
      if (finalDist > this.bestDistance) this.bestDistance = finalDist;
      if (this.maxCombo > this.bestCombo) this.bestCombo = this.maxCombo;
      this.callbacks.onRecordSaved(this.bestScore, this.bestDistance, this.bestCombo);
      this.emitCallout('실드 소진', '완주 기록이 저장되었습니다', 'rose');
      this.emitHud();
    } else {
      this.invulnTimer = 1.6;
      this.sound.playCollision(false);
      this.emitCallout(`충돌! 실드 ${this.shields}/${MAX_SHIELDS}`, '주의하세요', 'rose');
      this.emitHud();
    }
  }

  private updateBiomeAtmosphere(dt: number): void {
    const cycleDist = 850;
    const biomeIdx = Math.floor(this.distance / cycleDist) % BIOMES.length;
    const target = BIOMES[biomeIdx];

    const blend = 1 - Math.exp(-1.1 * dt);
    this._tmpColorA.setHex(target.skyColor);
    this.skyColor.lerp(this._tmpColorA, blend);

    this._tmpColorA.setHex(target.fogColor);
    this.skyFog.color.lerp(this._tmpColorA, blend);
    this.skyFog.density = THREE.MathUtils.lerp(this.skyFog.density, target.fogDensity, blend);

    this._tmpColorA.setHex(target.sunColor);
    this.sunLight.color.lerp(this._tmpColorA, blend);
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, target.sunIntensity, blend);

    this._tmpColorA.setHex(target.hemiSky);
    this.hemiLight.color.lerp(this._tmpColorA, blend);
    this._tmpColorB.setHex(target.hemiGround);
    this.hemiLight.groundColor.lerp(this._tmpColorB, blend);

    this._tmpColorA.setHex(target.cliffTint);
    this.world.cliffMat.color.lerp(this._tmpColorA, blend);
    this._tmpColorA.setHex(target.waterTint);
    this.world.waterMat.color.lerp(this._tmpColorA, blend);
  }

  private syncCraftTransform(dt: number): void {
    const cx = trackCenterX(this.playerZ);
    const slope = trackSlopeX(this.playerZ);
    const headingYaw = Math.atan(-slope);

    this.craft.root.position.set(cx + this.offsetX, 0, this.playerZ);
    this.craft.root.rotation.set(0, headingYaw, 0);
    this.craft.bodyGroup.rotation.set(this.pitchAngle, 0, this.rollAngle);

    const speedRatio = THREE.MathUtils.clamp((this.speed - 45) / 95, 0, 1);
    this.craft.updateVisuals(this.elapsedTime, dt, speedRatio, this.isBoosting, this.altitude, this.invulnTimer);
  }

  private snapCameraToCraft(): void {
    const cx = trackCenterX(this.playerZ);
    const px = cx + this.offsetX;
    this.camera.position.set(px, 5.2, this.playerZ + 11.5);
    this._camLookCurrent.set(px, 2.0, this.playerZ - 18);
    this.camera.lookAt(this._camLookCurrent);
  }

  private updateCamera(dt: number): void {
    const cx = trackCenterX(this.playerZ);
    const px = cx + this.offsetX;
    const lookZ = this.playerZ - 28;
    const lookX = trackCenterX(lookZ) + this.offsetX * 0.65;

    let targetFov = 62;
    if (this.phase === 'title') {
      // Sweeping hero angle showing the hovercraft and sunlit canyon vista
      const orbitSway = Math.sin(this.elapsedTime * 0.42) * 3.6;
      this._camDesiredPos.set(px + orbitSway, 4.4 + Math.sin(this.elapsedTime * 0.7) * 0.4, this.playerZ + 9.4);
      this._camDesiredLook.set(px, 1.8, this.playerZ - 16);
      targetFov = 58;
    } else if (this.cameraMode === 'cockpit') {
      this._camDesiredPos.set(px, 1.85 + this.altitude, this.playerZ - 0.55);
      this._camDesiredLook.set(lookX, 1.55 + this.altitude * 0.6, lookZ);
      targetFov = this.isBoosting ? 84 : 72;
    } else if (this.cameraMode === 'wide') {
      this._camDesiredPos.set(px * 0.72 + cx * 0.28, 7.2 + this.altitude * 0.55, this.playerZ + 14.5);
      this._camDesiredLook.set(lookX, 1.8 + this.altitude * 0.4, lookZ);
      targetFov = this.isBoosting ? 76 : 66;
    } else {
      // Dynamic Chase Camera
      this._camDesiredPos.set(px * 0.85 + cx * 0.15, 4.45 + this.altitude * 0.62, this.playerZ + 10.6);
      this._camDesiredLook.set(lookX, 1.9 + this.altitude * 0.45, lookZ);
      targetFov = this.isBoosting ? 77 : 63 + THREE.MathUtils.clamp((this.speed - 60) * 0.1, 0, 7);
    }

    // Smooth exponential damping
    const posLambda = this.cameraMode === 'cockpit' ? 28 : 8.5;
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this._camDesiredPos.x, posLambda, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this._camDesiredPos.y, posLambda, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this._camDesiredPos.z, posLambda + 6, dt);

    // Apply micro-shake on impact or near-miss
    if (this.cameraShake > 0.005) {
      const s = this.cameraShake * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    this._camLookCurrent.x = THREE.MathUtils.damp(this._camLookCurrent.x, this._camDesiredLook.x, 12, dt);
    this._camLookCurrent.y = THREE.MathUtils.damp(this._camLookCurrent.y, this._camDesiredLook.y, 12, dt);
    this._camLookCurrent.z = this._camDesiredLook.z;
    this.camera.lookAt(this._camLookCurrent);

    // Dynamic roll tilt when banking
    if (this.phase === 'playing') {
      const bankFactor = this.cameraMode === 'cockpit' ? 0.55 : 0.22;
      this.camera.rotation.z += this.rollAngle * bankFactor;
    }

    // Smooth FOV transition
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6.5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- Particles & Speed Lines ----

  private spawnBurst(x: number, y: number, z: number, count: number, hexColor: number, speedSpread: number): void {
    this._tmpColorA.setHex(hexColor);
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const theta = Math.random() * Math.PI * 2;
        const phi = (Math.random() - 0.35) * Math.PI;
        const spd = speedSpread * (0.4 + Math.random() * 0.8);
        p.vx = Math.cos(theta) * Math.cos(phi) * spd;
        p.vy = Math.sin(phi) * spd + 2.5;
        p.vz = Math.sin(theta) * Math.cos(phi) * spd;
        p.life = 0;
        p.maxLife = 0.35 + Math.random() * 0.42;
        p.r = this._tmpColorA.r;
        p.g = this._tmpColorA.g;
        p.b = this._tmpColorA.b;
        spawned++;
      }
    }
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.particlePosArr[i * 3 + 1] = -999;
        continue;
      }
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade = 1 - p.life / p.maxLife;
      this.particlePosArr[i * 3] = p.x;
      this.particlePosArr[i * 3 + 1] = p.y;
      this.particlePosArr[i * 3 + 2] = p.z;
      this.particleColArr[i * 3] = p.r * fade;
      this.particleColArr[i * 3 + 1] = p.g * fade;
      this.particleColArr[i * 3 + 2] = p.b * fade;
    }
    if (dirty) {
      (this.particleGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateSpeedDust(_dt: number): void {
    const arr = this.dustPosArr;
    for (let i = 0; i < SPEED_DUST_COUNT; i++) {
      const idx = i * 3;
      if (arr[idx + 2] > this.playerZ + 18) {
        const nz = this.playerZ - 95 - Math.random() * 75;
        arr[idx] = trackCenterX(nz) + (Math.random() - 0.5) * 34;
        arr[idx + 1] = 0.6 + Math.random() * 11;
        arr[idx + 2] = nz;
      }
    }
    (this.dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private emitCallout(label: string, sublabel: string | undefined, tone: CalloutEvent['tone']): void {
    this.callbacks.onCallout({
      id: this.calloutId++,
      label,
      sublabel,
      tone,
    });
  }

  private emitHud(): void {
    const biomeIndex = Math.floor(this.distance / 850) % BIOMES.length;
    this.callbacks.onHudUpdate({
      phase: this.phase,
      score: Math.floor(this.score),
      bestScore: Math.max(this.bestScore, Math.floor(this.score)),
      distance: Math.floor(this.distance),
      speedKmh: Math.round(this.speed * 4.4),
      combo: this.combo,
      maxCombo: this.maxCombo,
      shields: this.shields,
      maxShields: MAX_SHIELDS,
      boost: Math.round(this.boost),
      isBoosting: this.isBoosting,
      ringsCleared: this.ringsCleared,
      nearMisses: this.nearMisses,
      biomeName: BIOMES[biomeIndex].name,
      biomeIndex,
      isNewRecord: this.isNewRecord,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);
    this.resizeObserver.disconnect();

    this.sound.dispose();
    this.craft.dispose();
    this.world.dispose();
    this.textures.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.dustGeo.dispose();
    this.dustMat.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
