-- ============================================================
-- THE PEDRO & PACO CASINO V37.2 — CARRERAS
-- 7 coches · 1º x5 · 2º x3 · 3º x1 (devolución)
-- Carrera con ritmos por tramos para generar adelantamientos
-- sin perder la aleatoriedad uniforme del orden final.
-- ============================================================

ALTER TABLE public.race_players
  DROP CONSTRAINT IF EXISTS race_players_bet_car_check;

ALTER TABLE public.race_players
  ADD CONSTRAINT race_players_bet_car_check CHECK (bet_car BETWEEN 0 AND 6);

CREATE OR REPLACE FUNCTION public.race_build_plan()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  plan jsonb := '[{}, {}, {}, {}, {}, {}, {}]'::jsonb;
  order_arr integer[];
  segs jsonb;
  car integer;
  s integer;
  rank_no integer;
  finish_ms integer;
BEGIN
  -- Orden final uniforme: cada coche puede ocupar cualquier puesto.
  SELECT array_agg(n ORDER BY random()) INTO order_arr
  FROM generate_series(0,6) AS n;

  FOR rank_no IN 1..7 LOOP
    car := order_arr[rank_no];
    segs := '[]'::jsonb;

    -- Ventana final relativamente estrecha + ritmos variables por tramo.
    -- Esto permite adelantamientos visibles durante la carrera.
    finish_ms := 11500 + ((rank_no - 1) * 420) + floor(random() * 360)::integer;

    FOR s IN 0..17 LOOP
      segs := segs || jsonb_build_array(round((0.45 + random() * 1.30)::numeric,3));
    END LOOP;

    -- El índice coincide con el ID real del coche.
    plan := jsonb_set(
      plan,
      ARRAY[car::text],
      jsonb_build_object('finish_ms',finish_ms,'segments',segs),
      false
    );
  END LOOP;

  RETURN plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.race_finish_order(p_plan jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_agg(g.n ORDER BY (p_plan->g.n->>'finish_ms')::integer,g.n),
    '[]'::jsonb
  )
  FROM generate_series(0, greatest(0,jsonb_array_length(p_plan)-1)) AS g(n);
$$;

CREATE OR REPLACE FUNCTION public.race_max_finish_ms(p_plan jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    max((p_plan->x->>'finish_ms')::integer),
    18000
  )
  FROM generate_series(0, greatest(0,jsonb_array_length(p_plan)-1)) AS g(x);
$$;

