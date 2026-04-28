import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface HotspotInput {
  target_id: string;
  target_name: string;
  yaw: number;
  pitch: number;
  distance_m: number;
  label: string;
}

interface TourNodeInput {
  id: string;
  scene_folder: string;
  name: string;
  filename: string;
  url: string;
  thumbnail: string;
  tiles_url: string;
  tile_url_pattern: string;
  tile_format: 'flat_row_col' | 'marzipano_standard' | 'unknown' | 'missing';
  tile_info: { format: string; rows: number; cols: number };
  gps: { lat: number; lng: number; alt: number };
  heading: number;
  type: 'merged' | 'standalone';
  confidence: 'HIGH' | 'MEDIUM' | 'original';
  hotspots: HotspotInput[];
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

interface TourManifestInput {
  tour_name: string;
  generated_at: string;
  camera: string;
  projection: 'equirectangular';
  resolution: string;
  total_nodes: number;
  tile_format: string;
  mapbox: {
    center: { lat: number; lng: number };
    zoom: number;
    pitch: number;
    style: string;
  };
  nodes: TourNodeInput[];
}

interface ImportPayload {
  manifest: TourManifestInput;
  tour_slug: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isAuthorized(request: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!expected) {
    return false;
  }
  return authHeader === `Bearer ${expected}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  if (!isAuthorized(request)) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: 'Missing Supabase environment variables' }, 500);
  }

  let payload: ImportPayload;
  try {
    payload = await request.json() as ImportPayload;
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  const { manifest, tour_slug } = payload;
  if (!manifest || !tour_slug) {
    return jsonResponse({ success: false, error: 'Both manifest and tour_slug are required' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const tourRecord = {
      slug: tour_slug,
      name: manifest.tour_name,
      description: null,
      cover_image: manifest.nodes[0]?.thumbnail ?? null,
      status: 'published',
      mapbox_style: manifest.mapbox.style,
      center_lat: manifest.mapbox.center.lat,
      center_lng: manifest.mapbox.center.lng,
      zoom_level: manifest.mapbox.zoom,
    };

    const { data: upsertedTour, error: tourError } = await supabase
      .from('tours')
      .upsert(tourRecord, { onConflict: 'slug' })
      .select('id')
      .single();

    if (tourError || !upsertedTour) {
      throw new Error(tourError?.message ?? 'Failed to upsert tour');
    }

    const tourId = upsertedTour.id as string;

    const nodeRows = manifest.nodes.map((node, index) => ({
      tour_id: tourId,
      node_key: node.id,
      name: node.name,
      panorama_url: node.url,
      thumbnail_url: node.thumbnail,
      tiles_base_url: node.tiles_url,
      tile_levels: node.tile_info ? [node.tile_info] : [],
      gps_lat: node.gps.lat,
      gps_lng: node.gps.lng,
      gps_altitude: node.gps.alt,
      heading: node.heading,
      node_type: node.type,
      confidence: node.confidence,
      sort_order: index,
      is_published: true,
      metadata: node,
    }));

    const { error: nodesError } = await supabase
      .from('tour_nodes')
      .upsert(nodeRows, { onConflict: 'tour_id,node_key' });

    if (nodesError) {
      throw new Error(nodesError.message);
    }

    const { data: storedNodes, error: storedNodesError } = await supabase
      .from('tour_nodes')
      .select('id,node_key')
      .eq('tour_id', tourId);

    if (storedNodesError || !storedNodes) {
      throw new Error(storedNodesError?.message ?? 'Failed to reload tour nodes');
    }

    const nodeIdByKey = new Map<string, string>();
    storedNodes.forEach((row) => {
      nodeIdByKey.set(row.node_key as string, row.id as string);
    });

    const nodeIds = [...nodeIdByKey.values()];
    if (nodeIds.length > 0) {
      const { error: deleteHotspotsError } = await supabase
        .from('hotspots')
        .delete()
        .in('from_node', nodeIds);

      if (deleteHotspotsError) {
        throw new Error(deleteHotspotsError.message);
      }
    }

    const hotspotRows: Array<Record<string, unknown>> = [];
    manifest.nodes.forEach((node) => {
      const fromNodeId = nodeIdByKey.get(node.id);
      if (!fromNodeId) {
        return;
      }

      node.hotspots.forEach((hotspot) => {
        const toNodeId = nodeIdByKey.get(hotspot.target_id);
        if (!toNodeId) {
          return;
        }

        hotspotRows.push({
          from_node: fromNodeId,
          to_node: toNodeId,
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
          label: hotspot.label,
          distance_m: hotspot.distance_m,
          icon_type: 'arrow',
          is_visible: true,
        });
      });
    });

    if (hotspotRows.length > 0) {
      const { error: hotspotInsertError } = await supabase.from('hotspots').insert(hotspotRows);
      if (hotspotInsertError) {
        throw new Error(hotspotInsertError.message);
      }
    }

    return jsonResponse(
      {
        success: true,
        tour_id: tourId,
        nodes_processed: manifest.nodes.length,
        hotspots_created: hotspotRows.length,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('import-manifest failed:', error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
