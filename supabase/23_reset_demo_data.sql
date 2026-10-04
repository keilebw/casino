-- ============================================================
-- RESET DE DATOS DE PRUEBA — The Pedro & Paco Casino
--
-- USAR SOLO SI QUIERES DEJAR LA BASE COMO UNA INSTALACIÓN NUEVA.
-- ELIMINA PERMANENTEMENTE los datos de las cuentas de prueba,
-- sesiones, historial, chat y partidas.
--
-- Las tablas se buscan dinámicamente para evitar errores si alguna
-- no existe en tu proyecto. CASCADE elimina tablas dependientes.
-- ============================================================

DO $$
DECLARE
  v_name text;
  v_tables text[] := ARRAY[
    'chat_messages',
    'matches',
    'bets',
    'road_rush_games',
    'mines_games',
    'dinosaur_runs',
    'shop_inventory',
    'app_sessions',
    'profiles'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', v_name);
    END IF;
  END LOOP;
END
$$;

-- Después de ejecutar este script no habrá cuentas para iniciar sesión.
-- Crea una cuenta nueva desde la web.
