-- ============================================================
-- ROAD RUSH
-- Juego individual: coche que cruza 10 tramos.
-- El saldo, el riesgo y el resultado se resuelven en servidor.
-- ============================================================

create table if not exists public.road_rush_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stake integer not null check (stake > 0),
  difficulty text not null check (difficulty in ('easy','normal','hard')),
  step integer not null default 0 check (step between 0 and 10),
  multiplier numeric(10,4) not null default 1.0000,
  status text not null default 'active' check (status in ('active','crashed','cashed','won')),
  payout integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists road_rush_one_active_per_user
on public.road_rush_games(user_id)
where status = 'active';

create index if not exists road_rush_user_created_idx
on public.road_rush_games(user_id, created_at desc);

alter table public.road_rush_games enable row level security;

-- El cliente no necesita acceso directo a las filas. Las operaciones pasan por RPC.

create or replace function public.road_rush_auth_user(p_token text)
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

create or replace function public.road_rush_get_active(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.road_rush_games%rowtype;
  v_risk numeric;
  v_multipliers numeric[];
begin
  v_user_id := public.road_rush_auth_user(p_token);

  select *
  into v_game
  from public.road_rush_games
  where user_id = v_user_id
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  if v_game.difficulty = 'easy' then
    v_risk := 10;
    v_multipliers := array[1.05,1.14,1.24,1.36,1.50,1.66,1.84,2.05,2.28,2.55]::numeric[];
  elsif v_game.difficulty = 'hard' then
    v_risk := 28;
    v_multipliers := array[1.18,1.44,1.76,2.15,2.63,3.22,3.94,4.82,5.90,7.22]::numeric[];
  else
    v_risk := 18;
    v_multipliers := array[1.10,1.31,1.56,1.86,2.22,2.65,3.16,3.76,4.48,5.33]::numeric[];
  end if;

  return jsonb_build_object(
    'id', v_game.id,
    'stake', v_game.stake,
    'difficulty', v_game.difficulty,
    'step', v_game.step,
    'multiplier', v_game.multiplier,
    'status', v_game.status,
    'payout', v_game.payout,
    'risk', v_risk,
    'next_multiplier', v_multipliers[least(v_game.step + 1, 10)],
    'max_multiplier', v_multipliers[10],
    'max_steps', 10
  );
end;
$$;

create or replace function public.road_rush_start(
  p_token text,
  p_bet integer,
  p_difficulty text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_balance integer;
  v_game public.road_rush_games%rowtype;
  v_existing uuid;
  v_risk numeric;
begin
  v_user_id := public.road_rush_auth_user(p_token);

  if p_difficulty not in ('easy','normal','hard') then
    raise exception 'Dificultad no válida.';
  end if;

  if p_bet is null or p_bet < 1 then
    raise exception 'La apuesta mínima es 1 FP.';
  end if;

  select id
  into v_existing
  from public.road_rush_games
  where user_id = v_user_id and status = 'active'
  limit 1;

  if v_existing is not null then
    raise exception 'Ya tienes una partida de Road Rush en curso.';
  end if;

  update public.profiles
  set coins = coins - p_bet
  where id = v_user_id
    and coins >= p_bet
  returning coins into v_balance;

  if v_balance is null then
    raise exception 'No tienes suficientes FP para esa apuesta.';
  end if;

  insert into public.road_rush_games(user_id, stake, difficulty)
  values (v_user_id, p_bet, p_difficulty)
  returning * into v_game;

  if p_difficulty = 'easy' then
    v_risk := 10;
  elsif p_difficulty = 'hard' then
    v_risk := 28;
  else
    v_risk := 18;
  end if;

  return jsonb_build_object(
    'id', v_game.id,
    'stake', v_game.stake,
    'difficulty', v_game.difficulty,
    'step', 0,
    'multiplier', 1.0000,
    'status', 'active',
    'payout', 0,
    'risk', v_risk,
    'coins', v_balance,
    'max_steps', 10
  );
end;
$$;

create or replace function public.road_rush_step(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.road_rush_games%rowtype;
  v_next_step integer;
  v_risk numeric;
  v_crash boolean;
  v_multiplier numeric;
  v_multipliers numeric[];
  v_payout integer;
  v_balance integer;
  v_detail text;
begin
  v_user_id := public.road_rush_auth_user(p_token);

  select *
  into v_game
  from public.road_rush_games
  where user_id = v_user_id and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tienes una partida activa.';
  end if;

  v_next_step := v_game.step + 1;
  if v_next_step > 10 then
    raise exception 'La partida ya ha llegado al final.';
  end if;

  if v_game.difficulty = 'easy' then
    v_risk := 0.10;
    v_multipliers := array[1.05,1.14,1.24,1.36,1.50,1.66,1.84,2.05,2.28,2.55]::numeric[];
  elsif v_game.difficulty = 'hard' then
    v_risk := 0.28;
    v_multipliers := array[1.18,1.44,1.76,2.15,2.63,3.22,3.94,4.82,5.90,7.22]::numeric[];
  else
    v_risk := 0.18;
    v_multipliers := array[1.10,1.31,1.56,1.86,2.22,2.65,3.16,3.76,4.48,5.33]::numeric[];
  end if;

  v_crash := pg_catalog.random() < v_risk;

  if v_crash then
    v_detail := format('Road Rush · %s · choque en cruce %s/%s', v_game.difficulty, v_next_step, 10);

    update public.road_rush_games rg
    set step = v_next_step,
        multiplier = 0,
        status = 'crashed',
        payout = 0,
        updated_at = now()
    where rg.id = v_game.id
    returning * into v_game;

    insert into public.bets(user_id, game, bet, payout, delta, detail)
    values(v_user_id, 'Road Rush', v_game.stake, 0, -v_game.stake, v_detail);

    select coins into v_balance from public.profiles where id = v_user_id;

    return jsonb_build_object(
      'outcome', 'crash',
      'id', v_game.id,
      'stake', v_game.stake,
      'difficulty', v_game.difficulty,
      'step', v_next_step,
      'multiplier', 0,
      'status', 'crashed',
      'payout', 0,
      'delta', -v_game.stake,
      'coins', v_balance,
      'risk', round(v_risk * 100),
      'max_steps', 10
    );
  end if;

  v_multiplier := v_multipliers[v_next_step];
  v_payout := pg_catalog.floor(v_game.stake * v_multiplier);

  if v_next_step = 10 then
    update public.road_rush_games rg
    set step = 10,
        multiplier = v_multiplier,
        status = 'won',
        payout = v_payout,
        updated_at = now()
    where rg.id = v_game.id
    returning * into v_game;

    update public.profiles
    set coins = coins + v_payout
    where id = v_user_id
    returning coins into v_balance;

    v_detail := format('Road Rush · %s · META · %sx', v_game.difficulty, v_multiplier::text);

    insert into public.bets(user_id, game, bet, payout, delta, detail)
    values(v_user_id, 'Road Rush', v_game.stake, v_payout, v_payout - v_game.stake, v_detail);

    return jsonb_build_object(
      'outcome', 'safe',
      'id', v_game.id,
      'stake', v_game.stake,
      'difficulty', v_game.difficulty,
      'step', 10,
      'multiplier', v_multiplier,
      'status', 'won',
      'payout', v_payout,
      'delta', v_payout - v_game.stake,
      'coins', v_balance,
      'risk', round(v_risk * 100),
      'max_steps', 10
    );
  end if;

  update public.road_rush_games rg
  set step = v_next_step,
      multiplier = v_multiplier,
      updated_at = now()
  where rg.id = v_game.id;

  select coins into v_balance from public.profiles where id = v_user_id;

  return jsonb_build_object(
    'outcome', 'safe',
    'id', v_game.id,
    'stake', v_game.stake,
    'difficulty', v_game.difficulty,
    'step', v_next_step,
    'multiplier', v_multiplier,
    'status', 'active',
    'potential_payout', v_payout,
    'payout', 0,
    'delta', 0,
    'coins', v_balance,
    'risk', round(v_risk * 100),
    'next_multiplier', v_multipliers[v_next_step + 1],
    'max_multiplier', v_multipliers[10],
    'max_steps', 10
  );
end;
$$;

create or replace function public.road_rush_cashout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.road_rush_games%rowtype;
  v_payout integer;
  v_balance integer;
  v_detail text;
begin
  v_user_id := public.road_rush_auth_user(p_token);

  select *
  into v_game
  from public.road_rush_games
  where user_id = v_user_id and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tienes una partida activa.';
  end if;

  if v_game.step < 1 then
    raise exception 'Primero debes superar al menos un cruce.';
  end if;

  v_payout := pg_catalog.floor(v_game.stake * v_game.multiplier);

  update public.profiles
  set coins = coins + v_payout
  where id = v_user_id
  returning coins into v_balance;

  update public.road_rush_games rg
  set status = 'cashed',
      payout = v_payout,
      updated_at = now()
  where rg.id = v_game.id
  returning * into v_game;

  v_detail := format('Road Rush · %s · cobro en cruce %s/%s · %sx', v_game.difficulty, v_game.step, 10, v_game.multiplier::text);

  insert into public.bets(user_id, game, bet, payout, delta, detail)
  values(v_user_id, 'Road Rush', v_game.stake, v_payout, v_payout - v_game.stake, v_detail);

  return jsonb_build_object(
    'outcome', 'cashout',
    'id', v_game.id,
    'stake', v_game.stake,
    'difficulty', v_game.difficulty,
    'step', v_game.step,
    'multiplier', v_game.multiplier,
    'status', 'cashed',
    'payout', v_payout,
    'delta', v_payout - v_game.stake,
    'coins', v_balance,
    'risk', case v_game.difficulty when 'easy' then 10 when 'hard' then 28 else 18 end,
    'max_steps', 10
  );
end;
$$;

grant execute on function public.road_rush_get_active(text) to public;
grant execute on function public.road_rush_start(text, integer, text) to public;
grant execute on function public.road_rush_step(text) to public;
grant execute on function public.road_rush_cashout(text) to public;
