-- ============================================================
-- FODO CASINO — V35.11 BET LIMITS
-- Higher / Lower: max 150 FP
-- Minas: max 50 FP
-- ============================================================

-- Minas: allow stakes up to 50 FP.
alter table if exists public.mines_games
  drop constraint if exists mines_games_stake_check;

alter table if exists public.mines_games
  add constraint mines_games_stake_check check (stake between 1 and 50);

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

  if p_bet is null or p_bet < 1 or p_bet > 50 then
    raise exception 'En Minas la apuesta debe estar entre 1 y 50 FP.';
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


-- Higher / Lower: the client uses this wrapper so the server also enforces
-- the 150 FP cap before calling the existing game implementation.
create or replace function public.hilo_start_limited(
  p_token text,
  p_bet integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_bet is null or p_bet < 1 or p_bet > 150 then
    raise exception 'En Higher / Lower la apuesta debe estar entre 1 y 150 FP.';
  end if;

  return public.hilo_start(p_token, p_bet);
end;
$$;

revoke execute on function public.hilo_start(text, integer) from public;
grant execute on function public.hilo_start_limited(text, integer) to public;

comment on function public.hilo_start_limited(text, integer)
is 'V35.11: Higher / Lower max 150 FP.';
