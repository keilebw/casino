-- ============================================================
-- MINAS / MINES — V33.0
-- Tablero 5x5 (25 casillas), 1-24 minas.
--
-- Balance objetivo: 99% RTP teórico antes del redondeo y del
-- límite económico de premio máximo de 5.000 FP.
-- Multiplicador:
--   0,99 × C(25, picks) / C(25-minas, picks)
--
-- El servidor coloca las minas y nunca entrega sus posiciones
-- mientras la partida esté activa.
-- ============================================================

create table if not exists public.mines_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stake integer not null check (stake between 1 and 25),
  mine_count integer not null check (mine_count between 1 and 24),
  mine_positions integer[] not null,
  opened_positions integer[] not null default '{}',
  current_multiplier numeric(20,8) not null default 1.00000000,
  status text not null default 'active'
    check (status in ('active','lost','cashed','won')),
  payout integer not null default 0,
  bonus_xp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists mines_one_active_per_user
on public.mines_games(user_id)
where status = 'active';

create index if not exists mines_user_created_idx
on public.mines_games(user_id, created_at desc);

alter table public.mines_games enable row level security;

-- El navegador nunca lee/escribe esta tabla directamente: todo pasa
-- por las funciones RPC de abajo.

create or replace function public.mines_calc_multiplier(
  p_mines integer,
  p_safe_picks integer
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_multiplier numeric := 0.99;
  i integer;
begin
  if p_mines is null or p_mines < 1 or p_mines > 24 then
    raise exception 'Número de minas no válido.';
  end if;

  if p_safe_picks is null or p_safe_picks < 1 or p_safe_picks > (25 - p_mines) then
    raise exception 'Número de casillas seguras no válido.';
  end if;

  for i in 0..(p_safe_picks - 1) loop
    v_multiplier := v_multiplier
      * ((25 - i)::numeric / (25 - p_mines - i)::numeric);
  end loop;

  return round(v_multiplier, 8);
end;
$$;

create or replace function public.mines_auth_user(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  v_profile := public.get_profile(p_token);
  if v_profile is null then
    raise exception 'Sesión no válida.';
  end if;

  if nullif(v_profile->>'id', '') is null then
    raise exception 'No se ha podido identificar al jugador.';
  end if;

  return (v_profile->>'id')::uuid;
end;
$$;

create or replace function public.mines_get_active(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.mines_games%rowtype;
  v_opened integer;
  v_safe_total integer;
  v_next_multiplier numeric := null;
  v_next_safe_probability numeric;
  v_potential integer;
begin
  v_user_id := public.mines_auth_user(p_token);

  select * into v_game
  from public.mines_games
  where user_id = v_user_id
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  v_opened := coalesce(array_length(v_game.opened_positions, 1), 0);
  v_safe_total := 25 - v_game.mine_count;

  if v_opened < v_safe_total then
    v_next_multiplier := public.mines_calc_multiplier(v_game.mine_count, v_opened + 1);
  end if;

  v_next_safe_probability := round(
    ((v_safe_total - v_opened)::numeric / (25 - v_opened)::numeric) * 100,
    2
  );

  v_potential := case
    when v_opened = 0 then 0
    else least(
      5000,
      greatest(0, pg_catalog.floor(v_game.stake * v_game.current_multiplier))::integer
    )
  end;

  return jsonb_build_object(
    'id', v_game.id,
    'stake', v_game.stake,
    'mine_count', v_game.mine_count,
    'opened_positions', v_game.opened_positions,
    'safe_picks', v_opened,
    'safe_total', v_safe_total,
    'current_multiplier', v_game.current_multiplier,
    'next_multiplier', v_next_multiplier,
    'next_safe_probability', v_next_safe_probability,
    'potential_payout', v_potential,
    'status', v_game.status,
    'payout', 0,
    'bonus_xp', 0,
    'max_payout', 5000
  );
end;
$$;

create or replace function public.mines_start(
  p_token text,
  p_bet integer,
  p_mines integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_balance integer;
  v_existing uuid;
  v_game public.mines_games%rowtype;
  v_mines integer[];
  v_next_multiplier numeric;
begin
  v_user_id := public.mines_auth_user(p_token);

  if p_bet is null or p_bet < 1 or p_bet > 25 then
    raise exception 'En Minas la apuesta debe estar entre 1 y 25 FP.';
  end if;

  if p_mines is null or p_mines < 1 or p_mines > 24 then
    raise exception 'Puedes elegir entre 1 y 24 minas.';
  end if;

  select id into v_existing
  from public.mines_games
  where user_id = v_user_id
    and status = 'active'
  limit 1;

  if v_existing is not null then
    raise exception 'Ya tienes una partida de Minas en curso.';
  end if;

  update public.profiles
  set coins = coins - p_bet
  where id = v_user_id
    and coins >= p_bet
  returning coins into v_balance;

  if v_balance is null then
    raise exception 'No tienes suficientes FP para esa apuesta.';
  end if;

  select pg_catalog.array_agg(pos order by pg_catalog.random())
  into v_mines
  from pg_catalog.generate_series(0, 24) as g(pos);

  v_mines := v_mines[1:p_mines];
  v_next_multiplier := public.mines_calc_multiplier(p_mines, 1);

  insert into public.mines_games(
    user_id, stake, mine_count, mine_positions, opened_positions,
    current_multiplier, status, payout, bonus_xp
  )
  values (
    v_user_id, p_bet, p_mines, v_mines, '{}',
    1.00000000, 'active', 0, 0
  )
  returning * into v_game;

  return jsonb_build_object(
    'outcome', 'started',
    'id', v_game.id,
    'stake', v_game.stake,
    'mine_count', v_game.mine_count,
    'safe_picks', 0,
    'safe_total', 25 - p_mines,
    'opened_positions', '{}',
    'current_multiplier', 1.00000000,
    'next_multiplier', v_next_multiplier,
    'next_safe_probability', round(((25 - p_mines)::numeric / 25::numeric) * 100, 2),
    'potential_payout', 0,
    'status', 'active',
    'payout', 0,
    'delta', 0,
    'coins', v_balance,
    'bonus_xp', 0,
    'max_payout', 5000
  );
end;
$$;

create or replace function public.mines_pick(
  p_token text,
  p_position integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.mines_games%rowtype;
  v_opened integer[];
  v_safe_picks integer;
  v_safe_total integer;
  v_is_mine boolean;
  v_multiplier numeric;
  v_next_multiplier numeric;
  v_next_safe_probability numeric;
  v_payout integer;
  v_balance integer;
  v_bonus_xp integer;
  v_new_xp integer;
  v_detail text;
begin
  v_user_id := public.mines_auth_user(p_token);

  if p_position is null or p_position < 0 or p_position > 24 then
    raise exception 'Casilla no válida.';
  end if;

  select * into v_game
  from public.mines_games
  where user_id = v_user_id
    and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tienes una partida de Minas activa.';
  end if;

  if pg_catalog.array_position(v_game.opened_positions, p_position) is not null then
    raise exception 'Esa casilla ya está abierta.';
  end if;

  v_is_mine := pg_catalog.array_position(v_game.mine_positions, p_position) is not null;
  v_safe_total := 25 - v_game.mine_count;
  v_opened := pg_catalog.array_append(v_game.opened_positions, p_position);
  v_safe_picks := coalesce(pg_catalog.array_length(v_opened, 1), 0);

  if v_is_mine then
    update public.mines_games mg
    set
      opened_positions = v_game.opened_positions,
      current_multiplier = 0,
      status = 'lost',
      payout = 0,
      bonus_xp = 0,
      updated_at = now(),
      finished_at = now()
    where mg.id = v_game.id
    returning * into v_game;

    select coins into v_balance
    from public.profiles
    where id = v_user_id;

    v_detail := pg_catalog.format(
      'Minas · %s minas · mina en casilla %s/25',
      v_game.mine_count,
      p_position + 1
    );

    insert into public.bets(user_id, game, bet, payout, delta, detail)
    values(v_user_id, 'Minas', v_game.stake, 0, -v_game.stake, v_detail);

    return jsonb_build_object(
      'outcome', 'mine',
      'id', v_game.id,
      'stake', v_game.stake,
      'mine_count', v_game.mine_count,
      'position', p_position,
      'opened_positions', v_game.opened_positions,
      'mine_positions', v_game.mine_positions,
      'safe_picks', v_game.opened_positions::integer[],
      'current_multiplier', 0,
      'next_multiplier', null,
      'next_safe_probability', 0,
      'potential_payout', 0,
      'status', 'lost',
      'payout', 0,
      'delta', -v_game.stake,
      'coins', v_balance,
      'bonus_xp', 0,
      'max_payout', 5000
    );
  end if;

  v_multiplier := public.mines_calc_multiplier(v_game.mine_count, v_safe_picks);
  v_payout := least(
    5000,
    greatest(0, pg_catalog.floor(v_game.stake * v_multiplier))::integer
  );

  if v_safe_picks >= v_safe_total then
    v_bonus_xp := 10;

    update public.profiles
    set
      coins = coins + v_payout,
      xp = coalesce(xp, 0) + v_bonus_xp,
      level = public.level_for_xp(coalesce(xp, 0) + v_bonus_xp)
    where id = v_user_id
    returning coins, xp into v_balance, v_new_xp;

    update public.mines_games mg
    set
      opened_positions = v_opened,
      current_multiplier = v_multiplier,
      status = 'won',
      payout = v_payout,
      bonus_xp = v_bonus_xp,
      updated_at = now(),
      finished_at = now()
    where mg.id = v_game.id
    returning * into v_game;

    v_detail := pg_catalog.format(
      'Minas · %s minas · tablero completo · %sx · +%s XP de racha',
      v_game.mine_count,
      v_multiplier::text,
      v_bonus_xp
    );

    insert into public.bets(user_id, game, bet, payout, delta, detail)
    values(v_user_id, 'Minas', v_game.stake, v_payout, v_payout - v_game.stake, v_detail);

    return jsonb_build_object(
      'outcome', 'win',
      'id', v_game.id,
      'stake', v_game.stake,
      'mine_count', v_game.mine_count,
      'position', p_position,
      'opened_positions', v_opened,
      'mine_positions', v_game.mine_positions,
      'safe_picks', v_safe_picks,
      'safe_total', v_safe_total,
      'current_multiplier', v_multiplier,
      'next_multiplier', null,
      'next_safe_probability', 0,
      'potential_payout', v_payout,
      'status', 'won',
      'payout', v_payout,
      'delta', v_payout - v_game.stake,
      'coins', v_balance,
      'bonus_xp', v_bonus_xp,
      'xp', v_new_xp,
      'max_payout', 5000
    );
  end if;

  v_next_multiplier := public.mines_calc_multiplier(v_game.mine_count, v_safe_picks + 1);
  v_next_safe_probability := round(
    ((v_safe_total - v_safe_picks)::numeric / (25 - v_safe_picks)::numeric) * 100,
    2
  );

  update public.mines_games mg
  set
    opened_positions = v_opened,
    current_multiplier = v_multiplier,
    updated_at = now()
  where mg.id = v_game.id;

  select coins into v_balance
  from public.profiles
  where id = v_user_id;

  return jsonb_build_object(
    'outcome', 'safe',
    'id', v_game.id,
    'stake', v_game.stake,
    'mine_count', v_game.mine_count,
    'position', p_position,
    'opened_positions', v_opened,
    'safe_picks', v_safe_picks,
    'safe_total', v_safe_total,
    'current_multiplier', v_multiplier,
    'next_multiplier', v_next_multiplier,
    'next_safe_probability', v_next_safe_probability,
    'potential_payout', v_payout,
    'status', 'active',
    'payout', 0,
    'delta', 0,
    'coins', v_balance,
    'bonus_xp', 0,
    'max_payout', 5000
  );
end;
$$;

create or replace function public.mines_cashout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.mines_games%rowtype;
  v_safe_picks integer;
  v_payout integer;
  v_balance integer;
  v_bonus_xp integer;
  v_new_xp integer;
  v_detail text;
begin
  v_user_id := public.mines_auth_user(p_token);

  select * into v_game
  from public.mines_games
  where user_id = v_user_id
    and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tienes una partida de Minas activa.';
  end if;

  v_safe_picks := coalesce(pg_catalog.array_length(v_game.opened_positions, 1), 0);
  if v_safe_picks < 1 then
    raise exception 'Debes descubrir al menos una gema antes de cobrar.';
  end if;

  v_payout := least(
    5000,
    greatest(0, pg_catalog.floor(v_game.stake * v_game.current_multiplier))::integer
  );

  v_bonus_xp := case
    when v_safe_picks >= 10 then 10
    when v_safe_picks >= 6 then 7
    when v_safe_picks >= 3 then 5
    else 0
  end;

  update public.profiles
  set
    coins = coins + v_payout,
    xp = coalesce(xp, 0) + v_bonus_xp,
    level = public.level_for_xp(coalesce(xp, 0) + v_bonus_xp)
  where id = v_user_id
  returning coins, xp into v_balance, v_new_xp;

  update public.mines_games mg
  set
    status = 'cashed',
    payout = v_payout,
    bonus_xp = v_bonus_xp,
    updated_at = now(),
    finished_at = now()
  where mg.id = v_game.id
  returning * into v_game;

  v_detail := pg_catalog.format(
    'Minas · %s minas · cobro tras %s gemas · %sx%s',
    v_game.mine_count,
    v_safe_picks,
    v_game.current_multiplier::text,
    case when v_bonus_xp > 0 then pg_catalog.format(' · +%s XP', v_bonus_xp) else '' end
  );

  insert into public.bets(user_id, game, bet, payout, delta, detail)
  values(v_user_id, 'Minas', v_game.stake, v_payout, v_payout - v_game.stake, v_detail);

  return jsonb_build_object(
    'outcome', 'cashout',
    'id', v_game.id,
    'stake', v_game.stake,
    'mine_count', v_game.mine_count,
    'opened_positions', v_game.opened_positions,
    'mine_positions', v_game.mine_positions,
    'safe_picks', v_safe_picks,
    'safe_total', 25 - v_game.mine_count,
    'current_multiplier', v_game.current_multiplier,
    'next_multiplier', null,
    'next_safe_probability', 0,
    'potential_payout', v_payout,
    'status', 'cashed',
    'payout', v_payout,
    'delta', v_payout - v_game.stake,
    'coins', v_balance,
    'bonus_xp', v_bonus_xp,
    'xp', v_new_xp,
    'max_payout', 5000
  );
end;
$$;

grant execute on function public.mines_calc_multiplier(integer, integer) to public;
grant execute on function public.mines_auth_user(text) to public;
grant execute on function public.mines_get_active(text) to public;
grant execute on function public.mines_start(text, integer, integer) to public;
grant execute on function public.mines_pick(text, integer) to public;
grant execute on function public.mines_cashout(text) to public;
