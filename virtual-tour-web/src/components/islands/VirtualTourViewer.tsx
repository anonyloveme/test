import { useEffect, useRef, useState } from 'react';
import { r2 } from '@services/r2';
import { getTourBySlug, getTourNodes } from '@services/supabase';
import { useCurrentNode, useTourStore } from '@stores/tourStore';
import type { TourManifest, TourNode, TourNodeRow, TourRow } from '../../types/tour';

interface VirtualTourViewerProps {
  tourSlug: string;
}

type ViewStatus = 'loading' | 'ready' | 'error';
type MarzipanoAny = any;

function parseResolution(resolution: string): { width: number; height: number } {
  const [widthText, heightText] = resolution.split('x');
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  return {
    width: Number.isFinite(width) ? width : 14400,
    height: Number.isFinite(height) ? height : 7200,
  };
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function normalizeConfidence(value: string): 'HIGH' | 'MEDIUM' | 'original' {
  const normalized = value.toUpperCase();
  if (normalized === 'HIGH') {
    return 'HIGH';
  }
  if (normalized === 'MEDIUM') {
    return 'MEDIUM';
  }
  return 'original';
}

function normalizeType(value: string): 'merged' | 'standalone' {
  return value === 'merged' ? 'merged' : 'standalone';
}

function nodeFromRow(row: TourNodeRow, fallbackIndex: number): TourNode {
  const metadata = row.metadata ?? {};
  const metadataNode = metadata as Partial<TourNode>;
  const tileInfo = metadataNode.tile_info ?? {
    format: metadataNode.tile_format ?? 'flat_row_col',
    rows: 0,
    cols: 0,
    levels: metadataNode.tile_levels,
  };

  return {
    id: row.node_key,
    scene_folder: metadataNode.scene_folder ?? `scene_${String(fallbackIndex + 1).padStart(2, '0')}`,
    name: row.name,
    filename: metadataNode.filename ?? row.panorama_url?.split('/').pop() ?? `${row.node_key}.JPG`,
    url: row.panorama_url ?? metadataNode.url ?? '',
    thumbnail: row.thumbnail_url ?? metadataNode.thumbnail ?? '',
    tiles_url: row.tiles_base_url ?? metadataNode.tiles_url ?? '',
    tile_url_pattern: metadataNode.tile_url_pattern ?? r2.tilePattern(metadataNode.scene_folder ?? `scene_${String(fallbackIndex + 1).padStart(2, '0')}`, (metadataNode.tile_format ?? 'flat_row_col') as TourNode['tile_format']),
    tile_format: (metadataNode.tile_format ?? tileInfo.format ?? 'flat_row_col') as TourNode['tile_format'],
    tile_info: {
      format: (tileInfo.format ?? metadataNode.tile_format ?? 'flat_row_col') as TourNode['tile_format'],
      rows: Number(tileInfo.rows ?? 0),
      cols: Number(tileInfo.cols ?? 0),
      levels: tileInfo.levels,
    },
    tile_levels: row.tile_levels ?? metadataNode.tile_levels,
    gps: {
      lat: row.gps_lat,
      lng: row.gps_lng,
      alt: row.gps_altitude,
    },
    heading: row.heading,
    type: normalizeType(row.node_type),
    confidence: normalizeConfidence(row.confidence),
    hotspots: metadataNode.hotspots ?? [],
    timestamp: metadataNode.timestamp,
    metadata: metadata as Record<string, unknown>,
  };
}

function buildManifest(tour: TourRow, rows: TourNodeRow[]): TourManifest {
  const nodes = rows.map((row, index) => nodeFromRow(row, index));
  return {
    tour_name: tour.name,
    generated_at: new Date().toISOString(),
    camera: 'DJI M3E',
    projection: 'equirectangular',
    resolution: '14400x7200',
    total_nodes: nodes.length,
    tile_format: nodes[0]?.tile_format ?? 'flat_row_col',
    mapbox: {
      center: {
        lat: Number(tour.center_lat),
        lng: Number(tour.center_lng),
      },
      zoom: Number(tour.zoom_level) || 14,
      pitch: 45,
      style: tour.mapbox_style,
    },
    nodes,
  };
}

function createHotspotElement(hotspot: TourNode['hotspots'][number]): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hotspot-arrow';
  button.innerHTML = `
    <span class="hotspot-inner" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14"></path>
        <path d="m13 5 7 7-7 7"></path>
      </svg>
    </span>
    <span class="flex flex-col items-start gap-0.5 text-left">
      <span class="hotspot-label">${hotspot.label}</span>
      <span class="hotspot-dist">${hotspot.distance_m.toFixed(0)} m</span>
    </span>
  `;
  return button;
}

export function buildMarzipanoSource(
  node: TourNode,
  r2Base: string,
  marzipanoLib: MarzipanoAny
): { source: MarzipanoAny; geometry: MarzipanoAny } {
  const helperPattern = r2.tilePattern(node.scene_folder, node.tile_format);
  const fallbackPattern =
    node.tile_format === 'marzipano_standard'
      ? `${r2Base}/tiles/${node.scene_folder}/{z}/{x}/{y}.jpg`
      : `${r2Base}/tiles/${node.scene_folder}/tile_{y}_{x}.jpg`;
  const tilePattern = node.tile_url_pattern || (helperPattern.includes('CHANGEME') && !r2Base.includes('CHANGEME') ? fallbackPattern : helperPattern);

  const source = marzipanoLib.ImageUrlSource.fromString(tilePattern, {
    previewUrl: node.thumbnail,
  });

  if (node.tile_format === 'flat_row_col') {
    const fullWidth = Math.max(256, (node.tile_info.cols || 1) * 256);
    const geometry = new marzipanoLib.EquirectGeometry([{ width: fullWidth }]);
    return { source, geometry };
  }

  const levelList = node.tile_info.levels ?? node.tile_levels ?? [];
  const geometryLevels = levelList
    .slice()
    .sort((left, right) => left.level - right.level)
    .map((level) => ({ width: Math.max(256, level.width) }));

  const geometry = new marzipanoLib.EquirectGeometry(
    geometryLevels.length > 0 ? geometryLevels : [{ width: Math.max(256, (node.tile_info.cols || 1) * 256) }]
  );
  return { source, geometry };
}

