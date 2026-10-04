/* ============================================================
   CONNECT 4 — MULTIJUGADOR V36.15
   Cliente ligero: el servidor decide estado, turno y resultado.
   ============================================================ */
(() => {
  const $$ = (selector, root = document) => root.querySelector(selector);
  const $$$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  let roomId = null;
  let state = null;
  let pollTimer = null;
  let lobbyTimer = null;
  let busy = false;
  let lastBoardKey = '';
  let lastPlayersKey = '';
  let tossTimer = null;
  let tossStarted = false;
  let lastStatus = '';
  let bound = false;

  function logged() { return Boolean(window.Casino?.token); }
  function isPlaying() { return Boolean(roomId && state && ['tossing','live'].includes(state.status)); }
  function isMultiplayerTab() { return document.querySelector('#nav button.on')?.dataset?.t === 'multiplayer'; }

  function stopTimers() {
    clearTimeout(pollTimer); clearTimeout(lobbyTimer);
    pollTimer = lobbyTimer = null;
  }

  function setMessage(text = '', type = '') {
    const el = $$('#c4-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = `c4-feedback ${type}`.trim();
  }

  function playerAvatar(player, size = 'multi-avatar') {
    if (!player) return '';
    const items = Array.isArray(player.shop_cosmetics) ? player.shop_cosmetics : [];
    if (window.shopAvatarLevelHtml) {
      return window.shopAvatarLevelHtml(player.id, player.avatar_id || 'avatar_01', player.level || 1, size, player.username || '', items);
    }
    if (window.avatarUrl) {
      return `<span class="c4-avatar-fallback"><img class="${size}" src="${esc(window.avatarUrl(player.avatar_id || 'avatar_01'))}" alt="${esc(player.username || '')}"><b>${Math.max(1, Number(player.level || 1))}</b></span>`;
    }
    return '';
  }

  function playerTitle(player) {
    if (!player || !window.shopTitleBadge) return '';
    return window.shopTitleBadge(player.id, Array.isArray(player.shop_cosmetics) ? player.shop_cosmetics : null);
  }

  function playerName(player) {
    if (!player) return '';
    const color = window.shopNameColorClass ? window.shopNameColorClass(player.id, player.shop_cosmetics || null) : '';
    return `<span class="c4-player-name ${esc(color)}">${esc(player.username)}</span>`;
  }

  function renderPlayerCard(player, color, label, active) {
    if (!player) return `<article class="c4-player-card ${color}"><div class="c4-player-empty"><span>?</span><b>${esc(label)}</b></div></article>`;
    return `
      <article class="c4-player-card ${color} ${active ? 'turn' : ''}">
        <div class="c4-player-top">
          <div class="c4-player-avatar">${playerAvatar(player)}</div>
          <div class="c4-player-copy">
            <span class="c4-color-label">${esc(label)}</span>
            <div class="c4-name-line">${playerName(player)}${playerTitle(player)}</div>
            ${active ? '<span class="c4-turn-badge">TU TURNO</span>' : ''}
          </div>
        </div>
        <span class="c4-color-dot"></span>
      </article>`;
  }

  function roomSummary(room) {
    const host = room.host || {};
    return `
      <article class="c4-room-card">
        <div class="c4-room-player">${playerAvatar(host, 'multi-avatar-small')}
          <div><strong>${playerName(host)}</strong>${playerTitle(host)}<small>Sala creada · apuesta <b>${Number(room.stake) || 0} FP</b></small></div>
        </div>
        <button class="main c4-join" data-room-id="${esc(room.id)}">UNIRME <span>→</span></button>
      </article>`;
  }

  function renderLobby(rooms = []) {
    const list = $$('#c4-rooms');
    if (!list) return;
    list.innerHTML = rooms.length
      ? rooms.map(roomSummary).join('')
      : `<div class="c4-lobby-empty"><div class="c4-empty-orb">4</div><h3>No hay salas abiertas</h3><p>Selecciona una apuesta con las fichas de abajo y crea la primera sala.</p></div>`;
  }

  function renderLobbyShell() {
    const box = $$('#c4-lobby-view');
    if (!box) return;
    box.classList.remove('hidden');
    $$('#c4-match-view')?.classList.add('hidden');
  }

  function renderMatchShell() {
    $$('#c4-lobby-view')?.classList.add('hidden');
    $$('#c4-match-view')?.classList.remove('hidden');
  }

  function myColor() {
    if (!state?.me?.id) return '';
    return state.red_player?.id === state.me.id ? 'red' : state.blue_player?.id === state.me.id ? 'blue' : '';
  }

  function renderMeta() {
    const pot = $$('#c4-pot'); if (pot) pot.textContent = `${Number(state?.pot || 0)} FP`;
    const stake = $$('#c4-stake'); if (stake) stake.textContent = `${Number(state?.stake || 0)} FP`;
    const round = $$('#c4-status-label');
    if (!round) return;
    if (state?.status === 'waiting') round.textContent = 'ESPERANDO OPONENTE';
    else if (state?.status === 'tossing') round.textContent = 'LANZAMIENTO';
    else if (state?.status === 'live') round.textContent = state?.turn_user_id === state?.me?.id ? 'TU TURNO' : 'TURNO DEL RIVAL';
    else if (state?.winner_id === state?.me?.id) round.textContent = 'VICTORIA';
    else if (state?.winner_id) round.textContent = 'DERROTA';
    else round.textContent = 'EMPATE';

    const mine = $$('#c4-my-color');
    if (mine) mine.textContent = myColor() === 'red' ? 'ROJO' : myColor() === 'blue' ? 'AZUL' : '—';
  }

  function renderPlayers(force = false) {
    const key = JSON.stringify({r:state?.red_player?.id,b:state?.blue_player?.id,h:state?.me?.id,rt:state?.turn_user_id,st:state?.status,w:state?.winner_id});
    if (!force && key === lastPlayersKey) return;
    lastPlayersKey = key;
    const red = $$('#c4-red-player');
    const blue = $$('#c4-blue-player');
    if (state?.status === 'waiting') {
      if (red) red.innerHTML = renderPlayerCard(state?.me, 'red waiting-seat', 'CREADOR', false);
      if (blue) blue.innerHTML = renderPlayerCard(null, 'blue', 'ESPERANDO RIVAL', false);
      return;
    }
    if (red) red.innerHTML = renderPlayerCard(state?.red_player, 'red', 'ROJO', state?.turn_user_id === state?.red_player?.id && state?.status === 'live');
    if (blue) blue.innerHTML = renderPlayerCard(state?.blue_player, 'blue', 'AZUL', state?.turn_user_id === state?.blue_player?.id && state?.status === 'live');
  }

  function renderBoard(force = false) {
    const board = Array.isArray(state?.board) ? state.board : [];
    const key = board.join('') + `|${state?.turn_user_id || ''}|${state?.status}`;
    if (!force && key === lastBoardKey) return;
    const root = $$('#c4-board'); if (!root) return;
    const previous = Array.isArray(root.dataset.board) ? root.dataset.board : (root.dataset.board || '').split(',');
    const just = [];
    board.forEach((value, idx) => { if (String(previous[idx] ?? '0') !== String(value) && String(value) !== '0') just.push(idx); });
    root.dataset.board = board.join(',');
    root.innerHTML = board.map((value, idx) => `
      <button type="button" class="c4-cell ${value === 1 ? 'red' : value === 2 ? 'blue' : ''} ${just.includes(idx) ? 'drop-in' : ''}"
        data-c4-col="${idx % 7}" aria-label="Columna ${idx % 7 + 1}" ${value ? 'disabled' : ''}>
        <span class="c4-slot"><i></i></span>
      </button>`).join('');
    lastBoardKey = key;
  }

  function renderToss() {
    const overlay = $$('#c4-toss-overlay');
    const coin = $$('#c4-toss-coin');
    const result = $$('#c4-toss-result');
    const action = $$('#c4-toss-action');
    if (!overlay || !coin || !result) return;
    const tossing = state?.status === 'tossing';
    overlay.classList.toggle('hidden', !tossing);
    if (!tossing) {
      tossStarted = false;
      return;
    }

    const target = state?.toss_color === 'red' ? 'ROJO' : 'AZUL';
    // La animación se dispara una sola vez por lanzamiento, aunque el polling
    // consulte el estado varias veces mientras la moneda está en el aire.
    if (!tossStarted && !tossTimer) {
      result.textContent = 'Lanzando la moneda…';
      result.className = 'c4-toss-result';
      coin.dataset.face = '';
      coin.classList.remove('flip');
      void coin.offsetWidth;
      coin.classList.add('flip');

      tossTimer = setTimeout(async () => {
        tossTimer = null;
        if (!state || state.status !== 'tossing') return;
        coin.dataset.face = state.toss_color || '';
        result.textContent = `HA SALIDO ${target}`;
        result.className = `c4-toss-result ${state.toss_color === 'red' ? 'red' : 'blue'}`;
        tossStarted = true;
        await beginToss();
      }, 1700);
    }
  }

  function renderResult() {
    const panel = $$('#c4-result');
    if (!panel) return;
    if (state?.status !== 'finished') { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const won = state.winner_id && state.winner_id === state.me?.id;
    const draw = !state.winner_id;
    panel.className = `c4-result ${won ? 'win' : draw ? 'draw' : 'lose'}`;
    $$('#c4-result-icon').textContent = won ? '✓' : draw ? '=' : '×';
    $$('#c4-result-title').textContent = won ? '¡VICTORIA!' : draw ? 'EMPATE' : 'DERROTA';
    $$('#c4-result-copy').textContent = won ? `Has ganado ${Number(state.pot || 0)} FP.` : draw ? 'La apuesta se ha devuelto a ambos jugadores.' : 'La partida ha terminado.';
  }

  function renderControls() {
    const live = state?.status === 'live';
    const mine = state?.turn_user_id === state?.me?.id;
    $$$('[data-c4-col]').forEach(button => {
      button.disabled = !(live && mine) || button.classList.contains('red') || button.classList.contains('blue');
    });
    const resign = $$('#c4-resign'); if (resign) resign.disabled = !live;
    const back = $$('#c4-back-lobby'); if (back) back.textContent = state?.status === 'finished' ? 'VOLVER A SALAS' : 'SALIR DE LA SALA';
    const foot = $$('.c4-board-foot span:first-child');
    if (foot) foot.textContent = state?.status === 'live' ? (mine ? 'Elige una columna para soltar tu ficha' : 'Espera el movimiento del rival') : state?.status === 'waiting' ? 'Esperando a que entre otro jugador…' : 'Preparando el siguiente turno…';
  }

  function renderState(force = false) {
    if (!state) return;
    renderMatchShell();
    const previousStatus = lastStatus;
    renderMeta(); renderPlayers(force); renderBoard(force);
    renderToss(); renderResult(); renderControls();
    lastStatus = state.status || previousStatus;
    if (force || previousStatus !== state.status) window.Casino?.dock?.();
  }

  async function fetchState() {
    if (!roomId || !logged()) return null;
    const { data, error } = await supabaseClient.rpc('connect4_get_state', { p_token: window.Casino.token, p_room_id: roomId });
    if (error) { console.error('Connect4 state', error); setMessage(error.message || 'No se ha podido actualizar la partida.', 'error'); return null; }
    state = data?.status === 'none' ? null : data;
    return state;
  }

  function scheduleMatchPoll() {
    clearTimeout(pollTimer);
    if (!roomId || !logged() || !isMultiplayerTab()) return;
    const delay = state?.status === 'tossing' ? 700 : state?.status === 'live' ? 900 : 2500;
    pollTimer = setTimeout(async () => { await fetchState(); if (state) renderState(); scheduleMatchPoll(); }, delay);
  }

  async function refreshLobby() {
    if (!logged() || !isMultiplayerTab() || roomId) return;
    const { data, error } = await supabaseClient.rpc('connect4_list_rooms', { p_token: window.Casino.token });
    if (error) { console.error('Connect4 lobby', error); setMessage(error.message || 'No se han podido cargar las salas.', 'error'); return; }
    renderLobby(Array.isArray(data) ? data : []);
  }

  function scheduleLobbyPoll() {
    clearTimeout(lobbyTimer);
    if (!logged() || !isMultiplayerTab() || roomId) return;
    lobbyTimer = setTimeout(async () => { await refreshLobby(); scheduleLobbyPoll(); }, 3000);
  }

  async function createRoom() {
    if (busy) return;
    const stake = Number(window.Casino?.stake || 0);
    if (!Number.isInteger(stake) || stake < 1) return setMessage('Selecciona una apuesta con las fichas de abajo antes de crear la sala.', 'warn');
    busy = true; setMessage('Creando sala…');
    const { data, error } = await supabaseClient.rpc('connect4_start_room', { p_token: window.Casino.token, p_stake: stake });
    busy = false;
    if (error) return setMessage(error.message || 'No se ha podido crear la sala.', 'error');
    window.Casino.clearStake?.();
    roomId = data.id; state = data;
    tossStarted = false; lastBoardKey = ''; lastPlayersKey = '';
    renderState(true); setMessage('Sala creada. Esperando a que entre otro jugador…', 'ok');
    scheduleMatchPoll();
    window.Casino.dock?.();
  }

  async function joinRoom(id) {
    if (busy) return;
    busy = true; setMessage('Entrando en la sala…');
    const { data, error } = await supabaseClient.rpc('connect4_join_room', { p_token: window.Casino.token, p_room_id: id });
    busy = false;
    if (error) return setMessage(error.message || 'No se ha podido entrar en la sala.', 'error');
    window.Casino.clearStake?.();
    roomId = id; state = data;
    tossStarted = false; lastBoardKey = ''; lastPlayersKey = '';
    renderState(true); setMessage('', '');
    scheduleMatchPoll();
    window.Casino.dock?.();
  }

  async function beginToss() {
    if (!roomId || !state || state.status !== 'tossing') return;
    const { data, error } = await supabaseClient.rpc('connect4_begin', { p_token: window.Casino.token, p_room_id: roomId });
    if (error) { console.error('Connect4 begin', error); return; }
    state = data; renderState(); scheduleMatchPoll();
  }

  async function move(col) {
    if (busy || !roomId || state?.status !== 'live' || state.turn_user_id !== state.me?.id) return;
    const board = Array.isArray(state.board) ? state.board : [];
    const c = Number(col);
    if (!Number.isInteger(c) || c < 0 || c > 6) return;
    // En Connect 4 una columna solo está llena si su casilla superior (fila 0)
    // está ocupada. Antes se comprobaban las 6 posiciones y eso bloqueaba toda
    // columna en cuanto caía la primera ficha.
    if (Number(board[c] || 0) !== 0) return;
    busy = true;
    setMessage('');
    const { data, error } = await supabaseClient.rpc('connect4_move', { p_token: window.Casino.token, p_room_id: roomId, p_column: c });
    busy = false;
    if (error) return setMessage(error.message || 'No se ha podido realizar el movimiento.', 'error');
    state = data;
    renderState();
    if (data?.status === 'finished' && typeof window.Casino.setBalance === 'function') window.Casino.setBalance(data.coins);
    scheduleMatchPoll();
  }

  async function resign() {
    if (busy || !roomId || state?.status !== 'live') return;
    if (!window.confirm('¿Seguro que quieres rendirte? La partida contará como derrota.')) return;
    busy = true;
    const { data, error } = await supabaseClient.rpc('connect4_resign', { p_token: window.Casino.token, p_room_id: roomId });
    busy = false;
    if (error) return setMessage(error.message || 'No se ha podido abandonar.', 'error');
    state = data; renderState(true);
    if (data?.status === 'finished' && typeof window.Casino.setBalance === 'function') window.Casino.setBalance(data.coins);
  }

  async function leaveRoom() {
    if (!roomId) return;
    if (state?.status === 'live' && state.me?.id === state.turn_user_id) {
      return resign();
    }
    if (state?.status === 'live') return resign();
    if (state?.status === 'finished') {
      roomId = null; state = null; tossStarted = false; stopTimers(); renderLobbyShell(); await refreshLobby(); scheduleLobbyPoll(); window.Casino.dock?.(); return;
    }
    const { error } = await supabaseClient.rpc('connect4_cancel_room', { p_token: window.Casino.token, p_room_id: roomId });
    if (error) console.error(error);
    roomId = null; state = null; tossStarted = false; stopTimers(); renderLobbyShell(); renderLobby([]); await refreshLobby(); scheduleLobbyPoll(); window.Casino.dock?.();
  }

  async function openLobby() {
    roomId = null; state = null; tossStarted = false; stopTimers(); renderLobbyShell();
    setMessage('');
    await refreshLobby(); scheduleLobbyPoll(); window.Casino.dock?.();
  }

  function bind() {
    if (bound) return;
    bound = true;
    $$('#c4-create')?.addEventListener('click', createRoom);
    $$('#c4-refresh')?.addEventListener('click', async () => { await refreshLobby(); });
    $$('#c4-rooms')?.addEventListener('click', event => {
      const join = event.target.closest('[data-room-id]');
      if (join) joinRoom(join.dataset.roomId);
    });
    $$('#c4-board')?.addEventListener('click', event => {
      const cell = event.target.closest('[data-c4-col]');
      if (cell) move(cell.dataset.c4Col);
    });
    $$('#c4-resign')?.addEventListener('click', resign);
    $$('#c4-back-lobby')?.addEventListener('click', leaveRoom);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTimers();
      else if (isMultiplayerTab()) { if (roomId) { fetchState().then(s => { if (s) renderState(); scheduleMatchPoll(); }); } else { refreshLobby(); scheduleLobbyPoll(); } }
    });
  }

  async function init() {
    bind();
    if (logged()) await refreshLobby();
  }

  function stop() {
    stopTimers();
    clearTimeout(tossTimer);
    roomId = null;
    state = null;
    tossStarted = false;
    lastStatus = '';
    lastBoardKey = '';
    lastPlayersKey = '';
  }

  window.initConnect4 = init;
  window.refreshConnect4 = async () => {
    if (roomId) { const s = await fetchState(); if (s) renderState(); scheduleMatchPoll(); }
    else { await refreshLobby(); scheduleLobbyPoll(); }
  };
  window.stopConnect4 = stop;
  window.connect4IsPlaying = isPlaying;
})();
