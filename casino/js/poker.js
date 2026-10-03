// ============================================================
// POKER ONLINE - V22
// Texas Hold'em No-Limit.
// El navegador solo presenta el estado y envía acciones.
// La lógica de cartas, apuestas, bote y saldo vive en PostgreSQL.
// ============================================================

const poker = {
  tableId: null,
  state: null,
  channel: null,
  ready: false,
  busy: false,
  lobbyTimer: null,
  tableTimer: null,
  raiseTo: 0,
  renderSerial: 0
};

const pokerMoney = value => `${Number(value) || 0} FP`;
const pokerSuit = ['♠', '♥', '♦', '♣'];
const pokerRank = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function pokerCardKey(card) {
  return card ? `${card.r}-${card.s}` : '';
}

function pokerCardElement(card, className = '') {
  const el = document.createElement('div');
  if (!card) return el;

  const rank = pokerRank[Number(card.r)] || '?';
  const suit = pokerSuit[Number(card.s)] || '?';
  const red = Number(card.s) === 1 || Number(card.s) === 2;

  el.className = `poker-card ${red ? 'red' : ''} ${className}`.trim();
  el.innerHTML = `
    <span class="pc-corner pc-top"><b>${rank}</b><i>${suit}</i></span>
    <strong aria-hidden="true">${suit}</strong>
    <span class="pc-corner pc-bottom"><b>${rank}</b><i>${suit}</i></span>
  `;

  return el;
}

function pokerSound(kind = 'chip') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const sounds = {
      chip: [180, 0.045, 'triangle', 0.055],
      deal: [460, 0.075, 'triangle', 0.06],
      turn: [560, 0.09, 'sine', 0.065],
      win: [740, 0.17, 'sine', 0.10],
      lose: [150, 0.13, 'sawtooth', 0.05],
      allin: [260, 0.12, 'square', 0.075]
    };

    const [freq, duration, type, volume] = sounds[kind] || sounds.chip;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (_) {}
}

function pokerSetStatus(text, type = '') {
  const box = $('#poker-status');
  if (!box) return;
  box.textContent = text;
  box.className = `poker-status ${type}`.trim();
}

function pokerCurrentPlayer() {
  return poker.state?.players?.find(p => p.user_id === Casino.user?.id) || null;
}

function pokerCanAct() {
  const me = pokerCurrentPlayer();
  return !!(
    poker.state &&
    me &&
    ['preflop','flop','turn','river'].includes(poker.state.status) &&
    poker.state.current_seat === me.seat &&
    me.in_hand &&
    !me.folded &&
    Number(me.stack) > 0
  );
}

function pokerChipMarkup(amount) {
  amount = Math.max(0, Number(amount) || 0);
  if (!amount) return '<span class="poker-chip-empty">Sin apuesta</span>';

  const denoms = [25, 10, 5, 2, 1];
  const classes = {25:'gold', 10:'green', 5:'red', 2:'purple', 1:'blue'};
  let remaining = amount;
  let totalChips = 0;
  const chips = [];
  const maxVisible = 8;

  for (const denom of denoms) {
    const count = Math.floor(remaining / denom);
    remaining -= count * denom;
    totalChips += count;
    for (let i = 0; i < count && chips.length < maxVisible; i++) {
      chips.push(`<i class="poker-bet-chip ${classes[denom]}" title="${denom} FP">${denom}</i>`);
    }
  }

  const extra = totalChips > maxVisible
    ? `<b class="poker-chip-more">+${totalChips - maxVisible}</b>`
    : '';

  return `<div class="poker-bet-chip-stack">${chips.join('')}${extra}</div><span class="poker-bet-value">${amount} FP</span>`;
}

