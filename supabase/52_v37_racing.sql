-- ============================================================
-- THE PEDRO & PACO CASINO V37 — CARRERAS MULTIJUGADOR
-- 6 coches · salas · apuestas individuales sin limite de juego
-- (solo limitadas por el saldo real del jugador) · Top 3:
-- 1º x10 · 2º x3 · 3º x2.
--
-- El servidor es autoritativo para salas, apuestas, orden de llegada
-- y liquidacion. La carrera se reproduce en el cliente a partir de un
-- plan generado y guardado en Supabase, por lo que todos ven el mismo
-- resultado y no depende de que un navegador permanezca abierto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.race_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','betting','countdown','racing','finished')),
  race_started_at timestamptz,
  finished_at timestamptz,
  race_plan jsonb,
  finish_order jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.race_players (
  room_id uuid NOT NULL REFERENCES public.race_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet_car smallint CHECK (bet_car BETWEEN 0 AND 5),
  bet_amount integer NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
  payout integer NOT NULL DEFAULT 0 CHECK (payout >= 0),
  result text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id,user_id)
);

ALTER TABLE public.race_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_players ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS race_rooms_waiting_idx
  ON public.race_rooms(status, created_at DESC) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS race_rooms_host_idx
  ON public.race_rooms(host_id, status);
CREATE INDEX IF NOT EXISTS race_players_room_idx
  ON public.race_players(room_id, joined_at);
CREATE INDEX IF NOT EXISTS race_players_user_idx
  ON public.race_players(user_id, last_seen_at DESC);

CREATE OR REPLACE FUNCTION public.race_build_plan()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  plan jsonb := '[]'::jsonb;
  segs jsonb;
  car integer;
  s integer;
  finish_ms integer;
BEGIN
  FOR car IN 0..5 LOOP
    segs := '[]'::jsonb;
    finish_ms := 12000 + floor(random() * 6001)::integer;

    FOR s IN 0..11 LOOP
      segs := segs || jsonb_build_array(round((0.78 + random() * 0.44)::numeric,3));
    END LOOP;

    plan := plan || jsonb_build_array(
      jsonb_build_object(
        'finish_ms', finish_ms,
        'segments', segs
      )
    );
  END LOOP;

  RETURN plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.race_position(p_plan jsonb, p_car integer, p_elapsed_ms bigint)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  segs jsonb;
  finish_ms numeric;
  seg_count integer;
  seg_duration numeric;
  elapsed numeric;
  seg_index integer;
  within_seg numeric;
  total_factor numeric := 0;
  done_factor numeric := 0;
  current_factor numeric := 1;
  i integer;
