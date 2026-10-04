// ============================================================
// RULETA DE LA FORTUNA — una tirada cada hora
// El servidor decide el premio. Este archivo solo dibuja/ANIMA.
// ============================================================

const FORTUNE_REWARDS = [
  { code: 'cr5',  label: '+5 FP',   kind: 'cr',  amount: 5,  className: 'cr' },
  { code: 'cr10', label: '+10 FP',  kind: 'cr',  amount: 10, className: 'cr' },
  { code: 'cr15', label: '+15 FP',  kind: 'cr',  amount: 15, className: 'cr' },
  { code: 'cr20', label: '+20 FP',  kind: 'cr',  amount: 20, className: 'cr' },
  { code: 'cr50', label: '+50 FP',  kind: 'cr',  amount: 50, className: 'jackpot' },
  { code: 'xp20', label: '+20 XP',  kind: 'xp',  amount: 20, className: 'xp' },
  { code: 'xp50', label: '+50 XP',  kind: 'xp',  amount: 50, className: 'xp-big' }
];

// Solo representa posibilidades visuales. Las probabilidades reales están en SQL.
const FORTUNE_WHEEL = [
  'cr5', 'cr5', 'cr10', 'xp20',
  'cr5', 'cr15', 'xp50', 'cr5',
  'cr20', 'cr10', 'cr5', 'cr50',
  'xp20', 'cr15', 'cr5', 'xp50'
];

let fortuneReady = false;
let fortuneStatus = null;
let fortuneBusy = false;
let fortuneTimer = null;
let fortuneWheelAngle = 0;
let fortuneLastSegment = -1;
let fortuneAudio = null;
let fortuneTargetFrame = null;

function fortuneReward(code) {
  return FORTUNE_REWARDS.find(item => item.code === code) || FORTUNE_REWARDS[0];
}

function fortuneFormatTime(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
}

function fortuneAudioCtx() {
  try {
    fortuneAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (fortuneAudio.state === 'suspended') fortuneAudio.resume();
    return fortuneAudio;
  } catch (_) {
    return null;
  }
}

