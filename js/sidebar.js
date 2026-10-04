// ============================================================
// BARRA LATERAL - RANKING + APUESTAS DE JUGADORES ONLINE
// ============================================================

let sidebarInterval = null;
let heartbeatInterval = null;
let sidebarBusy = false;

function formatSideTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function profileAvatarMarkup(row, sizeClass = 'side-avatar') {
  const avatarId = row.avatar_id || (window.getPublicProfileById?.(row.id)?.avatar_id) || 'avatar_01';
  const publicProfile = row.id ? window.getPublicProfileById?.(row.id) : null;
  const publicItems = Array.isArray(row.shop_cosmetics) && row.shop_cosmetics.length
    ? row.shop_cosmetics
    : (Array.isArray(publicProfile?.shop_cosmetics) ? publicProfile.shop_cosmetics : null);
  const profileLevel = row.level || publicProfile?.level || (row.id ? window.getLevelForUser?.(row.id) : window.getLevelForUsername?.(row.username));
  if (window.shopAvatarLevelHtml) return window.shopAvatarLevelHtml(row.id, avatarId, profileLevel || 1, sizeClass, row.username || '', publicItems);
  return window.avatarLevelHtml
    ? window.avatarLevelHtml(avatarId, profileLevel || 1, sizeClass, `avatar-level-wrap ${sizeClass}-wrap`, row.username || '')
    : `<img class="${sizeClass}" src="${escapeHtml(window.avatarUrl?.(avatarId) || 'assets/avatars/avatar_01.svg')}" alt="" loading="lazy" draggable="false">`;
}

function profileNameButton(username, userId = '', itemsOverride = null) {
  const safeUsername = escapeHtml(username || 'jugador');
  const colorClass = window.shopNameColorClass ? window.shopNameColorClass(userId, itemsOverride) : '';
  return `<button class="profile-link ${escapeHtml(colorClass)}" type="button" data-profile-username="${safeUsername}">${safeUsername}</button>`;
}

function renderRanking(rows) {
  const box = document.querySelector('#ranking-list');
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = '<div class="side-empty">Todavía no hay jugadores.</div>';
    return;
  }

  const top = rows.slice(0, 5);

  box.innerHTML = top.map((row, index) => {
    const isMe = Casino.user && row.id === Casino.user.id;
    const online = Boolean(row.online);

    return `
      <div class="rank-item${isMe ? ' me' : ''}">
        <span class="rank-pos">${index + 1}</span>
        ${profileAvatarMarkup(row)}
        <span class="rank-name">
          ${online ? '<i class="rank-online" title="Online"></i>' : ''}
          <span class="bet-player-copy">${profileNameButton(row.username, row.id, Array.isArray(row.shop_cosmetics) ? row.shop_cosmetics : (window.getPublicProfileById?.(row.id)?.shop_cosmetics || null))}${window.shopTitleBadge ? window.shopTitleBadge(row.id, Array.isArray(row.shop_cosmetics) ? row.shop_cosmetics : (window.getPublicProfileById?.(row.id)?.shop_cosmetics || null)) : ''}</span>
        </span>
        <span class="rank-coin">${Number(row.coins) || 0} FP</span>
      </div>
    `;
  }).join('');
}

function renderOnlineBets(rows) {
  const box = document.querySelector('#online-bets');
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = '<div class="side-empty">No hay apuestas recientes de jugadores conectados.</div>';
    return;
  }

  box.innerHTML = rows.map(row => {
    const delta = Number(row.delta || 0);
    const cls = delta > 0 ? 'win' : delta < 0 ? 'lose' : 'tie';
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    const amount = Math.abs(delta);
    const items = Array.isArray(row.shop_cosmetics) ? row.shop_cosmetics : [];
    const cosmetics = window.cosmeticClassesForItems?.(items) || {background:'',frame:'',effect:'',title:'',titleText:'',nameColor:''};
    const uid = row.user_id || row.id || '';
    const avatar = profileAvatarMarkup({ ...row, id: uid, shop_cosmetics: items }, 'side-avatar');
    const title = window.shopTitleBadge ? window.shopTitleBadge(uid, items) : '';

    return `
      <article class="bet-live ${escapeHtml(cosmetics.background || '')} ${escapeHtml(cosmetics.effect || '')}" data-shop-user="${escapeHtml(uid)}">
        <div class="bet-top">
          <div class="bet-player">
            <i class="rank-online" title="Online"></i>
            <span class="bet-avatar-slot">${avatar}</span>
            <span class="bet-player-copy">
              ${profileNameButton(row.username, uid, items)}
              ${title}
            </span>
          </div>
          <time class="bet-time">${formatSideTime(row.created_at)}</time>
        </div>
        <div class="bet-game">
          <span>${escapeHtml(row.game || 'Juego')}</span>
          <span class="bet-delta ${cls}">${sign}${amount} FP</span>
        </div>
        <div class="bet-detail">${escapeHtml(row.detail || `${Number(row.bet) || 0} FP apostadas`).replace(/\bCR\b/g, 'FP')}</div>
      </article>
    `;
  }).join('');
}

async function heartbeatSidebar() {
  if (!Casino.token) return;

  const { error } = await supabaseClient.rpc('heartbeat_session', {
    p_token: Casino.token
  });

  if (error) console.error('Heartbeat:', error);
}

async function refreshSidebar() {
  if (!Casino.token || sidebarBusy) return;
  sidebarBusy = true;

  try {
    const { data, error } = await supabaseClient.rpc('get_sidebar_data', {
      p_token: Casino.token
    });

    if (error) {
      console.error('Sidebar:', error);
      return;
    }

    const ranking = Array.isArray(data?.ranking) ? data.ranking : [];
    const online = Array.isArray(data?.online) ? data.online : [];
    const bets = Array.isArray(data?.recent_bets) ? data.recent_bets : [];

    const onlineIds = new Set(online.map(player => player.id));
    renderRanking(ranking.map(player => ({
      ...player,
      online: onlineIds.has(player.id)
    })));
    renderOnlineBets(bets);

    const count = document.querySelector('#online-count');
    if (count) count.textContent = `${online.length} online`;
  } finally {
    sidebarBusy = false;
  }
}

async function initSidebar() {
  if (!Casino.user || !Casino.token) return;

  clearInterval(sidebarInterval);
  clearInterval(heartbeatInterval);

  await heartbeatSidebar();
  await refreshSidebar();

  heartbeatInterval = setInterval(heartbeatSidebar, 20000);
  sidebarInterval = setInterval(async () => {
    await heartbeatSidebar();
    await refreshSidebar();
  }, 15000);
}

function stopSidebar() {
  clearInterval(sidebarInterval);
  clearInterval(heartbeatInterval);
  sidebarInterval = null;
  heartbeatInterval = null;
}

window.initSidebar = initSidebar;
window.refreshSidebar = refreshSidebar;
window.stopSidebar = stopSidebar;

window.addEventListener('casino:cosmetics-updated', () => { if (window.refreshSidebar) window.refreshSidebar(); });