function pokerRenderSeat(player, previousState) {
  const seat = document.createElement('div');
  const previousPlayer = previousState?.players?.find(p => p.user_id === player.user_id);
  const changed = Number(previousPlayer?.round_bet || 0) !== Number(player.round_bet || 0);
  const award = Number(poker.state?.last_result?.awards?.[player.user_id] || 0);
  const isWinner = award > 0;

  seat.className = [
    'poker-seat',
    `poker-seat-${player.seat}`,
    player.user_id === Casino.user?.id ? 'mine' : '',
    poker.state?.current_seat === player.seat ? 'turn' : '',
    player.folded ? 'folded' : '',
    player.all_in ? 'allin' : '',
    isWinner ? 'winner' : ''
  ].filter(Boolean).join(' ');

  seat.innerHTML = `
    <div class="poker-avatar poker-profile-avatar"><button type="button" class="profile-avatar-button" data-profile-username="${escapeHtml(player.username || 'Jugador')}" title="Ver perfil">${avatarLevelHtml(getAvatarForUser?.(player.user_id) || 'avatar_01', getLevelForUser?.(player.user_id) || 1, 'poker-avatar-img', 'avatar-level-wrap poker-avatar-level-wrap', player.username || 'Jugador')}</button></div>
    <div class="poker-seat-info">
      <b><button type="button" class="profile-link poker-profile-name" data-profile-username="${escapeHtml(player.username || 'Jugador')}">${escapeHtml(player.username || 'Jugador')}</button></b>
      <span>${pokerMoney(player.stack)}</span>
    </div>
    <div class="poker-player-bet-wrap">
      <span class="poker-bet-label">APUESTA</span>
      ${pokerChipMarkup(player.round_bet)}
    </div>
    ${player.user_id === Casino.user?.id ? '<em>TÚ</em>' : ''}
    ${player.all_in ? '<strong class="allin-badge">ALL-IN</strong>' : ''}
    ${isWinner ? `<strong class="winner-badge">+${award} FP</strong>` : ''}
    ${poker.state?.button_seat === player.seat ? '<i class="dealer-button">D</i>' : ''}
  `;

  if (changed) {
    seat.querySelector('.poker-player-bet-wrap')?.classList.add('poker-chip-pop');
  }

  if (poker.state?.status === 'showdown') {
    const hand = poker.state?.showdown_hands?.find(h => h.user_id === player.user_id);
    if (hand) {
      const info = document.createElement('small');
      info.className = 'poker-showdown-seat-info';
      info.textContent = hand.hand_name || '';
      seat.append(info);
    }
  }

  return seat;
}

function pokerAnimateDeck(kind = 'deal') {
  const deck = $('.poker-deck-visual');
  if (!deck) return;
  deck.classList.remove('poker-deck-dealing');
  void deck.offsetWidth;
  deck.classList.add('poker-deck-dealing');
  pokerSound(kind === 'street' ? 'turn' : 'deal');
  setTimeout(() => deck.classList.remove('poker-deck-dealing'), 900);
}

function pokerRenderCommunity(state, previousState) {
  const box = $('#poker-community');
  if (!box) return;

  const cards = state.community || [];
  const previous = previousState?.community || [];
  box.innerHTML = '';

  cards.forEach((card, index) => {
    const isNew = pokerCardKey(card) !== pokerCardKey(previous[index]);
    const element = pokerCardElement(card, isNew ? 'poker-card-enter' : '');
    element.style.setProperty('--card-delay', `${Math.min(index, 4) * 0.12}s`);
    box.append(element);
  });

  if (cards.length > previous.length) {
    pokerAnimateDeck(cards.length === 3 && previous.length === 0 ? 'deal' : 'street');
  }
}

function pokerRenderHoleCards(state, previousState) {
  const box = $('#poker-hole-cards');
  if (!box) return;

  const cards = state.hole_cards || [];
  const previous = previousState?.hole_cards || [];
  box.innerHTML = '';

  cards.forEach((card, index) => {
    const isNew = pokerCardKey(card) !== pokerCardKey(previous[index]);
    const element = pokerCardElement(card, `poker-hole-card ${isNew ? 'poker-card-enter' : ''}`);
    element.style.setProperty('--card-delay', `${index * 0.16}s`);
    box.append(element);
  });

  if (cards.length && previous.length === 0) {
    pokerSound('deal');
    pokerAnimateDeck('deal');
  }
}

function pokerRenderShowdownBanner(state) {
  let banner = $('#poker-result-banner');
  if (!banner) return;

  const result = state.status === 'showdown' ? state.last_result : null;
  if (!result) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const awards = result.awards || {};
  const winners = (state.players || [])
    .filter(p => Number(awards[p.user_id] || 0) > 0)
    .map(p => `${escapeHtml(p.username)} · +${Number(awards[p.user_id] || 0)} FP`);

  banner.innerHTML = `
    <span>SHOWDOWN</span>
    <strong>${escapeHtml(result.message || 'Mano terminada.')}</strong>
    ${winners.length ? `<small>${winners.join(' · ')}</small>` : ''}
  `;
  banner.classList.remove('hidden');
}

