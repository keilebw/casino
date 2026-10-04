# The Pedro & Paco Casino — V37.2

## Carreras multijugador
- 7 coches jugables.
- Premios: 1º x5, 2º x3, 3º x1 (devolución íntegra).
- Sin límite de apuesta propio del juego: solo se comprueba el saldo disponible.
- La carrera se inicia cuando todos los jugadores de la sala han confirmado una apuesta.
- Orden final generado de forma uniforme: cualquier coche puede terminar en cualquiera de los 7 puestos.
- Cada coche tiene ritmos por tramos distintos para producir remontadas y adelantamientos visibles sin cambiar el resultado autoritativo del servidor.
- Animación cliente a 60 FPS con interpolación/extrapolación entre muestras del servidor.
- Mantenimiento automático de salas/carreras en Supabase mediante pg_cron.

## Archivos nuevos
- `js/race-v37.2.js`
- `supabase/54_v37_2_racing_7_cars_dynamic.sql`

## Validación
- JavaScript comprobado con `node --check`.
- Referencias locales y estructura HTML comprobadas.
- SQL V37.2 aplicado al proyecto Supabase y registrado como migración.
- Pruebas transaccionales de premios x5/x3/x1 y de orden de 7 coches.