BEGIN
  IF p_plan IS NULL OR p_car < 0 OR p_car > 5 THEN RETURN 0; END IF;
  item := p_plan->p_car;
  IF item IS NULL THEN RETURN 0; END IF;

  finish_ms := greatest(1,coalesce((item->>'finish_ms')::numeric,15000));
  segs := coalesce(item->'segments','[]'::jsonb);
  seg_count := greatest(1,jsonb_array_length(segs));
  seg_duration := finish_ms / seg_count;
  elapsed := greatest(0,least(finish_ms,coalesce(p_elapsed_ms,0)::numeric));

  FOR i IN 0..seg_count-1 LOOP
    total_factor := total_factor + coalesce((segs->>i)::numeric,1);
  END LOOP;
  IF total_factor <= 0 THEN total_factor := seg_count; END IF;

  seg_index := least(seg_count-1,floor(elapsed / seg_duration)::integer);
  IF elapsed >= finish_ms THEN
    RETURN 1;
  END IF;

  FOR i IN 0..seg_index-1 LOOP
    done_factor := done_factor + coalesce((segs->>i)::numeric,1);
  END LOOP;
  current_factor := coalesce((segs->>seg_index)::numeric,1);
  within_seg := elapsed - (seg_index * seg_duration);

  RETURN least(1,greatest(0,
    (done_factor + current_factor * (within_seg / seg_duration)) / total_factor
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.race_finish_order(p_plan jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_agg(g.n ORDER BY (p_plan->g.n->>'finish_ms')::integer, g.n),
    '[]'::jsonb
  )
  FROM generate_series(0,5) AS g(n);
$$;

CREATE OR REPLACE FUNCTION public.race_max_finish_ms(p_plan jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(max((p_plan->g->>'finish_ms')::integer),18000)
  FROM generate_series(0,5) AS x(g);
$$;

CREATE OR REPLACE FUNCTION public.race_public_players(p_room_id uuid,p_uid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(
    public.connect4_public_player(rp.user_id)
      || jsonb_build_object(
        'bet_car',CASE WHEN rp.user_id=p_uid THEN rp.bet_car ELSE NULL END,
        'bet_amount',CASE WHEN rp.user_id=p_uid THEN rp.bet_amount ELSE 0 END,
        'has_bet',rp.bet_amount > 0,
        'online',rp.last_seen_at > now()-interval '25 seconds',
        'joined_at',rp.joined_at
      )
    ORDER BY rp.joined_at
  ),'[]'::jsonb)
  FROM public.race_players rp
  WHERE rp.room_id=p_room_id;
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
  v_positions jsonb := '[0,0,0,0,0,0]'::jsonb;
  v_order jsonb := coalesce(p_room.finish_order,'[]'::jsonb);
  v_elapsed bigint := 0;
  v_countdown bigint := 0;
  v_max_finish integer := 18000;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE bet_amount>0)
  INTO v_player_count,v_ready_count
  FROM public.race_players
  WHERE room_id=p_room.id;

  SELECT bet_car,bet_amount
  INTO v_bet_car,v_bet_amount
  FROM public.race_players
  WHERE room_id=p_room.id AND user_id=p_uid;

  IF p_room.status='countdown' AND p_room.race_started_at IS NOT NULL THEN
    v_countdown := greatest(0,floor(extract(epoch FROM (p_room.race_started_at-clock_timestamp()))*1000));
  ELSIF p_room.status='racing' AND p_room.race_started_at IS NOT NULL THEN
    v_elapsed := greatest(0,floor(extract(epoch FROM (clock_timestamp()-p_room.race_started_at))*1000));
    v_positions := coalesce((
      SELECT jsonb_agg(round(public.race_position(p_room.race_plan,g.n,v_elapsed),5) ORDER BY g.n)
      FROM generate_series(0,5) AS g(n)
    ),v_positions);
  ELSIF p_room.status='finished' AND p_room.race_plan IS NOT NULL THEN
    v_positions := '[1,1,1,1,1,1]'::jsonb;
  END IF;

  v_max_finish := public.race_max_finish_ms(p_room.race_plan);

  RETURN jsonb_build_object(
    'id',p_room.id,
    'status',p_room.status,
    'host_id',p_room.host_id,
    'player_count',v_player_count,
    'ready_count',v_ready_count,
    'players',public.race_public_players(p_room.id,p_uid),
    'me',public.connect4_public_player(p_uid) || jsonb_build_object(
      'bet_car',v_bet_car,
      'bet_amount',coalesce(v_bet_amount,0),
      'has_bet',coalesce(v_bet_amount,0)>0,
      'payout',coalesce((select payout from public.race_players where room_id=p_room.id and user_id=p_uid),0),
      'result',(select result from public.race_players where room_id=p_room.id and user_id=p_uid)
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

CREATE OR REPLACE FUNCTION public.race_refund_room_players(p_room_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.profiles p
  SET coins=p.coins+s.total_bet
  FROM (
    SELECT user_id,sum(bet_amount)::integer AS total_bet
    FROM public.race_players
    WHERE room_id=p_room_id AND bet_amount>0
    GROUP BY user_id
  ) s
  WHERE p.id=s.user_id;

  UPDATE public.race_players
  SET bet_amount=0,bet_car=NULL,payout=0,result=NULL
  WHERE room_id=p_room_id;
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
  v_coins integer;
BEGIN
  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('racing','countdown') OR r.race_plan IS NULL THEN RETURN; END IF;

  v_order := public.race_finish_order(r.race_plan);

  UPDATE public.race_rooms
  SET status='finished',finish_order=v_order,finished_at=now(),updated_at=now()
  WHERE id=r.id;

  FOR rp IN SELECT * FROM public.race_players WHERE room_id=r.id FOR UPDATE LOOP
    SELECT x.ord::integer
    INTO v_rank
    FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS x(car,ord)
    WHERE x.car::integer=rp.bet_car
    LIMIT 1;

    v_multiplier := CASE v_rank WHEN 1 THEN 10 WHEN 2 THEN 3 WHEN 3 THEN 2 ELSE 0 END;
    v_payout := CASE WHEN rp.bet_amount>0 THEN rp.bet_amount*v_multiplier ELSE 0 END;
    v_car_name := CASE rp.bet_car
      WHEN 0 THEN 'Coche 1' WHEN 1 THEN 'Coche 2' WHEN 2 THEN 'Coche 3'
      WHEN 3 THEN 'Coche 4' WHEN 4 THEN 'Coche 5' WHEN 5 THEN 'Coche 6'
      ELSE 'Sin coche' END;

    v_detail := CASE
      WHEN v_rank=1 THEN v_car_name||' · 1º · x10'
      WHEN v_rank=2 THEN v_car_name||' · 2º · x3'
      WHEN v_rank=3 THEN v_car_name||' · 3º · x2'
      ELSE v_car_name||' · fuera del podio'
    END;

    IF v_payout>0 THEN
      UPDATE public.profiles SET coins=coins+v_payout WHERE id=rp.user_id;
    END IF;

    UPDATE public.race_players
    SET payout=v_payout,
        result=v_detail
    WHERE room_id=rp.room_id AND user_id=rp.user_id;

    SELECT coins INTO v_coins FROM public.profiles WHERE id=rp.user_id;

    INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
    SELECT p.id,p.username,'Carreras',rp.bet_amount,v_payout,v_payout-rp.bet_amount,v_detail
    FROM public.profiles p
    WHERE p.id=rp.user_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.race_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.race_rooms%rowtype;
  v_age interval;
  v_elapsed bigint;
BEGIN
  FOR r IN SELECT * FROM public.race_rooms WHERE status='countdown' FOR UPDATE LOOP
    IF r.race_started_at IS NOT NULL AND r.race_started_at <= clock_timestamp() THEN
      UPDATE public.race_rooms SET status='racing',updated_at=now() WHERE id=r.id AND status='countdown';
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM public.race_rooms WHERE status='racing' FOR UPDATE LOOP
    IF r.race_started_at IS NULL OR r.race_plan IS NULL THEN
      PERFORM public.race_refund_room_players(r.id);
      DELETE FROM public.race_rooms WHERE id=r.id;
    ELSE
      v_elapsed:=floor(extract(epoch FROM (clock_timestamp()-r.race_started_at))*1000);
      IF v_elapsed >= public.race_max_finish_ms(r.race_plan)+900 THEN
        PERFORM public.race_settle_room(r.id);
      END IF;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM public.race_rooms WHERE status='waiting' AND created_at < now()-interval '20 minutes' LOOP
    DELETE FROM public.race_rooms WHERE id=r.id;
  END LOOP;

  FOR r IN SELECT * FROM public.race_rooms WHERE status='betting' AND created_at < now()-interval '20 minutes' FOR UPDATE LOOP
    PERFORM public.race_refund_room_players(r.id);
    DELETE FROM public.race_rooms WHERE id=r.id;
  END LOOP;

  FOR r IN SELECT * FROM public.race_rooms WHERE status='finished' AND finished_at < now()-interval '20 minutes' LOOP
    DELETE FROM public.race_rooms WHERE id=r.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.race_start_room(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  v_room public.race_rooms%rowtype;
  v_coins integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  PERFORM public.race_maintenance();

  IF EXISTS(
    SELECT 1 FROM public.race_rooms rr
    JOIN public.race_players rp ON rp.room_id=rr.id
    WHERE rp.user_id=v_uid AND rr.status IN ('waiting','betting','countdown','racing')
  ) THEN
    RAISE EXCEPTION 'Ya tienes una sala o carrera activa';
  END IF;

  SELECT coins INTO v_coins FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;

  INSERT INTO public.race_rooms(host_id,status)
  VALUES(v_uid,'waiting')
  RETURNING * INTO v_room;

  INSERT INTO public.race_players(room_id,user_id)
  VALUES(v_room.id,v_uid);

  RETURN public.race_state_json(v_room,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_list_rooms(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  PERFORM public.race_maintenance();

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',rr.id,
        'created_at',rr.created_at,
        'player_count',(SELECT count(*) FROM public.race_players rp WHERE rp.room_id=rr.id),
        'host',public.connect4_public_player(rr.host_id)
      ) ORDER BY rr.created_at DESC
    )
    FROM public.race_rooms rr
    WHERE rr.status='waiting'
      AND rr.created_at >= now()-interval '20 minutes'
      AND NOT EXISTS(SELECT 1 FROM public.race_players rp2 WHERE rp2.room_id=rr.id AND rp2.user_id=v_uid)
  ),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_join_room(p_token text,p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  r public.race_rooms%rowtype;
  v_coins integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  PERFORM public.race_maintenance();

  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sala ya no existe'; END IF;
  IF r.status<>'waiting' THEN RAISE EXCEPTION 'La sala ya no admite jugadores'; END IF;
  IF EXISTS(SELECT 1 FROM public.race_players WHERE room_id=r.id AND user_id=v_uid) THEN
    RETURN public.race_state_json(r,v_uid);
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.race_rooms rr
    JOIN public.race_players rp ON rp.room_id=rr.id
    WHERE rp.user_id=v_uid AND rr.status IN ('waiting','betting','countdown','racing')
  ) THEN
    RAISE EXCEPTION 'Ya tienes una sala o carrera activa';
  END IF;

  SELECT coins INTO v_coins FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins<1 THEN RAISE EXCEPTION 'Necesitas al menos 1 FP para entrar en una carrera'; END IF;

  INSERT INTO public.race_players(room_id,user_id)
  VALUES(r.id,v_uid);
  UPDATE public.race_rooms SET updated_at=now() WHERE id=r.id RETURNING * INTO r;

  RETURN public.race_state_json(r,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_start_betting(p_token text,p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  r public.race_rooms%rowtype;
  v_count integer;
  v_zero integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sala ya no existe'; END IF;
  IF r.host_id<>v_uid THEN RAISE EXCEPTION 'Solo el creador puede comenzar las apuestas'; END IF;
  IF r.status<>'waiting' THEN RAISE EXCEPTION 'La sala no está esperando jugadores'; END IF;

  SELECT count(*),count(*) FILTER (WHERE p.coins<1)
  INTO v_count,v_zero
  FROM public.race_players rp
  JOIN public.profiles p ON p.id=rp.user_id
  WHERE rp.room_id=r.id;

  IF v_count<2 THEN RAISE EXCEPTION 'Necesitas al menos 2 jugadores para iniciar'; END IF;
  IF v_zero>0 THEN RAISE EXCEPTION 'Todos los jugadores necesitan al menos 1 FP para apostar'; END IF;

  UPDATE public.race_rooms SET status='betting',updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN public.race_state_json(r,v_uid);
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
  IF p_car IS NULL OR p_car<0 OR p_car>5 THEN RAISE EXCEPTION 'Coche inválido'; END IF;
  IF p_amount IS NULL OR p_amount<1 THEN RAISE EXCEPTION 'La apuesta debe ser de al menos 1 FP'; END IF;

  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La carrera ya no existe'; END IF;
  IF r.status<>'betting' THEN RAISE EXCEPTION 'Las apuestas no están abiertas'; END IF;

  SELECT * INTO rp FROM public.race_players WHERE room_id=r.id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No formas parte de esta carrera'; END IF;

  SELECT coins INTO v_coins FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;

  IF rp.bet_amount=p_amount AND rp.bet_car=p_car THEN
    UPDATE public.race_players SET last_seen_at=now() WHERE room_id=r.id AND user_id=v_uid;
    RETURN public.race_state_json(r,v_uid);
  END IF;

  IF rp.bet_amount>0 THEN
    v_coins:=v_coins+rp.bet_amount;
  END IF;
  IF v_coins<p_amount THEN
    RAISE EXCEPTION 'No tienes suficientes monedas para esa apuesta';
  END IF;

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
    SET status='countdown',race_plan=v_plan,race_started_at=v_start,finish_order=NULL,finished_at=NULL,updated_at=now()
    WHERE id=r.id
    RETURNING * INTO r;
  ELSE
    UPDATE public.race_rooms SET updated_at=now() WHERE id=r.id RETURNING * INTO r;
  END IF;

  RETURN public.race_state_json(r,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_get_state(p_token text,p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  r public.race_rooms%rowtype;
  rp public.race_players%rowtype;
  v_count integer;
  v_host_seen boolean;
  v_elapsed bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  PERFORM public.race_maintenance();

  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','none'); END IF;

  SELECT * INTO rp FROM public.race_players WHERE room_id=r.id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','none'); END IF;
  UPDATE public.race_players SET last_seen_at=now() WHERE room_id=r.id AND user_id=v_uid;

  IF r.status IN ('waiting','betting') THEN
    FOR rp IN
      SELECT * FROM public.race_players
      WHERE room_id=r.id AND last_seen_at < now()-interval '55 seconds'
      FOR UPDATE
    LOOP
      IF rp.bet_amount>0 THEN
        UPDATE public.profiles SET coins=coins+rp.bet_amount WHERE id=rp.user_id;
      END IF;
      DELETE FROM public.race_players WHERE room_id=rp.room_id AND user_id=rp.user_id;
    END LOOP;

    SELECT EXISTS(
      SELECT 1 FROM public.race_players
      WHERE room_id=r.id AND user_id=r.host_id
    ) INTO v_host_seen;

    SELECT count(*) INTO v_count FROM public.race_players WHERE room_id=r.id;

    IF NOT v_host_seen THEN
      PERFORM public.race_refund_room_players(r.id);
      DELETE FROM public.race_rooms WHERE id=r.id;
      RETURN jsonb_build_object('status','none');
    END IF;

    IF r.status='betting' AND v_count<2 THEN
      PERFORM public.race_refund_room_players(r.id);
      UPDATE public.race_rooms SET status='waiting',updated_at=now() WHERE id=r.id RETURNING * INTO r;
    END IF;
  ELSIF r.status='countdown' THEN
    IF r.race_started_at IS NULL THEN
      PERFORM public.race_refund_room_players(r.id);
      DELETE FROM public.race_rooms WHERE id=r.id;
      RETURN jsonb_build_object('status','none');
    END IF;
    IF r.race_started_at<=clock_timestamp() THEN
      UPDATE public.race_rooms SET status='racing',updated_at=now() WHERE id=r.id AND status='countdown' RETURNING * INTO r;
    END IF;
  END IF;

  IF r.status='racing' THEN
    v_elapsed:=floor(extract(epoch FROM (clock_timestamp()-r.race_started_at))*1000);
    IF v_elapsed >= public.race_max_finish_ms(r.race_plan)+900 THEN
      PERFORM public.race_settle_room(r.id);
      SELECT * INTO r FROM public.race_rooms WHERE id=r.id FOR UPDATE;
    END IF;
  END IF;

  RETURN public.race_state_json(r,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.race_leave_room(p_token text,p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid:=public.app_user_id(p_token);
  r public.race_rooms%rowtype;
  v_count integer;
  v_bet integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.race_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','none'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.race_players WHERE room_id=r.id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('status','none');
  END IF;

  IF r.status IN ('countdown','racing') THEN
    RETURN public.race_state_json(r,v_uid);
  END IF;

  IF r.status='waiting' THEN
    IF r.host_id=v_uid THEN
      DELETE FROM public.race_rooms WHERE id=r.id;
      RETURN jsonb_build_object('status','left');
    END IF;
    DELETE FROM public.race_players WHERE room_id=r.id AND user_id=v_uid;
    RETURN jsonb_build_object('status','left');
  END IF;

  IF r.status='betting' THEN
    IF r.host_id=v_uid THEN
      PERFORM public.race_refund_room_players(r.id);
      DELETE FROM public.race_rooms WHERE id=r.id;
      RETURN jsonb_build_object('status','left');
    END IF;

    SELECT bet_amount INTO v_bet FROM public.race_players WHERE room_id=r.id AND user_id=v_uid FOR UPDATE;
    IF coalesce(v_bet,0)>0 THEN
      UPDATE public.profiles SET coins=coins+v_bet WHERE id=v_uid;
    END IF;
    DELETE FROM public.race_players WHERE room_id=r.id AND user_id=v_uid;

    SELECT count(*) INTO v_count FROM public.race_players WHERE room_id=r.id;
    IF v_count<2 THEN
      PERFORM public.race_refund_room_players(r.id);
      UPDATE public.race_rooms SET status='waiting',updated_at=now() WHERE id=r.id;
    ELSE
      UPDATE public.race_rooms SET updated_at=now() WHERE id=r.id;
    END IF;
    SELECT * INTO r FROM public.race_rooms WHERE id=r.id;
    RETURN public.race_state_json(r,v_uid);
  END IF;

  RETURN public.race_state_json(r,v_uid);
END;
$$;

-- Public RPCs used by the static frontend. Helper functions remain private.
REVOKE ALL ON FUNCTION public.race_build_plan() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_position(jsonb,integer,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_finish_order(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_max_finish_ms(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_public_players(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_state_json(public.race_rooms,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_refund_room_players(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_settle_room(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_maintenance() FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.race_start_room(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_list_rooms(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_join_room(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_start_betting(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_place_bet(text,uuid,integer,integer) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_get_state(text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.race_leave_room(text,uuid) TO anon,authenticated;

-- V37: liquidación y limpieza automática aunque ningún navegador permanezca abierto.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'race-maintenance-v37',
  '1 second',
  'select public.race_maintenance();'
);
