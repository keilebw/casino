# The Pedro & Paco Casino V37.1

Carreras multijugador: 6 coches, apuestas sin límite propio de juego (solo saldo disponible), carrera sincronizada y premios 1º x10, 2º x3 y 3º x1 (devolución).

V37.1 mejora la animación del movimiento con interpolación en el cliente y hace las probabilidades simétricas: el servidor genera una permutación uniforme de los seis coches, así cada coche tiene la misma probabilidad de acabar 1º, 2º, 3º, 4º, 5º o 6º.

El SQL de actualización se encuentra en `supabase/53_v37_1_racing_fair_odds_rewards.sql`.
