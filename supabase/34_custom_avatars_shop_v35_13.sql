-- ============================================================
-- THE PEDRO & PACO CASINO — 12 AVATARES PERSONALIZADOS
-- V35.13
-- Ejecutar DESPUÉS de 25_fodo_shop.sql y las migraciones de la tienda.
-- ============================================================

alter table public.shop_items drop constraint if exists shop_items_category_check;
alter table public.shop_items
  add constraint shop_items_category_check
  check (category in ('frame','background','title','effect','name_color','avatar'));

insert into public.shop_items (id, name, category, rarity, price, description, sort_order)
values
  ('avatar_personalizado_1', 'Custom Avatar 01', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_1.png por tu propia imagen.', 10),
  ('avatar_personalizado_2', 'Custom Avatar 02', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_2.png por tu propia imagen.', 20),
  ('avatar_personalizado_3', 'Custom Avatar 03', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_3.png por tu propia imagen.', 30),
  ('avatar_personalizado_4', 'Custom Avatar 04', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_4.png por tu propia imagen.', 40),
  ('avatar_personalizado_5', 'Custom Avatar 05', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_5.png por tu propia imagen.', 50),
  ('avatar_personalizado_6', 'Custom Avatar 06', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_6.png por tu propia imagen.', 60),
  ('avatar_personalizado_7', 'Custom Avatar 07', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_7.png por tu propia imagen.', 70),
  ('avatar_personalizado_8', 'Custom Avatar 08', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_8.png por tu propia imagen.', 80),
  ('avatar_personalizado_9', 'Custom Avatar 09', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_9.png por tu propia imagen.', 90),
  ('avatar_personalizado_10', 'Custom Avatar 10', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_10.png por tu propia imagen.', 100),
  ('avatar_personalizado_11', 'Custom Avatar 11', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_11.png por tu propia imagen.', 110),
  ('avatar_personalizado_12', 'Custom Avatar 12', 'avatar', 'epic', 1000, 'Avatar personalizado. Sustituye assets/avatars/avatar_personalizado_12.png por tu propia imagen.', 120)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  rarity = excluded.rarity,
  price = excluded.price,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true;

-- Solo los 12 avatares incluidos de serie son gratuitos.
-- Los personalizados deben estar comprados en shop_inventory.
create or replace function public.update_profile_avatar(p_token text, p_avatar_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_avatar text := lower(trim(coalesce(p_avatar_id, '')));
  v_row public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  if v_avatar = any(array[
    'avatar_01','avatar_02','avatar_03','avatar_04',
    'avatar_05','avatar_06','avatar_07','avatar_08',
    'avatar_09','avatar_10','avatar_11','avatar_12'
  ]::text[]) then
    null;
  elsif v_avatar ~ '^avatar_personalizado_(1|2|3|4|5|6|7|8|9|10|11|12)$' then
    if not exists (
      select 1
      from public.shop_inventory si
      join public.shop_items i on i.id = si.item_id
      where si.user_id = v_uid
        and si.item_id = v_avatar
        and i.category = 'avatar'
        and i.active
    ) then
      raise exception 'Primero debes comprar este avatar en Fodo Shop';
    end if;
  else
    raise exception 'Avatar no válido';
  end if;

  update public.profiles
  set avatar_id = v_avatar
  where id = v_uid
  returning * into v_row;

  if not found then raise exception 'No existe tu perfil'; end if;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'coins', v_row.coins,
    'xp', v_row.xp,
    'level', v_row.level,
    'avatar_id', v_row.avatar_id
  );
end;
$$;

revoke all on function public.update_profile_avatar(text, text) from public, anon, authenticated;
grant execute on function public.update_profile_avatar(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
