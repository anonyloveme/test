const R2_BASE_RAW = import.meta.env.VITE_R2_PUBLIC_URL as string | undefined;
const R2_BASE = R2_BASE_RAW?.replace(/\/$/, '') ?? '';

if (!R2_BASE && typeof window !== 'undefined') {
  console.error('[R2] VITE_R2_PUBLIC_URL is not set — panorama images will fail to load');
}

type TileFormat = 'flat_row_col' | 'marzipano_standard' | 'unknown' | 'missing';

export const r2 = {
  panorama: (filename: string) => `${R2_BASE}/panoramas/${filename}`,
  thumbnail: (sceneFolder: string) => `${R2_BASE}/thumbnails/${sceneFolder}_thumb.jpg`,
  tilesBase: (sceneFolder: string) => `${R2_BASE}/tiles/${sceneFolder}`,
  tilePattern: (sceneFolder: string, format: TileFormat = 'flat_row_col') => {
    const base = `${R2_BASE}/tiles/${sceneFolder}`;
    return format === 'marzipano_standard'
      ? `${base}/{z}/{x}/{y}.jpg`
      : `${base}/tile_{y}_{x}.jpg`;
  },
  isConfigured: () => R2_BASE.length > 0 && !R2_BASE.includes('CHANGEME'),
};