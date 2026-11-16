-- ==========================================================================
-- FitGen: à coller une seule fois dans Supabase → SQL Editor → Run
-- Peut être relancé sans danger (tout est "if not exists" / "drop if exists").
-- ==========================================================================

-- Liste des vêtements. Les images sont dans le bucket `clothes`:
--   <category>/<id>.webp        1000 px de large
--   <category>/<id>-sm.webp     500 px
--   <category>/<id>-thumb.webp  vignette du picker (seulement si has_thumb)
--   <category>/<id>-master.webp 2000 px, jamais affiché (pour refaire les autres)
create table if not exists public.clothes (
    id text primary key default gen_random_uuid()::text,
    category text not null check (
        category in ('heads', 'shirts', 'crewnecks', 'pants', 'shorts', 'shoes', 'coats', 'belts')
    ),
    position integer not null default 0,
    has_thumb boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists clothes_category_position on public.clothes (category, position);

-- Comptes qui ont le droit d'ajouter / supprimer (ton compte y sera ajouté
-- quand la page d'ajout sera prête). Aucune règle = personne ne la lit par l'API.
create table if not exists public.admins (
    user_id uuid primary key references auth.users on delete cascade
);

-- Admins par courriel: permet d'autoriser un compte avant sa première connexion.
-- Le courriel est fiable, il est vérifié par le code reçu. Pour autoriser quelqu'un
-- (à faire dans le SQL Editor, jamais dans ce fichier public):
--   insert into public.admin_emails (email) values ('ton@courriel.com');
create table if not exists public.admin_emails (
    email text primary key
);

alter table public.clothes enable row level security;
alter table public.admins enable row level security;
alter table public.admin_emails enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.admins where user_id = (select auth.uid()))
        or exists (
            select 1 from public.admin_emails
            where email = lower((select auth.jwt() ->> 'email'))
        );
$$;

-- "Automatically expose new tables" est décoché: on donne l'accès à la main
grant usage on schema public to anon, authenticated;
grant select on public.clothes to anon, authenticated;
grant insert, update, delete on public.clothes to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
-- Clé secrète (scripts comme tools/migrate-to-supabase.mjs): passe par-dessus RLS
grant select, insert, update, delete on public.clothes to service_role;

-- Tout le monde voit les vêtements, seul l'admin les modifie
drop policy if exists "clothes_select" on public.clothes;
create policy "clothes_select" on public.clothes
    for select to anon, authenticated using (true);

drop policy if exists "clothes_insert" on public.clothes;
create policy "clothes_insert" on public.clothes
    for insert to authenticated with check (public.is_admin());

drop policy if exists "clothes_update" on public.clothes;
create policy "clothes_update" on public.clothes
    for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "clothes_delete" on public.clothes;
create policy "clothes_delete" on public.clothes
    for delete to authenticated using (public.is_admin());

-- Bucket public en lecture, WebP seulement, 5 Mo max par fichier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clothes', 'clothes', true, 5242880, array['image/webp'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clothes_files_insert" on storage.objects;
create policy "clothes_files_insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'clothes' and public.is_admin());

drop policy if exists "clothes_files_update" on storage.objects;
create policy "clothes_files_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'clothes' and public.is_admin())
    with check (bucket_id = 'clothes' and public.is_admin());

drop policy if exists "clothes_files_delete" on storage.objects;
create policy "clothes_files_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'clothes' and public.is_admin());
