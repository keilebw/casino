// ============================================================
// FODO SHOP — TIENDA COSMÉTICA
// Compra/equipamiento por RPC segura en Supabase.
// Los cosméticos son visuales y no modifican las reglas de juego.
// ============================================================

let shopItems = [];
let shopFilter = 'all';
let shopReady = false;
let shopPublicCosmetics = new Map();

const SHOP_CATEGORY_LABELS = {
  frame: 'Marcos',
  background: 'Fondos',
  title: 'Títulos',
  effect: 'Efectos',
  name_color: 'Colores de nombre',
  avatar: 'Avatares'
};

const SHOP_RARITY_LABELS = {
  common: 'COMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY'
};

const SHOP_THEME_IDS = new Set(['bg_velvet','bg_emerald','bg_gold','bg_obsidian','bg_midnight','bg_crimson','bg_sapphire','bg_rgb_nexus']);
const SHOP_FRAME_IDS = new Set(['frame_gold','frame_diamond','frame_neon','frame_royal']);
const SHOP_EFFECT_IDS = new Set(['effect_gold','effect_spark','effect_royal']);
const SHOP_NAME_COLOR_IDS = new Set(['color_gold','color_ice','color_mint','color_crimson','color_violet','color_sapphire']);
const SHOP_TITLE_IDS = new Set(['title_lucky','title_highroller','title_mines','title_road','title_cardshark']);

function shopEscape(value) {
  return escapeHtml(value);
}

function shopItemClass(id, prefix='shop-preview') {
  const safe = String(id || '').replace(/[^a-z0-9_-]/gi, '');
  return `${prefix}-${safe}`;
}

function shopCardVisual(item) {
  const safe = String(item.id || '').replace(/[^a-z0-9_-]/gi, '');
  if (item.category === 'avatar') {
    const avatarSrc = typeof window.avatarUrl === 'function' ? window.avatarUrl(item.id) : `assets/avatars/${safe}.png`;
    return `<div class="shop-preview shop-avatar-product-preview" aria-hidden="true"><img src="${shopEscape(avatarSrc)}" alt=""><span>AVATAR</span></div>`;
  }
  let label = 'FP';
  if (item.category === 'title') label = shopEscape(item.name);
  else if (item.category === 'background') label = 'PERFIL';
  else if (item.category === 'frame') label = 'MARCO';
  else if (item.category === 'effect') label = 'AURA';
  else if (item.category === 'name_color') label = 'NOMBRE';

  return `<div class="shop-preview ${shopItemClass(item.id)} shop-preview-${shopEscape(item.category)} ${item.category === 'background' ? `shop-card-bg-${shopEscape(safe)}` : ''}" aria-hidden="true"><span></span><b>${label}</b></div>`;
}

function equippedByCategory(items = shopItems) {
  // El catálogo del usuario trae `equipped`; las listas públicas traen
  // únicamente los elementos ya equipados y, por tanto, no siempre incluyen
  // esa propiedad. Si la propiedad no existe, tratamos el objeto como equipado.
  const list = Array.isArray(items) ? items : [];
  return new Map(list
    .filter(item => {
      if (!item || !item.category) return false;
      return !Object.prototype.hasOwnProperty.call(item, 'equipped') || Boolean(item.equipped);
    })
    .map(item => [item.category, item]));
}

function publicCosmeticsForUser(userId) {
  const key = String(userId || '').toLowerCase();

  // 1) Mapa público cargado desde Supabase.
  const direct = shopPublicCosmetics.get(key);
  if (direct) return direct;

  // 2) Perfil público cacheado. get_public_profiles incluye shop_cosmetics.
  const profile = window.getPublicProfileById?.(key);
  if (profile) {
    const items = Array.isArray(profile.shop_cosmetics) ? profile.shop_cosmetics : [];
    if (items.length || !Casino.user || String(Casino.user.id) !== key) return { items };
  }

  // 3) Nuestro propio usuario: la fuente más reciente es el catálogo de la tienda.
  if (Casino.user && String(Casino.user.id) === key) {
    return { items: shopItems.filter(item => item.equipped) };
  }

  return null;
}

