-- ============================================================
-- DINOSAURIO — V34.0
-- Juego gratuito de recuperación de FP.
-- Solo se puede jugar con saldo < 15 FP y el saldo total nunca
-- puede superar 15 FP mediante este juego.
-- ============================================================

create table if not exists public.dinosaur_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  collected integer not null default 0 check (collected between 0 and 15),
  status text not null default 'active'
    check (status in ('active','crashed','capped','finished','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

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

  if v_coins >= 15 then
    raise exception 'El juego de recuperación solo está disponible con menos de 15 FP.';
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
      'available', greatest(0, 15 - v_coins)
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
    'available', greatest(0, 15 - v_coins)
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

  if v_coins >= 15 then
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
    'available', greatest(0, 15 - v_coins)
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

  if v_coins >= 15 or v_run.collected >= 15 then
    update public.dinosaur_runs
    set status = 'capped', updated_at = pg_catalog.now(), finished_at = pg_catalog.now()
    where id = v_run.id;

    return jsonb_build_object(
      'outcome', 'capped',
      'claimed', 0,
      'collected', v_run.collected,
      'coins', v_coins,
      'limit', 15
    );
  end if;

  v_claim := least(1, 15 - v_coins, 15 - v_run.collected);
  if v_claim <= 0 then
    update public.dinosaur_runs
    set status = 'capped', updated_at = pg_catalog.now(), finished_at = pg_catalog.now()
    where id = v_run.id;
    return jsonb_build_object('outcome','capped','claimed',0,'collected',v_run.collected,'coins',v_coins,'limit',15);
  end if;

  update public.profiles
  set coins = coins + v_claim
  where id = v_uid
  returning coins into v_new_coins;

  update public.dinosaur_runs
  set
    collected = collected + v_claim,
    status = case when v_new_coins >= 15 or collected + v_claim >= 15 then 'capped' else 'active' end,
    updated_at = pg_catalog.now(),
    finished_at = case when v_new_coins >= 15 or collected + v_claim >= 15 then pg_catalog.now() else null end
  where id = v_run.id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'claimed', v_claim,
    'collected', v_run.collected + v_claim,
    'coins', v_new_coins,
    'status', case when v_new_coins >= 15 or v_run.collected + v_claim >= 15 then 'capped' else 'active' end,
    'limit', 15
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
  return jsonb_build_object('status',v_status,'collected',coalesce(v_collected,0),'coins',v_coins,'limit',15);
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
