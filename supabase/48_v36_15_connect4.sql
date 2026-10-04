-- ============================================================
-- THE PEDRO & PACO CASINO V36.15 — 4 EN RAYA MULTIJUGADOR
-- ============================================================

CREATE TABLE IF NOT EXISTS public.connect4_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  stake integer NOT NULL CHECK (stake BETWEEN 1 AND 5000),
  pot integer NOT NULL CHECK (pot >= 0 AND pot <= 10000),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','tossing','live','finished')),
  red_player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  blue_player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  toss_color text CHECK (toss_color IN ('red','blue')),
  turn_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  board jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connect4_rooms ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS connect4_rooms_waiting_idx
  ON public.connect4_rooms(status, created_at DESC)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS connect4_rooms_host_idx
  ON public.connect4_rooms(host_id, status);
CREATE INDEX IF NOT EXISTS connect4_rooms_guest_idx
  ON public.connect4_rooms(guest_id, status);

CREATE OR REPLACE FUNCTION public.connect4_board_start()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(0 ORDER BY n), '[]'::jsonb)
  FROM generate_series(0, 41) AS g(n);
$$;

CREATE OR REPLACE FUNCTION public.connect4_has_winner(p_board jsonb, p_piece integer)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  r integer;
  c integer;
  r2 integer;
  c2 integer;
  rr integer;
  cc integer;
  count_run integer;
BEGIN
  IF jsonb_array_length(p_board) <> 42 THEN RETURN false; END IF;
  IF p_piece NOT IN (1,2) THEN RETURN false; END IF;

  FOR r IN 0..5 LOOP
    FOR c IN 0..6 LOOP
      IF (p_board->(r*7+c))::text::integer <> p_piece THEN CONTINUE; END IF;

      -- horizontal
      IF c <= 3 THEN
        IF (p_board->(r*7+c+1))::text::integer = p_piece
           AND (p_board->(r*7+c+2))::text::integer = p_piece
           AND (p_board->(r*7+c+3))::text::integer = p_piece THEN RETURN true; END IF;
      END IF;

      -- vertical
      IF r <= 2 THEN
        IF (p_board->((r+1)*7+c))::text::integer = p_piece
           AND (p_board->((r+2)*7+c))::text::integer = p_piece
           AND (p_board->((r+3)*7+c))::text::integer = p_piece THEN RETURN true; END IF;
      END IF;

      -- diagonal down-right
      IF r <= 2 AND c <= 3 THEN
        IF (p_board->((r+1)*7+c+1))::text::integer = p_piece
           AND (p_board->((r+2)*7+c+2))::text::integer = p_piece
           AND (p_board->((r+3)*7+c+3))::text::integer = p_piece THEN RETURN true; END IF;
      END IF;

      -- diagonal down-left
      IF r <= 2 AND c >= 3 THEN
        IF (p_board->((r+1)*7+c-1))::text::integer = p_piece
           AND (p_board->((r+2)*7+c-2))::text::integer = p_piece
           AND (p_board->((r+3)*7+c-3))::text::integer = p_piece THEN RETURN true; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_public_player(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%rowtype;
  v_shop jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'category', i.category,
    'rarity', i.rarity
  ) ORDER BY i.category, i.sort_order), '[]'::jsonb)
  INTO v_shop
  FROM public.shop_inventory si
  JOIN public.shop_items i ON i.id = si.item_id
  WHERE si.user_id = p_user_id AND si.equipped AND i.active;

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'username', v_profile.username,
    'level', v_profile.level,
    'avatar_id', coalesce(v_profile.avatar_id, 'avatar_01'),
    'shop_cosmetics', v_shop
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_state_json(p_room public.connect4_rooms, p_uid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_room.id,
    'status', p_room.status,
    'stake', p_room.stake,
    'pot', p_room.pot,
    'round', CASE WHEN p_room.status='finished' THEN 4 ELSE 0 END,
    'board', p_room.board,
    'red_player', public.connect4_public_player(p_room.red_player_id),
    'blue_player', public.connect4_public_player(p_room.blue_player_id),
    'toss_color', p_room.toss_color,
    'turn_user_id', p_room.turn_user_id,
    'winner_id', p_room.winner_id,
    'me', public.connect4_public_player(p_uid)
  );
