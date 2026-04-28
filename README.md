# Virtual Tour Web

Interactive 360° panorama viewer built with Astro, React, and Marzipano.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Astro 4.x (hybrid) + React 18 |
| 360 Viewer | Marzipano 0.10 |
| Minimap | Mapbox GL JS 3.x |
| State | Zustand 5.x |
| Backend | Supabase (PostgreSQL + Edge Functions) |
| Storage | Cloudflare R2 (S3-compatible) |
| Deployment | Cloudflare Pages |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Cloudflare Pages                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Astro     │  │   React     │  │   Static Assets     │ │
│  │  (SSR/SSG)  │  │ (islands)   │  │  (tiles, images)   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│         └────────────────┼─────────────────────┘            │
│                          ▼                                   │
│                   ┌──────────────┐                          │
│                   │   Zustand    │                          │
│                   │    Store     │                          │
│                   └──────┬───────┘                          │
│                          │                                   │
│         ┌────────────────┼────────────────┐                │
│         ▼                ▼                ▼                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Supabase  │  │  Cloudflare│  │  Mapbox    │            │
│  │  (REST)    │  │    R2      │  │  (minimap)│            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+
- Cloudflare account with R2 + Pages
- Supabase project

### 1. Install Dependencies

```bash
cd virtual-tour-web
npm install
```

### 2. Configure Environment

Create `.env` in `virtual-tour-web/`:

```bash
# Supabase
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Cloudflare R2
PUBLIC_R2_BUCKET=your-bucket
PUBLIC_R2_ACCOUNT_ID=your-account-id
PUBLIC_R2_PUBLIC_URL=https://your-bucket.r2.cloud

# Mapbox (optional)
PUBLIC_MAPBOX_TOKEN=your-mapbox-token
```

### 3. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:4321`

### 4. Build for Production

```bash
npm run build
```

## Project Structure

```
virtual-tour-web/
├── src/
│   ├── components/
│   │   └── islands/          # React islands (client:only)
│   │       ├── VirtualTourViewer.tsx
│   │       └── Minimap.tsx
│   ├── layouts/
│   │   └── Layout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   └── api/
│   ├── services/
│   │   ├── r2.ts
│   │   └── supabase.ts
│   ├── stores/
│   │   └── tourStore.ts
│   └── types/
│       └── tour.ts
├── public/
│   └── tiles/                # Static panorama tiles
├── scripts/
│   ├── reorganize_tiles.py   # Convert flat tiles to multi-level
│   └── setup_supabase.py     # Initialize Supabase schema
└── astro.config.mjs
```

## Tile Formats

The viewer supports two tile formats:

| Format | Description | Geometry |
|--------|-------------|----------|
| `flat_row_col` | Single-level 256×256 tiles, named `tile_{y}_{x}.jpg` | Single-level EquirectGeometry |
| `marzipano_standard` | Multi-level pyramid, named `{z}/col/row.jpg` | Multi-level EquirectGeometry from levels array |

Use `scripts/reorganize_tiles.py` to convert between formats.

## Scripts

### Reorganize Tiles

Convert flat row/col tiles to Marzipano multi-level format:

```bash
python scripts/reorganize_tiles.py --scene scene_01
python scripts/reorganize_tiles.py --dry-run  # Preview only
```

### Setup Supabase

Initialize database schema and import manifest:

```bash
python scripts/setup_supabase.py
```

## Deployment

### GitHub Actions

Push to `main` triggers automatic build + deploy to Cloudflare Pages.

Required secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`

### Manual Deploy

```bash
npm run build
wrangler pages deploy dist
```

## License

MIT