function cosmeticClassesForItems(items) {
  const equipped = equippedByCategory(items || []);
  const out = {
    background: '',
    frame: '',
    effect: '',
    title: '',
    titleText: '',
    nameColor: ''
  };

  const bg = equipped.get('background');
  const frame = equipped.get('frame');
  const effect = equipped.get('effect');
  const title = equipped.get('title');
  const nameColor = equipped.get('name_color');

  if (bg && SHOP_THEME_IDS.has(bg.id)) out.background = `shop-bg-${bg.id.slice(3)}`;
  if (frame && SHOP_FRAME_IDS.has(frame.id)) out.frame = `shop-frame-${frame.id.replace(/^frame_/, '')}`;
  if (effect && SHOP_EFFECT_IDS.has(effect.id)) out.effect = `shop-effect-${effect.id.replace(/^effect_/, '')}`;
  if (title && SHOP_TITLE_IDS.has(title.id)) {
    out.title = `shop-title-${title.id.slice(6)}`;
    out.titleText = title.name || '';
  }
  if (nameColor && SHOP_NAME_COLOR_IDS.has(nameColor.id)) {
    out.nameColor = `shop-color-${nameColor.id.slice(6)}`;
  }
  return out;
}

function cosmeticClassesForUser(userId) {
  const profile = publicCosmeticsForUser(userId);
  return profile ? cosmeticClassesForItems(profile.items || []) : {background:'',frame:'',effect:'',title:'',titleText:'',nameColor:''};
}

function publicShopItemsForUser(userId) {
  const profile = publicCosmeticsForUser(userId);
  return profile?.items || [];
}

function shopNameColorClass(userId, itemsOverride = null) {
  const c = itemsOverride ? cosmeticClassesForItems(itemsOverride) : cosmeticClassesForUser(userId);
  return c.nameColor || '';
}

function shopAvatarDecorMarkup(c, shape = 'circle') {
  const frame = c.frame ? `<span class="shop-avatar-frame-ring ${shopEscape(c.frame)}" aria-hidden="true"></span>` : '';
  const effect = c.effect ? `<span class="shop-avatar-effect-ring ${shopEscape(c.effect)}" aria-hidden="true"><i></i><i></i><i></i></span>` : '';
  return `${effect}${frame}`;
}

function shopAvatarLevelHtml(userId, avatarId, level, sizeClass = 'side-avatar', alt = '', itemsOverride = null) {
  const items = Array.isArray(itemsOverride) ? itemsOverride : publicShopItemsForUser(userId);
  const c = cosmeticClassesForItems(items);
  const frameName = c.frame ? c.frame.replace(/^shop-frame-/, '') : '';
  const effectName = c.effect ? c.effect.replace(/^shop-effect-/, '') : '';
  const wrapperClass = `avatar-level-wrap ${sizeClass}-wrap shop-cosmetic-avatar ${c.frame} ${c.effect}`.trim();
  const imageClasses = `${sizeClass} shop-cosmetic-image`.trim();
  const avatar = avatarUrl(avatarId || 'avatar_01');
  return `<span class="${shopEscape(wrapperClass)}" data-shop-user="${shopEscape(userId || '')}" data-shop-frame="${shopEscape(frameName)}" data-shop-effect="${shopEscape(effectName)}">${shopAvatarDecorMarkup(c)}<img class="${shopEscape(imageClasses)}" src="${shopEscape(avatar)}" alt="${shopEscape(alt)}" loading="lazy" draggable="false"><span class="avatar-level-badge">${Math.max(1, Number(level || 1))}</span></span>`;
}

function shopProfileAvatarMarkup(userId, avatarId, level, alt = '', itemsOverride = null) {
  const items = Array.isArray(itemsOverride) ? itemsOverride : publicShopItemsForUser(userId);
  const c = cosmeticClassesForItems(items);
  const frameName = c.frame ? c.frame.replace(/^shop-frame-/, '') : '';
  const effectName = c.effect ? c.effect.replace(/^shop-effect-/, '') : '';
  const wrapperClass = `profile-hero-avatar-wrap shop-profile-cosmetic-avatar ${c.frame} ${c.effect}`.trim();
  const imageClasses = `profile-hero-avatar shop-cosmetic-image`.trim();
  const avatar = avatarUrl(avatarId || 'avatar_01');
  const fx = c.effect ? `<span class="shop-profile-effect ${shopEscape(c.effect)}" aria-hidden="true"><i></i><i></i><i></i></span>` : '';
  return `<div class="${shopEscape(wrapperClass)}" data-shop-user="${shopEscape(userId || '')}" data-shop-frame="${shopEscape(frameName)}" data-shop-effect="${shopEscape(effectName)}">${fx}${shopAvatarDecorMarkup(c, 'hero')}<img class="${shopEscape(imageClasses)}" src="${shopEscape(avatar)}" alt="${shopEscape(alt)}" loading="lazy" draggable="false"><span class="profile-level-orb">${Math.max(1, Number(level || 1))}</span></div>`;
}

