import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { supabase } from '@services/supabase';
import type { Session, User } from '@supabase/supabase-js';
import type { TourNodeRow, TourRow } from '../../types/tour';

interface ManifestSummary {
  nodes: number;
  hotspots: number;
  bbox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
}

interface ViewsStat {
  nodeId: string;
  nodeName: string;
  views: number;
}

const TOUR_SLUG = 'kon-tum-forest';

function createEmptySummary(): ManifestSummary {
  return {
    nodes: 0,
    hotspots: 0,
    bbox: null,
  };
}

function formatGps(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function getLast7DaysIso(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString();
}

function parseManifestSummary(payload: unknown): ManifestSummary {
  try {
    if (!payload || typeof payload !== 'object') {
      return createEmptySummary();
    }

    const record = payload as Record<string, unknown>;
    const nodes = Array.isArray(record.nodes) ? record.nodes : [];

    let hotspotCount = 0;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;

    nodes.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }

      const node = item as Record<string, unknown>;
      const hotspots = Array.isArray(node.hotspots) ? node.hotspots : [];
      hotspotCount += hotspots.length;

      const gps = (node.gps ?? {}) as Record<string, unknown>;
      const lat = typeof gps.lat === 'number' ? gps.lat : null;
      const lng = typeof gps.lng === 'number' ? gps.lng : null;
      if (lat == null || lng == null) {
        return;
      }

      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    });

    const hasBounds = Number.isFinite(minLat) && Number.isFinite(maxLat) && Number.isFinite(minLng) && Number.isFinite(maxLng);

    return {
      nodes: nodes.length,
      hotspots: hotspotCount,
      bbox: hasBounds
        ? {
            minLat,
            maxLat,
            minLng,
            maxLng,
          }
        : null,
    };
  } catch {
    return createEmptySummary();
  }
}

