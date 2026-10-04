// ============================================================
// PERFILES, AVATARES, XP Y NIVELES
// ============================================================

const BUILTIN_AVATAR_IDS = Array.from({ length: 12 }, (_, i) => `avatar_${String(i + 1).padStart(2, '0')}`);
const CUSTOM_AVATAR_IDS = Array.from({ length: 12 }, (_, i) => `avatar_personalizado_${i + 1}`);
const AVATAR_IDS = [...BUILTIN_AVATAR_IDS, ...CUSTOM_AVATAR_IDS];
const DEFAULT_AVATAR = 'avatar_01';

function isCustomAvatarId(avatarId) {
  return CUSTOM_AVATAR_IDS.includes(String(avatarId || ''));
}
const publicProfiles = new Map();
let publicProfilesTimer = null;
let profileReady = false;

function avatarUrl(avatarId) {
  const safe = AVATAR_IDS.includes(avatarId) ? avatarId : DEFAULT_AVATAR;
  return isCustomAvatarId(safe)
    ? `assets/avatars/${safe}.png`
    : `assets/avatars/${safe}.svg`;
}

function levelThreshold(level) {
  const n = Math.max(0, Number(level || 1) - 1);
  return Math.floor(100 * Math.pow(n, 1.35));
}

function levelProgress(xp, level) {
  const current = levelThreshold(level);
  const next = levelThreshold(Number(level || 1) + 1);
  const amount = Math.max(0, Number(xp || 0));
  const span = Math.max(1, next - current);
  return Math.max(0, Math.min(100, ((amount - current) / span) * 100));
}

function avatarImg(avatarId, className = 'ui-avatar', alt = '') {
  const img = document.createElement('img');
  img.src = avatarUrl(avatarId);
  img.alt = alt;
  img.className = className;
  img.loading = 'lazy';
  img.draggable = false;
  return img;
}

function avatarHtml(avatarId, className = 'ui-avatar', alt = '') {
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(avatarUrl(avatarId))}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false">`;
}

async function loadPublicProfiles() {
  if (!Casino.token) return false;

  const { data, error } = await supabaseClient.rpc('get_public_profiles', {
    p_token: Casino.token
  });

  if (error) {
    console.error('[PROFILE] Public profiles:', error);
    return false;
  }

  publicProfiles.clear();
  (Array.isArray(data) ? data : []).forEach(profile => {
    if (profile?.id) publicProfiles.set(String(profile.id).toLowerCase(), profile);
  });
  return true;
}

function getPublicProfileById(userId) {
  return publicProfiles.get(String(userId || '').toLowerCase()) || null;
}

function getAvatarForUser(userId) {
  return publicProfiles.get(String(userId || '').toLowerCase())?.avatar_id || DEFAULT_AVATAR;
}

function getLevelForUser(userId) {
  return Math.max(1, Number(publicProfiles.get(String(userId || '').toLowerCase())?.level || 1));
}

function getPublicProfileByUsername(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  for (const profile of publicProfiles.values()) {
    if (String(profile.username || '').toLowerCase() === target) return profile;
  }
  return null;
}

function getLevelForUsername(username) {
  return Math.max(1, Number(getPublicProfileByUsername(username)?.level || 1));
}

function avatarLevelHtml(avatarId, level, imageClass = 'ui-avatar', wrapClass = 'avatar-level-wrap', alt = '') {
  const numericLevel = Math.max(1, Number(level || 1));
  return `<span class="${escapeHtml(wrapClass)}"><img class="${escapeHtml(imageClass)}" src="${escapeHtml(avatarUrl(avatarId))}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false"><span class="avatar-level-badge">${numericLevel}</span></span>`;
}

function avatarWithLevelImg(avatarId, level, imageClass = 'ui-avatar', wrapClass = 'avatar-level-wrap', alt = '') {
  const wrap = document.createElement('span');
  wrap.className = wrapClass;
  const img = avatarImg(avatarId, imageClass, alt);
  const badge = document.createElement('span');
  badge.className = 'avatar-level-badge';
  badge.textContent = Math.max(1, Number(level || 1));
  wrap.append(img, badge);
  return wrap;
}

