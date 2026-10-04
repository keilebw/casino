// ============================================================
// ROAD RUSH — juego de carretera con coche
// La lógica de riesgo y premios se resuelve en Supabase.
// ============================================================

const ROAD_STEPS = 10;
const ROAD_CONFIG = {
  easy: {
    name: 'Fácil',
    risk: 4,
    color: 'easy',
    multipliers: [1.02, 1.06, 1.11, 1.15, 1.20, 1.25, 1.30, 1.36, 1.42, 1.47]
  },
  normal: {
    name: 'Normal',
    risk: 12,
    color: 'normal',
    multipliers: [1.11, 1.27, 1.44, 1.63, 1.86, 2.11, 2.40, 2.72, 3.10, 3.52]
  },
  hard: {
    name: 'Difícil',
    risk: 20,
    color: 'hard',
    multipliers: [1.22, 1.53, 1.91, 2.39, 2.99, 3.74, 4.67, 5.84, 7.30, 9.13]
  }
};

const road = {
  initialized: false,
  busy: false,
  active: null,
  difficulty: 'normal',
  refreshTimer: null,
  audio: null
};

const rq = id => document.getElementById(id);

function roadMoney(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0))} FP`;
}

function roadWait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function roadFormatMultiplier(value) {
  return `×${Number(value || 1).toFixed(2)}`;
}

function roadSound(kind) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!road.audio) road.audio = new AudioContext();
    if (road.audio.state === 'suspended') road.audio.resume();

    const ctx = road.audio;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const map = {
      click: [220, 0.04, 'square'],
      engine: [110, 0.28, 'sawtooth'],
      safe: [440, 0.16, 'triangle'],
      cash: [660, 0.28, 'sine'],
      crash: [92, 0.34, 'sawtooth'],
      finish: [520, 0.42, 'triangle']
    };

    const [freq, duration, type] = map[kind] || map.click;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'engine') {
      osc.frequency.exponentialRampToValueAtTime(190, now + duration);
    } else if (kind === 'safe') {
      osc.frequency.exponentialRampToValueAtTime(620, now + duration);
    } else if (kind === 'cash') {
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + duration);
    } else if (kind === 'crash') {
      osc.frequency.exponentialRampToValueAtTime(45, now + duration);
    } else if (kind === 'finish') {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(1040, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'engine' ? 0.06 : 0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (error) {
    console.debug('Road Rush audio:', error);
  }
}

function roadCurrentConfig() {
  return ROAD_CONFIG[road.difficulty] || ROAD_CONFIG.normal;
}

function roadBuildRoad() {
  const board = rq('road-board');
  if (!board) return;
  board.innerHTML = '';

  for (let step = ROAD_STEPS; step >= 1; step -= 1) {
    const row = document.createElement('div');
    row.className = 'road-row';
    row.dataset.step = String(step);

    const label = document.createElement('span');
    label.className = 'road-step-label';
    label.textContent = `CRUCE ${step}`;

    const lane = document.createElement('div');
    lane.className = 'road-lane';

    const laneStripe = document.createElement('span');
    laneStripe.className = 'road-stripe';

    const crossLeft = document.createElement('span');
    crossLeft.className = 'road-cross-mark road-cross-mark-left';
    const crossRight = document.createElement('span');
    crossRight.className = 'road-cross-mark road-cross-mark-right';

    const traffic1 = document.createElement('i');
    traffic1.className = 'road-traffic traffic-a traffic-from-left';
    traffic1.setAttribute('aria-hidden', 'true');

    const traffic2 = document.createElement('i');
    traffic2.className = 'road-traffic traffic-b traffic-from-right';
    traffic2.setAttribute('aria-hidden', 'true');

    const state = document.createElement('span');
    state.className = 'road-row-state';
    state.textContent = '?';

    const reward = document.createElement('b');
    reward.className = 'road-row-multiplier';
    reward.textContent = roadFormatMultiplier(roadCurrentConfig().multipliers[step - 1]);

    lane.append(laneStripe, crossLeft, crossRight, traffic1, traffic2, state, reward);
    row.append(label, lane);
    board.append(row);
  }

  const car = document.createElement('div');
  car.id = 'road-car';
  car.className = 'road-car';
  car.innerHTML = '<span class="road-car-window"></span><span class="road-car-light"></span><i class="road-wheel wheel-left"></i><i class="road-wheel wheel-right"></i>';
  board.append(car);
  roadPositionCar(0, false);
}

function roadPositionCar(step, animate = true) {
  const board = rq('road-board');
  const car = rq('road-car');
  if (!board || !car) return;

  const targetStep = Number(step) || 0;
  let top = Math.max(0, board.clientHeight - car.offsetHeight - 4);
  if (targetStep > 0) {
    const row = board.querySelector(`.road-row[data-step=\"${targetStep}\"]`);
    if (row) {
      top = row.offsetTop + Math.max(0, (row.offsetHeight - car.offsetHeight) / 2);
    }
  }

  car.classList.toggle('road-car-static', !animate);
  car.style.setProperty('--road-car-top', `${Math.round(top)}px`);
  if (animate) {
    car.classList.remove('road-car-drive');
    void car.offsetWidth;
    car.classList.add('road-car-drive');
  } else {
    car.classList.remove('road-car-drive');
  }
}

