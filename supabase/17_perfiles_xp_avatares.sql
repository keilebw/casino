-- ============================================================
-- CASINO - PERFIL, XP, NIVELES Y AVATARES
-- Migración para la versión de perfiles.
-- No cambia las reglas ni el saldo de ningún juego.
-- ============================================================

-- 1) Nuevos datos del perfil
alter table public.profiles
  add column if not exists xp integer not null default 0;

alter table public.profiles
  add column if not exists level integer not null default 1;

alter table public.profiles
  add column if not exists avatar_id text not null default 'avatar_01';

create index if not exists profiles_level_idx
on public.profiles(level desc, xp desc);

-- Validamos que el avatar siempre sea uno de los disponibles.
update public.profiles
set avatar_id = 'avatar_01'
where avatar_id is null
   or avatar_id not in (
     'avatar_01','avatar_02','avatar_03','avatar_04',
     'avatar_05','avatar_06','avatar_07','avatar_08',
     'avatar_09','avatar_10','avatar_11','avatar_12'
   );

-- 2) Fórmula de nivel. Aproximadamente:
-- nivel 1 = 0 XP
-- nivel 2 = 100 XP
-- nivel 3 = 254 XP
-- nivel 4 = 457 XP
-- y va creciendo progresivamente.
create or replace function public.level_for_xp(p_xp integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    1,
    floor(
      power(greatest(coalesce(p_xp, 0), 0)::numeric / 100,
      (1::numeric / 1.35::numeric))
    )::integer + 1
  );
$$;

-- 3) Cada apuesta cerrada genera XP automáticamente.
-- La cantidad depende del importe jugado y añade un bonus por
-- ganancia neta positiva. Está limitada para evitar que una gran
-- victoria dispare miles de XP de golpe.
alter table public.bets
  add column if not exists xp_awarded integer not null default 0;

create or replace function public.award_xp_for_bet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_xp integer;
  v_new_xp integer;
begin
  if coalesce(new.xp_awarded, 0) > 0 then
    return new;
  end if;

  v_xp := least(
    50,
    5
    + least(10, greatest(0, floor(coalesce(new.bet, 0)::numeric / 10)::integer))
    + least(30, greatest(0, floor(greatest(coalesce(new.delta, 0), 0)::numeric / 10)::integer))
  );

  v_new_xp := coalesce((select xp from public.profiles where id = new.user_id), 0) + v_xp;

  update public.profiles
  set
    xp = v_new_xp,
    level = public.level_for_xp(v_new_xp)
  where id = new.user_id;

  new.xp_awarded := v_xp;
  return new;
end;
$$;

drop trigger if exists bets_award_xp on public.bets;
create trigger bets_award_xp
before insert on public.bets
for each row
execute function public.award_xp_for_bet();

-- 4) Perfil privado del usuario actual. Conserva la firma existente.
create or replace function public.get_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_row public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select * into v_row
  from public.profiles
  where id = v_uid;

  if not found then raise exception 'No existe tu perfil'; end if;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'coins', v_row.coins,
    'xp', v_row.xp,
    'level', v_row.level,
    'avatar_id', v_row.avatar_id
  );
end;
$$;

-- 5) Cambiar el avatar propio. Solo admite los 12 avatares incluidos.
create or replace function public.update_profile_avatar(p_token text, p_avatar_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_avatar text := lower(trim(coalesce(p_avatar_id, '')));
  v_row public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  if not (v_avatar = any(array[
    'avatar_01','avatar_02','avatar_03','avatar_04',
    'avatar_05','avatar_06','avatar_07','avatar_08',
    'avatar_09','avatar_10','avatar_11','avatar_12'
  ]::text[])) then
    raise exception 'Avatar no válido';
  end if;

  update public.profiles
  set avatar_id = v_avatar
  where id = v_uid
  returning * into v_row;

  if not found then raise exception 'No existe tu perfil'; end if;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'coins', v_row.coins,
    'xp', v_row.xp,
    'level', v_row.level,
    'avatar_id', v_row.avatar_id
  );
