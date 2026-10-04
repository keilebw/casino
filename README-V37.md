# The Pedro & Paco Casino — V37 · Carreras Multijugador

## Nuevo juego: CARRERAS

Se ha añadido un juego multijugador de carreras con 6 coches:

- VORTEX
- NITRO
- BLAZE
- PHANTOM
- COMET
- ROCKET

### Flujo

1. Crear una sala o entrar en una sala abierta.
2. El creador abre la fase de apuestas cuando ya hay al menos 2 jugadores.
3. Cada jugador elige uno de los 6 coches y prepara cualquier cantidad de FP disponible, sin límite específico del juego.
4. Al confirmar todas las apuestas, el servidor fija una carrera común y comienza una cuenta atrás de 3 segundos.
5. Los 6 coches corren de forma sincronizada y animada.
6. Premios:
   - 1º: x10
   - 2º: x3
   - 3º: x2
7. El servidor liquida las ganancias y registra el resultado en el historial.

## Robustez

- El resultado y el orden de llegada se calculan en Supabase.
- Las apuestas se descuentan y las recompensas se abonan en el servidor.
- Las salas de espera/apuestas abandonadas se limpian automáticamente.
- La liquidación no depende de que el navegador permanezca abierto.
- Se evita conservar apuestas antiguas después de un reembolso.

## Base de datos

El SQL nuevo está en:

`supabase/52_v37_racing.sql`

Incluye las tablas `race_rooms` y `race_players`, las funciones RPC del juego y la tarea `race-maintenance-v37` para mantenimiento automático.

## Archivos principales

- `js/race-v37.js` — interfaz y animaciones de la carrera.
- `js/app-v37.js` — integración del nuevo juego con el selector de fichas y navegación.
- `css/style.css` — estilos encapsulados de Carreras.
- `index.html` — nueva pestaña CARRERAS dentro de Multijugador.

## Comprobaciones realizadas

- Todos los JavaScript pasan `node --check`.
- HTML validado estructuralmente y sin IDs duplicados.
- Referencias locales de scripts comprobadas.
- CSS comprobado con llaves balanceadas.
- Pruebas transaccionales del servidor para orden, posiciones, liquidación y reembolso.
