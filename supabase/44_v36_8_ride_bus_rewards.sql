-- V36.8 — Rebalance Ride the Bus rewards
-- Round multipliers: 1.50 / 1.80 / 2.20 / 5.00
-- Maximum pot remains 5000 FP.

-- The reward multipliers are enforced in the function so the client cannot alter them.
CREATE OR REPLACE FUNCTION public.ride_bus_guess(p_token text, p_choice text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token); v_game public.ride_bus_games%rowtype;
  v_cards jsonb; v_card jsonb; v_last jsonb; v_second jsonb;
  v_win boolean := false; v_old_rank integer; v_new_rank integer;
  v_low integer; v_high integer; v_multiplier numeric; v_new_pot integer;
  v_username text; v_delta integer; v_detail text; v_round integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_game FROM public.ride_bus_games WHERE user_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'live' THEN RAISE EXCEPTION 'No tienes una partida activa'; END IF;
  v_cards := v_game.cards; v_round := v_game.round; v_last := v_cards->(jsonb_array_length(v_cards)-1); v_old_rank := (v_last->>'r')::integer;

  IF v_round=1 THEN
    IF p_choice NOT IN ('red','black') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_card := v_last;
    v_new_rank := v_old_rank;
    v_win := CASE WHEN p_choice='red' THEN v_card->>'s' IN ('♥','♦') ELSE v_card->>'s' IN ('♠','♣') END;
    v_multiplier := 1.50;
  ELSIF v_round=2 THEN
    IF p_choice NOT IN ('higher','lower') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_card := public.random_card(); v_new_rank := (v_card->>'r')::integer;
    v_win := CASE WHEN p_choice='higher' THEN v_new_rank>v_old_rank ELSE v_new_rank<v_old_rank END;
    v_multiplier := 1.80;
  ELSIF v_round=3 THEN
    IF p_choice NOT IN ('inside','outside') THEN RAISE EXCEPTION 'Elección inválida'; END IF;
    v_card := public.random_card(); v_new_rank := (v_card->>'r')::integer;
    v_second := v_cards->(jsonb_array_length(v_cards)-2);
    v_low := LEAST((v_second->>'r')::integer,v_old_rank); v_high := GREATEST((v_second->>'r')::integer,v_old_rank);
    IF v_low <> v_high THEN v_win := CASE WHEN p_choice='inside' THEN v_new_rank>v_low AND v_new_rank<v_high ELSE v_new_rank<v_low OR v_new_rank>v_high END; END IF;
    v_multiplier := 2.20;
  ELSE
    IF p_choice NOT IN ('♠','♥','♦','♣') THEN RAISE EXCEPTION 'Palo inválido'; END IF;
    v_card := public.random_card(); v_new_rank := (v_card->>'r')::integer; v_win := v_card->>'s'=p_choice; v_multiplier := 5.00;
  END IF;

  IF v_round=1 THEN v_cards := v_cards; ELSE v_cards := v_cards || jsonb_build_array(v_card); END IF;
  v_detail := format('salió %s%s',(ARRAY['2','3','4','5','6','7','8','9','10','J','Q','K','A'])[v_new_rank+1],v_card->>'s');

  IF v_win THEN
    v_new_pot := LEAST(5000,CEIL(v_game.pot*v_multiplier)::integer);
    IF v_round<4 THEN
      UPDATE public.ride_bus_games SET cards=v_cards,pot=v_new_pot,round=v_round+1 WHERE user_id=v_uid;
      RETURN jsonb_build_object('status','live','bet',v_game.bet,'pot',v_new_pot,'round',v_round+1,'cards',v_cards,'multiplier',v_multiplier,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail',v_detail);
    END IF;
    SELECT username INTO v_username FROM public.profiles WHERE id=v_uid; v_delta:=v_new_pot-v_game.bet;
    UPDATE public.profiles SET coins=coins+v_new_pot WHERE id=v_uid;
    UPDATE public.ride_bus_games SET cards=v_cards,pot=v_new_pot,status='finished' WHERE user_id=v_uid;
    INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail) VALUES(v_uid,v_username,'Ride the Bus',v_game.bet,v_new_pot,v_delta,'Ruta completa');
    RETURN jsonb_build_object('status','finished','bet',v_game.bet,'pot',v_new_pot,'round',4,'cards',v_cards,'payout',v_new_pot,'delta',v_delta,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail','Ruta completa');
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id=v_uid; v_delta:=-v_game.bet;
  UPDATE public.ride_bus_games SET cards=v_cards,status='finished' WHERE user_id=v_uid;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail) VALUES(v_uid,v_username,'Ride the Bus',v_game.bet,0,v_delta,v_detail);
  RETURN jsonb_build_object('status','finished','bet',v_game.bet,'pot',0,'round',v_round,'cards',v_cards,'payout',0,'delta',v_delta,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid),'detail',v_detail);
END;
$function$;

NOTIFY pgrst,'reload schema';
