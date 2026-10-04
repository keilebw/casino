-- V36.5 — Higher / Lower: rebalance economy
-- Goal: avoid explosive bankroll growth while keeping risk/reward.
-- Bet maximum remains 1000 FP.
-- Pot maximum is 5000 FP.
-- Win multiplier depends on the probability of the selected outcome.

CREATE OR REPLACE FUNCTION public.hilo_guess(p_token text, p_up boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_game public.hilo_games%rowtype;
  v_next jsonb;
  v_old_rank integer;
  v_new_rank integer;
  v_favorable integer;
  v_win boolean;
  v_multiplier numeric(6,4);
  v_new_pot integer;
  v_username text;
  v_delta integer;
  v_detail text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;

  SELECT * INTO v_game
  FROM public.hilo_games
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_game.status <> 'live' THEN
    RAISE EXCEPTION 'No tienes una partida activa';
  END IF;

  v_next := public.random_card();
  v_old_rank := (v_game.current_card->>'r')::integer;
  v_new_rank := (v_next->>'r')::integer;

  v_win := CASE
    WHEN p_up THEN v_new_rank > v_old_rank
    ELSE v_new_rank < v_old_rank
  END;

  v_detail := format(
    'salió %s%s',
    (array['2','3','4','5','6','7','8','9','10','J','Q','K','A'])[v_new_rank + 1],
    v_next->>'s'
  );

  IF v_win THEN
    -- Number of ranks that would have won the selected prediction.
    -- Same rank always loses, so ties are excluded.
    v_favorable := CASE
      WHEN p_up THEN 13 - v_old_rank
      ELSE v_old_rank - 1
    END;

    -- House edge with a minimum 1.05x win multiplier and a 1.95x ceiling.
    -- Easier predictions pay less; harder predictions pay more.
    v_multiplier := GREATEST(
      1.05,
      LEAST(
        1.95,
        (0.90 * 13.0) / GREATEST(1, v_favorable)
      )
    );

    v_new_pot := LEAST(
      5000,
      GREATEST(
        v_game.pot + 1,
        FLOOR(v_game.pot * v_multiplier)::integer
      )
    );

    UPDATE public.hilo_games
       SET current_card = v_next,
           trail = v_game.trail || jsonb_build_array(v_game.current_card),
           pot = v_new_pot
     WHERE user_id = v_uid;

    RETURN jsonb_build_object(
      'status', 'live',
      'bet', v_game.bet,
      'pot', v_new_pot,
      'multiplier', v_multiplier,
      'current_card', v_next,
      'trail', v_game.trail || jsonb_build_array(v_game.current_card),
      'coins', (SELECT coins FROM public.profiles WHERE id = v_uid),
      'detail', v_detail
    );
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_uid;
  v_delta := -v_game.bet;

  UPDATE public.hilo_games
     SET current_card = v_next,
         trail = v_game.trail || jsonb_build_array(v_game.current_card),
         status = 'finished'
   WHERE user_id = v_uid;

  INSERT INTO public.bets (user_id, username, game, bet, payout, delta, detail)
  VALUES (v_uid, v_username, 'Higher/Lower', v_game.bet, 0, v_delta, v_detail);

  RETURN jsonb_build_object(
    'status', 'finished',
    'bet', v_game.bet,
    'pot', 0,
    'current_card', v_next,
    'trail', v_game.trail || jsonb_build_array(v_game.current_card),
    'payout', 0,
    'delta', v_delta,
    'coins', (SELECT coins FROM public.profiles WHERE id = v_uid),
    'detail', v_detail
  );
END;
$function$;

-- Prevent any legacy live pot above the new cap from growing further.
UPDATE public.hilo_games
SET pot = 5000
WHERE pot > 5000;

NOTIFY pgrst, 'reload schema';
