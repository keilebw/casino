-- ============================================================
-- THE PEDRO & PACO CASINO — FODO SHOP V35
-- Tienda cosmética: no modifica probabilidades ni XP.
-- Las compras se pagan con FP y se verifican íntegramente en servidor.
-- ============================================================

create table if not exists public.shop_items (
  id text primary key,
  name text not null,
  category text not null check (category in ('frame','background','title','effect')),
  rarity text not null default 'rare' check (rarity in ('common','rare','epic','legendary')),
  price integer not null check (price >= 0),
  description text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.shop_inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.shop_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  equipped boolean not null default false,
  primary key (user_id, item_id)
);

create index if not exists shop_inventory_user_idx on public.shop_inventory(user_id);
create index if not exists shop_items_category_idx on public.shop_items(category, sort_order);

insert into public.shop_items (id, name, category, rarity, price, description, sort_order) values
  ('frame_gold', 'Golden Frame', 'frame', 'rare', 750, 'Un marco dorado clásico alrededor de tu avatar.', 10),
  ('frame_diamond', 'Diamond Frame', 'frame', 'epic', 1600, 'Borde de cristal con brillo frío y elegante.', 20),
  ('frame_neon', 'Neon Frame', 'frame', 'epic', 2200, 'Marco luminoso para destacar en el casino.', 30),
  ('frame_royal', 'Royal Frame', 'frame', 'legendary', 3200, 'El marco más lujoso de la colección.', 40),
  ('bg_velvet', 'Velvet Night', 'background', 'rare', 1100, 'Fondo inspirado en un salón privado nocturno.', 10),
  ('bg_emerald', 'Emerald Room', 'background', 'epic', 1800, 'Verde esmeralda profundo con ambiente de club.', 20),
  ('bg_gold', 'Golden Lounge', 'background', 'epic', 2500, 'Reflejos dorados para un perfil de alto nivel.', 30),
  ('bg_obsidian', 'Obsidian Club', 'background', 'legendary', 3000, 'Un fondo negro de obsidiana con destellos sutiles.', 40),
  ('title_lucky', 'LUCKY', 'title', 'common', 15, 'Tu primer título de la suerte.', 10),
  ('title_highroller', 'HIGH ROLLER', 'title', 'rare', 1200, 'Para perfiles que quieren presencia.', 20),
  ('title_mines', 'MINES MASTER', 'title', 'epic', 1700, 'Especialista en jugar al límite.', 30),
  ('title_road', 'ROAD KING', 'title', 'epic', 1500, 'Domina cada cruce y sigue avanzando.', 40),
  ('title_cardshark', 'CARD SHARK', 'title', 'legendary', 2400, 'Una insignia para amantes de las cartas.', 50),
  ('effect_gold', 'Golden Pulse', 'effect', 'rare', 1400, 'Una pulsación dorada alrededor del avatar.', 10),
  ('effect_spark', 'Spark', 'effect', 'epic', 2100, 'Pequeños destellos animados en tu identidad.', 20),
  ('effect_royal', 'Royal Glow', 'effect', 'legendary', 2900, 'Halo dorado premium con brillo continuo.', 30)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  rarity = excluded.rarity,
  price = excluded.price,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = excluded.active;

create or replace function public.shop_get_catalog(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'name', i.name,
        'category', i.category,
        'rarity', i.rarity,
        'price', i.price,
        'description', i.description,
        'owned', exists(select 1 from public.shop_inventory si where si.user_id = v_uid and si.item_id = i.id),
        'equipped', exists(select 1 from public.shop_inventory si where si.user_id = v_uid and si.item_id = i.id and si.equipped)
      ) order by i.category, i.sort_order
    )
    from public.shop_items i
    where i.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.shop_purchase(p_token text, p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_item public.shop_items%rowtype;
  v_coins integer;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select * into v_item
  from public.shop_items
  where id = trim(coalesce(p_item_id, '')) and active
  for update;

  if not found then raise exception 'Producto no disponible'; end if;

  if exists(select 1 from public.shop_inventory where user_id = v_uid and item_id = v_item.id) then
    raise exception 'Ya tienes este producto';
  end if;

  select coins into v_coins
  from public.profiles
  where id = v_uid
  for update;

  if v_coins is null then raise exception 'No existe tu perfil'; end if;
  if v_coins < v_item.price then raise exception 'No tienes suficientes FP'; end if;

  update public.profiles
  set coins = coins - v_item.price
  where id = v_uid;

  insert into public.shop_inventory(user_id, item_id, equipped)
  values(v_uid, v_item.id, false);

  return jsonb_build_object(
    'id', v_item.id,
    'name', v_item.name,
    'price', v_item.price,
    'coins', v_coins - v_item.price,
    'owned', true,
    'equipped', false
  );
end;
$$;

create or replace function public.shop_equip(p_token text, p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_item public.shop_items%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select i.* into v_item
  from public.shop_items i
  join public.shop_inventory si on si.item_id = i.id and si.user_id = v_uid
  where i.id = trim(coalesce(p_item_id, '')) and i.active;

  if not found then raise exception 'Primero debes comprar este producto'; end if;

  -- Solo un producto equipado por categoría.
  update public.shop_inventory si
  set equipped = false
  from public.shop_items i
  where si.user_id = v_uid
    and si.item_id = i.id
    and i.category = v_item.category;

  update public.shop_inventory
  set equipped = true
  where user_id = v_uid and item_id = v_item.id;

  return jsonb_build_object(
    'id', v_item.id,
    'category', v_item.category,
    'equipped', true
  );
end;
$$;

-- Permisos mínimos: las operaciones pasan siempre por RPC.
revoke all on table public.shop_items from anon, authenticated;
revoke all on table public.shop_inventory from anon, authenticated;
revoke all on function public.shop_get_catalog(text) from public;
revoke all on function public.shop_purchase(text,text) from public;
revoke all on function public.shop_equip(text,text) from public;
grant execute on function public.shop_get_catalog(text) to anon, authenticated;
grant execute on function public.shop_purchase(text,text) to anon, authenticated;
grant execute on function public.shop_equip(text,text) to anon, authenticated;
