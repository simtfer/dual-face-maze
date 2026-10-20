/*!
 * game.js — 双面迷宫玩法逻辑：关卡构建、隧道链、状态机
 * 无 DOM 依赖，可在浏览器与 Node（无头测试）中运行。
 */
(function (root, factory) {
  var MZ;
  if (typeof module === 'object' && module.exports) MZ = require('./maze.js');
  else MZ = root.MZ;

  var api = factory(MZ);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MZ = root.MZ || {}; root.MZ.Game = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MZ) {
  'use strict';

  var FRONT = 0, BACK = 1;

  var LEVELS = [
    { cols: 7,  rows: 9,  regions: 2, minSize: 7,  name: '初窥双面' },
    { cols: 9,  rows: 13, regions: 3, minSize: 9,  name: '错层回廊' },
    { cols: 9,  rows: 13, regions: 4, minSize: 7,  name: '四象迷枢' },
    { cols: 11, rows: 15, regions: 4, minSize: 9,  name: '狭道深折' },
    { cols: 11, rows: 15, regions: 5, minSize: 8,  name: '五环套叠' },
    { cols: 13, rows: 17, regions: 6, minSize: 8,  name: '无尽之门' }
  ];

  /** 每次进入一个格子耗时（秒），用于平滑移动动画 */
  var MOVE_DUR = 0.115;
  var FLIP_DUR = 0.62;

  var state = null;

  function pickCell(region, used, rng) {
    var candidates = region.filter(function (c) { return !used.has(c); });
    if (!candidates.length) candidates = region;
    var cell = candidates[(rng() * candidates.length) | 0];
    used.add(cell);
    return cell;
  }

  /**
   * 在网格上找一条 len 格的折线（相邻格相连、互不重复），
   * 作为「隧道竖井」的落点序列。选点时优先远离已选点，让折线尽量铺开。
   */
  function findShaftPath(cols, rows, len, rng) {
    var total = cols * rows;
    for (var attempt = 0; attempt < 80; attempt++) {
      var path = [];
      var used = new Set();
      var start = (rng() * total) | 0;
      path.push(start); used.add(start);
      var cur = start;

      while (path.length < len) {
        var cx = cur % cols, cy = (cur / cols) | 0;
        var cands = [];
        for (var k = 0; k < 4; k++) {
          var d = MZ.DIRS[k];
          var nx = cx + d.dx, ny = cy + d.dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          var ni = ny * cols + nx;
          if (used.has(ni)) continue;
          cands.push(ni);
        }
        if (!cands.length) break;   // 被堵死，重来

        // 选离已有点最远的候选，让折线铺开而不是挤成一团
        var best = -1, bestScore = -1;
        for (var i = 0; i < cands.length; i++) {
          var ci = cands[i];
          var ax = ci % cols, ay = (ci / cols) | 0;
          var minD = 1e9;
          for (var t = 0; t < path.length; t++) {
            var px = path[t] % cols, py = (path[t] / cols) | 0;
            var dd = Math.abs(ax - px) + Math.abs(ay - py);
            if (dd < minD) minD = dd;
          }
          var score = minD + rng() * 0.85;   // 随机扰动，避免每次形状雷同
          if (score > bestScore) { bestScore = score; best = ci; }
        }
        path.push(best); used.add(best); cur = best;
      }

      if (path.length === len) return path;
    }
    return null;
  }

  /**
   * 构建一个关卡。
   *
   * 核心机制：
   *   1. 先在网格上生成一条 2k-1 格的折线「竖井链」shaft[0..2k-2]；
   *   2. 正面第 i 间密室的种子是 {shaft[2i-1], shaft[2i]}，
   *      背面第 i 间密室的种子是 {shaft[2i], shaft[2i+1]} —— 两面错位咬合；
   *   3. 于是第 j 条隧道落在 shaft[j]：它在正反两面是<b>同一格</b>，
   *      是一条真正贯穿的竖井，从正面掉下去就在背面的同一位置出来；
   *   4. 每面密室按种子生长、互不连通，中间密室恰好只有进/出两个洞口，
   *      玩家无法跳过任何一条隧道，终点只在最后一间密室里。
   */
  function buildLevel(def, fixedSeed) {
    var seed = fixedSeed != null ? fixedSeed
      : (((Date.now() ^ ((Math.random() * 1e9) | 0)) >>> 0) || 1);

    for (var attempt = 0; attempt < 40; attempt++) {
      var rng = MZ.mulberry32((seed + attempt * 7919) >>> 0);
      var k = def.regions;

      // 1) 竖井链
      var shaft = findShaftPath(def.cols, def.rows, 2 * k - 1, rng);
      if (!shaft) continue;

      // 2) 两面各自的密室种子（错位咬合）
      var seeds = [[], []];
      for (var i = 0; i < k; i++) {
        seeds[FRONT].push(i === 0 ? [shaft[0]] : [shaft[2 * i - 1], shaft[2 * i]]);
        seeds[BACK].push(i === k - 1 ? [shaft[2 * k - 2]] : [shaft[2 * i], shaft[2 * i + 1]]);
      }

      // 3) 两面各自生长密室并雕刻走廊
      var faces = [], regionSets = [], ok = true;
      for (var s = 0; s < 2; s++) {
        var grown = MZ.growRegions(def.cols, def.rows, seeds[s], rng);
        if (!grown.complete) { ok = false; break; }
        for (var j = 0; j < k; j++) {
          if (grown.sizes[j] < def.minSize) { ok = false; break; }
        }
        if (!ok) break;
        faces.push(MZ.Maze.fromLabels(def.cols, def.rows, grown.label, k, rng));
        regionSets.push(grown.cells);
      }
      if (!ok) continue;

      // 4) 隧道链：第 j 条隧道在 shaft[j]，正反两面同位
      var tunnels = [];
      for (var j = 0; j < 2 * k - 1; j++) {
        tunnels.push({
          id: j + 1,
          cell: shaft[j],
          a: { side: (j % 2 === 0) ? FRONT : BACK, cell: shaft[j] },
          b: { side: (j % 2 === 0) ? BACK : FRONT, cell: shaft[j] },
          used: false
        });
      }

      // 竖井格在两面都被占用了，其它落点要避开
      var used = [new Set(shaft), new Set(shaft)];

      var startCell = pickCell(regionSets[FRONT][0], used[FRONT], rng);
      var goalCell = pickCell(regionSets[BACK][k - 1], used[BACK], rng);

      // 每个链节点一枚符印
      var crystals = [];
      for (var n = 0; n < 2 * k; n++) {
        var ns = (n % 2 === 0) ? FRONT : BACK;
        var nc = regionSets[ns][Math.floor(n / 2)];
        crystals.push({ side: ns, cell: pickCell(nc, used[ns], rng), taken: false });
      }

      var lv = {
        def: def,
        seed: seed,
        faces: faces,
        regions: regionSets,
        tunnels: tunnels,
        shaft: shaft,
        crystals: crystals,
        start: { side: FRONT, cell: startCell },
        goal: { side: BACK, cell: goalCell },
        regionCount: k,
        tunnelCount: tunnels.length
      };
      lv.optimal = computeOptimal(lv);
      lv.optimalFull = computeOptimalFull(lv);
      return lv;
    }
    throw new Error('关卡生成失败：无法切分出足够的密室');
  }

  /**
   * 综合图（正面 + 背面 + 隧道）上的最短步数，用于通关评级。
   */
  function computeOptimal(level) {
    var cols = level.def.cols, rows = level.def.rows;
    var total = cols * rows;
    var dist = new Int32Array(total * 2).fill(-1);
    var tunnelOf = new Map();
    for (var t = 0; t < level.tunnels.length; t++) {
      var tun = level.tunnels[t];
      tunnelOf.set(tun.a.side + ':' + tun.a.cell, tun.b);
      tunnelOf.set(tun.b.side + ':' + tun.b.cell, tun.a);
    }
    var startId = level.start.side * total + level.start.cell;
    var goalId = level.goal.side * total + level.goal.cell;
    dist[startId] = 0;
    var queue = [startId], head = 0;

    while (head < queue.length) {
      var u = queue[head++];
      var s = (u / total) | 0, c = u % total;
      var d = dist[u] + 1;
      var maze = level.faces[s];
      var x = c % cols, y = (c / cols) | 0;
      for (var k = 0; k < 4; k++) {
        var dir = MZ.DIRS[k];
        if (maze.walls[c] & dir.bit) continue;
        var nx = x + dir.dx, ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var v = s * total + ny * cols + nx;
        if (dist[v] === -1) { dist[v] = d; queue.push(v); }
      }
      var tp = tunnelOf.get(s + ':' + c);
      if (tp) {
        var v2 = tp.side * total + tp.cell;
        if (dist[v2] === -1) { dist[v2] = d; queue.push(v2); }
      }
    }
    return dist[goalId];
  }

  /**
   * 全收集基准步数：每个密室恰好 1 枚符印，
   * 路线 = 逐密室「入口 → 符印 → 出口」的最短路之和 + 隧道穿越次数。
   */
  function computeOptimalFull(level) {
    var chainLen = level.regionCount * 2;
    var total = 0;
    for (var n = 0; n < chainLen; n++) {
      var side = (n % 2 === 0) ? FRONT : BACK;
      var maze = level.faces[side];
      var entry = (n === 0) ? level.start.cell : mouthOn(level.tunnels[n - 1], side);
      var exit = (n === chainLen - 1) ? level.goal.cell : mouthOn(level.tunnels[n], side);
      var crystal = level.crystals[n].cell;
      var p1 = maze.findPath(entry, crystal);
      var p2 = maze.findPath(crystal, exit);
      if (p1 === null || p2 === null) return level.optimal;
      total += p1.length + p2.length;
    }
    return total + (chainLen - 1);
  }
  function newState(levelIndex, fixedSeed, defOverride) {
    var def = defOverride || LEVELS[Math.min(levelIndex, LEVELS.length - 1)];
    var lv = buildLevel(def, fixedSeed);
    var s = {
      levelIndex: levelIndex,
      level: lv,
      side: FRONT,
      stage: 0,               // 当前所处的链节点序号
      player: {
        cell: lv.start.cell,
        rx: lv.start.cell % def.cols + 0.5,
        ry: Math.floor(lv.start.cell / def.cols) + 0.5,
        fromX: 0, fromY: 0, toX: 0, toY: 0, t: 1, dur: MOVE_DUR,
        moving: false
      },
      queue: [],             // 自动寻路待走队列
      flip: { active: false, t: 0, dur: FLIP_DUR, from: FRONT },
      hintOn: false,
      hintPath: [],
      steps: 0,
      tunnelsUsed: 0,
      crystalsTaken: 0,
      elapsed: 0,
      running: false,
      finished: false,
      won: false,
      message: '',
      messageT: 0,
      goalLockedToast: false,
      lastWarp: null,
      ripple: null
    };
    s.player.fromX = s.player.rx;
    s.player.fromY = s.player.ry;
    s.player.toX = s.player.rx;
    s.player.toY = s.player.ry;
    return s;
  }

  function cellOf(state_, side, cell) {
    return state_.level.faces[side];
  }

  /** 站在当前面时，某个隧道的洞口位置 */
  function mouthOn(tunnel, side) {
    return tunnel.a.side === side ? tunnel.a.cell : tunnel.b.cell;
  }

  /** 当前玩家脚下是否是某条隧道的洞口 */
  function tunnelAtCell(state_, cell) {
    var tunnels = state_.level.tunnels;
    for (var i = 0; i < tunnels.length; i++) {
      if (mouthOn(tunnels[i], state_.side) === cell) return tunnels[i];
    }
    return null;
  }

  /** 当前应该使用的隧道（链上的下一条） */
  function expectedTunnel(state_) {
    var tunnels = state_.level.tunnels;
    if (state_.stage < 0 || state_.stage >= tunnels.length) return null;
    return tunnels[state_.stage];
  }

  function showMessage(state_, text, dur) {
    state_.message = text;
    state_.messageT = dur || 1.6;
  }

  function collectCrystals(state_) {
    var list = state_.level.crystals;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.taken) continue;
      if (c.side === state_.side && c.cell === state_.player.cell) {
        c.taken = true;
        state_.crystalsTaken++;
        state_.goalLockedToast = false;
        showMessage(state_, '获得符印 ' + state_.crystalsTaken + '/' + list.length, 1.2);
      }
    }
  }

  /**
   * 终点判定：只有集齐全部符印后终点才会「开启」，
   * 否则走到终点格只会提示还差几枚，不会提前结束关卡。
   */
  function checkGoal(state_) {
    var g = state_.level.goal;
    if (state_.side !== g.side || state_.player.cell !== g.cell) return;
    var total = state_.level.crystals.length;
    if (state_.crystalsTaken < total) {
      if (!state_.goalLockedToast) {
        state_.goalLockedToast = true;
        showMessage(state_, '终点尚未开启，还差 ' + (total - state_.crystalsTaken) + ' 枚符印', 1.6);
      }
      return;
    }
    state_.finished = true;
    state_.won = true;
    state_.running = false;
  }

  function updateHint(state_) {
    state_.hintPath = [];
    if (!state_.hintOn || state_.finished) return;
    var t = expectedTunnel(state_);
    if (!t) return;
    var target = mouthOn(t, state_.side);
    var path = state_.level.faces[state_.side].findPath(state_.player.cell, target);
    state_.hintPath = path || [];
  }

  /** 方向移动；返回是否成功 */
  function tryMove(state_, dirName) {
    if (state_.finished || state_.flip.active) return false;
    if (state_.player.moving) return false;
    var maze = state_.level.faces[state_.side];
    var target = maze.step(state_.player.cell, dirName);
    if (target < 0) {
      showMessage(state_, '那边是墙', 0.6);
      return false;
    }
    startMove(state_, target);
    return true;
  }

  function startMove(state_, target) {
    var p = state_.player;
    var cols = state_.level.def.cols;
    p.fromX = p.rx; p.fromY = p.ry;
    p.toX = (target % cols) + 0.5;
    p.toY = Math.floor(target / cols) + 0.5;
    p.t = 0;
    p.moving = true;
    p.cell = target;
    state_.steps++;
    state_.running = true;
    collectCrystals(state_);
    checkGoal(state_);
    updateHint(state_);
  }

  /** 穿越隧道（站在洞口时按空格） */
  function tryTraverse(state_) {
    if (state_.finished || state_.flip.active) return false;
    if (state_.player.moving) return false;
    var t = tunnelAtCell(state_, state_.player.cell);
    if (!t) {
      showMessage(state_, '这里没有隧道', 0.8);
      return false;
    }
    var from = state_.side;
    var to = (t.a.side === from) ? t.b : t.a;
    state_.side = to.side;
    state_.player.cell = to.cell;

    var cols = state_.level.def.cols;
    state_.player.fromX = state_.player.rx;
    state_.player.fromY = state_.player.ry;
    state_.player.toX = (to.cell % cols) + 0.5;
    state_.player.toY = Math.floor(to.cell / cols) + 0.5;
    state_.player.t = 0;
    state_.player.dur = 0.3;
    state_.player.moving = true;

    if (t.id - 1 === state_.stage) state_.stage++;          // 前进
    else if (t.id - 1 === state_.stage - 1) state_.stage--; // 原路退回
    t.used = true;
    state_.steps++; // 隧道穿越也计一步，便于与最优步数对齐
    state_.tunnelsUsed = countUsedTunnels(state_);
    state_.flip = { active: true, t: 0, dur: FLIP_DUR, from: from };
    state_.lastWarp = { cell: to.cell, id: t.id };   // 翻转特效用：刚刚穿过的那口竖井
    state_.ripple = { cell: to.cell, t: 0, dur: 0.5 };
    state_.queue.length = 0;
    state_.running = true;
    collectCrystals(state_);
    checkGoal(state_);
    updateHint(state_);
    return true;
  }

  function countUsedTunnels(state_) {
    var n = 0, tunnels = state_.level.tunnels;
    for (var i = 0; i < tunnels.length; i++) if (tunnels[i].used) n++;
    return n;
  }

  /** 点击目标格：自动寻路走过去（只在当前密室范围内） */
  function pathTo(state_, cell) {
    if (state_.finished || state_.flip.active) return false;
    var maze = state_.level.faces[state_.side];
    var path = maze.findPath(state_.player.cell, cell);
    if (path === null) {
      showMessage(state_, '那边暂时走不通', 1.0);
      return false;
    }
    state_.queue = path;
    return true;
  }

  function toggleHint(state_) {
    state_.hintOn = !state_.hintOn;
    updateHint(state_);
    return state_.hintOn;
  }

  function update(state_, dt) {
    if (state_.finished) return;
    if (state_.running) state_.elapsed += dt;

    if (state_.messageT > 0) {
      state_.messageT -= dt;
      if (state_.messageT <= 0) state_.message = '';
    }

    var p = state_.player;
    if (p.moving) {
      p.t += dt / p.dur;
      if (p.t >= 1) { p.t = 1; p.moving = false; p.dur = MOVE_DUR; }
      var e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2; // easeInOutQuad
      p.rx = p.fromX + (p.toX - p.fromX) * e;
      p.ry = p.fromY + (p.toY - p.fromY) * e;
    } else if (state_.queue.length) {
      var next = state_.queue.shift();
      var maze = state_.level.faces[state_.side];
      var ok = false;
      var dirs = ['up', 'right', 'down', 'left'];
      for (var i = 0; i < 4; i++) {
        if (maze.step(p.cell, dirs[i]) === next) { tryMove(state_, dirs[i]); ok = true; break; }
      }
      if (!ok) state_.queue.length = 0;
    }

    if (state_.flip.active) {
      state_.flip.t += dt / state_.flip.dur;
      if (state_.flip.t >= 1) { state_.flip.t = 1; state_.flip.active = false; }
    }

    if (state_.ripple) {
      state_.ripple.t += dt / state_.ripple.dur;
      if (state_.ripple.t >= 1) state_.ripple = null;
    }
  }

  function create(levelIndex, fixedSeed, defOverride) {
    state = newState(levelIndex, fixedSeed, defOverride);
    return state;
  }

  return {
    FRONT: FRONT,
    BACK: BACK,
    LEVELS: LEVELS,
    MOVE_DUR: MOVE_DUR,
    FLIP_DUR: FLIP_DUR,
    create: create,
    update: update,
    tryMove: tryMove,
    tryTraverse: tryTraverse,
    pathTo: pathTo,
    toggleHint: toggleHint,
    showMessage: showMessage,
    mouthOn: mouthOn,
    tunnelAtCell: tunnelAtCell,
    expectedTunnel: expectedTunnel,
    updateHint: updateHint,
    get state() { return state; }
  };
});
