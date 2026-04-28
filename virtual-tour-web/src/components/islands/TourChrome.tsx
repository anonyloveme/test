import clsx from 'clsx';
import { useEffect, useMemo } from 'react';
import { useIsInfoVisible, useIsMapVisible, useManifest, useCurrentNode, useTourStore } from '@stores/tourStore';

interface TourChromeProps {
  tourName: string;
}

export function TourChrome({ tourName }: TourChromeProps) {
  const currentNode = useCurrentNode();
  const manifest = useManifest();
  const isMapVisible = useIsMapVisible();
  const isInfoVisible = useIsInfoVisible();
  const toggleMap = useTourStore((state) => state.toggleMap);
  const toggleInfo = useTourStore((state) => state.toggleInfo);
  const setMapVisible = useTourStore((state) => state.setMapVisible);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');

    const syncMapVisibility = () => {
      setMapVisible(mediaQuery.matches);
    };

    syncMapVisibility();
    mediaQuery.addEventListener('change', syncMapVisibility);

    return () => {
      mediaQuery.removeEventListener('change', syncMapVisibility);
    };
  }, [setMapVisible]);

  const totalNodes = manifest?.nodes.length ?? 0;
  const counter = useMemo(() => {
    if (!manifest || !currentNode) {
      return `0 / ${totalNodes}`;
    }

    const index = manifest.nodes.findIndex((node) => node.id === currentNode.id);
    return `${index >= 0 ? index + 1 : 0} / ${totalNodes}`;
  }, [currentNode, manifest, totalNodes]);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-black/80 via-black/35 to-transparent px-4 pt-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto mx-auto flex max-w-7xl items-start justify-between gap-4 rounded-3xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-2xl sm:px-5">
          <div className="hidden min-w-0 sm:block">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-emerald-300/85">Virtual Tour</p>
            <div className="mt-1 truncate text-lg font-semibold text-white sm:text-xl">{tourName}</div>
            <div className="mt-1 hidden truncate text-sm text-slate-300 md:block">{currentNode?.name ?? 'Loading panorama...'}</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMap}
              className={clsx(
                'btn-glass px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white sm:px-4 sm:text-sm sm:normal-case sm:tracking-normal',
                isMapVisible && 'ring-1 ring-emerald-300/60'
              )}
            >
              Map
            </button>
            <button
              type="button"
              onClick={toggleInfo}
              className={clsx(
                'btn-glass px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white sm:px-4 sm:text-sm sm:normal-case sm:tracking-normal',
                isInfoVisible && 'ring-1 ring-sky-300/60'
              )}
            >
              Info
            </button>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-4 left-4 z-40 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-xl">
        {counter}
      </div>
    </>
  );
}
