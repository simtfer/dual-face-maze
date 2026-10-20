/*!
 * main.js — 引导层：画布、输入、HUD、覆盖层、关卡流程
 * 依赖：maze.js / game.js / render.js
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  var Game = MZ.Game;
  var Render = MZ.Render;

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game');
  var ctx = canvas.getContext('2d');
  var ui = {
    level: $('ui-level'), face: $('ui-face'), faceText: $('ui-face-text'),
    tunnels: $('ui-tunnels'), crystals: $('ui-crystals'), steps: $('ui-steps'), time: $('ui-time'),
    ltMain: $('lt-main'), ltSub: $('lt-sub'), toast: $('toast'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovSub: $('ov-sub'), ovBody: $('ov-body'),
    ovBtn: $('ov-btn'), ovActions: $('ov-actions'), ovRetry: $('ov-retry'), ovMenu: $('ov-menu'),
    btnHint: $('btn-hint'), btnReset: $('btn-reset'), btnSound: $('btn-sound'), btnHelp: $('btn-help'),
    btnWarp: $('btn-warp')
  };

  /* ---------------- 画布 ---------------- */
  var W = 0, H = 0, dpr = 1, lay = null;
  var topPad = 88, bottomPad = 64;

  /** 按实际 DOM 高度预留画布留白，避免和 HUD / 工具栏 / 穿梭按钮重叠 */
  function updateMetrics() {
    var hudBottom = $('topbar').getBoundingClientRect().bottom;
    var toolbarH = $('toolbar').getBoundingClientRect().height;
    var warpH = $('btn-warp').getBoundingClientRect().height || 44;
    topPad = hudBottom + 14;
    bottomPad = toolbarH + 16 + warpH + 10;
    // 穿梭按钮贴在工具栏正上方，位于迷宫下方预留区内
    ui.btnWarp.style.bottom = (toolbarH + 14) + 'px';
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateMetrics();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  resize();

  /* ---------------- 音效 ---------------- */
  var Sound = (function () {
    var ac = null, muted = false;
    function ctxAudio() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, dur, type, vol, delay, sweepTo) {
      if (muted) return;
      var a = ctxAudio();
      if (!a) return;
      var t0 = a.currentTime + (delay || 0);
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(a.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    return {
      get muted() { return muted; },
      toggle: function () { muted = !muted; ui.btnSound.classList.toggle('on', !muted); return muted; },
      move: function () { tone(300 + Math.random() * 40, 0.05, 'sine', 0.035); },
      wall: function () { tone(110, 0.07, 'square', 0.025); },
      warp: function () { tone(220, 0.32, 'sawtooth', 0.04, 0, 900); tone(660, 0.28, 'sine', 0.03, 0.06, 240); },
      crystal: function () { tone(880, 0.1, 'triangle', 0.05); tone(1320, 0.12, 'triangle', 0.04, 0.07); },
      win: function () {
        [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.4, 'triangle', 0.05, i * 0.11); });
      }
    };
  })();

  /* ---------------- 关卡流程 ---------------- */
  var levelIndex = 0;
  var state = null;
  var started = false;

  function levelDef(index) {
    var LEVELS = Game.LEVELS;
    if (index < LEVELS.length) return LEVELS[index];
    var over = index - LEVELS.length + 1;
    var base = LEVELS[LEVELS.length - 1];
    return {
      cols: Math.min(17, base.cols + Math.floor(over / 2)),
      rows: Math.min(23, base.rows + over),
      regions: Math.min(8, base.regions + Math.floor(over / 2)),
      minSize: Math.max(7, base.minSize - 1),
      name: '无尽回廊 ' + over
    };
  }

  function startLevel(index) {
    levelIndex = index;
    var def = levelDef(index);
    state = Game.create(index, null, def);
    started = true;
    ui.ltMain.textContent = def.name;
    ui.ltSub.textContent = '第 ' + (index + 1) + ' 关 · ' + state.level.tunnelCount + ' 口竖井 · ' +
      state.level.regionCount * 2 + ' 间密室 · 集齐 ' + state.level.crystals.length + ' 枚符印开启终点';
    updateMetrics();
    updateHUD();
    hideOverlay();
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateHUD() {
    if (!state) return;
    var lv = state.level;
    ui.level.textContent = (levelIndex + 1) + '/' + Math.max(Game.LEVELS.length, levelIndex + 1);
    var isBack = state.side === Game.BACK;
    ui.face.classList.toggle('back', isBack);
    ui.faceText.textContent = isBack ? '背面' : '正面';
    ui.tunnels.textContent = state.tunnelsUsed + '/' + lv.tunnelCount;
    ui.crystals.textContent = state.crystalsTaken + '/' + lv.crystals.length;
    ui.steps.textContent = state.steps;
    ui.time.textContent = fmtTime(state.elapsed);

    var onTunnel = !!Game.tunnelAtCell(state, state.player.cell);
    ui.btnWarp.classList.toggle('show', onTunnel && !state.finished);
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(text, warn) {
    ui.toast.textContent = text;
    ui.toast.classList.toggle('warn', !!warn);
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.classList.remove('show'); }, 1500);
  }

  /* ---------------- 覆盖层 ---------------- */
  var overlayMode = 'help'; // 'help' | 'win'

  function showOverlay(title, sub, bodyHtml, btnText, showActions) {
    ui.ovTitle.textContent = title;
    ui.ovSub.textContent = sub || '';
    ui.ovBody.innerHTML = bodyHtml;
    ui.ovBtn.textContent = btnText;
    ui.ovActions.style.display = showActions ? 'flex' : 'none';
    ui.overlay.classList.remove('hidden');
  }
  function hideOverlay() { ui.overlay.classList.add('hidden'); }

  function helpHtml() {
    return '<p>这座迷宫有 <b>正面</b> 与 <b>背面</b> 两面。每条 <span class="tag gold">隧道</span> 都是一口<b>贯穿两面的竖井</b> —— 在正反两面落在<b>同一个格子</b>上，掉下去就会从另一面的同一位置出来。</p>' +
      '<ul>' +
      '<li>每面迷宫被封成若干<b>密室</b>，密室之间只能靠竖井通行。</li>' +
      '<li>中间密室只有<b>一个进、一个出</b>两个洞口，所以竖井必须<b>按顺序</b>穿，一条都绕不过。</li>' +
      '<li>洞口上有编号；<b>同一编号在正反两面位置完全重合</b>，两面颜色不同、半环相接的标记就是这口竖井。</li>' +
      '<li>集齐全部 <span class="tag">符印</span> 后，<span class="tag green">终点</span>才会开启。</li>' +
      '</ul>' +
      '<p>步数越接近最优，评级越高。</p>';
  }

  function showHelp(firstTime) {
    overlayMode = 'help';
    showOverlay(
      firstTime ? '双面迷宫' : '玩法说明',
      firstTime ? 'Dual-Face Maze · 不断穿梭，直到终点' : '',
      helpHtml() +
      '<div class="stats">' +
      '<div class="stat"><div class="sv">WASD</div><div class="sk">移动方向</div></div>' +
      '<div class="stat"><div class="sv">空格</div><div class="sk">穿越隧道</div></div>' +
      '<div class="stat"><div class="sv">H</div><div class="sk">路径提示</div></div>' +
      '<div class="stat"><div class="sv">R</div><div class="sk">重开本关</div></div>' +
      '</div>' +
      '<p style="font-size:12px;color:#8fa4c0">移动端：滑动方向、点击格子自动寻路、站在洞口点「穿梭」。</p>',
      firstTime ? '开始游戏' : '继续', false);
  }

  function rankOf(st, lv) {
    var all = st.crystalsTaken === lv.crystals.length;
    var base = all ? lv.optimalFull : lv.optimal;
    var ratio = base > 0 ? st.steps / base : 2;
    var g;
    if (all) {
      if (ratio <= 1.10) g = 'S';
      else if (ratio <= 1.28) g = 'A';
      else if (ratio <= 1.55) g = 'B';
      else g = 'C';
    } else {
      if (ratio <= 1.15) g = 'B';
      else if (ratio <= 1.6) g = 'C';
      else g = 'D';
    }
    return g;
  }

  function showWin() {
    overlayMode = 'win';
    var lv = state.level;
    var g = rankOf(state, lv);
    var all = state.crystalsTaken === lv.crystals.length;
    var body = '<div class="stats">' +
      '<div class="stat"><div class="sv">' + state.steps + '</div><div class="sk">步数</div></div>' +
      '<div class="stat"><div class="sv">' + fmtTime(state.elapsed) + '</div><div class="sk">用时</div></div>' +
      '<div class="stat"><div class="sv">' + state.crystalsTaken + '/' + lv.crystals.length + '</div><div class="sk">符印</div></div>' +
      '<div class="stat"><div class="sv">' + lv.tunnelCount + '</div><div class="sk">穿隧道</div></div>' +
      '</div>' +
      '<p style="font-size:12px;color:#8fa4c0">' +
      (all
        ? '本关全收集最优步数约 ' + lv.optimalFull + ' 步。'
        : '本关最优步数约 ' + lv.optimal + ' 步（未集齐符印）。') +
      '</p>' +
      '<div class="rank">评级 ' + g + ' 级</div>';
    var isLast = levelIndex >= Game.LEVELS.length - 1;
    showOverlay('过关！', levelDef(levelIndex).name, body,
      isLast ? '进入无尽模式' : '下一关', true);
    Sound.win();
  }

  /* ---------------- 输入 ---------------- */
  var pendingDir = null;

  function attemptMove(dir) {
    if (!state || state.finished || state.flip.active) return;
    if (state.player.moving) { pendingDir = dir; return; }
    var ok = Game.tryMove(state, dir);
    if (ok) {
      Sound.move();
      var t = Game.tunnelAtCell(state, state.player.cell);
      if (t && Game.expectedTunnel(state) === t) toast('这里是隧道，按空格穿梭');
    } else {
      Sound.wall();
    }
  }

  function attemptWarp() {
    if (!state || state.finished || state.flip.active) return;
    var t = Game.tunnelAtCell(state, state.player.cell);
    if (!t) { toast('脚下没有隧道', true); Sound.wall(); return; }
    if (Game.tryTraverse(state)) {
      Sound.warp();
      toast('穿梭到' + (state.side === Game.BACK ? '背面' : '正面'));
    }
  }

  var KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'warp', KeyE: 'warp', KeyF: 'warp', Enter: 'warp'
  };

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.repeat) return;
    var act = KEYMAP[e.code];
    if (act) {
      if (!started) { startLevel(0); return; }
      if (act === 'warp') attemptWarp(); else attemptMove(act);
      return;
    }
    if (e.code === 'KeyH') {
      if (!started) return;
      var on = Game.toggleHint(state);
      ui.btnHint.classList.toggle('on', on);
      toast(on ? '提示已开启' : '提示已关闭');
    } else if (e.code === 'KeyR') {
      if (!started) return;
      startLevel(levelIndex);
      toast('已重开本关');
    } else if (e.code === 'KeyM') {
      var muted = Sound.toggle();
      toast(muted ? '音效已关闭' : '音效已开启');
    } else if (e.code === 'Slash' || e.code === 'F1') {
      showHelp(false);
    }
  });

  /* 鼠标点击：自动寻路 */
  function cellAt(clientX, clientY) {
    if (!lay) return -1;
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left, y = clientY - rect.top;
    var gx = Math.floor((x - lay.ox) / lay.cs);
    var gy = Math.floor((y - lay.oy) / lay.cs);
    if (gx < 0 || gy < 0 || gx >= lay.cols || gy >= lay.rows) return -1;
    return gy * lay.cols + gx;
  }

  canvas.addEventListener('mousedown', function (e) {
    if (!started || !state || state.finished) return;
    var cell = cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    if (cell === state.player.cell) {
      if (Game.tunnelAtCell(state, cell)) attemptWarp();
      return;
    }
    Game.pathTo(state, cell);
  });

  /* 触屏：滑动移动，轻点自动寻路 */
  var touchStart = null;
  canvas.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  canvas.addEventListener('touchend', function (e) {
    if (!touchStart || !started || !state || state.finished) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    touchStart = null;
    if (adx < 26 && ady < 26) {
      var cell = cellAt(t.clientX, t.clientY);
      if (cell < 0) return;
      if (cell === state.player.cell) {
        if (Game.tunnelAtCell(state, cell)) attemptWarp();
      } else {
        Game.pathTo(state, cell);
      }
      return;
    }
    if (adx > ady) attemptMove(dx > 0 ? 'right' : 'left');
    else attemptMove(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  /* 按钮 */
  ui.btnHint.addEventListener('click', function () {
    if (!started) return;
    var on = Game.toggleHint(state);
    ui.btnHint.classList.toggle('on', on);
    toast(on ? '提示已开启' : '提示已关闭');
  });
  ui.btnReset.addEventListener('click', function () {
    if (!started) return;
    startLevel(levelIndex);
    toast('已重开本关');
  });
  ui.btnSound.addEventListener('click', function () {
    var muted = Sound.toggle();
    toast(muted ? '音效已关闭' : '音效已开启');
  });
  ui.btnHelp.addEventListener('click', function () { showHelp(false); });
  ui.btnWarp.addEventListener('click', attemptWarp);

  ui.ovBtn.addEventListener('click', function () {
    if (overlayMode === 'win') {
      startLevel(levelIndex + 1);
    } else if (!started) {
      startLevel(0);
    } else {
      hideOverlay();
    }
  });
  ui.ovRetry.addEventListener('click', function () { startLevel(levelIndex); });
  ui.ovMenu.addEventListener('click', function () { showHelp(false); });

  /* ---------------- 主循环 ---------------- */
  var last = performance.now();
  var time = 0;

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;

    if (started && state) {
      Game.update(state, dt);
      if (state.finished && state.won && !state.winShown) {
        state.winShown = true;
        showWin();
      }
      updateHUD();
    }

    var cols = state.level.def.cols;
    var rows = state.level.def.rows;
    lay = Render.layout(W, H, cols, rows, topPad, bottomPad);
    Render.draw(ctx, state, lay, time);

    if (pendingDir && state && !state.player.moving) {
      var d = pendingDir; pendingDir = null;
      attemptMove(d);
    }

    requestAnimationFrame(frame);
  }

  /* ---------------- 启动 ---------------- */
  ui.btnSound.classList.add('on');
  // 先建一个第 1 关用于背景渲染，真正开始时按新种子重新生成
  state = Game.create(0, null, levelDef(0));
  showHelp(true);
  requestAnimationFrame(frame);

  // 调试用
  window.__maze = {
    get state() { return state; },
    startLevel: startLevel,
    Game: Game
  };
})();