function roadRenderRows() {
  document.querySelectorAll('#road-board .road-row').forEach(row => {
    const step = Number(row.dataset.step);
    const state = row.querySelector('.road-row-state');
    const config = roadCurrentConfig();
    const passed = road.active && step <= Number(road.active.step || 0);
    const crashed = road.active?.status === 'crashed' && step === Number(road.active.step || 0);

    row.classList.toggle('passed', passed && !crashed);
    row.classList.toggle('crashed', crashed);
    row.classList.toggle('next', road.active?.status === 'active' && step === Number(road.active.step || 0) + 1);

    if (state) {
      state.textContent = passed && !crashed ? '✓' : crashed ? '✕' : '?';
    }

    const reward = row.querySelector('.road-row-multiplier');
    if (reward) reward.textContent = roadFormatMultiplier(config.multipliers[step - 1]);
  });
}

function roadRenderDifficulty() {
  document.querySelectorAll('[data-road-difficulty]').forEach(button => {
    const selected = button.dataset.roadDifficulty === road.difficulty;
    button.classList.toggle('selected', selected);
    button.disabled = Boolean(road.active) || road.busy;
  });

  const config = roadCurrentConfig();
  const risk = rq('road-risk');
  if (risk) risk.textContent = `${config.risk}% por cruce`;
  const inlineRisk = rq('road-risk-inline');
  if (inlineRisk) inlineRisk.textContent = `${config.risk}%`;

  const next = rq('road-next-multiplier');
  if (next) next.textContent = roadFormatMultiplier(config.multipliers[Math.min((road.active?.step || 0), ROAD_STEPS - 1)]);

  const max = rq('road-max-multiplier');
  if (max) max.textContent = roadFormatMultiplier(config.multipliers[ROAD_STEPS - 1]);
}

