-- V36.14 — Retirada completa de los dos juegos multijugador anteriores.
-- No modifica perfiles, cuentas, chat ni historial de apuestas.

DROP FUNCTION IF EXISTS public.ttt_cancel_match(text, uuid);
DROP FUNCTION IF EXISTS public.ttt_create_match(text);
DROP FUNCTION IF EXISTS public.ttt_create_match(text, integer);
DROP FUNCTION IF EXISTS public.ttt_join_match(text, uuid);
DROP FUNCTION IF EXISTS public.ttt_move(text, uuid, integer);
DROP FUNCTION IF EXISTS public.ttt_winner(jsonb);

DROP FUNCTION IF EXISTS public.poker_action(text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.poker_advance(uuid);
DROP FUNCTION IF EXISTS public.poker_award_hand(uuid, uuid);
DROP FUNCTION IF EXISTS public.poker_best_score(jsonb);
DROP FUNCTION IF EXISTS public.poker_category_name(integer);
DROP FUNCTION IF EXISTS public.poker_create_table(text, text, integer);
DROP FUNCTION IF EXISTS public.poker_create_table(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.poker_deck();
DROP FUNCTION IF EXISTS public.poker_get_state(text, uuid);
DROP FUNCTION IF EXISTS public.poker_join_table(text, uuid);
DROP FUNCTION IF EXISTS public.poker_leave_table(text, uuid);
DROP FUNCTION IF EXISTS public.poker_lobby_list(text);
DROP FUNCTION IF EXISTS public.poker_lobby_state(text, uuid);
DROP FUNCTION IF EXISTS public.poker_next_actionable_seat(uuid, integer);
DROP FUNCTION IF EXISTS public.poker_next_pending_seat(uuid, integer);
DROP FUNCTION IF EXISTS public.poker_next_seat(uuid, integer, boolean);
DROP FUNCTION IF EXISTS public.poker_next_seated_stack_seat(uuid, integer);
DROP FUNCTION IF EXISTS public.poker_public_state(uuid);
DROP FUNCTION IF EXISTS public.poker_rebuy(text, uuid);
DROP FUNCTION IF EXISTS public.poker_score5(jsonb);
DROP FUNCTION IF EXISTS public.poker_start_hand(text, uuid);
DROP FUNCTION IF EXISTS public.poker_sync(uuid, jsonb);

DROP TABLE IF EXISTS public.matches CASCADE;
DROP TABLE IF EXISTS public.poker_players CASCADE;
DROP TABLE IF EXISTS public.poker_private CASCADE;
DROP TABLE IF EXISTS public.poker_tables CASCADE;

NOTIFY pgrst, 'reload schema';
