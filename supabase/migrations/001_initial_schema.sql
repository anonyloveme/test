create extension if not exists pgcrypto;

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  cover_image text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  mapbox_style text not null default 'mapbox://styles/mapbox/satellite-streets-v12',
  center_lat decimal(10,8),
  center_lng decimal(11,8),
  zoom_level decimal(4,2) not null default 14,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tour_nodes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  node_key text not null,
  name text not null,
  panorama_url text,
  thumbnail_url text,
  tiles_base_url text,
  tile_levels jsonb,
  gps_lat decimal(10,8),
  gps_lng decimal(11,8),
  gps_altitude decimal(8,2),
  heading decimal(6,2),
  node_type text not null check (node_type in ('merged', 'standalone')),
  confidence text not null default 'original',
  sort_order integer not null default 0,
  is_published boolean not null default true,
  metadata jsonb,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tour_id, node_key)
);

create table if not exists public.hotspots (
  id uuid primary key default gen_random_uuid(),
  from_node uuid not null references public.tour_nodes(id) on delete cascade,
  to_node uuid not null references public.tour_nodes(id) on delete cascade,
  yaw decimal(7,4) not null,
  pitch decimal(7,4) not null default -10,
  label text not null,
  distance_m decimal(8,2) not null,
  icon_type text not null default 'arrow',
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.node_views (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.tour_nodes(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  session_id text not null,
  device text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tours_status on public.tours(status);
create index if not exists idx_tour_nodes_tour_id on public.tour_nodes(tour_id);
create index if not exists idx_tour_nodes_node_key on public.tour_nodes(node_key);
create index if not exists idx_tour_nodes_sort_order on public.tour_nodes(tour_id, sort_order);
create index if not exists idx_tour_nodes_published on public.tour_nodes(is_published);
create index if not exists idx_hotspots_from_node on public.hotspots(from_node);
create index if not exists idx_hotspots_to_node on public.hotspots(to_node);
create index if not exists idx_hotspots_visible on public.hotspots(is_visible);
create index if not exists idx_node_views_node_id on public.node_views(node_id);
create index if not exists idx_node_views_tour_id on public.node_views(tour_id);
create index if not exists idx_node_views_created_at on public.node_views(created_at desc);

alter table public.tours enable row level security;
alter table public.tour_nodes enable row level security;
alter table public.hotspots enable row level security;
alter table public.node_views enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_tours_updated_at
before update on public.tours
for each row
execute function public.set_updated_at();

create policy "Public can read published tours"
  on public.tours
  for select
  to anon, authenticated
  using (status = 'published');

create policy "Authenticated users manage tours"
  on public.tours
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Public can read published nodes"
  on public.tour_nodes
  for select
  to anon, authenticated
  using (is_published = true);

create policy "Authenticated users manage nodes"
  on public.tour_nodes
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Public can read visible hotspots"
  on public.hotspots
  for select
  to anon, authenticated
  using (is_visible = true);

create policy "Authenticated users manage hotspots"
  on public.hotspots
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Public can insert node views"
  on public.node_views
  for insert
  to anon, authenticated
  with check (true);

create policy "Authenticated users manage node views"
  on public.node_views
  for all
  to authenticated
  using (true)
  with check (true);
