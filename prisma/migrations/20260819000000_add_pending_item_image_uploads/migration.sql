create table public.pending_item_image_uploads (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  object_key text not null unique,
  content_type text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index pending_item_image_uploads_user_expires_idx
  on public.pending_item_image_uploads (user_id, expires_at);

grant select, insert, delete on public.pending_item_image_uploads to monolog_app;

alter table public.pending_item_image_uploads enable row level security;

create policy pending_item_image_uploads_select
  on public.pending_item_image_uploads for select
  using (user_id = app.current_user_id());

create policy pending_item_image_uploads_insert
  on public.pending_item_image_uploads for insert
  with check (user_id = app.current_user_id());

create policy pending_item_image_uploads_delete
  on public.pending_item_image_uploads for delete
  using (user_id = app.current_user_id());
