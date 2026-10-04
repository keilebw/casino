# The Pedro & Paco Casino — V36 STABLE

Versión V36 final del casino multijugador.

Cambios:
- Blackjack: sin límite específico de apuesta; solo limita el saldo disponible.
- Higher / Lower: máximo 1000 FP.
- Ficha de 1000 FP añadida; se mantienen 2000 FP y 5000 FP.
- Ruleta: la animación se reactiva al volver a la pestaña.
- Footer: `v36 • STABLE`, sin `keilebw`.
- Recursos locales versionados como `v36.1` para evitar caché antiguo.
- `js/supabase-config.js` ya apunta al proyecto Supabase correcto de este casino.

## Supabase

La corrección definitiva está en:

`supabase/37_v36_final_bet_limits.sql`

La misma corrección ya está aplicada en el proyecto Supabase.
