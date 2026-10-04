// ============================================================
// JUEGOS
//
// IMPORTANTE:
// Los resultados y las monedas se resuelven mediante funciones SQL
// de Supabase. El navegador solo muestra la animación/interfaz.
// ============================================================

// ---------- Cartas ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let audioContext = null;
function playCardSound(kind = 'deal') {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    const config = {
      deal: [440, 0.055, 'triangle'],
      hit: [520, 0.06, 'triangle'],
      flip: [660, 0.07, 'sine'],
      win: [880, 0.16, 'triangle'],
      lose: [180, 0.2, 'sawtooth'],
      cash: [740, 0.12, 'sine'],
      shuffle: [320, 0.09, 'triangle']
    }[kind] || [440, 0.05, 'triangle'];
    osc.type = config[2];
    osc.frequency.setValueAtTime(config[0], now);
    osc.frequency.exponentialRampToValueAtTime(config[0] * (kind === 'lose' ? .68 : 1.18), now + config[1]);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'win' ? 0.12 : 0.065, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config[1]);
    osc.start(now);
    osc.stop(now + config[1] + 0.02);
  } catch (_) {}
}

function cardEl(card, hidden = false, i = 0) {
  const element = document.createElement('div');
  element.className = 'card' + (hidden ? ' back' : '') + ('♥♦'.includes(card.s) ? ' red' : '');
  element.style.setProperty('--deal-delay', `${i * 0.14}s`);

  if (!hidden) {
    element.innerHTML = `
      <span class="card-corner card-corner-top"><b>${RANKS[card.r]}</b><i>${card.s}</i></span>
      <strong class="card-suit-center">${card.s}</strong>
      <span class="card-corner card-corner-bottom"><b>${RANKS[card.r]}</b><i>${card.s}</i></span>`;
  }

  return element;
}


function animateDeckPulse(selector) {
  const deck = document.querySelector(selector);
  if (!deck) return;
  deck.classList.remove('deal-flash');
  void deck.offsetWidth;
  deck.classList.add('deal-flash');
}

async function animateDealToHand(container, card, hidden = false, sound = 'deal') {
  const element = cardEl(card, hidden);
  element.classList.add('bj-deal-card');
  container.appendChild(element);
  // Reflow para garantizar que la animación se dispara siempre, incluso en navegadores que reutilizan estilos.
  void element.offsetWidth;
  element.classList.add('bj-deal-active');
  playCardSound(sound);
  await wait(360);
  return element;
}

const ghost = amount => Array.from(
  { length: amount },
  () => Object.assign(document.createElement('div'), { className: 'card ghost' })
);

// ============================================================
// RULETA
// ============================================================

const ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const SEG = Math.PI * 2 / 37;
const colorOf = number => number === 0 ? '#14864f' : RED.includes(number) ? '#c42b3f' : '#111';

const BETS = {};
const placed = {};
let lastRouletteBet = {};
let spinning = false;

window.onTable = () => Object.values(placed).reduce((sum, amount) => sum + amount, 0);

(function buildRouletteTable() {
  const table = $('#table');

  const add = (key, label, test, multiplier, className, position) => {
    const element = document.createElement('div');
    element.className = `cell ${className}`;
    element.dataset.k = key;
    element.style.cssText = position;
    element.innerHTML = label;

    BETS[key] = { test, multiplier };
    element.onclick = () => placeRouletteChip(key, element);
    table.append(element);
  };

  add('n0', '0', number => number === 0, 36, 'g', 'grid-row:1/4;grid-column:1');

  for (let column = 0; column < 12; column++) {
    for (let row = 0; row < 3; row++) {
      const number = column * 3 + 3 - row;
      add(
        `n${number}`,
        number,
        result => result === number,
        36,
        RED.includes(number) ? 'r' : 'b',
        `grid-row:${row + 1};grid-column:${column + 2}`
      );
    }
  }

  for (let row = 0; row < 3; row++) {
    add(
      `c${row}`,
      '2 to 1',
      number => number > 0 && number % 3 === (3 - row) % 3,
      3,
      'o vert',
      `grid-row:${row + 1};grid-column:14`
    );
  }


  [['1ª 12', 1, 12], ['2ª 12', 13, 24], ['3ª 12', 25, 36]].forEach(([label, low, high], index) => {
    add(
      `d${index}`,
      label,
      number => number >= low && number <= high,
      3,
      'o',
      `grid-row:4;grid-column:${2 + index * 4}/span 4`
    );
  });

  const outside = [
    ['o1-18', number => number >= 1 && number <= 18, '1-18'],
    ['oPAR', number => number > 0 && number % 2 === 0, 'PAR'],
    ['ored', number => RED.includes(number), '<div class="diam red-diam"></div>'],
    ['oblack', number => number > 0 && !RED.includes(number), '<div class="diam black-diam"></div>'],
    ['oIMPAR', number => number % 2 === 1, 'IMPAR'],
    ['o19-36', number => number >= 19, '19-36']
  ];

  outside.forEach(([key, test, label], index) => {
    add(key, label, test, 2, 'o', `grid-row:5;grid-column:${2 + index * 2}/span 2`);
  });
})();