function fortuneTone(freq, duration, type = 'sine', volume = 0.05, delay = 0) {
  const ctx = fortuneAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function fortuneTick(strong = false) {
  fortuneTone(strong ? 920 : 620, strong ? 0.075 : 0.04, 'triangle', strong ? 0.075 : 0.035);
}

function fortuneWinSound() {
  [523, 659, 784, 1047].forEach((freq, index) => {
    fortuneTone(freq, 0.14, 'sine', 0.055, index * 0.09);
  });
}

function drawFortuneWheel() {
  const canvas = document.querySelector('#fortune-wheel');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = canvas.width;
  const center = size / 2;
  const radius = center - 18;
  const count = FORTUNE_WHEEL.length;
  const step = Math.PI * 2 / count;
  const palette = ['#2a855e', '#b5832d', '#7e2637', '#245477'];

  ctx.clearRect(0, 0, size, size);

  // Sombra exterior.
  ctx.beginPath();
  ctx.arc(center, center, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = '#061a12';
  ctx.fill();

  for (let index = 0; index < count; index += 1) {
    const start = -Math.PI / 2 + index * step;
    const end = start + step;
    const reward = fortuneReward(FORTUNE_WHEEL[index]);

    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = palette[index % palette.length];
    ctx.fill();
    ctx.strokeStyle = '#f5d98166';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Etiqueta compacta y centrada: dos líneas para que nunca se salga del sector.
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(start + step / 2);
    ctx.translate(radius * 0.55, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4c9';
    ctx.shadowColor = '#000d';
    ctx.shadowBlur = 7;

    const parts = reward.label.split(' ');
    const main = parts[0] || reward.label;
    const unit = parts.slice(1).join(' ');
    ctx.font = '900 17px Georgia, serif';
    ctx.fillText(main, 0, -9);
    if (unit) {
      ctx.font = '900 13px Georgia, serif';
      ctx.fillStyle = '#f7e6b4';
      ctx.fillText(unit, 0, 9);
    }
    ctx.restore();
  }

  // Anillo exterior.
  ctx.beginPath();
  ctx.arc(center, center, radius + 1, 0, Math.PI * 2);
  ctx.strokeStyle = '#efd47b';
  ctx.lineWidth = 7;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, radius - 13, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff20';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function fortuneApplyWheelAngle(angle) {
  fortuneWheelAngle = angle;
  const canvas = document.querySelector('#fortune-wheel');
  if (canvas) canvas.style.transform = `rotate(${angle}deg)`;
}

function fortunePickTargetIndex(code) {
  const candidates = [];
  FORTUNE_WHEEL.forEach((segmentCode, index) => {
    if (segmentCode === code) candidates.push(index);
  });
  if (!candidates.length) return 0;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function fortuneEaseOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

function fortuneAnimateToReward(code) {
  const count = FORTUNE_WHEEL.length;
  const stepDeg = 360 / count;
  const targetIndex = fortunePickTargetIndex(code);
  const targetNormalized = (-(targetIndex + 0.5) * stepDeg + 360) % 360;
  const start = fortuneWheelAngle;
  const remainder = ((targetNormalized - (start % 360)) + 360) % 360;
  const end = start + (6 * 360) + remainder;
  const duration = 7200;
  const startTime = performance.now();
  fortuneLastSegment = Math.floor((((start % 360) + 360) % 360) / stepDeg);

  return new Promise(resolve => {
    const frame = now => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = fortuneEaseOutQuint(progress);
      const current = start + (end - start) * eased;
      fortuneApplyWheelAngle(current);

      const normalized = ((current % 360) + 360) % 360;
      const segment = Math.floor(normalized / stepDeg);
      if (segment !== fortuneLastSegment) {
        const nearEnd = progress > 0.8;
        fortuneTick(nearEnd);
        fortuneLastSegment = segment;
      }

      if (progress > 0.72 && !document.querySelector('#fortune-wheel-wrap')?.classList.contains('slowdown')) {
        document.querySelector('#fortune-wheel-wrap')?.classList.add('slowdown');
      }

      if (progress < 1) {
        fortuneTargetFrame = requestAnimationFrame(frame);
      } else {
        fortuneTargetFrame = null;
        fortuneApplyWheelAngle(end);
        document.querySelector('#fortune-wheel-wrap')?.classList.remove('slowdown');
        resolve();
      }
    };

    fortuneTargetFrame = requestAnimationFrame(frame);
  });
}

function fortuneConfetti() {
  const wrap = document.querySelector('#fortune-wheel-wrap');
  if (!wrap) return;
  const colors = ['#f7da76', '#fff4ce', '#74d7a5', '#7fc6f7', '#f5a5bc'];
  for (let i = 0; i < 26; i += 1) {
    const piece = document.createElement('i');
    piece.className = 'fortune-confetti';
    piece.style.left = `${50 + (Math.random() - 0.5) * 20}%`;
    piece.style.top = `${50 + (Math.random() - 0.5) * 10}%`;
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 420}px`);
    piece.style.setProperty('--dy', `${120 + Math.random() * 260}px`);
    piece.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.18}s`;
    wrap.appendChild(piece);
    setTimeout(() => piece.remove(), 1500);
  }
}

function fortuneResult(data) {
  const box = document.querySelector('#fortune-result');
  const last = document.querySelector('#fortune-last-result');
  if (!box) return;

  const rewardKind = data.reward_type === 'xp' ? 'xp' : 'cr';
  const amount = rewardKind === 'xp' ? Number(data.reward_xp || 0) : Number(data.reward_cr || 0);
  const label = rewardKind === 'xp' ? `+${amount} XP` : `+${amount} FP`;

  box.classList.remove('win-cr', 'win-xp', 'jackpot');
  box.classList.add(rewardKind === 'xp' ? 'win-xp' : 'win-cr');
  if (amount >= 50 && rewardKind === 'cr') box.classList.add('jackpot');
  box.querySelector('span').textContent = amount >= 50 && rewardKind === 'cr' ? '¡JACKPOT DE SUERTE!' : 'RECOMPENSA';
  box.querySelector('strong').textContent = label;
  if (last) last.textContent = data.reward_label || 'Premio recibido.';
}

function fortuneUpdateTimer() {
  const countdown = document.querySelector('#fortune-countdown');
  const label = document.querySelector('#fortune-cooldown-label');
  const button = document.querySelector('#fortune-spin');
  const card = document.querySelector('#fortune-timer-card');
  if (!countdown || !label || !button) return;

  if (!fortuneStatus) {
    countdown.textContent = '--:--:--';
    label.textContent = 'Comprobando disponibilidad…';
    button.disabled = true;
    return;
  }

  const nextTime = fortuneStatus.next_spin_at ? new Date(fortuneStatus.next_spin_at).getTime() : 0;
  const remaining = Math.max(0, Math.ceil((nextTime - Date.now()) / 1000));
  const canSpin = remaining <= 0;

  countdown.textContent = canSpin ? 'LISTA' : fortuneFormatTime(remaining);
  label.textContent = canSpin ? 'Tu tirada está disponible' : 'Puedes volver a tirar cuando llegue a cero';
  card?.classList.toggle('ready', canSpin);
  button.disabled = !canSpin || fortuneBusy;
}

async function refreshFortuneStatus() {
  if (!Casino.token) return;

  const { data, error } = await supabaseClient.rpc('fortune_status', {
    p_token: Casino.token
  });

  if (error) {
    console.error('[FORTUNE] Status:', error);
    const label = document.querySelector('#fortune-cooldown-label');
    if (label) label.textContent = 'No se ha podido comprobar la ruleta.';
    return;
  }

  fortuneStatus = data || null;
  fortuneUpdateTimer();

  if (data?.last_reward_label) {
    const last = document.querySelector('#fortune-last-result');
    if (last && !last.textContent.trim()) last.textContent = `Última: ${data.last_reward_label}`;
  }
}

async function spinFortune() {
  if (fortuneBusy || !Casino.token) return;
  fortuneBusy = true;
  fortuneUpdateTimer();

  const button = document.querySelector('#fortune-spin');
  const wrap = document.querySelector('#fortune-wheel-wrap');
  const box = document.querySelector('#fortune-result');
  if (button) button.textContent = 'LA RUEDA ESTÁ GIRANDO…';
  if (box) box.classList.remove('win-cr', 'win-xp', 'jackpot');
  wrap?.classList.add('spinning');
  fortuneTone(440, 0.12, 'triangle', 0.06);

  const { data, error } = await supabaseClient.rpc('fortune_spin', {
    p_token: Casino.token
  });

  if (error || !data) {
    console.error('[FORTUNE] Spin:', error);
    Casino.toast(error?.message || 'No se ha podido hacer la tirada.');
    fortuneBusy = false;
    wrap?.classList.remove('spinning', 'slowdown');
    if (button) button.textContent = 'GIRAR LA RULETA';
    await refreshFortuneStatus();
    fortuneUpdateTimer();
    return;
  }

  await fortuneAnimateToReward(data.reward_code);
  fortuneResult(data);
  fortuneConfetti();
  fortuneWinSound();

  if (typeof data.coins !== 'undefined') {
    Casino.balance = Number(data.coins) || 0;
    if (Casino.profile) {
      Casino.profile.coins = Casino.balance;
      Casino.profile.xp = Number(data.xp || Casino.profile.xp || 0);
      Casino.profile.level = Number(data.level || Casino.profile.level || 1);
    }
    Casino.render();
    Casino.dock();
  }

  fortuneStatus = {
    ...(fortuneStatus || {}),
    next_spin_at: data.next_spin_at,
    last_reward_label: data.reward_label,
    last_reward_code: data.reward_code
  };

  fortuneBusy = false;
  wrap?.classList.remove('spinning');
  if (button) button.textContent = 'GIRAR LA RULETA';
  fortuneUpdateTimer();

  if (typeof Casino.renderHistory === 'function') Casino.renderHistory();
  if (typeof window.refreshSidebar === 'function') window.refreshSidebar();
}

async function initFortune() {
  if (!Casino.user || !Casino.token) return;
  if (!fortuneReady) {
    drawFortuneWheel();
    document.querySelector('#fortune-spin')?.addEventListener('click', spinFortune);
    fortuneReady = true;
    if (!document.hidden) {
      const section = document.querySelector('#t-fortune');
      if (section && !section.classList.contains('hidden')) startFortuneTimer();
    }
  }
  await refreshFortuneStatus();
}

function startFortuneTimer() {
  if (fortuneTimer || document.hidden) return;
  const section = document.querySelector('#t-fortune');
  if (!section || section.classList.contains('hidden')) return;
  fortuneTimer = setInterval(fortuneUpdateTimer, 1000);
}

function stopFortuneTimer() {
  clearInterval(fortuneTimer);
  fortuneTimer = null;
}

window.startFortuneTimer = startFortuneTimer;
window.stopFortuneTimer = stopFortuneTimer;

function stopFortune() {
  if (fortuneTargetFrame) cancelAnimationFrame(fortuneTargetFrame);
  fortuneTargetFrame = null;
  clearInterval(fortuneTimer);
  fortuneTimer = null;
  fortuneBusy = false;
  fortuneStatus = null;
  fortuneReady = false;
  fortuneWheelAngle = 0;
  const canvas = document.querySelector('#fortune-wheel');
  if (canvas) canvas.style.transform = 'rotate(0deg)';
}

window.initFortune = initFortune;
window.stopFortune = stopFortune;
window.refreshFortuneStatus = refreshFortuneStatus;
window.fortuneUpdateTimer = fortuneUpdateTimer;
