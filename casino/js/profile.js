// ============================================================
// PERFILES, AVATARES, XP Y NIVELES
// ============================================================

const AVATAR_IDS = Array.from({ length: 12 }, (_, i) => `avatar_${String(i + 1).padStart(2, '0')}`);
const DEFAULT_AVATAR = 'avatar_01';
const publicProfiles = new Map();
let publicProfilesTimer = null;
let profileReady = false;

function avatarUrl(avatarId) {
  const safe = AVATAR_IDS.includes(avatarId) ? avatarId : DEFAULT_AVATAR;
  return `assets/avatars/${safe}.svg`;
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
    if (profile?.id) publicProfiles.set(profile.id, profile);
  });
  return true;
}

function getPublicProfileById(userId) {
  return publicProfiles.get(userId) || null;
}

function getAvatarForUser(userId) {
  return publicProfiles.get(userId)?.avatar_id || DEFAULT_AVATAR;
}

function getLevelForUser(userId) {
  return Math.max(1, Number(publicProfiles.get(userId)?.level || 1));
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

  body.innerHTML = `
    <section class="profile-hero">
      <div class="profile-hero-avatar-wrap">
        ${avatarHtml(profile.avatar_id, 'profile-hero-avatar', profile.username)}
        <span class="profile-level-orb">${level}</span>
      </div>
      <div class="profile-hero-main">
        <span class="profile-kicker">PERFIL DE JUGADOR</span>
        <h2 id="profile-modal-title">${escapeHtml(profile.username)}</h2>
        <div class="profile-badges">
          <span>NIVEL ${level}</span>
          <span>${Number(profile.coins || 0)} FP</span>
        </div>
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
          ${AVATAR_IDS.map(id => `
            <button type="button" class="avatar-choice ${id === profile.avatar_id ? 'selected' : ''}" data-avatar-id="${id}" title="Elegir avatar">
              ${avatarHtml(id, 'avatar-choice-img', `Avatar ${id.slice(-2)}`)}
            </button>
          `).join('')}
        </div>
        <button type="button" id="profile-save-avatar" class="main profile-save-button">Guardar avatar</button>
      </section>
    ` : ''}
  `;

  if (profile.is_me) {
    const grid = $('#avatar-grid');
    let selected = profile.avatar_id || DEFAULT_AVATAR;
    grid?.addEventListener('click', event => {
      const choice = event.target.closest('[data-avatar-id]');
      if (!choice) return;
      selected = choice.dataset.avatarId;
      grid.querySelectorAll('.avatar-choice').forEach(button => {
        button.classList.toggle('selected', button === choice);
      });
    });

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
  publicProfilesTimer = setInterval(() => {
    if (Casino.token) loadPublicProfiles();
  }, 30000);
}

function stopPublicProfileRefresh() {
  clearInterval(publicProfilesTimer);
  publicProfilesTimer = null;
  publicProfiles.clear();
  closeProfile();
}

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
