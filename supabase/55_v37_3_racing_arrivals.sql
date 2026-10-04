-- ============================================================
-- V37.3 CARRERAS: TURBO + LLEGADAS EN DIRECTO
-- 7 coches · 1º x5 · 2º x3 · 3º x1 devolución
-- ============================================================

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
  IF p_plan IS NULL OR p_car < 0 OR p_car > 6 THEN RETURN 0; END IF;
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
  v_arrivals jsonb := '[]'::jsonb;
  v_elapsed bigint := 0;
  v_countdown bigint := 0;
  v_max_finish integer := 18000;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE bet_amount>0)
  INTO v_player_count,v_ready_count
  FROM public.race_players WHERE room_id=p_room.id;
  SELECT bet_car,bet_amount,payout,result INTO v_bet_car,v_bet_amount,v_payout,v_result
  FROM public.race_players WHERE room_id=p_room.id AND user_id=p_uid;
  IF p_room.status='countdown' AND p_room.race_started_at IS NOT NULL THEN
    v_countdown:=greatest(0,floor(extract(epoch FROM (p_room.race_started_at-clock_timestamp()))*1000));
  ELSIF p_room.status='racing' AND p_room.race_started_at IS NOT NULL THEN
    v_elapsed:=greatest(0,floor(extract(epoch FROM (clock_timestamp()-p_room.race_started_at))*1000));
    v_positions:=coalesce((
      SELECT jsonb_agg(round(public.race_position(p_room.race_plan,g.n,v_elapsed),5) ORDER BY g.n)
      FROM generate_series(0,6) AS g(n)
    ),v_positions);
    v_arrivals:=coalesce((
      SELECT jsonb_agg(g.n ORDER BY (p_room.race_plan->g.n->>'finish_ms')::integer,g.n)
      FROM generate_series(0,6) AS g(n)
      WHERE (p_room.race_plan->g.n->>'finish_ms')::integer <= v_elapsed
    ),'[]'::jsonb);
  ELSIF p_room.status='finished' AND p_room.race_plan IS NOT NULL THEN
    v_positions:='[1,1,1,1,1,1,1]'::jsonb;
    v_arrivals:=v_order;
  END IF;
  v_max_finish:=public.race_max_finish_ms(p_room.race_plan);
  RETURN jsonb_build_object(
    'id',p_room.id,'status',p_room.status,'host_id',p_room.host_id,
    'player_count',v_player_count,'ready_count',v_ready_count,
    'players',public.race_public_players(p_room.id,p_uid),
    'me',public.connect4_public_player(p_uid)||jsonb_build_object(
      'bet_car',v_bet_car,'bet_amount',coalesce(v_bet_amount,0),
      'has_bet',coalesce(v_bet_amount,0)>0,'payout',coalesce(v_payout,0),'result',v_result
    ),
    'race_started_at',p_room.race_started_at,'countdown_ms',v_countdown,
    'elapsed_ms',v_elapsed,'positions',v_positions,'arrivals',v_arrivals,
    'finish_order',v_order,'max_finish_ms',v_max_finish,
    'winner_car',CASE WHEN jsonb_array_length(v_order)>=1 THEN (v_order->>0)::integer ELSE NULL END,
    'second_car',CASE WHEN jsonb_array_length(v_order)>=2 THEN (v_order->>1)::integer ELSE NULL END,
    'third_car',CASE WHEN jsonb_array_length(v_order)>=3 THEN (v_order->>2)::integer ELSE NULL END,
    'finished_at',p_room.finished_at
  );
END;
$$;
