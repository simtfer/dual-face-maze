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

  /**
   * 相邻竖井在骨架路径上的最小间隔 —— 也就等于密室的最小纵深。
   * 竖井挨得太近，两面就会「一步跨过」密室，玩家永远在赶路。
   */
  function minGapFor(def) {
    return Math.max(4, Math.round(Math.min(def.cols, def.rows) * 0.42));
  }

  /** 骨架路径最多覆盖的网格比例，剩下的空间留给树枝与环路 */
  var PATH_COVER = 0.46;

  /** 每个密室额外打开的环路数量 */
  var LOOPS_PER_ROOM = 2;

  /**
   * 在网格上铺一条蜿蜒的自避路径（不重复经过同一格），作为整关的「骨架」。
   *
   * 关键：竖井按顺序落在这条骨架上，于是
   *   · 相邻两个竖井之间那一段骨架 = 对应密室的<b>主脊</b>；
   *   · 同一面上的各段主脊天然互不重叠（它们是骨架上互不相交的区间）；
   *   · 主脊之外的格子就是树枝与环路的空间。
   */
  function buildRoutePath(cols, rows, minLen, rng) {
    var total = cols * rows;
    var best = null;
    for (var attempt = 0; attempt < 40; attempt++) {
      var used = new Uint8Array(total);
      var path = [];
      var start = (rng() * total) | 0;
      used[start] = 1; path.push(start);
      var cur = start;

      while (path.length < total) {
        var cx = cur % cols, cy = (cur / cols) | 0;
        var cands = [];
        for (var k = 0; k < 4; k++) {
          var d = MZ.DIRS[k];
          var nx = cx + d.dx, ny = cy + d.dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          var ni = ny * cols + nx;
          if (used[ni]) continue;
          cands.push(ni);
        }
        if (!cands.length) break;    // 走进死角，本次作废

        // 选离已用格最远的候选，让骨架铺开而不是挤成一团
        var bestC = -1, bestScore = -1;
        for (var i = 0; i < cands.length; i++) {
          var ci = cands[i];
          var ax = ci % cols, ay = (ci / cols) | 0;
          var minD = 1e9;
          for (var t = 0; t < path.length; t++) {
            var px = path[t] % cols, py = (path[t] / cols) | 0;
            var dd = Math.abs(ax - px) + Math.abs(ay - py);
            if (dd < minD) minD = dd;
          }
          var score = minD + rng() * 0.9;   // 随机扰动，避免每次形状雷同
          if (score > bestScore) { bestScore = score; bestC = ci; }
        }
        used[bestC] = 1; path.push(bestC); cur = bestC;
      }

      if (!best || path.length > best.length) best = path;
      if (best.length >= minLen) break;
    }
    return best;
  }

  /**
   * 在骨架路径上按间隔挑出竖井落点。
   *
   * 间隔预算要<b>按比例分摊</b>到每一段上 —— 否则某一段可能一口气吃掉
   * 全部预算，主脊长到几十格，其余密室全被挤扁。
   */
  function pickShafts(route, count, minGap, rng) {
    var slots = count + 1;                 // 前缀 + count-1 个间隔 + 后缀
    var base = slots * minGap;
    if (route.length < base + 1) return null;
    var budget = route.length - 1 - base;

    // 随机权重 → 按比例分摊预算
    var weights = [], sum = 0;
    for (var s = 0; s < slots; s++) { var w = 0.25 + rng(); weights.push(w); sum += w; }

    var picks = [];
    var pos = minGap + Math.round(budget * weights[0] / sum);
    picks.push(pos);
    for (var i = 1; i < count; i++) {
      pos += minGap + Math.round(budget * weights[i] / sum);
      picks.push(pos);
    }
    if (pos + minGap > route.length - 1) return null;
    return picks;
  }

  /**
   * 在密室里挑一枚符印的位置：要<b>离开主脊</b>（否则捡不捡没区别），
   * 但又不能太远，否则玩家会为了它跑断腿。
   */
  function pickCrystal(maze, cells, entry, used, rng) {
    var pool = cells.filter(function (c) { return !used.has(c); });
    if (!pool.length) pool = cells.slice();

    var near = [], far = [];
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i];
      if (!maze.depth || maze.depth[c] < 1) continue;   // 主脊上的格子不要
      var p = maze.findPath(entry, c);
      if (!p) continue;
      if (p.length <= 7) near.push(c);
      else far.push(c);
    }

    var chosen = -1;
    if (near.length) chosen = near[(rng() * near.length) | 0];
    else if (far.length) chosen = far[(rng() * far.length) | 0];
    else {
      var off = pool.filter(function (c) { return maze.depth && maze.depth[c] >= 1; });
      if (off.length) chosen = off[(rng() * off.length) | 0];
      else chosen = pool[(rng() * pool.length) | 0];
    }
    used.add(chosen);
    return chosen;
  }

  /**
   * 构建一个关卡。
   *
   * 骨架：
   *   1. 先在网格上铺一条蜿蜒的「骨架路径」route（自避、不重复）；
   *   2. 在骨架上按固定间隔挑出 2k-1 个竖井落点 shaft[0..2k-2]；
   *   3. 第 j 条隧道落在 shaft[j] —— 正反两面同位，是真正贯穿的竖井；
   *   4. 正面第 i 间密室的主脊 = route 上 shaft[2i-1]→shaft[2i] 那一段，
   *      背面第 i 间 = shaft[2i]→shaft[2i+1] 那一段 —— 两面错位咬合；
   *   5. 主脊之外的空间长成树枝与环路，密室内部才有得逛。
   *
   * 由构造保证的性质：
   *   · 主脊长度 = 两个洞口之间的最短距离 ⇒ 密室不可能被一步跨过；
   *   · 主脊天然连通 ⇒ 每个密室必定连通，不会出现困死玩家的死区；
   *   · 同一面各间密室的主脊是骨架上互不相交的区间 ⇒ 房间互不串通。
   */
  function buildLevel(def, fixedSeed) {
    var seed = fixedSeed != null ? fixedSeed
      : (((Date.now() ^ ((Math.random() * 1e9) | 0)) >>> 0) || 1);

    for (var attempt = 0; attempt < 60; attempt++) {
      var rng = MZ.mulberry32((seed + attempt * 7919) >>> 0);
      var lv = tryBuild(def, rng);
      if (lv) { lv.seed = seed; return lv; }
    }
    throw new Error('关卡生成失败：无法切分出足够的密室');
  }

  /** 尝试构造一次关卡；失败返回 null（外层会换随机种子重来） */
  function tryBuild(def, rng) {
    var cols = def.cols, rows = def.rows, total = cols * rows;
    var k = def.regions;
    var gap = minGapFor(def);

    // 1) 骨架路径 + 竖井落点
    var need = (2 * k - 2) * gap + 4;
    var route = buildRoutePath(cols, rows, Math.max(need, Math.round(total * PATH_COVER)), rng);
    if (!route) return null;
    var picks = pickShafts(route, 2 * k - 1, gap, rng);
    if (!picks) return null;
    var shaft = picks.map(function (p) { return route[p]; });

    // 2) 两面各自的主脊 + 洞口
    var faces = [], regionSets = [], corridorAll = [], mouthAll = [], labelAll = [];
    for (var s = 0; s < 2; s++) {
      var corridors = [], mouths = [], rock = [];
      for (var i = 0; i < k; i++) {
        if (s === FRONT) {
          // 正面：第 0 间用骨架的<b>前缀段</b>（route[0]→shaft[0]），
          // 起点就落在前缀尽头；第 i 间的主脊是 shaft[2i-1]→shaft[2i]
          if (i === 0) {
            corridors.push(route.slice(0, picks[0] + 1));
            mouths.push([shaft[0], shaft[0]]);
          } else {
            corridors.push(route.slice(picks[2 * i - 1], picks[2 * i] + 1));
            mouths.push([shaft[2 * i - 1], shaft[2 * i]]);
          }
        } else {
          // 背面：第 i 间的主脊是 shaft[2i]→shaft[2i+1]；
          // 最后一间用骨架的<b>尾段</b>（shaft[2k-2]→route 末尾），终点落在尾段尽头
          if (i === k - 1) {
            corridors.push(route.slice(picks[2 * k - 2], route.length));
            mouths.push([shaft[2 * k - 2], shaft[2 * k - 2]]);
          } else {
            corridors.push(route.slice(picks[2 * i], picks[2 * i + 1] + 1));
            mouths.push([shaft[2 * i], shaft[2 * i + 1]]);
          }
        }
      }

      // 房间之间夹着的那段骨架：在这一面封成实心，让每间密室界限清晰
      for (var g = 0; g < k - 1; g++) {
        var from = (s === FRONT) ? picks[2 * g] : picks[2 * g + 1];
        var to = (s === FRONT) ? picks[2 * g + 1] : picks[2 * g + 2];
        for (var q = from + 1; q < to; q++) rock.push(route[q]);
      }

      // 3) 按主脊生长密室
      //    被实心块围死的零头格子分不到区域，它们最终也是实心 —— 不算失败
      var grown = MZ.growRegions(cols, rows, corridors, rng, new Set(rock));

      var label = grown.label;

      var cells = [];
      for (var r = 0; r < k; r++) cells.push([]);

      // 4) 雕刻：主脊优先 + 树枝 + 环路
      var maze = MZ.Maze.fromLabels(cols, rows, label, k, rng, {
        corridor: corridors, mouths: mouths, loops: LOOPS_PER_ROOM
      });

      // 5) 校验：主脊长度必须撑得起一间密室
      for (r = 0; r < k; r++) {
        var A = mouths[r][0], B = mouths[r][1];
        if (maze.pathLen(A, B) < 0) return null;
        if (A !== B && maze.pathLen(A, B) < gap) return null;
      }

      // 6) 只把「真正走得到」的格子算进密室（禁区可能把区域切成碎块）
      for (var c = 0; c < total; c++) {
        if (label[c] >= 0 && maze.depth[c] >= 0) cells[label[c]].push(c);
      }
      for (r = 0; r < k; r++) if (cells[r].length < def.minSize) return null;

      faces.push(maze);
      regionSets.push(cells);
      corridorAll.push(corridors);
      mouthAll.push(mouths);
      labelAll.push(label);
    }

    // 6) 隧道链：第 j 条隧道在 shaft[j]，正反两面同位
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

    // 起点在骨架前缀尽头，终点在骨架尾段尽头
    var startCell = route[0];
    var goalCell = route[route.length - 1];
    used[FRONT].add(startCell);
    used[BACK].add(goalCell);

    // 每个链节点一枚符印：放在该密室里偏离主脊、又不至于太远的格子
    var crystals = [];
    for (var n = 0; n < 2 * k; n++) {
      var ns = (n % 2 === 0) ? FRONT : BACK;
      var roomIdx = Math.floor(n / 2);
      var entry = (n === 0) ? startCell : mouthOn(tunnels[n - 1], ns);
      crystals.push({
        side: ns,
        cell: pickCrystal(faces[ns], regionSets[ns][roomIdx], entry, used[ns], rng),
        taken: false
      });
    }

    var lv = {
      def: def,
      seed: 0,
      faces: faces,
      regions: regionSets,
      labels: labelAll,
      corridors: corridorAll,
      mouths: mouthAll,
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