function shopTitleBadge(userId, itemsOverride = null) {
  const c = itemsOverride ? cosmeticClassesForItems(itemsOverride) : cosmeticClassesForUser(userId);
  return c.titleText ? `<span class="shop-public-title ${c.title}">${shopEscape(c.titleText)}</span>` : '';
}

function applyShopAppearance(items = shopItems) {
  const app = document.querySelector('#app');
  const body = document.body;
  const me = document.querySelector('#me');
  const avatarWrap = document.querySelector('#profile-avatar-wrap');
  const name = document.querySelector('#who');
  const title = document.querySelector('#profile-title-mini');
  if (!app || !name) return;

  const oldThemes = ['shop-bg-velvet', 'shop-bg-emerald', 'shop-bg-gold', 'shop-bg-obsidian', 'shop-bg-midnight', 'shop-bg-crimson', 'shop-bg-sapphire', 'shop-bg-rgb_nexus'];
  const oldFrames = ['shop-frame-gold', 'shop-frame-diamond', 'shop-frame-neon', 'shop-frame-royal'];
  const oldEffects = ['shop-effect-gold', 'shop-effect-spark', 'shop-effect-royal'];
  const oldNames = ['shop-name-lucky', 'shop-name-highroller', 'shop-name-mines', 'shop-name-road', 'shop-name-cardshark'];
  const oldNameColors = ['shop-color-gold', 'shop-color-ice', 'shop-color-mint', 'shop-color-crimson', 'shop-color-violet', 'shop-color-sapphire'];

  [...oldThemes, ...oldFrames, ...oldEffects, ...oldNames, ...oldNameColors].forEach(cls => {
    app.classList.remove(cls);
    body.classList.remove(cls);
    me?.classList.remove(cls);
  });
  [...oldFrames, ...oldEffects].forEach(cls => avatarWrap?.classList.remove(cls));
  oldNames.forEach(cls => name.classList.remove(cls));
  oldNameColors.forEach(cls => name.classList.remove(cls));
  oldNames.forEach(cls => title?.classList.remove(cls.replace('shop-name-', 'shop-title-')));
  ['shop-title-lucky','shop-title-highroller','shop-title-mines','shop-title-road','shop-title-cardshark'].forEach(cls => title?.classList.remove(cls));

  const c = cosmeticClassesForItems(items);
  if (c.background) {
    app.classList.add(c.background);
    body.classList.add(c.background);
  }
  // Marco y aura son estrictamente por-usuario. Nunca se colocan en #app/body,
  // porque los selectores descendientes harían que todos los avatares adoptasen
  // la apariencia del usuario actual.
  if (c.frame) avatarWrap?.classList.add(c.frame);
  if (c.effect) avatarWrap?.classList.add(c.effect);
  if (c.nameColor) {
    name.classList.add(c.nameColor);
  }
  if (title) {
    title.textContent = c.titleText;
    title.classList.toggle('has-title', !!c.titleText);
    if (c.title) title.classList.add(c.title);
  }

  // La cabecera tenía clases, pero no los nodos visuales que dibujan el marco/aura.
  // Los creamos físicamente dentro del wrapper para que no dependan de pseudo-elementos.
  if (avatarWrap) {
    avatarWrap.querySelectorAll(':scope > .shop-avatar-frame-ring, :scope > .shop-avatar-effect-ring').forEach(node => node.remove());
    if (c.effect) avatarWrap.insertAdjacentHTML('afterbegin', `<span class="shop-avatar-effect-ring shop-header-decor ${shopEscape(c.effect)}" aria-hidden="true"><i></i><i></i><i></i></span>`);
    if (c.frame) avatarWrap.insertAdjacentHTML('afterbegin', `<span class="shop-avatar-frame-ring shop-header-decor ${shopEscape(c.frame)}" aria-hidden="true"></span>`);
  }

  if (Casino.profile) Casino.profile.shop_cosmetics = items.filter(i => i.equipped);
  if (me) me.dataset.shopReady = 'true';

  // Re-render public surfaces with their current cosmetics.
  window.dispatchEvent(new CustomEvent('casino:cosmetics-updated'));
}

