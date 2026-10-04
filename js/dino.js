// ============================================================
// DINOSAURIO — V34.0
// Carrera gratuita de recuperación hasta 30 FP.
// La acreditación de cada moneda se valida en Supabase.
// ============================================================

const DINO_LIMIT = 30;
const DINO_W = 960;
const DINO_H = 430;
const DINO_GROUND = 340;

const dino = {
  initialized: false,
  running: false,
  crashed: false,
  busy: false,
  frame: 0,
  raf: 0,
  lastTime: 0,
  elapsed: 0,
  distance: 0,
  runCoins: 0,
  serverCollected: 0,
  speed: 300,
  spawnTimer: 1.2,
  coinTimer: .45,
  obstacleGap: 0,
  obstacles: [],
  coins: [],
  particles: [],
  clouds: [],
  stars: [],
  bestDistance: 0,
  runTarget: 0,
  pendingClaims: 0,
  jumpQueued: false,
  claimQueue: Promise.resolve(),
  crashTimeout: 0,
  audio: null,
  player: { x: 142, y: DINO_GROUND - 70, w: 52, h: 70, vy: 0, onGround: true, blink: 0 },
};

const dq = id => document.getElementById(id);

function dinoMoney(v) {
  return `${Math.max(0, Math.floor(Number(v) || 0))} FP`;
}

function dinoActiveTab() {
  return !dq('t-dinosaur')?.classList.contains('hidden');
}

function dinoSound(kind) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    dino.audio ||= new AudioContext();
    if (dino.audio.state === 'suspended') dino.audio.resume();
    const ctx = dino.audio;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const sounds = {
      jump: [330, .09, 'triangle', .055],
      coin: [780, .13, 'sine', .07],
      crash: [110, .34, 'sawtooth', .1],
      cap: [620, .32, 'triangle', .08]
    };
    const [freq, dur, type, vol] = sounds[kind] || sounds.jump;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'jump') osc.frequency.exponentialRampToValueAtTime(510, now + dur);
    if (kind === 'coin') osc.frequency.exponentialRampToValueAtTime(1120, now + dur);
    if (kind === 'crash') osc.frequency.exponentialRampToValueAtTime(48, now + dur);
    if (kind === 'cap') osc.frequency.exponentialRampToValueAtTime(980, now + dur);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + dur);
    osc.start(now); osc.stop(now + dur + .02);
  } catch (_) {}
}

function dinoRandom(min, max) {
  return min + Math.random() * (max - min);
}

function dinoRectOverlap(a, b, pad = 0) {
  return a.x + a.w - pad > b.x &&
    a.x + pad < b.x + b.w &&
    a.y + a.h - pad > b.y &&
    a.y + pad < b.y + b.h;
}

function dinoSetMessage(text, type = '') {
  const el = dq('dino-message');
  if (!el) return;
  el.textContent = text;
  el.className = `dino-message${type ? ` ${type}` : ''}`;
}

function dinoBalance() {
  return Math.max(0, Math.floor(Number(Casino?.balance || 0)));
}

function dinoUpdateStatus() {
  const balance = dinoBalance();
  const available = Math.max(0, DINO_LIMIT - balance);
  dq('dino-balance').textContent = dinoMoney(balance);
  dq('dino-available').textContent = dinoMoney(available);
  dq('dino-run-coins').textContent = dinoMoney(dino.runCoins);
  dq('dino-score').textContent = `${dino.runCoins} / ${Math.max(0, dino.runTarget || (dino.runCoins + available))}`;
  const progress = Math.min(100, balance / DINO_LIMIT * 100);
  dq('dino-progress-fill').style.width = `${progress}%`;
  const start = dq('dino-start');
  if (start && !dino.running && !dino.crashed) {
    start.disabled = balance >= DINO_LIMIT;
    start.textContent = balance >= DINO_LIMIT ? 'Límite alcanzado' : 'Iniciar carrera';
  }
  if (!dino.running && balance >= DINO_LIMIT && !dino.crashed) {
    dinoSetMessage('Ya tienes 30 FP. El juego de recuperación queda bloqueado hasta volver a bajar de 30 FP.', 'cap');
  }
}