CREATE OR REPLACE FUNCTION public.race_state_json(p_room public.race_rooms,p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_player_count integer;
  v_ready_count integer;
  v_bet_car smallint;
  v_bet_amount integer;
  v_payout integer;
  v_result text;
  v_positions jsonb := '[0,0,0,0,0,0,0]'::jsonb;
  v_order jsonb := coalesce(p_room.finish_order,'[]'::jsonb);
  v_elapsed bigint := 0;
  v_countdown bigint := 0;
  v_max_finish integer := 18000;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE bet_amount>0)
  INTO v_player_count,v_ready_count
  FROM public.race_players
  WHERE room_id=p_room.id;

  SELECT bet_car,bet_amount,payout,result
  INTO v_bet_car,v_bet_amount,v_payout,v_result
  FROM public.race_players
  WHERE room_id=p_room.id AND user_id=p_uid;

  IF p_room.status='countdown' AND p_room.race_started_at IS NOT NULL THEN
    v_countdown := greatest(0,floor(extract(epoch FROM (p_room.race_started_at-clock_timestamp()))*1000));
  ELSIF p_room.status='racing' AND p_room.race_started_at IS NOT NULL THEN
    v_elapsed := greatest(0,floor(extract(epoch FROM (clock_timestamp()-p_room.race_started_at))*1000));
    v_positions := coalesce((
      SELECT jsonb_agg(round(public.race_position(p_room.race_plan,g.n,v_elapsed),5) ORDER BY g.n)
      FROM generate_series(0,6) AS g(n)
    ),v_positions);
  ELSIF p_room.status='finished' AND p_room.race_plan IS NOT NULL THEN
    v_positions := '[1,1,1,1,1,1,1]'::jsonb;
  END IF;

  v_max_finish:=public.race_max_finish_ms(p_room.race_plan);

  RETURN jsonb_build_object(
    'id',p_room.id,
    'status',p_room.status,
    'host_id',p_room.host_id,
    'player_count',v_player_count,
    'ready_count',v_ready_count,
    'players',public.race_public_players(p_room.id,p_uid),
    'me',public.connect4_public_player(p_uid)||jsonb_build_object(
      'bet_car',v_bet_car,
      'bet_amount',coalesce(v_bet_amount,0),
      'has_bet',coalesce(v_bet_amount,0)>0,
      'payout',coalesce(v_payout,0),
      'result',v_result
    ),
    'race_started_at',p_room.race_started_at,
    'countdown_ms',v_countdown,
    'elapsed_ms',v_elapsed,
    'positions',v_positions,
    'finish_order',v_order,
    'max_finish_ms',v_max_finish,
    'winner_car',CASE WHEN jsonb_array_length(v_order)>=1 THEN (v_order->>0)::integer ELSE NULL END,
    'second_car',CASE WHEN jsonb_array_length(v_order)>=2 THEN (v_order->>1)::integer ELSE NULL END,
    'third_car',CASE WHEN jsonb_array_length(v_order)>=3 THEN (v_order->>2)::integer ELSE NULL END,
    'finished_at',p_room.finished_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.race_place_bet(p_token text,p_room_id uuid,p_car integer,p_amount integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  r public.race_rooms%rowtype;
  rp public.race_players%rowtype;
  v_coins integer;
  v_count integer;
  v_ready integer;
  v_plan jsonb;
  v_start timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_car IS NULL OR p_car<0 OR p_car>6 THEN RAISE EXCEPTION 'Coche inválido'; END IF;
  IF p_amount IS NULL OR p_amount<1 THEN RAISE EXCEPTION 'La apuesta debe ser de al menos 1 FP'; END IF;

  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La carrera ya no existe'; END IF;
  IF r.status<>'betting' THEN RAISE EXCEPTION 'Las apuestas no están abiertas'; END IF;

  SELECT * INTO rp FROM public.race_players
  WHERE room_id=r.id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No formas parte de esta carrera'; END IF;

  SELECT coins INTO v_coins FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;

  IF rp.bet_amount=p_amount AND rp.bet_car=p_car THEN
    UPDATE public.race_players SET last_seen_at=now()
    WHERE room_id=r.id AND user_id=v_uid;
    RETURN public.race_state_json(r,v_uid);
  END IF;

  IF rp.bet_amount>0 THEN v_coins:=v_coins+rp.bet_amount; END IF;
  IF v_coins<p_amount THEN RAISE EXCEPTION 'No tienes suficientes monedas para esa apuesta'; END IF;

  UPDATE public.profiles SET coins=v_coins-p_amount WHERE id=v_uid;
  UPDATE public.race_players
  SET bet_car=p_car,bet_amount=p_amount,payout=0,result=NULL,last_seen_at=now()
  WHERE room_id=r.id AND user_id=v_uid;

  SELECT count(*),count(*) FILTER (WHERE bet_amount>0)
  INTO v_count,v_ready
  FROM public.race_players
  WHERE room_id=r.id;

  IF v_count>=2 AND v_ready=v_count THEN
    v_plan:=public.race_build_plan();
    v_start:=clock_timestamp()+interval '3 seconds';
    UPDATE public.race_rooms
    SET status='countdown',race_plan=v_plan,race_started_at=v_start,
        finish_order=NULL,finished_at=NULL,updated_at=now()
    WHERE id=r.id
    RETURNING * INTO r;
  ELSE
    UPDATE public.race_rooms SET updated_at=now()
    WHERE id=r.id
    RETURNING * INTO r;
  END IF;

  RETURN public.race_state_json(r,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_settle_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.race_rooms%rowtype;
  rp public.race_players%rowtype;
  v_order jsonb;
  v_rank integer;
  v_payout integer;
  v_multiplier integer;
  v_car_name text;
  v_detail text;
BEGIN
  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('racing','countdown') OR r.race_plan IS NULL THEN RETURN; END IF;

  v_order:=public.race_finish_order(r.race_plan);

  UPDATE public.race_rooms
  SET status='finished',finish_order=v_order,finished_at=now(),updated_at=now()
  WHERE id=r.id;

  FOR rp IN SELECT * FROM public.race_players WHERE room_id=r.id FOR UPDATE LOOP
    SELECT x.ord::integer INTO v_rank
    FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS x(car,ord)
    WHERE x.car::integer=rp.bet_car
    LIMIT 1;

    v_multiplier:=CASE v_rank
      WHEN 1 THEN 5
      WHEN 2 THEN 3
      WHEN 3 THEN 1
      ELSE 0
    END;

    v_payout:=CASE WHEN rp.bet_amount>0 THEN rp.bet_amount*v_multiplier ELSE 0 END;

    v_car_name:=CASE rp.bet_car
      WHEN 0 THEN 'Coche 1'
      WHEN 1 THEN 'Coche 2'
      WHEN 2 THEN 'Coche 3'
      WHEN 3 THEN 'Coche 4'
      WHEN 4 THEN 'Coche 5'
      WHEN 5 THEN 'Coche 6'
      WHEN 6 THEN 'Coche 7'
      ELSE 'Sin coche'
    END;

    v_detail:=CASE
      WHEN v_rank=1 THEN v_car_name||' · 1º · x5'
      WHEN v_rank=2 THEN v_car_name||' · 2º · x3'
      WHEN v_rank=3 THEN v_car_name||' · 3º · x1 · devolución'
      ELSE v_car_name||' · fuera del podio'
    END;

    IF v_payout>0 THEN
      UPDATE public.profiles SET coins=coins+v_payout WHERE id=rp.user_id;
    END IF;

    UPDATE public.race_players
    SET payout=v_payout,result=v_detail
    WHERE room_id=rp.room_id AND user_id=rp.user_id;

    INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
    SELECT p.id,p.username,'Carreras',rp.bet_amount,v_payout,v_payout-rp.bet_amount,v_detail
    FROM public.profiles p
    WHERE p.id=rp.user_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.race_build_plan() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_position(jsonb,integer,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_finish_order(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_max_finish_ms(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_state_json(public.race_rooms,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_place_bet(text,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_settle_room(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_place_bet(text,uuid,integer,integer) TO anon,authenticated;
