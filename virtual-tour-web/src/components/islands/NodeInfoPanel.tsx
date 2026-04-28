import clsx from 'clsx';
import { useMemo } from 'react';
import { useCurrentNode, useIsInfoVisible, useNavigateTo, useTourStore } from '@stores/tourStore';
import type { Hotspot } from '../../types/tour';

function getCompassLabel(heading: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((heading % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % directions.length;
  return directions[index];
}

function confidenceTone(confidence: string): string {
  if (confidence === 'HIGH') {
    return 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200';
  }
  if (confidence === 'MEDIUM') {
    return 'border-amber-300/40 bg-amber-400/10 text-amber-200';
  }
  return 'border-slate-300/20 bg-slate-300/10 text-slate-200';
}

function hotspotTitle(hotspot: Hotspot): string {
  return `${hotspot.target_name} · ${hotspot.distance_m.toFixed(0)} m`;
}

export function NodeInfoPanel() {
  const currentNode = useCurrentNode();
  const isVisible = useIsInfoVisible();
  const navigateTo = useNavigateTo();
  const toggleInfo = useTourStore((state) => state.toggleInfo);
  const hotspots = useMemo(() => {
    if (!currentNode) {
      return [];
    }
    return [...currentNode.hotspots].sort((left, right) => left.distance_m - right.distance_m).slice(0, 5);
  }, [currentNode]);

  if (!isVisible) {
    return null;
  }

  if (!currentNode) {
    return (
      <aside className="pointer-events-auto h-full w-[min(90vw,24rem)] border-l border-white/10 bg-black/65 p-4 text-slate-100 backdrop-blur-2xl sm:p-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Node details</div>
          <div className="mt-3 text-lg font-semibold">Loading node...</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel-slide-in pointer-events-auto h-full w-[min(90vw,24rem)] border-l border-white/10 bg-black/65 p-4 text-slate-100 backdrop-blur-2xl sm:p-6">
      <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Node details</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">{currentNode.name}</h2>
          </div>
          <button
            type="button"
            onClick={toggleInfo}
            className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-black/50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className={clsx('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]', currentNode.type === 'merged' ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200' : 'border-slate-300/20 bg-slate-300/10 text-slate-200')}>
            {currentNode.type === 'merged' ? 'HD Merged' : 'Original'}
          </span>
          <span className={clsx('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]', confidenceTone(currentNode.confidence))}>
            {currentNode.confidence}
          </span>
        </div>

        <div className="mt-5 space-y-3 text-sm text-slate-300">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">GPS</div>
            <div className="mt-1 font-medium text-slate-100">
              {currentNode.gps.lat.toFixed(6)}, {currentNode.gps.lng.toFixed(6)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Altitude</div>
            <div className="mt-1 font-medium text-slate-100">{currentNode.gps.alt.toFixed(1)} m ASL</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Heading</div>
            <div className="mt-1 font-medium text-slate-100">
              {currentNode.heading.toFixed(1)}° · {getCompassLabel(currentNode.heading)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Connections</div>
            <div className="mt-1 font-medium text-slate-100">{currentNode.hotspots.length} connected locations</div>
          </div>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto pr-1">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Nearest hotspots</div>
          <div className="mt-3 space-y-3">
            {hotspots.length > 0 ? (
              hotspots.map((hotspot) => (
                <button
                  key={`${hotspot.target_id}-${hotspot.yaw}`}
                  type="button"
                  onClick={() => navigateTo(hotspot.target_id)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left transition hover:border-emerald-300/30 hover:bg-black/35"
                  title={hotspotTitle(hotspot)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{hotspot.target_name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{hotspot.label}</div>
                  </div>
                  <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-emerald-200">
                    {hotspot.distance_m.toFixed(0)} m
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                No connected hotspots within range.
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