async function shopLoadPublicCosmetics() {
  if (!Casino.token) return false;
  const { data, error } = await supabaseClient.rpc('shop_get_public_cosmetics', { p_token: Casino.token });
  if (error) {
    console.error('[SHOP] Cosméticos públicos:', error);
    return false;
  }

  shopPublicCosmetics = new Map();
  (Array.isArray(data) ? data : []).forEach(row => {
    if (!row?.user_id) return;
    const items = Array.isArray(row.items) ? row.items : [];
    shopPublicCosmetics.set(String(row.user_id).toLowerCase(), { items });
  });
  window.dispatchEvent(new CustomEvent('casino:cosmetics-updated'));
  return true;
}

function shopRenderStats() {
  const owned = shopItems.filter(item => item.owned).length;
  const equipped = shopItems.filter(item => item.equipped).length;
  const ownedEl = document.querySelector('#shop-owned-count');
  const equippedEl = document.querySelector('#shop-equipped-count');
  const balanceEl = document.querySelector('#shop-balance');
  if (ownedEl) ownedEl.textContent = owned;
  if (equippedEl) equippedEl.textContent = equipped;
  if (balanceEl) balanceEl.textContent = `${Casino.coins()} FP`;
}

function shopRenderPreview() {
  const target = document.querySelector('#shop-profile-preview');
  if (!target || !Casino.profile) return;
  const equipped = shopItems.filter(item => item.equipped);
  const c = cosmeticClassesForItems(equipped);
  const frame = equipped.find(i => i.category === 'frame');
  const effect = equipped.find(i => i.category === 'effect');
  const title = equipped.find(i => i.category === 'title');
  const bg = equipped.find(i => i.category === 'background');

  target.classList.remove('shop-bg-velvet','shop-bg-emerald','shop-bg-gold','shop-bg-obsidian','shop-bg-midnight','shop-bg-crimson','shop-bg-sapphire','shop-bg-rgb_nexus');
  if (c.background) target.classList.add(c.background);

  target.innerHTML = `
    <div class="shop-profile-avatar ${frame ? `shop-preview-${shopEscape(frame.id)}` : ''} ${effect ? `shop-preview-${shopEscape(effect.id)}` : ''}">
      <img src="${shopEscape(avatarUrl(Casino.profile.avatar_id))}" alt="Tu avatar">
    </div>
    <div class="shop-profile-copy">
      <span>VISTA DEL PERFIL</span>
      <strong class="${c.nameColor}">${shopEscape(Casino.profile.username)}</strong>
      <small class="${c.title}">${title ? shopEscape(title.name) : 'Sin título equipado'}</small>
      ${bg ? `<em>${shopEscape(bg.name)}</em>` : ''}
    </div>
  `;
}

function shopRender() {
  const grid = document.querySelector('#shop-grid');
  if (!grid) return;

  shopRenderStats();
  shopRenderPreview();

  const filtered = shopFilter === 'all'
    ? shopItems
    : shopFilter === 'owned'
      ? shopItems.filter(item => item.owned)
      : shopItems.filter(item => item.category === shopFilter);
  if (!filtered.length) {
    grid.innerHTML = '<div class="shop-empty">No hay productos en esta categoría.</div>';
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const rarity = SHOP_RARITY_LABELS[item.rarity] || item.rarity.toUpperCase();
    const price = Number(item.price) || 0;
    const action = item.category === 'avatar'
      ? item.owned
        ? '<button class="shop-action equipped" data-shop-avatar-profile="1">VER EN PERFIL</button>'
        : `<button class="shop-action buy" data-shop-buy="${shopEscape(item.id)}" ${Casino.coins() < price ? 'disabled' : ''}>${Casino.coins() < price ? 'FALTAN FP' : 'COMPRAR'}</button>`
      : item.equipped
        ? '<button class="shop-action equipped" disabled>EQUIPADO</button>'
        : item.owned
          ? `<button class="shop-action equip" data-shop-equip="${shopEscape(item.id)}">EQUIPAR</button>`
          : `<button class="shop-action buy" data-shop-buy="${shopEscape(item.id)}" ${Casino.coins() < price ? 'disabled' : ''}>${Casino.coins() < price ? 'FALTAN FP' : 'COMPRAR'}</button>`;

    return `
      <article class="shop-item-card rarity-${shopEscape(item.rarity)} ${item.owned ? 'owned' : ''} ${item.equipped ? 'is-equipped' : ''}">
        <div class="shop-card-top">
          <span class="shop-rarity">${rarity}</span>
          <span class="shop-category">${shopEscape(SHOP_CATEGORY_LABELS[item.category] || item.category)}</span>
        </div>
        ${shopCardVisual(item)}
        <div class="shop-item-copy">
          <h3>${shopEscape(item.name)}</h3>
          <p>${shopEscape(item.description)}</p>
        </div>
        <div class="shop-card-bottom">
          <strong>${price.toLocaleString('es-ES')} FP</strong>
          ${action}
        </div>
      </article>
    `;
  }).join('');
}

