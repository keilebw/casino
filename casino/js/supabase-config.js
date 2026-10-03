// ============================================================
// CONFIGURACIÓN DE SUPABASE
//
// 1. Entra en tu proyecto de Supabase.
// 2. Ve a Settings > API Keys.
// 3. Copia Project URL y Publishable key.
// 4. Pégalos abajo.
//
// IMPORTANTE: NO pongas aquí la secret key ni service_role.
// ============================================================

const SUPABASE_URL = 'https://kifxbmvsbbyhmmadgcbs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pNMMC8jYF6hZl0DhmQtpoA_0yDRePYY';

if (
  SUPABASE_URL.includes('PEGA_AQUI') ||
  SUPABASE_PUBLISHABLE_KEY.includes('PEGA_AQUI')
) {
  console.warn('Supabase todavía no está configurado en js/supabase-config.js');
}

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
