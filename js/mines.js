// ============================================================
// MINAS — V33.0
// 5x5 · 25 casillas · 1-24 minas
// El servidor resuelve las minas, el multiplicador y el cobro.
// ============================================================

const MINES_MAX_PAYOUT = 5000;
const MINES_MAX_BET = 250;
const MINES_TOTAL = 25;

const mines = {
  initialized: false,
  busy: false,
  config: 5,
  active: null,
  audio: null
};

const mq = id => document.getElementById(id);

function minesMoney(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0))} FP`;
}

function minesMultiplier(value) {
  return `×${Number(value || 1).toFixed(2)}`;
}

function minesCalcMultiplier(minesCount, picks) {
  let multiplier = 0.99;
  for (let i = 0; i < picks; i += 1) {
    multiplier *= (25 - i) / (25 - minesCount - i);
  }
  return multiplier;
}

function minesSafeProbability(minesCount, opened) {
  const safeTotal = 25 - minesCount;
  const unopened = 25 - opened;
  if (unopened <= 0) return 0;
  return (safeTotal - opened) / unopened * 100;
}

function minesSound(kind) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    mines.audio ||= new AudioContext();
    if (mines.audio.state === 'suspended') mines.audio.resume();
    const now = mines.audio.currentTime;
    const osc = mines.audio.createOscillator();
    const gain = mines.audio.createGain();
    osc.connect(gain);
    gain.connect(mines.audio.destination);

    const map = {
      safe: [620, .12, 'sine', .08],
      click: [280, .045, 'triangle', .055],
      cash: [760, .28, 'sine', .1],
      mine: [90, .36, 'sawtooth', .12],
      win: [520, .42, 'triangle', .1]
    };
    const [freq, duration, type, volume] = map[kind] || map.click;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'safe') osc.frequency.exponentialRampToValueAtTime(860, now + duration);
    if (kind === 'cash' || kind === 'win') osc.frequency.exponentialRampToValueAtTime(1050, now + duration);
    if (kind === 'mine') osc.frequency.exponentialRampToValueAtTime(40, now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + .02);
  } catch (_) {}
}

function minesGetOpened() {
  return Array.isArray(mines.active?.opened_positions) ? mines.active.opened_positions : [];
}

function minesSyncStake() {
  const stake = Number(Casino.stake || 0);
  const el = mq('mines-stake');
  if (el) el.textContent = minesMoney(mines.active?.stake ?? stake);
}

function minesSetStatus(text, type = '') {
  const el = mq('mines-status');
  if (!el) return;
  el.textContent = text;
  el.className = `mines-status${type ? ` ${type}` : ''}`;
}

function minesUpdateConfig() {
  const slider = mq('mines-slider');
  if (!slider) return;
  mines.config = Number(slider.value) || 5;
  const fill = ((mines.config - 1) / 23) * 100;
  slider.style.background = `linear-gradient(90deg,var(--brass) 0%,var(--brass) ${fill}%,#20362d ${fill}%,#20362d 100%)`;
  mq('mines-count').textContent = mines.config;
  mq('mines-preview-mines').textContent = `${mines.config} MINAS`;

  const first = minesSafeProbability(mines.config, 0);
  mq('mines-first-prob').textContent = `${first.toFixed(first % 1 ? 1 : 0)}%`;
  if (!mines.active) {
    mq('mines-next-prob').textContent = `${first.toFixed(first % 1 ? 1 : 0)}%`;
    mq('mines-risk-now').textContent = `${(100 - first).toFixed(first % 1 ? 1 : 0)}%`;
    mq('mines-progress').textContent = `0 / ${25 - mines.config}`;
    mq('mines-multiplier').textContent = '×1.00';
    mq('mines-potential').textContent = '0 FP';
    mq('mines-next-multiplier').textContent = minesMultiplier(minesCalcMultiplier(mines.config, 1));
    minesRenderPreview();
    minesRenderBoard();
  }
}

function minesRenderPreview() {
  const box = mq('mines-preview');
  if (!box) return;
  const steps = Math.min(5, 25 - mines.config);
  box.innerHTML = '';
  for (let i = 1; i <= steps; i += 1) {
    const item = document.createElement('div');
    item.innerHTML = `<span>${i}</span><b>${minesMultiplier(minesCalcMultiplier(mines.config, i))}</b>`;
    box.appendChild(item);
  }
}

function minesTileContent(tile, position, opened, minePositions, active) {
  tile.innerHTML = '';
  tile.removeAttribute('aria-label');
  tile.className = 'mines-tile';

  if (opened.has(position)) {
    tile.classList.add('safe');
    const gem = document.createElement('span');
    gem.className = 'mines-gem';
    gem.setAttribute('aria-hidden', 'true');
    tile.appendChild(gem);
    const small = document.createElement('span');
    small.className = 'mines-tile-number';
    small.textContent = '◆';
    tile.appendChild(small);
    tile.disabled = true;
    tile.setAttribute('aria-label', `Casilla ${position + 1}: gema segura`);
    return;
  }

  if (!active && Array.isArray(minePositions) && minePositions.includes(position)) {
    tile.classList.add('mine-revealed');
    const mine = document.createElement('span');
    mine.className = 'mines-bomb';
    mine.setAttribute('aria-hidden', 'true');
    tile.appendChild(mine);
    tile.disabled = true;
    tile.setAttribute('aria-label', `Casilla ${position + 1}: mina`);
    return;
  }

  tile.classList.add('closed');
  tile.innerHTML = '<span class="mines-tile-cross" aria-hidden="true">+</span>';
  tile.disabled = !active || mines.busy;
  tile.setAttribute('aria-label', `Abrir casilla ${position + 1}`);
}