export function VirtualTourViewer({ tourSlug }: VirtualTourViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const marzipanoRef = useRef<MarzipanoAny | null>(null);
  const viewerRef = useRef<MarzipanoAny>(null);
  const sceneRef = useRef<MarzipanoAny>(null);
  const hotspotDisposeRef = useRef<Array<() => void>>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const currentNode = useCurrentNode();
  const setManifest = useTourStore((state) => state.setManifest);
  const setErrorState = useTourStore((state) => state.setError);
  const setLoadingState = useTourStore((state) => state.setLoading);
  const loadingState = useTourStore((state) => state.loadingState);

  useEffect(() => {
    let active = true;

    async function loadTour(): Promise<void> {
      setStatus('loading');
      setError(null);
      setLoadingState('loading');

      try {
        const tour = await getTourBySlug(tourSlug);
        const nodes = await getTourNodes(tour.id);
        const manifest = buildManifest(tour, nodes);
        if (!active) {
          return;
        }
        setManifest(manifest, tour.id);
        setStatus('ready');
        setLoadingState('success');
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Unable to load tour';
        if (!active) {
          return;
        }
        setError(message);
        setErrorState(message);
        setStatus('error');
      }
    }

    void loadTour();

    return () => {
      active = false;
    };
  }, [setErrorState, setLoadingState, setManifest, tourSlug]);

  useEffect(() => {
    let cancelled = false;

    async function initViewer(): Promise<void> {
      try {
        if (!containerRef.current || viewerRef.current || status !== 'ready') {
          return;
        }

        if (!marzipanoRef.current) {
          const marzipanoModule = await import('marzipano');
          marzipanoRef.current = marzipanoModule.default;
        }

        if (cancelled || !containerRef.current) {
          return;
        }

        viewerRef.current = new marzipanoRef.current.Viewer(containerRef.current, {
          controls: {
            mouseViewMode: 'drag',
          },
          stage: {
            progressive: true,
          },
        });
      } catch (viewerError) {
        const message = viewerError instanceof Error ? viewerError.message : 'Failed to initialize viewer';
        setError(message);
        setErrorState(message);
        setStatus('error');
      }
    }

    void initViewer();

    return () => {
      cancelled = true;
    };
  }, [setErrorState, status]);

  useEffect(() => {
    return () => {
      hotspotDisposeRef.current.forEach((dispose) => dispose());
      hotspotDisposeRef.current = [];
      sceneRef.current = null;
      if (viewerRef.current?.destroy) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!viewerRef.current || !marzipanoRef.current || !currentNode || status !== 'ready') {
      return;
    }

    const r2Base = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://pub-CHANGEME.r2.dev';
    const { width: baseWidth } = parseResolution(useTourStore.getState().manifest?.resolution ?? '14400x7200');

    hotspotDisposeRef.current.forEach((dispose) => dispose());
    hotspotDisposeRef.current = [];

    const { source, geometry } = buildMarzipanoSource(currentNode, r2Base, marzipanoRef.current);
    const view = new marzipanoRef.current.RectilinearView({
      yaw: degreesToRadians(currentNode.heading),
      pitch: 0,
      fov: Math.PI / 2,
    });

    const scene = viewerRef.current.createScene({
      source,
      geometry,
      view,
      pinFirstLevel: currentNode.tile_format === 'flat_row_col' ? false : true,
    });
    sceneRef.current = scene;
    scene.switchTo({ transitionDuration: 1000 });

    const hotspotContainer = scene.hotspotContainer?.();
    if (!hotspotContainer) {
      return;
    }

    currentNode.hotspots.forEach((hotspot) => {
      const element = createHotspotElement(hotspot);
      const clickHandler = () => {
        useTourStore.getState().navigateTo(hotspot.target_id);
      };
      element.addEventListener('click', clickHandler);
      const yaw = degreesToRadians(hotspot.yaw);
      const pitch = degreesToRadians(hotspot.pitch);
      const handle = hotspotContainer.createHotspot(element, { yaw, pitch });

      hotspotDisposeRef.current.push(() => {
        element.removeEventListener('click', clickHandler);
        if (handle?.destroy) {
          handle.destroy();
        }
        element.remove();
      });
    });
  }, [currentNode, status]);

  const isBusy = status === 'loading' || loadingState === 'loading';

  if (status === 'error') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/90 text-center">
        <div className="max-w-md rounded-3xl border border-red-400/25 bg-red-950/40 p-6 text-red-100 backdrop-blur-xl">
          <div className="text-sm uppercase tracking-[0.35em] text-red-300">Viewer error</div>
          <div className="mt-3 text-lg font-semibold">Unable to load panorama</div>
          <div className="mt-2 text-sm leading-6 text-red-100/80">{error ?? 'An unexpected error occurred.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div ref={containerRef} className="scene-transition h-full w-full" data-state={isBusy ? 'entering' : 'idle'} />
      {isBusy ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" />
            <div className="text-sm uppercase tracking-[0.35em] text-slate-300">Loading panorama</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}