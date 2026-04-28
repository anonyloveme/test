# Deployment Runbook

## Prerequisites

- Node.js 20.x
- Python 3.11+
- Git 2.4+
- Cloudflare account with Pages and R2 access
- Supabase project with Auth and Postgres
- Mapbox account with a restricted public token

Install links:
- Node.js: https://nodejs.org/
- Python: https://www.python.org/downloads/
- Git: https://git-scm.com/
- Cloudflare dashboard: https://dash.cloudflare.com/
- Supabase dashboard: https://supabase.com/dashboard
- Mapbox account: https://account.mapbox.com/

## One-Time Setup

### a. Cloudflare R2 bucket creation

UI path:
1. Open the Cloudflare dashboard.
2. Go to R2.
3. Create a bucket named for your tour assets.
4. Copy the account ID, access key ID, secret access key, and bucket name into `.env.local`.

Wrangler alternative:
1. Install Wrangler.
2. Create the bucket from the command line if you prefer infrastructure-as-code.
3. Store the bucket credentials in `.env.local`.

### b. Cloudflare Pages project creation

1. In the Cloudflare dashboard, create a new Pages project.
2. Connect the GitHub repository.
3. Set the build command to run the Astro build in `virtual-tour-web`.
4. Set the output directory to `virtual-tour-web/dist`.
5. Add the GitHub secrets required by the workflow.

### c. Supabase project creation

1. Create a Supabase project.
2. Apply the SQL migration in `supabase/migrations/001_initial_schema.sql`.
3. Deploy the Edge Function in `supabase/functions/import-manifest`.
4. Add the Supabase URL and anon key to `.env.local`.

### d. Mapbox token restrictions

1. Create a public token in your Mapbox account.
2. Restrict the token to your production domain and approved local dev origins.
3. Add the token to `.env.local` as `VITE_MAPBOX_TOKEN`.

### e. GitHub Secrets configuration

Add these secrets in the GitHub repository settings:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MAPBOX_TOKEN`
- `VITE_R2_PUBLIC_URL`

## First Deployment

1. Fill `.env.local` with production values.
2. Run `python scripts/preflight.py` and confirm it exits `0`.
3. Run `python scripts/configure_r2_cors.py`.
4. Run `python scripts/upload_to_r2.py`.
5. Run `python scripts/setup_supabase.py`.
6. Commit and push:

```bash
git add -A
git commit -m "feat: initial deploy"
git push origin main
```

7. Watch GitHub Actions until all jobs are green.
8. Open `https://virtual-360.pages.dev`.
9. Open `/tour/kon-tum-forest` and verify the viewer loads.

## Updating Content

When adding new panoramas:

1. Run the Python pipeline on the new source images.
2. Run `python scripts/transform_metadata.py`.
3. Run `python scripts/validate_manifest.py`.
4. Run `python scripts/upload_to_r2.py`.
5. Run `python scripts/setup_supabase.py`.
6. No code deploy is needed for data-only updates; the live data updates through the database and R2 assets.

## Rollback Procedure

If a deployment breaks, use the Cloudflare Pages dashboard to roll back to the previous deployment. This is faster than a git revert and does not require a code change.

## Monitoring

- Cloudflare Pages analytics for traffic and deploy status
- Supabase dashboard -> Table Editor -> `node_views`
- Cloudflare R2 bucket metrics for asset storage and requests
- Mapbox usage statistics at https://account.mapbox.com/statistics

## Cost Breakdown

| Service | Free Tier Limit | Current Usage | Cost |
| --- | --- | --- | --- |
| Cloudflare Pages | Unlimited bandwidth on Pages | Static site hosting only | $0 |
| Cloudflare R2 | 10 GB storage / 1M Class A / 10M Class B | Tour imagery and thumbnails | $0 egress |
| Supabase | Free tier project limits | Metadata, auth, analytics | $0 unless upgraded |
| Mapbox | Token-based usage limits | Client-side map tiles | $0 on low-volume usage |
| GitHub Actions | Included minutes quota | Build and deploy pipeline | $0 within quota |

## Troubleshooting

### 404 on `/tour/kon-tum-forest`

- Confirm the slug exists in Supabase and the tour row is published.
- Confirm the build deployed successfully.
- Check that the Edge Function imported the manifest correctly.

### Panorama not loading

- Usually a CORS issue on R2.
- Re-run `python scripts/configure_r2_cors.py`.
- Confirm the asset URLs in `tour_manifest.json` match the production R2 URL.

### Map not showing

- Confirm `VITE_MAPBOX_TOKEN` is set and starts with `pk.eyJ`.
- Confirm the token is not restricted away from your domain.

### Supabase 401

- Confirm `VITE_SUPABASE_ANON_KEY` is correct.
- Confirm RLS policies allow the requested read path.

### Tiles loading slowly

- R2 may not be fully cached at the edge yet.
- Verify the `tiles/` paths are correct and the thumbnails are uploaded.

### Admin panel login failing

- Confirm the email/password user exists in Supabase Auth.
- Confirm the project URL and anon key are correct.
- Verify the authenticated RLS policies for tours and nodes.