function pokerRenderWaiting(state) {
  const room = $('#poker-waiting-room');
  const table = $('#poker-table');
  const myPanel = $('.poker-my-hand-panel');
  const actions = $('.poker-actions-panel');
  const bottom = $('.poker-table-bottom');
  const start = $('#poker-start-hand');
  const next = $('#poker-next-hand');
  const isWaiting = state?.status === 'waiting';

  room?.classList.toggle('hidden', !isWaiting);
  table?.classList.toggle('hidden', isWaiting);
  myPanel?.classList.toggle('hidden', isWaiting);
  actions?.classList.toggle('hidden', isWaiting);

  // El footer queda visible durante SHOWDOWN para poder iniciar una nueva mano.
  bottom?.classList.toggle('hidden', false);
  start?.classList.toggle('hidden', !isWaiting);
  next?.classList.toggle('hidden', state?.status !== 'showdown');

  if (!isWaiting) return;

  const players = state.players || [];
  const eligible = players.filter(p => Number(p.stack) > 0);
  const isHost = state.host_id === Casino.user?.id;

  $('#poker-waiting-title').textContent = state.name || 'Mesa preparada';
  $('#poker-waiting-count').textContent = `${players.length} / 6`;

  const message = $('#poker-waiting-message');
  if (message) {
    message.textContent = isHost
      ? (eligible.length >= 2
        ? 'Hay jugadores suficientes. Tú decides cuándo empieza la partida.'
        : 'Necesitas al menos 2 jugadores con FP.')
      : 'Esperando a que el anfitrión empiece la partida.';
  }

  const list = $('#poker-waiting-players');
  if (list) {
    list.innerHTML = '';
    players.forEach(player => {
      const item = document.createElement('div');
      item.className = `poker-waiting-player ${player.user_id === Casino.user?.id ? 'mine' : ''}`;
      const isPlayerHost = player.user_id === state.host_id;
      item.innerHTML = `
        <span class="poker-wp-avatar">${avatarLevelHtml(getAvatarForUser?.(player.user_id) || 'avatar_01', getLevelForUser?.(player.user_id) || 1, 'poker-wp-avatar-img', 'avatar-level-wrap poker-wp-avatar-level-wrap', player.username || 'Jugador')}</span>
        <span class="poker-wp-main">
          <b><button type="button" class="profile-link poker-profile-name" data-profile-username="${escapeHtml(player.username || 'Jugador')}">${escapeHtml(player.username || 'Jugador')}</button></b>
          <small>${isPlayerHost ? 'ANFITRIÓN' : 'Jugador'} · ${pokerMoney(player.stack)}</small>
        </span>
        <span class="poker-wp-ready">${Number(player.stack) > 0 ? 'LISTO' : 'SIN FP'}</span>
      `;
      list.append(item);
    });
  }

  if (start) {
    start.disabled = !isHost || eligible.length < 2;
    start.textContent = isHost ? '♠ Empezar partida' : 'Esperando al anfitrión';
  }
}

