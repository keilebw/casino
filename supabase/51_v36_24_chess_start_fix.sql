/* ============================================================
   V36.24 — AJEDREZ: ARRANQUE ROBUSTO
   Aplicar después de 49_v36_20_chess.sql.
   ============================================================ */

CREATE OR REPLACE FUNCTION public.chess_get_state(p_token text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid:=public.app_user_id(p_token);
  r public.chess_games%rowtype;
  elapsed bigint;
  w integer;
  b integer;
  settled public.chess_games%rowtype;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND OR (r.host_id<>uid AND r.guest_id<>uid) THEN
    RETURN jsonb_build_object('status','none');
  END IF;

  -- Respaldo de servidor: una partida con ambos colores asignados
  -- no puede quedar atascada indefinidamente en el sorteo.
  IF r.status='starting'
     AND r.white_player_id IS NOT NULL
     AND r.black_player_id IS NOT NULL
     AND r.updated_at IS NOT NULL
     AND r.updated_at < now()-interval '4 seconds' THEN
    UPDATE public.chess_games
      SET status='live',
          turn_user_id=white_player_id,
          turn_started_at=clock_timestamp(),
          updated_at=now()
    WHERE id=r.id AND status='starting'
    RETURNING * INTO r;
  END IF;

  -- Si el arranque queda abandonado, devolvemos las dos apuestas y
  -- cerramos el registro para que nunca se quede en curso en la BD.
  IF r.status='starting'
     AND r.updated_at IS NOT NULL
     AND r.updated_at < now()-interval '1 minute' THEN
    UPDATE public.profiles
      SET coins=coins+r.stake
    WHERE id IN (r.host_id,r.guest_id)
      AND r.host_id IS NOT NULL
      AND r.guest_id IS NOT NULL;
    UPDATE public.chess_games
      SET status='finished',winner_id=NULL,result='cancelled',turn_user_id=NULL,updated_at=now()
    WHERE id=r.id AND status='starting'
    RETURNING * INTO r;
    RETURN public.chess_state_json(r,uid,r.white_ms,r.black_ms);
  END IF;

  w:=r.white_ms;
  b:=r.black_ms;
  IF r.status='live' AND r.turn_started_at IS NOT NULL THEN
    elapsed:=floor(extract(epoch from (clock_timestamp()-r.turn_started_at))*1000);
    IF r.turn_user_id=r.white_player_id THEN
      w:=greatest(0,w-elapsed);
    ELSE
      b:=greatest(0,b-elapsed);
    END IF;
    IF r.turn_user_id=r.white_player_id AND w<=0 THEN
      UPDATE public.chess_games SET white_ms=0 WHERE id=r.id;
      settled:=public.chess_finish_winner(r.id,r.black_player_id,'timeout','Victoria por tiempo');
      RETURN public.chess_state_json(settled,uid,settled.white_ms,settled.black_ms);
    ELSIF r.turn_user_id=r.black_player_id AND b<=0 THEN
      UPDATE public.chess_games SET black_ms=0 WHERE id=r.id;
      settled:=public.chess_finish_winner(r.id,r.white_player_id,'timeout','Victoria por tiempo');
      RETURN public.chess_state_json(settled,uid,settled.white_ms,settled.black_ms);
    END IF;
  END IF;

  RETURN public.chess_state_json(r,uid,r.white_ms,r.black_ms);
END;
$$;