function placeRouletteChip(key, element) {
  if (spinning) return;

  // En la ruleta real no se permite cubrir rojo y negro en la misma tirada.
  if (key === 'ored' && (placed.oblack || 0) > 0) {
    Casino.toast('No puedes apostar al rojo y al negro a la vez.');
    return;
  }
  if (key === 'oblack' && (placed.ored || 0) > 0) {
    Casino.toast('No puedes apostar al rojo y al negro a la vez.');
    return;
  }

  const value = Number(Casino.chip);
  const totalAfter = window.onTable() + value;

  // En esta versión la mesa no descuenta todavía las monedas.
  // El servidor las descuenta de forma atómica al pulsar GIRAR.
  if (totalAfter > Casino.coins()) {
    Casino.toast('No puedes poner más fichas de las monedas que tienes.');
    return;
  }

  placed[key] = (placed[key] || 0) + value;

  let badge = element.querySelector('.st');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'st';
    element.append(badge);
  }

  badge.textContent = placed[key];
  $('#rsel').textContent = 'Fichas puestas. ¡Pulsa Girar!';
  Casino.dock();
}

function refreshRouletteRepeatButton() {
  const button = $('#rrepeat');
  if (!button) return;
  button.disabled = spinning || Object.keys(lastRouletteBet).length === 0;
}

function repeatRouletteBet() {
  if (spinning) return;

  const entries = Object.entries(lastRouletteBet);
  if (!entries.length) {
    Casino.toast('Todavía no tienes una apuesta anterior para repetir.');
    return;
  }

  if (window.onTable() > 0) {
    Casino.toast('Quita primero las fichas actuales para repetir la apuesta anterior.');
    return;
  }

  const total = entries.reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
  if (total > Casino.coins()) {
    Casino.toast(`Necesitas ${total} FP para repetir esta apuesta.`);
    return;
  }

  for (const [key, amount] of entries) {
    const cell = $(`#table [data-k="${key}"]`);
    if (!cell) continue;
    placed[key] = Number(amount);

    let badge = cell.querySelector('.st');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'st';
      cell.append(badge);
    }
    badge.textContent = placed[key];
  }

  $('#rsel').textContent = `Apuesta repetida · ${total} FP. ¡Pulsa Girar!`;
  Casino.dock();
}

$('#rrepeat').onclick = repeatRouletteBet;
function clearRouletteTable() {
  for (const key in placed) delete placed[key];
  document.querySelectorAll('#table .st').forEach(element => element.remove());
  document.querySelectorAll('#table .hit').forEach(element => element.classList.remove('hit'));
  Casino.dock();
  refreshRouletteRepeatButton();
}

$('#rclr').onclick = () => {
  if (!spinning) clearRouletteTable();
};

// ---------- Rueda ----------
const canvas = $('#wheel');
const context = canvas.getContext('2d');
const wheel = { angle: 0, ball: 0, ballRadius: 121, spin: null, lastBallPocket: null, lastBallTickAt: 0 };
const pointOnWheel = (radius, angle) => [160 + radius * Math.sin(angle), 160 - radius * Math.cos(angle)];

function drawWheel() {
  const { angle } = wheel;
  context.clearRect(0, 0, 320, 320);

  const rim = context.createRadialGradient(160, 160, 120, 160, 160, 158);
  rim.addColorStop(0, '#5a3a18');
  rim.addColorStop(.7, '#8a5a2b');
  rim.addColorStop(1, '#3b2410');
  context.fillStyle = rim;
  context.beginPath();
  context.arc(160, 160, 158, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#e0b457';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(160, 160, 148, 0, Math.PI * 2);
  context.stroke();

  ORDER.forEach((number, index) => {
    const start = angle + index * SEG - Math.PI / 2;
    const end = start + SEG;

    context.beginPath();
    context.arc(160, 160, 142, start, end);
    context.arc(160, 160, 102, end, start, true);
    context.closePath();
    context.fillStyle = colorOf(number);
    context.fill();
    context.strokeStyle = '#e0b457';
    context.lineWidth = 1;
    context.stroke();

    const [x, y] = pointOnWheel(131, angle + (index + .5) * SEG);
    context.save();
    context.translate(x, y);
    context.rotate(angle + (index + .5) * SEG);
    context.fillStyle = '#fff';
    context.font = 'bold 12px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(number, 0, 0);
    context.restore();
  });

  const center = context.createRadialGradient(160, 160, 5, 160, 160, 100);
  center.addColorStop(0, '#f0cc78');
  center.addColorStop(.5, '#a8772a');
  center.addColorStop(1, '#4a2f12');
  context.fillStyle = center;
  context.beginPath();
  context.arc(160, 160, 100, 0, Math.PI * 2);
  context.fill();

  for (let k = 0; k < 4; k++) {
    const [x, y] = pointOnWheel(70, angle + k * Math.PI / 2);
    const [x2, y2] = pointOnWheel(16, angle + k * Math.PI / 2);
    context.strokeStyle = '#f0cc78';
    context.lineWidth = 6;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x, y);
    context.stroke();
  }

  context.fillStyle = '#e0b457';
  context.beginPath();
  context.arc(160, 160, 14, 0, Math.PI * 2);
  context.fill();

  const [ballX, ballY] = pointOnWheel(wheel.ballRadius, angle + wheel.ball);
  context.fillStyle = '#0004';
  context.beginPath();
  context.arc(ballX + 2, ballY + 3, 7, 0, Math.PI * 2);
  context.fill();

  const ball = context.createRadialGradient(ballX - 2, ballY - 2, 1, ballX, ballY, 7);
  ball.addColorStop(0, '#fff');
  ball.addColorStop(1, '#b8b8b8');
  context.fillStyle = ball;
  context.beginPath();
  context.arc(ballX, ballY, 6.5, 0, Math.PI * 2);
  context.fill();
}

