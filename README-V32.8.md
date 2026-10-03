# The Pedro & Paco Casino — V32.8 STABLE

Ajustes de interfaz y moneda visible:
- Perfil/saldo movidos más arriba para despejar el ranking.
- Moneda visible renombrada de CR a FP (Fodo Points).
- Tagline: GANA FODO POINTS - 100% CRÉDITOS VIRTUALES.
- Historial en vivo normaliza detalles antiguos que todavía contengan CR y los muestra como FP.

No requiere cambios SQL; el campo interno `coins` y las funciones existentes se mantienen para no romper compatibilidad con la base de datos.