function roadRender() {
  const startButton = rq('road-start');
  const advanceButton = rq('road-advance');
  const cashButton = rq('road-cashout');
  const replayButton = rq('road-replay');
  const config = roadCurrentConfig();

  if (!road.active) {
    rq('road-phase').textContent = 'Preparado para arrancar';
    rq('road-status').textContent = 'Elige dificultad, selecciona tu apuesta con las fichas de abajo y arranca.';
    rq('road-stake').textContent = roadMoney(Casino.stake || 0);
    rq('road-multiplier').textContent = '×1.00';
    rq('road-potential').textContent = '0 FP';
    rq('road-safe').textContent = '0 / 10';
    startButton.disabled = road.busy || !Casino.stake;
    advanceButton.disabled = true;
    cashButton.disabled = true;
    replayButton.classList.add('hidden');
    roadRenderDifficulty();
    roadRenderRows();
    roadPositionCar(0, false);
    if (typeof Casino !== 'undefined' && typeof Casino.dock === 'function') Casino.dock();
    return;
  }

  const step = Number(road.active.step || 0);
  const multiplier = Number(road.active.multiplier || 1);
  const stake = Number(road.active.stake || 0);
  const potential = Math.floor(stake * multiplier);
  const status = road.active.status;

  rq('road-stake').textContent = roadMoney(stake);
  rq('road-multiplier').textContent = roadFormatMultiplier(multiplier);
  rq('road-potential').textContent = roadMoney(potential);
  rq('road-safe').textContent = `${step} / ${ROAD_STEPS}`;
  rq('road-risk').textContent = `${Number(road.active.risk || config.risk)}% por cruce`;
  const inlineRisk = rq('road-risk-inline');
  if (inlineRisk) inlineRisk.textContent = `${Number(road.active.risk || config.risk)}%`;
  rq('road-current-step').textContent = status === 'won' || step >= ROAD_STEPS
    ? 'META'
    : status === 'crashed'
      ? `CRUCE ${step} · CHOQUE`
      : `CRUCE ${step + 1}`;

  startButton.disabled = true;
  replayButton.classList.toggle('hidden', status === 'active');
  cashButton.disabled = status !== 'active' || step < 1 || road.busy;
  advanceButton.disabled = status !== 'active' || road.busy;

  if (status === 'crashed') {
    rq('road-phase').textContent = '¡Choque!';
    rq('road-status').textContent = `El coche no superó el cruce ${step}. Has perdido ${roadMoney(stake)}.`;
  } else if (status === 'cashed') {
    rq('road-phase').textContent = 'Dinero cobrado';
    rq('road-status').textContent = `Has cobrado ${roadMoney(potential)}. Ganancia neta: ${roadMoney(potential - stake)}.`;
  } else if (status === 'won') {
    rq('road-phase').textContent = '¡META!';
    rq('road-status').textContent = `Has cruzado toda la carretera y cobras ${roadMoney(potential)}.`;
  } else {
    rq('road-phase').textContent = step === 0 ? 'Preparado' : `Cruce ${step} superado`;
    rq('road-status').textContent = step === 0
      ? `Riesgo actual: ${Number(road.active.risk || config.risk)}% por cruce.`
      : `Puedes avanzar al ${roadFormatMultiplier(config.multipliers[Math.min(step, ROAD_STEPS - 1)])} o cobrar ahora.`;
  }

  roadRenderDifficulty();
  roadRenderRows();
  roadPositionCar(step, false);
  if (typeof Casino !== 'undefined' && typeof Casino.dock === 'function') Casino.dock();
}

async function roadLoadActive() {
  if (!Casino.token) return;

  const { data, error } = await supabaseClient.rpc('road_rush_get_active', {
    p_token: Casino.token
  });

  if (error) {
    console.error(error);
    return;
  }

  road.active = data || null;
  if (road.active?.difficulty && ROAD_CONFIG[road.active.difficulty]) {
    road.difficulty = road.active.difficulty;
  }
  roadRender();
}

async function roadStart() {
  if (road.busy) return;

  const stake = Math.min(500, Number(Casino.bet()));
  if (!stake) return;

  road.busy = true;
  roadSound('engine');
  rq('road-start').disabled = true;
  rq('road-phase').textContent = 'Arrancando…';
  rq('road-status').textContent = `Preparando carretera · ${roadCurrentConfig().name}`;

  try {
    const { data, error } = await supabaseClient.rpc('road_rush_start', {
      p_token: Casino.token,
      p_bet: stake,
      p_difficulty: road.difficulty
    });

    if (error) throw error;
    Casino.clearStake();
    road.active = data;
    road.busy = false;
    roadPositionCar(0, false);
    roadRender();
  } catch (error) {
    console.error(error);
    road.active = null;
    road.busy = false;
    rq('road-status').textContent = error?.message || 'No se pudo iniciar Road Rush.';
    roadRender();
    Casino.loadProfile();
  }
}

async function roadStepForward() {
  if (road.busy || !road.active || road.active.status !== 'active') return;

  road.busy = true;
  roadSound('engine');
  rq('road-advance').disabled = true;
  rq('road-cashout').disabled = true;
  rq('road-phase').textContent = `Cruzando ${Number(road.active.step || 0) + 1}…`;
  rq('road-status').textContent = 'El coche entra en el siguiente cruce…';

  try {
    const { data, error } = await supabaseClient.rpc('road_rush_step', {
      p_token: Casino.token
    });
    if (error) throw error;

      road.active = data;
    const landedStep = Number(data.step || 0);
    roadPositionCar(landedStep, data.outcome === 'safe');

    if (data.outcome === 'safe') {
      // Resolución inmediata: el cruce queda marcado en el mismo frame en que llega la respuesta.
      roadSound(data.status === 'won' ? 'finish' : 'safe');
      if (data.coins !== undefined) Casino.setBalance(data.coins);
      roadRender();
      rq('road-status').textContent = data.status === 'won'
        ? `¡Has llegado al final! Cobras ${roadMoney(data.payout)}.`
        : `Cruce ${landedStep} superado · ahora estás en ${roadFormatMultiplier(data.multiplier)}.`;
    } else {
      // El coche se queda EXACTAMENTE en el cruce donde falló. Primero vemos el impacto;
      // unos milisegundos después aparece el rojo/X definitivo.
      roadSound('crash');
      const crashedRow = document.querySelector(`#road-board .road-row[data-step="${landedStep}"]`);
      const car = rq('road-car');
      crashedRow?.classList.add('road-collision');
      car?.classList.add('road-car-crashed');
      if (car) {
        car.classList.remove('road-car-drive');
        void car.offsetWidth;
      }
      await roadWait(260);
      if (data.coins !== undefined) Casino.setBalance(data.coins);
      roadRender();
    }

    if (data.status !== 'active') {
      Casino.showGameResult(data, 'Road Rush');
    }

    road.busy = false;
    if (data.outcome === 'safe') roadRender();
  } catch (error) {
    console.error(error);
    road.busy = false;
    roadRender();
    Casino.toast(error?.message || 'No se pudo cruzar el siguiente tramo.');
  }
}