function pokerRenderActions(state) {
  const me = pokerCurrentPlayer();
  const canAct = pokerCanAct();
  const currentBet = Number(state.current_bet || 0);
  const myRound = Number(me?.round_bet || 0);
  const myStack = Number(me?.stack || 0);
  const toCall = Math.max(0, currentBet - myRound);
  const maxTotal = myRound + myStack;
  const minTotal = currentBet === 0
    ? Number(state.big_blind || 2)
    : currentBet + Number(state.min_raise || state.big_blind || 2);

  $('#poker-to-call').textContent = canAct
    ? (toCall > 0 ? `Pagar ${pokerMoney(toCall)}` : 'Puedes pasar o apostar')
    : 'Esperando turno…';

  const statusLine = $('#poker-action-line');
  if (state.status === 'showdown') {
    statusLine.textContent = 'Mano terminada · revisa el resultado antes de iniciar la siguiente.';
  } else if (canAct) {
    statusLine.textContent = toCall > 0
      ? `Tu turno · ${toCall} FP para igualar.`
      : 'Tu turno · puedes pasar, apostar o ir all-in.';
  } else {
    const current = (state.players || []).find(p => p.seat === state.current_seat);
    statusLine.textContent = current ? `Turno de ${current.username}` : 'Resolviendo…';
  }

  const fold = $('#poker-fold');
  const check = $('#poker-check');
  const call = $('#poker-call');
  const raise = $('#poker-raise');
  const allIn = $('#poker-allin');

  if (fold) fold.disabled = !canAct;
  if (check) check.disabled = !canAct || toCall !== 0;
  if (call) {
    call.disabled = !canAct || toCall === 0;
    call.textContent = toCall > 0 ? `Pagar ${toCall} FP` : 'Pagar';
  }
  if (allIn) allIn.disabled = !canAct || myStack <= 0;

  const canRaise = canAct && !me?.acted_this_round && maxTotal > currentBet && maxTotal >= minTotal;
  if (raise) {
    raise.disabled = !canRaise;
    raise.textContent = currentBet === 0 ? 'Apostar' : 'Subir';
  }

  const input = $('#poker-raise-amount');
  if (input) {
    input.disabled = !canRaise;
    input.min = minTotal;
    input.max = maxTotal;
    const suggested = Math.min(maxTotal, Math.max(minTotal, poker.raiseTo || minTotal));
    if (!Number(input.value) || Number(input.value) < minTotal || Number(input.value) > maxTotal) {
      input.value = suggested;
    }
    poker.raiseTo = Number(input.value) || suggested;
    $('#poker-raise-preview').textContent = `${poker.raiseTo} FP`;
  }

  const rebuy = $('#poker-rebuy');
  if (rebuy) {
    rebuy.disabled = !['waiting','showdown'].includes(state.status) || Number(me?.stack || 0) !== 0;
  }
}

function pokerRender(state, previousState = null) {
  if (!state) return;
  poker.state = state;

  $('#poker-table-title').textContent = state.name || 'Texas Hold\'em';
  $('#poker-table-sub').textContent = state.status === 'showdown'
    ? 'MESA · SHOWDOWN'
    : state.status === 'waiting'
      ? 'MESA · ESPERANDO JUGADORES'
      : `MESA · ${String(state.street || state.status).toUpperCase()}`;

  $('#poker-pot').textContent = pokerMoney(state.pot || 0);
  $('#poker-my-stack').textContent = pokerMoney(state.my_stack || 0);

  const seats = $('#poker-seats');
  if (seats) {
    seats.innerHTML = '';
    (state.players || []).forEach(player => seats.append(pokerRenderSeat(player, previousState)));
  }

  pokerRenderCommunity(state, previousState);
  pokerRenderHoleCards(state, previousState);
  pokerRenderWaiting(state);

  const handName = $('#poker-my-hand-name');
  if (handName) handName.textContent = state.hand_name || '—';

  if (state.status !== 'waiting') pokerRenderActions(state);
  pokerRenderShowdownBanner(state);

  const next = $('#poker-next-hand');
  if (next) {
    const eligible = (state.players || []).filter(p => Number(p.stack) > 0).length;
    const isHost = state.host_id === Casino.user?.id;
    next.disabled = state.status !== 'showdown' || !isHost || eligible < 2;
    next.textContent = isHost ? '♠ Nueva mano' : 'Esperando al anfitrión';
  }

  let dealerText = 'El dealer está preparado.';
  if (state.last_action?.message) dealerText = state.last_action.message;
  if (state.status === 'showdown' && state.last_result?.message) dealerText = state.last_result.message;
  const dealerBox = $('#poker-dealer-text');
  if (dealerBox) dealerBox.textContent = dealerText;

  const resultType = state.status === 'showdown'
    ? ((Number(state.last_result?.awards?.[Casino.user?.id] || 0) > 0) ? 'win' : 'lose')
    : (pokerCanAct() ? 'turn' : '');
  pokerSetStatus(
    state.status === 'showdown'
      ? (state.last_result?.message || 'Mano terminada.')
      : (pokerCanAct() ? 'Tu turno.' : 'Esperando a los demás jugadores…'),
    resultType
  );

  if (state.status === 'showdown' && previousState?.status !== 'showdown') {
    const ownAward = Number(state.last_result?.awards?.[Casino.user?.id] || 0);
    if (ownAward > 0) pokerSound('win');
    else pokerSound('lose');
    if (window.refreshSidebar) window.refreshSidebar();
    Casino.renderHistory();
  }

  Casino.dock();
}

