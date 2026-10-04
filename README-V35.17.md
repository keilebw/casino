# The Pedro & Paco Casino — V35.17 STABLE

Optimización integral del frontend sin cambiar la lógica de juegos, economía ni Supabase.

- Ruleta: RAF consciente de visibilidad y delta-time; no corre continuamente cuando está fuera de la pestaña.
- Blackjack y Tragaperras: eliminados timers permanentes; actualización de controles bajo demanda.
- Fortuna: timer de cuenta atrás solo mientras la pestaña está activa.
- Cosméticos: eliminadas animaciones duplicadas en wrappers/imágenes.
- Chat: content-visibility para mensajes fuera de viewport.
- RGB Nexus: sustituida la variable heredada animada por una única capa RGB.
- Botones: el glow continuo pasa a hover/focus.
