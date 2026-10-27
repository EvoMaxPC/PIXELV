/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prólogo Cinematográfico 3D de PIXELVERSE:
 * «CUANDO EL MUNDO OLVIDÓ JUGAR» (02:30 / 150s · 8 Escenas Consecutivas).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { bgmEngine } from '../audio/bgmEngine';
import { retroAudio } from '../audio/retroAudio';
import { cinematicAudio } from './cinematicAudio';
import {
  CINEMATIC_SCENE_CHAPTERS,
  cinematicNarrator,
  getActiveSubtitleAtTime,
  getChapterAtTime,
  TOTAL_CINEMATIC_DURATION_SEC,
} from './cinematicNarrator';
import {
  CinematicWorldController,
  createCinematicWorld64Bit,
} from './cinematicWorld64Bit';

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, Math.min(TOTAL_CINEMATIC_DURATION_SEC, Math.floor(sec)));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function EpicCinematicStage({
  runKey,
  onComplete,
}: {
  runKey: number;
  onComplete: () => void;
  onEnterPong?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<CinematicWorldController | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => bgmEngine.isMuted());

  // Estado liviano sincronizado ~10 veces por segundo para subtítulos, capítulo y barra de tiempo
  const [uiTimeSec, setUiTimeSec] = useState<number>(0);

  const playbackRef = useRef<{
    elapsedSec: number;
    paused: boolean;
    finished: boolean;
    lastUiSyncSec: number;
  }>({
    elapsedSec: 0,
    paused: false,
    finished: false,
    lastUiSyncSec: -1,
  });

  useEffect(() => {
    const unsub = bgmEngine.subscribe((muted) => {
      setIsMuted(muted);
      if (muted) {
        cinematicAudio.stopAll();
        cinematicNarrator.stopCurrent();
      }
    });
    return unsub;
  }, []);

  const finishCinematic = useCallback(() => {
    if (playbackRef.current.finished) return;
    playbackRef.current.finished = true;
    cinematicNarrator.stopCurrent();
    cinematicAudio.stopAll();
    bgmEngine.setDuckFactor(1.0);
    onCompleteRef.current();
  }, []);

  const handleSeekTo = useCallback((targetSec: number) => {
    const clamped = Math.max(0, Math.min(TOTAL_CINEMATIC_DURATION_SEC - 0.2, targetSec));
    playbackRef.current.elapsedSec = clamped;
    playbackRef.current.lastUiSyncSec = clamped;
    cinematicAudio.resetTimeline(clamped);
    cinematicNarrator.resetTimeline(clamped);
    setUiTimeSec(clamped);
    if (worldRef.current) {
      worldRef.current.renderAtTime(clamped, 0.016);
    }
  }, []);

  const handleNextChapter = useCallback(() => {
    const cur = playbackRef.current.elapsedSec;
    const nextChap = CINEMATIC_SCENE_CHAPTERS.find((c) => c.startSec > cur + 0.4);
    if (nextChap) {
      handleSeekTo(nextChap.startSec);
    } else {
      finishCinematic();
    }
  }, [finishCinematic, handleSeekTo]);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      playbackRef.current.paused = next;
      if (next) {
        cinematicAudio.stopAll();
        cinematicNarrator.stopCurrent();
      } else {
        cinematicAudio.resetTimeline(playbackRef.current.elapsedSec);
        cinematicNarrator.resetTimeline(playbackRef.current.elapsedSec);
      }
      return next;
    });
  }, []);

  // Inicio directo cuando cambia runKey (inicio automático o repetición desde el Selector Maestro)
  useEffect(() => {
    cinematicNarrator.preloadAll();
    bgmEngine.setDuckFactor(0);

    playbackRef.current = {
      elapsedSec: 0,
      paused: false,
      finished: false,
      lastUiSyncSec: -1,
    };
    setIsPaused(false);
    setUiTimeSec(0);

    cinematicAudio.resetTimeline(0);
    cinematicNarrator.resetTimeline(0);

    const tryUnlockAudio = () => {
      retroAudio.unlock();
      cinematicAudio.unlock();
      void cinematicNarrator.unlockAudioContext();
    };
    tryUnlockAudio();

    window.addEventListener('pointerdown', tryUnlockAudio, { passive: true });
    window.addEventListener('touchstart', tryUnlockAudio, { passive: true });
    window.addEventListener('keydown', tryUnlockAudio);

    return () => {
      window.removeEventListener('pointerdown', tryUnlockAudio);
      window.removeEventListener('touchstart', tryUnlockAudio);
      window.removeEventListener('keydown', tryUnlockAudio);
      cinematicNarrator.stopCurrent();
      cinematicAudio.stopAll();
      bgmEngine.setDuckFactor(1.0);
    };
  }, [runKey]);

  // Inicialización única del lienzo Pixel-Art 64-Bit (estilo SEGA VDP2 / HD-2D RGB)
  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const world = createCinematicWorld64Bit(mountEl);
    worldRef.current = world;

    let frameId = 0;
    let disposed = false;
    let lastNow = performance.now();

    const onResize = () => {
      if (!mountEl || disposed) return;
      world.resize(
        mountEl.clientWidth || window.innerWidth,
        mountEl.clientHeight || window.innerHeight
      );
    };
    window.addEventListener('resize', onResize);

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const rawDt = Math.max(0.001, Math.min(0.25, (now - lastNow) / 1000));
      lastNow = now;

      const pb = playbackRef.current;
      if (!pb.paused && !pb.finished) {
        pb.elapsedSec += rawDt;

        cinematicAudio.syncTimeline(pb.elapsedSec, false);
        cinematicNarrator.syncTimeline(pb.elapsedSec, false);

        if (Math.abs(pb.elapsedSec - pb.lastUiSyncSec) >= 0.1) {
          pb.lastUiSyncSec = pb.elapsedSec;
          setUiTimeSec(pb.elapsedSec);
        }

        if (pb.elapsedSec >= TOTAL_CINEMATIC_DURATION_SEC) {
          world.renderAtTime(TOTAL_CINEMATIC_DURATION_SEC, rawDt);
          finishCinematic();
          return;
        }
      }

      world.renderAtTime(pb.elapsedSec, rawDt);
      frameId = requestAnimationFrame(tick);
    }

    lastNow = performance.now();
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      worldRef.current = null;
      world.dispose();
    };
  }, [finishCinematic]);

  // Atajos de teclado cinematográficos (Esc = Omitir, Espacio = Pausa, H = Modo Cine)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishCinematic();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleTogglePause();
      } else if (e.key === 'ArrowRight') {
        handleNextChapter();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finishCinematic, handleNextChapter, handleTogglePause]);

  const activeChapter = getChapterAtTime(uiTimeSec);
  const activeSubtitle = getActiveSubtitleAtTime(uiTimeSec);

  // Efectos ópticos puntuales de transición entre planos clave:
  // - 131.85s–132.45s: Fragmento digital que corta la imagen hacia El Sendero Glitch
  // - 143.85s–144.45s: Destello del fragmento final de luz hacia la oscuridad del título
  const isGlitchTransition = uiTimeSec >= 131.85 && uiTimeSec <= 132.45;
  const isFinalLightFlash = uiTimeSec >= 143.85 && uiTimeSec <= 144.5;
  const isScene8TitleVisible = uiTimeSec >= 144.35 && uiTimeSec <= 149.65;
  const isFinalBlackFade = uiTimeSec >= 149.2;

  const progressPct = Math.min(100, (uiTimeSec / TOTAL_CINEMATIC_DURATION_SEC) * 100);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#010206] select-none">
      {/* Contenedor dedicado y aislado para el lienzo WebGL Three.js */}
      <div
        ref={mountRef}
        id="pixelverse-cinematic-webgl"
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* Franjas panorámicas cinematográficas sutiles (Widescreen Scope) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[7vh] min-h-[28px] bg-gradient-to-b from-black via-black/90 to-transparent z-10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[11vh] min-h-[52px] bg-gradient-to-t from-black via-black/92 to-transparent z-10"
      />

      {/* Corte de fragmento digital hacia El Sendero Glitch (02:12) */}
      {isGlitchTransition && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 bg-cyan-300/25 mix-blend-screen"
        />
      )}

      {/* Destello del fragmento de luz hacia la escena final (02:24) */}
      {isFinalLightFlash && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 bg-amber-100/75 transition-opacity duration-300"
        />
      )}

      {/* ESCENA 8 (02:24–02:30): Revelación Monumental del Logotipo y Subtítulo Final */}
      {isScene8TitleVisible && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
          <h1
            className="font-display font-bold text-slate-50 tracking-[0.28em] uppercase drop-shadow-[0_6px_28px_rgba(56,189,248,0.45)] text-4xl sm:text-6xl md:text-7xl"
          >
            PIXELVERSE
          </h1>
          <div className="w-24 h-px bg-amber-200/50 my-5" aria-hidden="true" />
          <p
            className="font-sans font-semibold text-amber-100/95 tracking-[0.18em] uppercase max-w-2xl leading-relaxed drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] text-xs sm:text-sm md:text-base"
          >
            La memoria de los videojuegos está en tus manos.
          </p>
        </div>
      )}

      {/* Fundido final suave hacia la pantalla de título del juego */}
      {isFinalBlackFade && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 bg-black transition-opacity duration-500"
        />
      )}

      {/* Subtítulos con recuadro estilo SNES 16-bit */}
      {activeSubtitle && !isScene8TitleVisible && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-6">
          <div className="max-w-3xl w-full bg-gradient-to-b from-[#101b3b] via-[#080d22] to-[#040614] border-2 border-[#00f3ff]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_0_16px_rgba(0,243,255,0.2),0_12px_36px_rgba(0,0,0,0.95)] p-4 sm:p-5 relative rounded-none">
            <div className="absolute -top-1 -left-1 w-2 h-2 bg-[#00f3ff]" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-[#00f3ff]" />
            <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-[#00f3ff]" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#00f3ff]" />

            <div className="flex items-center justify-between mb-1.5 text-[11px] font-mono text-amber-300 uppercase tracking-widest border-b border-cyan-900/50 pb-1">
              <span>{activeChapter.numberLabel}. {activeChapter.title}</span>
            </div>
            <p
              id="cinematic-subtitle"
              className="text-center font-sans font-semibold text-slate-100 text-sm sm:text-base md:text-lg leading-relaxed tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]"
            >
              «{activeSubtitle.subtitle}»
            </p>
          </div>
        </div>
      )}

      {/* Botones flotantes a la derecha de la pantalla (Silenciar y Omitir) */}
      <div className="absolute top-6 right-6 z-40 flex items-center gap-3 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            bgmEngine.toggleMute();
          }}
          aria-label={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
          title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
          className="inline-flex items-center justify-center p-3 text-slate-200 hover:text-white bg-[#0b1329]/95 hover:bg-[#132247] border-2 border-cyan-500/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_16px_rgba(0,243,255,0.3)] cursor-pointer transition-all active:translate-y-0.5 rounded-none"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 text-red-400" />
          ) : (
            <Volume2 className="w-5 h-5 text-cyan-300" />
          )}
        </button>

        <button
          type="button"
          onClick={finishCinematic}
          className="inline-flex items-center gap-2 px-4.5 py-2.5 text-xs sm:text-sm font-display font-bold text-slate-950 bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 border-2 border-amber-100 shadow-[inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-3px_0_rgba(180,83,9,0.9),0_6px_20px_rgba(245,158,11,0.6)] active:translate-y-0.5 active:shadow-[inset_0_2px_0_rgba(0,0,0,0.3),0_2px_4px_rgba(245,158,11,0.3)] cursor-pointer transition-all uppercase tracking-wider rounded-none"
        >
          <SkipForward className="w-4 h-4" />
          <span>Omitir</span>
        </button>
      </div>
    </div>
  );
}
