-- ============================================================
-- THE PEDRO & PACO CASINO — FODO SHOP EXPANSION V35.14
-- Nuevos fondos y tema DARK RGB animado.
-- Cosmético únicamente: no modifica probabilidades ni XP.
-- Ejecutar DESPUÉS de los SQL anteriores de la tienda.
-- ============================================================

insert into public.shop_items (id, name, category, rarity, price, description, sort_order, active) values
  ('bg_midnight', 'Midnight Silk', 'background', 'rare', 1250, 'Negro azulado elegante con profundidad nocturna.', 50, true),
  ('bg_crimson', 'Crimson Noire', 'background', 'epic', 1650, 'Rojo vino oscuro inspirado en una sala privada.', 60, true),
  ('bg_sapphire', 'Sapphire Vault', 'background', 'epic', 2100, 'Azul zafiro profundo con brillo de caja fuerte.', 70, true),
  ('bg_rgb_nexus', 'RGB Nexus', 'background', 'legendary', 3500, 'Tema oscuro con bordes RGB animados por todo el casino.', 80, true)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  rarity = excluded.rarity,
  price = excluded.price,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = excluded.active;
