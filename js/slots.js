// ============================================================
// TRAGAPERRAS 3x3
// El resultado y el saldo los decide Supabase.
// El navegador solo anima y muestra el resultado.
// ============================================================

const SLOT_SYMBOLS = [
  { key: 'CHERRY', emoji: '🍒', label: 'CEREZAS', cls: 'cherry' },
  { key: 'LEMON', emoji: '🍋', label: 'LIMÓN', cls: 'lemon' },
  { key: 'ORANGE', emoji: '🍊', label: 'NARANJA', cls: 'orange' },
  { key: 'GRAPE', emoji: '🍇', label: 'UVA', cls: 'grape' },
  { key: 'WATERMELON', emoji: '🍉', label: 'SANDÍA', cls: 'watermelon' },
  { key: 'BAR', emoji: 'BAR', label: 'BAR', cls: 'bar' },
  { key: 'SEVEN', emoji: '7', label: 'SIETE', cls: 'seven' }
];

const SLOT_BY_KEY = Object.fromEntries(SLOT_SYMBOLS.map(symbol => [symbol.key, symbol]));
const SLOT_RANDOM = SLOT_SYMBOLS;
let slotBet = 1;
let slotSpinning = false;
let slotTimer = null;

function slotSymbol(key) {
  return SLOT_BY_KEY[key] || SLOT_SYMBOLS[0];
}

function randomSlotSymbol() {
  return SLOT_RANDOM[Math.floor(Math.random() * SLOT_RANDOM.length)];
}

function buildSlotGrid() {
  const grid = $('#slot-grid');
  if (!grid) return;

  grid.replaceChildren();
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'slot-cell';
    cell.dataset.index = i;
    const symbol = document.createElement('span');
    symbol.className = 'slot-symbol';
    symbol.textContent = '🍒';
    cell.append(symbol);
    grid.append(cell);
  }
}

function paintSlotCell(index, key, animate = false) {
  const cell = document.querySelector(`#slot-grid .slot-cell:nth-child(${index + 1})`);
  if (!cell) return;

  const info = slotSymbol(key);
  cell.dataset.symbol = info.key;
  cell.className = `slot-cell symbol-${info.cls}${animate ? ' symbol-pop' : ''}`;
  const symbol = cell.querySelector('.slot-symbol');
  symbol.textContent = info.emoji;
  symbol.title = info.label;

  if (animate) {
    setTimeout(() => cell.classList.remove('symbol-pop'), 360);
  }
}

function paintIdleGrid() {
  const idle = ['LEMON', 'CHERRY', 'ORANGE', 'GRAPE', 'CHERRY', 'WATERMELON', 'ORANGE', 'LEMON', 'CHERRY'];
  idle.forEach((key, index) => paintSlotCell(index, key));
}

function setSlotLineStates(activeLines = Math.min(3, slotBet)) {
  const total = Math.max(1, Math.min(3, Number(activeLines) || 1));
  const names = ['top', 'mid', 'bottom'];
  names.forEach((name, index) => {
    const line = document.querySelector(`.payline-line.line-${name}`);
    if (!line) return;
    const active = index < total;
    line.classList.toggle('active', active);
    line.classList.toggle('inactive', !active);
  });
}

function setSlotBet(value) {
  const next = Math.max(1, Math.min(100, Math.floor(Number(value) || 1)));
  slotBet = next;
  const label = $('#slot-bet');
  if (label) label.textContent = `${slotBet} FP`;

  document.querySelectorAll('[data-slot-bet]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.slotBet) === slotBet);
  });
  setSlotLineStates(Math.min(3, slotBet));

  const canAfford = Casino.coins() >= slotBet;
  const spin = $('#slot-spin');
  if (spin && !slotSpinning) spin.disabled = !canAfford;

  if (slotSpinning) return;
  if (slotBet > Casino.coins()) {
    const lines = Math.min(3, slotBet);
    $('#slot-status').textContent = `Necesitas ${slotBet} FP. Esta apuesta activa ${lines} ${lines === 1 ? 'línea' : 'líneas'}. Tu saldo es ${Casino.coins()} FP.`;
  } else {
    const lines = Math.min(3, slotBet);
    $('#slot-status').textContent = `Apuesta total: ${slotBet} FP · ${lines} ${lines === 1 ? 'línea activa' : 'líneas activas'}. Pulsa GIRAR.`;
  }
}