async function openProfile(username) {
  if (!Casino.token || !username) return;

  const modal = $('#profile-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  document.body.classList.add('profile-open');

  const body = $('#profile-modal-body');
  if (body) body.innerHTML = '<div class="profile-loading">Cargando perfil…</div>';

  const { data, error } = await supabaseClient.rpc('get_public_profile', {
    p_token: Casino.token,
    p_username: username
  });

  if (error || !data) {
    console.error('[PROFILE] Public profile:', error);
    if (body) body.innerHTML = '<div class="profile-loading">No se ha podido cargar el perfil.</div>';
    return;
  }

  renderProfileModal(data);
}

function renderProfileModal(profile) {
  const body = $('#profile-modal-body');
  if (!body) return;

  const level = Number(profile.level || 1);
  const xp = Number(profile.xp || 0);
  const progress = levelProgress(xp, level);
  const currentThreshold = levelThreshold(level);
  const nextThreshold = levelThreshold(level + 1);
  const xpRemaining = Math.max(0, nextThreshold - xp);
  const net = Number(profile.net || 0);
  const netClass = net > 0 ? 'win' : net < 0 ? 'lose' : '';

  const publicShop = window.getPublicShopCosmetics?.(profile.id);
  const ownShopFallback = profile.is_me ? (window.getEquippedShopItems?.() || []) : [];
  const profileShopItems = Array.isArray(profile.shop_cosmetics) ? profile.shop_cosmetics : [];
  const publicShopItems = publicShop?.items?.length
    ? publicShop.items
    : (profileShopItems.length ? profileShopItems : ownShopFallback);
  const publicShopClasses = window.cosmeticClassesForItems ? window.cosmeticClassesForItems(publicShopItems) : {frame:'',effect:'',title:'',background:'',nameColor:''};
  const equippedLabels = publicShopItems.map(item => ({
    frame:'MARCO', background:'FONDO', title:'TÍTULO', effect:'AURA', name_color:'COLOR'
  }[item.category])).filter(Boolean);
  body.innerHTML = `
    <section class="profile-hero ${publicShopClasses.background} profile-cosmetic-${profile.id}">
      ${window.shopProfileAvatarMarkup
        ? window.shopProfileAvatarMarkup(profile.id, profile.avatar_id, level, profile.username, publicShopItems)
        : `<div class="profile-hero-avatar-wrap"><img class="profile-hero-avatar" src="${escapeHtml(avatarUrl(profile.avatar_id))}" alt="${escapeHtml(profile.username)}"><span class="profile-level-orb">${level}</span></div>`}
      <div class="profile-hero-main">
        <span class="profile-kicker">PERFIL DE JUGADOR</span>
        <h2 id="profile-modal-title" class="${publicShopClasses.nameColor}">${escapeHtml(profile.username)}</h2>
        ${publicShopClasses.title ? `<div class="profile-title-display ${publicShopClasses.title}">${escapeHtml(publicShopItems.find(i => i.category === 'title')?.name || '')}</div>` : ''}
        <div class="profile-badges">
          <span>NIVEL ${level}</span>
          <span>${Number(profile.coins || 0)} FP</span>
        </div>
        ${equippedLabels.length ? `<div class="profile-cosmetic-strip">${equippedLabels.map(label => `<span>${label}</span>`).join('')}</div>` : ''}
      </div>
    </section>

    <section class="profile-xp-card">
      <div class="profile-xp-top">
        <div><span>EXPERIENCIA</span><b>${xp} XP</b></div>
        <small>${xpRemaining} XP para nivel ${level + 1}</small>
      </div>
      <div class="profile-xp-bar"><i style="width:${progress.toFixed(1)}%"></i></div>
      <div class="profile-xp-range"><span>${currentThreshold} XP</span><span>${nextThreshold} XP</span></div>
    </section>

    <section class="profile-stats-grid">
      <article><span>PARTIDAS</span><strong>${Number(profile.games || 0)}</strong></article>
      <article><span>VICTORIAS</span><strong class="win">${Number(profile.wins || 0)}</strong></article>
      <article><span>DERROTAS</span><strong class="lose">${Number(profile.losses || 0)}</strong></article>
      <article><span>MEJOR GANANCIA</span><strong>${Number(profile.best_win || 0)} FP</strong></article>
      <article class="profile-stat-wide"><span>BALANCE NETO</span><strong class="${netClass}">${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)} FP</strong></article>
    </section>

    ${profile.is_me ? `
      <section class="profile-customize">
        <div class="profile-section-title">
          <div><span>PERSONALIZACIÓN</span><h3>Elige tu avatar</h3></div>
          <span class="profile-save-state" id="profile-save-state"></span>
        </div>
        <div class="avatar-grid" id="avatar-grid">
          ${BUILTIN_AVATAR_IDS.map(id => `
            <button type="button" class="avatar-choice ${id === profile.avatar_id ? 'selected' : ''}" data-avatar-id="${id}" title="Elegir avatar">
              ${avatarHtml(id, 'avatar-choice-img', `Avatar ${id.slice(-2)}`)}
            </button>
          `).join('')}
        </div>
        <div class="profile-avatar-shop-title">AVATARES DE FODO SHOP</div>
        <div class="avatar-grid avatar-shop-grid" id="avatar-shop-grid">
          ${(() => {
            const ownedCustom = window.getOwnedShopAvatarItems?.() || [];
            return ownedCustom.length
              ? ownedCustom.map(item => `
                <button type="button" class="avatar-choice avatar-choice-shop ${item.id === profile.avatar_id ? 'selected' : ''}" data-avatar-id="${escapeHtml(item.id)}" title="Elegir ${escapeHtml(item.name)}">
                  ${avatarHtml(item.id, 'avatar-choice-img', item.name)}
                  <span class="avatar-choice-label">${escapeHtml(item.name)}</span>
                </button>
              `).join('')
              : '<div class="avatar-shop-empty">Compra un avatar personalizado en <b>Fodo Shop</b> para desbloquearlo aquí. Cada avatar cuesta 1.000 FP.</div>';
          })()}
        </div>
        <button type="button" id="profile-save-avatar" class="main profile-save-button">Guardar avatar</button>
      </section>
    ` : ''}
  `;

  if (profile.is_me) {
    const grids = [$('#avatar-grid'), $('#avatar-shop-grid')].filter(Boolean);
    let selected = profile.avatar_id || DEFAULT_AVATAR;
    grids.forEach(grid => grid.addEventListener('click', event => {
      const choice = event.target.closest('[data-avatar-id]');
      if (!choice) return;
      selected = choice.dataset.avatarId;
      grids.forEach(otherGrid => {
        otherGrid.querySelectorAll('.avatar-choice').forEach(button => {
          button.classList.toggle('selected', button.dataset.avatarId === selected);
        });
      });
    }));

    $('#profile-save-avatar')?.addEventListener('click', async () => {
      const state = $('#profile-save-state');
      const button = $('#profile-save-avatar');
      if (button) button.disabled = true;
      if (state) state.textContent = 'Guardando…';

      const { data, error } = await supabaseClient.rpc('update_profile_avatar', {
        p_token: Casino.token,
        p_avatar_id: selected
      });

      if (error) {
        console.error('[PROFILE] Avatar:', error);
        if (state) state.textContent = 'No se pudo guardar';
      } else {
        if (Casino.profile) {
          Casino.profile.avatar_id = data.avatar_id;
          Casino.user.avatar_id = data.avatar_id;
        }
        publicProfiles.set(Casino.user.id, data);
        Casino.render();
        await loadPublicProfiles();
        if (typeof window.refreshSidebar === 'function') await window.refreshSidebar();
        if (state) state.textContent = 'Guardado ✓';
      }

      if (button) button.disabled = false;
      setTimeout(() => {
        if (state) state.textContent = '';
      }, 1600);
    });
  }
}

function closeProfile() {
  $('#profile-modal')?.classList.add('hidden');
  document.body.classList.remove('profile-open');
}

function initProfile() {
  if (profileReady) return;
  profileReady = true;

  $('#profile-trigger')?.addEventListener('click', () => openProfile(Casino.user?.username));
  $('#profile-modal-close')?.addEventListener('click', closeProfile);
  $('#profile-modal-backdrop')?.addEventListener('click', closeProfile);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeProfile();
  });

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-profile-username]');
    if (!target) return;
    event.preventDefault();
    openProfile(target.dataset.profileUsername);
  });
}

