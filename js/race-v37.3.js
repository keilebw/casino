/* ============================================================
   CARRERAS — MULTIJUGADOR V37.3
   7 coches · apuestas individuales · carrera sincronizada por servidor · animación interpolada
   ============================================================ */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const CARS = [
    { id: 0, name: 'VORTEX', color: '#e34f5f', dark: '#7a1320', accent: '#ffd4d8', num: '01' },
    { id: 1, name: 'NITRO', color: '#4f8cff', dark: '#183e8f', accent: '#d8e5ff', num: '02' },
    { id: 2, name: 'BLAZE', color: '#f39a3d', dark: '#8b4311', accent: '#ffe5c7', num: '03' },
    { id: 3, name: 'PHANTOM', color: '#9e70e8', dark: '#4a207f', accent: '#eadbff', num: '04' },
    { id: 4, name: 'COMET', color: '#42bd8a', dark: '#14563e', accent: '#d5ffec', num: '05' },
    { id: 5, name: 'ROCKET', color: '#e1c84c', dark: '#75610c', accent: '#fff3ac', num: '06' },
    { id: 6, name: 'TURBO', color: '#ef6fc2', dark: '#76215c', accent: '#ffd8ef', num: '07' }
  ];

  let roomId = null;
  let state = null;
  let lobbyTimer = null;
  let matchTimer = null;
  let busy = false;
  let bound = false;
  let selectedCar = null;
  let lastStatus = '';
  let trackBuilt = false;
  let goUntil = 0;
  let trackAnimationFrame = 0;
  let visualPositions = Array(7).fill(0);
  let targetPositions = Array(7).fill(0);
  let visualStatus = '';
  let lastTrackFrame = 0;
  let lastServerStateAt = 0;
  let lastServerElapsedMs = 0;
  let targetVelocity = Array(7).fill(0);
  let arrivalRanks = new Map();


  function logged() { return Boolean(window.Casino?.token); }
  function selectedGame() { return window.multiplayerGame || 'connect4'; }
  function isRaceTab() {
    return document.querySelector('#nav button.on')?.dataset?.t === 'multiplayer' && selectedGame() === 'race';
  }
  function isPlaying() { return Boolean(roomId && state && ['countdown', 'racing'].includes(state.status)); }

  function stopTimers() {
    clearTimeout(lobbyTimer);
    clearTimeout(matchTimer);
    lobbyTimer = matchTimer = null;
  }

  function setMessage(text = '', type = '') {
    const el = $('#race-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = `race-feedback ${type}`.trim();
  }

  function carById(id) { return CARS.find(car => car.id === Number(id)) || CARS[0]; }

  function playerAvatar(player, size = 'multi-avatar-small') {
    if (!player) return '';
    const items = Array.isArray(player.shop_cosmetics) ? player.shop_cosmetics : [];
    if (window.shopAvatarLevelHtml) {
      return window.shopAvatarLevelHtml(player.id, player.avatar_id || 'avatar_01', player.level || 1, size, player.username || '', items);
    }
    if (window.avatarUrl) {
      return `<span class="race-avatar-fallback"><img class="${esc(size)}" src="${esc(window.avatarUrl(player.avatar_id || 'avatar_01'))}" alt="${esc(player.username || '')}"><b>${Math.max(1, Number(player.level || 1))}</b></span>`;
    }
    return '';
  }

  function playerName(player) {
    if (!player) return '';
    const colorClass = window.shopNameColorClass ? window.shopNameColorClass(player.id, player.shop_cosmetics || null) : '';
    return `<span class="race-player-name ${esc(colorClass)}">${esc(player.username || 'jugador')}</span>`;
  }

  function playerTitle(player) {
    if (!player || !window.shopTitleBadge) return '';
    return window.shopTitleBadge(player.id, Array.isArray(player.shop_cosmetics) ? player.shop_cosmetics : null);
  }

  function carSvg(car, scope = 'track') {
    const safeScope = String(scope).replace(/[^a-z0-9_-]/gi, '-');
    const gid = `race-grad-${safeScope}-${car.id}`;
    const glowId = `race-glow-${safeScope}-${car.id}`;
    return `
      <svg class="race-car-svg" viewBox="0 0 180 68" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${car.accent}" stop-opacity=".98"/>
            <stop offset=".22" stop-color="${car.color}"/>
            <stop offset="1" stop-color="${car.dark}"/>
          </linearGradient>
          <filter id="${glowId}"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g class="car-speed-lines" opacity=".48">
          <path d="M8 17H30" stroke="${car.accent}" stroke-width="3" stroke-linecap="round"/>
          <path d="M3 28H24" stroke="${car.accent}" stroke-width="2" stroke-linecap="round"/>
          <path d="M10 38H28" stroke="${car.accent}" stroke-width="2" stroke-linecap="round"/>
        </g>
        <path d="M30 44 L41 29 Q50 18 69 16 L101 16 Q118 17 130 29 L146 32 L165 36 L174 45 L168 52 L23 52 L18 47 L22 43 Z" fill="url(#${gid})" stroke="#090c0b" stroke-width="3" filter="url(#${glowId})"/>
        <path d="M67 18 L77 9 L101 9 L119 25 L69 25 Z" fill="#0f1814" stroke="#d9dfdc33" stroke-width="2"/>
        <path d="M80 11 L88 11 L92 23 L76 23 Z" fill="#b9e4ff88"/>
        <path d="M96 11 L101 11 L112 23 L94 23 Z" fill="#b9e4ff55"/>
        <path d="M21 44 L9 47 L11 52 L28 52" fill="#151918"/>
        <path d="M166 41 L176 43 L173 51 L161 51" fill="#151918"/>
        <circle class="car-wheel car-wheel-a" cx="52" cy="51" r="10" fill="#0a0d0c" stroke="#c2c7c4" stroke-width="3"/>
        <circle cx="52" cy="51" r="3.6" fill="#69716d"/>
        <circle class="car-wheel car-wheel-b" cx="135" cy="51" r="10" fill="#0a0d0c" stroke="#c2c7c4" stroke-width="3"/>
        <circle cx="135" cy="51" r="3.6" fill="#69716d"/>
        <path d="M141 35 L169 39" stroke="${car.accent}" stroke-width="3" stroke-linecap="round" opacity=".8"/>
        <circle cx="158" cy="36" r="2.8" fill="#fff8cd"/>
        <rect x="74" y="31" width="23" height="11" rx="4" fill="#080b0a88" stroke="#ffffff19"/>
        <text x="85.5" y="39.3" text-anchor="middle" fill="#fff5d6" font-size="8" font-weight="900" font-family="Arial, sans-serif">${car.num}</text>
      </svg>`;
  }

  function renderLobbyShell() {
    $('#race-lobby-view')?.classList.remove('hidden');
    $('#race-match-view')?.classList.add('hidden');
  }

  function renderMatchShell() {
    $('#race-lobby-view')?.classList.add('hidden');
    $('#race-match-view')?.classList.remove('hidden');
  }

  function renderLobby(rooms = []) {
    const list = $('#race-rooms');
    if (!list) return;
    list.innerHTML = rooms.length
      ? rooms.map(room => {
          const host = room.host || {};
          const players = Number(room.player_count || 1);
          return `
            <article class="race-room-card">
              <div class="race-room-player">
                ${playerAvatar(host, 'multi-avatar-small')}
                <div>
                  <strong>${playerName(host)}</strong>
                  ${playerTitle(host)}
                  <small>Sala abierta · <b>${players} jugador${players === 1 ? '' : 'es'}</b></small>
                </div>
              </div>
              <button class="main race-join" data-room-id="${esc(room.id)}">UNIRME <span>→</span></button>
            </article>`;
        }).join('')
      : `<div class="race-lobby-empty"><div class="race-empty-icon">🏁</div><h3>No hay salas abiertas</h3><p>Crea una sala y espera a tus rivales.</p></div>`;
  }

  function renderWaiting() {
    const box = $('#race-waiting-panel');
    if (!box) return;
    const waiting = state?.status === 'waiting';
    box.classList.toggle('hidden', !waiting);
    if (!waiting) return;

    const host = state?.host_id === state?.me?.id;
    $('#race-waiting-count').textContent = `${Number(state?.player_count || 1)} jugador${Number(state?.player_count || 1) === 1 ? '' : 'es'} dentro`;
    const players = $('#race-waiting-players');
    if (players) {
      players.innerHTML = (Array.isArray(state?.players) ? state.players : []).map(player => `
        <div class="race-waiting-player">
          ${playerAvatar(player)}
          <div><strong>${playerName(player)}</strong>${playerTitle(player)}<small>${player.id === state?.host_id ? 'CREADOR' : 'RIVAL'}</small></div>
          ${player.id === state?.host_id ? '<span class="race-host-badge">HOST</span>' : ''}
        </div>`).join('');
    }

    const start = $('#race-start-betting');
    if (start) {
      start.classList.toggle('hidden', !host);
      start.disabled = Number(state?.player_count || 0) < 2 || busy;
    }
    const hint = $('#race-waiting-hint');
    if (hint) {
      hint.textContent = Number(state?.player_count || 0) < 2
        ? 'Comparte la sala y espera a que entre al menos otro jugador.'
        : host
          ? 'Cuando todos estén dentro, abre la fase de apuestas.'
          : 'El creador abrirá las apuestas cuando la sala esté lista.';
    }
  }

  function renderParticipants() {
    const list = $('#race-participants');
    if (!list) return;
    const players = Array.isArray(state?.players) ? state.players : [];
    list.innerHTML = players.map(player => {
      const ready = player.has_bet;
      return `
        <div class="race-participant ${ready ? 'ready' : ''}">
          <div class="race-participant-avatar">${playerAvatar(player)}</div>
          <div class="race-participant-copy">
            <strong>${playerName(player)}</strong>
            ${playerTitle(player)}
            <span>${ready ? 'APUESTA LISTA' : 'ELIGIENDO APUESTA'}</span>
          </div>
          <b class="race-ready-mark">${ready ? '✓' : '…'}</b>
        </div>`;
    }).join('');
  }

  function renderBetting() {
    const panel = $('#race-betting-panel');
    if (!panel) return;
    const active = state?.status === 'betting';
    panel.classList.toggle('hidden', !active);
    if (!active) return;

    if (state?.me?.bet_car != null) selectedCar = Number(state.me.bet_car);
    $('#race-bet-count').textContent = `${Number(state?.ready_count || 0)} / ${Number(state?.player_count || 0)} APUESTAS LISTAS`;
    $('#race-selected-car').textContent = selectedCar == null ? 'ELIGE UN COCHE' : carById(selectedCar).name;
    $('#race-bet-amount').textContent = `${Number(window.Casino?.stake || 0)} FP`;
    $$('.race-car-card').forEach(card => {
      const car = carById(card.dataset.car);
      const selected = car.id === selectedCar;
      card.classList.toggle('selected', selected);
      card.classList.toggle('bet-locked', Boolean(state?.me?.has_bet));
      const visual = $('.race-card-visual', card);
      if (visual) visual.innerHTML = carSvg(car, 'card');
      const label = $('.race-card-select', card);
      if (label) label.textContent = selected ? 'SELECCIONADO' : 'APOSTAR AQUÍ';
    });

    const confirm = $('#race-place-bet');
    if (confirm) {
      confirm.disabled = selectedCar == null || busy;
      confirm.textContent = state?.me?.has_bet ? 'CAMBIAR APUESTA' : 'CONFIRMAR APUESTA';
    }
  }

  function buildTrack() {
    const root = $('#race-track');
    if (!root || trackBuilt) return;
    trackBuilt = true;
    root.innerHTML = CARS.map(car => `
      <div class="race-lane" data-car-lane="${car.id}">
        <div class="race-lane-name"><span>#${car.id + 1}</span><b>${car.name}</b></div>
        <div class="race-lane-road">
          <span class="race-speed-trail"></span>
          <span class="race-lane-grid"></span>
          <div class="race-car" data-race-car="${car.id}">
            <div class="race-car-inner">${carSvg(car, 'track')}<span class="race-dust dust-a"></span><span class="race-dust dust-b"></span><span class="race-finish-badge" data-finish-badge="${car.id}"></span></div>
          </div>
        </div>
      </div>`).join('');
  }

  function positionCarsFrame() {
    const root = $('#race-track');
    if (!root) return;
    CARS.forEach(car => {
      const el = $(`[data-race-car="${car.id}"]`, root);
      if (!el) return;
      const road = el.parentElement;
      const maxX = Math.max(0, road.clientWidth - el.offsetWidth - 8);
      const p = Math.max(0, Math.min(0.935, Number(visualPositions[car.id] || 0)));
      el.style.setProperty('--race-x', `${(p * maxX).toFixed(2)}px`);
    });
  }

  function stopTrackAnimation() {
    if (trackAnimationFrame) cancelAnimationFrame(trackAnimationFrame);
    trackAnimationFrame = 0;
    lastTrackFrame = 0;
  }

  function trackAnimationLoop(timestamp = performance.now()) {
    trackAnimationFrame = requestAnimationFrame(trackAnimationLoop);
    const dt = lastTrackFrame ? Math.min(0.05, Math.max(0.001, (timestamp - lastTrackFrame) / 1000)) : 0.016;
    lastTrackFrame = timestamp;
    const active = ['countdown','racing','finished'].includes(state?.status);
    if (!active) {
      stopTrackAnimation();
      return;
    }

    const sinceState = state?.status === 'racing' && lastServerStateAt
      ? Math.min(0.45, Math.max(0, (timestamp - lastServerStateAt) / 1000))
      : 0;

    for (let i = 0; i < 7; i += 1) {
      let predicted = targetPositions[i];
      if (state?.status === 'racing' && sinceState > 0) {
        predicted += targetVelocity[i] * sinceState;
      }
      predicted = Math.max(0, Math.min(0.94, predicted));
      const speed = visualPositions[i] > predicted ? 16 : 22;
      const alpha = 1 - Math.exp(-speed * dt);
      visualPositions[i] += (predicted - visualPositions[i]) * alpha;
      if (Math.abs(predicted - visualPositions[i]) < 0.00015) visualPositions[i] = predicted;
    }
    positionCarsFrame();
  }

  function ensureTrackAnimation() {
    if (trackAnimationFrame) return;
    trackAnimationFrame = requestAnimationFrame(trackAnimationLoop);
  }

  function renderRaceTrack() {
    const wrap = $('#race-track-panel');
    if (!wrap) return;
    const active = ['countdown','racing','finished'].includes(state?.status);
    wrap.classList.toggle('hidden', !active);
    if (!active) {
      stopTrackAnimation();
      return;
    }
    buildTrack();

    const positions = Array.isArray(state?.positions) ? state.positions : [];
    const nextTargets = CARS.map(car => {
      const p = Math.max(0, Math.min(0.94, Number(positions[car.id] || 0)));
      return p;
    });
    const receivedAt = performance.now();
    const nextElapsed = Number(state?.elapsed_ms || 0);
    if (state?.status === 'racing' && lastServerStateAt && nextElapsed > lastServerElapsedMs) {
      const sampleDt = Math.max(0.08, (nextElapsed - lastServerElapsedMs) / 1000);
      for (let i = 0; i < 7; i += 1) {
        const raw = (nextTargets[i] - targetPositions[i]) / sampleDt;
        targetVelocity[i] = Math.max(-0.12, Math.min(0.12, raw));
      }
    } else if (state?.status !== 'racing') {
      targetVelocity = Array(7).fill(0);
    }
    lastServerStateAt = receivedAt;
    lastServerElapsedMs = nextElapsed;
    if (visualStatus !== state?.status) {
      visualStatus = state?.status || '';
      if (visualStatus === 'countdown') arrivalRanks = new Map();
      if (visualStatus === 'countdown') {
        visualPositions = Array(7).fill(0);
        targetPositions = Array(7).fill(0);
        targetVelocity = Array(7).fill(0);
        lastServerStateAt = 0;
        lastServerElapsedMs = 0;
      } else if (visualStatus === 'racing' && previousFramePositionsEmpty()) {
        visualPositions = [...nextTargets];
      }
    }
    targetPositions = nextTargets;
    if (state?.status === 'finished') {
      CARS.forEach(car => {
        if (Number(nextTargets[car.id] || 0) >= 0.999) visualPositions[car.id] = Math.max(visualPositions[car.id], nextTargets[car.id]);
      });
    }

    const leaderCar = leadingCar();
    CARS.forEach(car => {
      const el = $(`[data-race-car="${car.id}"]`);
      if (!el) return;
      const leader = state?.status === 'racing' && car.id === leaderCar;
      el.classList.toggle('leader', Boolean(leader));
      el.classList.toggle('finished-car', state?.status === 'finished' && car.id === state?.winner_car);
    });
    ensureTrackAnimation();
    positionCarsFrame();

    const now = Date.now();
    const overlay = $('#race-countdown');
    if (overlay) {
      if (state?.status === 'countdown') {
        overlay.classList.remove('hidden');
        const left = Number(state?.countdown_ms || 0);
        const value = left > 2000 ? '3' : left > 1000 ? '2' : left > 0 ? '1' : 'GO!';
        overlay.querySelector('strong').textContent = value;
      } else if (now < goUntil) {
        overlay.classList.remove('hidden');
        overlay.querySelector('strong').textContent = 'GO!';
      } else {
        overlay.classList.add('hidden');
      }
    }

    const arrivals = Array.isArray(state?.arrivals) ? state.arrivals.map(Number) : [];
    arrivals.slice(0, 3).forEach((carId, index) => arrivalRanks.set(carId, index + 1));
    if (state?.status === 'finished') {
      const finishedOrder = Array.isArray(state?.finish_order) ? state.finish_order.map(Number) : [];
      finishedOrder.slice(0, 3).forEach((carId, index) => arrivalRanks.set(carId, index + 1));
    }
    CARS.forEach(car => {
      const badge = $(`[data-finish-badge=\"${car.id}\"]`);
      if (!badge) return;
      const rank = arrivalRanks.get(car.id);
      badge.textContent = rank ? `${rank}º` : '';
      badge.classList.toggle('show', Boolean(rank));
      badge.classList.toggle('first', rank === 1);
      badge.classList.toggle('second', rank === 2);
      badge.classList.toggle('third', rank === 3);
    });

    const leader = $('#race-leader');
    if (leader) {
      leader.textContent = state?.status === 'finished'
        ? 'META CRUZADA'
        : `LÍDER: ${carById(leadingCar()).name}`;
    }
  }

  function previousFramePositionsEmpty() {
    return visualPositions.every(value => Math.abs(Number(value || 0)) < 0.0005);
  }

  function leadingCar() {
    const positions = Array.isArray(state?.positions) ? state.positions : [];
    let best = 0;
    for (let i = 1; i < 7; i += 1) {
      if (Number(positions[i] || 0) > Number(positions[best] || 0) + 0.0002) best = i;
    }
    return best;
  }

  function renderHeader() {
    const status = $('#race-status-label');
    if (!status) return;
    const labels = {
      waiting: 'ESPERANDO JUGADORES',
      betting: 'APUESTAS ABIERTAS',
      countdown: '¡PREPARADOS!',
      racing: 'CARRERA EN CURSO',
      finished: 'CARRERA TERMINADA'
    };
    status.textContent = labels[state?.status] || 'CARRERAS';
    $('#race-player-count').textContent = `${Number(state?.player_count || 0)} JUGADORES`;
    $('#race-ready-count').textContent = `${Number(state?.ready_count || 0)} LISTOS`;
  }

  function renderResult() {
    const panel = $('#race-result');
    if (!panel) return;
    const finished = state?.status === 'finished';
    panel.classList.toggle('hidden', !finished);
    if (!finished) return;

    const order = Array.isArray(state?.finish_order) ? state.finish_order.map(Number) : [];
    const places = [1,2,3].map((rank, index) => ({
      rank,
      car: carById(order[index]),
      multiplier: [5,3,1][index]
    }));

    $('#race-podium').innerHTML = places.map(place => `
      <div class="race-podium-place place-${place.rank}">
        <div class="race-podium-rank">${place.rank}º</div>
        <div class="race-podium-car" style="--race-car-color:${place.car.color};--race-car-dark:${place.car.dark}">${carSvg(place.car, 'podium')}</div>
        <strong>${place.car.name}</strong>
        <span>x${place.multiplier}</span>
      </div>`).join('');

    const myCar = state?.me?.bet_car == null ? null : Number(state.me.bet_car);
    let myRank = 0;
    if (myCar != null) {
      const idx = order.indexOf(myCar);
      if (idx >= 0) myRank = idx + 1;
    }
    const myMultiplier = myRank === 1 ? 5 : myRank === 2 ? 3 : myRank === 3 ? 1 : 0;
    const payout = Number(state?.me?.payout || 0);
    const copy = $('#race-result-copy');
    if (copy) {
      copy.textContent = myRank === 1
        ? `Tu coche ganó la carrera. Has cobrado ${payout} FP (x5).`
        : myRank === 2
          ? `Tu coche terminó segundo. Has cobrado ${payout} FP (x3).`
          : myRank === 3
            ? `Tu coche terminó tercero. Se te devuelven ${payout} FP (x1).`
            : myCar == null
              ? 'La carrera ha terminado.'
              : `Tu coche quedó fuera del podio. La apuesta se ha perdido.`;
    }
    $('#race-result-title').textContent = myRank === 1 ? '¡APUESTA GANADORA!' : myRank === 2 ? '¡SEGUNDO PUESTO!' : myRank === 3 ? 'APUESTA DEVUELTA' : 'CARRERA TERMINADA';
  }

  function renderControls() {
    const leave = $('#race-back-lobby');
    if (!leave) return;
    if (state?.status === 'finished') {
      leave.disabled = false;
      leave.textContent = 'VOLVER A SALAS';
    } else {
      leave.disabled = ['countdown','racing'].includes(state?.status);
      leave.textContent = 'SALIR DE LA SALA';
    }
  }

  function renderState(force = false) {
    if (!state) return;
    renderMatchShell();
    const previous = lastStatus;
    renderHeader();
    renderWaiting();
    renderParticipants();
    renderBetting();
    renderRaceTrack();
    renderResult();
    renderControls();
    lastStatus = state.status || previous;
    if (state.status === 'racing' && previous === 'countdown') goUntil = Date.now() + 850;
    if (force || previous !== state.status) window.Casino?.dock?.();
  }

  async function refreshState() {
    if (!roomId || !logged()) return null;
    try {
      const previousStatus = state?.status || '';
      const { data, error } = await supabaseClient.rpc('race_get_state', {
        p_token: window.Casino.token,
        p_room_id: roomId
      });
      if (error) {
        console.error('Race state', error);
        setMessage(error.message || 'No se ha podido actualizar la carrera.', 'error');
        return state;
      }
      if (!data || data.status === 'none') {
        roomId = null;
        state = null;
        stopTimers();
        renderLobbyShell();
        return null;
      }
      state = data;
      if (state.status === 'finished' && previousStatus !== 'finished') {
        await window.Casino?.loadProfile?.();
        window.Casino?.renderHistory?.();
      }
      renderState();
      return state;
    } catch (error) {
      console.error('Race state exception', error);
      setMessage(error?.message || 'No se ha podido actualizar la carrera.', 'error');
      return state;
    }
  }

  function scheduleMatch() {
    clearTimeout(matchTimer);
    if (!roomId || !logged()) return;
    const status = state?.status;
    const delay = !isRaceTab() ? 2600 : status === 'countdown' ? 150 : status === 'racing' ? 140 : 900;
    matchTimer = setTimeout(async () => {
      await refreshState();
      if (roomId) scheduleMatch();
    }, delay);
  }

  async function refreshLobby() {
    if (!logged() || !isRaceTab() || roomId) return;
    try {
      const { data, error } = await supabaseClient.rpc('race_list_rooms', { p_token: window.Casino.token });
      if (error) {
        console.error('Race lobby', error);
        setMessage(error.message || 'No se han podido cargar las salas.', 'error');
        return;
      }
      renderLobby(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Race lobby exception', error);
      setMessage(error?.message || 'No se han podido cargar las salas.', 'error');
    }
  }

  function scheduleLobby() {
    clearTimeout(lobbyTimer);
    if (!logged() || !isRaceTab() || roomId) return;
    lobbyTimer = setTimeout(async () => {
      await refreshLobby();
      scheduleLobby();
    }, 3000);
  }

  async function createRoom() {
    if (busy) return;
    busy = true;
    setMessage('Creando sala…');
    try {
      const { data, error } = await supabaseClient.rpc('race_start_room', { p_token: window.Casino.token });
      if (error) return setMessage(error.message || 'No se ha podido crear la sala.', 'error');
      roomId = data.id;
      state = data;
      selectedCar = null;
      renderState(true);
      setMessage('Sala creada. Espera a tus rivales…', 'ok');
      scheduleMatch();
    } finally {
      busy = false;
    }
  }

  async function joinRoom(id) {
    if (busy) return;
    busy = true;
    setMessage('Entrando en la sala…');
    try {
      const { data, error } = await supabaseClient.rpc('race_join_room', {
        p_token: window.Casino.token,
        p_room_id: id
      });
      if (error) return setMessage(error.message || 'No se ha podido entrar en la sala.', 'error');
      roomId = id;
      state = data;
      selectedCar = null;
      renderState(true);
      setMessage('', '');
      scheduleMatch();
    } finally {
      busy = false;
    }
  }

  async function startBetting() {
    if (busy || !roomId || state?.status !== 'waiting') return;
    busy = true;
    setMessage('Abriendo las apuestas…');
    try {
      const { data, error } = await supabaseClient.rpc('race_start_betting', {
        p_token: window.Casino.token,
        p_room_id: roomId
      });
      if (error) return setMessage(error.message || 'No se han podido abrir las apuestas.', 'error');
      state = data;
      renderState(true);
      setMessage('Apuestas abiertas. Todos deben elegir un coche y una cantidad.', 'ok');
      scheduleMatch();
    } finally {
      busy = false;
    }
  }

  function selectCar(car) {
    if (state?.status !== 'betting' || busy) return;
    selectedCar = Number(car);
    renderBetting();
  }

  async function placeBet() {
    if (busy || !roomId || state?.status !== 'betting' || selectedCar == null) return;
    const amount = window.Casino?.bet?.() || 0;
    if (!amount) return;
    busy = true;
    setMessage('Guardando tu apuesta…');
    try {
      const { data, error } = await supabaseClient.rpc('race_place_bet', {
        p_token: window.Casino.token,
        p_room_id: roomId,
        p_car: selectedCar,
        p_amount: amount
      });
      if (error) return setMessage(error.message || 'No se ha podido guardar la apuesta.', 'error');
      window.Casino.clearStake?.();
      state = data;
      renderState(true);
      setMessage(state.status === 'countdown' ? '¡Todos han apostado! ¡Que empiece la carrera!' : 'Apuesta confirmada. Esperando al resto…', state.status === 'countdown' ? 'ok' : '');
      scheduleMatch();
    } finally {
      busy = false;
    }
  }

  async function leaveRoom() {
    if (!roomId || busy) return;
    if (['countdown','racing'].includes(state?.status)) return;

    busy = true;
    try {
      if (state?.status === 'finished') {
        roomId = null;
        state = null;
        selectedCar = null;
        stopTimers();
        renderLobbyShell();
        setMessage('');
        await refreshLobby();
        scheduleLobby();
        window.Casino?.loadProfile?.();
        window.Casino?.dock?.();
        return;
      }
      const { data, error } = await supabaseClient.rpc('race_leave_room', {
        p_token: window.Casino.token,
        p_room_id: roomId
      });
      if (error) {
        return setMessage(error.message || 'No se ha podido salir de la sala.', 'error');
      }
      if (data?.status === 'left' || data?.status === 'none') {
        roomId = null;
        state = null;
        selectedCar = null;
        stopTimers();
        renderLobbyShell();
        setMessage('');
        await refreshLobby();
        scheduleLobby();
        window.Casino?.loadProfile?.();
        window.Casino?.dock?.();
      } else {
        state = data;
        renderState(true);
      }
    } finally {
      busy = false;
    }
  }

  function selectRaceGame() {
    window.multiplayerGame = 'race';
    $$('.mp-game-tab').forEach(button => {
      const on = button.dataset.mpGame === 'race';
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    });
    $('#c4-lobby-view')?.classList.add('hidden');
    $('#c4-match-view')?.classList.add('hidden');
    $('#chess-lobby-view')?.classList.add('hidden');
    $('#chess-match-view')?.classList.add('hidden');
    if (roomId && state) {
      renderState(true);
      scheduleMatch();
    } else {
      renderLobbyShell();
      refreshLobby();
      scheduleLobby();
    }
    window.Casino?.dock?.();
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('#race-create')?.addEventListener('click', createRoom);
    $('#race-refresh')?.addEventListener('click', async () => { await refreshLobby(); scheduleLobby(); });
    $('#race-rooms')?.addEventListener('click', event => {
      const button = event.target.closest('[data-room-id]');
      if (button) joinRoom(button.dataset.roomId);
    });
    $('#race-start-betting')?.addEventListener('click', startBetting);
    $('#race-cars')?.addEventListener('click', event => {
      const card = event.target.closest('[data-car]');
      if (card) selectCar(card.dataset.car);
    });
    $('#race-place-bet')?.addEventListener('click', placeBet);
    $('#race-back-lobby')?.addEventListener('click', leaveRoom);

    $$('.mp-game-tab').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.mpGame === 'race') selectRaceGame();
    }));

    window.addEventListener('casino:cosmetics-updated', () => {
      if (isRaceTab() && state) renderParticipants();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && roomId) {
        refreshState().finally(() => scheduleMatch());
      }
      if (!document.hidden && !roomId && isRaceTab()) {
        refreshLobby();
        scheduleLobby();
      }
    });
  }

  window.refreshRace = async () => {
    bind();
    if (roomId) {
      await refreshState();
      scheduleMatch();
    } else if (isRaceTab()) {
      await refreshLobby();
      scheduleLobby();
    }
  };
  window.raceIsPlaying = () => isPlaying() && selectedGame() === 'race';
  window.initRace = bind;
  window.stopRace = stopTimers;

  bind();
})();
