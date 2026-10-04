// ============================================================
// APP PRINCIPAL
// Supabase se encarga de las cuentas y de guardar los datos online.
// ============================================================

const $ = (selector, element = document) => element.querySelector(selector);

function currentCasinoTab() {
  const selected = $('#nav button.on');
  if (selected?.dataset.t) return selected.dataset.t;
  const visible = document.querySelector('.tab:not(.hidden)');
  return visible?.id?.startsWith('t-') ? visible.id.slice(2) : 'roulette';
}

// El saldo NO se guarda en localStorage.
// Casino.balance es solo una copia en memoria de public.profiles.coins.


const Casino = {
  user: null,
  token: null,
  profile: null,
  balance: 0,
  chip: 1,
  stake: 0,
  shown: null,

  coins() {
    return this.balance;
  },

  async loadProfile() {
    if (!this.token) return false;

    const { data, error } = await supabaseClient.rpc('get_profile', {
      p_token: this.token
    });

    if (error || !data) {
      console.error(error);
      this.toast('No se ha podido cargar tu perfil.');
      return false;
    }

    const previousXp = this.profile ? Number(this.profile.xp || 0) : null;
    this.profile = data;
    this.balance = Number(data.coins) || 0;
    this.me = data.username;
    this.user = { id: data.id, username: data.username, avatar_id: data.avatar_id || 'avatar_01' };
    this.render();

    const currentXp = Number(data.xp || 0);
    if (previousXp !== null && currentXp > previousXp) {
      this.toast(`+${currentXp - previousXp} XP`, 'xp-gain');
    }
    this.dock();
    return true;
  },
  render() {
    const el = $('#coins');
    if (!el || !this.profile) return;

    const to = this.balance;
    const from = this.shown ?? to;
    const t0 = performance.now();
    this.shown = to;

    $('#who').textContent = this.profile.username;
    const levelMini = $('#profile-level-mini');
    if (levelMini) levelMini.textContent = `NIVEL ${Number(this.profile.level || 1)}`;
    const avatar = $('#profile-avatar');
    if (avatar && typeof window.avatarUrl === 'function') {
      avatar.src = window.avatarUrl(this.profile.avatar_id);
    }
    const profileLevelBadge = $('#profile-level-badge');
    if (profileLevelBadge) profileLevelBadge.textContent = Number(this.profile.level || 1);
    const tttStake = $('#ttt-stake-info');
    if (tttStake && !this.stake) tttStake.innerHTML = 'Apuesta de la partida: <b>0 FP</b>. Usa las fichas de abajo antes de crearla.';

    const step = now => {
      const k = Math.min(1, (now - t0) / 400);
      el.textContent = Math.round(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  },

  setBalance(coins) {
    this.balance = Number(coins);
    if (this.profile) this.profile.coins = this.balance;
    this.render();
    this.dock();
    window.blackjackUpdateBetDisplay?.();
    window.slotRefreshControls?.();
  },

  // Comprueba la apuesta que está preparada en el dock.
  bet() {
    const b = Number(this.stake);
    if (!Number.isInteger(b) || b < 1) {
      this.toast('Toca las fichas de abajo para elegir una apuesta.');
      return 0;
    }
    if (b > this.coins()) {
      this.toast('No tienes tantas monedas.');
      return 0;
    }
    return b;
  },

  // Vacía la apuesta preparada después de que el servidor la acepte.
  clearStake() {
    this.stake = 0;
    this.dock();
  },

  // Resultado compacto: no tapa el juego; aparece en la zona de avisos.
  showGameResult(data, game) {
    if (!data) return;
    if (typeof data.coins !== 'undefined') this.setBalance(data.coins);

    const delta = Number(data.delta || 0);
    const text = delta > 0
      ? `Resultado · +${delta} FP`
      : delta < 0
        ? `Resultado · −${Math.abs(delta)} FP`
        : 'Resultado · Empate';

    this.toast(text, delta > 0 ? 'result-win' : delta < 0 ? 'result-lose' : 'result-tie');
    this.renderHistory();
  },

  async renderHistory() {
    if (!this.token) return;

    const { data, error } = await supabaseClient.rpc('get_bet_history', {
      p_token: this.token
    });

    if (error) {
      console.error(error);
      $('#hist').innerHTML = '<tr><td colspan="6">No se ha podido cargar el historial.</td></tr>';
      return;
    }

    const rows = Array.isArray(data) ? data : [];

    $('#hist').innerHTML = rows.map(row => {
      const delta = Number(row.delta || 0);
      const cls = delta > 0 ? 'win' : delta < 0 ? 'lose' : '';
      const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
      const amount = Math.abs(delta);
      const time = new Date(row.created_at).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <tr>
          <td>${time}</td>
          <td>${escapeHtml(row.username || 'jugador')}</td>
          <td>${escapeHtml(row.game || '')}</td>
          <td>${Number(row.bet) || 0} FP</td>
          <td class="${cls}">${sign}${amount} FP</td>
          <td>${escapeHtml(row.detail || '')}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6">Aún no hay apuestas.</td></tr>';
  },
  toast(text, type = '') {
    let box = $('#toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast';
      document.body.append(box);
    }

    const item = document.createElement('div');
    item.textContent = text;
    if (type) item.classList.add(type);
    box.append(item);
    setTimeout(() => item.remove(), 3000);
  },

  dock() {
    const activeTab = currentCasinoTab();
    const roulette = activeTab === 'roulette';
    const slots = activeTab === 'slots';
    const fortune = activeTab === 'fortune';
    const roadActive = activeTab === 'road' && typeof window.isRoadActive === 'function' && window.isRoadActive();
    const minesActive = activeTab === 'mines' && typeof window.isMinesActive === 'function' && window.isMinesActive();
    const dinosaurActive = activeTab === 'dinosaur';

    // La tragaperras y la ruleta de la fortuna tienen sus propios controles.
    // Durante Road Rush no permitimos cambiar la apuesta ya iniciada.
    const dock = $('#dock');
    if (dock) dock.classList.toggle('slot-hidden', slots || fortune || roadActive || minesActive || dinosaurActive);

    document.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('on', roulette && Number(chip.dataset.v) === this.chip);
    });

    const table = typeof window.onTable === 'function' ? window.onTable() : 0;

    const pokerTable = activeTab === 'poker' && typeof window.isPokerTableActive === 'function' && window.isPokerTableActive();
    const minesTab = activeTab === 'mines';
    const hiloTab = activeTab === 'hilo';
    const roadTab = activeTab === 'road';

    // Los límites de stake son específicos de cada juego.
    // IMPORTANTE: el saldo NO recorta visualmente la apuesta preparada.
    // El servidor comprueba si hay saldo suficiente al iniciar la partida.
    if (!pokerTable) {
      const gameCap = minesTab ? 250 : hiloTab ? 1000 : roadTab ? 500 : null;
      if (gameCap !== null) this.stake = Math.min(this.stake, gameCap);
    }

  const clearButton = $('#dclr');
  if (clearButton) clearButton.title = pokerTable ? 'Volver a la subida mínima' : 'Reiniciar apuesta';
  $('#dockv').innerHTML = roulette
      ? `Ficha: <b>${this.chip}</b> FP<br>En mesa: <b>${table}</b> FP`
      : pokerTable
        ? `Subir a: <b>${Number($('#poker-raise-amount')?.value || 0)}</b> FP<br>Elige fichas`
        : minesTab
          ? `Apuesta: <b>${this.stake}</b> FP<br>Máximo: <b>250 FP</b>`
          : hiloTab
            ? `Apuesta: <b>${this.stake}</b> FP<br>Máximo: <b>1000 FP</b>`
            : `Apuesta: <b>${this.stake}</b> FP<br>Elige una ficha`;

    const tttStake = $('#ttt-stake-info');
    if (tttStake) {
      tttStake.innerHTML = this.stake > 0
        ? `Apuesta de la partida: <b>${this.stake} FP</b>`
        : 'Apuesta de la partida: <b>0 FP</b>. Usa las fichas de abajo antes de crearla.';
    }
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ----------------------------------------// ------------------------------------------------------------
// Autenticación PROPIA: usuario + contraseña, sin Supabase Auth
// ------------------------------------------------------------

const SESSION_KEY = 'casino_session_token';

function cleanUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function validateUsername(username, createAccount) {
  if (username.length < 2) return 'El usuario debe tener al menos 2 caracteres.';
  if (createAccount && username.length > 8) return 'El usuario puede tener como máximo 8 caracteres.';
  return '';
}

async function auth(createAccount) {
  const username = cleanUsername($('#user').value);
  const password = $('#pass').value;
  const msg = text => { $('#msg').textContent = text; };

  msg('');

  const usernameError = validateUsername(username, createAccount);
  if (usernameError) return msg(usernameError);

  if (password.length < 6) {
    return msg('La contraseña debe tener al menos 6 caracteres.');
  }

  const functionName = createAccount ? 'register_account' : 'login_account';

  const { data, error } = await supabaseClient.rpc(functionName, {
    p_username: username,
    p_password: password
  });

  if (error) {
    console.error(error);
    return msg(error.message || 'No se ha podido completar la operación.');
  }

  localStorage.setItem(SESSION_KEY, data.token);
  await start(data);
}

async function start(user) {
  Casino.user = {
    id: user.id,
    username: user.username
  };
  Casino.token = user.token || Casino.token;
  Casino.shown = null;

  if (Casino.token) {
    localStorage.setItem(SESSION_KEY, Casino.token);
  }

  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');

  const ok = await Casino.loadProfile();
  if (!ok) {
    await logout();
    return;
  }

  await Casino.renderHistory();
  if (window.initProfile) window.initProfile();
  if (window.loadPublicProfiles) await window.loadPublicProfiles();
  if (window.startPublicProfileRefresh) window.startPublicProfileRefresh();
  if (window.loadRouletteHistory) await window.loadRouletteHistory();
  if (window.initFortune) await window.initFortune();
  if (window.initShop) await window.initShop();
  if (window.initChat) await window.initChat();
  if (window.initMultiplayer) await window.initMultiplayer();
  if (window.initDinosaurio) window.initDinosaurio();
  if (window.initSidebar) await window.initSidebar();
}

async function restoreSession() {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return;

  const { data, error } = await supabaseClient.rpc('get_profile', {
    p_token: token
  });

  if (error || !data) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  Casino.token = token;
  await start({ ...data, token });
}

function showLogin() {
  if (window.stopSidebar) window.stopSidebar();
  if (window.stopFortune) window.stopFortune();
  if (window.stopRoad) window.stopRoad();
  if (window.stopDinosaurio) window.stopDinosaurio();
  if (window.stopShop) window.stopShop();
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  Casino.user = null;
  Casino.profile = null;
  Casino.balance = 0;
  Casino.token = null;
  if (window.stopPublicProfileRefresh) window.stopPublicProfileRefresh();
}

async function logout() {
  const token = Casino.token || localStorage.getItem(SESSION_KEY);

  if (token) {
    const { error } = await supabaseClient.rpc('logout_account', {
      p_token: token
    });
    if (error) console.error(error);
  }

  localStorage.removeItem(SESSION_KEY);
  showLogin();
}

$('#enter').onclick = () => auth(false);
$('#create').onclick = () => auth(true);
$('#pass').addEventListener('keydown', event => {
  if (event.key === 'Enter') auth(false);
});

$('#out').onclick = logout;

// Dock de fichas
// ------------------------------------------------------------

const CHIPS = [
  [1, '#2a62d1'],
  [2, '#7a3fb5'],
  [5, '#c42b3f'],
  [10, '#1f8a55'],
  [25, '#222'],
  [100, '#8f6a22'],
  [500, '#7b2f8f'],
  [1000, '#9a721c'],
  [2000, '#b8860b'],
  [5000, '#d6d6d6']
];

for (const [value, chipColor] of CHIPS) {
  const button = document.createElement('button');
  button.className = 'chip';
  button.textContent = value;
  button.dataset.v = value;
  button.style.setProperty('--c', chipColor);

  button.onclick = () => {
    const activeTab = currentCasinoTab();
    const roulette = activeTab === 'roulette';
    const minesTab = activeTab === 'mines';
    const hiloTab = activeTab === 'hilo';
    const roadTab = activeTab === 'road';
    const minesActive = activeTab === 'mines' && typeof window.isMinesActive === 'function' && window.isMinesActive();
    const pokerTable = activeTab === 'poker' && typeof window.isPokerTableActive === 'function' && window.isPokerTableActive();

    if (roulette) {
      Casino.chip = value;
    } else if (pokerTable && typeof window.pokerAddChip === 'function') {
      window.pokerAddChip(value);
      return;
    } else {
      if (minesActive) return;
      const maxStake = minesTab ? 250 : hiloTab ? 1000 : roadTab ? 500 : Number.MAX_SAFE_INTEGER;
      // Blackjack: sin límite específico. Las fichas altas seleccionan directamente
      // la apuesta y NO se recortan al saldo en el selector. El RPC del servidor
      // rechaza únicamente una apuesta que supere el saldo real disponible.
      // Higher / Lower: máximo 1000 FP.
      if (value >= 1000) {
        Casino.stake = Math.min(value, maxStake);
      } else {
        Casino.stake = Math.min(Casino.stake + value, maxStake);
      }
      if (roadTab && typeof window.roadStakeChanged === 'function') {
        window.roadStakeChanged(Casino.stake);
      }
    }

    Casino.dock();
  };

  $('#chips').append(button);
}

$('#dclr').onclick = () => {
  const activeTab = currentCasinoTab();
  const pokerTable = activeTab === 'poker' && typeof window.isPokerTableActive === 'function' && window.isPokerTableActive();
  if (pokerTable && typeof window.pokerClearRaise === 'function') {
    window.pokerClearRaise();
    return;
  }
  Casino.stake = 0;
  const roadTab = activeTab === 'road';
  if (roadTab && typeof window.roadStakeChanged === 'function') {
    window.roadStakeChanged(Casino.stake);
  }
  Casino.dock();
};

// ------------------------------------------------------------
// Navegación
// ------------------------------------------------------------

$('#nav').onclick = event => {
  const target = event.target.closest('button[data-t]');
  if (!target) return;

  const tab = target.dataset.t;
  if (tab !== 'dinosaur' && typeof window.stopDinosaurio === 'function') window.stopDinosaurio('finished');

  document.querySelectorAll('#nav button').forEach(button => {
    button.classList.toggle('on', button === target);
  });

  document.querySelectorAll('.tab').forEach(section => {
    section.classList.toggle('hidden', section.id !== `t-${tab}`);
  });

  // La ruleta usa un requestAnimationFrame que se detiene cuando su pestaña deja
  // de estar visible. Al volver a Ruleta hay que reactivarlo explícitamente.
  if (tab === 'roulette' && typeof window.startRouletteAnimation === 'function') {
    window.startRouletteAnimation();
  }

  Casino.dock();

  if (tab === 'history') Casino.renderHistory();
  if (tab === 'fortune' && window.refreshFortuneStatus) window.refreshFortuneStatus();
  if (tab === 'road' && window.refreshRoad) window.refreshRoad();
  if (tab === 'mines' && window.refreshMines) window.refreshMines();
  if (tab === 'dinosaur' && window.refreshDinosaurStatus) window.refreshDinosaurStatus();
  if (tab === 'shop' && window.refreshShop) window.refreshShop();
  if (tab === 'multiplayer' && window.loadMatches) window.loadMatches();
};

// ------------------------------------------------------------
// Restaurar sesión propia (sin Supabase Auth)
// ------------------------------------------------------------

restoreSession();
