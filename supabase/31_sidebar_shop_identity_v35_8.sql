-- ============================================================
-- THE PEDRO & PACO CASINO — SIDEBAR PUBLIC IDENTITY V35.8
-- Ejecutar DESPUÉS de 30_shop_identity_v35_7.sql.
-- Hace que ranking + apuestas online reciban los cosméticos
-- equipados de cada jugador, de forma aislada por usuario.
-- No cambia saldo, juegos, probabilidades ni precios.
-- ============================================================

create or replace function public.get_sidebar_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_online jsonb;
  v_ranking jsonb;
  v_recent_bets jsonb;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  with active as (
    select distinct on (s.user_id) s.user_id
    from public.app_sessions s
    where s.expires_at > now()
      and s.last_seen > now() - interval '65 seconds'
    order by s.user_id, s.last_seen desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'coins', p.coins,
      'xp', p.xp,
      'level', greatest(1, coalesce(p.level, 1)),
      'avatar_id', coalesce(p.avatar_id, 'avatar_01'),
      'shop_cosmetics', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'rarity', i.rarity,
          'equipped', true
        ) order by i.category, i.sort_order)
        from public.shop_inventory si
        join public.shop_items i on i.id = si.item_id
        where si.user_id = p.id and si.equipped and i.active
      ), '[]'::jsonb)
    ) order by lower(p.username)
  ), '[]'::jsonb)
  into v_online
  from active a
  join public.profiles p on p.id = a.user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'coins', p.coins,
      'xp', p.xp,
      'level', greatest(1, coalesce(p.level, 1)),
      'avatar_id', coalesce(p.avatar_id, 'avatar_01'),
      'shop_cosmetics', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'rarity', i.rarity,
          'equipped', true
        ) order by i.category, i.sort_order)
        from public.shop_inventory si
        join public.shop_items i on i.id = si.item_id
        where si.user_id = p.id and si.equipped and i.active
      ), '[]'::jsonb)
    ) order by p.coins desc, lower(p.username)
  ), '[]'::jsonb)
  into v_ranking
  from (
    select id, username, coins, xp, level, avatar_id
    from public.profiles
    order by coins desc, lower(username)
    limit 5
  ) p;

  with active as (
    select distinct on (s.user_id) s.user_id
    from public.app_sessions s
    where s.expires_at > now()
      and s.last_seen > now() - interval '65 seconds'
    order by s.user_id, s.last_seen desc
  ), recent as (
    select
      b.user_id,
      b.created_at,
      b.username,
      b.game,
      b.bet,
      b.delta,
      b.detail,
      b.result_number,
      coalesce(p.avatar_id, 'avatar_01') as avatar_id,
      greatest(1, coalesce(p.level, 1)) as level,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'category', i.category,
          'rarity', i.rarity,
          'equipped', true
        ) order by i.category, i.sort_order)
        from public.shop_inventory si
        join public.shop_items i on i.id = si.item_id
        where si.user_id = b.user_id and si.equipped and i.active
      ), '[]'::jsonb) as shop_cosmetics
    from public.bets b
    join active a on a.user_id = b.user_id
    join public.profiles p on p.id = b.user_id
    order by b.created_at desc
    limit 18
  ) r
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', r.user_id,
      'id', r.user_id,
      'created_at', r.created_at,
      'username', r.username,
      'game', r.game,
      'bet', r.bet,
      'delta', r.delta,
      'detail', r.detail,
      'result_number', r.result_number,
      'avatar_id', r.avatar_id,
      'level', r.level,
      'shop_cosmetics', r.shop_cosmetics
    ) order by r.created_at desc
  ), '[]'::jsonb)
  into v_recent_bets
  from recent r;

  return jsonb_build_object(
    'ranking', v_ranking,
    'online', v_online,
    'recent_bets', v_recent_bets
  );
end;
$$;

revoke all on function public.get_sidebar_data(text) from public, anon, authenticated;
grant execute on function public.get_sidebar_data(text) to anon;
notify pgrst, 'reload schema';
