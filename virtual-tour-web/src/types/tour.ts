export interface GPS {
  lat: number;
  lng: number;
  alt: number;
}

export interface TileLevel {
  level: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  tile_size: number;
}

export interface TileInfo {
  format: 'marzipano_standard' | 'flat_row_col' | 'unknown' | 'missing';
  rows: number;
  cols: number;
  levels?: TileLevel[];
}

export interface Hotspot {
  target_id: string;
  target_name: string;
  yaw: number;
  pitch: number;
  distance_m: number;
  label: string;
}

export interface TourNode {
  id: string;
  scene_folder: string;
  name: string;
  filename: string;
  url: string;
  thumbnail: string;
  tiles_url: string;
  tile_url_pattern: string;
  tile_format: TileInfo['format'];
  tile_info: TileInfo;
  tile_levels?: TileLevel[];
  gps: GPS;
  heading: number;
  type: 'merged' | 'standalone';
  confidence: 'HIGH' | 'MEDIUM' | 'original';
  hotspots: Hotspot[];
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface MapboxConfig {
  center: { lat: number; lng: number };
  zoom: number;
  pitch: number;
  style: string;
}

export interface TourManifest {
  tour_name: string;
  generated_at: string;
  camera: string;
  projection: 'equirectangular';
  resolution: string;
  total_nodes: number;
  tile_format: string;
  mapbox: MapboxConfig;
  nodes: TourNode[];
}

export interface TourRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_image: string | null;
  status: 'draft' | 'published';
  mapbox_style: string;
  center_lat: number;
  center_lng: number;
  zoom_level: number;
  created_at: string;
  updated_at: string;
}

export interface TourNodeRow {
  id: string;
  tour_id: string;
  node_key: string;
  name: string;
  panorama_url: string | null;
  thumbnail_url: string | null;
  tiles_base_url: string | null;
  tile_levels: TileLevel[] | null;
  gps_lat: number;
  gps_lng: number;
  gps_altitude: number;
  heading: number;
  node_type: 'merged' | 'standalone';
  confidence: string;
  sort_order: number;
  is_published: boolean;
  metadata: TourNode | null;
  view_count: number;
  created_at: string;
}

export interface HotspotRow {
  id: string;
  from_node: string;
  to_node: string;
  yaw: number;
  pitch: number;
  label: string;
  distance_m: number;
  icon_type: string;
  is_visible: boolean;
  to_node_data?: {
    id: string;
    node_key: string;
    name: string;
    thumbnail_url: string | null;
    gps_lat: number;
    gps_lng: number;
  } | null;
  created_at: string;
}

export interface ViewerState {
  currentNode: TourNode | null;
  previousNode: TourNode | null;
  isTransitioning: boolean;
  isMapVisible: boolean;
  isInfoVisible: boolean;
  isFullscreen: boolean;
  isMobile: boolean;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';