import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useCurrentNode, useManifest, useNavigateTo } from '@stores/tourStore';
import type { TourNode } from '../../types/tour';

const EARTH_RADIUS_KM = 6371;

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const fromLat = degreesToRadians(from.lat);
  const toLat = degreesToRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function groupNodes(nodes: TourNode[]): { merged: TourNode[]; standalone: TourNode[] } {
  const merged = nodes.filter((node) => node.type === 'merged');
  const standalone = nodes.filter((node) => node.type !== 'merged');
  return { merged, standalone };
}

export function TourNodeList() {
  const manifest = useManifest();
  const currentNode = useCurrentNode();
  const navigateTo = useNavigateTo();

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  const filtered = useMemo(() => {
    const nodes = manifest?.nodes ?? [];
    const normalized = search.trim().toLowerCase();
    const result = normalized
      ? nodes.filter((node) => node.name.toLowerCase().includes(normalized))
      : nodes;

    return groupNodes(result);
  }, [manifest, search]);

  const allNodes = useMemo(() => [...filtered.merged, ...filtered.standalone], [filtered]);

  useEffect(() => {
    const handleClosePanels = () => {
      setIsOpen(false);
    };

    const handleToggleNodeList = () => {
      setIsOpen((prev) => !prev);
    };

    window.addEventListener('tour:close-panels', handleClosePanels);
    window.addEventListener('tour:close-node-list', handleClosePanels);
    window.addEventListener('tour:toggle-node-list', handleToggleNodeList);
    return () => {
      window.removeEventListener('tour:close-panels', handleClosePanels);
      window.removeEventListener('tour:close-node-list', handleClosePanels);
      window.removeEventListener('tour:toggle-node-list', handleToggleNodeList);
    };
  }, []);

  if (!manifest) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Toggle all locations drawer"
        onClick={() => setIsOpen((prev) => !prev)}
        className="pointer-events-auto fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-xl border border-white/15 bg-black/70 px-3 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 backdrop-blur-xl"
      >
        <span className="[writing-mode:vertical-rl]">All Locations</span>
      </button>

      {isOpen ? (
        <button
          type="button"
          aria-label="Close locations drawer"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px]"
        />
      ) : null}

      <aside
        className={clsx(
          'pointer-events-auto fixed left-0 top-0 z-50 h-full w-[min(85vw,300px)] border-r border-white/10 bg-black/65 p-4 text-slate-100 backdrop-blur-2xl transition-transform duration-300',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Tour locations drawer"
      >
        <div className="flex h-full flex-col">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
              {manifest.nodes.length} Locations
            </h2>
            <button
              type="button"
              aria-label="Close locations drawer"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200"
            >
              Close
            </button>
          </div>

          <label className="mb-4 block">
            <span className="sr-only">Search locations</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search locations by name"
              placeholder="Search locations..."
              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-emerald-300/50 focus:outline-none"
            />
          </label>

          <div className="flex-1 overflow-y-auto pr-1">
            {allNodes.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-4 text-sm text-slate-300">
                No locations match your search
              </div>
            ) : (
              <>
                {filtered.merged.length > 0 ? (
                  <section className="mb-4">
                    <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Merged nodes</h3>
                    <ul className="space-y-2">
                      {filtered.merged.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => {
                              navigateTo(node.id);
                              setIsOpen(false);
                            }}
                            aria-label={`Navigate to ${node.name}`}
                            className={clsx(
                              'w-full rounded-xl border border-white/10 bg-white/5 p-2 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400/60',
                              currentNode?.id === node.id && 'border-sky-400/50 border-l-4',
                            )}
                          >
                            <NodeItem node={node} currentNode={currentNode} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {filtered.standalone.length > 0 ? (
                  <section>
                    <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Standalone nodes</h3>
                    <ul className="space-y-2">
                      {filtered.standalone.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => {
                              navigateTo(node.id);
                              setIsOpen(false);
                            }}
                            aria-label={`Navigate to ${node.name}`}
                            className={clsx(
                              'w-full rounded-xl border border-white/10 bg-white/5 p-2 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400/60',
                              currentNode?.id === node.id && 'border-sky-400/50 border-l-4',
                            )}
                          >
                            <NodeItem node={node} currentNode={currentNode} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

interface NodeItemProps {
  node: TourNode;
  currentNode: TourNode | null;
}

function NodeItem({ node, currentNode }: NodeItemProps) {
  const distanceKm = currentNode
    ? haversineKm(
        { lat: currentNode.gps.lat, lng: currentNode.gps.lng },
        { lat: node.gps.lat, lng: node.gps.lng },
      )
    : 0;

  return (
    <div className="flex items-center gap-3">
      <img
        src={node.thumbnail}
        alt={node.name}
        loading="lazy"
        width={48}
        height={48}
        className="h-12 w-12 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{node.name}</div>
        <div className="mt-0.5 text-xs text-slate-300">{distanceKm.toFixed(2)} km</div>
      </div>
      <span
        className={clsx(
          'inline-block h-2.5 w-2.5 rounded-full',
          node.type === 'merged' ? 'bg-emerald-400' : 'bg-slate-400',
        )}
        aria-label={node.type}
      />
    </div>
  );
}
