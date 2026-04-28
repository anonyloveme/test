import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HotspotRow, TourNodeRow, TourRow } from '../types/tour';

export interface SupabaseEnv {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

// For client-side React islands (browser) — reads VITE_ at build time
function getClientEnv(): SupabaseEnv {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error('[Supabase] Missing client env vars');
  return { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key };
}

// For SSR Astro pages — receives env from Astro.locals.runtime.env
export function createSupabaseClient(env?: SupabaseEnv): SupabaseClient {
  const resolved = env ?? getClientEnv();
  return createClient(resolved.VITE_SUPABASE_URL, resolved.VITE_SUPABASE_ANON_KEY);
}

// SSR functions — require env passed explicitly
export async function getTourBySlug(slug: string, env?: SupabaseEnv): Promise<TourRow> {
  const client = createSupabaseClient(env);
  const { data, error } = await client
    .from('tours')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<TourRow>();
  if (error || !data) throw new Error(`Tour not found: ${slug} — ${error?.message ?? 'no data'}`);
  return data;
}

export async function getTourNodes(tourId: string, env?: SupabaseEnv): Promise<TourNodeRow[]> {
  const client = createSupabaseClient(env);
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

export async function getHotspotsForTour(tourId: string, env?: SupabaseEnv): Promise<HotspotRow[]> {
  const client = createSupabaseClient(env);
  const { data, error } = await client
    .from('hotspots')
    .select(
      `
      *,
      from_node_data:tour_nodes!hotspots_from_node_fkey (id, node_key),
      to_node_data:tour_nodes!hotspots_to_node_fkey (id, node_key, name, thumbnail_url, gps_lat, gps_lng)
    `
    )
    .eq('is_visible', true)
    .returns<HotspotRow[]>();
  if (error) throw new Error(`Hotspots fetch failed: ${error.message}`);
  return data ?? [];
}

export async function trackNodeView(nodeId: string, tourId: string): Promise<void> {
  try {
    const client = createSupabaseClient(); // client-side only
    await client.from('node_views').insert({
      node_id: nodeId,
      tour_id: tourId,
      session_id: getSessionId(),
      device: typeof window !== 'undefined'
        ? window.innerWidth < 768 ? 'mobile' : 'desktop'
        : 'unknown',
    });
  } catch {
    // silent
  }
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return 'ssr';
  let id = sessionStorage.getItem('vt_session');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('vt_session', id); }
  return id;
}