async function roadCashout() {
  if (road.busy || !road.active || road.active.status !== 'active') return;

  road.busy = true;
  rq('road-cashout').disabled = true;
  rq('road-advance').disabled = true;
  rq('road-phase').textContent = 'Volviendo al box…';
  roadSound('cash');

  try {
    const { data, error } = await supabaseClient.rpc('road_rush_cashout', {
      p_token: Casino.token
    });
    if (error) throw error;

    road.active = data;
    roadPositionCar(0, true);
    await roadWait(720);
    if (data.coins !== undefined) Casino.setBalance(data.coins);
    Casino.showGameResult(data, 'Road Rush');
    road.busy = false;
    roadRender();
  } catch (error) {
    console.error(error);
    road.busy = false;
    roadRender();
    Casino.toast(error?.message || 'No se pudo cobrar la partida.');
  }
}

function roadChooseDifficulty(key) {
  if (road.active || road.busy || !ROAD_CONFIG[key]) return;
  road.difficulty = key;
  roadBuildRoad();
  roadRender();
  roadSound('click');
}

function roadReplay() {
  if (road.busy) return;
  road.active = null;
  roadBuildRoad();
  roadRender();
  rq('road-status').textContent = 'Elige otra apuesta y vuelve a arrancar.';
}

function roadStakeChanged(value) {
  const stake = Math.min(500, Math.max(0, Math.floor(Number(value) || 0)));
  Casino.stake = stake;
  const stakeEl = rq('road-stake');
  if (stakeEl && !road.active) stakeEl.textContent = roadMoney(stake);
  const startButton = rq('road-start');
  if (startButton && !road.active) startButton.disabled = road.busy || stake < 1;
  if (!road.active && !road.busy) {
    const status = rq('road-status');
    if (status) status.textContent = stake > 0
      ? `Apuesta preparada: ${roadMoney(stake)} · máximo 500 FP.`
      : 'Elige dificultad, selecciona tu apuesta con las fichas de abajo y arranca.';
  }
}

async function initRoad() {
  if (road.initialized) {
    await roadLoadActive();
    return;
  }

  road.initialized = true;
  roadBuildRoad();
  roadRender();

  document.querySelectorAll('[data-road-difficulty]').forEach(button => {
    button.addEventListener('click', () => roadChooseDifficulty(button.dataset.roadDifficulty));
  });

  rq('road-start')?.addEventListener('click', roadStart);
  rq('road-advance')?.addEventListener('click', roadStepForward);
  rq('road-cashout')?.addEventListener('click', roadCashout);
  rq('road-replay')?.addEventListener('click', roadReplay);

  await roadLoadActive();
  clearInterval(road.refreshTimer);
  road.refreshTimer = setInterval(() => {
    if (!Casino.token) return;
    if (road.active?.status === 'active') roadLoadActive();
  }, 12000);
}

function stopRoad() {
  clearInterval(road.refreshTimer);
  road.refreshTimer = null;
  road.active = null;
  road.busy = false;
}

async function refreshRoad() {
  if (!road.initialized) {
    await initRoad();
    return;
  }
  roadBuildRoad();
  await roadLoadActive();
}

function isRoadActive() {
  return Boolean(road.active?.status === 'active');
}

window.initRoad = initRoad;
window.stopRoad = stopRoad;
window.refreshRoad = refreshRoad;
window.isRoadActive = isRoadActive;
window.roadStakeChanged = roadStakeChanged;
