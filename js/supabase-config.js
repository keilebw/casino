// ============================================================
// CONFIGURACIÓN DE SUPABASE — THE PEDRO & PACO CASINO V36
// Proyecto: Casino online
// ============================================================

const SUPABASE_URL = 'https://kifxbmvsbbyhmmadgcbs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pNMMC8jYF6hZl0DhmQtpoA_0yDRePYY';

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
