-- V36.21: corregir referencia ambigua a coins en la creación de salas de Ajedrez.
CREATE OR REPLACE FUNCTION public.chess_start_room(p_token text,p_stake integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); v_coins integer; r public.chess_games%rowtype; board jsonb:=public.chess_initial_board(); key text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_stake IS NULL OR p_stake<1 OR p_stake>5000 THEN RAISE EXCEPTION 'La apuesta debe estar entre 1 y 5000 FP.'; END IF;
  DELETE FROM public.chess_games WHERE status='waiting' AND created_at<now()-interval '30 minutes';
  IF EXISTS(SELECT 1 FROM public.chess_games WHERE (host_id=uid OR guest_id=uid) AND status IN ('waiting','starting','live')) THEN RAISE EXCEPTION 'Ya tienes una partida de ajedrez activa'; END IF;
  SELECT p.coins INTO v_coins FROM public.profiles p WHERE p.id=uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins<p_stake THEN RAISE EXCEPTION 'No tienes suficientes monedas para crear esa sala'; END IF;
  key:=public.chess_position_key(board,'w','KQkq',-1);
  INSERT INTO public.chess_games(host_id,stake,pot,status,board,position_history) VALUES(uid,p_stake,0,'waiting',board,jsonb_build_array(key)) RETURNING * INTO r;
  RETURN public.chess_state_json(r,uid,300000,300000);
END;
$$;
