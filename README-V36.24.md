V36.24 — 4 EN RAYA + AJEDREZ ROBUSTEZ

CAMBIO VISUAL 4 EN RAYA
- Las posiciones del tablero son cuadradas y se distinguen de las fichas.
- Las fichas rojas y azules son circulares, más contrastadas, con borde y brillo, y están centradas en cada casilla.

CORRECCIÓN AJEDREZ
- Si una consulta de estado falla puntualmente, el sondeo vuelve a intentarlo.
- La pantalla de “SORTEANDO BLANCAS” desaparece en cuanto la partida entra en LIVE.
- El servidor puede activar automáticamente una partida STARTING tras unos segundos, evitando que un cliente quede congelado.
- Una partida STARTING abandonada durante más de 1 minuto se cierra y devuelve las dos apuestas, para no dejar registros colgados.
- Al volver a seleccionar Ajedrez con una partida abierta, se reanuda el sondeo del estado.

SUPABASE
La corrección de base de datos ya está aplicada en el proyecto actual. El ZIP incluye además supabase/51_v36_24_chess_start_fix.sql como parche independiente.