const ease = value => 1 - Math.pow(1 - value, 3);

function playRouletteTick(strength = 1) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500 + strength * 180, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.028);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035 * strength, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.052);
  } catch (_) {}
}

function playRouletteFinishSound() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    [880, 1174, 1568].forEach((frequency, index) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now + index * 0.07);
      gain.gain.setValueAtTime(0.0001, now + index * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.08, now + index * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.18);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + index * 0.07);
      osc.stop(now + index * 0.07 + 0.2);
    });
  } catch (_) {}
}

let rouletteAnimationFrame = null;
let rouletteLastFrameTime = null;

function rouletteTabVisible() {
  const section = $('#t-roulette');
  return !!section && !section.classList.contains('hidden');
}

function rouletteAnimationLoop(now) {
  rouletteAnimationFrame = null;
  const currentSpin = wheel.spin;
  const visible = rouletteTabVisible() && !document.hidden;

  // Si no estamos viendo la ruleta y no hay una tirada activa, no consumimos
  // frames continuamente. Al volver a la pestaña se reanuda al instante.
  if (!visible && !currentSpin) {
    rouletteLastFrameTime = null;
    return;
  }

  const previous = rouletteLastFrameTime ?? now;
  const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
  rouletteLastFrameTime = now;

  if (!currentSpin) {
    // 0.004 rad/frame a 60 FPS ~= 0.24 rad/s. Conservamos la velocidad usando delta-time.
    wheel.angle += 0.24 * dt;
  } else {
    const progress = Math.min(1, (now - currentSpin.startedAt) / currentSpin.duration);
    const eased = ease(progress);
    wheel.angle = currentSpin.startAngle + currentSpin.turns * eased;
    wheel.ball = currentSpin.pocket - (1 - ease(Math.min(1, progress * 1.1))) * currentSpin.laps;

    const endPhase = Math.max(0, (progress - .72) / .28);
    wheel.ballRadius = 121 + 21 * (1 - endPhase) + Math.abs(Math.sin(endPhase * 14)) * 9 * (1 - endPhase);

    const normalizedBall = ((wheel.ball % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const ballPocket = Math.floor(normalizedBall / SEG);
    if (ballPocket !== wheel.lastBallPocket && now - wheel.lastBallTickAt > 55) {
      const strength = progress > .72 ? 1.25 : progress > .45 ? 1.0 : 0.72;
      playRouletteTick(strength);
      wheel.lastBallPocket = ballPocket;
      wheel.lastBallTickAt = now;
    }

    if (progress >= 1) {
      currentSpin.done();
      wheel.spin = null;
    }
  }

  if (visible) drawWheel();

  // En segundo plano solo mantenemos viva una tirada activa a baja frecuencia;
  // en primer plano usamos RAF completo para que la ruleta siga suave.
  if (currentSpin && !visible) {
    rouletteAnimationFrame = window.setTimeout(() => requestAnimationFrame(rouletteAnimationLoop), 66);
  } else {
    rouletteAnimationFrame = requestAnimationFrame(rouletteAnimationLoop);
  }
}

function startRouletteAnimation() {
  if (rouletteAnimationFrame) return;
  rouletteLastFrameTime = null;
  rouletteAnimationFrame = requestAnimationFrame(rouletteAnimationLoop);
}

function stopRouletteAnimation() {
  // Una tirada activa debe poder terminar aunque el usuario cambie de pestaña.
  // En ese caso el loop pasa automáticamente a baja frecuencia.
  if (wheel.spin) return;
  if (typeof rouletteAnimationFrame === 'number') {
    cancelAnimationFrame(rouletteAnimationFrame);
    clearTimeout(rouletteAnimationFrame);
  }
  rouletteAnimationFrame = null;
  rouletteLastFrameTime = null;
}

window.startRouletteAnimation = startRouletteAnimation;
window.stopRouletteAnimation = stopRouletteAnimation;

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !wheel.spin) stopRouletteAnimation();
  else startRouletteAnimation();
});

startRouletteAnimation();

let rouletteHistory = [];

