-- ============================================================
-- THE PEDRO & PACO CASINO — AJEDREZ MULTIJUGADOR V36.20
-- 5+0: 5 minutos por jugador, sin incremento.
-- El servidor decide color, turnos, movimientos, jaques, mate,
-- tablas, relojes y pagos. El cliente solo representa/ANIMA.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chess_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  stake integer NOT NULL CHECK (stake BETWEEN 1 AND 5000),
  pot integer NOT NULL CHECK (pot >= 0 AND pot <= 10000),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','starting','live','finished')),
  white_player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  black_player_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  turn_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  board jsonb NOT NULL,
  castling text NOT NULL DEFAULT 'KQkq',
  en_passant integer NOT NULL DEFAULT -1 CHECK (en_passant BETWEEN -1 AND 63),
  white_ms integer NOT NULL DEFAULT 300000 CHECK (white_ms BETWEEN 0 AND 300000),
  black_ms integer NOT NULL DEFAULT 300000 CHECK (black_ms BETWEEN 0 AND 300000),
  turn_started_at timestamptz,
  halfmove_clock integer NOT NULL DEFAULT 0 CHECK (halfmove_clock >= 0),
  move_number integer NOT NULL DEFAULT 1 CHECK (move_number >= 1),
  position_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_move jsonb,
  winner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chess_games ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS chess_games_waiting_idx
  ON public.chess_games(status, created_at DESC) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS chess_games_host_idx
  ON public.chess_games(host_id, status);
CREATE INDEX IF NOT EXISTS chess_games_guest_idx
  ON public.chess_games(guest_id, status);

CREATE OR REPLACE FUNCTION public.chess_initial_board()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
SELECT to_jsonb(
  ARRAY[
    'r','n','b','q','k','b','n','r',
    'p','p','p','p','p','p','p','p'
  ]::text[]
  || array_fill(''::text,ARRAY[32])
  || ARRAY[
    'P','P','P','P','P','P','P','P',
    'R','N','B','Q','K','B','N','R'
  ]::text[]
);
$$;