function dinoResizeCanvas() {
  const canvas = dq('dino-canvas');
  if (!canvas) return;
  canvas.style.aspectRatio = `${DINO_W} / ${DINO_H}`;
}

function dinoInitScene() {
  dino.stars = Array.from({ length: 44 }, () => ({
    x: dinoRandom(0, DINO_W), y: dinoRandom(28, 190), r: dinoRandom(.6, 1.8), a: dinoRandom(.3, .9)
  }));
  dino.clouds = Array.from({ length: 6 }, (_, i) => ({
    x: i * 205 + dinoRandom(-40, 40), y: dinoRandom(65, 165), s: dinoRandom(.65, 1.15), speed: dinoRandom(8, 17)
  }));
}

function dinoRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function dinoDrawBackground(ctx, dt) {
  const g = ctx.createLinearGradient(0, 0, 0, DINO_H);
  g.addColorStop(0, '#04131a');
  g.addColorStop(.64, '#082d25');
  g.addColorStop(1, '#07180f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DINO_W, DINO_H);

  const moon = ctx.createRadialGradient(780, 82, 4, 780, 82, 74);
  moon.addColorStop(0, '#fff4c8');
  moon.addColorStop(.45, '#e0b457');
  moon.addColorStop(1, '#e0b45700');
  ctx.fillStyle = moon;
  ctx.beginPath(); ctx.arc(780, 82, 74, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff1bf';
  ctx.beginPath(); ctx.arc(780, 82, 33, 0, Math.PI * 2); ctx.fill();

  for (const star of dino.stars) {
    ctx.globalAlpha = star.a * (.75 + Math.sin(dino.elapsed * 2 + star.x) * .15);
    ctx.fillStyle = '#f8e9b4';
    ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const cloud of dino.clouds) {
    cloud.x -= cloud.speed * dt;
    if (cloud.x < -160) cloud.x = DINO_W + dinoRandom(20, 100);
    const x = cloud.x, y = cloud.y, s = cloud.s;
    ctx.fillStyle = '#e8e8d51a';
    ctx.beginPath();
    ctx.ellipse(x, y, 50*s, 15*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+30*s, y-8*s, 30*s, 18*s, 0, 0, Math.PI*2);
    ctx.ellipse(x-26*s, y-4*s, 27*s, 14*s, 0, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.fillStyle = '#0c3a2a';
  for (let i = 0; i < 9; i++) {
    const x = ((i * 130) - (dino.distance * .18)) % 1170 - 90;
    const h = 40 + (i % 4) * 15;
    ctx.beginPath();
    ctx.moveTo(x, DINO_GROUND);
    ctx.lineTo(x + 45, DINO_GROUND - h);
    ctx.lineTo(x + 100, DINO_GROUND);
    ctx.closePath(); ctx.fill();
  }

  ctx.strokeStyle = '#e0b45744';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, DINO_GROUND + 1); ctx.lineTo(DINO_W, DINO_GROUND + 1); ctx.stroke();
  ctx.strokeStyle = '#e0b45713';
  ctx.lineWidth = 1;
  const roadShift = (dino.distance * 1.8) % 90;
  for (let x = -roadShift; x < DINO_W; x += 90) {
    ctx.beginPath(); ctx.moveTo(x, DINO_GROUND + 28); ctx.lineTo(x + 38, DINO_GROUND + 28); ctx.stroke();
  }
}

function dinoDrawPlayer(ctx) {
  const p = dino.player;
  const bob = p.onGround ? Math.sin(dino.elapsed * 24) * 1.5 : 0;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  if (p.blink > 0 && Math.floor(p.blink * 30) % 2 === 0) ctx.globalAlpha = .28;

  ctx.shadowColor = '#7be3a1';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#54b879';
  dinoRoundRect(ctx, 10, 14, 32, 42, 9); ctx.fill();
  ctx.beginPath(); ctx.moveTo(32, 19); ctx.lineTo(47, 4); ctx.lineTo(50, 9); ctx.lineTo(41, 25); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, 24); ctx.lineTo(-10, 12); ctx.lineTo(-5, 30); ctx.lineTo(9, 36); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7de09d'; dinoRoundRect(ctx, 25, 3, 24, 28, 8); ctx.fill();
  ctx.fillStyle = '#08140f';
  ctx.beginPath(); ctx.arc(41, 12, 2.4, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#24593e'; ctx.lineWidth = 2;
  for (const sx of [17, 26, 35]) { ctx.beginPath(); ctx.moveTo(sx, 19); ctx.lineTo(sx+4, 17); ctx.stroke(); }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#2f8656';
  const leg = Math.sin(dino.elapsed * 28) * 6;
  ctx.fillRect(15, 53, 8, 15 + Math.max(0, leg));
  ctx.fillRect(34, 53, 8, 15 + Math.max(0, -leg));
  ctx.restore();
}

function dinoDrawObstacle(ctx, obstacle) {
  ctx.save();
  ctx.translate(obstacle.x, obstacle.y);
  ctx.shadowColor = '#c99639'; ctx.shadowBlur = 9;
  if (obstacle.type === 'cactus') {
    ctx.fillStyle = '#54783d';
    dinoRoundRect(ctx, 13, 0, 24, 62, 9); ctx.fill();
    dinoRoundRect(ctx, 0, 22, 17, 22, 7); ctx.fill();
    dinoRoundRect(ctx, 34, 14, 17, 29, 7); ctx.fill();
    ctx.strokeStyle = '#d6c18266'; ctx.lineWidth = 2;
    for (let y=9; y<55; y+=12){ ctx.beginPath(); ctx.moveTo(19,y); ctx.lineTo(14,y+4); ctx.stroke(); }
  } else {
    ctx.fillStyle = '#8b6c43';
    ctx.beginPath(); ctx.moveTo(0, obstacle.h); ctx.lineTo(10, 20); ctx.lineTo(28, 0); ctx.lineTo(52, 16); ctx.lineTo(64, 0); ctx.lineTo(obstacle.w, 25); ctx.lineTo(obstacle.w, obstacle.h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b99152';
    ctx.fillRect(14, 28, 11, 8); ctx.fillRect(37, 20, 9, 7);
  }
  ctx.restore();
}

function dinoDrawCoin(ctx, coin) {
  const bob = Math.sin(dino.elapsed * 7 + coin.phase) * 4;
  ctx.save(); ctx.translate(coin.x, coin.y + bob); ctx.shadowColor = '#f4ce63'; ctx.shadowBlur = 18;
  const g = ctx.createRadialGradient(-5, -5, 1, 0, 0, coin.r + 3);
  g.addColorStop(0, '#fff7c8'); g.addColorStop(.25, '#f4d77f'); g.addColorStop(.7, '#c8952f'); g.addColorStop(1, '#6c4b17');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,coin.r,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#32230e'; ctx.font = '900 10px Georgia,serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('FP',0,1);
  ctx.strokeStyle = '#fff0a6'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(0,0,coin.r-2,0,Math.PI*2); ctx.stroke();
  ctx.restore();
}

function dinoDrawParticles(ctx) {
  for (const p of dino.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function dinoSpawnParticleBurst(x, y, color = '#f3d77a', amount = 10) {
  for (let i=0;i<amount;i++) {
    dino.particles.push({x,y,vx:dinoRandom(-90,90),vy:dinoRandom(-150,-40),life:dinoRandom(.35,.7),maxLife:.7,size:dinoRandom(2,5),color});
  }
}

function dinoSpawnObstacle() {
  const type = Math.random() < .62 ? 'cactus' : 'rock';
  const h = type === 'cactus' ? 62 : 50;
  const w = type === 'cactus' ? 52 : 64;
  dino.obstacles.push({ x:DINO_W + 30, y:DINO_GROUND - h, w, h, type });
  dino.obstacleGap = dinoRandom(470, 720);
}

function dinoSpawnCoin() {
  const alt = Math.random();
  const y = alt < .55 ? DINO_GROUND - dinoRandom(62, 95) : DINO_GROUND - dinoRandom(120, 155);
  dino.coins.push({ x:DINO_W + dinoRandom(30, 130), y, r:15, phase:dinoRandom(0,Math.PI*2), collected:false });
}

function dinoResetLocal(collected = 0) {
  dino.running = false; dino.crashed = false; dino.busy = false; dino.frame = 0; dino.lastTime = 0;
  dino.elapsed = 0; dino.distance = 0; dino.runCoins = collected; dino.serverCollected = collected;
  dino.runTarget = Math.max(collected, collected + Math.max(0, DINO_LIMIT - dinoBalance()));
  dino.pendingClaims = 0;
  dino.speed = 300; dino.spawnTimer = 1.05; dino.coinTimer = .25; dino.obstacleGap = 0;
  dino.obstacles = []; dino.coins = []; dino.particles = [];
  dino.player = { x:142, y:DINO_GROUND-70, w:52, h:70, vy:0, onGround:true, blink:0 };
  cancelAnimationFrame(dino.raf); dino.crashTimeout && clearTimeout(dino.crashTimeout);
  dino.crashTimeout = 0;
  dinoUpdateHud(); dinoUpdateStatus();
}

function dinoUpdateHud() {
  const meters = Math.floor(dino.distance);
  dq('dino-distance').textContent = `${String(meters).padStart(4,'0')} m`;
  dq('dino-run-coins').textContent = dinoMoney(dino.runCoins);
  dq('dino-score').textContent = `${dino.runCoins} / ${DINO_LIMIT}`;
  dq('dino-best').textContent = `${Math.floor(dino.bestDistance)} m`;
  const progress = Math.min(100, Math.max(0, dinoBalance() / DINO_LIMIT * 100));
  dq('dino-progress-fill').style.width = `${progress}%`;
}

function dinoJump() {
  if (!dino.running || dino.busy || dino.crashed) return;
  const p = dino.player;
  if (p.onGround) {
    p.vy = -795;
    p.onGround = false;
    dinoSound('jump');
  } else if (p.vy > 160) {
    p.vy = -620;
  }
}

function dinoCheckCoin(coin) {
  const box = {x:dino.player.x+6,y:dino.player.y+7,w:dino.player.w-12,h:dino.player.h-8};
  return dinoRectOverlap(box, {x:coin.x-coin.r,y:coin.y-coin.r,w:coin.r*2,h:coin.r*2}, 2);
}

function dinoCrash() {
  if (!dino.running || dino.crashed) return;
  dino.running = false; dino.crashed = true;
  dinoSound('crash');
  dino.player.blink = .7;
  dinoSpawnParticleBurst(dino.player.x + 24, dino.player.y + 32, '#ff8a8a', 20);
  dino.bestDistance = Math.max(dino.bestDistance, dino.distance);
  localStorage.setItem('dino_best_distance', String(Math.floor(dino.bestDistance)));
  dinoSetMessage(`¡Choque! Has recuperado ${dino.runCoins} FP en esta carrera.`, 'lose');
  dq('dino-start').classList.add('hidden');
  dq('dino-replay').classList.remove('hidden');
  dino.claimQueue.then(() => dinoFinishServer('crash'));
  dinoDrawFrame(0);
  dino.crashTimeout = setTimeout(() => {
    const overlay = dq('dino-overlay');
    dq('dino-overlay-title').textContent = dino.runCoins > 0 ? 'Carrera terminada' : 'Has chocado';
    dq('dino-overlay-text').textContent = dino.runCoins > 0
      ? `Has recuperado ${dino.runCoins} FP. Puedes volver a correr mientras tu saldo siga por debajo de 30 FP.`
      : 'No has perdido ningún FP porque esta carrera es gratuita. Inténtalo de nuevo.';
    dq('dino-start').classList.add('hidden');
    dq('dino-replay').classList.remove('hidden');
    overlay.classList.add('show');
  }, 560);
}

function dinoStopForCap() {
  if (dino.crashed) return;
  dino.running = false; dino.crashed = true;
  dinoSound('cap');
  dino.player.blink = .45;
  dinoSpawnParticleBurst(dino.player.x + 26, dino.player.y + 25, '#f4d77f', 28);
  dinoSetMessage('Has alcanzado el límite de recuperación: 30 FP.', 'cap');
  localStorage.setItem('dino_best_distance', String(Math.floor(Math.max(dino.bestDistance, dino.distance))));
  dino.claimQueue.then(() => dinoFinishServer('capped'));
  const overlay = dq('dino-overlay');
  dq('dino-overlay-title').textContent = '30 FP alcanzados';
  dq('dino-overlay-text').textContent = 'Perfecto. Ya tienes el máximo permitido para el juego de recuperación.';
  dq('dino-start').classList.add('hidden');
  dq('dino-replay').classList.remove('hidden');
  overlay.classList.add('show');
}

function dinoUpdate(dt) {
  if (!dino.running) return;
  dino.elapsed += dt;
  dino.distance += dino.speed * dt / 100;
  dino.speed = Math.min(455, dino.speed + dt * 4.1);
  dino.frame += 1;

  const p = dino.player;
  p.vy += 2280 * dt;
  p.y += p.vy * dt;
  if (p.y >= DINO_GROUND - p.h) { p.y = DINO_GROUND - p.h; p.vy = 0; p.onGround = true; }
  p.blink = Math.max(0, p.blink - dt);

  dino.spawnTimer -= dt;
  if (dino.spawnTimer <= 0) {
    if (dino.obstacles.length === 0 || dino.obstacles[dino.obstacles.length-1].x < DINO_W - dino.obstacleGap) dinoSpawnObstacle();
    dino.spawnTimer = dinoRandom(1.0, 1.48);
  }

  dino.coinTimer -= dt;
  if (dino.coinTimer <= 0 && dinoBalance() < DINO_LIMIT && dino.pendingClaims === 0) {
    dinoSpawnCoin();
    dino.coinTimer = dinoRandom(.65, 1.15);
  }

  const dx = dino.speed * dt;
  for (const o of dino.obstacles) o.x -= dx;
  for (const c of dino.coins) c.x -= dx;

  dino.obstacles = dino.obstacles.filter(o => o.x + o.w > -40);
  dino.coins = dino.coins.filter(c => c.x + c.r > -30 && !c.collected);

  const playerBox = {x:p.x+10,y:p.y+10,w:p.w-18,h:p.h-12};
  for (const o of dino.obstacles) {
    const hitBox = {x:o.x+4,y:o.y+4,w:o.w-8,h:o.h-4};
    if (dinoRectOverlap(playerBox, hitBox, 4)) { dinoCrash(); return; }
  }

  for (const c of dino.coins) {
    if (!c.collected && dino.pendingClaims === 0 && dinoCheckCoin(c)) {
      c.collected = true;
      dino.pendingClaims += 1;
      dinoClaimQueue();
      dinoSound('coin');
      dinoSpawnParticleBurst(c.x, c.y, '#f3d77a', 10);
    }
  }

  for (const pfx of dino.particles) {
    pfx.x += pfx.vx * dt; pfx.y += pfx.vy * dt; pfx.vy += 250 * dt; pfx.life -= dt;
  }
  dino.particles = dino.particles.filter(pfx => pfx.life > 0);

  if (dinoBalance() >= DINO_LIMIT) { dinoStopForCap(); return; }
  dinoUpdateStatus();
  dinoUpdateHud();
}

function dinoDrawFrame(dt = 0) {
  const canvas = dq('dino-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,DINO_W,DINO_H);
  dinoDrawBackground(ctx, dt);
  for (const c of dino.coins) dinoDrawCoin(ctx, c);
  for (const o of dino.obstacles) dinoDrawObstacle(ctx, o);
  dinoDrawPlayer(ctx);
  dinoDrawParticles(ctx);
  if (!dino.running && !dino.crashed && dinoBalance() < DINO_LIMIT) {
    ctx.fillStyle = '#f3db8a'; ctx.font = '900 12px system-ui,sans-serif'; ctx.textAlign='center';
    ctx.fillText('CORRE GRATIS · RECOGE FP · LÍMITE 30', DINO_W/2, DINO_H-18);
  }
}

function dinoLoop(now) {
  if (!dino.running) { dinoDrawFrame(0); return; }
  if (!dino.lastTime) dino.lastTime = now;
  const dt = Math.min(.032, Math.max(0, (now - dino.lastTime) / 1000));
  dino.lastTime = now;
  dinoUpdate(dt);
  dinoDrawFrame(dt);
  if (dino.running) dino.raf = requestAnimationFrame(dinoLoop);
}

async function dinoClaimQueue() {
  const runId = dino.currentRunId;
  dino.claimQueue = dino.claimQueue.then(async () => {
    if (!runId || !Casino?.token) return;
    if (dinoBalance() >= DINO_LIMIT) return;
    const { data, error } = await supabaseClient.rpc('dinosaur_claim', {
      p_token: Casino.token,
      p_run_id: runId,
      p_amount: 1
    });
    if (error) {
      console.error(error);
      dinoSetMessage('No se pudo guardar una moneda. La carrera se ha detenido para proteger tu saldo.', 'lose');
      dino.running = false; dino.crashed = true;
      await dinoFinishServer('error');
      dq('dino-replay').classList.remove('hidden');
      dq('dino-overlay-title').textContent = 'Carrera detenida';
      dq('dino-overlay-text').textContent = 'No se ha perdido saldo. Puedes iniciar una nueva carrera.';
      dq('dino-overlay').classList.add('show');
      return;
    }
    if (typeof data.coins !== 'undefined') Casino.setBalance(data.coins);
    if (data.outcome === 'claimed') {
      dino.runCoins += Number(data.claimed || 1);
      dino.serverCollected = Number(data.collected || dino.serverCollected + 1);
      dinoUpdateStatus(); dinoUpdateHud();
      dinoSetMessage(`+${data.claimed || 1} FP · sigue corriendo.`, 'win');
    }
    if (data.outcome === 'capped' || Number(data.coins) >= DINO_LIMIT) dinoStopForCap();
  }).catch(error => console.error('Dinosaur queue:', error)).finally(() => {
    dino.pendingClaims = Math.max(0, dino.pendingClaims - 1);
  });
  return dino.claimQueue;
}

async function dinoFinishServer(reason, runId = dino.currentRunId) {
  if (!Casino?.token || !runId) return;
  try {
    await supabaseClient.rpc('dinosaur_finish', {
      p_token: Casino.token,
      p_run_id: runId,
      p_reason: reason
    });
  } catch (error) { console.debug('Dinosaur finish:', error); }
}

async function dinosaurStart() {
  if (dino.running || dino.busy) return;
  if (dinoBalance() >= DINO_LIMIT) {
    dinoSetMessage('Necesitas tener menos de 30 FP para jugar.', 'cap');
    return;
  }
  dino.busy = true;
  dq('dino-start').disabled = true;
  dq('dino-replay').classList.add('hidden');
  dq('dino-overlay').classList.remove('show');
  dinoSetMessage('Preparando la carrera…', 'working');

  const { data, error } = await supabaseClient.rpc('dinosaur_start', { p_token: Casino.token });
  dino.busy = false;
  if (error) {
    console.error(error);
    dq('dino-start').disabled = false;
    dq('dino-start').classList.remove('hidden');
    dq('dino-replay').classList.add('hidden');
    dq('dino-overlay-title').textContent = 'No se pudo iniciar';
    dq('dino-overlay-text').textContent = error.message || 'No se ha podido iniciar la carrera.';
    dq('dino-overlay').classList.add('show');
    dinoSetMessage(error.message || 'No se ha podido iniciar la carrera.', 'lose');
    return;
  }

  dino.currentRunId = data.run_id;
  dinoResetLocal(Number(data.collected || 0));
  dino.runCoins = Number(data.collected || 0);
  dino.serverCollected = Number(data.collected || 0);
  if (typeof data.coins !== 'undefined') Casino.setBalance(data.coins);
  dino.running = true; dino.crashed = false; dino.lastTime = 0;
  dino.bestDistance = Number(localStorage.getItem('dino_best_distance') || 0);
  dq('dino-start').classList.add('hidden');
  dinoSetMessage('¡Corre! Salta los obstáculos y atrapa las monedas.', 'win');
  dinoSound('jump');
  dino.raf = requestAnimationFrame(dinoLoop);
}

function dinosaurReplay() {
  if (dinoBalance() >= DINO_LIMIT) {
    dinoUpdateStatus();
    return;
  }
  dinoResetLocal(0);
  dino.currentRunId = null;
  dq('dino-overlay').classList.remove('show');
  dq('dino-replay').classList.add('hidden');
  dq('dino-start').classList.remove('hidden');
  dq('dino-start').disabled = false;
  dinoSetMessage('Nueva carrera preparada.', 'working');
  dinoUpdateStatus();
  dinoDrawFrame(0);
}

async function refreshDinosaurStatus() {
  if (!Casino?.token) return;
  const { data, error } = await supabaseClient.rpc('dinosaur_get_active', { p_token: Casino.token });
  if (error) {
    console.error(error);
    dinoSetMessage('No se ha podido comprobar la disponibilidad del juego.', 'lose');
    return;
  }
  if (data) {
    if (!dino.running && !dino.crashed) {
      dino.currentRunId = data.run_id;
      dino.serverCollected = Number(data.collected || 0);
      dino.runCoins = Number(data.collected || 0);
      dinoUpdateStatus();
      dinoSetMessage(`Partida recuperada · ${dino.runCoins} FP recuperados en esta sesión. Pulsa iniciar para continuar.`, 'working');
    }
  }
  dinoUpdateStatus();
  dinoDrawFrame(0);
}

function stopDinosaurio(reason = 'finished') {
  const runId = dino.currentRunId;
  if (dino.running && runId) dino.claimQueue.then(() => dinoFinishServer(reason, runId));
  dino.running = false;
  dino.busy = false;
  cancelAnimationFrame(dino.raf);
  dino.raf = 0;
  if (dino.crashTimeout) clearTimeout(dino.crashTimeout);
  dino.crashTimeout = 0;
  dino.currentRunId = null;
  dino.crashed = false;
  dino.runCoins = 0;
  dino.serverCollected = 0;
  dino.runTarget = 0;
  dino.pendingClaims = 0;
  dinoResetLocal(0);
  if (dq('dino-start') && dq('dino-overlay')) {
    dq('dino-start').classList.remove('hidden');
    dq('dino-replay').classList.add('hidden');
    dq('dino-overlay-title').textContent = 'Carrera preparada';
    dq('dino-overlay-text').textContent = 'Cuando tengas menos de 30 FP puedes correr gratis para recuperar puntos.';
    dq('dino-overlay').classList.add('show');
    dinoUpdateStatus();
  }
}

function initDinosaurio() {
  if (dino.initialized) {
    dinoUpdateStatus();
    dinoDrawFrame(0);
    return;
  }
  if (!dq('t-dinosaur')) return;
  dino.initialized = true;
  dinoInitScene();
  dinoResizeCanvas();
  dino.bestDistance = Number(localStorage.getItem('dino_best_distance') || 0);
  dq('dino-start').addEventListener('click', dinosaurStart);
  dq('dino-replay').addEventListener('click', dinosaurReplay);
  dq('dino-jump').addEventListener('click', dinoJump);
  dq('dino-canvas').addEventListener('pointerdown', event => {
    if (!dinoActiveTab()) return;
    event.preventDefault();
    dinoJump();
  });
  window.addEventListener('keydown', event => {
    if (!dinoActiveTab()) return;
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      event.preventDefault(); dinoJump();
    }
  }, { passive:false });
  window.addEventListener('resize', dinoResizeCanvas);
  dinoResetLocal(0);
  dinoSetMessage('Tu saldo determina cuántos FP puedes recuperar.');
  dinoUpdateStatus();
  dinoDrawFrame(0);
}

window.initDinosaurio = initDinosaurio;
window.refreshDinosaurStatus = refreshDinosaurStatus;
window.stopDinosaurio = stopDinosaurio;
