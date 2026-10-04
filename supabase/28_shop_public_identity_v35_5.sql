-- ============================================================
-- THE PEDRO & PACO CASINO — SHOP PUBLIC IDENTITY V35.5
-- Ejecutar DESPUÉS de 25_fodo_shop.sql.
-- Hace que los cosméticos equipados sean accesibles para las
-- superficies públicas (ranking, chat y perfiles).
-- No cambia precios, saldo ni probabilidades.
-- ============================================================

create or replace function public.get_public_profiles(p_token text)
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
        'id', p.id,
        'username', p.username,
        'coins', p.coins,
        'xp', p.xp,
        'level', p.level,
        'avatar_id', p.avatar_id,
        'shop_cosmetics', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'category', i.category,
            'rarity', i.rarity
          ) order by i.category, i.sort_order)
          from public.shop_inventory si
          join public.shop_items i on i.id = si.item_id
          where si.user_id = p.id and si.equipped and i.active
        ), '[]'::jsonb)
      ) order by lower(p.username)
    )
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_public_profile(p_token text, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_row public.profiles%rowtype;
  v_games integer;
  v_wins integer;
  v_losses integer;
  v_net integer;
  v_best integer;
  v_shop jsonb;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select * into v_row from public.profiles
  where lower(username) = lower(trim(coalesce(p_username, '')))
  limit 1;
  if not found then raise exception 'Jugador no encontrado'; end if;

  select count(*)::integer,
         count(*) filter (where b.delta > 0)::integer,
         count(*) filter (where b.delta < 0)::integer,
         coalesce(sum(b.delta), 0)::integer,
         coalesce(max(b.delta), 0)::integer
  into v_games, v_wins, v_losses, v_net, v_best
  from public.bets b where b.user_id = v_row.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'category', i.category,
    'rarity', i.rarity
  ) order by i.category, i.sort_order), '[]'::jsonb)
  into v_shop
  from public.shop_inventory si
  join public.shop_items i on i.id = si.item_id
  where si.user_id = v_row.id and si.equipped and i.active;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'coins', v_row.coins,
    'xp', v_row.xp,
    'level', v_row.level,
    'avatar_id', v_row.avatar_id,
    'games', v_games,
    'wins', v_wins,
    'losses', v_losses,
    'net', v_net,
    'best_win', v_best,
    'shop_cosmetics', v_shop,
    'is_me', v_row.id = v_uid
  );
end;
$$;

create or replace function public.shop_get_public_cosmetics(p_token text)
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
    select jsonb_agg(jsonb_build_object(
      'user_id', p.id,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'rarity', i.rarity
        ) order by i.category, i.sort_order)
        from public.shop_inventory si
        join public.shop_items i on i.id = si.item_id
        where si.user_id = p.id and si.equipped and i.active
      ), '[]'::jsonb)
    ) order by lower(p.username))
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_profiles(text) from public, anon, authenticated;
grant execute on function public.get_public_profiles(text) to anon;
revoke all on function public.get_public_profile(text,text) from public, anon, authenticated;
grant execute on function public.get_public_profile(text,text) to anon;
revoke all on function public.shop_get_public_cosmetics(text) from public, anon, authenticated;
grant execute on function public.shop_get_public_cosmetics(text) to anon;

notify pgrst, 'reload schema';
