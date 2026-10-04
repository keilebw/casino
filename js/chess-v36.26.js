/* ============================================================
   AJEDREZ — MULTIJUGADOR V36.26
   5+0. El servidor es la autoridad; este cliente anima y muestra.
   ============================================================ */
(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  const PIECES = {K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
  const EMPTY = '';
  let roomId = null;
  let state = null;
  let lobbyTimer = null;
  let matchTimer = null;
  let clockTimer = null;
  let pollBusy = false;
  let actionBusy = false;
  let selected = null;
  let promotionFrom = null;
  let promotionTo = null;
  let revealTimer = null;
  let revealStartedFor = null;
  let lastBoardKey = '';
  let lastPlayersKey = '';
  let lastStatus = '';
  let bound = false;

  window.multiplayerGame = window.multiplayerGame || 'connect4';

  function logged(){ return Boolean(window.Casino?.token); }
  function selectedGame(){ return window.multiplayerGame || 'connect4'; }
  function isChessTab(){ return document.querySelector('#nav button.on')?.dataset?.t === 'multiplayer' && selectedGame() === 'chess'; }
  function isPlaying(){ return Boolean(roomId && state && ['starting','live'].includes(state.status)); }

  function stopTimers(){
    clearTimeout(lobbyTimer); clearTimeout(matchTimer);
    clearInterval(clockTimer);
    lobbyTimer = matchTimer = null; clockTimer = null;
    if (revealTimer){ clearTimeout(revealTimer); revealTimer = null; }
  }

  function msg(text='', type=''){
    const el = $('#chess-feedback');
    if (!el) return;
    el.textContent = text;
    el.className = `chess-feedback ${type}`.trim();
  }

  function playerAvatar(player, size='multi-avatar'){
    if (!player) return '';
    const items = Array.isArray(player.shop_cosmetics) ? player.shop_cosmetics : [];
    if (window.shopAvatarLevelHtml) return window.shopAvatarLevelHtml(player.id, player.avatar_id || 'avatar_01', player.level || 1, size, player.username || '', items);
    if (window.avatarUrl) return `<span class="chess-avatar-fallback"><img class="${esc(size)}" src="${esc(window.avatarUrl(player.avatar_id || 'avatar_01'))}" alt="${esc(player.username || '')}"><b>${Math.max(1, Number(player.level || 1))}</b></span>`;
    return '';
  }

  function playerTitle(player){
    return player && window.shopTitleBadge ? window.shopTitleBadge(player.id, player.shop_cosmetics || []) : '';
  }

  function playerName(player){
    const color = player && window.shopNameColorClass ? window.shopNameColorClass(player.id, player.shop_cosmetics || []) : '';
    return player ? `<span class="chess-player-name ${esc(color)}">${esc(player.username)}</span>` : '';
  }

  function playerThemeClass(player){
    const items = Array.isArray(player?.shop_cosmetics) ? player.shop_cosmetics : [];
    if (window.cosmeticClassesForItems){
      const c = window.cosmeticClassesForItems(items);
      return [c.background, c.effect].filter(Boolean).join(' ');
    }
    return '';
  }

  function playerCard(player, color, label, active){
    if (!player) return `<article class="chess-player-card ${color}"><div class="chess-player-empty"><span>?</span><b>${esc(label)}</b></div></article>`;
    return `<article class="chess-player-card ${color} ${active ? 'turn' : ''} ${esc(playerThemeClass(player))}">
      <div class="chess-player-top"><div class="chess-player-avatar">${playerAvatar(player)}</div><div class="chess-player-copy">
        <span class="chess-color-label">${esc(label)}</span><div class="chess-name-line">${playerName(player)}${playerTitle(player)}</div>
        <small class="chess-player-sub">${(player.shop_cosmetics||[]).some(i=>i.category==='background') ? 'PERSONALIZADO' : 'JUGADOR'}</small>
        ${active ? '<span class="chess-turn-badge">TU TURNO</span>' : ''}
      </div></div><span class="chess-color-dot"></span></article>`;
  }

  function renderLobby(rooms=[]){
    const root = $('#chess-rooms'); if (!root) return;
    root.innerHTML = rooms.length ? rooms.map(room => {
      const host = room.host || {};
      return `<article class="chess-room-card"><div class="chess-room-player">${playerAvatar(host,'multi-avatar-small')}<div><strong>${playerName(host)}</strong>${playerTitle(host)}<small>Sala creada · apuesta <b>${Number(room.stake)||0} FP</b></small></div></div><button type="button" class="main chess-join" data-room-id="${esc(room.id)}">JUGAR <span>→</span></button></article>`;
    }).join('') : `<div class="chess-lobby-empty"><div class="chess-empty-orb">♞</div><h3>No hay salas abiertas</h3><p>Selecciona una apuesta con las fichas de abajo y crea la primera partida.</p></div>`;
  }

  function myColor(){
    if (!state?.me?.id) return '';
    if (state.white_player?.id === state.me.id) return 'white';
    if (state.black_player?.id === state.me.id) return 'black';
    return '';
  }

  function renderPlayers(force=false){
    const key = JSON.stringify({w:state?.white_player?.id,b:state?.black_player?.id,t:state?.turn_user_id,s:state?.status,me:state?.me?.id});
    if (!force && key === lastPlayersKey) return;
    lastPlayersKey = key;
    const black = $('#chess-black-player'), white = $('#chess-white-player');
    if (state?.status === 'starting' || state?.status === 'live' || state?.status === 'finished') {
      if (black) black.innerHTML = playerCard(state.black_player,'black','NEGRAS',state.turn_user_id === state.black_player?.id && state.status === 'live');
      if (white) white.innerHTML = playerCard(state.white_player,'white','BLANCAS',state.turn_user_id === state.white_player?.id && state.status === 'live');
    } else {
      if (black) black.innerHTML = playerCard(null,'black','ESPERANDO',false);
      if (white) white.innerHTML = playerCard(state?.me,'white waiting-seat','CREADOR',false);
    }
  }

  function renderMeta(){
    $('#chess-stake').textContent = `${Number(state?.stake||0)} FP`;
    $('#chess-pot').textContent = `${Number(state?.pot||0)} FP`;
    $('#chess-my-color').textContent = myColor() === 'white' ? 'BLANCAS' : myColor() === 'black' ? 'NEGRAS' : '—';
    const label = $('#chess-status-label');
    if (!label) return;
    if (state?.status==='waiting') label.textContent='ESPERANDO RIVAL';
    else if (state?.status==='starting') label.textContent='SORTEANDO BLANCAS';
    else if (state?.status==='live') label.textContent = state.turn_user_id===state.me?.id ? 'TU TURNO' : 'TURNO DEL RIVAL';
    else label.textContent = state?.winner_id===state?.me?.id ? 'VICTORIA' : state?.winner_id ? 'DERROTA' : 'TABLAS';
  }

  function setOrientation(){
    const board = $('#chess-board'); if (!board) return;
    const black = myColor()==='black';
    board.classList.toggle('black-perspective', black);
    const files = $$('.chess-files span'); const ranks = $$('.chess-ranks span');
    const f = black ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const r = black ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
    files.forEach((x,i)=>x.textContent=f[i]); ranks.forEach((x,i)=>x.textContent=r[i]);
  }

  function renderBoard(force=false){
    const root = $('#chess-board'); if (!root) return;
    const board = Array.isArray(state?.board) ? state.board : [];
    if (board.length !== 64) return;
    const key = board.join('|') + `|${state?.last_move?.from||''}-${state?.last_move?.to||''}|${state?.check_side||''}|${state?.status}|${myColor()}`;
    if (!force && key===lastBoardKey) return;
    const prev = (root.dataset.board || '').split('|');
    const changed = new Set();
    board.forEach((v,i)=>{ if ((prev[i] ?? '') !== v && v) changed.add(i); });
    root.dataset.board = board.join('|');
    const order = myColor()==='black' ? [...Array(64).keys()].reverse() : [...Array(64).keys()];
    const lastFrom = Number(state?.last_move?.from); const lastTo = Number(state?.last_move?.to);
    root.innerHTML = order.map(idx=>{
      const value=board[idx] || EMPTY;
      const row=Math.floor(idx/8), col=idx%8;
      const light=(row+col)%2===0;
      const isLast = idx===lastFrom || idx===lastTo;
      const inCheck = (state?.check_side==='w' && value==='K') || (state?.check_side==='b' && value==='k');
      const selectable = value && ((myColor()==='white' && value===value.toUpperCase()) || (myColor()==='black' && value===value.toLowerCase())) && state?.status==='live' && state.turn_user_id===state.me?.id;
      const marked = selected===idx ? 'selected' : '';
      return `<button type="button" class="chess-square ${light?'light':'dark'} ${isLast?'last-move':''} ${inCheck?'in-check':''} ${selectable?'can-select':''} ${changed.has(idx)?'piece-enter':''}" data-square="${idx}" aria-label="${String.fromCharCode(97+col)}${8-row}" ${state?.status==='live' ? '' : 'disabled'}><span class="chess-piece ${value ? (value===value.toUpperCase()?'white-piece':'black-piece') : 'empty'}">${value ? PIECES[value] || '' : ''}</span><i class="chess-move-dot"></i></button>`;
    }).join('');
    lastBoardKey=key;
    setOrientation();
    highlightMoves();
  }

  function pieceColor(piece){ return !piece?'':piece===piece.toUpperCase()?'white':'black'; }
  function inBounds(r,c){ return r>=0&&r<8&&c>=0&&c<8; }
  function idx(r,c){ return r*8+c; }
  function pseudoMoves(from){
    const board=state?.board||[]; const p=board[from]; if (!p) return [];
    const color=pieceColor(p); const type=p.toLowerCase(); const out=[];
    const add=(r,c)=>{ if(!inBounds(r,c)) return; const j=idx(r,c); const t=board[j]; if(!t||pieceColor(t)!==color) out.push(j); };
    const ray=(dr,dc)=>{ let r=Math.floor(from/8)+dr,c=from%8+dc; while(inBounds(r,c)){ const j=idx(r,c),t=board[j]; if(!t) out.push(j); else { if(pieceColor(t)!==color) out.push(j); break; } r+=dr;c+=dc; } };
    const r=Math.floor(from/8),c=from%8;
    if(type==='p'){
      const d=color==='white'?-1:1, start=color==='white'?6:1;
      let j=idx(r+d,c); if(inBounds(r+d,c)&&!board[j]){ out.push(j); const j2=idx(r+2*d,c); if(r===start&&!board[j2]) out.push(j2); }
      for(const dc of [-1,1]){ const rr=r+d,cc=c+dc; if(inBounds(rr,cc)){ const j3=idx(rr,cc),t=board[j3]; if(t&&pieceColor(t)!==color) out.push(j3); if(Number(state?.en_passant)===j3) out.push(j3); } }
    } else if(type==='n'){
      for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr,c+dc);
    } else if(type==='b'){
      [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc])=>ray(dr,dc));
    } else if(type==='r'){
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc])=>ray(dr,dc));
    } else if(type==='q'){
      [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc])=>ray(dr,dc));
    } else if(type==='k'){
      for(const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) add(r+dr,c+dc);
      const rights=state?.castling||'';
      if(color==='white'&&from===60){ if(rights.includes('K')&&board[61]===''&&board[62]==='') out.push(62); if(rights.includes('Q')&&board[59]===''&&board[58]===''&&board[57]==='') out.push(58); }
      if(color==='black'&&from===4){ if(rights.includes('k')&&board[5]===''&&board[6]==='') out.push(6); if(rights.includes('q')&&board[3]===''&&board[2]===''&&board[1]==='') out.push(2); }
    }
    return out;
  }

  function highlightMoves(){
    const board=$('#chess-board'); if(!board) return;
    $$('.chess-square',board).forEach(el=>el.classList.remove('possible','selected'));
    if(selected==null) return;
    board.querySelector(`[data-square="${selected}"]`)?.classList.add('selected');
    const moves=pseudoMoves(selected);
    moves.forEach(m=>board.querySelector(`[data-square="${m}"]`)?.classList.add('possible'));
  }

  function formatTime(ms){
    const n=Math.max(0,Math.floor(ms/1000)); const min=Math.floor(n/60); const sec=n%60;
    return `${min}:${String(sec).padStart(2,'0')}`;
  }

  function effectiveClock(which){
    const base=Number(state?.[which+'_ms']||0);
    if(state?.status!=='live'||!state.turn_started_at) return base;
    const turnColor=state.turn_user_id===state.white_player?.id?'white':state.turn_user_id===state.black_player?.id?'black':'';
    if(turnColor!==which.slice(0,-3)) return base;
    const elapsed=Date.now()-new Date(state.turn_started_at).getTime();
    return Math.max(0,base-elapsed);
  }

  function renderClocks(){
    const w=effectiveClock('white_ms'), b=effectiveClock('black_ms');
    const wc=$('#chess-white-clock'), bc=$('#chess-black-clock');
    if(wc){ wc.querySelector('strong').textContent=formatTime(w); wc.classList.toggle('active',state?.turn_user_id===state?.white_player?.id&&state?.status==='live'); wc.classList.toggle('danger',w<=30000); }
    if(bc){ bc.querySelector('strong').textContent=formatTime(b); bc.classList.toggle('active',state?.turn_user_id===state?.black_player?.id&&state?.status==='live'); bc.classList.toggle('danger',b<=30000); }
    const pulse=$('#chess-turn-pulse');
    if(pulse) pulse.textContent=state?.status==='live' ? (state.turn_user_id===state.me?.id?'TU TURNO':'ESPERANDO') : state?.status==='starting'?'SORTEANDO':'FINALIZADA';
  }

  function ensureClockTimer(){
    clearInterval(clockTimer);
    clockTimer=setInterval(()=>{
      if(!isChessTab()){ clearInterval(clockTimer); clockTimer=null; return; }
      renderClocks();
      if(state?.status==='live'){ const w=effectiveClock('white_ms'),b=effectiveClock('black_ms'); if(w<=0||b<=0) refreshState(); }
    },100);
  }

  function renderResult(){
    const box=$('#chess-result'); if(!box) return;
    if(state?.status!=='finished'){ box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const won=state.winner_id===state.me?.id, draw=!state.winner_id;
    box.className=`chess-result ${won?'win':draw?'draw':'lose'}`;
    $('#chess-result-icon').textContent=won?'✓':draw?'=':'×';
    $('#chess-result-title').textContent=won?'¡VICTORIA!':draw?'TABLAS':'DERROTA';
    const reason={checkmate:'Jaque mate',timeout:'Se acabó el tiempo',resign:'El rival abandonó',stalemate:'Ahogado','50move':'Regla de las 50 jugadas',insufficient:'Material insuficiente'}[state.result] || 'Partida terminada';
    $('#chess-result-copy').textContent=draw ? `Tablas · ${reason}.` : `${reason}. ${won?`Has ganado ${Number(state.pot||0)} FP.`:'El bote queda para el rival.'}`;
  }

  function renderControls(){
    const live=state?.status==='live', mine=state?.turn_user_id===state?.me?.id;
    $$('.chess-square').forEach(x=>x.disabled=!live||!mine);
    $('#chess-resign').disabled=!live;
    $('#chess-back-lobby').textContent=state?.status==='finished'?'VOLVER A SALAS':'SALIR DE LA SALA';
  }

  function renderState(force=false){
    if(!state) return;
    const prev=lastStatus;
    $('#chess-lobby-view')?.classList.toggle('hidden',!!roomId);
    $('#chess-match-view')?.classList.toggle('hidden',!roomId);
    renderMeta(); renderPlayers(force); renderBoard(force); renderClocks(); renderResult(); renderControls();
    if (state.status !== 'starting') {
      if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
      revealStartedFor = null;
      $('#chess-color-overlay')?.classList.add('hidden');
    }
    lastStatus=state.status||prev;
    if(state.status==='live' && !clockTimer) ensureClockTimer();
    if(state.status!=='live' && clockTimer){ clearInterval(clockTimer); clockTimer=null; }
    if(prev!==state.status){ window.Casino?.dock?.(); if(state.status==='finished') window.Casino?.loadProfile?.(); }
  }

  async function refreshLobby(){
    if(!logged()||!isChessTab()||roomId) return;
    const {data,error}=await supabaseClient.rpc('chess_list_rooms',{p_token:window.Casino.token});
    if(error){ console.error('[CHESS] lobby',error); msg(error.message||'No se han podido cargar las salas.','error'); return; }
    renderLobby(Array.isArray(data)?data:[]);
  }
  function scheduleLobby(){ clearTimeout(lobbyTimer); if(!logged()||!isChessTab()||roomId) return; lobbyTimer=setTimeout(async()=>{await refreshLobby();scheduleLobby();},3500); }

  async function refreshState(){
    if(!roomId||!logged()||!isChessTab()||pollBusy) return;
    pollBusy=true;
    const {data,error}=await supabaseClient.rpc('chess_get_state',{p_token:window.Casino.token,p_room_id:roomId});
    pollBusy=false;
    if(error){ console.error('[CHESS] state',error); scheduleMatch(); return; }
    if(data?.status==='none'){ roomId=null; state=null; stopTimers(); renderLobby([]); $('#chess-lobby-view')?.classList.remove('hidden'); $('#chess-match-view')?.classList.add('hidden'); window.Casino?.dock?.(); return; }
    state=data; renderState();
    if (state?.status === 'starting') startColorReveal();
    scheduleMatch();
  }
  function scheduleMatch(){ clearTimeout(matchTimer); if(!roomId||!logged()||!isChessTab()) return; matchTimer=setTimeout(refreshState,700); }

  async function createRoom(){
    if(actionBusy) return;
    const stake=Number(window.Casino?.stake||0);
    if(!Number.isInteger(stake)||stake<1) return msg('Selecciona una apuesta con las fichas de abajo antes de crear la sala.','warn');
    actionBusy=true; msg('Creando sala…');
    const {data,error}=await supabaseClient.rpc('chess_start_room',{p_token:window.Casino.token,p_stake:stake});
    actionBusy=false;
    if(error) return msg(error.message||'No se ha podido crear la sala.','error');
    window.Casino.clearStake?.(); roomId=data.id; state=data; selected=null; lastBoardKey=''; lastPlayersKey='';
    renderState(true); msg('Sala creada. Esperando a que entre otro jugador…','ok'); scheduleMatch(); window.Casino?.dock?.();
  }

  async function joinRoom(id){
    if(actionBusy) return;
    actionBusy=true; msg('Entrando en la sala…');
    const {data,error}=await supabaseClient.rpc('chess_join_room',{p_token:window.Casino.token,p_room_id:id});
    actionBusy=false;
    if(error) return msg(error.message||'No se ha podido entrar en la sala.','error');
    window.Casino.clearStake?.(); roomId=id; state=data; selected=null; lastBoardKey=''; lastPlayersKey='';
    renderState(true); window.Casino?.dock?.(); startColorReveal(); scheduleMatch();
  }

  function startColorReveal(){
    if(!state||state.status!=='starting') return;
    const overlay=$('#chess-color-overlay'), coin=$('#chess-color-coin'), result=$('#chess-color-result');
    const key=`${roomId}|${state.white_player?.id}|${state.black_player?.id}`;
    if(revealStartedFor===key) return;
    revealStartedFor=key;
    overlay?.classList.remove('hidden');
    coin?.classList.remove('flip','show-black');
    void coin?.offsetWidth;
    coin?.classList.add('flip');
    if(result) result.textContent='Decidiendo quién juega con blancas…';
    revealTimer=setTimeout(async()=>{
      if(!state||state.status!=='starting') return;
      const mine=state.white_player?.id===state.me?.id;
      if(coin) coin.classList.toggle('show-black',!mine);
      if(result) result.textContent=mine?'TE HAN TOCADO LAS BLANCAS':'TE HAN TOCADO LAS NEGRAS';
      await beginGame();
    },1600);
  }

  async function beginGame(){
    if(!roomId||!state||state.status!=='starting') return;
    const {data,error}=await supabaseClient.rpc('chess_begin',{p_token:window.Casino.token,p_room_id:roomId});
    if(error){ console.error('[CHESS] begin',error); scheduleMatch(); return; }
    state=data; renderState(true); setTimeout(()=>$('#chess-color-overlay')?.classList.add('hidden'),500); ensureClockTimer(); scheduleMatch();
  }

  async function sendMove(from,to,promotion=''){
    if(actionBusy||!roomId||state?.status!=='live'||state.turn_user_id!==state.me?.id) return;
    actionBusy=true;
    const {data,error}=await supabaseClient.rpc('chess_move',{p_token:window.Casino.token,p_room_id:roomId,p_from:from,p_to:to,p_promotion:promotion});
    actionBusy=false;
    if(error){ msg(error.message||'Movimiento ilegal.','error'); return; }
    selected=null; promotionFrom=null; promotionTo=null; $('#chess-promotion')?.classList.add('hidden'); state=data; renderState(true); scheduleMatch();
  }

  function askPromotion(from,to){
    promotionFrom=from; promotionTo=to; $('#chess-promotion')?.classList.remove('hidden');
  }

  function squareClick(ev){
    const el=ev.target.closest('.chess-square'); if(!el||el.disabled) return;
    const to=Number(el.dataset.square); const board=state?.board||[]; const me=state?.me?.id;
    if(state?.status!=='live'||state.turn_user_id!==me) return;
    if(selected==null){
      const p=board[to]; if(!p) return;
      const color=pieceColor(p); if((myColor()==='white'&&color!=='white')||(myColor()==='black'&&color!=='black')) return;
      selected=to; highlightMoves(); return;
    }
    if(to===selected){ selected=null; highlightMoves(); return; }
    const moves=pseudoMoves(selected); if(!moves.includes(to)){ const p=board[to]; if(p&&pieceColor(p)===(myColor()==='white'?'white':'black')){ selected=to; highlightMoves(); } return; }
    const p=board[selected]; const row=Math.floor(to/8); if(p?.toLowerCase()==='p'&&((pieceColor(p)==='white'&&row===0)||(pieceColor(p)==='black'&&row===7))) return askPromotion(selected,to);
    sendMove(selected,to,'');
  }

  function promotionClick(ev){ const btn=ev.target.closest('[data-promotion]'); if(!btn) return; if(promotionFrom==null||promotionTo==null) return; sendMove(promotionFrom,promotionTo,btn.dataset.promotion); }

  async function resign(){
    if(actionBusy||!roomId||state?.status!=='live') return;
    if(!window.confirm('¿Seguro que quieres rendirte? Perderás la apuesta.')) return;
    actionBusy=true;
    const {data,error}=await supabaseClient.rpc('chess_resign',{p_token:window.Casino.token,p_room_id:roomId});
    actionBusy=false;
    if(error) return msg(error.message||'No se ha podido rendir la partida.','error');
    state=data; selected=null; renderState(true); scheduleMatch();
  }

  async function backLobby(){
    stopTimers(); selected=null; promotionFrom=promotionTo=null; $('#chess-promotion')?.classList.add('hidden'); $('#chess-color-overlay')?.classList.add('hidden');
    if(state?.status==='waiting'&&roomId){
      await supabaseClient.rpc('chess_cancel_room',{p_token:window.Casino.token,p_room_id:roomId});
    }
    roomId=null; state=null; revealStartedFor=null; lastBoardKey=''; lastPlayersKey='';
    $('#chess-match-view')?.classList.add('hidden'); $('#chess-lobby-view')?.classList.remove('hidden'); msg('');
    window.Casino?.loadProfile?.(); window.Casino?.dock?.(); refreshLobby(); scheduleLobby();
  }

  function selectGame(game){
    window.multiplayerGame=game;
    $$('.mp-game-tab').forEach(b=>{ const on=b.dataset.mpGame===game; b.classList.toggle('on',on); b.setAttribute('aria-selected',String(on)); });
    if(game==='chess'){
      $('#c4-lobby-view')?.classList.add('hidden'); $('#c4-match-view')?.classList.add('hidden');
      if(roomId) {
        $('#chess-lobby-view')?.classList.add('hidden');
        $('#chess-match-view')?.classList.remove('hidden');
        refreshState();
        scheduleMatch();
      } else {
        $('#chess-lobby-view')?.classList.remove('hidden');
        $('#chess-match-view')?.classList.add('hidden');
        refreshLobby();
        scheduleLobby();
      }
      window.Casino?.dock?.();
    } else {
      stopTimers(); $('#chess-lobby-view')?.classList.add('hidden'); $('#chess-match-view')?.classList.add('hidden');
      window.showConnect4View?.(); window.Casino?.dock?.();
    }
  }

  function bind(){
    if(bound) return; bound=true;
    $('#chess-create')?.addEventListener('click',createRoom);
    $('#chess-refresh')?.addEventListener('click',()=>{refreshLobby();scheduleLobby();});
    $('#chess-rooms')?.addEventListener('click',e=>{const b=e.target.closest('[data-room-id]');if(b)joinRoom(b.dataset.roomId);});
    $('#chess-board')?.addEventListener('click',squareClick);
    $('#chess-promotion')?.addEventListener('click',promotionClick);
    $('#chess-resign')?.addEventListener('click',resign);
    $('#chess-back-lobby')?.addEventListener('click',backLobby);
    $$('.mp-game-tab').forEach(b=>b.addEventListener('click',()=>selectGame(b.dataset.mpGame)));
    window.addEventListener('casino:cosmetics-updated',()=>{ if(isChessTab()&&state) renderPlayers(true); });
    window.addEventListener('beforeunload',stopTimers);
  }

  window.refreshChess=async()=>{ bind(); if(!isChessTab()) return; if(roomId) {await refreshState();} else {await refreshLobby();scheduleLobby();} };
  window.chessIsPlaying=()=>isPlaying() && selectedGame()==='chess';
  window.initChess=bind;

  bind();
})();
