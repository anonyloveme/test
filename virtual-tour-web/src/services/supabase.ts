import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HotspotRow, TourNodeRow, TourRow } from '../types/tour';

// ✅ KHÔNG throw ở module level — lazy init
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url =
    import.meta.env.VITE_SUPABASE_URL ??
    (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);

  const key =
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : undefined);

  if (!url || !key) {
    throw new Error('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }

  _client = createClient(url, key);
  return _client;
}

export async function getTourBySlug(slug: string): Promise<TourRow> {
  const client = getClient();
  const { data, error } = await client
    .from('tours')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<TourRow>();

  if (error || !data) {
    throw new Error(`Tour not found: ${slug} — ${error?.message ?? 'no data'}`);
  }
  return data;
}

export async function getTourNodes(tourId: string): Promise<TourNodeRow[]> {
  const client = getClient();
  const { data, error } = await client
    .from('tour_nodes')
    .select('*')
    .eq('tour_id', tourId)
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .returns<TourNodeRow[]>();

  if (error) throw new Error(`Nodes fetch failed: ${error.message}`);
  return data ?? [];
}

export async function getHotspotsForNode(nodeId: string): Promise<HotspotRow[]> {
  const client = getClient();
  const { data, error } = await client
    .from('hotspots')
    .select('*, to_node_data:tour_nodes!hotspots_to_node_fkey (id, node_key, name, thumbnail_url, gps_lat, gps_lng)')
    .eq('from_node', nodeId)
    .eq('is_visible', true)
    .returns<HotspotRow[]>();

  if (error) throw new Error(`Hotspots fetch failed: ${error.message}`);
  return data ?? [];
}

export async function trackNodeView(nodeId: string, tourId: string): Promise<void> {
  try {
    const client = getClient();
    await client.from('node_views').insert({
      node_id: nodeId,
      tour_id: tourId,
      session_id: getSessionId(),
      device: typeof window !== 'undefined'
        ? window.innerWidth < 768 ? 'mobile' : 'desktop'
        : 'unknown',
    });
  } catch {
    // silent — analytics không critical
  }
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return 'ssr';
  let id = sessionStorage.getItem('vt_session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('vt_session', id);
  }
  return id;
}