function startPublicProfileRefresh() {
  clearInterval(publicProfilesTimer);
  publicProfilesTimer = setInterval(async () => {
    if (Casino.token) { await loadPublicProfiles(); if (window.refreshShopPublicCosmetics) await window.refreshShopPublicCosmetics(); }
  }, 30000);
}

function stopPublicProfileRefresh() {
  clearInterval(publicProfilesTimer);
  publicProfilesTimer = null;
  publicProfiles.clear();
  closeProfile();
}

window.cosmeticClassesForItems = window.cosmeticClassesForItems || ((items) => {
  const out = {frame:'',effect:'',title:'',background:'',nameColor:''};
  const m = new Map((items || []).map(i => [i.category, i]));
  if (m.get('background')) out.background = `shop-bg-${String(m.get('background').id).replace(/^bg_/, '')}`;
  if (m.get('frame')) out.frame = `shop-frame-${m.get('frame').id.replace('frame_','')}`;
  if (m.get('effect')) out.effect = `shop-effect-${m.get('effect').id.replace('effect_','')}`;
  if (m.get('title')) out.title = `shop-title-${m.get('title').id.replace('title_','')}`;
  if (m.get('name_color')) out.nameColor = `shop-color-${m.get('name_color').id.replace('color_','')}`;
  return out;
});

window.avatarUrl = avatarUrl;
window.avatarHtml = avatarHtml;
window.avatarLevelHtml = avatarLevelHtml;
window.avatarWithLevelImg = avatarWithLevelImg;
window.getAvatarForUser = getAvatarForUser;
window.getLevelForUser = getLevelForUser;
window.getPublicProfileByUsername = getPublicProfileByUsername;
window.getLevelForUsername = getLevelForUsername;
window.getPublicProfileById = getPublicProfileById;
window.loadPublicProfiles = loadPublicProfiles;
window.initProfile = initProfile;
window.openProfile = openProfile;
window.stopPublicProfileRefresh = stopPublicProfileRefresh;
window.startPublicProfileRefresh = startPublicProfileRefresh;

window.addEventListener('casino:cosmetics-updated', () => {
  const modal = document.querySelector('#profile-modal');
  if (modal && !modal.classList.contains('hidden') && Casino.user?.username) {
    openProfile(Casino.user.username);
  }
});
