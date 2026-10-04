# The Pedro & Paco Casino — V36.20

Nueva función multijugador: **Ajedrez 5+0**.

- Salas con apuesta usando las fichas del casino (1–5000 FP).
- Entrada de rival solo con saldo suficiente.
- Color blanco/negro asignado aleatoriamente en servidor; las blancas comienzan.
- Animación de sorteo de color al entrar el segundo jugador.
- 5 minutos por jugador, sin incremento.
- Reloj autoritativo en servidor; el navegador solo muestra una cuenta atrás suave.
- Reglas de ajedrez validadas en servidor: movimientos legales, jaque, jaque mate, enroque, captura al paso, promoción, ahogado, 50 jugadas y material insuficiente.
- Victoria entrega el bote completo; empate devuelve la apuesta a ambos.
- Rendirse entrega el bote al rival.
- Avatares, niveles, títulos, marcos, efectos y fondos equipados se muestran en los jugadores.
- Sincronización ligera por consultas periódicas (más rápida en partida, más lenta en lobby).
- El resto del casino y 4 en Raya no se modifican.

SQL: `supabase/49_v36_20_chess.sql`