function minesRenderBoard() {
  const board = mq('mines-board');
  if (!board) return;
  const opened = new Set(minesGetOpened());
  const minePositions = mines.active?.mine_positions || [];
  const active = mines.active?.status === 'active';
  board.innerHTML = '';

  for (let position = 0; position < MINES_TOTAL; position += 1) {
    const tile = document.createElement('button');
    tile.type = 'button';
    minesTileContent(tile, position, opened, minePositions, active);
    tile.dataset.position = String(position);
    tile.addEventListener('click', () => minesPick(position));
    board.appendChild(tile);
  }
}

function minesRender() {
  // Solo una partida realmente ACTIVA debe bloquear controles.
  // Estados terminales (lost/cashout/win) se consideran fuera de partida.
  const active = mines.active?.status === 'active' ? mines.active : null;
  const start = mq('mines-start');
  const cash = mq('mines-cashout');
  const fresh = mq('mines-new');
  const slider = mq('mines-slider');

  if (active) {
    if (slider) {
      slider.disabled = true;
      slider.value = String(active.mine_count);
    }
    mq('mines-count').textContent = active.mine_count;
    mq('mines-preview-mines').textContent = `${active.mine_count} MINAS`;
    mq('mines-progress').textContent = `${active.safe_picks || 0} / ${active.safe_total}`;
    mq('mines-multiplier').textContent = minesMultiplier(active.current_multiplier || 1);
    mq('mines-potential').textContent = minesMoney(active.potential_payout || 0);
    mq('mines-next-multiplier').textContent = active.next_multiplier ? minesMultiplier(active.next_multiplier) : '—';
    mq('mines-next-prob').textContent = `${Number(active.next_safe_probability || 0).toFixed(Number(active.next_safe_probability || 0) % 1 ? 1 : 0)}%`;
    mq('mines-risk-now').textContent = `${(100 - Number(active.next_safe_probability || 0)).toFixed(Number(active.next_safe_probability || 0) % 1 ? 1 : 0)}%`;
    minesSyncStake();
    if (start) start.disabled = true;
    if (cash) cash.disabled = active.status !== 'active' || !(active.safe_picks > 0);
    if (fresh) fresh.classList.add('hidden');
  } else {
    if (slider) slider.disabled = false;
    if (start) start.disabled = false;
    if (cash) cash.disabled = true;
    if (fresh) fresh.classList.add('hidden');
    minesSyncStake();
  }

  minesRenderBoard();
}

function minesApplyResult(data) {
  if (!data) return;
  if (typeof data.coins !== 'undefined' && data.outcome !== 'safe') Casino.setBalance(data.coins);
  if (typeof data.bonus_xp === 'number' && data.bonus_xp > 0) {
    Casino.toast(`Racha Minas · +${data.bonus_xp} XP`, 'xp-gain');
  }
  if (['mine', 'cashout', 'win'].includes(data.outcome)) Casino.renderHistory();
}

async function minesStart() {
  if (mines.busy) return;
  const bet = Casino.bet();
  if (!bet) return;
  if (bet > MINES_MAX_BET) {
    minesSetStatus('En Minas la apuesta máxima es de 250 FP.', 'lose');
    return;
  }

  mines.busy = true;
  mq('mines-start').disabled = true;
  minesSetStatus('Preparando el tablero…', 'working');
  const { data, error } = await supabaseClient.rpc('mines_start', {
    p_token: Casino.token,
    p_bet: bet,
    p_mines: mines.config
  });
  mines.busy = false;

  if (error) {
    console.error(error);
    mq('mines-start').disabled = false;
    minesSetStatus(error.message || 'No se ha podido iniciar la partida.', 'lose');
    return;
  }

  Casino.clearStake();
  mines.active = data;
  mines.active.status = 'active';
  mines.active.opened_positions ||= [];
  mines.active.safe_picks = 0;
  mines.active.safe_total = 25 - mines.config;
  mines.active.mine_count = mines.config;
  minesApplyResult(data);
  minesSound('click');
  minesSetStatus(`Partida iniciada · ${mines.config} minas. Elige una casilla.`, 'working');
  minesRender();
  Casino.dock();
}