$$;

CREATE OR REPLACE FUNCTION public.connect4_start_room(p_token text, p_stake integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_coins integer;
  v_room public.connect4_rooms%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_stake IS NULL OR p_stake < 1 OR p_stake > 5000 THEN RAISE EXCEPTION 'La apuesta debe estar entre 1 y 5000 FP.'; END IF;

  DELETE FROM public.connect4_rooms WHERE status='waiting' AND created_at < now() - interval '30 minutes';

  IF EXISTS (SELECT 1 FROM public.connect4_rooms WHERE (host_id=v_uid OR guest_id=v_uid) AND status IN ('waiting','tossing','live')) THEN
    RAISE EXCEPTION 'Ya tienes una sala o partida de 4 en raya en curso';
  END IF;

  SELECT coins INTO v_coins FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_coins IS NULL THEN RAISE EXCEPTION 'No existe tu perfil'; END IF;
  IF v_coins < p_stake THEN RAISE EXCEPTION 'No tienes suficientes monedas para crear esa sala'; END IF;

  INSERT INTO public.connect4_rooms(host_id, stake, pot, status, board)
  VALUES(v_uid,p_stake,0,'waiting',public.connect4_board_start())
  RETURNING * INTO v_room;

  RETURN public.connect4_state_json(v_room, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_list_rooms(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_uid uuid := public.app_user_id(p_token); v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  DELETE FROM public.connect4_rooms WHERE status='waiting' AND created_at < now() - interval '30 minutes';
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'stake', r.stake,
    'created_at', r.created_at,
    'host', public.connect4_public_player(r.host_id)
  ) ORDER BY r.created_at ASC), '[]'::jsonb)
  INTO v_rows
  FROM public.connect4_rooms r
  WHERE r.status='waiting' AND r.host_id <> v_uid;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_join_room(p_token text, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_room public.connect4_rooms%rowtype;
  v_host_coins integer;
  v_guest_coins integer;
  v_red uuid;
  v_blue uuid;
  v_toss text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_room FROM public.connect4_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sala ya no existe'; END IF;
  IF v_room.status <> 'waiting' THEN RAISE EXCEPTION 'La sala ya está ocupada'; END IF;
  IF v_room.host_id = v_uid THEN RAISE EXCEPTION 'No puedes entrar en tu propia sala'; END IF;

  IF EXISTS (SELECT 1 FROM public.connect4_rooms WHERE (host_id=v_uid OR guest_id=v_uid) AND status IN ('waiting','tossing','live')) THEN
    RAISE EXCEPTION 'Ya tienes otra sala o partida de 4 en raya activa';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id IN (v_room.host_id, v_uid) ORDER BY id FOR UPDATE;
  SELECT coins INTO v_host_coins FROM public.profiles WHERE id=v_room.host_id;
  SELECT coins INTO v_guest_coins FROM public.profiles WHERE id=v_uid;
  IF v_host_coins < v_room.stake THEN RAISE EXCEPTION 'El creador ya no tiene saldo suficiente para esta partida'; END IF;
  IF v_guest_coins < v_room.stake THEN RAISE EXCEPTION 'No tienes suficientes monedas para entrar en esta partida'; END IF;

  UPDATE public.profiles SET coins=coins-v_room.stake WHERE id IN (v_room.host_id,v_uid);

  IF random() < 0.5 THEN v_red := v_room.host_id; v_blue := v_uid;
  ELSE v_red := v_uid; v_blue := v_room.host_id; END IF;
  v_toss := CASE WHEN random() < 0.5 THEN 'red' ELSE 'blue' END;

  UPDATE public.connect4_rooms
  SET guest_id=v_uid,
      pot=v_room.stake*2,
      status='tossing',
      red_player_id=v_red,
      blue_player_id=v_blue,
      toss_color=v_toss,
      turn_user_id=NULL,
      board=public.connect4_board_start(),
      winner_id=NULL,
      updated_at=now()
  WHERE id=p_room_id
  RETURNING * INTO v_room;

  RETURN public.connect4_state_json(v_room, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_begin(p_token text, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_uid uuid := public.app_user_id(p_token); v_room public.connect4_rooms%rowtype; v_turn uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_room FROM public.connect4_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida ya no existe'; END IF;
  IF v_room.host_id<>v_uid AND v_room.guest_id<>v_uid THEN RAISE EXCEPTION 'No formas parte de esta partida'; END IF;
  IF v_room.status='live' THEN RETURN public.connect4_state_json(v_room,v_uid); END IF;
  IF v_room.status<>'tossing' THEN RAISE EXCEPTION 'La partida no está en fase de lanzamiento'; END IF;
  v_turn := CASE WHEN v_room.toss_color='red' THEN v_room.red_player_id ELSE v_room.blue_player_id END;
  UPDATE public.connect4_rooms SET status='live', turn_user_id=v_turn, updated_at=now() WHERE id=p_room_id RETURNING * INTO v_room;
  RETURN public.connect4_state_json(v_room,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_get_state(p_token text, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_uid uuid := public.app_user_id(p_token); v_room public.connect4_rooms%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  SELECT * INTO v_room FROM public.connect4_rooms WHERE id=p_room_id;
  IF NOT FOUND OR (v_room.host_id<>v_uid AND v_room.guest_id<>v_uid) THEN RETURN jsonb_build_object('status','none'); END IF;
  RETURN public.connect4_state_json(v_room,v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_move(p_token text, p_room_id uuid, p_column integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := public.app_user_id(p_token);
  v_room public.connect4_rooms%rowtype;
  v_piece integer;
  v_row integer := -1;
  v_idx integer;
  v_board jsonb;
  v_winner boolean;
  v_draw boolean;
  r integer;
  v_winner_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF p_column IS NULL OR p_column < 0 OR p_column > 6 THEN RAISE EXCEPTION 'Columna inválida'; END IF;

  SELECT * INTO v_room FROM public.connect4_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida ya no existe'; END IF;
  IF v_room.status<>'live' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  IF v_room.turn_user_id<>v_uid THEN RAISE EXCEPTION 'No es tu turno'; END IF;

  v_piece := CASE WHEN v_room.red_player_id=v_uid THEN 1 WHEN v_room.blue_player_id=v_uid THEN 2 ELSE 0 END;
  IF v_piece=0 THEN RAISE EXCEPTION 'No formas parte de esta partida'; END IF;

  FOR r IN REVERSE 5..0 LOOP
    v_idx := r*7+p_column;
    IF ((v_room.board->v_idx)::text)::integer = 0 THEN v_row:=r; EXIT; END IF;
  END LOOP;
  IF v_row=-1 THEN RAISE EXCEPTION 'Esa columna está completa'; END IF;

  v_idx := v_row*7+p_column;
  v_board := jsonb_set(v_room.board, ARRAY[v_idx::text], to_jsonb(v_piece), false);
  v_winner := public.connect4_has_winner(v_board,v_piece);
  v_draw := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_board) x WHERE ((x)::text)::integer=0);

  IF v_winner OR v_draw THEN
    UPDATE public.connect4_rooms
    SET board=v_board,status='finished',turn_user_id=NULL,winner_id=CASE WHEN v_winner THEN v_uid ELSE NULL END,updated_at=now()
    WHERE id=p_room_id RETURNING * INTO v_room;

    IF v_winner THEN
      UPDATE public.profiles SET coins=coins+v_room.pot WHERE id=v_uid;
      INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
      SELECT p.id,p.username,'4 en raya',v_room.stake,v_room.pot,v_room.stake,'Victoria multijugador'
      FROM public.profiles p WHERE p.id=v_uid;
      INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
      SELECT p.id,p.username,'4 en raya',v_room.stake,0,-v_room.stake,'Derrota multijugador'
      FROM public.profiles p WHERE p.id=CASE WHEN v_room.red_player_id=v_uid THEN v_room.blue_player_id ELSE v_room.red_player_id END;
    ELSE
      UPDATE public.profiles SET coins=coins+v_room.stake WHERE id IN (v_room.red_player_id,v_room.blue_player_id);
      INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
      SELECT p.id,p.username,'4 en raya',v_room.stake,v_room.stake,0,'Empate multijugador'
      FROM public.profiles p WHERE p.id IN (v_room.red_player_id,v_room.blue_player_id);
    END IF;
  ELSE
    UPDATE public.connect4_rooms
    SET board=v_board,turn_user_id=CASE WHEN v_room.red_player_id=v_uid THEN v_room.blue_player_id ELSE v_room.red_player_id END,updated_at=now()
    WHERE id=p_room_id RETURNING * INTO v_room;
  END IF;

  RETURN public.connect4_state_json(v_room,v_uid) || jsonb_build_object('coins',(SELECT coins FROM public.profiles WHERE id=v_uid));
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_resign(p_token text, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_uid uuid:=public.app_user_id(p_token); v_room public.connect4_rooms%rowtype; v_winner uuid; v_loser_stake integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO v_room FROM public.connect4_rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida ya no existe'; END IF;
  IF v_room.host_id<>v_uid AND v_room.guest_id<>v_uid THEN RAISE EXCEPTION 'No formas parte de esta partida'; END IF;
  IF v_room.status<>'live' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  v_winner:=CASE WHEN v_room.red_player_id=v_uid THEN v_room.blue_player_id ELSE v_room.red_player_id END;
  UPDATE public.connect4_rooms SET status='finished',winner_id=v_winner,turn_user_id=NULL,updated_at=now() WHERE id=p_room_id RETURNING * INTO v_room;
  UPDATE public.profiles SET coins=coins+v_room.pot WHERE id=v_winner;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  SELECT p.id,p.username,'4 en raya',v_room.stake,v_room.pot,v_room.stake,'Victoria por abandono'
  FROM public.profiles p WHERE p.id=v_winner;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  SELECT p.id,p.username,'4 en raya',v_room.stake,0,-v_room.stake,'Derrota por abandono'
  FROM public.profiles p WHERE p.id=v_uid;
  RETURN public.connect4_state_json(v_room,v_uid) || jsonb_build_object('coins',(SELECT coins FROM public.profiles WHERE id=v_uid));
END;
$$;

CREATE OR REPLACE FUNCTION public.connect4_cancel_room(p_token text, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_uid uuid:=public.app_user_id(p_token); v_host uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT host_id INTO v_host FROM public.connect4_rooms WHERE id=p_room_id;
  IF v_host IS NULL THEN RETURN jsonb_build_object('status','none'); END IF;
  IF v_host<>v_uid THEN RAISE EXCEPTION 'Solo el creador puede cancelar la sala'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connect4_rooms WHERE id=p_room_id AND status='waiting') THEN RAISE EXCEPTION 'La sala ya está en partida'; END IF;
  DELETE FROM public.connect4_rooms WHERE id=p_room_id;
  RETURN jsonb_build_object('status','cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.connect4_board_start() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_has_winner(jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_public_player(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_state_json(public.connect4_rooms,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_start_room(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_list_rooms(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_join_room(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_begin(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_get_state(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_move(text,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_resign(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect4_cancel_room(text,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.connect4_start_room(text,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_list_rooms(text) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_join_room(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_begin(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_get_state(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_move(text,uuid,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_resign(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.connect4_cancel_room(text,uuid) TO anon;

NOTIFY pgrst, 'reload schema';
