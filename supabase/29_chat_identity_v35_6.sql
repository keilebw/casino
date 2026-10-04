-- ============================================================
-- THE PEDRO & PACO CASINO — CHAT IDENTITY V35.6
-- Ejecutar DESPUÉS de 28_shop_public_identity_v35_5.sql.
-- Cada mensaje devuelve los cosméticos equipados por SU autor.
-- ============================================================

create or replace function public.shop_get_public_identity(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_row public.profiles%rowtype;
  v_shop jsonb;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  select * into v_row from public.profiles where id = p_user_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'category', i.category,
    'rarity', i.rarity
  ) order by i.category, i.sort_order), '[]'::jsonb)
  into v_shop
  from public.shop_inventory si
  join public.shop_items i on i.id = si.item_id
  where si.user_id = v_row.id and si.equipped and i.active;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'avatar_id', coalesce(v_row.avatar_id, 'avatar_01'),
    'level', greatest(1, coalesce(v_row.level, 1)),
    'shop_cosmetics', v_shop
  );
end;
$$;

create or replace function public.chat_get_messages(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'username', m.username,
        'avatar_id', coalesce(m.avatar_id, p.avatar_id, 'avatar_01'),
        'level', greatest(1, coalesce(p.level, 1)),
        'message', m.message,
        'created_at', m.created_at,
        'shop_cosmetics', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'category', i.category,
            'rarity', i.rarity
          ) order by i.category, i.sort_order)
          from public.shop_inventory si
          join public.shop_items i on i.id = si.item_id
          where si.user_id = m.user_id and si.equipped and i.active
        ), '[]'::jsonb)
      ) order by m.created_at desc
    )
    from (
      select id, user_id, username, avatar_id, message, created_at
      from public.chat_messages
      order by created_at desc
      limit 50
    ) m
    left join public.profiles p on p.id = m.user_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.send_chat_message(p_token text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.app_user_id(p_token);
  v_username text;
  v_avatar_id text;
  v_level integer;
  v_message text := left(trim(coalesce(p_message, '')), 300);
  v_row public.chat_messages%rowtype;
  v_shop jsonb;
begin
  if v_uid is null then raise exception 'Sesión no válida'; end if;
  if v_message = '' then raise exception 'El mensaje no puede estar vacío'; end if;

  select username, avatar_id, greatest(1, coalesce(level, 1))
  into v_username, v_avatar_id, v_level
  from public.profiles
  where id = v_uid;

  if v_username is null then raise exception 'No existe tu perfil'; end if;

  insert into public.chat_messages (user_id, username, avatar_id, message)
  values (v_uid, v_username, coalesce(v_avatar_id, 'avatar_01'), v_message)
  returning * into v_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'category', i.category,
    'rarity', i.rarity
  ) order by i.category, i.sort_order), '[]'::jsonb)
  into v_shop
  from public.shop_inventory si
  join public.shop_items i on i.id = si.item_id
  where si.user_id = v_uid and si.equipped and i.active;

  return jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'username', v_row.username,
    'avatar_id', v_row.avatar_id,
    'level', coalesce(v_level, 1),
    'message', v_row.message,
    'created_at', v_row.created_at,
    'shop_cosmetics', v_shop
  );
end;
$$;

revoke all on function public.shop_get_public_identity(text, uuid) from public, anon, authenticated;
grant execute on function public.shop_get_public_identity(text, uuid) to anon;
revoke all on function public.chat_get_messages(text) from public, anon, authenticated;
grant execute on function public.chat_get_messages(text) to anon;
revoke all on function public.send_chat_message(text, text) from public, anon, authenticated;
grant execute on function public.send_chat_message(text, text) to anon;

notify pgrst, 'reload schema';
