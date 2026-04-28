import { createClient } from '@supabase/supabase-js';
import type { HotspotRow, TourNodeRow, TourRow } from '../types/tour';

// ✅ Lazy — không throw ngay khi import
function getSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}

export const supabase = (() => {
  try { return getSupabaseClient(); } catch { return null; }
})();

export async function getTourBySlug(slug: string): Promise<TourRow> {
  const client = getSupabaseClient(); // throw rõ ràng khi gọi
  const { data, error } = await client
    .from('tours')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<TourRow>();
  if (error || !data) throw new Error(`Tour not found: ${slug}`);
  return data;
}

export async function getTourNodes(tourId: string): Promise<TourNodeRow[]> {
  const client = getSupabaseClient();
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
  const client = getSupabaseClient();
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
    const client = getSupabaseClient();
    await client.from('node_views').insert({
      node_id: nodeId,
      tour_id: tourId,
      session_id: getSessionId(),
      device: typeof window !== 'undefined'
        ? window.innerWidth < 768 ? 'mobile' : 'desktop'
        : 'unknown',
    });
  } catch { return; }
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    return 'ssr';
  }

  let sessionId = sessionStorage.getItem('vt_session');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('vt_session', sessionId);
  }

  return sessionId;
}