async function minesPick(position) {
  if (mines.busy || mines.active?.status !== 'active') return;
  if (minesGetOpened().includes(position)) return;

  mines.busy = true;
  const tile = mq('mines-board')?.querySelector(`[data-position="${position}"]`);
  if (tile) {
    tile.classList.add('pressed');
    tile.disabled = true;
  }

  const { data, error } = await supabaseClient.rpc('mines_pick', {
    p_token: Casino.token,
    p_position: position
  });

  mines.busy = false;

  if (error) {
    console.error(error);
    minesSetStatus(error.message || 'No se ha podido resolver la casilla.', 'lose');
    minesRender();
    return;
  }

  if (data.outcome === 'safe') {
    mines.active = { ...mines.active, ...data };
    minesSound('safe');
    minesSetStatus(
      `Gema encontrada · ${minesMultiplier(data.current_multiplier)} · puedes seguir o cobrar.`,
      'win'
    );
    minesApplyResult(data);
    minesRender();
    const safeTile = mq('mines-board')?.querySelector(`[data-position="${position}"]`);
    if (safeTile) safeTile.classList.add('reveal-safe');
    return;
  }

  if (data.outcome === 'mine') {
    mines.active = {
      ...mines.active,
      ...data,
      status: 'lost',
      safe_picks: Array.isArray(data.opened_positions) ? data.opened_positions.length : mines.active.safe_picks,
      mine_positions: data.mine_positions || []
    };
    minesSound('mine');
    minesApplyResult(data);
    minesRender();
    const hit = mq('mines-board')?.querySelector(`[data-position="${position}"]`);
    if (hit) hit.classList.add('mine-hit');
    minesSetStatus(`BOOM · Has encontrado una mina en la casilla ${position + 1}. Apuesta perdida.`, 'lose');
    mq('mines-new')?.classList.remove('hidden');
    return;
  }

  if (data.outcome === 'cashout' || data.outcome === 'win') {
    mines.active = { ...mines.active, ...data };
    minesApplyResult(data);
    minesSound(data.outcome === 'win' ? 'win' : 'cash');
    minesRender();
    minesSetStatus(
      data.outcome === 'win'
        ? `TABLERO COMPLETO · ${minesMoney(data.payout)} cobrados.`
        : `Cobrado · ${minesMoney(data.payout)} asegurados en ${minesMultiplier(data.current_multiplier)}.`,
      'win'
    );
    mq('mines-new')?.classList.remove('hidden');
  }
}

async function minesCashout() {
  if (mines.busy || mines.active?.status !== 'active' || !(mines.active.safe_picks > 0)) return;
  mines.busy = true;
  mq('mines-cashout').disabled = true;
  minesSetStatus('Cerrando la ronda…', 'working');

  const { data, error } = await supabaseClient.rpc('mines_cashout', {
    p_token: Casino.token
  });
  mines.busy = false;

  if (error) {
    console.error(error);
    minesSetStatus(error.message || 'No se ha podido cobrar.', 'lose');
    minesRender();
    return;
  }

  mines.active = { ...mines.active, ...data };
  minesApplyResult(data);
  minesSound('cash');
  minesRender();
  minesSetStatus(`Cobro realizado · ${minesMoney(data.payout)} añadidos al saldo.`, 'win');
  mq('mines-new')?.classList.remove('hidden');
}

function minesReset() {
  // Nueva partida = limpiar por completo el estado visual/local.
  // No depende de que el estado anterior fuese lost, cashout o win.
  mines.active = null;
  mines.busy = false;

  const slider = mq('mines-slider');
  if (slider) {
    slider.disabled = false;
    slider.value = String(mines.config || 5);
  }

  const start = mq('mines-start');
  const cash = mq('mines-cashout');
  const fresh = mq('mines-new');
  if (start) start.disabled = false;
  if (cash) cash.disabled = true;
  if (fresh) fresh.classList.add('hidden');

  minesSetStatus('Selecciona cuántas minas quieres y prepara tu apuesta con las fichas de abajo.');
  minesUpdateConfig();
  minesRender();
  Casino.dock();
}

async function refreshMines() {
  if (!Casino.token) return;
  const { data, error } = await supabaseClient.rpc('mines_get_active', {
    p_token: Casino.token
  });
  if (error) {
    console.error(error);
    minesSetStatus('No se ha podido recuperar el estado de Minas.', 'lose');
    return;
  }
  if (data) {
    mines.active = data;
    minesSetStatus(`Partida recuperada · ${data.mine_count} minas · ${data.safe_picks} gemas seguras.`, 'working');
    minesRender();
  } else if (!mines.active || mines.active.status !== 'active') {
    mines.active = null;
    minesUpdateConfig();
  }
  Casino.dock();
}

function isMinesActive() {
  return mines.active?.status === 'active';
}

function minesInit() {
  if (mines.initialized) return;
  if (!mq('t-mines')) return;
  mines.initialized = true;

  mq('mines-slider').addEventListener('input', minesUpdateConfig);
  mq('mines-start').addEventListener('click', minesStart);
  mq('mines-cashout').addEventListener('click', minesCashout);
  mq('mines-new').addEventListener('click', minesReset);

  minesUpdateConfig();
  minesRender();
}

window.isMinesActive = isMinesActive;
window.refreshMines = refreshMines;
window.minesStakeChanged = minesSyncStake;

minesInit();