function slotRefreshControls() {
  const spin = $('#slot-spin');
  const minus = $('#slot-bet-minus');
  const plus = $('#slot-bet-plus');
  if (!spin) return;

  spin.disabled = slotSpinning || slotBet > Casino.coins();
  if (minus) minus.disabled = slotSpinning || slotBet <= 1;
  if (plus) plus.disabled = slotSpinning || slotBet >= 100;

  document.querySelectorAll('[data-slot-bet]').forEach(button => {
    button.disabled = slotSpinning;
    button.classList.toggle('active', Number(button.dataset.slotBet) === slotBet);
  });
}

function slotSetStatus(message, cls = '') {
  const status = $('#slot-status');
  if (!status) return;
  status.className = `slot-status ${cls}`.trim();
  status.textContent = message;
}

function slotAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!window.__slotAudio) window.__slotAudio = new AudioCtx();
  if (window.__slotAudio.state === 'suspended') window.__slotAudio.resume();
  return window.__slotAudio;
}

function slotBeep(frequency, duration = 0.05, type = 'square', gain = 0.035) {
  const audio = slotAudioContext();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  volume.gain.setValueAtTime(gain, audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  oscillator.connect(volume).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function slotWinJingle(big = false) {
  const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
  notes.forEach((frequency, index) => {
    setTimeout(() => slotBeep(frequency, 0.12, 'triangle', 0.05), index * 95);
  });
}

function slotSpinSound() {
  [220, 250, 280, 310, 340, 380].forEach((frequency, index) => {
    setTimeout(() => slotBeep(frequency, 0.035, 'square', 0.018), index * 90);
  });
}

function animateSlot(finalGrid) {
  return new Promise(resolve => {
    const machine = $('#slot-machine');
    const grid = $('#slot-grid');
    if (!machine || !grid) return resolve();

    machine.classList.add('spinning');
    document.querySelectorAll('.payline-line').forEach(line => line.classList.remove('winner'));
    $('#slot-result').textContent = 'GIRANDO…';
    $('#slot-result').className = 'slot-result spinning-result';
    slotSpinSound();

    const intervals = [];
    const reelStops = [1250, 1680, 2110];
    const started = performance.now();

    for (let reel = 0; reel < 3; reel++) {
      const interval = setInterval(() => {
        for (let row = 0; row < 3; row++) {
          paintSlotCell(reel + row * 3, randomSlotSymbol().key);
        }
        if (performance.now() - started > reelStops[reel] - 330) {
          slotBeep(360 + reel * 100, 0.055, 'square', 0.03);
        }
      }, 70 + reel * 7);

      intervals.push(interval);

      setTimeout(() => {
        clearInterval(interval);
        for (let row = 0; row < 3; row++) {
          paintSlotCell(reel + row * 3, finalGrid[reel + row * 3], true);
        }
        const reelCells = [
          ...document.querySelectorAll(`#slot-grid .slot-cell:nth-child(${reel + 1})`),
          ...document.querySelectorAll(`#slot-grid .slot-cell:nth-child(${reel + 4})`),
          ...document.querySelectorAll(`#slot-grid .slot-cell:nth-child(${reel + 7})`)
        ];
        reelCells.forEach(cell => cell.classList.add('reel-stop'));
        setTimeout(() => reelCells.forEach(cell => cell.classList.remove('reel-stop')), 260);
      }, reelStops[reel]);
    }

    setTimeout(() => {
      intervals.forEach(clearInterval);
      machine.classList.remove('spinning');
      resolve();
    }, 2320);
  });
}

function highlightWinningLines(lines) {
  const wonLines = new Set();
  const activeFromServer = lines.filter(line => line.active === true).length;
  const activeLines = activeFromServer > 0 ? activeFromServer : Math.min(3, slotBet);
  setSlotLineStates(activeLines);

  lines.forEach(line => {
    if (Number(line.payout) > 0) wonLines.add(Number(line.line));
  });

  [1, 2, 3].forEach(lineNumber => {
    const line = document.querySelector(`.payline-line.line-${['top', 'mid', 'bottom'][lineNumber - 1]}`);
    if (!line) return;
    line.classList.toggle('winner', wonLines.has(lineNumber));
  });

  return wonLines;
}

function slotDescribeLines(lines) {
  const wins = lines.filter(line => Number(line.payout) > 0);
  if (!wins.length) return 'Ninguna línea premiada esta vez.';
  return wins.map(line => `Línea ${line.line}: +${line.payout} FP`).join(' · ');
}

async function playSlot() {
  if (slotSpinning) return;
  if (!Casino.token) {
    Casino.toast('Inicia sesión primero.');
    return;
  }
  if (slotBet < 1 || slotBet > 100) return;
  if (slotBet > Casino.coins()) {
    Casino.toast(`Necesitas ${slotBet} FP.`);
    return;
  }

  slotSpinning = true;
  slotRefreshControls();
  slotSetStatus(`La máquina está girando · apuesta total ${slotBet} FP…`, 'working');

  const { data, error } = await supabaseClient.rpc('play_slots', {
    p_token: Casino.token,
    p_bet: slotBet
  });

  if (error) {
    console.error(error);
    Casino.toast(error.message);
    slotSpinning = false;
    slotRefreshControls();
    await Casino.loadProfile();
    return;
  }

  const finalGrid = Array.isArray(data.grid) ? data.grid : [];
  await animateSlot(finalGrid);

  const lines = Array.isArray(data.lines) ? data.lines : [];
  const wonLines = highlightWinningLines(lines);
  const delta = Number(data.delta || 0);
  const payout = Number(data.payout || 0);

  const result = $('#slot-result');
  const resultClass = delta > 0 ? 'won' : delta < 0 ? 'lost' : 'draw';
  result.className = `slot-result ${resultClass}`;

  if (payout > 0 && delta < 0) {
    result.textContent = `Premio ${payout} FP · −${Math.abs(delta)} FP`;
  } else if (delta > 0) {
    result.textContent = `+${delta} FP`;
  } else if (delta < 0) {
    result.textContent = `−${Math.abs(delta)} FP`;
  } else {
    result.textContent = '0 FP';
  }

  if (wonLines.size) {
    $('#slot-machine').classList.add('celebrate');
    setTimeout(() => $('#slot-machine').classList.remove('celebrate'), 1500);
    slotWinJingle(wonLines.size >= 2 || finalGrid.includes('SEVEN'));
  } else {
    slotBeep(140, 0.12, 'sawtooth', 0.025);
  }

  if (payout > 0) {
    slotSetStatus(`¡Premio de ${payout} FP! ${slotDescribeLines(lines)}`, 'win');
  } else {
    slotSetStatus(`No hubo premio. ${slotDescribeLines(lines)}`, 'lose');
  }

  Casino.setBalance(data.coins);
  Casino.renderHistory();
  if (window.refreshSidebar) window.refreshSidebar();

  slotSpinning = false;
  slotRefreshControls();
}

$('#slot-bet-minus').onclick = () => setSlotBet(slotBet - 1);
$('#slot-bet-plus').onclick = () => setSlotBet(slotBet + 1);

document.querySelectorAll('[data-slot-bet]').forEach(button => {
  button.onclick = () => setSlotBet(Number(button.dataset.slotBet));
});

$('#slot-spin').onclick = playSlot;

buildSlotGrid();
paintIdleGrid();
setSlotBet(1);

// El saldo puede cambiar desde otro juego. Actualizamos el botón de giro.
window.slotRefreshControls = slotRefreshControls;


// Atajo cómodo: barra espaciadora para girar cuando la pestaña está activa.
document.addEventListener('keydown', event => {
  if (event.code !== 'Space') return;
  const section = $('#t-slots');
  if (!section || section.classList.contains('hidden') || slotSpinning) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  playSlot();
});
