// ============================================================
// CHAT EN DIRECT
// ============================================================

let chatChannel = null;
let chatReady = false;

function renderChatMessage(row) {
  const box = document.createElement('div');
  box.className = 'chat-message';

  const level = getLevelForUser(row.user_id);
  const avatar = avatarWithLevelImg(row.avatar_id || 'avatar_01', level, 'chat-avatar', 'avatar-level-wrap chat-avatar-wrap', row.username || 'jugador');
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'profile-link chat-name';
  name.dataset.profileUsername = row.username || '';
  name.textContent = row.username || 'jugador';

  const time = document.createElement('small');
  time.textContent = new Date(row.created_at).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const text = document.createElement('span');
  text.textContent = row.message;

  box.append(avatar, name, time, text);
  return box;
}

async function loadChatMessages() {
  const { data, error } = await supabaseClient
    .from('chat_messages')
    .select('id, username, avatar_id, message, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(error);
    Casino.toast('No se ha podido cargar el chat.');
    return;
  }

  const container = $('#chat-messages');
  container.replaceChildren(...data.reverse().map(renderChatMessage));
  container.scrollTop = container.scrollHeight;
}

async function initChat() {
  if (!Casino.user) return;

  if (!chatReady) {
    await loadChatMessages();

    chatChannel = supabaseClient
      .channel('casino-chat-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages'
        },
        payload => {
          const container = $('#chat-messages');
          container.append(renderChatMessage(payload.new));
          container.scrollTop = container.scrollHeight;
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.error('No se pudo suscribir al chat.');
        }
      });

    chatReady = true;
  }
}

$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();

  if (!Casino.user || !Casino.token) return;

  const input = $('#chat-input');
  const message = input.value.trim();
  if (!message) return;

  const { error } = await supabaseClient.rpc('send_chat_message', {
    p_token: Casino.token,
    p_message: message
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message || 'No se ha podido enviar el mensaje.');
    return;
  }

  input.value = '';
  input.focus();
});

window.initChat = initChat;
