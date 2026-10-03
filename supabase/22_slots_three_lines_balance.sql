-- ============================================================
-- TRAGAPERRAS — V33.3 / 3 LÍNEAS CONSISTENTES
--
-- La apuesta es TOTAL y se reparte entre las líneas activas.
-- 1 FP  -> línea superior
-- 2 FP  -> superior + central
-- 3..100 FP -> las 3 líneas
--
-- No se cambian probabilidades ni premios respecto a la versión
-- balanceada anterior. RTP teórico aproximado: 94,95%.
-- ============================================================
create or replace function public.play_slots(p_token text, p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_username text;
  v_coins integer;
  v_symbols text[] := array['CHERRY','LEMON','ORANGE','GRAPE','WATERMELON','BAR','SEVEN'];
  v_weights integer[] := array[32,26,20,14,9,5,2];
  v_total_weight integer := 108;
  v_roll integer;
  v_index integer;
  v_rows text[] := array[]::text[];
  v_line_symbols text[];
  v_line_payout integer;
  v_payout integer := 0;
  v_delta integer;
  v_line_results jsonb := '[]'::jsonb;
  v_detail text;
  v_line_stakes integer[] := array[]::integer[];
  v_active_lines integer := least(3, p_bet);
  v_base integer;
  v_extra integer;
  v_stake integer;
  v_mult integer;
  i integer;
  r integer;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión'; end if;
  if p_bet is null or p_bet < 1 or p_bet > 100 then raise exception 'La apuesta total debe estar entre 1 y 100 FP'; end if;
  select p.coins, p.username into v_coins, v_username from public.profiles p where p.id = v_uid for update;
  if v_coins is null then raise exception 'No existe tu perfil'; end if;
  if v_coins < p_bet then raise exception 'No tienes suficientes FP para esa apuesta'; end if;

  v_base := p_bet / v_active_lines;
  v_extra := p_bet % v_active_lines;
  for i in 1..v_active_lines loop
    v_line_stakes := array_append(v_line_stakes, v_base + case when i <= v_extra then 1 else 0 end);
  end loop;

  for i in 1..9 loop
    loop
      v_roll := get_byte(extensions.gen_random_bytes(1), 0);
      exit when v_roll < 216;
    end loop;
    v_roll := v_roll % v_total_weight;
    v_index := 1;
    while v_roll >= v_weights[v_index] loop
      v_roll := v_roll - v_weights[v_index];
      v_index := v_index + 1;
    end loop;
    v_rows := array_append(v_rows, v_symbols[v_index]);
  end loop;

  for r in 0..2 loop
    v_line_symbols := array[v_rows[(r * 3) + 1], v_rows[(r * 3) + 2], v_rows[(r * 3) + 3]];
    if r < v_active_lines then v_stake := v_line_stakes[r + 1]; else v_stake := 0; end if;
    v_mult := 0;
    if v_stake > 0 then
      if v_line_symbols[1] = v_line_symbols[2] and v_line_symbols[2] = v_line_symbols[3] then
        v_mult := case v_line_symbols[1]
          when 'SEVEN' then 100
          when 'BAR' then 50
          when 'WATERMELON' then 32
          when 'GRAPE' then 20
          when 'ORANGE' then 14
          when 'LEMON' then 10
          when 'CHERRY' then 7
          else 0 end;
      elsif v_line_symbols[1] = v_line_symbols[2] or v_line_symbols[2] = v_line_symbols[3] or v_line_symbols[1] = v_line_symbols[3] then
        v_mult := 1;
      end if;
    end if;
    v_line_payout := v_stake * v_mult;
    v_payout := v_payout + v_line_payout;
    v_line_results := v_line_results || jsonb_build_object(
      'line', r + 1,
      'active', r < v_active_lines,
      'stake', v_stake,
      'symbols', to_jsonb(v_line_symbols),
      'multiplier', v_mult,
      'payout', v_line_payout
    );
  end loop;

  v_delta := v_payout - p_bet;
  update public.profiles set coins = coins - p_bet + v_payout where id = v_uid;
  v_detail := format('Líneas: %s / %s / %s · apuesta total %s FP · líneas activas %s · premio %s FP',
    v_rows[1] || ' · ' || v_rows[2] || ' · ' || v_rows[3],
    v_rows[4] || ' · ' || v_rows[5] || ' · ' || v_rows[6],
    v_rows[7] || ' · ' || v_rows[8] || ' · ' || v_rows[9],
    p_bet, v_active_lines, v_payout);
  insert into public.bets (user_id, username, game, bet, payout, delta, detail)
  values (v_uid, v_username, 'Tragaperras', p_bet, v_payout, v_delta, v_detail);
  return jsonb_build_object(
    'grid', to_jsonb(v_rows), 'lines', v_line_results, 'bet', p_bet,
    'payout', v_payout, 'delta', v_delta, 'active_lines', v_active_lines,
    'line_stakes', to_jsonb(v_line_stakes),
    'coins', (select coins from public.profiles where id = v_uid), 'detail', v_detail);
end;
$$;
revoke all on function public.play_slots(text, integer) from public, anon, authenticated;
grant execute on function public.play_slots(text, integer) to anon;
notify pgrst, 'reload schema';
