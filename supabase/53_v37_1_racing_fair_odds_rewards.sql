-- ============================================================
-- THE PEDRO & PACO CASINO V37.1 — CARRERAS
-- Cambios: 1º x10 · 2º x3 · 3º x1 (devolución íntegra).
-- Probabilidades: permutación uniforme de los 6 coches, de modo
-- que cada coche tiene exactamente la misma probabilidad de ocupar
-- cada puesto. Se eliminan empates y sesgos por número de coche.
-- ============================================================

CREATE OR REPLACE FUNCTION public.race_build_plan()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  plan jsonb := '[{}, {}, {}, {}, {}, {}]'::jsonb;
  order_arr integer[];
  segs jsonb;
  car integer;
  s integer;
  rank_no integer;
  finish_ms integer;
BEGIN
  -- Permutación uniforme de los seis coches.
  SELECT array_agg(n ORDER BY random())
  INTO order_arr
  FROM generate_series(0,5) AS n;

  FOR rank_no IN 1..6 LOOP
    car := order_arr[rank_no];
    segs := '[]'::jsonb;
    -- Cada rango tiene separación suficiente para evitar empates.
    finish_ms := 12000 + ((rank_no - 1) * 700) + floor(random() * 450)::integer;

    FOR s IN 0..11 LOOP
      segs := segs || jsonb_build_array(round((0.78 + random() * 0.44)::numeric,3));
    END LOOP;

    -- El índice del array coincide con el ID real del coche.
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

    v_multiplier := CASE v_rank
      WHEN 1 THEN 10
      WHEN 2 THEN 3
      WHEN 3 THEN 1
      ELSE 0
    END;

    -- 1º y 2º pagan beneficio; 3º devuelve exactamente la apuesta.
    v_payout := CASE WHEN rp.bet_amount>0 THEN rp.bet_amount*v_multiplier ELSE 0 END;

    v_car_name := CASE rp.bet_car
      WHEN 0 THEN 'Coche 1'
      WHEN 1 THEN 'Coche 2'
      WHEN 2 THEN 'Coche 3'
      WHEN 3 THEN 'Coche 4'
      WHEN 4 THEN 'Coche 5'
      WHEN 5 THEN 'Coche 6'
      ELSE 'Sin coche'
    END;

    v_detail := CASE
      WHEN v_rank=1 THEN v_car_name||' · 1º · x10'
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

    SELECT coins INTO v_coins FROM public.profiles WHERE id=rp.user_id;

    INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
    SELECT p.id,p.username,'Carreras',rp.bet_amount,v_payout,v_payout-rp.bet_amount,v_detail
    FROM public.profiles p
    WHERE p.id=rp.user_id;
  END LOOP;
END;
$$;

-- Asegura el mantenimiento automático aunque ningún navegador quede abierto.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='race-maintenance-v37') THEN
    PERFORM cron.schedule('race-maintenance-v37','1 second','select public.race_maintenance();');
  END IF;
END;
$$;
