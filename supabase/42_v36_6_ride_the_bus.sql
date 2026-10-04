-- V36.6 — sustitución de Higher / Lower por Ride the Bus
-- Ride the Bus: 4 rondas, apuesta máxima 1000 FP, bote máximo 5000 FP.
-- La economía se resuelve exclusivamente en Supabase.

CREATE TABLE IF NOT EXISTS public.ride_bus_games (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet integer NOT NULL CHECK (bet BETWEEN 1 AND 1000),
  pot integer NOT NULL CHECK (pot BETWEEN 1 AND 5000),
  round integer NOT NULL CHECK (round BETWEEN 1 AND 4),
  cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','finished')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ride_bus_games ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ride_bus_start(p_token text, p_bet integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_username text;
  v_card jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_bet IS NULL OR p_bet < 1 OR p_bet > 1000 THEN
    RAISE EXCEPTION 'Ride the Bus permite apuestas entre 1 y 1000 FP.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ride_bus_games WHERE user_id=v_uid AND status='live') THEN
    RAISE EXCEPTION 'Ya tienes una partida de Ride the Bus en curso';
  END IF;

  SELECT coins, username INTO v_coins, v_username
  FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins < p_bet THEN RAISE EXCEPTION 'No tienes suficientes monedas'; END IF;

  v_card := public.random_card();
  UPDATE public.profiles SET coins=coins-p_bet WHERE id=v_uid;

  INSERT INTO public.ride_bus_games(user_id,bet,pot,round,cards,status)
  VALUES(v_uid,p_bet,p_bet,1,jsonb_build_array(v_card),'live')
  ON CONFLICT(user_id) DO UPDATE SET
    bet=excluded.bet,pot=excluded.pot,round=excluded.round,cards=excluded.cards,status='live',created_at=now();

  RETURN jsonb_build_object(
    'status','live','bet',p_bet,'pot',p_bet,'round',1,
    'cards',jsonb_build_array(v_card),
    'coins',(SELECT coins FROM public.profiles WHERE id=v_uid)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ride_bus_guess(p_token text, p_choice text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_game public.ride_bus_games%rowtype;
  v_cards jsonb;
  v_card jsonb;
  v_last jsonb;
  v_win boolean := false;
  v_old_rank integer;
  v_new_rank integer;
  v_low integer;
  v_high integer;
  v_multiplier numeric;
  v_new_pot integer;
  v_username text;
  v_delta integer;
  v_detail text;
  v_round integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_game FROM public.ride_bus_games WHERE user_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'live' THEN RAISE EXCEPTION 'No tienes una partida activa'; END IF;

  v_cards := v_game.cards;
  v_round := v_game.round;
  v_last := v_cards->(jsonb_array_length(v_cards)-1);
  v_card := public.random_card();
  v_old_rank := (v_last->>'r')::integer;
  v_new_rank := (v_card->>'r')::integer;

  IF v_round = 1 THEN
    IF p_choice NOT IN ('red','black') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_win := CASE WHEN p_choice='red' THEN v_card->>'s' IN ('♥','♦') ELSE v_card->>'s' IN ('♠','♣') END;
    v_multiplier := 1.35;
  ELSIF v_round = 2 THEN
    IF p_choice NOT IN ('higher','lower') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_win := CASE WHEN p_choice='higher' THEN v_new_rank > v_old_rank ELSE v_new_rank < v_old_rank END;
    v_multiplier := 1.50;
  ELSIF v_round = 3 THEN
    IF p_choice NOT IN ('inside','outside') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_low := LEAST((v_cards->(jsonb_array_length(v_cards)-2)->>'r')::integer, v_old_rank);
    v_high := GREATEST((v_cards->(jsonb_array_length(v_cards)-2)->>'r')::integer, v_old_rank);
    IF v_low = v_high THEN
      v_win := false;
    ELSE
      v_win := CASE
        WHEN p_choice='inside' THEN v_new_rank > v_low AND v_new_rank < v_high
        ELSE v_new_rank < v_low OR v_new_rank > v_high
      END;
    END IF;
    v_multiplier := 1.80;
  ELSE
    IF p_choice NOT IN ('♠','♥','♦','♣') THEN RAISE EXCEPTION 'Palo inválido'; END IF;
    v_win := v_card->>'s' = p_choice;
    v_multiplier := 2.50;
  END IF;

  v_cards := v_cards || jsonb_build_array(v_card);
  v_detail := format('salió %s%s', (ARRAY['2','3','4','5','6','7','8','9','10','J','Q','K','A'])[v_new_rank+1], v_card->>'s');

  IF v_win THEN
    v_new_pot := LEAST(5000, FLOOR(v_game.pot * v_multiplier)::integer);
    IF v_round < 4 THEN
      UPDATE public.ride_bus_games SET cards=v_cards, pot=v_new_pot, round=v_round+1 WHERE user_id=v_uid;
      RETURN jsonb_build_object(
        'status','live','bet',v_game.bet,'pot',v_new_pot,'round',v_round+1,'cards',v_cards,
        'multiplier',v_multiplier,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail',v_detail
      );
    END IF;

    SELECT username INTO v_username FROM public.profiles WHERE id=v_uid;
    v_delta := v_new_pot - v_game.bet;
    UPDATE public.profiles SET coins=coins+v_new_pot WHERE id=v_uid;
    UPDATE public.ride_bus_games SET cards=v_cards,pot=v_new_pot,status='finished' WHERE user_id=v_uid;
    INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
    VALUES(v_uid,v_username,'Ride the Bus',v_game.bet,v_new_pot,v_delta,'Ruta completa');
    RETURN jsonb_build_object('status','finished','bet',v_game.bet,'pot',v_new_pot,'round',4,'cards',v_cards,
      'payout',v_new_pot,'delta',v_delta,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail','Ruta completa');
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id=v_uid;
  v_delta := -v_game.bet;
  UPDATE public.ride_bus_games SET cards=v_cards,status='finished' WHERE user_id=v_uid;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  VALUES(v_uid,v_username,'Ride the Bus',v_game.bet,0,v_delta,v_detail);
  RETURN jsonb_build_object('status','finished','bet',v_game.bet,'pot',0,'round',v_round,'cards',v_cards,
    'payout',0,'delta',v_delta,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail',v_detail);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ride_bus_cashout(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_game public.ride_bus_games%rowtype;
  v_username text;
  v_delta integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_game FROM public.ride_bus_games WHERE user_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'live' THEN RAISE EXCEPTION 'No tienes una partida activa'; END IF;
  SELECT username INTO v_username FROM public.profiles WHERE id=v_uid;
  v_delta := v_game.pot - v_game.bet;
  UPDATE public.ride_bus_games SET status='finished' WHERE user_id=v_uid;
  UPDATE public.profiles SET coins=coins+v_game.pot WHERE id=v_uid;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  VALUES(v_uid,v_username,'Ride the Bus',v_game.bet,v_game.pot,v_delta,'Bote cobrado');
  RETURN jsonb_build_object('status','finished','bet',v_game.bet,'pot',v_game.pot,'payout',v_game.pot,
    'delta',v_delta,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail','Bote cobrado');
END;
$function$;

CREATE OR REPLACE FUNCTION public.ride_bus_get_active(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_game public.ride_bus_games%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_game FROM public.ride_bus_games WHERE user_id=v_uid AND status='live';
  IF NOT FOUND THEN RETURN jsonb_build_object('status','none'); END IF;
  RETURN jsonb_build_object('status','live','bet',v_game.bet,'pot',v_game.pot,'round',v_game.round,'cards',v_game.cards);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ride_bus_start(text,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.ride_bus_guess(text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.ride_bus_cashout(text) TO anon;
GRANT EXECUTE ON FUNCTION public.ride_bus_get_active(text) TO anon;

COMMENT ON FUNCTION public.ride_bus_start(text,integer) IS 'V36.6: inicia Ride the Bus, apuesta 1-1000 FP.';
COMMENT ON FUNCTION public.ride_bus_guess(text,text) IS 'V36.6: resuelve las cuatro rondas de Ride the Bus.';
COMMENT ON FUNCTION public.ride_bus_cashout(text) IS 'V36.6: cobra el bote actual de Ride the Bus.';
COMMENT ON FUNCTION public.ride_bus_get_active(text) IS 'V36.6: recupera una partida activa de Ride the Bus.';

NOTIFY pgrst, 'reload schema';
