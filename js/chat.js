// ============================================================
// CHAT EN DIRECTO — IDENTIDAD PÚBLICA POR MENSAJE
// Cada mensaje trae sus propios cosméticos desde Supabase.
// ============================================================

let chatChannel = null;
let chatReady = false;

function chatPublicItems(row) {
  if (Array.isArray(row?.shop_cosmetics) && row.shop_cosmetics.length) return row.shop_cosmetics;
  if (typeof window.getPublicShopItemsForUser === 'function') {
    const items = window.getPublicShopItemsForUser(row?.user_id);
    if (Array.isArray(items) && items.length) return items;
  }
  return Array.isArray(row?.shop_cosmetics) ? row.shop_cosmetics : [];
}

function chatCosmeticClasses(row) {
  const items = chatPublicItems(row);
  if (typeof window.cosmeticClassesForItems === 'function') {
    return window.cosmeticClassesForItems(items);
  }
  if (typeof window.cosmeticClassesForUser === 'function') {
    return window.cosmeticClassesForUser(row?.user_id);
  }
  return { background:'', frame:'', effect:'', title:'', titleText:'', nameColor:'' };
}

function renderChatMessage(row) {
  const items = chatPublicItems(row);
  const c = chatCosmeticClasses(row);
  const box = document.createElement('article');
  box.className = `chat-message chat-message-v2 ${c.background || ''} ${c.effect || ''}`.trim();
  box.dataset.userId = row.user_id || '';
  if (c.frame) box.dataset.shopFrame = c.frame.replace(/^shop-frame-/, '');
  if (c.effect) box.dataset.shopEffect = c.effect.replace(/^shop-effect-/, '');

  const level = Math.max(1, Number(row.level || getLevelForUser(row.user_id) || 1));
  const avatarId = row.avatar_id || getAvatarForUser(row.user_id) || 'avatar_01';

  const avatarHolder = document.createElement('span');
  avatarHolder.innerHTML = window.shopAvatarLevelHtml
    ? window.shopAvatarLevelHtml(row.user_id, avatarId, level, 'chat-avatar', row.username || 'jugador', items)
    : avatarLevelHtml(avatarId, level, 'chat-avatar', 'avatar-level-wrap chat-avatar-wrap', row.username || 'jugador');
  const avatar = avatarHolder.firstElementChild;

  const avatarSlot = document.createElement('div');
  avatarSlot.className = 'chat-avatar-slot-v2';
  if (avatar) avatarSlot.appendChild(avatar);

  const name = document.createElement('button');
  name.type = 'button';
  name.className = `profile-link chat-name ${c.nameColor || ''}`.trim();
  name.dataset.profileUsername = row.username || '';
  name.textContent = row.username || 'jugador';

  const title = document.createElement('span');
  title.className = `shop-public-title chat-title ${c.title || ''}`.trim();
  title.textContent = c.titleText || '';
  title.hidden = !c.titleText;

  const identity = document.createElement('div');
  identity.className = 'chat-identity-v2';
  identity.append(name);
  if (c.titleText) identity.append(title);

  const text = document.createElement('p');
  text.className = 'chat-message-text-v2';
  text.textContent = row.message || '';

  const content = document.createElement('div');
  content.className = 'chat-content-v2';
  content.append(identity, text);

  const time = document.createElement('time');
  time.className = 'chat-message-time-v2';
  const date = new Date(row.created_at);
  time.dateTime = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });

  box.append(avatarSlot, content, time);

  // Effect is visual and local to this single message. It never inherits #app styles.
  if (c.effect) {
    const fx = document.createElement('span');
    fx.className = `chat-cosmetic-effect-v2 ${c.effect}`;
    fx.setAttribute('aria-hidden', 'true');
    fx.innerHTML = '<i></i><i></i><i></i><b></b>';
    box.appendChild(fx);
  }

  return box;
}

function appendChatMessage(row) {
  const container = $('#chat-messages');
  if (!container || !row) return false;
  const id = row.id ? String(row.id) : '';
  if (id && container.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) return false;

  const message = renderChatMessage(row);
  if (id) message.dataset.messageId = id;
  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
  return true;
}

async function enrichChatRow(row) {
  if (!row?.user_id || (Array.isArray(row.shop_cosmetics) && row.shop_cosmetics.length)) return row;

  // Prefer the public cosmetics cache already loaded during login/shop init.
  const cachedItems = window.getPublicShopItemsForUser?.(row.user_id) || [];
  if (Array.isArray(cachedItems) && cachedItems.length) {
    const publicProfile = window.getPublicProfileById?.(row.user_id);
    return {
      ...row,
      avatar_id: publicProfile?.avatar_id || row.avatar_id,
      level: publicProfile?.level || row.level || 1,
      shop_cosmetics: cachedItems
    };
  }

  const { data, error } = await supabaseClient.rpc('shop_get_public_identity', {
    p_token: Casino.token,
    p_user_id: row.user_id
  });
  if (!error && data) {
    return {
      ...row,
      avatar_id: data.avatar_id || row.avatar_id,
      level: data.level || 1,
      shop_cosmetics: Array.isArray(data.shop_cosmetics) ? data.shop_cosmetics : []
    };
  }
  return row;
}

async function loadChatMessages() {
  if (!Casino.token) return;
  const { data, error } = await supabaseClient.rpc('chat_get_messages', { p_token: Casino.token });
  if (error) {
    console.error('[CHAT] Carga:', error);
    Casino.toast('No se ha podido cargar el chat.');
    return;
  }

  const container = $('#chat-messages');
  if (!container) return;
  container.replaceChildren();
  const rows = Array.isArray(data) ? data : [];
  const enrichedRows = await Promise.all(rows.map(enrichChatRow));
  enrichedRows.reverse().forEach(appendChatMessage);
}

async function initChat() {
  if (!Casino.user || !Casino.token) return;

  if (!chatReady) {
    await loadChatMessages();
    chatChannel = supabaseClient
      .channel('casino-chat-live')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages' }, async payload => {
        const row = await enrichChatRow(payload.new);
        appendChatMessage(row);
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') console.error('[CHAT] No se pudo suscribir al chat.');
      });
    chatReady = true;
  }
}

$('#chat-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!Casino.user || !Casino.token) return;

  const input = $('#chat-input');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;

  const { data, error } = await supabaseClient.rpc('send_chat_message', {
    p_token: Casino.token,
    p_message: message
  });

  if (error) {
    console.error('[CHAT] Envío:', error);
    Casino.toast(error.message || 'No se ha podido enviar el mensaje.');
    return;
  }

  appendChatMessage(data);
  input.value = '';
  input.focus();
});

window.initChat = initChat;
window.refreshChat = loadChatMessages;

window.addEventListener('casino:cosmetics-updated', () => loadChatMessages());
