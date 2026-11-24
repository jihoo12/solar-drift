export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'chase' | 'cockpit' | 'wide';

export type LiveryId = 'crimson' | 'titanium' | 'cobalt' | 'gold';

export interface LiveryConfig {
  id: LiveryId;
  name: string;
  primaryHex: number;
  secondaryHex: number;
  accentHex: number;
  emissiveHex: number;
  swatch: string;
}

export const LIVERIES: readonly LiveryConfig[] = [
  {
    id: 'crimson',
    name: '레이싱 크림슨',
    primaryHex: 0xd93829,
    secondaryHex: 0x1e2430,
    accentHex: 0xf59e0b,
    emissiveHex: 0x38bdf8,
    swatch: '#D93829',
  },
  {
    id: 'titanium',
    name: '티타늄 화이트',
    primaryHex: 0xe6eaf0,
    secondaryHex: 0x222938,
    accentHex: 0xea580c,
    emissiveHex: 0x06b6d4,
    swatch: '#E6EAF0',
  },
  {
    id: 'cobalt',
    name: '코발트 블루',
    primaryHex: 0x1d4ed8,
    secondaryHex: 0x171e2c,
    accentHex: 0x38bdf8,
    emissiveHex: 0xfbbf24,
    swatch: '#1D4ED8',
  },
  {
    id: 'gold',
    name: '선버스트 골드',
    primaryHex: 0xd97706,
    secondaryHex: 0x1c1917,
    accentHex: 0xfef3c7,
    emissiveHex: 0x22d3ee,
    swatch: '#D97706',
  },
] as const;

export interface BiomeConfig {
  id: string;
  name: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  floorTint: number;
  cliffTint: number;
  waterTint: number;
}

export const BIOMES: readonly BiomeConfig[] = [
  {
    id: 'golden-canyon',
    name: '골든 캐니언',
    skyColor: 0xe8c7a1,
    fogColor: 0xe2bd96,
    fogDensity: 0.0044,
    sunColor: 0xfff0d4,
    sunIntensity: 2.35,
    hemiSky: 0x8ec5e8,
    hemiGround: 0x9c5a3c,
    floorTint: 0xc98b5b,
    cliffTint: 0xb6623d,
    waterTint: 0x2a8899,
  },
  {
    id: 'cobalt-gorge',
    name: '코발트 협곡',
    skyColor: 0x9ab8d4,
    fogColor: 0x90b0cf,
    fogDensity: 0.0046,
    sunColor: 0xfff4e0,
    sunIntensity: 2.15,
    hemiSky: 0x7cb3e0,
    hemiGround: 0x4b5c74,
    floorTint: 0x6f8299,
    cliffTint: 0x4c627a,
    waterTint: 0x1d688a,
  },
  {
    id: 'sunset-spire',
    name: '선셋 스파이어',
    skyColor: 0xd98762,
    fogColor: 0xd27f5c,
    fogDensity: 0.0048,
    sunColor: 0xffc68a,
    sunIntensity: 2.45,
    hemiSky: 0xf2a77c,
    hemiGround: 0x5c2d34,
    floorTint: 0xa65c49,
    cliffTint: 0x8a3d33,
    waterTint: 0x3b4d78,
  },
] as const;

export interface CalloutEvent {
  id: number;
  label: string;
  sublabel?: string;
  tone: 'amber' | 'cyan' | 'emerald' | 'rose';
}

export interface HudSnapshot {
  phase: GamePhase;
  score: number;
  bestScore: number;
  distance: number;
  speedKmh: number;
  combo: number;
  maxCombo: number;
  shields: number;
  maxShields: number;
  boost: number; // 0..100
  isBoosting: boolean;
  ringsCleared: number;
  nearMisses: number;
  biomeName: string;
  biomeIndex: number;
  isNewRecord: boolean;
}

export interface SavedStats {
  bestScore: number;
  bestDistance: number;
  bestCombo: number;
  livery: LiveryId;
  cameraMode: CameraMode;
  muted: boolean;
}

const STORAGE_KEY = 'solar_drift_3d_stats_v1';

export function loadSavedStats(): SavedStats {
  const fallback: SavedStats = {
    bestScore: 0,
    bestDistance: 0,
    bestCombo: 0,
    livery: 'crimson',
    cameraMode: 'chase',
    muted: false,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedStats>;
    return {
      bestScore: typeof parsed.bestScore === 'number' && Number.isFinite(parsed.bestScore) ? parsed.bestScore : 0,
      bestDistance:
        typeof parsed.bestDistance === 'number' && Number.isFinite(parsed.bestDistance) ? parsed.bestDistance : 0,
      bestCombo: typeof parsed.bestCombo === 'number' && Number.isFinite(parsed.bestCombo) ? parsed.bestCombo : 0,
      livery: LIVERIES.some((l) => l.id === parsed.livery) ? (parsed.livery as LiveryId) : 'crimson',
      cameraMode:
        parsed.cameraMode === 'chase' || parsed.cameraMode === 'cockpit' || parsed.cameraMode === 'wide'
          ? parsed.cameraMode
          : 'chase',
      muted: Boolean(parsed.muted),
    };
  } catch {
    return fallback;
  }
}

export function saveStats(stats: SavedStats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}