async function shopLoadCatalog() {
  if (!Casino.token) return false;
  const { data, error } = await supabaseClient.rpc('shop_get_catalog', { p_token: Casino.token });
  if (error) {
    console.error('[SHOP] Catálogo:', error);
    const grid = document.querySelector('#shop-grid');
    if (grid) grid.innerHTML = '<div class="shop-empty shop-error">No se ha podido cargar la tienda. Ejecuta primero <b>25_fodo_shop.sql</b> en Supabase.</div>';
    return false;
  }
  shopItems = Array.isArray(data) ? data : [];
  applyShopAppearance(shopItems);
  shopRender();
  await shopLoadPublicCosmetics();
  return true;
}

async function shopPurchase(itemId) {
  const button = document.querySelector(`[data-shop-buy="${CSS.escape(itemId)}"]`);
  if (button) button.disabled = true;

  const { data, error } = await supabaseClient.rpc('shop_purchase', {
    p_token: Casino.token,
    p_item_id: itemId
  });

  if (error) {
    console.error('[SHOP] Compra:', error);
    Casino.toast(error.message || 'No se pudo completar la compra.', 'result-lose');
    shopRender();
    return;
  }

  Casino.setBalance(data.coins);
  Casino.toast(`${data.name} comprado por ${data.price} FP`, 'result-win');
  await shopLoadCatalog();
}

async function shopEquip(itemId) {
  const { data, error } = await supabaseClient.rpc('shop_equip', {
    p_token: Casino.token,
    p_item_id: itemId
  });
  if (error) {
    console.error('[SHOP] Equipar:', error);
    Casino.toast(error.message || 'No se pudo equipar el producto.', 'result-lose');
    return;
  }

  await shopLoadCatalog();
  if (typeof window.refreshSidebar === 'function') await window.refreshSidebar();
  Casino.toast('Personalización equipada.', 'result-win');
}

function shopBind() {
  if (shopReady) return;
  shopReady = true;

  document.querySelector('#shop-filters')?.addEventListener('click', event => {
    const button = event.target.closest('[data-shop-filter]');
    if (!button) return;
    shopFilter = button.dataset.shopFilter || 'all';
    document.querySelectorAll('[data-shop-filter]').forEach(el => el.classList.toggle('active', el === button));
    shopRender();
  });

  document.querySelector('#shop-grid')?.addEventListener('click', async event => {
    const buy = event.target.closest('[data-shop-buy]');
    if (buy) {
      await shopPurchase(buy.dataset.shopBuy);
      return;
    }
    const equip = event.target.closest('[data-shop-equip]');
    if (equip) { await shopEquip(equip.dataset.shopEquip); return; }
    const profileAvatar = event.target.closest('[data-shop-avatar-profile]');
    if (profileAvatar && typeof window.openProfile === 'function') window.openProfile(Casino.user?.username);
  });
}

async function initShop() {
  shopBind();
  if (!Casino.token) return false;
  return shopLoadCatalog();
}

function stopShop() {
  shopItems = [];
  shopPublicCosmetics.clear();
  applyShopAppearance([]);
}

window.initShop = initShop;
window.refreshShop = shopLoadCatalog;
window.refreshShopPublicCosmetics = shopLoadPublicCosmetics;
window.getPublicShopCosmetics = publicCosmeticsForUser;
window.getPublicShopItemsForUser = publicShopItemsForUser;
window.shopNameColorClass = shopNameColorClass;
window.cosmeticClassesForItems = cosmeticClassesForItems;
window.cosmeticClassesForUser = cosmeticClassesForUser;
window.shopAvatarLevelHtml = shopAvatarLevelHtml;
window.shopProfileAvatarMarkup = shopProfileAvatarMarkup;
window.shopTitleBadge = shopTitleBadge;
window.getEquippedShopItems = () => shopItems.filter(item => item.equipped);
window.getOwnedShopAvatarItems = () => shopItems.filter(item => item.category === 'avatar' && item.owned);
window.stopShop = stopShop;
