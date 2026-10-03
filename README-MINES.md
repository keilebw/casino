# Minas — V33.0 STABLE

Nueva partida individual añadida a The Pedro & Paco Casino.

## Diseño

- Tablero 5×5, 25 casillas.
- Selección de 1 a 24 minas.
- Las gemas seguras aumentan el multiplicador.
- Se puede cobrar después de cualquier gema.
- Encontrar una mina termina la ronda y deja la apuesta en 0 de cobro.
- Animaciones de apertura, mina, victoria y cobro.
- La partida activa se puede recuperar al volver a entrar.

## Balance

La escalera usa un modelo de 99% RTP teórico:

`0,99 × C(25, picks) / C(25-minas, picks)`

El número de minas cambia la volatilidad, no la ventaja teórica antes del redondeo. El juego limita la apuesta a **25 FP** y el premio máximo a **5.000 FP** para proteger la economía global del casino frente a resultados extremos.

Como bonus no monetario, las rachas de gemas seguras pueden conceder XP al cerrar una ronda:

- 3 gemas: +5 XP
- 6 gemas: +7 XP
- 10 gemas: +10 XP

## Supabase

Ejecuta `supabase/21_mines.sql` después de las migraciones que ya utilizas para perfiles/XP y el resto de juegos. No sustituye ninguna función existente.

La posición de las minas se genera y se conserva en Supabase. Mientras la partida está activa, la función de recuperación no devuelve las posiciones de las minas al navegador.