export function AdminPanel() {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [tour, setTour] = useState<TourRow | null>(null);
  const [nodes, setNodes] = useState<TourNodeRow[]>([]);
  const [hotspotCountByNode, setHotspotCountByNode] = useState<Record<string, number>>({});
  const [isDashboardLoading, setIsDashboardLoading] = useState<boolean>(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const [selectedManifestText, setSelectedManifestText] = useState<string>('');
  const [manifestSummary, setManifestSummary] = useState<ManifestSummary>(createEmptySummary());
  const [importResult, setImportResult] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const [viewsStats, setViewsStats] = useState<ViewsStat[]>([]);

  const totalViews = useMemo(
    () => viewsStats.reduce((sum, item) => sum + item.views, 0),
    [viewsStats],
  );

  const mostVisitedNode = useMemo(() => {
    if (viewsStats.length === 0) {
      return 'N/A';
    }
    return [...viewsStats].sort((a, b) => b.views - a.views)[0]?.nodeName ?? 'N/A';
  }, [viewsStats]);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          throw error;
        }
        if (!isMounted) {
          return;
        }
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load session';
        setAuthError(message);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setIsDashboardLoading(false);
      return;
    }

    void fetchDashboard();
  }, [session?.user]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setIsAuthLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      setAuthError(message);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setDashboardError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign out failed';
      setDashboardError(message);
    }
  }

  async function fetchDashboard(): Promise<void> {
    setIsDashboardLoading(true);
    setDashboardError(null);

    try {
      const { data: tourData, error: tourError } = await supabase
        .from('tours')
        .select('*')
        .eq('slug', TOUR_SLUG)
        .single<TourRow>();

      if (tourError) {
        throw tourError;
      }

      if (!tourData) {
        throw new Error('Tour record not found');
      }

      setTour(tourData);

      const { data: nodeData, error: nodeError } = await supabase
        .from('tour_nodes')
        .select('*')
        .eq('tour_id', tourData.id)
        .order('sort_order', { ascending: true })
        .returns<TourNodeRow[]>();

      if (nodeError) {
        throw nodeError;
      }

      const safeNodes = nodeData ?? [];
      setNodes(safeNodes);

      const nodeIds = safeNodes.map((node) => node.id);
      if (nodeIds.length > 0) {
        const { data: hotspotData, error: hotspotError } = await supabase
          .from('hotspots')
          .select('from_node')
          .in('from_node', nodeIds)
          .eq('is_visible', true);

        if (hotspotError) {
          throw hotspotError;
        }

        const counts = (hotspotData ?? []).reduce<Record<string, number>>((acc, item) => {
          const key = String(item.from_node);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});

        setHotspotCountByNode(counts);
      } else {
        setHotspotCountByNode({});
      }

      const { data: viewsData, error: viewsError } = await supabase
        .from('node_views')
        .select('node_id, created_at')
        .eq('tour_id', tourData.id)
        .gte('created_at', getLast7DaysIso());

      if (viewsError) {
        throw viewsError;
      }

      const viewsByNode = (viewsData ?? []).reduce<Record<string, number>>((acc, row) => {
        const nodeId = String(row.node_id);
        acc[nodeId] = (acc[nodeId] ?? 0) + 1;
        return acc;
      }, {});

      const stats = safeNodes
        .map((node) => ({
          nodeId: node.id,
          nodeName: node.name,
          views: viewsByNode[node.id] ?? 0,
        }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);

      setViewsStats(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard load failed';
      setDashboardError(message);
    } finally {
      setIsDashboardLoading(false);
    }
  }

  async function toggleTourStatus(): Promise<void> {
    if (!tour) {
      return;
    }

    const nextStatus = tour.status === 'published' ? 'draft' : 'published';
    setDashboardError(null);

    try {
      const { error } = await supabase
        .from('tours')
        .update({ status: nextStatus })
        .eq('id', tour.id);

      if (error) {
        throw error;
      }

      setTour((prev) => (prev ? { ...prev, status: nextStatus } : prev));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update tour status';
      setDashboardError(message);
    }
  }

  async function toggleNodeVisibility(nodeId: string, isPublished: boolean): Promise<void> {
    setDashboardError(null);

    try {
      const { error } = await supabase
        .from('tour_nodes')
        .update({ is_published: !isPublished })
        .eq('id', nodeId);

      if (error) {
        throw error;
      }

      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId ? { ...node, is_published: !isPublished } : node,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update node visibility';
      setDashboardError(message);
    }
  }

  function handleManifestFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportResult('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = JSON.parse(text) as unknown;
        setSelectedManifestText(text);
        setManifestSummary(parseManifestSummary(parsed));
      } catch {
        setSelectedManifestText('');
        setManifestSummary(createEmptySummary());
        setImportResult('Failed to parse manifest JSON.');
      }
    };
    reader.readAsText(file);
  }

  async function handleImportManifest(): Promise<void> {
    if (!selectedManifestText) {
      setImportResult('Select a manifest file and sign in first.');
      return;
    }

    setIsImporting(true);
    setImportResult('');

    try {
      const payload = JSON.parse(selectedManifestText) as Record<string, unknown>;

      const { data, error } = await supabase.functions.invoke('import-manifest', {
        body: {
          manifest: payload,
          tour_slug: TOUR_SLUG,
        },
      });

      if (error) {
        throw error;
      }

      const resultText = typeof data === 'object' ? JSON.stringify(data) : String(data ?? 'Manifest import succeeded.');
      setImportResult(resultText);
      await fetchDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      setImportResult(message);
    } finally {
      setIsImporting(false);
    }
  }

  if (!session || !user) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <form
          onSubmit={handleSignIn}
          className="w-full rounded-2xl border border-white/10 bg-black/50 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl"
          aria-label="Admin login form"
        >
          <h1 className="text-xl font-semibold text-white">Admin Login</h1>
          <p className="mt-2 text-sm text-slate-300">Sign in with your Supabase email/password account.</p>

          <label className="mt-4 block text-sm text-slate-200" htmlFor="admin-email">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-slate-100"
          />

          <label className="mt-4 block text-sm text-slate-200" htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-slate-100"
          />

          {authError ? (
            <div className="mt-4 rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {authError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isAuthLoading}
            className="mt-5 w-full rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isAuthLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-xl">
        <div>
          <h1 className="text-xl font-semibold text-white">Admin - Virtual Tour</h1>
          <p className="text-sm text-slate-300">Signed in as {user.email ?? 'unknown user'}</p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100"
        >
          Sign Out
        </button>
      </header>

      {dashboardError ? (
        <div className="mb-5 rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {dashboardError}
        </div>
      ) : null}

      {isDashboardLoading ? (
        <div className="rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-slate-300">Loading dashboard...</div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
        <h2 className="text-sm uppercase tracking-[0.2em] text-emerald-300">Tour Status</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase text-slate-400">Name</div>
            <div className="mt-1 font-semibold text-white">{tour?.name ?? 'N/A'}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase text-slate-400">Status</div>
            <div className="mt-1">
              <span
                className={clsx(
                  'rounded-full border px-2 py-1 text-xs font-semibold uppercase',
                  tour?.status === 'published'
                    ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-300/40 bg-amber-500/10 text-amber-200',
                )}
              >
                {tour?.status ?? 'unknown'}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase text-slate-400">Node count</div>
            <div className="mt-1 font-semibold text-white">{nodes.length}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleTourStatus}
          disabled={!tour}
          className="mt-4 rounded-lg border border-sky-300/40 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-60"
        >
          Toggle {tour?.status === 'published' ? 'Draft' : 'Published'}
        </button>
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
        <h2 className="text-sm uppercase tracking-[0.2em] text-emerald-300">Node List</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm text-slate-200">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.15em] text-slate-400">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">GPS</th>
                <th className="px-2 py-2">Heading</th>
                <th className="px-2 py-2">Hotspots</th>
                <th className="px-2 py-2">Views</th>
                <th className="px-2 py-2">Visible</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node, index) => {
                const stat = viewsStats.find((item) => item.nodeId === node.id);
                const isExpanded = expandedRows[node.id] ?? false;

                return (
                  <Fragment key={node.id}>
                    <tr
                      className="cursor-pointer border-t border-white/10 hover:bg-white/5"
                      onClick={() =>
                        setExpandedRows((prev) => ({
                          ...prev,
                          [node.id]: !prev[node.id],
                        }))
                      }
                    >
                      <td className="px-2 py-2">{index + 1}</td>
                      <td className="px-2 py-2">{node.name}</td>
                      <td className="px-2 py-2">{node.node_type}</td>
                      <td className="px-2 py-2">{formatGps(node.gps_lat, node.gps_lng)}</td>
                      <td className="px-2 py-2">{node.heading.toFixed(1)}°</td>
                      <td className="px-2 py-2">{hotspotCountByNode[node.id] ?? 0}</td>
                      <td className="px-2 py-2">{stat?.views ?? 0}</td>
                      <td className="px-2 py-2">
                        <label className="inline-flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={node.is_published}
                            onChange={() => {
                              void toggleNodeVisibility(node.id, node.is_published);
                            }}
                            aria-label={`Toggle visibility for ${node.name}`}
                          />
                          <span>{node.is_published ? 'Yes' : 'No'}</span>
                        </label>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-t border-white/10 bg-black/35">
                        <td className="px-2 py-2" colSpan={8}>
                          <pre className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/45 p-3 text-xs text-slate-300">
                            {JSON.stringify(node.metadata ?? {}, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
        <h2 className="text-sm uppercase tracking-[0.2em] text-emerald-300">Import Manifest</h2>
        <input
          type="file"
          accept="application/json,.json"
          onChange={handleManifestFile}
          className="mt-3 block w-full text-sm text-slate-200"
          aria-label="Choose manifest json file"
        />

        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
          <div>Nodes: {manifestSummary.nodes}</div>
          <div>Hotspots: {manifestSummary.hotspots}</div>
          <div>
            Bounding box:{' '}
            {manifestSummary.bbox
              ? `${manifestSummary.bbox.minLat.toFixed(5)}, ${manifestSummary.bbox.minLng.toFixed(5)} -> ${manifestSummary.bbox.maxLat.toFixed(5)}, ${manifestSummary.bbox.maxLng.toFixed(5)}`
              : 'N/A'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void handleImportManifest();
          }}
          disabled={isImporting || !selectedManifestText}
          className="mt-4 rounded-lg border border-emerald-300/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-60"
        >
          {isImporting ? 'Importing...' : 'Import'}
        </button>

        {importResult ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
            {importResult}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
        <h2 className="text-sm uppercase tracking-[0.2em] text-emerald-300">Analytics (Last 7 Days)</h2>
        <div className="mt-3 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
          <div>Total views: {totalViews}</div>
          <div>Most visited: {mostVisitedNode}</div>
        </div>

        <div className="mt-4 space-y-2">
          {viewsStats.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
              No analytics data in the last 7 days.
            </div>
          ) : (
            viewsStats.map((item) => {
              const maxValue = Math.max(...viewsStats.map((entry) => entry.views), 1);
              const widthPct = (item.views / maxValue) * 100;

              return (
                <div key={item.nodeId} className="grid grid-cols-[minmax(110px,1fr)_3fr_auto] items-center gap-3 text-xs sm:text-sm">
                  <div className="truncate text-slate-200">{item.nodeName}</div>
                  <div className="h-3 overflow-hidden rounded-full border border-white/10 bg-black/30">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
                      style={{ width: `${Math.max(widthPct, 4)}%` }}
                    />
                  </div>
                  <div className="font-semibold text-slate-100">{item.views}</div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