CREATE OR REPLACE FUNCTION public.chess_piece_color(p_piece text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_piece IS NULL OR p_piece = '' THEN ''
    WHEN p_piece = upper(p_piece) THEN 'w'
    ELSE 'b'
  END;
$$;

CREATE OR REPLACE FUNCTION public.chess_piece_type(p_piece text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT lower(coalesce(p_piece,''));
$$;

CREATE OR REPLACE FUNCTION public.chess_find_king(p_board jsonb, p_side text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE i integer; target text := CASE WHEN p_side='w' THEN 'K' ELSE 'k' END;
BEGIN
  IF jsonb_array_length(p_board) <> 64 THEN RETURN -1; END IF;
  FOR i IN 0..63 LOOP
    IF p_board->>i = target THEN RETURN i; END IF;
  END LOOP;
  RETURN -1;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_is_attacked(p_board jsonb, p_square integer, p_by_side text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  r integer := p_square / 8;
  c integer := p_square % 8;
  nr integer; nc integer; idx integer; piece text;
  dr integer; dc integer;
  target_pawn text := CASE WHEN p_by_side='w' THEN 'P' ELSE 'p' END;
  target_knight text := CASE WHEN p_by_side='w' THEN 'N' ELSE 'n' END;
  target_king text := CASE WHEN p_by_side='w' THEN 'K' ELSE 'k' END;
  target_bishop text := CASE WHEN p_by_side='w' THEN 'B' ELSE 'b' END;
  target_rook text := CASE WHEN p_by_side='w' THEN 'R' ELSE 'r' END;
  target_queen text := CASE WHEN p_by_side='w' THEN 'Q' ELSE 'q' END;
BEGIN
  IF p_square < 0 OR p_square > 63 THEN RETURN false; END IF;

  nr := CASE WHEN p_by_side='w' THEN r+1 ELSE r-1 END;
  IF nr BETWEEN 0 AND 7 THEN
    IF c > 0 AND p_board->>(nr*8+c-1) = target_pawn THEN RETURN true; END IF;
    IF c < 7 AND p_board->>(nr*8+c+1) = target_pawn THEN RETURN true; END IF;
  END IF;

  FOR dr,dc IN SELECT * FROM (VALUES
    (-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)
  ) AS k(dr,dc) LOOP
    nr := r+dr; nc := c+dc;
    IF nr BETWEEN 0 AND 7 AND nc BETWEEN 0 AND 7 THEN
      IF p_board->>(nr*8+nc) = target_knight THEN RETURN true; END IF;
    END IF;
  END LOOP;

  FOR dr,dc IN SELECT * FROM (VALUES
    (-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)
  ) AS k(dr,dc) LOOP
    nr := r+dr; nc := c+dc;
    IF nr BETWEEN 0 AND 7 AND nc BETWEEN 0 AND 7 THEN
      IF p_board->>(nr*8+nc) = target_king THEN RETURN true; END IF;
    END IF;
  END LOOP;

  FOR dr,dc IN SELECT * FROM (VALUES (-1,-1),(-1,1),(1,-1),(1,1)) AS k(dr,dc) LOOP
    nr := r+dr; nc := c+dc;
    WHILE nr BETWEEN 0 AND 7 AND nc BETWEEN 0 AND 7 LOOP
      idx := nr*8+nc; piece := p_board->>idx;
      IF piece <> '' THEN
        IF piece = target_bishop OR piece = target_queen THEN RETURN true; END IF;
        EXIT;
      END IF;
      nr := nr+dr; nc := nc+dc;
    END LOOP;
  END LOOP;

  FOR dr,dc IN SELECT * FROM (VALUES (-1,0),(1,0),(0,-1),(0,1)) AS k(dr,dc) LOOP
    nr := r+dr; nc := c+dc;
    WHILE nr BETWEEN 0 AND 7 AND nc BETWEEN 0 AND 7 LOOP
      idx := nr*8+nc; piece := p_board->>idx;
      IF piece <> '' THEN
        IF piece = target_rook OR piece = target_queen THEN RETURN true; END IF;
        EXIT;
      END IF;
      nr := nr+dr; nc := nc+dc;
    END LOOP;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_apply_candidate(
  p_board jsonb,
  p_from integer,
  p_to integer,
  p_promotion text,
  p_castling text,
  p_en_passant integer
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  fr integer := p_from / 8; fc integer := p_from % 8;
  tr integer := p_to / 8; tc integer := p_to % 8;
  dr integer := tr-fr; dc integer := tc-fc;
  orig_piece text := p_board->>p_from;
  piece text := orig_piece;
  target text := p_board->>p_to;
  side text := public.chess_piece_color(orig_piece);
  t text := lower(coalesce(orig_piece,''));
  v_board jsonb := p_board;
  v_rights text := coalesce(p_castling,'');
  v_ep integer := -1;
  v_capture text := target;
  v_special text := 'normal';
  v_ok boolean := false;
  v_prom text := lower(coalesce(p_promotion,''));
  clear_path boolean := true;
  i integer; idx integer; mid text;
BEGIN
  IF p_from < 0 OR p_from > 63 OR p_to < 0 OR p_to > 63 OR p_from=p_to THEN
    RETURN jsonb_build_object('ok',false,'error','Movimiento inválido');
  END IF;
  IF piece='' OR piece IS NULL THEN RETURN jsonb_build_object('ok',false,'error','No hay pieza'); END IF;
  IF side NOT IN ('w','b') THEN RETURN jsonb_build_object('ok',false,'error','Color inválido'); END IF;
  IF lower(target)='k' THEN RETURN jsonb_build_object('ok',false,'error','No puedes capturar al rey'); END IF;
  IF target<>'' AND public.chess_piece_color(target)=side THEN
    RETURN jsonb_build_object('ok',false,'error','No puedes capturar tu propia pieza');
  END IF;

  IF t='p' THEN
    IF side='w' AND dr=-1 AND abs(dc)=0 AND target='' THEN v_ok:=true; END IF;
    IF side='b' AND dr=1 AND abs(dc)=0 AND target='' THEN v_ok:=true; END IF;

    IF side='w' AND dr=-2 AND dc=0 AND fr=6 AND target='' AND p_board->>(p_from-8)='' THEN v_ok:=true; END IF;
    IF side='b' AND dr=2 AND dc=0 AND fr=1 AND target='' AND p_board->>(p_from+8)='' THEN v_ok:=true; END IF;

    IF abs(dc)=1 AND ((side='w' AND dr=-1) OR (side='b' AND dr=1)) THEN
      IF target<>'' AND public.chess_piece_color(target)<>side THEN
        v_ok:=true;
      ELSIF p_to=p_en_passant AND target='' THEN
        idx := fr*8+tc;
        IF p_board->>idx = (CASE WHEN side='w' THEN 'p' ELSE 'P' END) THEN
          v_ok:=true; v_special:='en_passant'; v_capture:=p_board->>idx;
        END IF;
      END IF;
    END IF;

    IF v_ok AND ((side='w' AND tr=0) OR (side='b' AND tr=7)) THEN
      IF v_prom NOT IN ('q','r','b','n') THEN
        RETURN jsonb_build_object('ok',false,'error','Debes elegir promoción');
      END IF;
    END IF;

    IF NOT v_ok THEN RETURN jsonb_build_object('ok',false,'error','Movimiento de peón inválido'); END IF;

  ELSIF t='n' THEN
    v_ok := (abs(dr)=2 AND abs(dc)=1) OR (abs(dr)=1 AND abs(dc)=2);
  ELSIF t='b' THEN
    IF abs(dr)=abs(dc) AND dr<>0 THEN
      FOR i IN 1..abs(dr)-1 LOOP
        idx := (fr + i*sign(dr))*8 + (fc + i*sign(dc));
        IF p_board->>idx <> '' THEN clear_path:=false; END IF;
      END LOOP;
      v_ok := clear_path;
    END IF;
  ELSIF t='r' THEN
    IF ((dr=0 AND dc<>0) OR (dc=0 AND dr<>0)) THEN
      IF dr=0 THEN
        FOR i IN 1..abs(dc)-1 LOOP
          idx := fr*8 + (fc + i*sign(dc));
          IF p_board->>idx <> '' THEN clear_path:=false; END IF;
        END LOOP;
      ELSE
        FOR i IN 1..abs(dr)-1 LOOP
          idx := (fr + i*sign(dr))*8 + fc;
          IF p_board->>idx <> '' THEN clear_path:=false; END IF;
        END LOOP;
      END IF;
      v_ok := clear_path;
    END IF;
  ELSIF t='q' THEN
    IF abs(dr)=abs(dc) AND dr<>0 THEN
      FOR i IN 1..abs(dr)-1 LOOP
        idx := (fr + i*sign(dr))*8 + (fc + i*sign(dc));
        IF p_board->>idx <> '' THEN clear_path:=false; END IF;
      END LOOP;
      v_ok := clear_path;
    ELSIF ((dr=0 AND dc<>0) OR (dc=0 AND dr<>0)) THEN
      IF dr=0 THEN
        FOR i IN 1..abs(dc)-1 LOOP
          idx := fr*8 + (fc + i*sign(dc));
          IF p_board->>idx <> '' THEN clear_path:=false; END IF;
        END LOOP;
      ELSE
        FOR i IN 1..abs(dr)-1 LOOP
          idx := (fr + i*sign(dr))*8 + fc;
          IF p_board->>idx <> '' THEN clear_path:=false; END IF;
        END LOOP;
      END IF;
      v_ok := clear_path;
    END IF;
  ELSIF t='k' THEN
    IF max(abs(dr),abs(dc))=1 THEN
      v_ok:=true;
    ELSIF dr=0 AND abs(dc)=2 THEN
      IF side='w' AND p_from=60 AND p_to=62 AND position('K' in v_rights)>0
         AND p_board->>61='' AND p_board->>62=''
         AND p_board->>63='R'
         AND NOT public.chess_is_attacked(p_board,60,'b')
         AND NOT public.chess_is_attacked(p_board,61,'b')
         AND NOT public.chess_is_attacked(p_board,62,'b') THEN v_ok:=true; v_special:='castle_k'; END IF;
      IF side='w' AND p_from=60 AND p_to=58 AND position('Q' in v_rights)>0
         AND p_board->>59='' AND p_board->>58='' AND p_board->>57=''
         AND p_board->>56='R'
         AND NOT public.chess_is_attacked(p_board,60,'b')
         AND NOT public.chess_is_attacked(p_board,59,'b')
         AND NOT public.chess_is_attacked(p_board,58,'b') THEN v_ok:=true; v_special:='castle_q'; END IF;
      IF side='b' AND p_from=4 AND p_to=6 AND position('k' in v_rights)>0
         AND p_board->>5='' AND p_board->>6=''
         AND p_board->>7='r'
         AND NOT public.chess_is_attacked(p_board,4,'w')
         AND NOT public.chess_is_attacked(p_board,5,'w')
         AND NOT public.chess_is_attacked(p_board,6,'w') THEN v_ok:=true; v_special:='castle_k'; END IF;
      IF side='b' AND p_from=4 AND p_to=2 AND position('q' in v_rights)>0
         AND p_board->>3='' AND p_board->>2='' AND p_board->>1=''
         AND p_board->>0='r'
         AND NOT public.chess_is_attacked(p_board,4,'w')
         AND NOT public.chess_is_attacked(p_board,3,'w')
         AND NOT public.chess_is_attacked(p_board,2,'w') THEN v_ok:=true; v_special:='castle_q'; END IF;
    END IF;
  END IF;

  IF NOT v_ok THEN RETURN jsonb_build_object('ok',false,'error','Movimiento ilegal'); END IF;

  v_board := jsonb_set(v_board,ARRAY[p_from::text],to_jsonb(''::text),false);
  IF v_special='en_passant' THEN
    v_board := jsonb_set(v_board,ARRAY[(fr*8+tc)::text],to_jsonb(''::text),false);
  END IF;
  IF v_special='castle_k' THEN
    IF side='w' THEN
      v_board := jsonb_set(v_board,ARRAY['63'],to_jsonb(''::text),false);
      v_board := jsonb_set(v_board,ARRAY['61'],to_jsonb('R'::text),false);
    ELSE
      v_board := jsonb_set(v_board,ARRAY['7'],to_jsonb(''::text),false);
      v_board := jsonb_set(v_board,ARRAY['5'],to_jsonb('r'::text),false);
    END IF;
  ELSIF v_special='castle_q' THEN
    IF side='w' THEN
      v_board := jsonb_set(v_board,ARRAY['56'],to_jsonb(''::text),false);
      v_board := jsonb_set(v_board,ARRAY['59'],to_jsonb('R'::text),false);
    ELSE
      v_board := jsonb_set(v_board,ARRAY['0'],to_jsonb(''::text),false);
      v_board := jsonb_set(v_board,ARRAY['3'],to_jsonb('r'::text),false);
    END IF;
  END IF;

  mid := piece;
  IF t='p' AND ((side='w' AND tr=0) OR (side='b' AND tr=7)) THEN
    mid := CASE WHEN side='w' THEN upper(v_prom) ELSE lower(v_prom) END;
  END IF;
  v_board := jsonb_set(v_board,ARRAY[p_to::text],to_jsonb(mid),false);

  IF orig_piece='K' THEN v_rights:=replace(replace(v_rights,'K',''),'Q','');
  ELSIF orig_piece='k' THEN v_rights:=replace(replace(v_rights,'k',''),'q','');
  ELSIF orig_piece='R' THEN
    IF p_from=63 THEN v_rights:=replace(v_rights,'K',''); END IF;
    IF p_from=56 THEN v_rights:=replace(v_rights,'Q',''); END IF;
  ELSIF orig_piece='r' THEN
    IF p_from=7 THEN v_rights:=replace(v_rights,'k',''); END IF;
    IF p_from=0 THEN v_rights:=replace(v_rights,'q',''); END IF;
  END IF;
  IF target='R' THEN
    IF p_to=63 THEN v_rights:=replace(v_rights,'K',''); END IF;
    IF p_to=56 THEN v_rights:=replace(v_rights,'Q',''); END IF;
  ELSIF target='r' THEN
    IF p_to=7 THEN v_rights:=replace(v_rights,'k',''); END IF;
    IF p_to=0 THEN v_rights:=replace(v_rights,'q',''); END IF;
  END IF;
  IF v_special='castle_k' THEN
    IF side='w' THEN v_rights:=replace(replace(v_rights,'K',''),'Q',''); ELSE v_rights:=replace(replace(v_rights,'k',''),'q',''); END IF;
  ELSIF v_special='castle_q' THEN
    IF side='w' THEN v_rights:=replace(replace(v_rights,'K',''),'Q',''); ELSE v_rights:=replace(replace(v_rights,'k',''),'q',''); END IF;
  END IF;

  IF t='p' AND abs(dr)=2 THEN
    v_ep := (p_from+p_to)/2;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,'board',v_board,'rights',v_rights,'en_passant',v_ep,
    'piece',orig_piece,'captured',coalesce(v_capture,''),'special',v_special,
    'promotion',CASE WHEN v_prom IN ('q','r','b','n') THEN v_prom ELSE '' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_has_legal_move(p_board jsonb,p_side text,p_castling text,p_en_passant integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE from_i integer; to_i integer; piece text; cand jsonb; king integer; promotion text;
BEGIN
  FOR from_i IN 0..63 LOOP
    piece:=p_board->>from_i;
    IF public.chess_piece_color(piece)<>p_side THEN CONTINUE; END IF;
    FOR to_i IN 0..63 LOOP
      promotion := CASE WHEN lower(piece)='p' AND ((p_side='w' AND to_i/8=0) OR (p_side='b' AND to_i/8=7)) THEN 'q' ELSE '' END;
      cand:=public.chess_apply_candidate(p_board,from_i,to_i,promotion,p_castling,p_en_passant);
      IF coalesce((cand->>'ok')::boolean,false) THEN
        king:=public.chess_find_king(cand->'board',p_side);
        IF king>=0 AND NOT public.chess_is_attacked(cand->'board',king,CASE WHEN p_side='w' THEN 'b' ELSE 'w' END) THEN
          RETURN true;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_position_key(p_board jsonb,p_turn text,p_castling text,p_en_passant integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce((SELECT string_agg(x, '' ORDER BY ord) FROM jsonb_array_elements_text(p_board) WITH ORDINALITY t(x,ord)),'')
    || '|' || p_turn || '|' || coalesce(p_castling,'-') || '|' || p_en_passant::text;
$$;

CREATE OR REPLACE FUNCTION public.chess_insufficient_material(p_board jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE i integer; piece text; nonk integer:=0; minors integer:=0; bishops integer:=0; bishop_color integer:=-1; same_bishop_color boolean:=true;
BEGIN
  FOR i IN 0..63 LOOP
    piece:=p_board->>i;
    IF piece='' OR lower(piece)='k' THEN CONTINUE; END IF;
    nonk:=nonk+1;
    IF lower(piece) IN ('b','n') THEN minors:=minors+1; ELSE RETURN false; END IF;
    IF lower(piece)='b' THEN
      bishops:=bishops+1;
      IF bishop_color=-1 THEN bishop_color:=(i/8+i%8)%2;
      ELSIF bishop_color<>((i/8+i%8)%2) THEN same_bishop_color:=false; END IF;
    END IF;
  END LOOP;
  IF nonk=0 THEN RETURN true; END IF;
  IF nonk=1 AND minors=1 THEN RETURN true; END IF;
  IF nonk=bishops AND bishops>0 AND same_bishop_color THEN RETURN true; END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_public_player(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles%rowtype; v_shop jsonb;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'rarity',i.rarity) ORDER BY i.category,i.sort_order),'[]'::jsonb)
  INTO v_shop
  FROM public.shop_inventory si
  JOIN public.shop_items i ON i.id=si.item_id
  WHERE si.user_id=p_user_id AND si.equipped AND i.active;
  RETURN jsonb_build_object('id',p.id,'username',p.username,'level',greatest(1,coalesce(p.level,1)),'avatar_id',coalesce(p.avatar_id,'avatar_01'),'shop_cosmetics',v_shop);
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_state_json(
  p_room public.chess_games,
  p_uid uuid,
  p_white_ms integer,
  p_black_ms integer
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id',p_room.id,'status',p_room.status,'stake',p_room.stake,'pot',p_room.pot,
    'white_player',public.chess_public_player(p_room.white_player_id),
    'black_player',public.chess_public_player(p_room.black_player_id),
    'me',public.chess_public_player(p_uid),
    'turn_user_id',p_room.turn_user_id,'white_ms',greatest(0,p_white_ms),'black_ms',greatest(0,p_black_ms),
    'turn_started_at',p_room.turn_started_at,'board',p_room.board,'castling',p_room.castling,
    'en_passant',p_room.en_passant,'last_move',p_room.last_move,'winner_id',p_room.winner_id,'result',p_room.result,
    'move_number',p_room.move_number,'halfmove_clock',p_room.halfmove_clock,
    'check_side',CASE
      WHEN p_room.status='live' AND p_room.turn_user_id=p_room.white_player_id
        AND public.chess_is_attacked(p_room.board,public.chess_find_king(p_room.board,'w'),'b') THEN 'w'
      WHEN p_room.status='live' AND p_room.turn_user_id=p_room.black_player_id
        AND public.chess_is_attacked(p_room.board,public.chess_find_king(p_room.board,'b'),'w') THEN 'b'
      ELSE '' END
  );
$$;

CREATE OR REPLACE FUNCTION public.chess_finish_winner(p_room_id uuid,p_winner uuid,p_result text,p_detail text)
RETURNS public.chess_games LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.chess_games%rowtype; loser uuid;
BEGIN
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida no existe'; END IF;
  IF r.status='finished' THEN RETURN r; END IF;
  loser:=CASE WHEN r.white_player_id=p_winner THEN r.black_player_id ELSE r.white_player_id END;
  UPDATE public.chess_games SET status='finished',winner_id=p_winner,result=p_result,turn_user_id=NULL,updated_at=now() WHERE id=p_room_id RETURNING * INTO r;
  UPDATE public.profiles SET coins=coins+r.pot WHERE id=p_winner;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  SELECT p.id,p.username,'Ajedrez',r.stake,r.pot,r.stake,p_detail FROM public.profiles p WHERE p.id=p_winner;
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  SELECT p.id,p.username,'Ajedrez',r.stake,0,-r.stake,p_result FROM public.profiles p WHERE p.id=loser;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_finish_draw(p_room_id uuid,p_result text,p_detail text)
RETURNS public.chess_games LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.chess_games%rowtype;
BEGIN
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida no existe'; END IF;
  IF r.status='finished' THEN RETURN r; END IF;
  UPDATE public.chess_games SET status='finished',winner_id=NULL,result=p_result,turn_user_id=NULL,updated_at=now() WHERE id=p_room_id RETURNING * INTO r;
  UPDATE public.profiles SET coins=coins+r.stake WHERE id IN (r.white_player_id,r.black_player_id);
  INSERT INTO public.bets(user_id,username,game,bet,payout,delta,detail)
  SELECT p.id,p.username,'Ajedrez',r.stake,r.stake,0,p_detail FROM public.profiles p WHERE p.id IN (r.white_player_id,r.black_player_id);
  RETURN r;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.chess_list_rooms(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); outjson jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sesión no válida'; END IF;
  DELETE FROM public.chess_games WHERE status='waiting' AND created_at<now()-interval '30 minutes';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'stake',g.stake,'created_at',g.created_at,'host',public.chess_public_player(g.host_id)) ORDER BY g.created_at ASC),'[]'::jsonb)
    INTO outjson FROM public.chess_games g WHERE g.status='waiting' AND g.host_id<>uid;
  RETURN outjson;
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_join_room(p_token text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); r public.chess_games%rowtype; c1 integer; c2 integer; white_id uuid; black_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sala ya no existe'; END IF;
  IF r.status<>'waiting' THEN RAISE EXCEPTION 'La sala ya está ocupada'; END IF;
  IF r.host_id=uid THEN RAISE EXCEPTION 'No puedes entrar en tu propia sala'; END IF;
  IF EXISTS(SELECT 1 FROM public.chess_games WHERE (host_id=uid OR guest_id=uid) AND status IN ('waiting','starting','live')) THEN RAISE EXCEPTION 'Ya tienes otra partida de ajedrez activa'; END IF;
  PERFORM 1 FROM public.profiles WHERE id IN (r.host_id,uid) ORDER BY id FOR UPDATE;
  SELECT coins INTO c1 FROM public.profiles WHERE id=r.host_id;
  SELECT coins INTO c2 FROM public.profiles WHERE id=uid;
  IF c1<r.stake THEN RAISE EXCEPTION 'El creador ya no tiene saldo suficiente'; END IF;
  IF c2<r.stake THEN RAISE EXCEPTION 'No tienes suficientes monedas para entrar en esta partida'; END IF;
  UPDATE public.profiles SET coins=coins-r.stake WHERE id IN (r.host_id,uid);
  IF random()<0.5 THEN white_id:=r.host_id; black_id:=uid; ELSE white_id:=uid; black_id:=r.host_id; END IF;
  UPDATE public.chess_games SET guest_id=uid,pot=r.stake*2,status='starting',white_player_id=white_id,black_player_id=black_id,turn_user_id=NULL,white_ms=300000,black_ms=300000,turn_started_at=NULL,last_move=NULL,winner_id=NULL,result=NULL,board=public.chess_initial_board(),castling='KQkq',en_passant=-1,halfmove_clock=0,move_number=1,position_history=jsonb_build_array(public.chess_position_key(public.chess_initial_board(),'w','KQkq',-1)),updated_at=now() WHERE id=p_room_id RETURNING * INTO r;
  RETURN public.chess_state_json(r,uid,300000,300000);
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_begin(p_token text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); r public.chess_games%rowtype;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida no existe'; END IF;
  IF r.host_id<>uid AND r.guest_id<>uid THEN RAISE EXCEPTION 'No formas parte de esta partida'; END IF;
  IF r.status='live' THEN RETURN public.chess_state_json(r,uid,r.white_ms,r.black_ms); END IF;
  IF r.status<>'starting' THEN RAISE EXCEPTION 'La partida no está preparada'; END IF;
  UPDATE public.chess_games SET status='live',turn_user_id=r.white_player_id,turn_started_at=clock_timestamp(),updated_at=now() WHERE id=p_room_id RETURNING * INTO r;
  RETURN public.chess_state_json(r,uid,300000,300000);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.chess_move(p_token text,p_room_id uuid,p_from integer,p_to integer,p_promotion text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); r public.chess_games%rowtype; elapsed bigint; w integer; b integer; side text; cand jsonb; king integer; opp text; next_uid uuid; next_side text; next_king integer; next_check boolean; legal boolean; new_half integer; hist jsonb; next_key text; count_key integer; result_room public.chess_games%rowtype; captured text; piece text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida no existe'; END IF;
  IF r.status<>'live' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  IF r.turn_user_id<>uid THEN RAISE EXCEPTION 'No es tu turno'; END IF;

  w:=r.white_ms; b:=r.black_ms;
  elapsed:=floor(extract(epoch from (clock_timestamp()-r.turn_started_at))*1000);
  IF uid=r.white_player_id THEN w:=greatest(0,w-elapsed); IF w<=0 THEN result_room:=public.chess_finish_winner(r.id,r.black_player_id,'timeout','Victoria por tiempo'); RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms); END IF;
  ELSE b:=greatest(0,b-elapsed); IF b<=0 THEN result_room:=public.chess_finish_winner(r.id,r.white_player_id,'timeout','Victoria por tiempo'); RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms); END IF; END IF;

  side:=CASE WHEN uid=r.white_player_id THEN 'w' ELSE 'b' END;
  opp:=CASE WHEN side='w' THEN 'b' ELSE 'w' END;
  cand:=public.chess_apply_candidate(r.board,p_from,p_to,p_promotion,r.castling,r.en_passant);
  IF NOT coalesce((cand->>'ok')::boolean,false) THEN RAISE EXCEPTION '%',coalesce(cand->>'error','Movimiento ilegal'); END IF;
  king:=public.chess_find_king(cand->'board',side);
  IF king<0 OR public.chess_is_attacked(cand->'board',king,opp) THEN RAISE EXCEPTION 'No puedes dejar a tu rey en jaque'; END IF;

  piece:=cand->>'piece'; captured:=cand->>'captured';
  new_half:=CASE WHEN lower(piece)='p' OR captured<>'' THEN 0 ELSE r.halfmove_clock+1 END;
  hist:=coalesce(r.position_history,'[]'::jsonb);
  next_side:=opp;
  next_key:=public.chess_position_key(cand->'board',next_side,cand->>'rights',(cand->>'en_passant')::integer);
  hist:=hist||jsonb_build_array(next_key);
  count_key:=0;
  SELECT count(*) INTO count_key FROM jsonb_array_elements_text(hist) x WHERE x=next_key;

  next_uid:=CASE WHEN next_side='w' THEN r.white_player_id ELSE r.black_player_id END;
  next_king:=public.chess_find_king(cand->'board',next_side);
  next_check:=next_king>=0 AND public.chess_is_attacked(cand->'board',next_king,side);

  UPDATE public.chess_games
  SET board=cand->'board',castling=cand->>'rights',en_passant=(cand->>'en_passant')::integer,
      white_ms=w,black_ms=b,turn_user_id=next_uid,turn_started_at=clock_timestamp(),
      halfmove_clock=new_half,move_number=r.move_number+1,position_history=hist,
      last_move=jsonb_build_object('from',p_from,'to',p_to,'piece',piece,'captured',coalesce(captured,''),'promotion',coalesce(cand->>'promotion','')),
      updated_at=now()
  WHERE id=r.id RETURNING * INTO r;

  legal:=public.chess_has_legal_move(r.board,next_side,r.castling,r.en_passant);
  IF NOT legal THEN
    IF next_check THEN
      result_room:=public.chess_finish_winner(r.id,uid,'checkmate','Jaque mate');
      RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms);
    ELSE
      result_room:=public.chess_finish_draw(r.id,'stalemate','Ahogado');
      RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms);
    END IF;
  END IF;

  IF new_half>=100 THEN
    result_room:=public.chess_finish_draw(r.id,'50move','Regla de las 50 jugadas');
    RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms);
  END IF;

  IF public.chess_insufficient_material(r.board) THEN
    result_room:=public.chess_finish_draw(r.id,'insufficient','Material insuficiente');
    RETURN public.chess_state_json(result_room,uid,result_room.white_ms,result_room.black_ms);
  END IF;

  RETURN public.chess_state_json(r,uid,w,b);
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_resign(p_token text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); r public.chess_games%rowtype; winner uuid; settled public.chess_games%rowtype;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT * INTO r FROM public.chess_games WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La partida no existe'; END IF;
  IF r.host_id<>uid AND r.guest_id<>uid THEN RAISE EXCEPTION 'No formas parte de esta partida'; END IF;
  IF r.status<>'live' THEN RAISE EXCEPTION 'La partida no está activa'; END IF;
  winner:=CASE WHEN uid=r.white_player_id THEN r.black_player_id ELSE r.white_player_id END;
  settled:=public.chess_finish_winner(r.id,winner,'resign','Victoria por abandono');
  RETURN public.chess_state_json(settled,uid,settled.white_ms,settled.black_ms);
END;
$$;

CREATE OR REPLACE FUNCTION public.chess_cancel_room(p_token text,p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid:=public.app_user_id(p_token); host uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  SELECT host_id INTO host FROM public.chess_games WHERE id=p_room_id;
  IF host IS NULL THEN RETURN jsonb_build_object('status','none'); END IF;
  IF host<>uid THEN RAISE EXCEPTION 'Solo el creador puede cancelar la sala'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.chess_games WHERE id=p_room_id AND status='waiting') THEN RAISE EXCEPTION 'La sala ya está en partida'; END IF;
  DELETE FROM public.chess_games WHERE id=p_room_id;
  RETURN jsonb_build_object('status','cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.chess_start_room(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_list_rooms(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_join_room(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_begin(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_get_state(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_move(text,uuid,integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_resign(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chess_cancel_room(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chess_start_room(text,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_list_rooms(text) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_join_room(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_begin(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_get_state(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_move(text,uuid,integer,integer,text) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_resign(text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.chess_cancel_room(text,uuid) TO anon;

NOTIFY pgrst,'reload schema';
