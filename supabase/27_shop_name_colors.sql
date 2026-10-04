-- ============================================================
-- FODO SHOP V35.2 — COLORES DE NOMBRE
-- Ejecutar DESPUÉS de 25_fodo_shop.sql y 26_shop_public_cosmetics.sql.
-- Los títulos dejan de controlar el color del nombre; se crea una
-- categoría independiente para colores de nombre.
-- ============================================================

alter table public.shop_items drop constraint if exists shop_items_category_check;
alter table public.shop_items
  add constraint shop_items_category_check
  check (category in ('frame','background','title','effect','name_color'));

insert into public.shop_items (id, name, category, rarity, price, description, sort_order) values
  ('color_gold', 'Gold Name', 'name_color', 'common', 120, 'Tu nombre aparece en dorado clásico.', 10),
  ('color_ice', 'Ice Name', 'name_color', 'rare', 300, 'Azul hielo limpio y luminoso.', 20),
  ('color_mint', 'Mint Name', 'name_color', 'rare', 450, 'Verde menta con un brillo suave.', 30),
  ('color_crimson', 'Crimson Name', 'name_color', 'epic', 650, 'Rojo carmesí para destacar en el chat.', 40),
  ('color_violet', 'Violet Name', 'name_color', 'epic', 800, 'Violeta premium con halo sutil.', 50),
  ('color_sapphire', 'Sapphire Name', 'name_color', 'legendary', 1100, 'Azul zafiro intenso y elegante.', 60)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  rarity = excluded.rarity,
  price = excluded.price,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true;

notify pgrst, 'reload schema';
