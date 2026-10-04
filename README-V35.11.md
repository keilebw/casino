# The Pedro & Paco Casino — V35.11 STABLE

- Higher / Lower: maximum stake 150 FP.
- Minas: maximum stake 50 FP.
- UI limits are enforced by the frontend.
- Minas 50 FP is enforced by `21_mines.sql` and `32_bet_limits_v35_11.sql`.
- Higher / Lower 150 FP is enforced through `hilo_start_limited` in `32_bet_limits_v35_11.sql`.
- No other game balance or layout was changed.
