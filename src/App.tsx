import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SolarDriftEngine } from './game/engine';
import {
  LIVERIES,
  loadSavedStats,
  saveStats,
  type CalloutEvent,
  type CameraMode,
  type HudSnapshot,
  type LiveryId,
} from './game/types';

const CAMERA_OPTIONS: ReadonlyArray<{ id: CameraMode; label: string }> = [
  { id: 'chase', label: '체이스' },
  { id: 'cockpit', label: '콕핏' },
  { id: 'wide', label: '와이드' },
];

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  score: 0,
  bestScore: 0,
  distance: 0,
  speedKmh: 202,
  combo: 1,
  maxCombo: 1,
  shields: 3,
  maxShields: 3,
  boost: 50,
  isBoosting: false,
  ringsCleared: 0,
  nearMisses: 0,
  biomeName: '골든 캐니언',
  biomeIndex: 0,
  isNewRecord: false,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SolarDriftEngine | null>(null);

  const [saved] = useState(() => loadSavedStats());
  const [hud, setHud] = useState<HudSnapshot>(() => ({
    ...INITIAL_HUD,
    bestScore: saved.bestScore,
  }));
  const [livery, setLivery] = useState<LiveryId>(saved.livery);
  const [cameraMode, setCameraMode] = useState<CameraMode>(saved.cameraMode);
  const [muted, setMuted] = useState<boolean>(saved.muted);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [callout, setCallout] = useState<CalloutEvent | null>(null);
  const [contextLost, setContextLost] = useState<boolean>(false);

  const statsRef = useRef(saved);

  const persistPrefs = useCallback((patch: Partial<typeof saved>) => {
    statsRef.current = { ...statsRef.current, ...patch };
    saveStats(statsRef.current);
  }, []);

  // Mount Three.js engine once in isolated container ref
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new SolarDriftEngine({
      container: mount,
      initialLivery: statsRef.current.livery,
      initialCameraMode: statsRef.current.cameraMode,
      initialMuted: statsRef.current.muted,
      initialBestScore: statsRef.current.bestScore,
      callbacks: {
        onHudUpdate: (snapshot) => {
          setHud(snapshot);
        },
        onCallout: (event) => {
          setCallout(event);
        },
        onContextLost: (lost) => {
          setContextLost(lost);
        },
        onRecordSaved: (bestScore, bestDistance, bestCombo) => {
          persistPrefs({ bestScore, bestDistance, bestCombo });
        },
      },
    });

    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [persistPrefs]);

  // Global UI shortcuts (H = collapse/expand bottom dock, C = cycle camera, M = mute, Enter = start/retry)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockCollapsed((prev) => !prev);
      } else if (e.code === 'KeyC') {
        setCameraMode((prev) => {
          const idx = CAMERA_OPTIONS.findIndex((opt) => opt.id === prev);
          const next = CAMERA_OPTIONS[(idx + 1) % CAMERA_OPTIONS.length].id;
          engineRef.current?.setCameraMode(next);
          persistPrefs({ cameraMode: next });
          return next;
        });
      } else if (e.code === 'KeyM') {
        setMuted((prev) => {
          const next = !prev;
          engineRef.current?.setMuted(next);
          persistPrefs({ muted: next });
          return next;
        });
      } else if ((e.code === 'Enter' || e.code === 'Space') && (hud.phase === 'title' || hud.phase === 'gameover')) {
        e.preventDefault();
        engineRef.current?.startGame();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.phase, persistPrefs]);

  const handleStart = () => {
    engineRef.current?.startGame();
  };

  const handlePauseToggle = () => {
    engineRef.current?.togglePause();
  };

  const handleCameraChange = (mode: CameraMode) => {
    setCameraMode(mode);
    engineRef.current?.setCameraMode(mode);
    persistPrefs({ cameraMode: mode });
  };

  const handleLiveryChange = (id: LiveryId) => {
    setLivery(id);
    engineRef.current?.setLivery(id);
    persistPrefs({ livery: id });
  };

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setMuted(next);
    persistPrefs({ muted: next });
  };

  const calloutToneClass =
    callout?.tone === 'amber'
      ? 'text-amber-300 border-amber-400/40'
      : callout?.tone === 'emerald'
        ? 'text-emerald-300 border-emerald-400/40'
        : callout?.tone === 'rose'
          ? 'text-rose-300 border-rose-400/40'
          : 'text-sky-300 border-sky-400/40';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0e1116]">
      {/* Isolated WebGL Viewport Container */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* WebGL Context Lost Fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0e1116]/95 p-6">
          <div className="max-w-sm w-full rounded-xl bg-[#161b24] border border-white/10 p-6 text-center">
            <h2 className="text-lg font-bold text-white">3D 그래픽 컨텍스트가 일시 중단되었습니다</h2>
            <p className="mt-2 text-sm text-slate-300">
              브라우저 그래픽 장치 복구 중입니다. 문제가 지속되면 다시 시작해 주세요.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 px-5 py-2.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-sm hover:bg-amber-400 transition-colors cursor-pointer"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      )}

      {/* Active Gameplay Top HUD (Leaves Center 3D Scene 100% Unobstructed) */}
      {hud.phase !== 'title' && (
        <header className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-5">
          {/* Top-Left: Score, Combo & Biome Metadata */}
          <div className="rounded-xl bg-[#0d1118]/82 border border-white/10 px-4 py-3 min-w-[180px]">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
                {hud.score.toLocaleString()}
              </span>
              {hud.combo > 1 && (
                <span className="font-display text-sm font-bold text-amber-400 tabular-nums">
                  x{hud.combo} 콤보
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-300 tabular-nums">
              <span>{hud.biomeName}</span>
              <span aria-hidden="true" className="text-slate-500">
                ·
              </span>
              <span>{hud.distance.toLocaleString()}m</span>
              {hud.bestScore > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-500">
                    ·
                  </span>
                  <span>최고 {hud.bestScore.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>

          {/* Top-Right: Speedometer, Shield Cells & Boost Bar */}
          <div className="rounded-xl bg-[#0d1118]/82 border border-white/10 px-4 py-3 min-w-[200px] sm:min-w-[232px]">
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`font-display text-2xl sm:text-3xl font-bold tabular-nums ${
                    hud.isBoosting ? 'text-amber-400' : 'text-white'
                  }`}
                >
                  {hud.speedKmh}
                </span>
                <span className="text-xs font-medium text-slate-400">km/h</span>
              </div>
              <span className="text-xs font-medium text-slate-300 tabular-nums">
                실드 {hud.shields}/{hud.maxShields}
              </span>
            </div>

            {/* Shield Cells */}
            <div className="mt-2 grid grid-cols-3 gap-1.5" aria-label={`실드 ${hud.shields} / ${hud.maxShields}`}>
              {Array.from({ length: hud.maxShields }).map((_, idx) => {
                const intact = idx < hud.shields;
                return (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-sm transition-colors duration-150 ${
                      intact
                        ? hud.shields === 1
                          ? 'bg-rose-500'
                          : 'bg-emerald-400'
                        : 'bg-white/12'
                    }`}
                  />
                );
              })}
            </div>

            {/* Boost Energy Gauge */}
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
                <span>{hud.isBoosting ? '터보 부스트 가동' : '부스트 에너지'}</span>
                <span>{hud.boost}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-sm bg-white/12 overflow-hidden">
                <div
                  className={`h-full transition-transform duration-100 origin-left ${
                    hud.isBoosting ? 'bg-amber-400' : 'bg-sky-400'
                  }`}
                  style={{ transform: `scaleX(${hud.boost / 100})` }}
                />
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Dynamic Event Callout (Ring Pass / Near Miss / Super Jump / Impact) */}
      {callout && hud.phase === 'playing' && (
        <div
          key={callout.id}
          className={`pointer-events-none absolute top-24 left-1/2 z-20 animate-callout rounded-lg bg-[#0d1118]/88 border px-4 py-2 text-center ${calloutToneClass}`}
        >
          <div className="font-display text-base sm:text-lg font-bold tracking-wide whitespace-nowrap">
            {callout.label}
          </div>
          {callout.sublabel && (
            <div className="text-xs text-slate-300 whitespace-nowrap">{callout.sublabel}</div>
          )}
        </div>
      )}

      {/* Title Screen Overlay (Live 3D Canyon Autopilot Gliding Behind) */}
      {hud.phase === 'title' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-5 sm:p-8">
          {/* Minimal Top Wordmark */}
          <div className="flex items-center justify-between">
            <div className="pointer-events-auto rounded-lg bg-[#0d1118]/80 border border-white/10 px-4 py-2">
              <span className="font-display text-base font-bold tracking-wider text-white whitespace-nowrap">
                솔라 드리프트 3D
              </span>
            </div>
            {hud.bestScore > 0 && (
              <div className="pointer-events-auto rounded-lg bg-[#0d1118]/80 border border-white/10 px-4 py-2 text-xs text-slate-200 tabular-nums whitespace-nowrap">
                최고 기록 {hud.bestScore.toLocaleString()}점
              </div>
            )}
          </div>

          {/* Bottom-Centered Launch Panel so Center 3D Craft Stays Visible */}
          <div className="pointer-events-auto mx-auto mb-10 w-full max-w-xl rounded-2xl bg-[#0d1118]/88 border border-white/12 p-6 sm:p-7">
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white text-balance">
              협곡을 가르는 3D 호버제트 질주
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-300 leading-relaxed">
              바위 첨탑을 스치듯 피하고 황금 부스트 링과 점프 램프를 공략해 최고 콤보 기록에 도전하세요.
            </p>

            {/* Clean Unboxed Keybindings Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300 border-t border-white/10 pt-4">
              <span>
                <strong className="font-semibold text-white">A / D · ← / →</strong> 좌우 조향
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>
                <strong className="font-semibold text-white">Space / ↑</strong> 호버 점프
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>
                <strong className="font-semibold text-white">Shift</strong> 터보 부스트
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>
                <strong className="font-semibold text-white">C</strong> 시점 전환
              </span>
            </div>

            {/* Livery Quick Picker + Primary Start CTA */}
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-slate-300 whitespace-nowrap">기체 색상</span>
                <div className="flex items-center gap-2">
                  {LIVERIES.map((item) => {
                    const active = livery === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleLiveryChange(item.id)}
                        title={item.name}
                        aria-label={`기체 색상 ${item.name}`}
                        aria-pressed={active}
                        className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                          active ? 'border-white scale-110' : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: item.swatch }}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleStart}
                className="px-7 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-base hover:bg-amber-400 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                게임 시작
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {hud.phase === 'paused' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1118]/72 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#131822]/95 border border-white/12 p-6 text-center">
            <h2 className="font-display text-2xl font-bold text-white">일시정지</h2>
            <p className="mt-2 text-sm text-slate-300 tabular-nums">
              현재 점수 {hud.score.toLocaleString()}점 · 거리 {hud.distance.toLocaleString()}m
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handlePauseToggle}
                className="w-full py-3 px-5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-colors cursor-pointer"
              >
                계속하기
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="w-full py-3 px-5 rounded-xl bg-white/10 text-white font-semibold text-sm hover:bg-white/16 transition-colors cursor-pointer"
              >
                처음부터 다시
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Summary Modal */}
      {hud.phase === 'gameover' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1118]/75 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#131822]/96 border border-white/12 p-6 sm:p-7">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">주행 종료</h2>
              {hud.isNewRecord && (
                <span className="text-xs font-semibold text-emerald-400 whitespace-nowrap">신기록 경신</span>
              )}
            </div>

            <div className="mt-4 pb-4 border-b border-white/10">
              <div className="text-xs text-slate-400">최종 점수</div>
              <div className="mt-0.5 font-display text-4xl font-bold text-amber-400 tabular-nums">
                {hud.score.toLocaleString()}
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm tabular-nums">
              <div>
                <dt className="text-xs text-slate-400">최고 기록</dt>
                <dd className="mt-0.5 font-semibold text-white">{hud.bestScore.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">비행 거리</dt>
                <dd className="mt-0.5 font-semibold text-white">{hud.distance.toLocaleString()}m</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">통과한 부스트 링</dt>
                <dd className="mt-0.5 font-semibold text-white">{hud.ringsCleared}개</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">최대 콤보 · 아슬아슬</dt>
                <dd className="mt-0.5 font-semibold text-white">
                  x{hud.maxCombo} · {hud.nearMisses}회
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={handleStart}
                className="flex-1 py-3 px-5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                다시 도전
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile / Touch On-Screen Controls (Visible on Coarse Pointer / Small Screens During Play) */}
      {hud.phase === 'playing' && (
        <div className="md:hidden pointer-events-none fixed bottom-16 left-0 right-0 z-20 flex items-center justify-between px-4">
          <div className="pointer-events-auto flex items-center gap-2.5">
            <button
              type="button"
              onPointerDown={() => engineRef.current?.setTouchSteer(-1)}
              onPointerUp={() => engineRef.current?.setTouchSteer(0)}
              onPointerLeave={() => engineRef.current?.setTouchSteer(0)}
              onPointerCancel={() => engineRef.current?.setTouchSteer(0)}
              aria-label="왼쪽 조향"
              className="w-14 h-14 rounded-xl bg-[#0d1118]/85 border border-white/15 text-white font-bold text-lg active:bg-amber-500 active:text-slate-950"
            >
              ◀
            </button>
            <button
              type="button"
              onPointerDown={() => engineRef.current?.setTouchSteer(1)}
              onPointerUp={() => engineRef.current?.setTouchSteer(0)}
              onPointerLeave={() => engineRef.current?.setTouchSteer(0)}
              onPointerCancel={() => engineRef.current?.setTouchSteer(0)}
              aria-label="오른쪽 조향"
              className="w-14 h-14 rounded-xl bg-[#0d1118]/85 border border-white/15 text-white font-bold text-lg active:bg-amber-500 active:text-slate-950"
            >
              ▶
            </button>
          </div>

          <div className="pointer-events-auto flex items-center gap-2.5">
            <button
              type="button"
              onPointerDown={() => engineRef.current?.triggerJump()}
              aria-label="점프"
              className="px-4 h-14 rounded-xl bg-[#0d1118]/85 border border-sky-400/40 text-sky-300 font-bold text-sm active:bg-sky-400 active:text-slate-950"
            >
              점프
            </button>
            <button
              type="button"
              onPointerDown={() => engineRef.current?.setTouchBoost(true)}
              onPointerUp={() => engineRef.current?.setTouchBoost(false)}
              onPointerLeave={() => engineRef.current?.setTouchBoost(false)}
              onPointerCancel={() => engineRef.current?.setTouchBoost(false)}
              aria-label="부스트"
              className="px-4 h-14 rounded-xl bg-[#0d1118]/85 border border-amber-400/50 text-amber-300 font-bold text-sm active:bg-amber-500 active:text-slate-950"
            >
              부스트
            </button>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock (Cinema / Zen Toggle) */}
      {hud.phase !== 'title' && (
        <div
          className="fixed bottom-4 left-1/2 z-20 flex flex-col items-center transition-transform duration-200 ease-out"
          style={{
            transform: dockCollapsed
              ? 'translate(-50%, calc(100% - 28px))'
              : 'translate(-50%, 0px)',
            maxWidth: 'min(900px, 94vw)',
          }}
        >
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            aria-expanded={!dockCollapsed}
            className="flex items-center gap-1.5 rounded-t-lg bg-[#0d1118]/88 border border-b-0 border-white/12 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{dockCollapsed ? '컨트롤 보기 (H)' : '컨트롤 숨기기 (H)'}</span>
          </button>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 rounded-xl bg-[#0d1118]/90 border border-white/12 px-4 py-2.5">
            {/* Camera Segmented Selector */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/8">
              {CAMERA_OPTIONS.map((opt) => {
                const active = cameraMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleCameraChange(opt.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:block w-px h-5 bg-white/12" aria-hidden="true" />

            {/* Craft Livery Swatches */}
            <div className="flex items-center gap-1.5">
              {LIVERIES.map((item) => {
                const active = livery === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLiveryChange(item.id)}
                    title={item.name}
                    aria-label={`기체 색상 ${item.name}`}
                    aria-pressed={active}
                    className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                      active ? 'border-white scale-110' : 'border-white/25 hover:scale-105'
                    }`}
                    style={{ backgroundColor: item.swatch }}
                  />
                );
              })}
            </div>

            <div className="hidden sm:block w-px h-5 bg-white/12" aria-hidden="true" />

            {/* Action Buttons: Mute, Pause, Restart */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleMuteToggle}
                aria-label={muted ? '소리 켜기' : '음소거'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{muted ? '음소거됨' : '사운드'}</span>
              </button>

              {(hud.phase === 'playing' || hud.phase === 'paused') && (
                <button
                  type="button"
                  onClick={handlePauseToggle}
                  aria-label={hud.phase === 'paused' ? '계속하기' : '일시정지'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {hud.phase === 'paused' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{hud.phase === 'paused' ? '계속' : '일시정지'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleStart}
                aria-label="다시 시작"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">재시작</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