function pokerMinRaiseTotal() {
  if (!poker.state) return 2;
  const current = Number(poker.state.current_bet || 0);
  return current === 0
    ? Number(poker.state.big_blind || 2)
    : current + Number(poker.state.min_raise || poker.state.big_blind || 2);
}

function pokerMaxRaiseTotal() {
  const me = pokerCurrentPlayer();
  return Number(me?.round_bet || 0) + Number(me?.stack || 0);
}

function pokerSetRaiseAmount(value) {
  if (!poker.state) return;
  const min = pokerMinRaiseTotal();
  const max = pokerMaxRaiseTotal();
  poker.raiseTo = Math.max(min, Math.min(max, Number(value) || min));
  const input = $('#poker-raise-amount');
  if (input) input.value = poker.raiseTo;
  const preview = $('#poker-raise-preview');
  if (preview) preview.textContent = `${poker.raiseTo} FP`;
  Casino.dock();
}

function pokerRaiseToPot() {
  const pot = Number(poker.state?.pot || 0);
  const current = Number(poker.state?.current_bet || 0);
  const min = pokerMinRaiseTotal();
  pokerSetRaiseAmount(Math.max(min, current + pot));
}

function pokerAddChip(value) {
  if (!poker.state || !pokerCanAct()) return;
  const max = pokerMaxRaiseTotal();
  const min = pokerMinRaiseTotal();
  const base = Math.max(min, Number(poker.raiseTo) || min);
  pokerSetRaiseAmount(Math.min(max, base + Number(value || 0)));
}

function pokerClearRaise() {
  pokerSetRaiseAmount(pokerMinRaiseTotal());
}

function isPokerTableActive() {
  return !!poker.tableId && !$('#poker-table-view')?.classList.contains('hidden');
}

async function pokerCall(name, args = {}) {
  const { data, error } = await supabaseClient.rpc(name, {
    p_token: Casino.token,
    ...args
  });
  if (error) {
    console.error(`[POKER] ${name}`, error);
    throw new Error(error.message || 'Error de Poker');
  }
  return data;
}

async function pokerLoadState() {
  if (!poker.tableId || !Casino.token) return;
  const previous = poker.state;
  try {
    const data = await pokerCall('poker_get_state', { p_table_id: poker.tableId });
    pokerRender(data, previous);
  } catch (error) {
    console.error(error);
    pokerSetStatus(error.message, 'lose');
  }
}

