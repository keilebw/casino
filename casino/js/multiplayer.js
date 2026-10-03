// ============================================================
// MULTIJUGADOR - TRES EN RAYA 1 VS 1
// Ahora admite apuestas en créditos virtuales (FP).
// ============================================================

const ttt = {
  match: null,
  channel: null,
  ready: false
};

function tttMoney(value) {
  return `${Number(value) || 0} FP`;
}

function tttPlayerChip(userId, username, mine, mark = '') {
  const avatarId = window.getAvatarForUser?.(userId) || 'avatar_01';
  const level = window.getLevelForUser?.(userId) || 1;
  const avatar = window.avatarLevelHtml
    ? window.avatarLevelHtml(avatarId, level, 'ttt-player-avatar', 'avatar-level-wrap ttt-avatar-wrap', username || 'Jugador')
    : `<img src="${escapeHtml(window.avatarUrl?.(avatarId) || 'assets/avatars/avatar_01.svg')}" alt="" class="ttt-player-avatar" draggable="false">`;
  return `<span class="ttt-player-chip ${mine ? 'mine' : ''}">${avatar}<button type="button" class="profile-link" data-profile-username="${escapeHtml(username || 'Jugador')}">${escapeHtml(username || 'Jugador')}</button>${mark ? `<em>${mark}</em>` : ''}</span>`;
}

function tttCurrentUserMark() {
  if (!ttt.match || !Casino.user) return null;
  if (ttt.match.player1_id === Casino.user.id) return 'X';
  if (ttt.match.player2_id === Casino.user.id) return 'O';
  return null;
}

function updateTttStakeInfo() {
  const box = $('#ttt-stake-info');
  if (!box) return;

  if (ttt.match?.status === 'waiting') {
    const stake = Number(ttt.match.stake || 0);
    box.innerHTML = `Apuesta de la partida: <b>${tttMoney(stake)}</b>. Tu apuesta ya está reservada.`;
    return;
  }

  if (ttt.match?.status === 'running') {
    const stake = Number(ttt.match.stake || 0);
    box.innerHTML = `Apuesta: <b>${tttMoney(stake)}</b> por jugador · Bote: <b>${tttMoney(stake * 2)}</b>`;
    return;
  }

  const stake = Number(Casino.stake || 0);
  box.innerHTML = stake > 0
    ? `Apuesta de la partida: <b>${tttMoney(stake)}</b>`
    : 'Apuesta de la partida: <b>0 FP</b>. Usa las fichas de abajo antes de crearla.';
}

function renderTttStatus() {
  const status = $('#ttt-status');

  if (!ttt.match) {
    status.textContent = 'No estás en una partida.';
    updateTttStakeInfo();
    return;
  }

  const m = ttt.match;
  const board = m.state?.board || Array(9).fill(null);
  const myMark = tttCurrentUserMark();
  const stake = Number(m.stake || 0);

  if (m.status === 'waiting') {
    status.textContent = `Partida de ${m.player1_name} · Apuesta: ${tttMoney(stake)} · Esperando rival...`;
  } else if (m.status === 'running') {
    status.innerHTML = `<div class="ttt-status-players">${tttPlayerChip(m.player1_id, m.player1_name, m.player1_id === Casino.user?.id, 'X')}${tttPlayerChip(m.player2_id, m.player2_name, m.player2_id === Casino.user?.id, 'O')}</div><div>Partida en curso · Bote: <b>${tttMoney(stake * 2)}</b></div>`;
  } else if (m.status === 'finished') {
    if (m.winner_id) {
      const winner = m.winner_id === m.player1_id ? m.player1_name : m.player2_name;
      status.innerHTML = `<div class="ttt-status-players">${tttPlayerChip(m.player1_id, m.player1_name, m.player1_id === Casino.user?.id, 'X')}${tttPlayerChip(m.player2_id, m.player2_name, m.player2_id === Casino.user?.id, 'O')}</div><div>Partida terminada · Ganador: <button type="button" class="profile-link inline-profile" data-profile-username="${escapeHtml(winner)}">${escapeHtml(winner)}</button> · Bote: <b>${tttMoney(stake * 2)}</b></div>`;
    } else {
      status.innerHTML = `<div class="ttt-status-players">${tttPlayerChip(m.player1_id, m.player1_name, m.player1_id === Casino.user?.id, 'X')}${tttPlayerChip(m.player2_id, m.player2_name, m.player2_id === Casino.user?.id, 'O')}</div><div>Partida terminada en empate. Se devuelve <b>${tttMoney(stake)}</b> a cada jugador.</div>`;
    }
  }

  const turn = $('#ttt-turn');

  if (m.status !== 'running') {
    if (m.status === 'waiting') {
      turn.textContent = 'Esperando a que entre otro jugador...';
    } else if (m.winner_id && m.winner_id === Casino.user?.id) {
      turn.textContent = `¡Has ganado ${tttMoney(stake * 2)}!`;
    } else if (m.winner_id) {
      turn.textContent = 'Has perdido la partida.';
    } else {
      turn.textContent = `Empate. Recuperas tu apuesta de ${tttMoney(stake)}.`;
    }
  } else if (m.current_turn === Casino.user.id) {
    turn.textContent = `Es tu turno (${myMark}).`;
  } else {
    turn.textContent = 'Turno del rival...';
  }

  const boardElement = $('#ttt-board');
  boardElement.innerHTML = '';

  board.forEach((cell, index) => {
    const button = document.createElement('button');
    button.className = 'ttt-cell';
    button.textContent = cell || '';
    button.disabled = Boolean(cell) || m.status !== 'running' || m.current_turn !== Casino.user.id;
    button.onclick = () => tttMove(index);
    boardElement.append(button);
  });

  updateTttStakeInfo();
}

