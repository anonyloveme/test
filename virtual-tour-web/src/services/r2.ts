const R2_BASE = import.meta.env.VITE_R2_PUBLIC_URL?.replace(/\/$/, '') ?? 'https://pub-CHANGEME.r2.dev';

type TileFormat = 'flat_row_col' | 'marzipano_standard' | 'unknown' | 'missing';

export const r2 = {
  panorama: (filename: string) => `${R2_BASE}/panoramas/${filename}`,
  thumbnail: (sceneFolder: string) => `${R2_BASE}/thumbnails/${sceneFolder}_thumb.jpg`,
  tilesBase: (sceneFolder: string) => `${R2_BASE}/tiles/${sceneFolder}`,
  tilePattern: (sceneFolder: string, format: TileFormat = 'flat_row_col') => {
    const base = `${R2_BASE}/tiles/${sceneFolder}`;
    return format === 'marzipano_standard' ? `${base}/{z}/{x}/{y}.jpg` : `${base}/tile_{y}_{x}.jpg`;
  },
};