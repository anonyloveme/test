import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useCurrentNode, useIsMapVisible, useManifest, useNavigateTo } from '@stores/tourStore';

export function MapboxMiniMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('mapbox-gl').Map | null>(null);
  const markerRefs = useRef<import('mapbox-gl').Marker[]>([]);
  const mapboxRef = useRef<(typeof import('mapbox-gl'))['default'] | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const manifest = useManifest();
  const currentNode = useCurrentNode();
  const isVisible = useIsMapVisible();
  const navigateTo = useNavigateTo();
  const [mapError, setMapError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

  const center = useMemo(() => manifest?.mapbox.center, [manifest]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMapbox(): Promise<void> {
      if (!isVisible || !manifest || !center || mapRef.current || !containerRef.current) {
        return;
      }

      try {
        setMapError(null);
        setIsLoading(true);
        const mapboxModule = await import('mapbox-gl');
        await import('mapbox-gl/dist/mapbox-gl.css');

        if (cancelled || !containerRef.current) {
          return;
        }

        if (!mapToken) {
          setMapError('Missing Mapbox token');
          setIsLoading(false);
          return;
        }

        const mapboxgl = mapboxModule.default;
        mapboxgl.accessToken = mapToken;
        mapboxRef.current = mapboxgl;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: manifest.mapbox.style,
          center: [center.lng, center.lat],
          zoom: manifest.mapbox.zoom,
          pitch: manifest.mapbox.pitch,
          bearing: 0,
          attributionControl: false,
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
        map.once('load', () => {
          if (!map.getSource('mapbox-dem')) {
            map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14,
            });
          }

          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
          if (!cancelled) {
            setIsLoading(false);
          }
        });

        mapRef.current = map;
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Failed to load Mapbox';
        setMapError(message);
        setIsLoading(false);
      }
    }

    void loadMapbox();

    return () => {
      cancelled = true;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      mapboxRef.current = null;
    };
  }, [center, isVisible, manifest, mapToken]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !manifest || !mapboxgl) {
      return;
    }

    const addMarkers = () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];

      manifest.nodes.forEach((node) => {
        const markerElement = document.createElement('button');
        markerElement.type = 'button';
        markerElement.className = clsx(
          'tour-marker',
          node.type === 'merged' ? 'marker-merged' : 'marker-standalone',
          currentNode?.id === node.id && 'marker-active'
        );
        markerElement.innerHTML = `
          <img class="marker-thumb" src="${node.thumbnail}" alt="${node.name}" loading="lazy" />
          <span class="marker-name">${node.name}</span>
          <span class="marker-dot" aria-hidden="true"></span>
        `;
        markerElement.addEventListener('click', () => {
          navigateTo(node.id);
        });

        const marker = new mapboxgl.Marker({ element: markerElement, anchor: 'center' })
          .setLngLat([node.gps.lng, node.gps.lat])
          .addTo(map);

        markerRefs.current.push(marker);
      });
    };

    if (map.loaded()) {
      addMarkers();
    } else {
      map.once('load', addMarkers);
    }
  }, [currentNode?.id, manifest, navigateTo]);

  useEffect(() => {
    const map = mapRef.current;
    const node = currentNode;
    if (!map || !node) {
      return;
    }

    map.flyTo({
      center: [node.gps.lng, node.gps.lat],
      zoom: 16,
      pitch: 60,
      duration: 1500,
      essential: true,
    });
  }, [currentNode]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-auto relative h-64 w-[20rem] overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40 sm:h-72 sm:w-[24rem]">
      <div ref={containerRef} className="h-full w-full" />
      {isLoading || !manifest ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm text-slate-300 backdrop-blur-sm">
          Loading map...
        </div>
      ) : null}
      {mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-4 text-center text-sm text-slate-100 backdrop-blur-sm">
          <div>
            <div className="text-xs uppercase tracking-[0.35em] text-amber-300">Map unavailable</div>
            <div className="mt-2 text-slate-300">{mapError}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