async function loadMatches() {
  if (!Casino.user) return;

  const { data, error } = await supabaseClient
    .from('matches')
    .select('*')
    .eq('game', 'Tres en raya')
    .in('status', ['waiting', 'running'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    Casino.toast('No se han podido cargar las partidas.');
    return;
  }

  const container = $('#ttt-lobby');
  container.innerHTML = '';

  if (!data.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No hay partidas abiertas ahora mismo.';
    container.append(empty);
  } else {
    data.forEach(match => {
      const card = document.createElement('div');
      card.className = 'lobby-item';

      const info = document.createElement('div');
      const title = document.createElement('b');
      const stake = Number(match.stake || 0);

      title.innerHTML = match.status === 'waiting'
        ? `${tttPlayerChip(match.player1_id, match.player1_name, match.player1_id === Casino.user.id)} · ${tttMoney(stake)}`
        : `${tttPlayerChip(match.player1_id, match.player1_name, match.player1_id === Casino.user.id, 'X')}${tttPlayerChip(match.player2_id, match.player2_name, match.player2_id === Casino.user.id, 'O')} · ${tttMoney(stake)} cada uno`;

      const meta = document.createElement('small');
      meta.textContent = match.status === 'waiting'
        ? `Apuesta: ${tttMoney(stake)} · Se requieren ${tttMoney(stake)} para unirse`
        : `Bote: ${tttMoney(stake * 2)} · En curso`;

      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'row lobby-actions';

      const isPlayer1 = match.player1_id === Casino.user.id;
      const isPlayer2 = match.player2_id === Casino.user.id;

      if (match.status === 'waiting' && isPlayer1) {
        const openButton = document.createElement('button');
        openButton.textContent = 'Abrir';
        openButton.onclick = () => {
          ttt.match = match;
          renderTttStatus();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar y recuperar';
        cancelButton.onclick = () => cancelMatch(match.id);

        actions.append(openButton, cancelButton);
      } else if (match.status === 'waiting') {
        const button = document.createElement('button');
        button.textContent = `Unirse · ${tttMoney(stake)}`;
        button.className = 'main';
        button.onclick = () => joinMatch(match.id);
        actions.append(button);
      } else if (isPlayer1 || isPlayer2) {
        const button = document.createElement('button');
        button.textContent = 'Abrir';
        button.onclick = () => {
          ttt.match = match;
          renderTttStatus();
        };
        actions.append(button);
      } else {
        const button = document.createElement('button');
        button.textContent = 'En curso';
        button.disabled = true;
        actions.append(button);
      }

      card.append(info, actions);
      container.append(card);
    });
  }

  if (ttt.match) {
    const updated = data.find(match => match.id === ttt.match.id);
    if (updated) {
      ttt.match = updated;
      renderTttStatus();
    }
  }

  updateTttStakeInfo();
}

async function createMatch() {
  const stake = Casino.bet();
  if (!stake) return;

  const { data, error } = await supabaseClient.rpc('ttt_create_match', {
    p_token: Casino.token,
    p_stake: stake
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    return;
  }

  ttt.match = data;
  Casino.clearStake();
  if (typeof Casino.loadProfile === 'function') await Casino.loadProfile();
  renderTttStatus();
  await loadMatches();
  if (window.refreshSidebar) await window.refreshSidebar();
  Casino.toast(`Partida creada con una apuesta de ${tttMoney(stake)}. Esperando rival...`);
}

async function joinMatch(matchId) {
  const { data: preview, error: previewError } = await supabaseClient
    .from('matches')
    .select('stake, player1_name')
    .eq('id', matchId)
    .maybeSingle();

  if (previewError) {
    console.error(previewError);
    Casino.toast('No se ha podido comprobar la apuesta de la partida.');
    return;
  }

  const stake = Number(preview?.stake || 0);
  if (stake > Casino.coins()) {
    Casino.toast(`No tienes suficientes FP. Necesitas ${tttMoney(stake)}.`);
    return;
  }

  const { data, error } = await supabaseClient.rpc('ttt_join_match', {
    p_token: Casino.token,
    p_match_id: matchId
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    return;
  }

  ttt.match = data;
  Casino.clearStake();
  if (typeof Casino.loadProfile === 'function') await Casino.loadProfile();
  renderTttStatus();
  await loadMatches();
  if (window.refreshSidebar) await window.refreshSidebar();
  Casino.toast(`Te has unido. Apuesta: ${tttMoney(stake)}.`);
}

async function cancelMatch(matchId) {
  const { data, error } = await supabaseClient.rpc('ttt_cancel_match', {
    p_token: Casino.token,
    p_match_id: matchId
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    return;
  }

  if (ttt.match?.id === matchId) {
    ttt.match = null;
  }

  await Casino.loadProfile();
  renderTttStatus();
  await loadMatches();
  if (window.refreshSidebar) await window.refreshSidebar();
  Casino.toast(`Partida cancelada. Recuperas ${tttMoney(Number(data.stake || 0))}.`);
}

async function tttMove(cell) {
  if (!ttt.match || !Casino.user) return;

  const { data, error } = await supabaseClient.rpc('ttt_move', {
    p_token: Casino.token,
    p_match_id: ttt.match.id,
    p_cell: cell
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    return;
  }

  ttt.match = data;
  await Casino.loadProfile();
  renderTttStatus();

  if (data.status === 'finished') {
    await Casino.renderHistory();
    if (window.refreshSidebar) await window.refreshSidebar();
  }
}

async function initMultiplayer() {
  if (!Casino.user) return;

  if (!ttt.ready) {
    await loadMatches();

    ttt.channel = supabaseClient
      .channel('casino-ttt-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches'
        },
        async payload => {
          if (ttt.match?.id === payload.new?.id) {
            ttt.match = payload.new;
            await Casino.loadProfile();
            renderTttStatus();
          }
          await loadMatches();
          if (window.refreshSidebar) await window.refreshSidebar();
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.error('No se pudo conectar al canal de tres en raya.');
        }
      });

    ttt.ready = true;
  }

  updateTttStakeInfo();
  if (window.initPoker) window.initPoker();
}

$('#ttt-create').onclick = createMatch;
$('#ttt-refresh').onclick = loadMatches;

window.initMultiplayer = initMultiplayer;
window.loadMatches = loadMatches;


// ------------------------------------------------------------
// HUB MULTIJUGADOR
// ------------------------------------------------------------
(function setupMultiplayerHub(){
  const hub = $('#multi-hub');
  if (!hub) return;

  const show = game => {
    document.querySelectorAll('.multi-game-card').forEach(card => {
      card.classList.toggle('active', card.dataset.multiGame === game);
    });
    const tttView = $('#multi-game-ttt');
    const pokerView = $('#multi-game-poker');
    if (tttView) tttView.classList.toggle('hidden', game !== 'ttt');
    if (pokerView) pokerView.classList.toggle('hidden', game !== 'poker');
    document.body.dataset.multiGame = game;
    Casino.dock();
    if (game === 'ttt' && window.loadMatches) window.loadMatches();
    if (game === 'poker' && window.initPoker) window.initPoker();
  };

  hub.addEventListener('click', event => {
    const card = event.target.closest('.multi-game-card');
    if (card) show(card.dataset.multiGame);
  });

  document.querySelectorAll('.multi-back-hub').forEach(button => {
    button.addEventListener('click', () => {
      show('ttt');
      document.querySelector('.multi-game-card[data-multi-game="ttt"]')?.scrollIntoView({behavior:'smooth', block:'nearest'});
    });
  });

  window.isPokerOpen = () => !$('#multi-game-poker')?.classList.contains('hidden');
})();
