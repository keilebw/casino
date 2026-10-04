-- V36.4 — arreglo definitivo de fichas y Blackjack
-- 1) Las fichas de Blackjack/Higher-Lower ya no pasan por Road Rush (500 FP).
--    El arreglo del frontend está integrado en la versión V36.5.
-- 2) Blackjack inicia siempre con active_hand=1 y limpia el estado de una partida anterior.
-- 3) blackjack_hit tolera partidas normales antiguas con active_hand=0 y las recupera como mano 1.
-- 4) Higher / Lower queda fijado a un máximo de 1000 FP también en la tabla y RPC.

CREATE OR REPLACE FUNCTION public.blackjack_start(p_token text, p_bet integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_username text;
  v_deck jsonb;
  v_player jsonb;
  v_dealer jsonb;
  v_payout integer := 0;
  v_delta integer;
  v_status text := 'live';
  v_detail text := '';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_bet IS NULL OR p_bet < 1 THEN RAISE EXCEPTION 'Apuesta inválida'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.blackjack_games
    WHERE user_id = v_uid AND status = 'live'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una partida de Blackjack en curso';
  END IF;

  SELECT coins, username INTO v_coins, v_username
  FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins < p_bet THEN RAISE EXCEPTION 'No tienes suficientes monedas'; END IF;

  v_deck := public.new_deck();
  v_player := jsonb_build_array(v_deck->0, v_deck->1);
  v_deck := v_deck - 0 - 0;
  v_dealer := jsonb_build_array(v_deck->0, v_deck->1);
  v_deck := v_deck - 0 - 0;

  UPDATE public.profiles SET coins = coins - p_bet WHERE id = v_uid;

  IF public.blackjack_value(v_player) = 21 THEN
    v_status := 'finished';
    IF public.blackjack_value(v_dealer) = 21 THEN
      v_payout := p_bet;
      v_detail := 'Empate a blackjack';
    ELSE
      v_payout := floor(p_bet * 2.5)::integer;
      v_detail := '¡Blackjack!';
    END IF;

    UPDATE public.profiles SET coins = coins + v_payout WHERE id = v_uid;
    v_delta := v_payout - p_bet;

    INSERT INTO public.bets (user_id, username, game, bet, payout, delta, detail)
    VALUES (v_uid, v_username, 'Blackjack', p_bet, v_payout, v_delta, v_detail);
  END IF;

  INSERT INTO public.blackjack_games(
    user_id, bet, deck, player, dealer, status,
    player2, bet2, active_hand, split, done1, done2
  )
  VALUES (
    v_uid, p_bet, v_deck, v_player, v_dealer, v_status,
    NULL, 0, 1, false, false, true
  )
  ON CONFLICT (user_id) DO UPDATE
    SET bet = EXCLUDED.bet,
        deck = EXCLUDED.deck,
        player = EXCLUDED.player,
        dealer = EXCLUDED.dealer,
        status = EXCLUDED.status,
        player2 = NULL,
        bet2 = 0,
        active_hand = 1,
        split = false,
        done1 = false,
        done2 = true,
        created_at = now();

  RETURN jsonb_build_object(
    'status', v_status,
    'bet', p_bet,
    'player', v_player,
    'dealer', v_dealer,
    'payout', v_payout,
    'delta', COALESCE(v_delta, -p_bet),
    'coins', (SELECT coins FROM public.profiles WHERE id = v_uid),
    'detail', v_detail
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.blackjack_hit(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_game public.blackjack_games%rowtype;
  v_card jsonb;
  v_new_hand jsonb;
  v_value integer;
  v_target_bet integer;
  v_username text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;

  SELECT * INTO v_game
  FROM public.blackjack_games
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_game.status <> 'live' THEN
    RAISE EXCEPTION 'No tienes una partida activa';
  END IF;

  -- Recuperación de partidas normales creadas por versiones antiguas.
  IF v_game.active_hand NOT IN (1,2) THEN
    IF NOT v_game.split AND jsonb_array_length(v_game.player) > 0 THEN
      v_game.active_hand := 1;
      UPDATE public.blackjack_games
         SET active_hand = 1,
             done1 = false,
             done2 = true
       WHERE user_id = v_uid;
    ELSE
      RAISE EXCEPTION 'No hay una mano activa';
    END IF;
  END IF;

  IF jsonb_array_length(v_game.deck) < 1 THEN
    RAISE EXCEPTION 'No quedan cartas';
  END IF;

  v_card := v_game.deck->0;
  v_game.deck := v_game.deck - 0;

  IF v_game.active_hand = 1 THEN
    v_new_hand := v_game.player || jsonb_build_array(v_card);
    v_value := public.blackjack_value(v_new_hand);
    v_game.player := v_new_hand;
    v_game.done1 := v_value >= 21;
    IF v_game.done1 AND v_game.split THEN
      v_game.active_hand := 2;
    END IF;
  ELSE
    v_new_hand := v_game.player2 || jsonb_build_array(v_card);
    v_value := public.blackjack_value(v_new_hand);
    v_game.player2 := v_new_hand;
    v_game.done2 := v_value >= 21;
  END IF;

  IF v_game.split AND v_game.done1 AND v_game.done2 THEN
    UPDATE public.blackjack_games
       SET deck = v_game.deck,
           player = v_game.player,
           player2 = v_game.player2,
           active_hand = 2
     WHERE user_id = v_uid;
    RETURN public.blackjack_settle_game(p_token);
  END IF;

  IF NOT v_game.split AND v_game.done1 THEN
    UPDATE public.blackjack_games
       SET deck = v_game.deck,
           player = v_game.player,
           active_hand = 1,
           done1 = true
     WHERE user_id = v_uid;
    RETURN public.blackjack_settle_game(p_token);
  END IF;

  UPDATE public.blackjack_games
     SET deck = v_game.deck,
         player = v_game.player,
         player2 = v_game.player2,
         active_hand = v_game.active_hand,
         done1 = v_game.done1,
         done2 = v_game.done2
   WHERE user_id = v_uid;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_uid;
  v_target_bet := CASE WHEN v_game.active_hand = 2 THEN v_game.bet2 ELSE v_game.bet END;

  RETURN jsonb_build_object(
    'status', 'live',
    'bet', v_game.bet,
    'bet2', v_game.bet2,
    'split', v_game.split,
    'active_hand', v_game.active_hand,
    'player', v_game.player,
    'player2', v_game.player2,
    'dealer', v_game.dealer,
    'bet_for_hand', v_target_bet,
    'coins', (SELECT coins FROM public.profiles WHERE id = v_uid)
  );
END;
$function$;

-- Recuperar partidas normales antiguas que quedaron vivas con active_hand=0.
UPDATE public.blackjack_games
SET active_hand = 1,
    split = false,
    player2 = NULL,
    bet2 = 0,
    done1 = false,
    done2 = true
WHERE status = 'live'
  AND active_hand NOT IN (1,2)
  AND COALESCE(split, false) = false;

-- Higher / Lower: máximo 1000 FP.
ALTER TABLE public.hilo_games DROP CONSTRAINT IF EXISTS hilo_games_bet_limit;
ALTER TABLE public.hilo_games
  ADD CONSTRAINT hilo_games_bet_limit CHECK (bet BETWEEN 1 AND 1000);

CREATE OR REPLACE FUNCTION public.hilo_start(p_token text, p_bet integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_username text;
  v_card jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_bet IS NULL OR p_bet < 1 THEN RAISE EXCEPTION 'Apuesta inválida'; END IF;
  IF p_bet > 1000 THEN RAISE EXCEPTION 'En Higher / Lower la apuesta debe estar entre 1 y 1000 FP.'; END IF;
  IF EXISTS (SELECT 1 FROM public.hilo_games WHERE user_id=v_uid AND status='live') THEN
    RAISE EXCEPTION 'Ya tienes una partida de Higher / Lower en curso';
  END IF;
  SELECT coins, username INTO v_coins, v_username FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins < p_bet THEN RAISE EXCEPTION 'No tienes suficientes monedas'; END IF;
  v_card := public.random_card();
  UPDATE public.profiles SET coins=coins-p_bet WHERE id=v_uid;
  INSERT INTO public.hilo_games(user_id,bet,pot,current_card,trail,status)
  VALUES(v_uid,p_bet,p_bet,v_card,'[]'::jsonb,'live')
  ON CONFLICT(user_id) DO UPDATE SET bet=EXCLUDED.bet,pot=EXCLUDED.pot,current_card=EXCLUDED.current_card,trail='[]'::jsonb,status='live',created_at=now();
  RETURN jsonb_build_object('status','live','bet',p_bet,'pot',p_bet,'current_card',v_card,'trail','[]'::jsonb,'coins',(SELECT coins FROM public.profiles WHERE id=v_uid));
END;
$function$;

CREATE OR REPLACE FUNCTION public.hilo_start_limited(p_token text, p_bet integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_bet IS NULL OR p_bet < 1 OR p_bet > 1000 THEN
    RAISE EXCEPTION 'En Higher / Lower la apuesta debe estar entre 1 y 1000 FP.';
  END IF;
  RETURN public.hilo_start(p_token,p_bet);
END;
$function$;

NOTIFY pgrst, 'reload schema';
