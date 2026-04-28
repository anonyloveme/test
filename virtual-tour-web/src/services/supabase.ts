import { createClient } from '@supabase/supabase-js';
import type { HotspotRow, TourNodeRow, TourRow } from '../types/tour';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing Supabase env vars. Check .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnon);

export async function getTourBySlug(slug: string) {
  try {
    const { data, error } = await supabase
      .from('tours')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single<TourRow>();

    if (error) {
      throw error;
    }

    return data;
  } catch {
    throw new Error(`Tour not found: ${slug}`);
  }
}

export async function getTourNodes(tourId: string) {
  try {
    const { data, error } = await supabase
      .from('tour_nodes')
      .select('*')
      .eq('tour_id', tourId)
      .eq('is_published', true)
      .order('sort_order', { ascending: true })
      .returns<TourNodeRow[]>();

    if (error) {
      throw error;
    }

    return data ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Nodes fetch failed: ${message}`);
  }
}

export async function getHotspotsForNode(nodeId: string) {
  try {
    const { data, error } = await supabase
      .from('hotspots')
      .select(
        '*, to_node_data:tour_nodes!hotspots_to_node_fkey (id, node_key, name, thumbnail_url, gps_lat, gps_lng)'
      )
      .eq('from_node', nodeId)
      .eq('is_visible', true)
      .returns<HotspotRow[]>();

    if (error) {
      throw error;
    }

    return data ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Hotspots fetch failed: ${message}`);
  }
}

export async function trackNodeView(nodeId: string, tourId: string) {
  try {
    await supabase.from('node_views').insert({
      node_id: nodeId,
      tour_id: tourId,
      session_id: getSessionId(),
      device:
        typeof window !== 'undefined'
          ? window.innerWidth < 768
            ? 'mobile'
            : 'desktop'
          : 'unknown',
    });
  } catch {
    return;
  }
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