function paintRouletteHistory() {
  $('#rhist').innerHTML = rouletteHistory
    .slice(0, 10)
    .map(number => `<i style="background:${colorOf(number)}">${number}</i>`)
    .join('');
}

window.loadRouletteHistory = async function loadRouletteHistory() {
  if (!Casino.token) return;

  const { data, error } = await supabaseClient.rpc('get_roulette_history', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    return;
  }

  rouletteHistory = Array.isArray(data) ? data.map(Number) : [];
  paintRouletteHistory();
};

paintRouletteHistory();
refreshRouletteRepeatButton();

$('#spin').onclick = async () => {
  if (spinning) return;

  const stake = window.onTable();
  if (!stake) {
    Casino.toast('Pon fichas en la mesa primero.');
    return;
  }

  spinning = true;
  $('#spin').disabled = true;
  $('#rclr').disabled = true;
  document.querySelectorAll('#table .hit').forEach(element => element.classList.remove('hit'));
  $('#rres').textContent = '…';
  $('#rres').style.background = '#222';
  $('#rsel').textContent = '¡No va más!';

  // Iniciamos el contexto de audio durante el gesto del usuario para
  // que los ticks de la bola puedan sonar también después de la petición RPC.
  playCardSound('shuffle');

  const { data, error } = await supabaseClient.rpc('play_roulette', {
    p_token: Casino.token,
    p_bets: placed
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    spinning = false;
    $('#spin').disabled = false;
    $('#rclr').disabled = false;
    await Casino.loadProfile();
    refreshRouletteRepeatButton();
    return;
  }

  const number = Number(data.number);
  const pocketIndex = ORDER.indexOf(number);
  lastRouletteBet = Object.fromEntries(
    Object.entries(placed).map(([key, amount]) => [key, Number(amount)])
  );
  refreshRouletteRepeatButton();

  wheel.lastBallPocket = null;
  wheel.lastBallTickAt = 0;

  await new Promise(done => {
    wheel.spin = {
      startedAt: performance.now(),
      duration: 5600,
      startAngle: wheel.angle,
      turns: Math.PI * 2 * 3,
      laps: Math.PI * 2 * 7,
      pocket: (pocketIndex + .5) * SEG,
      done
    };
  });

  wheel.ball = (pocketIndex + .5) * SEG;
  wheel.ballRadius = 121;
  playRouletteFinishSound();

  // El historial de números se guarda y recupera desde Supabase.
  await window.loadRouletteHistory();

  const result = $('#rres');
  result.textContent = number;
  result.style.background = colorOf(number);
  result.classList.remove('pop');
  void result.offsetWidth;
  result.classList.add('pop');

  const winningCell = $(`#t-roulette [data-k="n${number}"]`);
  if (winningCell) winningCell.classList.add('hit');

  const count = Object.keys(placed).length;
  clearRouletteTable();
  $('#rsel').textContent = `Salió el ${number}. Toca la mesa para apostar otra vez.`;

  Casino.showGameResult(data, 'Ruleta');

  spinning = false;
  $('#spin').disabled = false;
  $('#rclr').disabled = false;
  refreshRouletteRepeatButton();
};

// ============================================================
// BLACKJACK
// ============================================================

const blackjack = {
  player: [],
  dealer: [],
  bet: 0,
  live: false,
  mode: 'normal',
  hands: [],
  activeHand: 0
};

function blackjackActiveHand() {
  return blackjack.hands[blackjack.activeHand] || [];
}

function blackjackCardValue(card) {
  if (!card) return 0;
  if (card.r === 12) return 11;
  if (card.r >= 8) return 10;
  return card.r + 2;
}

function blackjackCanSplit() {
  return blackjack.mode === 'normal'
    && blackjack.live
    && blackjack.player.length === 2
    && blackjackCardValue(blackjack.player[0]) === blackjackCardValue(blackjack.player[1])
    && Number(blackjack.bet) > 0
    && Casino.coins() >= Number(blackjack.bet);
}

function blackjackUpdateBetDisplay() {
  const box = $('#bj-bet-amount');
  if (!box) return;
  const value = blackjack.live ? Number(blackjack.bet) : Number(Casino.stake || 0);
  box.textContent = `${Number.isFinite(value) ? value : 0} FP`;
}

function blackjackRender(revealDealer = false) {
  const idle = blackjack.player.length === 0 && blackjack.hands.length === 0;
  const dealer = idle
    ? ghost(2)
    : blackjack.dealer.map((card, index) => cardEl(card, !revealDealer && index === 1, index + 1));

  const dealerBox = $('#bj-dealer');
  const playerBox = $('#bj-player');
  dealerBox.replaceChildren(...dealer);

  if (blackjack.mode === 'split' && blackjack.hands.length === 2) {
    const wrap = document.createElement('div');
    wrap.className = 'bj-split-wrap';

    blackjack.hands.forEach((hand, handIndex) => {
      const section = document.createElement('div');
      section.className = `bj-split-hand ${handIndex === blackjack.activeHand && blackjack.live ? 'active' : ''}`;
      section.innerHTML = `
        <div class="bj-split-title">MANO ${handIndex + 1}<b>${blackjackValueLocal(hand)}${handIndex === blackjack.activeHand && blackjack.live ? ' · TU TURNO' : ''}</b></div>
      `;
      const handBox = document.createElement('div');
      handBox.className = 'hand bj-hand bj-inner-hand';
      handBox.append(...hand.map((card, index) => cardEl(card, false, index)));
      section.appendChild(handBox);
      wrap.appendChild(section);
    });

    playerBox.replaceChildren(wrap);
    $('#bj-p').textContent = `${blackjackValueLocal(blackjack.hands[0])} / ${blackjackValueLocal(blackjack.hands[1])}`;
  } else {
    const player = idle ? ghost(2) : blackjack.player.map((card, index) => cardEl(card, false, index));
    playerBox.replaceChildren(...player);
    $('#bj-p').textContent = idle ? '–' : blackjackValueLocal(blackjack.player);
  }

  $('#bj-d').textContent = idle ? '–' : revealDealer ? blackjackValueLocal(blackjack.dealer) : '?';
  $('#bj-deal').disabled = blackjack.live;
  $('#bj-hit').disabled = !blackjack.live;
  $('#bj-stand').disabled = !blackjack.live;
  $('#bj-double').disabled = !(
    blackjack.mode === 'normal' &&
    blackjack.live &&
    blackjack.player.length === 2 &&
    Casino.coins() >= Number(blackjack.bet || 0)
  );
  $('#bj-split').disabled = !blackjackCanSplit();
  blackjackUpdateBetDisplay();
}

async function blackjackDealAnimation(revealDealer = false) {
  const dealerBox = $('#bj-dealer');
  const playerBox = $('#bj-player');
  dealerBox.replaceChildren();
  playerBox.replaceChildren();

  $('#bj-d').textContent = '?';
  $('#bj-p').textContent = '–';

  // Orden clásico: jugador, crupier, jugador, crupier.
  if (blackjack.player[0]) await animateDealToHand(playerBox, blackjack.player[0], false, 'deal');
  if (blackjack.dealer[0]) await animateDealToHand(dealerBox, blackjack.dealer[0], false, 'deal');
  if (blackjack.player[1]) await animateDealToHand(playerBox, blackjack.player[1], false, 'deal');
  if (blackjack.dealer[1]) await animateDealToHand(dealerBox, blackjack.dealer[1], !revealDealer, 'flip');

  $('#bj-p').textContent = blackjackValueLocal(blackjack.player);
  $('#bj-d').textContent = revealDealer ? blackjackValueLocal(blackjack.dealer) : '?';
}

async function blackjackAppendCard(card) {
  const element = await animateDealToHand($('#bj-player'), card, false, 'hit');
  $('#bj-p').textContent = blackjackValueLocal(blackjack.player);
  return element;
}

async function blackjackRevealDealer() {
  // Quitamos la carta oculta y la volvemos a colocar con un pequeño giro.
  const box = $('#bj-dealer');
  const cards = [...box.querySelectorAll('.card:not(.ghost)')];
  if (cards[1] && blackjack.dealer[1]) {
    const replacement = cardEl(blackjack.dealer[1], false);
    replacement.classList.add('dealer-reveal');
    cards[1].replaceWith(replacement);
    playCardSound('flip');
    await wait(420);
  }
  $('#bj-d').textContent = blackjackValueLocal(blackjack.dealer);
}

function blackjackStatus(text, type = '') {
  const box = $('#bj-status');
  if (!box) return;
  box.className = `bj-status ${type}`;
  box.innerHTML = text;
}

function blackjackValueLocal(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.r === 12) {
      total += 11;
      aces++;
    } else if (card.r >= 8) {
      total += 10;
    } else {
      total += card.r + 2;
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

async function showCardGameResult(data, game) {
  blackjack.live = false;
  Casino.showGameResult(data, game);
}

$('#bj-deal').onclick = async () => {
  const bet = Casino.bet();
  if (!bet) return;

  $('#bj-deal').disabled = true;
  $('#bj-hit').disabled = true;
  $('#bj-stand').disabled = true;
  animateDeckPulse('#bj-deck-stack');
  blackjackStatus('La baraja cobra vida… repartiendo', 'working');

  try {
    const { data, error } = await supabaseClient.rpc('blackjack_start', {
      p_token: Casino.token,
      p_bet: bet
    });

    if (error) throw error;
    if (!data || !Array.isArray(data.player) || !Array.isArray(data.dealer)) {
      throw new Error('Respuesta inesperada de Blackjack.');
    }

    Casino.clearStake();
    blackjack.bet = bet;
    blackjack.mode = 'normal';
    blackjack.hands = [];
    blackjack.activeHand = 0;
    blackjack.player = data.player || [];
    blackjack.dealer = data.dealer || [];
    blackjack.live = data.status === 'live';

    Casino.setBalance(data.coins);
    await blackjackDealAnimation(blackjack.live === false);

    blackjackStatus(
      blackjack.live ? 'Tu turno · pide carta o plántate' : 'Mano resuelta',
      blackjack.live ? '' : (Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie')
    );

    if (!blackjack.live) {
      await showCardGameResult(data, 'Blackjack');
    } else {
      blackjackRender(false);
    }
  } catch (error) {
    console.error(error);
    Casino.toast(error?.message || 'No se pudo iniciar el Blackjack.');
    blackjack.live = false;
    blackjackStatus('No se ha podido repartir. Prueba de nuevo.', 'lose');
    blackjackRender(false);
  }
};

$('#bj-hit').onclick = async () => {
  if (!blackjack.live) return;

  $('#bj-hit').disabled = true;
  playCardSound('hit');
  blackjackStatus('Nueva carta…', 'working');

  if (blackjack.mode === 'split') {
    const previousLength = blackjackActiveHand().length;
    const { data, error } = await supabaseClient.rpc('blackjack_split_hit', {
      p_token: Casino.token
    });

    if (error) {
      console.error(error);
      Casino.toast(error.message);
      $('#bj-hit').disabled = false;
      return;
    }

    blackjack.hands = data.hands || blackjack.hands;
    blackjack.dealer = data.dealer || blackjack.dealer;
    blackjack.activeHand = Number(data.active_hand || 1) - 1;
    blackjack.live = data.status !== 'finished';
    Casino.setBalance(data.coins);
    blackjackRender(false);

    if (blackjackActiveHand().length > previousLength) {
      const box = document.querySelectorAll('.bj-inner-hand')[Math.min(blackjack.activeHand, 1)];
      const last = box?.lastElementChild;
      if (last) {
        last.classList.add('bj-card-emphasis');
        setTimeout(() => last.classList.remove('bj-card-emphasis'), 650);
      }
    }

    if (!blackjack.live) {
      await wait(220);
      blackjackRender(true);
      blackjackStatus('Partida dividida resuelta', Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie');
      await showCardGameResult(data, 'Blackjack');
    } else {
      blackjackStatus(`Mano ${blackjack.activeHand + 1} · ${blackjackActiveHand().length ? blackjackValueLocal(blackjackActiveHand()) : '–'}`);
      // Si la mano sigue viva, nunca bloqueamos Pedir tras una sola carta.
      $('#bj-hit').disabled = false;
      $('#bj-stand').disabled = false;
    }
    return;
  }

  const { data, error } = await supabaseClient.rpc('blackjack_hit', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    $('#bj-hit').disabled = false;
    return;
  }

  const oldCount = blackjack.player.length;
  blackjack.player = data.player || blackjack.player;
  blackjack.dealer = data.dealer || blackjack.dealer;
  blackjack.live = data.status === 'live';

  Casino.setBalance(data.coins);
  if (blackjack.player.length > oldCount) {
    const newCard = blackjack.player[blackjack.player.length - 1];
    await blackjackAppendCard(newCard);
    // Tras la animación volvemos a pintar los controles para que Pedir
    // siga disponible mientras la mano continúe viva.
    if (blackjack.live) blackjackRender(false);
  } else {
    blackjackRender(!blackjack.live);
  }

  if (!blackjack.live) {
    blackjackRender(true);
  }

  blackjackStatus(blackjack.live ? 'Carta recibida · tu turno' : 'La mano ha terminado', blackjack.live ? '' : (Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie'));
  if (blackjack.live) {
    $('#bj-hit').disabled = false;
    $('#bj-stand').disabled = false;
  }

  if (!blackjack.live) {
    await showCardGameResult(data, 'Blackjack');
  }
};

$('#bj-stand').onclick = async () => {
  if (!blackjack.live) return;

  $('#bj-stand').disabled = true;
  playCardSound('flip');
  blackjackStatus('El crupier revela sus cartas…', 'working');

  if (blackjack.mode === 'split') {
    const { data, error } = await supabaseClient.rpc('blackjack_split_stand', {
      p_token: Casino.token
    });

    if (error) {
      console.error(error);
      Casino.toast(error.message);
      $('#bj-stand').disabled = false;
      return;
    }

    blackjack.hands = data.hands || blackjack.hands;
    blackjack.dealer = data.dealer || blackjack.dealer;
    blackjack.activeHand = Number(data.active_hand || 1) - 1;
    blackjack.live = data.status !== 'finished';
    Casino.setBalance(data.coins);
    blackjackRender(!blackjack.live);

    if (blackjack.live) {
      blackjackStatus(`Mano ${blackjack.activeHand + 1} · continúa jugando`, 'working');
    } else {
      await wait(260);
      blackjackRender(true);
      blackjackStatus('Ambas manos resueltas', Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie');
      playCardSound(Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'cash');
      await showCardGameResult(data, 'Blackjack');
    }
    return;
  }

  const { data, error } = await supabaseClient.rpc('blackjack_stand', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    $('#bj-stand').disabled = false;
    return;
  }

  blackjack.player = data.player || blackjack.player;
  blackjack.dealer = data.dealer || blackjack.dealer;
  blackjack.live = false;
  await blackjackRevealDealer();
  await wait(280);
  blackjackRender(true);
  blackjackStatus('Mano resuelta', Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie');
  playCardSound(Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'cash');
  await showCardGameResult(data, 'Blackjack');
};


$('#bj-double').onclick = async () => {
  if (blackjack.mode !== 'normal' || !blackjack.live || blackjack.player.length !== 2) return;

  $('#bj-double').disabled = true;
  $('#bj-hit').disabled = true;
  $('#bj-stand').disabled = true;
  animateDeckPulse('#bj-deck-stack');
  playCardSound('deal');
  blackjackStatus('Doblando apuesta… una última carta', 'working');

  const { data, error } = await supabaseClient.rpc('blackjack_double', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    blackjackRender(false);
    blackjackStatus(error.message || 'No se pudo doblar.', 'lose');
    return;
  }

  blackjack.player = data.player || blackjack.player;
  blackjack.dealer = data.dealer || blackjack.dealer;
  blackjack.bet = Number(data.bet || blackjack.bet * 2);
  blackjack.live = false;
  Casino.setBalance(data.coins);

  blackjackRender(false);
  await wait(380);
  blackjackRender(true);
  blackjackStatus(data.detail || 'Mano resuelta', Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'tie');
  playCardSound(Number(data.delta || 0) > 0 ? 'win' : Number(data.delta || 0) < 0 ? 'lose' : 'cash');
  await showCardGameResult(data, 'Blackjack');
};

$('#bj-split').onclick = async () => {
  if (!blackjackCanSplit()) return;

  $('#bj-split').disabled = true;
  $('#bj-hit').disabled = true;
  $('#bj-stand').disabled = true;
  $('#bj-double').disabled = true;
  animateDeckPulse('#bj-deck-stack');
  playCardSound('shuffle');
  blackjackStatus('Separando la pareja…', 'working');

  const { data, error } = await supabaseClient.rpc('blackjack_split_start', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    blackjackRender(false);
    blackjackStatus(error.message || 'No se pudo dividir.', 'lose');
    return;
  }

  blackjack.mode = 'split';
  blackjack.bet = Number(data.bet || blackjack.bet);
  blackjack.hands = data.hands || [[], []];
  blackjack.activeHand = Math.max(0, Number(data.active_hand || 1) - 1);
  blackjack.dealer = data.dealer || blackjack.dealer;
  blackjack.live = data.status !== 'finished';
  Casino.setBalance(data.coins);
  blackjackRender(false);
  playCardSound('deal');

  if (blackjack.live) {
    blackjackStatus('Mano 1 activa · juega y después pasaremos a Mano 2', 'working');
  } else {
    blackjackRender(true);
    await showCardGameResult(data, 'Blackjack');
  }
};

blackjackRender(false);
blackjackStatus('Elige tu apuesta y pulsa <b>Repartir</b>.');
blackjackUpdateBetDisplay();
window.blackjackUpdateBetDisplay = blackjackUpdateBetDisplay;


// ============================================================
// HIGHER / LOWER
// ============================================================

const hilo = {
  bet: 0,
  pot: 0,
  current: null,
  trail: [],
  live: false
};

function hiloUI() {
  $('#hl-start').disabled = hilo.live;
  $('#hl-up').disabled = !hilo.live;
  $('#hl-down').disabled = !hilo.live;
  $('#hl-cash').disabled = !hilo.live;

  $('#hl-pot').textContent = hilo.live
    ? `Bote: ${hilo.pot} FP`
    : 'Elige tu apuesta abajo y pulsa Empezar';

  $('#hl-ladder').innerHTML = [1, 2, 3, 4, 5]
    .map(level => {
      const expected = Math.round(hilo.pot * Math.pow(1.9, level) / Math.max(1, hilo.bet));
      const active = hilo.live && level === Math.round(Math.log(hilo.pot / hilo.bet) / Math.log(1.9)) + 1;
      return `<span class="${active ? 'on' : ''}">${level} acierto${level > 1 ? 's' : ''}: ${hilo.live ? expected : '·'} FP</span>`;
    })
    .join('');
}

function hiloShow() {
  if (!hilo.current) return;

  const currentCard = cardEl(hilo.current);
  currentCard.classList.add('hilo-enter');
  $('#hl-card').replaceChildren(currentCard);

  $('#hl-trail').replaceChildren(
    ...hilo.trail.slice(-12).map((card, index) => {
      const element = cardEl(card);
      element.style.animation = 'none';
      element.style.opacity = '0.76';
      element.style.setProperty('--trail-index', index);
      return element;
    })
  );
}

function hiloFeedback(text, type = '') {
  const box = $('#hl-feedback');
  if (!box) return;
  box.className = `hilo-feedback ${type}`;
  box.textContent = text;
  box.classList.remove('flash');
  void box.offsetWidth;
  box.classList.add('flash');
}

function hiloIdle() {
  $('#hl-card').replaceChildren(
    Object.assign(cardEl({ r: 0, s: '♠' }, true), { style: '' })
  );
  $('#hl-trail').replaceChildren(...ghost(3));
  hiloFeedback('¿Será mayor o menor?', 'idle');
}

let hiloStarting = false;

function hiloShuffleAnimation(active) {
  const deck = document.querySelector('.hilo-deck-stack');
  const card = $('#hl-card');
  if (deck) deck.classList.toggle('shuffle-active', active);
  if (card) card.classList.toggle('shuffle-card', active);
}

async function hiloAnimateReveal(card) {
  const host = $('#hl-card');
  host.classList.add('hilo-dealing');
  host.replaceChildren();
  const back = cardEl({ r: 0, s: '♠' }, true);
  back.classList.add('hilo-flying-back');
  host.append(back);
  playCardSound('deal');
  await wait(320);

  const face = cardEl(card, false);
  face.classList.add('hilo-enter');
  host.replaceChildren(face);
  playCardSound('flip');
  await wait(420);
  host.classList.remove('hilo-dealing');
}

$('#hl-start').onclick = async () => {
  if (hiloStarting) return;
  const bet = Casino.bet();
  if (!bet) return;
  if (bet > 1000) {
    hiloFeedback('La apuesta máxima de Higher / Lower es de 1000 FP.', 'lose');
    Casino.toast('Higher / Lower permite apuestas de hasta 1000 FP.');
    Casino.dock();
    return;
  }

  hiloStarting = true;
  $('#hl-start').disabled = true;
  $('#hl-up').disabled = true;
  $('#hl-down').disabled = true;
  $('#hl-cash').disabled = true;
  hiloShuffleAnimation(true);
  playCardSound('shuffle');
  hiloFeedback('Barajando…', 'working');

  try {
    const { data, error } = await supabaseClient.rpc('hilo_start_limited', {
      p_token: Casino.token,
      p_bet: bet
    });

    if (error) throw error;
    if (!data || !data.current_card) {
      throw new Error('Respuesta inesperada de Higher / Lower.');
    }

    Casino.clearStake();
    hilo.bet = bet;
    hilo.pot = Number(data.pot || bet);
    hilo.current = data.current_card;
    hilo.trail = data.trail || [];
    hilo.live = data.status === 'live';
    Casino.setBalance(data.coins);

    await wait(420);
    hiloShuffleAnimation(false);
    await hiloAnimateReveal(hilo.current);
    hiloShow();
    hiloUI();
    hiloFeedback('Elige: ¿mayor o menor?', 'ready');
  } catch (error) {
    console.error(error);
    hiloShuffleAnimation(false);
    hiloStarting = false;
    hilo.live = false;
    hiloUI();
    hiloFeedback('No se pudo iniciar la partida.', 'lose');
    Casino.toast(error?.message || 'No se pudo iniciar Higher / Lower.');
    return;
  }

  hiloStarting = false;
  hiloUI();
};

async function hiloGuess(up) {
  if (!hilo.live) return;

  $('#hl-up').disabled = true;
  $('#hl-down').disabled = true;
  playCardSound('flip');
  hiloFeedback('Revelando la siguiente carta…', 'working');

  const { data, error } = await supabaseClient.rpc('hilo_guess', {
    p_token: Casino.token,
    p_up: up
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    hiloUI();
    hiloFeedback('Ha ocurrido un error. Vuelve a intentarlo.', 'lose');
    return;
  }

  hilo.current = data.current_card;
  hilo.trail = data.trail || hilo.trail;
  hilo.pot = Number(data.pot || 0);
  hilo.live = data.status === 'live';

  Casino.setBalance(data.coins);
  await hiloAnimateReveal(hilo.current);
  hiloShow();
  hiloUI();

  if (!hilo.live) {
    const delta = Number(data.delta || 0);
    hiloFeedback(delta > 0 ? `¡Acertaste! +${delta} FP` : delta < 0 ? `Fin de partida · −${Math.abs(delta)} FP` : 'Partida terminada', delta > 0 ? 'win' : delta < 0 ? 'lose' : 'tie');
    playCardSound(delta > 0 ? 'win' : 'lose');
    Casino.showGameResult(data, 'Higher / Lower');
  } else {
    hiloFeedback('¡Nueva carta! Sigue eligiendo.', 'ready');
  }
}

$('#hl-up').onclick = () => hiloGuess(true);
$('#hl-down').onclick = () => hiloGuess(false);

$('#hl-cash').onclick = async () => {
  if (!hilo.live) return;

  const { data, error } = await supabaseClient.rpc('hilo_cashout', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    return;
  }

  hilo.live = false;
  hilo.pot = 0;
  hiloUI();
  hiloFeedback('Bote cobrado · buen momento para retirarse.', 'win');
  playCardSound('cash');
  Casino.showGameResult(data, 'Higher / Lower');
};

hiloIdle();
hiloUI();
document.addEventListener('click', event => {
  if (event.target.closest('#dock')) hiloUI();
});
