-- FODO CASINO — V35.12 GAME ECONOMY
-- Road Rush: max 100 FP
-- New profiles: 100 FP starting balance
-- Dinosaurio: recovery ceiling 30 FP

-- ============================================================
-- ROAD RUSH: max stake 100 FP
-- ============================================================
create or replace function public.road_rush_start(
  p_token text, p_bet integer, p_difficulty text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid; v_balance integer; v_game public.road_rush_games%rowtype; v_existing uuid; v_risk numeric;
begin
  v_user_id := public.road_rush_auth_user(p_token);
  if p_difficulty not in ('easy','normal','hard') then raise exception 'Dificultad no válida.'; end if;
  if p_bet is null or p_bet < 1 or p_bet > 100 then raise exception 'En Road Rush la apuesta debe estar entre 1 y 100 FP.'; end if;

  select id into v_existing from public.road_rush_games
  where user_id = v_user_id and status = 'active' limit 1;
  if v_existing is not null then raise exception 'Ya tienes una partida de Road Rush en curso.'; end if;

  update public.profiles set coins = coins - p_bet
  where id = v_user_id and coins >= p_bet
  returning coins into v_balance;
  if v_balance is null then raise exception 'No tienes suficientes FP para esa apuesta.'; end if;

  insert into public.road_rush_games(user_id, stake, difficulty)
  values(v_user_id, p_bet, p_difficulty) returning * into v_game;

  if p_difficulty = 'easy' then v_risk := 4;
  elsif p_difficulty = 'hard' then v_risk := 20;
  else v_risk := 12; end if;

  return jsonb_build_object(
    'id', v_game.id, 'stake', v_game.stake, 'difficulty', v_game.difficulty,
    'step', 0, 'multiplier', 1.0000, 'status', 'active', 'payout', 0,
    'risk', v_risk, 'coins', v_balance, 'max_steps', 10
  );
end;
$$;



grant execute on function public.road_rush_start(text, integer, text) to public;

-- ============================================================
-- DINOSAURIO: recovery ceiling 30 FP
-- Replaces the V34 implementation so the limit is enforced in SQL.
-- ============================================================
-- ============================================================
-- DINOSAURIO — V35.12
-- Juego gratuito de recuperación de FP.
-- Solo se puede jugar con saldo < 30 FP y el saldo total nunca
-- puede superar 30 FP mediante este juego.
-- ============================================================

create table if not exists public.dinosaur_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  collected integer not null default 0 check (collected between 0 and 30),
  status text not null default 'active'
    check (status in ('active','crashed','capped','finished','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Actualiza instalaciones existentes: el límite pasa de 15 a 30 FP.
alter table if exists public.dinosaur_runs
  drop constraint if exists dinosaur_runs_collected_check;
alter table if exists public.dinosaur_runs
  add constraint dinosaur_runs_collected_check check (collected between 0 and 30);

create unique index if not exists dinosaur_one_active_per_user
on public.dinosaur_runs(user_id)
where status = 'active';

create index if not exists dinosaur_user_created_idx
on public.dinosaur_runs(user_id, created_at desc);

alter table public.dinosaur_runs enable row level security;

create or replace function public.dinosaur_start(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_run public.dinosaur_runs%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida.'; end if;

  select coins into v_coins
  from public.profiles
  where id = v_uid
  for update;

  if v_coins is null then raise exception 'No existe tu perfil.'; end if;

  if v_coins >= 30 then
    raise exception 'El juego de recuperación solo está disponible con menos de 30 FP.';
  end if;

  select * into v_run
  from public.dinosaur_runs
  where user_id = v_uid and status = 'active'
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'run_id', v_run.id,
      'collected', v_run.collected,
      'coins', v_coins,
      'status', 'active',
      'available', greatest(0, 30 - v_coins)
    );
  end if;

  insert into public.dinosaur_runs(user_id, collected, status)
  values (v_uid, 0, 'active')
  returning * into v_run;

  return jsonb_build_object(
    'run_id', v_run.id,
    'collected', 0,
    'coins', v_coins,
    'status', 'active',
    'available', greatest(0, 30 - v_coins)
  );
end;
$$;

create or replace function public.dinosaur_get_active(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_run public.dinosaur_runs%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida.'; end if;

  select coins into v_coins
  from public.profiles
  where id = v_uid
  for update;

  if v_coins is null then raise exception 'No existe tu perfil.'; end if;

  select * into v_run
  from public.dinosaur_runs
  where user_id = v_uid and status = 'active'
  order by created_at desc
  limit 1;

  if not found then return null; end if;

  if v_coins >= 30 then
    update public.dinosaur_runs
    set status = 'capped', updated_at = pg_catalog.now(), finished_at = pg_catalog.now()
    where id = v_run.id;
    return null;
  end if;

  return jsonb_build_object(
    'run_id', v_run.id,
    'collected', v_run.collected,
    'coins', v_coins,
    'status', 'active',
    'available', greatest(0, 30 - v_coins)
  );
end;
$$;

create or replace function public.dinosaur_claim(
  p_token text,
  p_run_id uuid,
  p_amount integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_run public.dinosaur_runs%rowtype;
  v_coins integer;
  v_claim integer;
  v_new_coins integer;
begin
  if v_uid is null then raise exception 'Sesión no válida.'; end if;
  if p_amount is null or p_amount <> 1 then raise exception 'Solo se puede reclamar una moneda por acción.'; end if;

  select * into v_run
  from public.dinosaur_runs
  where id = p_run_id and user_id = v_uid
  for update;

  if not found then raise exception 'Carrera no encontrada.'; end if;
  if v_run.status <> 'active' then raise exception 'La carrera ya ha terminado.'; end if;

  select coins into v_coins
  from public.profiles
  where id = v_uid
  for update;

  if v_coins is null then raise exception 'No existe tu perfil.'; end if;

  if v_coins >= 30 or v_run.collected >= 30 then
    update public.dinosaur_runs
    set status = 'capped', updated_at = pg_catalog.now(), finished_at = pg_catalog.now()
    where id = v_run.id;

    return jsonb_build_object(
      'outcome', 'capped',
      'claimed', 0,
      'collected', v_run.collected,
      'coins', v_coins,
      'limit', 30
    );
  end if;

  v_claim := least(1, 30 - v_coins, 30 - v_run.collected);
  if v_claim <= 0 then
    update public.dinosaur_runs
    set status = 'capped', updated_at = pg_catalog.now(), finished_at = pg_catalog.now()
    where id = v_run.id;
    return jsonb_build_object('outcome','capped','claimed',0,'collected',v_run.collected,'coins',v_coins,'limit',30);
  end if;

  update public.profiles
  set coins = coins + v_claim
  where id = v_uid
  returning coins into v_new_coins;

  update public.dinosaur_runs
  set
    collected = collected + v_claim,
    status = case when v_new_coins >= 30 or collected + v_claim >= 30 then 'capped' else 'active' end,
    updated_at = pg_catalog.now(),
    finished_at = case when v_new_coins >= 30 or collected + v_claim >= 30 then pg_catalog.now() else null end
  where id = v_run.id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'claimed', v_claim,
    'collected', v_run.collected + v_claim,
    'coins', v_new_coins,
    'status', case when v_new_coins >= 30 or v_run.collected + v_claim >= 30 then 'capped' else 'active' end,
    'limit', 30
  );
end;
$$;

create or replace function public.dinosaur_finish(
  p_token text,
  p_run_id uuid,
  p_reason text default 'finished'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_status text;
  v_coins integer;
  v_collected integer;
begin
  if v_uid is null then raise exception 'Sesión no válida.'; end if;

  v_status := case
    when p_reason = 'capped' then 'capped'
    when p_reason = 'crash' then 'crashed'
    when p_reason = 'error' then 'error'
    else 'finished'
  end;

  update public.dinosaur_runs
  set status = case when status = 'active' then v_status else status end,
      updated_at = pg_catalog.now(),
      finished_at = case when status = 'active' then pg_catalog.now() else finished_at end
  where id = p_run_id and user_id = v_uid
  returning collected into v_collected;

  if not found then raise exception 'Carrera no encontrada.'; end if;

  select coins into v_coins from public.profiles where id = v_uid;
  return jsonb_build_object('status',v_status,'collected',coalesce(v_collected,0),'coins',v_coins,'limit',30);
end;
$$;

revoke all on function public.dinosaur_start(text) from public, anon, authenticated;
revoke all on function public.dinosaur_get_active(text) from public, anon, authenticated;
revoke all on function public.dinosaur_claim(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.dinosaur_finish(text, uuid, text) from public, anon, authenticated;
grant execute on function public.dinosaur_start(text) to anon;
grant execute on function public.dinosaur_get_active(text) to anon;
grant execute on function public.dinosaur_claim(text, uuid, integer) to anon;
grant execute on function public.dinosaur_finish(text, uuid, text) to anon;

notify pgrst, 'reload schema';


-- ============================================================
-- NEW ACCOUNTS: start with 100 FP
-- The existing register_account function inserts the profile; this trigger
-- guarantees the initial balance is at least 100 FP for newly-created profiles.
-- It only fires on INSERT, never on normal balance updates.
-- ============================================================
create or replace function public.ensure_new_profile_start_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.coins is null or new.coins < 100 then
    new.coins := 100;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_new_profile_start_balance on public.profiles;
create trigger trg_new_profile_start_balance
before insert on public.profiles
for each row
execute function public.ensure_new_profile_start_balance();

comment on function public.ensure_new_profile_start_balance()
is 'V35.12: newly created profiles start with at least 100 FP.';