async function pokerLoadLobby() {
  const box = $('#poker-lobby');
  if (!box || !Casino.user) return;

  try {
    const { data, error } = await supabaseClient.rpc('poker_lobby_list', { p_token: Casino.token });
    if (error) throw error;

    const tables = Array.isArray(data) ? data : [];
    if (!tables.length) {
      box.innerHTML = '<div class="poker-empty"><b>No hay mesas abiertas.</b><span>Crea la primera y espera a tus rivales.</span></div>';
      return;
    }

    box.innerHTML = '';
    for (const table of tables) {
      const players = Array.isArray(table.players) ? table.players : [];
      const mine = players.some(p => p.user_id === Casino.user.id);
      const isOpen = table.status === 'waiting' || table.status === 'showdown';
      const card = document.createElement('div');
      card.className = 'poker-lobby-item';

      const stateLabel = table.status === 'showdown' ? 'Entre manos' : 'Esperando jugadores';
      const names = players.map(p => escapeHtml(p.username)).join(' · ') || 'Mesa vacía';
      card.innerHTML = `
        <div class="poker-lobby-info">
          <b>♠ ${escapeHtml(table.name)}</b>
          <span>${table.player_count}/6 · ${pokerMoney(table.buy_in)} entrada · ciegas 1/2 FP</span>
          <small>${stateLabel} · ${names}</small>
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'poker-lobby-actions';

      if (mine) {
        const open = document.createElement('button');
        open.className = 'main';
        open.textContent = 'Abrir mesa';
        open.onclick = () => pokerOpenTable(table.id);
        actions.append(open);
      } else if (isOpen && players.length < 6) {
        const join = document.createElement('button');
        join.className = 'main';
        join.textContent = `Unirse · ${pokerMoney(table.buy_in)}`;
        join.onclick = () => pokerJoin(table.id);
        actions.append(join);
      } else {
        const full = document.createElement('button');
        full.disabled = true;
        full.textContent = table.status === 'waiting' || table.status === 'showdown' ? 'Llena' : 'En curso';
        actions.append(full);
      }

      card.append(actions);
      box.append(card);
    }
  } catch (error) {
    console.error(error);
    box.innerHTML = '<div class="poker-empty"><b>No se pueden cargar las mesas.</b><span>Revisa la migración 16 del Poker.</span></div>';
  }
}

function pokerStartTablePolling() {
  if (poker.tableTimer) return;
  poker.tableTimer = setInterval(async () => {
    if (!poker.tableId || $('#multi-game-poker')?.classList.contains('hidden')) return;
    await pokerLoadState();
  }, 1800);
}

function pokerStopTablePolling() {
  if (poker.tableTimer) {
    clearInterval(poker.tableTimer);
    poker.tableTimer = null;
  }
}

function pokerStartLobbyPolling() {
  if (poker.lobbyTimer) return;
  poker.lobbyTimer = setInterval(async () => {
    if (poker.tableId || $('#multi-game-poker')?.classList.contains('hidden')) {
      pokerStopLobbyPolling();
      return;
    }
    await pokerLoadLobby();
  }, 1800);
}

function pokerStopLobbyPolling() {
  if (poker.lobbyTimer) {
    clearInterval(poker.lobbyTimer);
    poker.lobbyTimer = null;
  }
}

async function pokerOpenTable(tableId) {
  pokerStopLobbyPolling();
  poker.tableId = tableId;
  $('#poker-lobby-view')?.classList.add('hidden');
  $('#poker-table-view')?.classList.remove('hidden');
  await pokerLoadState();
  pokerStartTablePolling();
  Casino.dock();
}

async function pokerCreate() {
  const name = String($('#poker-table-name')?.value || 'Mesa de lujo').trim().slice(0,28);
  const buyIn = Number($('#poker-buy-in')?.value || 50);
  if (!name) return Casino.toast('Pon un nombre a la mesa.');

  try {
    const data = await pokerCall('poker_create_table', {
      p_name: name,
      p_buy_in: buyIn
    });
    await Casino.loadProfile();
    await pokerOpenTable(data.table_id);
    if (window.refreshSidebar) window.refreshSidebar();
  } catch (error) {
    Casino.toast(error.message);
  }
}

async function pokerJoin(tableId) {
  try {
    await pokerCall('poker_join_table', { p_match_id: tableId });
    await Casino.loadProfile();
    await pokerOpenTable(tableId);
    if (window.refreshSidebar) window.refreshSidebar();
  } catch (error) {
    Casino.toast(error.message);
  }
}

async function pokerStart() {
  const state = poker.state;
  if (!state || !['waiting','showdown'].includes(state.status)) return;

  const button = state.status === 'showdown' ? $('#poker-next-hand') : $('#poker-start-hand');
  if (button?.disabled) return;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = state.status === 'showdown' ? '♠ Preparando…' : '♠ Repartiendo…';
    }

    pokerSetStatus('El dealer prepara la mesa…', 'working');
    await pokerCall('poker_start_hand', { p_table_id: poker.tableId });
    await Casino.loadProfile();
    await pokerLoadState();
  } catch (error) {
    console.error(error);
    Casino.toast(error.message);
    await pokerLoadState();
  }
}

async function pokerAction(action, amount = null) {
  if (poker.busy || !pokerCanAct()) return;
  poker.busy = true;

  try {
    const finalAmount = action === 'raise'
      ? Number(amount ?? poker.raiseTo ?? $('#poker-raise-amount')?.value ?? 0)
      : amount;

    const previous = poker.state;
    const data = await pokerCall('poker_action', {
      p_table_id: poker.tableId,
      p_action: action,
      p_amount: finalAmount
    });

    await Casino.loadProfile();
    poker.raiseTo = 0;
    pokerRender(data, previous);

    if (action === 'allin') pokerSound('allin');
    else pokerSound('chip');

    if (data.status === 'showdown') {
      await Casino.renderHistory();
      if (window.refreshSidebar) await window.refreshSidebar();
    }
  } catch (error) {
    console.error(error);
    Casino.toast(error.message);
    await pokerLoadState();
  } finally {
    poker.busy = false;
  }
}

async function pokerLeave() {
  if (!poker.tableId) return;
  try {
    const data = await pokerCall('poker_leave_table', { p_table_id: poker.tableId });
    await Casino.loadProfile();
    pokerStopTablePolling();
    poker.tableId = null;
    poker.state = null;
    $('#poker-table-view')?.classList.add('hidden');
    $('#poker-lobby-view')?.classList.remove('hidden');
    await pokerLoadLobby();
    pokerStartLobbyPolling();
    Casino.dock();
    Casino.toast(`Has salido de la mesa. Recuperas ${pokerMoney(data.cash_out || 0)}.`);
    if (window.refreshSidebar) window.refreshSidebar();
  } catch (error) {
    Casino.toast(error.message);
  }
}

async function pokerRebuy() {
  try {
    const data = await pokerCall('poker_rebuy', { p_table_id: poker.tableId });
    await Casino.loadProfile();
    pokerRender(data, poker.state);
    Casino.toast(`Has recomprado ${pokerMoney(data.buy_in || 0)}.`);
  } catch (error) {
    Casino.toast(error.message);
  }
}

function pokerCloseViewToLobby() {
  pokerStopTablePolling();
  poker.tableId = null;
  poker.state = null;
  $('#poker-table-view')?.classList.add('hidden');
  $('#poker-lobby-view')?.classList.remove('hidden');
  pokerLoadLobby();
  pokerStartLobbyPolling();
  Casino.dock();
}

async function initPoker() {
  if (!Casino.user) return;

  if (!poker.ready) {
    poker.ready = true;

    $('#poker-create').onclick = pokerCreate;
    $('#poker-refresh').onclick = pokerLoadLobby;
    $('#poker-start-hand').onclick = pokerStart;
    $('#poker-next-hand').onclick = pokerStart;
    $('#poker-rebuy').onclick = pokerRebuy;
    $('#poker-leave').onclick = pokerLeave;

    $('#poker-fold').onclick = () => pokerAction('fold');
    $('#poker-check').onclick = () => pokerAction('check');
    $('#poker-call').onclick = () => pokerAction('call');
    $('#poker-raise').onclick = () => pokerAction('raise', Number($('#poker-raise-amount').value) || 0);
    $('#poker-allin').onclick = () => pokerAction('allin');

    $('#poker-raise-amount').addEventListener('input', () => {
      pokerSetRaiseAmount(Number($('#poker-raise-amount').value) || 0);
    });
    $('#poker-raise-min').onclick = () => pokerSetRaiseAmount(pokerMinRaiseTotal());
    $('#poker-raise-pot').onclick = pokerRaiseToPot;

    poker.channel = supabaseClient
      .channel('casino-poker-live-v22')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'poker_tables'
      }, async payload => {
        if (payload.new?.id === poker.tableId || payload.old?.id === poker.tableId) {
          await pokerLoadState();
        }
        if (!poker.tableId) await pokerLoadLobby();
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[POKER] Realtime no disponible; sigue activo el refresco de respaldo.');
        }
      });
  }

  if (poker.tableId) {
    pokerStopLobbyPolling();
    await pokerLoadState();
    pokerStartTablePolling();
  } else {
    pokerStopTablePolling();
    await pokerLoadLobby();
    pokerStartLobbyPolling();
  }
}

window.initPoker = initPoker;
window.pokerOpenTable = pokerOpenTable;
window.isPokerOpen = () => !$('#multi-game-poker')?.classList.contains('hidden');
window.pokerAddChip = pokerAddChip;
window.pokerClearRaise = pokerClearRaise;
window.isPokerTableActive = isPokerTableActive;
window.pokerSetRaiseAmount = pokerSetRaiseAmount;
