-- ROAD RUSH: balance inspirado en los perfiles de riesgo publicados de Chicken Road
-- Easy 4%, Medium 12%, Hard 20% por cruce.
-- Los multiplicadores de 10 pasos mantienen un RTP teórico aproximado del 98% bajo
-- un modelo simple de riesgo constante por paso.

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

  select * into v_game
  from public.road_rush_games
  where user_id = v_user_id and status = 'active'
  order by created_at desc
  limit 1;

  if not found then return null; end if;

  if v_game.difficulty = 'easy' then
    v_risk := 4;
    v_multipliers := array[1.02,1.06,1.11,1.15,1.20,1.25,1.30,1.36,1.42,1.47]::numeric[];
  elsif v_game.difficulty = 'hard' then
    v_risk := 20;
    v_multipliers := array[1.22,1.53,1.91,2.39,2.99,3.74,4.67,5.84,7.30,9.13]::numeric[];
  else
    v_risk := 12;
    v_multipliers := array[1.11,1.27,1.44,1.63,1.86,2.11,2.40,2.72,3.10,3.52]::numeric[];
  end if;

  return jsonb_build_object(
    'id', v_game.id, 'stake', v_game.stake, 'difficulty', v_game.difficulty,
    'step', v_game.step, 'multiplier', v_game.multiplier, 'status', v_game.status,
    'payout', v_game.payout, 'risk', v_risk,
    'next_multiplier', v_multipliers[least(v_game.step + 1, 10)],
    'max_multiplier', v_multipliers[10], 'max_steps', 10
  );
end;
$$;

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
  if p_bet is null or p_bet < 1 then raise exception 'La apuesta mínima es 1 FP.'; end if;

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

create or replace function public.road_rush_step(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid; v_game public.road_rush_games%rowtype; v_next_step integer;
  v_risk numeric; v_crash boolean; v_multiplier numeric; v_multipliers numeric[];
  v_payout integer; v_balance integer; v_detail text;
begin
  v_user_id := public.road_rush_auth_user(p_token);
  select * into v_game from public.road_rush_games
  where user_id = v_user_id and status = 'active'
  order by created_at desc limit 1 for update;
  if not found then raise exception 'No tienes una partida activa.'; end if;

  v_next_step := v_game.step + 1;
  if v_next_step > 10 then raise exception 'La partida ya ha llegado al final.'; end if;

  if v_game.difficulty = 'easy' then
    v_risk := 0.04;
    v_multipliers := array[1.02,1.06,1.11,1.15,1.20,1.25,1.30,1.36,1.42,1.47]::numeric[];
  elsif v_game.difficulty = 'hard' then
    v_risk := 0.20;
    v_multipliers := array[1.22,1.53,1.91,2.39,2.99,3.74,4.67,5.84,7.30,9.13]::numeric[];
  else
    v_risk := 0.12;
    v_multipliers := array[1.11,1.27,1.44,1.63,1.86,2.11,2.40,2.72,3.10,3.52]::numeric[];
  end if;

  v_crash := pg_catalog.random() < v_risk;

  if v_crash then
    v_detail := format('Road Rush · %s · choque en cruce %s/%s', v_game.difficulty, v_next_step, 10);
    update public.road_rush_games rg set step=v_next_step, multiplier=0, status='crashed', payout=0, updated_at=now()
    where rg.id=v_game.id returning * into v_game;
    insert into public.bets(user_id,game,bet,payout,delta,detail) values(v_user_id,'Road Rush',v_game.stake,0,-v_game.stake,v_detail);
    select coins into v_balance from public.profiles where id=v_user_id;
    return jsonb_build_object('outcome','crash','id',v_game.id,'stake',v_game.stake,'difficulty',v_game.difficulty,
      'step',v_next_step,'multiplier',0,'status','crashed','payout',0,'delta',-v_game.stake,'coins',v_balance,
      'risk',round(v_risk*100),'max_steps',10);
  end if;

  v_multiplier := v_multipliers[v_next_step];
  v_payout := pg_catalog.floor(v_game.stake * v_multiplier);

  if v_next_step = 10 then
    update public.road_rush_games rg set step=10,multiplier=v_multiplier,status='won',payout=v_payout,updated_at=now()
    where rg.id=v_game.id returning * into v_game;
    update public.profiles set coins=coins+v_payout where id=v_user_id returning coins into v_balance;
    v_detail := format('Road Rush · %s · META · %sx',v_game.difficulty,v_multiplier::text);
    insert into public.bets(user_id,game,bet,payout,delta,detail) values(v_user_id,'Road Rush',v_game.stake,v_payout,v_payout-v_game.stake,v_detail);
    return jsonb_build_object('outcome','safe','id',v_game.id,'stake',v_game.stake,'difficulty',v_game.difficulty,
      'step',10,'multiplier',v_multiplier,'status','won','payout',v_payout,'delta',v_payout-v_game.stake,'coins',v_balance,
      'risk',round(v_risk*100),'max_steps',10);
  end if;

  update public.road_rush_games rg set step=v_next_step,multiplier=v_multiplier,updated_at=now() where rg.id=v_game.id;
  select coins into v_balance from public.profiles where id=v_user_id;
  return jsonb_build_object('outcome','safe','id',v_game.id,'stake',v_game.stake,'difficulty',v_game.difficulty,
    'step',v_next_step,'multiplier',v_multiplier,'status','active','potential_payout',v_payout,'payout',0,'delta',0,'coins',v_balance,
    'risk',round(v_risk*100),'next_multiplier',v_multipliers[v_next_step+1],'max_multiplier',v_multipliers[10],'max_steps',10);
end;
$$;

-- Actualiza el cobro para mostrar el riesgo vigente de cada dificultad.
create or replace function public.road_rush_cashout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid; v_game public.road_rush_games%rowtype; v_payout integer; v_balance integer; v_detail text; v_risk integer;
begin
  v_user_id := public.road_rush_auth_user(p_token);
  select * into v_game from public.road_rush_games
  where user_id=v_user_id and status='active' order by created_at desc limit 1 for update;
  if not found then raise exception 'No tienes una partida activa.'; end if;
  if v_game.step < 1 then raise exception 'Primero debes superar al menos un cruce.'; end if;
  v_payout := pg_catalog.floor(v_game.stake * v_game.multiplier);
  update public.profiles set coins=coins+v_payout where id=v_user_id returning coins into v_balance;
  update public.road_rush_games rg set status='cashed',payout=v_payout,updated_at=now() where rg.id=v_game.id returning * into v_game;
  v_detail := format('Road Rush · %s · cobro en cruce %s/%s · %sx',v_game.difficulty,v_game.step,10,v_game.multiplier::text);
  insert into public.bets(user_id,game,bet,payout,delta,detail) values(v_user_id,'Road Rush',v_game.stake,v_payout,v_payout-v_game.stake,v_detail);
  v_risk := case v_game.difficulty when 'easy' then 4 when 'hard' then 20 else 12 end;
  return jsonb_build_object('outcome','cashout','id',v_game.id,'stake',v_game.stake,'difficulty',v_game.difficulty,
    'step',v_game.step,'multiplier',v_game.multiplier,'status','cashed','payout',v_payout,'delta',v_payout-v_game.stake,
    'coins',v_balance,'risk',v_risk,'max_steps',10);
end;
$$;

grant execute on function public.road_rush_get_active(text) to public;
grant execute on function public.road_rush_start(text, integer, text) to public;
grant execute on function public.road_rush_step(text) to public;
grant execute on function public.road_rush_cashout(text) to public;