end;
$$;

-- 6) Perfil público por nombre.
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
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select * into v_row
  from public.profiles
  where lower(username) = lower(trim(coalesce(p_username, '')))
  limit 1;

  if not found then raise exception 'Jugador no encontrado'; end if;

  select
    count(*)::integer,
    count(*) filter (where b.delta > 0)::integer,
    count(*) filter (where b.delta < 0)::integer,
    coalesce(sum(b.delta), 0)::integer,
    coalesce(max(b.delta), 0)::integer
  into v_games, v_wins, v_losses, v_net, v_best
  from public.bets b
  where b.user_id = v_row.id;

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
    'is_me', v_row.id = v_uid
  );
end;
$$;

-- 7) Mapa público ligero para que chat, Poker y juegos 1v1 puedan
-- mostrar el avatar sin exponer contraseñas ni sesiones.
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
        'avatar_id', p.avatar_id
      ) order by lower(p.username)
    )
    from public.profiles p
  ), '[]'::jsonb);
end;
$$;

-- 8) Chat: las nuevas líneas incluyen el avatar actual.
-- Los mensajes antiguos seguirán funcionando y el frontend usará
-- avatar_01 si aún no tienen avatar_id.
alter table public.chat_messages
  add column if not exists avatar_id text not null default 'avatar_01';

create or replace function public.send_chat_message(p_token text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_username text;
  v_avatar_id text;
  v_message text := left(trim(coalesce(p_message, '')), 300);
  v_row public.chat_messages%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  if v_message = '' then raise exception 'El mensaje no puede estar vacío'; end if;

  select username, avatar_id
  into v_username, v_avatar_id
  from public.profiles
  where id = v_uid;

  if v_username is null then raise exception 'No existe tu perfil'; end if;

  insert into public.chat_messages (user_id, username, avatar_id, message)
  values (v_uid, v_username, coalesce(v_avatar_id, 'avatar_01'), v_message)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'username', v_row.username,
    'avatar_id', v_row.avatar_id,
    'message', v_row.message,
    'created_at', v_row.created_at
  );
end;
$$;

-- 9) Sidebar con avatares.
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
      'level', p.level,
      'avatar_id', p.avatar_id
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
      'level', p.level,
      'avatar_id', p.avatar_id
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
      b.created_at,
      b.username,
      b.game,
      b.bet,
      b.delta,
      b.detail,
      b.result_number,
      coalesce(p.avatar_id, 'avatar_01') as avatar_id
    from public.bets b
    join active a on a.user_id = b.user_id
    join public.profiles p on p.id = b.user_id
    order by b.created_at desc
    limit 18
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'created_at', r.created_at,
      'username', r.username,
      'game', r.game,
      'bet', r.bet,
      'delta', r.delta,
      'detail', r.detail,
      'result_number', r.result_number,
      'avatar_id', r.avatar_id
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

-- Permisos para nuestro sistema de sesiones propio.
revoke all on function public.level_for_xp(integer) from public, anon, authenticated;
revoke all on function public.award_xp_for_bet() from public, anon, authenticated;
revoke all on function public.get_profile(text) from public, anon, authenticated;
revoke all on function public.update_profile_avatar(text, text) from public, anon, authenticated;
revoke all on function public.get_public_profile(text, text) from public, anon, authenticated;
revoke all on function public.get_public_profiles(text) from public, anon, authenticated;
revoke all on function public.send_chat_message(text, text) from public, anon, authenticated;
revoke all on function public.get_sidebar_data(text) from public, anon, authenticated;

grant execute on function public.get_profile(text) to anon;
grant execute on function public.update_profile_avatar(text, text) to anon;
grant execute on function public.get_public_profile(text, text) to anon;
grant execute on function public.get_public_profiles(text) to anon;
grant execute on function public.send_chat_message(text, text) to anon;
grant execute on function public.get_sidebar_data(text) to anon;

notify pgrst, 'reload schema';
