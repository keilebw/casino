# The Pedro & Paco Casino V36.7

Higher / Lower ha sido sustituido por **Ride the Bus**.

- 4 paradas: color, alta/baja, dentro/fuera y palo.
- Apuesta máxima: 1000 FP.
- Bote máximo: 5000 FP.
- Multiplicadores: x1,35 → x1,50 → x1,80 → x2,50.
- Se puede cobrar el bote después de cada acierto.
- Si fallas una parada, pierdes la apuesta inicial.
- El estado y los pagos se resuelven en Supabase.
- SQL del juego: `supabase/42_v36_6_ride_the_bus.sql`.


## V36.7
Ride the Bus: la primera carta comienza boca abajo; al elegir rojo o negro se revela esa misma carta y, si se acierta, pasa a ser la referencia de la siguiente ronda.
