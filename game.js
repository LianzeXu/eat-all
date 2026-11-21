(() => {
  'use strict';

  const SAVE_KEY = 'little-gravity-field-static-v2';
  const RUN_SECONDS = 75;
  const MAX_OFFLINE_MINUTES = 240;
  const MAX_OBJECTS = 96;
  const COLOR_SET = ['#73dfd0', '#a596ff', '#ffd182', '#83b9ff', '#f38eb5', '#b7e58b'];
  const UPGRADE_DEFS = [
    { id: 'size', icon: '◉', name: '初始体积', desc: '每级让新一局的引力场半径小幅增加。', base: 72, max: 20 },
    { id: 'speed', icon: '➤', name: '牵引速度', desc: '提升引力场跟手程度与星尘吸入速度。', base: 82, max: 20 },
    { id: 'magnet', icon: '⌁', name: '磁力范围', desc: '每级小幅增加吸附距离。', base: 70, max: 20 },
    { id: 'crit', icon: '✧', name: '暴击概率', desc: '小概率吞入更大的星尘，最高 10 级。', base: 105, max: 10 },
    { id: 'multiplier', icon: '✦', name: '结算倍率', desc: '每级小幅提升结算星尘。', base: 120, max: 20 }
  ];
  const ROGUE = [
    { id: 'size', icon: '◉', name: '膨胀核心', desc: '本局引力场半径小幅增加。' },
    { id: 'suction', icon: '➤', name: '强劲牵引', desc: '本局星尘吸入速度小幅提升。' },
    { id: 'magnet', icon: '⌁', name: '远距磁吸', desc: '本局磁力范围小幅增加。' },
    { id: 'crit', icon: '✧', name: '暴击漩涡', desc: '本局暴击概率小幅提升。' },
    { id: 'echo', icon: '⟲', name: '回响分身', desc: '周期性获得额外吞噬收益。' },
    { id: 'combo', icon: '◌', name: '同色连锁', desc: '连续吞噬 3 个同色物体获得额外收益。' },
    { id: 'reward', icon: '✦', name: '高能回收', desc: '本局结算收益倍率 +10%，有上限。' },
    { id: 'split', icon: '⁕', name: '微型分裂', desc: '吞噬普通星尘时偶尔生成两颗碎片；碎片不会再分裂。' }
  ];
  const DEFAULT_SAVE = {
    essence: 0, bestRun: 0,
    upgrades: { size: 0, speed: 0, magnet: 0, crit: 0, multiplier: 0 },
    settings: { haptics: true }, lastSeenAt: 0
  };

  const $ = (id) => document.getElementById(id);
  const ui = {};
  let state;
  let offlineReward = 0;
  let canvas, ctx, width = 0, height = 0, dpr = 1, stars = [];
  let mode = 'home';
  let run = null;
  let frameTime = 0;
  let toastTimeout = 0;
  let pointerHeld = false;
  let target = { x: 0, y: 0 };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const fmt = (x) => Math.max(0, Math.floor(Number(x) || 0)).toLocaleString('zh-CN');
  const timeText = (seconds) => {
    const n = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  };
  const rand = (min, max) => min + Math.random() * (max - min);

  function readSave() {
    const save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        save.essence = Math.max(0, Math.floor(Number(data.essence) || 0));
        save.bestRun = Math.max(0, Math.floor(Number(data.bestRun) || 0));
        for (const def of UPGRADE_DEFS) {
          const value = Number(data.upgrades && data.upgrades[def.id]);
          save.upgrades[def.id] = Number.isFinite(value) ? clamp(Math.floor(value), 0, def.max) : 0;
        }
        save.settings.haptics = !(data.settings && data.settings.haptics === false);
        save.lastSeenAt = Math.max(0, Number(data.lastSeenAt) || 0);
      }
    } catch (error) {
      console.warn('本地存档读取失败，将使用新存档。', error);
    }
    const now = Date.now();
    if (save.lastSeenAt > 0 && save.lastSeenAt <= now) {
      const away = Math.min(Math.floor((now - save.lastSeenAt) / 60000), MAX_OFFLINE_MINUTES);
      offlineReward = Math.floor(away / 10);
      save.essence += offlineReward;
    }
    save.lastSeenAt = now;
    return save;
  }

  function saveGame() {
    state.lastSeenAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
    catch (error) { console.warn('本地存档写入失败。', error); }
    updateHomeStats();
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => ui.toast.classList.remove('visible'), 1800);
  }

  function updateHomeStats() {
    ui.homeEssence.textContent = fmt(state.essence);
    ui.homeBest.textContent = fmt(state.bestRun);
    ui.hudEssence.textContent = fmt(state.essence);
    ui.hudBest.textContent = fmt(state.bestRun);
    ui.upgradeEssence.textContent = fmt(state.essence);
    ui.haptics.textContent = `震动：${state.settings.haptics ? '开' : '关'}`;
  }

  function updateHud() {
    if (!run) return;
    ui.runClock.textContent = `探索中 · ${timeText(run.elapsed)}`;
    ui.runLevel.textContent = `引力场 Lv.${run.level + 1}`;
    ui.progressFill.style.width = `${clamp(run.elapsed / RUN_SECONDS * 100, 0, 100)}%`;
  }

  function costFor(def, level) { return Math.ceil(def.base * Math.pow(1.22, level)); }

  function renderUpgrades() {
    ui.upgradeList.innerHTML = UPGRADE_DEFS.map((def) => {
      const level = state.upgrades[def.id];
      const cost = costFor(def, level);
      const full = level >= def.max;
      const canBuy = !full && state.essence >= cost;
      return `<article class="upgrade-row"><div><div class="upgrade-name">${def.icon} ${def.name}<span class="upgrade-level">Lv.${level}/${def.max}</span></div><div class="upgrade-desc">${def.desc}</div></div><button class="button soft upgrade-buy" data-upgrade="${def.id}" ${canBuy ? '' : 'disabled'}>${full ? '已满级' : `✦ ${fmt(cost)}`}</button></article>`;
    }).join('');
    updateHomeStats();
  }

  function buyUpgrade(id) {
    const def = UPGRADE_DEFS.find((item) => item.id === id);
    if (!def) return;
    const level = state.upgrades[id];
    if (level >= def.max) return;
    const cost = costFor(def, level);
    if (state.essence < cost) { showToast('星尘还不够，先去探索一局吧。'); return; }
    state.essence -= cost;
    state.upgrades[id] += 1;
    saveGame();
    renderUpgrades();
    showToast(`${def.name}已提升至 Lv.${state.upgrades[id]}。`);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 917;
    const seeded = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    stars = Array.from({ length: Math.max(45, Math.floor(width * height / 8500)) }, () => ({
      x: seeded() * width, y: seeded() * height, r: 0.5 + seeded() * 1.2, a: 0.12 + seeded() * 0.32
    }));
    if (!run) target = { x: width / 2, y: height / 2 };
  }

  function visibleBounds() {
    return {
      left: 18, right: Math.max(19, width - 18),
      top: Math.min(112, height * 0.16), bottom: Math.max(120, height - Math.min(118, height * 0.16))
    };
  }

  function spawnObject(forceX, forceY, forceRadius, forceValue, forceColor, isShard = false) {
    if (!run) return;
    if (run.objects.length >= MAX_OBJECTS) run.objects.shift();
    const bounds = visibleBounds();
    let radius = forceRadius;
    if (!Number.isFinite(radius)) {
      const r = Math.random();
      radius = r < 0.64 ? rand(4, 8) : (r < 0.93 ? rand(8, 13) : rand(14, 20));
    }
    const index = Number.isInteger(forceColor) ? forceColor : Math.floor(Math.random() * COLOR_SET.length);
    run.objects.push({
      x: Number.isFinite(forceX) ? forceX : rand(bounds.left, bounds.right),
      y: Number.isFinite(forceY) ? forceY : rand(bounds.top, bounds.bottom),
      r: radius,
      value: Number.isFinite(forceValue) ? forceValue : Math.max(1, Math.round(Math.pow(radius / 8.5, 1.35))),
      color: COLOR_SET[index], colorIndex: index, critChecked: false, isShard, phase: Math.random() * 6.28
    });
  }

  function currentStats() {
    const p = state.upgrades;
    const b = run ? run.bonuses : { size: 0, suction: 0, magnet: 0, crit: 0 };
    return {
      radius: 14 + p.size * 1.4 + b.size,
      follow: 7 + p.speed * 0.45,
      suction: 1.8 + p.speed * 0.14 + b.suction,
      magnet: 82 + p.magnet * 16 + b.magnet,
      crit: Math.min(0.30, p.crit * 0.018 + b.crit)
    };
  }

  function startRun() {
    try {
      run = {
        elapsed: 0, value: 0, swallowed: 0, xp: 0, nextXp: 20, level: 0,
        objects: [], spawnClock: 0, colorLast: -1, colorStreak: 0, echoMeter: 0,
        bonuses: { size: 0, suction: 0, magnet: 0, crit: 0, echo: 0, combo: 0, reward: 1, split: 0 },
        hole: { x: width / 2, y: height * 0.53 }
      };
      target = { x: run.hole.x, y: run.hole.y };
      for (let i = 0; i < 42; i++) spawnObject();
      mode = 'run';
      ui.topHud.classList.add('visible');
      ui.bottomHud.classList.add('visible');
      showScreen('');
      updateHud();
    } catch (error) {
      console.error('开始游戏失败：', error);
      showToast('游戏启动失败，请刷新页面后重试。');
    }
  }

  function triggerDraft() {
    if (!run) return;
    mode = 'draft';
    const choices = ROGUE.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    ui.draftTitle.textContent = `局内临时强化 · Lv.${run.level + 1}`;
    ui.draftOptions.innerHTML = choices.map((item) => `<button class="draft-card" type="button" data-choice="${item.id}"><span class="draft-icon">${item.icon}</span><span class="draft-copy"><strong>${item.name}</strong><span>${item.desc}</span></span><span class="draft-arrow">›</span></button>`).join('');
    ui.topHud.classList.remove('visible');
    ui.bottomHud.classList.remove('visible');
    showScreen('screen-draft');
  }

  function applyRogue(id) {
    if (!run) return;
    const b = run.bonuses;
    switch (id) {
      case 'size': b.size += 2.5; break;
      case 'suction': b.suction += 0.45; break;
      case 'magnet': b.magnet += 25; break;
      case 'crit': b.crit += 0.07; break;
      case 'echo': b.echo = Math.min(2, b.echo + 1); break;
      case 'combo': b.combo += 1; break;
      case 'reward': b.reward = Math.min(1.5, b.reward + 0.10); break;
      case 'split': b.split = Math.min(0.35, b.split + 0.12); break;
      default: return;
    }
    run.level += 1;
    mode = 'run';
    ui.topHud.classList.add('visible');
    ui.bottomHud.classList.add('visible');
    showScreen('');
    updateHud();
  }

  function swallow(index, critical) {
    if (!run || index < 0 || index >= run.objects.length) return;
    const item = run.objects.splice(index, 1)[0];
    let points = item.value * (critical ? 2 : 1);
    if (run.colorLast === item.colorIndex) run.colorStreak += 1;
    else { run.colorLast = item.colorIndex; run.colorStreak = 1; }
    if (run.bonuses.combo > 0 && run.colorStreak >= 3) {
      const extra = Math.ceil(item.value * 0.75 * run.bonuses.combo);
      points += extra;
      run.colorStreak = 0;
      showToast(`同色连锁！额外 +${extra}`);
    }
    run.swallowed += 1;
    run.echoMeter += 1;
    if (run.bonuses.echo > 0 && run.echoMeter >= Math.max(3, 7 - run.bonuses.echo)) {
      run.echoMeter = 0;
      points += item.value * run.bonuses.echo;
    }
    run.value += points;
    run.xp += item.isShard ? 0 : (item.value >= 5 ? 2 : 1);
    if (!item.isShard && run.bonuses.split > 0 && Math.random() < run.bonuses.split) {
      for (let j = 0; j < 2; j++) spawnObject(run.hole.x + rand(-25, 25), run.hole.y + rand(-25, 25), 4, 1, item.colorIndex, true);
    }
    if (state.settings.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(8);
    if (run.xp >= run.nextXp) {
      run.xp -= run.nextXp;
      run.nextXp += 14 + run.level * 6;
      triggerDraft();
    }
  }

  function settleRun() {
    if (!run || mode !== 'run') return;
    mode = 'result';
    const reward = Math.max(3, Math.floor(run.value * 0.68 * (1 + state.upgrades.multiplier * 0.08) * run.bonuses.reward));
    state.essence += reward;
    state.bestRun = Math.max(state.bestRun, Math.floor(run.value));
    saveGame();
    ui.resultReward.textContent = fmt(reward);
    ui.resultValue.textContent = fmt(run.value);
    ui.resultCount.textContent = fmt(run.swallowed);
    ui.resultLevel.textContent = fmt(run.level);
    ui.resultTime.textContent = timeText(run.elapsed);
    ui.resultSubtitle.textContent = run.elapsed >= RUN_SECONDS ? '探索时长已到，星尘已安全结算。' : '引力场平稳归航，收获已计入星尘。';
    ui.topHud.classList.remove('visible');
    ui.bottomHud.classList.remove('visible');
    showScreen('screen-result');
  }

  function update(dt) {
    if (mode !== 'run' || !run) return;
    run.elapsed += dt;
    if (run.elapsed >= RUN_SECONDS) {
      run.elapsed = RUN_SECONDS;
      settleRun();
      return;
    }
    const stats = currentStats();
    const follow = Math.min(1, dt * stats.follow);
    run.hole.x += (target.x - run.hole.x) * follow;
    run.hole.y += (target.y - run.hole.y) * follow;
    run.spawnClock += dt;
    while (run.spawnClock >= 0.34) { run.spawnClock -= 0.34; spawnObject(); }

    for (let i = run.objects.length - 1; i >= 0; i--) {
      const item = run.objects[i];
      item.phase += dt * 1.6;
      let dx = run.hole.x - item.x;
      let dy = run.hole.y - item.y;
      let distance = Math.max(0.001, Math.hypot(dx, dy));
      if (distance < stats.magnet && item.r <= stats.radius * 2.15) {
        const proximity = 1 - distance / stats.magnet;
        const pull = Math.min(0.19, dt * (stats.suction + proximity * 2.7));
        item.x += dx * pull;
        item.y += dy * pull;
      }
      dx = run.hole.x - item.x;
      dy = run.hole.y - item.y;
      distance = Math.hypot(dx, dy);
      if (distance <= stats.radius * 0.78 + item.r * 0.62) {
        let eat = item.r <= stats.radius * 1.15;
        let critical = false;
        if (!eat && item.r <= stats.radius * 2.15 && !item.critChecked) {
          item.critChecked = true;
          if (Math.random() < stats.crit) { eat = true; critical = true; }
        }
        if (eat) {
          swallow(i, critical);
          if (mode !== 'run') break;
        }
      }
    }
    updateHud();
  }

  function draw() {
    if (!ctx || !width || !height) return;
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#101832');
    bg.addColorStop(0.55, '#0b1227');
    bg.addColorStop(1, '#090d1a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(145,158,220,.055)';
    for (let x = 0; x < width; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    for (const star of stars) {
      ctx.fillStyle = `rgba(190,190,255,${star.a})`;
      ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
    }
    if (run) {
      for (const item of run.objects) {
        const pulse = 1 + Math.sin(item.phase) * 0.045;
        ctx.save();
        ctx.shadowColor = item.color;
        ctx.shadowBlur = item.r * 1.1;
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(item.x - item.r * 0.22, item.y - item.r * 0.25, Math.max(1, item.r * 0.16), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    const hole = run ? run.hole : { x: width / 2, y: height * 0.5 };
    const radius = run ? currentStats().radius : 24;
    const pulse = 1 + Math.sin(performance.now() * 0.002) * 0.025;
    ctx.save();
    ctx.shadowColor = '#9c8cff'; ctx.shadowBlur = radius * 1.2;
    ctx.fillStyle = 'rgba(143,125,255,.12)'; ctx.beginPath(); ctx.arc(hole.x, hole.y, radius * 1.5 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(190,177,255,.82)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(hole.x, hole.y, radius * 1.06, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#070a15'; ctx.beginPath(); ctx.arc(hole.x, hole.y, radius * 0.84, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(126,110,230,.9)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(161,143,255,.55)'; ctx.beginPath(); ctx.arc(hole.x, hole.y, Math.max(2, radius * 0.07), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function setTargetFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const bounds = visibleBounds();
    target.x = clamp(event.clientX - rect.left, bounds.left, bounds.right);
    target.y = clamp(event.clientY - rect.top, bounds.top, bounds.bottom);
  }

  function bindEvents() {
    ui.start.addEventListener('click', startRun);
    ui.upgrades.addEventListener('click', () => { renderUpgrades(); showScreen('screen-upgrades'); });
    ui.upgradesBack.addEventListener('click', () => showScreen('screen-home'));
    ui.help.addEventListener('click', () => showScreen('screen-help'));
    ui.helpBack.addEventListener('click', () => showScreen('screen-home'));
    ui.settle.addEventListener('click', settleRun);
    ui.resultHome.addEventListener('click', () => { run = null; mode = 'home'; updateHomeStats(); showScreen('screen-home'); });
    ui.replay.addEventListener('click', startRun);
    ui.haptics.addEventListener('click', () => {
      state.settings.haptics = !state.settings.haptics;
      saveGame();
      showToast(`轻触震动已${state.settings.haptics ? '开启' : '关闭'}。`);
    });
    ui.upgradeList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-upgrade]');
      if (button && !button.disabled) buyUpgrade(button.dataset.upgrade);
    });
    ui.draftOptions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-choice]');
      if (button) applyRogue(button.dataset.choice);
    });
    ui.resetSave.addEventListener('click', () => {
      if (!window.confirm('确定清空本机存档和纪录吗？')) return;
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore */ }
      window.location.reload();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (mode !== 'run') return;
      event.preventDefault();
      pointerHeld = true;
      setTargetFromPointer(event);
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (mode === 'run' && pointerHeld) { event.preventDefault(); setTargetFromPointer(event); }
    });
    const release = () => { pointerHeld = false; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveGame();
    });
    window.addEventListener('pagehide', saveGame);
    window.addEventListener('resize', resizeCanvas);
  }

  function init() {
    const ids = {
      canvas: 'game-canvas', toast: 'toast', homeEssence: 'home-essence', homeBest: 'home-best',
      hudEssence: 'hud-essence', hudBest: 'hud-best', upgradeEssence: 'upgrade-essence',
      runClock: 'run-clock', runLevel: 'run-level', progressFill: 'progress-fill',
      topHud: 'top-hud', bottomHud: 'bottom-hud', upgradeList: 'upgrade-list',
      draftTitle: 'draft-title', draftOptions: 'draft-options', resultReward: 'result-reward',
      resultValue: 'result-value', resultCount: 'result-count', resultLevel: 'result-level',
      resultTime: 'result-time', resultSubtitle: 'result-subtitle', haptics: 'btn-haptics',
      offlineNote: 'offline-note', start: 'btn-start', upgrades: 'btn-upgrades',
      upgradesBack: 'btn-upgrades-back', help: 'btn-help', helpBack: 'btn-help-back',
      settle: 'btn-settle', resultHome: 'btn-result-home', replay: 'btn-result-replay', resetSave: 'btn-reset-save'
    };
    for (const [key, id] of Object.entries(ids)) ui[key] = $(id);
    if (Object.values(ui).some((value) => !value)) {
      console.error('页面缺少必要的游戏元素。');
      return;
    }
    canvas = ui.canvas;
    ctx = canvas.getContext('2d');
    if (!ctx) {
      showToast('此浏览器不支持 Canvas，请更换浏览器。');
      return;
    }
    state = readSave();
    resizeCanvas();
    bindEvents();
    updateHomeStats();
    saveGame();
    if (offlineReward > 0) {
      ui.offlineNote.hidden = false;
      ui.offlineNote.textContent = `离线收集到 ${fmt(offlineReward)} ✦（最多计算 4 小时）。`;
    }
    let previous = performance.now();
    const frame = (now) => {
      const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.05);
      previous = now;
      update(dt);
      draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
