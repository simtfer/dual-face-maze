/*!
 * maze.js — 双面迷宫核心：迷宫生成 / 区域切分 / 寻路
 * 纯逻辑，无 DOM 依赖，可在浏览器与 Node（无头测试）中运行。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MZ = Object.assign(root.MZ || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 墙壁位掩码
  var N = 1, E = 2, S = 4, W = 8;

  var DIRS = [
    { bit: N, dx: 0, dy: -1, opp: S },
    { bit: E, dx: 1, dy: 0, opp: W },
    { bit: S, dx: 0, dy: 1, opp: N },
    { bit: W, dx: -1, dy: 0, opp: E }
  ];

  function oppOf(bit) {
    return bit === N ? S : bit === S ? N : bit === E ? W : E;
  }

  /** 可播种随机数（mulberry32），保证同一 seed 复现同一关卡 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 迷宫：cols × rows 个格子，每个格子记录四面墙（位掩码）。
   * 生成方式是标准「递归回溯」，保证是一棵生成树（全连通、无环）。
   */
  function Maze(cols, rows, rng) {
    this.cols = cols;
    this.rows = rows;
    this.walls = new Uint8Array(cols * rows);
    this.walls.fill(N | E | S | W); // 初始全封闭
    this.rng = rng || Math.random;
    this._carve();
  }

  Maze.prototype.idx = function (x, y) { return y * this.cols + x; };
  Maze.prototype.xOf = function (i) { return i % this.cols; };
  Maze.prototype.yOf = function (i) { return (i / this.cols) | 0; };
  Maze.prototype.inBounds = function (x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  };

  Maze.prototype._carve = function () {
    var total = this.cols * this.rows;
    var visited = new Uint8Array(total);
    var start = (this.rng() * total) | 0;
    visited[start] = 1;
    var stack = [start];

    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cx = this.xOf(cur), cy = this.yOf(cur);
      var candidates = [];
      for (var k = 0; k < 4; k++) {
        var d = DIRS[k];
        var nx = cx + d.dx, ny = cy + d.dy;
        if (!this.inBounds(nx, ny)) continue;
        var ni = this.idx(nx, ny);
        if (visited[ni]) continue;
        candidates.push([ni, d]);
      }
      if (!candidates.length) { stack.pop(); continue; }
      var pick = candidates[(this.rng() * candidates.length) | 0];
      this.walls[cur] &= ~pick[1].bit;
      this.walls[pick[0]] &= ~pick[1].opp;
      visited[pick[0]] = 1;
      stack.push(pick[0]);
    }
  };

  /** a、b 相邻时的方向位；不相邻返回 0 */
  Maze.prototype.dirBetween = function (a, b) {
    var ax = this.xOf(a), ay = this.yOf(a);
    var bx = this.xOf(b), by = this.yOf(b);
    if (bx - ax === 1) return E;
    if (ax - bx === 1) return W;
    if (by - ay === 1) return S;
    if (ay - by === 1) return N;
    return 0;
  };

  /** 封死 a、b 之间的通道 */
  Maze.prototype.closeBetween = function (a, b) {
    var d = this.dirBetween(a, b);
    if (!d) return;
    this.walls[a] |= d;
    this.walls[b] |= oppOf(d);
  };

  /** 打开 a、b 之间的通道 */
  Maze.prototype.openBetween = function (a, b) {
    var d = this.dirBetween(a, b);
    if (!d) return;
    this.walls[a] &= ~d;
    this.walls[b] &= ~oppOf(d);
  };

  /** 某格子所有可通行方向 */
  Maze.prototype.openDirs = function (i) {
    var res = [];
    var x = this.xOf(i), y = this.yOf(i);
    for (var k = 0; k < 4; k++) {
      var d = DIRS[k];
      if (this.walls[i] & d.bit) continue;
      if (!this.inBounds(x + d.dx, y + d.dy)) continue;
      res.push(d);
    }
    return res;
  };

  /** 读取方向名对应的位，非法返回 0 */
  Maze.prototype.dirBit = function (name) {
    switch (name) {
      case 'up': return N;
      case 'down': return S;
      case 'left': return W;
      case 'right': return E;
      default: return 0;
    }
  };

  /** 按方向名尝试移动，返回目标格 index（不能移动返回 -1） */
  Maze.prototype.step = function (i, name) {
    var bit = this.dirBit(name);
    if (!bit || (this.walls[i] & bit)) return -1;
    var d = null;
    for (var k = 0; k < 4; k++) if (DIRS[k].bit === bit) { d = DIRS[k]; break; }
    var nx = this.xOf(i) + d.dx, ny = this.yOf(i) + d.dy;
    if (!this.inBounds(nx, ny)) return -1;
    return this.idx(nx, ny);
  };

  /**
   * 求连通区域（当前墙体下的连通分量）。
   * @returns {{comp: Int16Array, list: number[][]}}
   */
  Maze.prototype.components = function () {
    var total = this.cols * this.rows;
    var comp = new Int16Array(total);
    for (var i = 0; i < total; i++) comp[i] = -1;
    var list = [];

    for (var s = 0; s < total; s++) {
      if (comp[s] !== -1) continue;
      var id = list.length;
      var cells = [];
      var stack = [s];
      comp[s] = id;
      while (stack.length) {
        var c = stack.pop();
        cells.push(c);
        var dirs = this.openDirs(c);
        for (var k = 0; k < dirs.length; k++) {
          var n = this.idx(this.xOf(c) + dirs[k].dx, this.yOf(c) + dirs[k].dy);
          if (comp[n] === -1) { comp[n] = id; stack.push(n); }
        }
      }
      list.push(cells);
    }
    return { comp: comp, list: list };
  };

  /**
   * 把网格划分成若干「区域」：每个区域连通、互不重叠，
   * 并且每个区域必须完整包含给定的种子格（seeds[r] 属于第 r 个区域）。
   *
   * 做法：多源随机边界扩张。先把种子格判给各自区域，
   * 之后不断从「区域边界」上随机取一个未占用格，判给与它相邻且当前最小的区域，
   * 直到铺满。相邻性保证区域始终连通。
   *
   * @param {number[][]} seeds 每个区域的种子格（组内必须连通）
   * @param {Set<number>} exclude 禁区（实心块），不参与分配
   * @returns {{label: Int16Array, cells: number[][], sizes: number[], complete: boolean}}
   */
  function growRegions(cols, rows, seeds, rng, exclude) {
    var total = cols * rows;
    var label = new Int16Array(total);
    for (var i = 0; i < total; i++) label[i] = -1;

    var count = seeds.length;
    var cells = [], fronts = [], sizes = [];
    for (var r = 0; r < count; r++) { cells.push([]); fronts.push([]); sizes.push(0); }

    var remaining = total;
    if (exclude) {
      exclude.forEach(function (c) {
        if (c >= 0 && c < total && label[c] === -1) { label[c] = -2; remaining--; }
      });
    }
    for (var r = 0; r < count; r++) {
      for (var t = 0; t < seeds[r].length; t++) {
        var c = seeds[r][t];
        if (label[c] !== -1) continue;   // 种子不应重复，重复则忽略
        label[c] = r;
        cells[r].push(c);
        sizes[r]++;
        remaining--;
      }
    }

    // 初始化边界
    var nb = [];
    for (var r = 0; r < count; r++) {
      for (var t = 0; t < cells[r].length; t++) {
        gridNeighbors(cols, rows, cells[r][t], nb);
        for (var q = 0; q < nb.length; q++) if (label[nb[q]] === -1) fronts[r].push(nb[q]);
      }
    }

    while (remaining > 0) {
      // 优先扩张当前最小的区域，避免出现特别大的块
      var pick = -1, bestSize = Infinity;
      for (var r = 0; r < count; r++) {
        if (!fronts[r].length) continue;
        if (sizes[r] < bestSize) { bestSize = sizes[r]; pick = r; }
      }
      if (pick < 0) break;   // 没有可扩张的区域（理论上不会发生）

      var fi = (rng() * fronts[pick].length) | 0;
      var cell = fronts[pick][fi];
      fronts[pick].splice(fi, 1);
      if (label[cell] !== -1) continue;  // 已被别的区域抢走（惰性删除）

      label[cell] = pick;
      cells[pick].push(cell);
      sizes[pick]++;
      remaining--;

      gridNeighbors(cols, rows, cell, nb);
      for (var q = 0; q < nb.length; q++) if (label[nb[q]] === -1) fronts[pick].push(nb[q]);
    }

    return { label: label, cells: cells, sizes: sizes, complete: remaining === 0 };
  }

  /** 某格的四邻（不考虑墙），越界方向不返回 */
  function gridNeighbors(cols, rows, cell, out) {
    out.length = 0;
    var x = cell % cols, y = (cell / cols) | 0;
    if (y > 0) out.push(cell - cols);
    if (x < cols - 1) out.push(cell + 1);
    if (y < rows - 1) out.push(cell + cols);
    if (x > 0) out.push(cell - 1);
    return out;
  }

  /**
   * 在开放网格上求两点间的最短路（忽略墙），可指定禁行格。
   * 用于给密室铺设「主脊」——连接该密室的进出两个洞口。
   *
   * @param {Set<number>|null} blocked 不可经过的格
   * @returns {number[]|null} 从 from 到 to 的格序列（含两端）
   */
  function gridPath(cols, rows, from, to, blocked) {
    var total = cols * rows;
    if (from === to) return [from];
    var prev = new Int32Array(total).fill(-1);
    var seen = new Uint8Array(total);
    var queue = [from];
    seen[from] = 1;
    var head = 0;
    while (head < queue.length) {
      var c = queue[head++];
      var x = c % cols, y = (c / cols) | 0;
      for (var k = 0; k < 4; k++) {
        var d = DIRS[k];
        var nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var ni = ny * cols + nx;
        if (seen[ni]) continue;
        if (blocked && blocked.has(ni)) continue;
        seen[ni] = 1;
        prev[ni] = c;
        if (ni === to) {
          var path = [];
          for (var p = ni; p !== -1; p = prev[p]) path.push(p);
          path.reverse();
          return path;
        }
        queue.push(ni);
      }
    }
    return null;
  }

  /**
   * 按区域标签雕刻迷宫。
   *
   * 雕刻分三步：
   *   1. 先把该区域的「主脊」整条打通 —— 主脊是一串首尾相接的格子，
   *      它连接着密室的进/出两个洞口；
   *   2. 区域里剩下的格子再从主脊长成树枝。每格只跟一个父格相连，
   *      所以区域是一棵树 ⇒ 主脊长度就是「入口→出口」的最短距离，
   *      玩家<b>不可能</b>把密室一步跨过去；
   *   3. 最后在同一支系里打通一两堵墙形成环路，让玩家在
   *      「绕远捡符印」与「直接穿过去」之间有得选。
   *
   * @param {Int16Array} label 每格所属区域（-1 = 实心，不属于任何区域）
   * @param {number} regionCount 区域总数
   * @param {function} rng
   * @param {object} plan
   *   plan.corridor {number: number[]}  各区域的主脊
   *   plan.mouths   {number: number[]}  各区域进/出洞口（用于校验环路不会缩短主脊）
   *   plan.loops    每个区域额外打开的环路数量
   */
  Maze.prototype.carveByLabel = function (label, regionCount, rng, plan) {
    plan = plan || {};
    var total = this.cols * this.rows;
    for (var i = 0; i < total; i++) this.walls[i] = N | E | S | W;

    var corridors = plan.corridor || {};
    var mouths = plan.mouths || {};
    var wantLoops = plan.loops != null ? plan.loops : 2;

    var byRegion = [];
    for (var r = 0; r < regionCount; r++) byRegion.push([]);
    for (i = 0; i < total; i++) {
      if (label[i] >= 0 && label[i] < regionCount) byRegion[label[i]].push(i);
    }

    // depth：距主脊的树枝深度（主脊为 0）；attach：挂在主脊的哪一节
    this.depth = new Int32Array(total).fill(-1);
    this.attach = new Int32Array(total).fill(-1);
    this.parent = new Int32Array(total).fill(-1);

    for (var r = 0; r < regionCount; r++) {
      var list = byRegion[r];
      if (!list.length) continue;
      var corridor = corridors[r] || [];
      var seen = new Uint8Array(total);

      // 1) 打通主脊
      for (var ci = 0; ci < corridor.length; ci++) {
        var cell = corridor[ci];
        seen[cell] = 1;
        this.depth[cell] = 0;
        this.attach[cell] = ci;
        if (ci > 0) {
          this.openBetween(corridor[ci - 1], cell);
          this.parent[cell] = corridor[ci - 1];
        }
      }

      // 2) 从主脊长出树枝（每格只挂一个父格 ⇒ 区域是一棵树）
      //    注意：这里必须「窥栈顶」而不是「弹栈」——弹栈会把当前格剩下的
      //    候选邻居直接丢掉，导致大片格子成为走不到的孤立碎块。
      var stack = corridor.slice();
      while (stack.length) {
        var cur = stack[stack.length - 1];
        var cx = this.xOf(cur), cy = this.yOf(cur);
        var cand = [];
        for (var k = 0; k < 4; k++) {
          var d = DIRS[k];
          var nx = cx + d.dx, ny = cy + d.dy;
          if (!this.inBounds(nx, ny)) continue;
          var ni = this.idx(nx, ny);
          if (label[ni] !== r || seen[ni]) continue;
          cand.push([ni, d]);
        }
        if (!cand.length) { stack.pop(); continue; }
        var pick = cand[(rng() * cand.length) | 0];
        this.walls[cur] &= ~pick[1].bit;
        this.walls[pick[0]] &= ~pick[1].opp;
        seen[pick[0]] = 1;
        this.parent[pick[0]] = cur;
        this.depth[pick[0]] = this.depth[cur] + 1;
        this.attach[pick[0]] = this.attach[cur];
        stack.push(pick[0]);
      }

      // 3) 造环：优先打通「主脊 ↔ 树枝」之间的墙，在主脊旁边掏出小口袋，
      //    让玩家在主路与绕行之间有得选。每开一堵墙都复核一遍
      //    「入口→出口」距离有没有被缩短——变短了就撤销。
      var pair = mouths[r];
      if (!pair || wantLoops <= 0) continue;
      var A = pair[0], B = pair[1];
      var baseLen = this.pathLen(A, B);
      if (baseLen < 0) continue;

      var cand = [];
      for (var t = 0; t < list.length; t++) {
        var u = list[t];
        var ux = this.xOf(u), uy = this.yOf(u);
        for (var k2 = 0; k2 < 4; k2++) {
          var d2 = DIRS[k2];
          var vx = ux + d2.dx, vy = uy + d2.dy;
          if (!this.inBounds(vx, vy)) continue;
          var v = this.idx(vx, vy);
          if (label[v] !== r) continue;
          if (!(this.walls[u] & d2.bit)) continue;      // 这堵墙已经通了
          // 一端贴着主脊的优先：这种环一定不会缩短主脊
          var prio = (this.depth[u] === 0 || this.depth[v] === 0) ? 0 : 1;
          cand.push({ u: u, v: v, bit: d2.bit, opp: d2.opp, prio: prio });
        }
      }
      cand.sort(function (a, b) { return a.prio - b.prio; });

      var made = 0;
      for (var ci = 0; ci < cand.length && made < wantLoops; ci++) {
        var e = cand[ci];
        this.walls[e.u] &= ~e.bit;
        this.walls[e.v] &= ~e.opp;
        if (this.pathLen(A, B) < baseLen) {   // 变成捷径了，撤销
          this.walls[e.u] |= e.bit;
          this.walls[e.v] |= e.opp;
          continue;
        }
        made++;
      }
    }
    return this;
  };

  /** 两点之间的最短步数；不可达返回 -1 */
  Maze.prototype.pathLen = function (a, b) {
    var p = this.findPath(a, b);
    return p === null ? -1 : p.length;
  };

  /**
   * 统计各区域的环路数：开放边数 - 顶点数 + 1。
   * 0 = 纯树（玩家没有第二个选择），>0 = 存在可选的绕行路线。
   */
  Maze.prototype.cycleStats = function (label, regionCount) {
    var res = [];
    for (var r = 0; r < regionCount; r++) res.push({ cells: 0, edges: 0, cycles: 0 });
    var total = this.cols * this.rows;
    for (var i = 0; i < total; i++) {
      var lr = label[i];
      if (lr < 0 || lr >= regionCount) continue;
      res[lr].cells++;
      var x = this.xOf(i), y = this.yOf(i);
      if (x < this.cols - 1) {
        var e = this.idx(x + 1, y);
        if (label[e] === lr && !(this.walls[i] & E)) res[lr].edges++;
      }
      if (y < this.rows - 1) {
        var s = this.idx(x, y + 1);
        if (label[s] === lr && !(this.walls[i] & S)) res[lr].edges++;
      }
    }
    for (var q = 0; q < regionCount; q++) res[q].cycles = res[q].edges - res[q].cells + 1;
    return res;
  };

  /** 按区域标签直接构造一个迷宫（不先生成整树再切割） */
  Maze.fromLabels = function (cols, rows, label, regionCount, rng, plan) {
    var m = Object.create(Maze.prototype);
    m.cols = cols;
    m.rows = rows;
    m.walls = new Uint8Array(cols * rows);
    m.rng = rng || Math.random;
    m.carveByLabel(label, regionCount, m.rng, plan);
    return m;
  };

  /**
   * BFS 最短路（仅在当前墙体的连通区域内）。
   * @returns {number[]|null} 不含起点的路径格序列
   */
  Maze.prototype.findPath = function (from, to) {
    if (from === to) return [];
    var total = this.cols * this.rows;
    var prev = new Int32Array(total).fill(-1);
    var seen = new Uint8Array(total);
    seen[from] = 1;
    var queue = [from], head = 0, i, k, c, d, n;
    while (head < queue.length) {
      c = queue[head++];
      var dirs = this.openDirs(c);
      for (k = 0; k < dirs.length; k++) {
        d = dirs[k];
        n = this.idx(this.xOf(c) + d.dx, this.yOf(c) + d.dy);
        if (seen[n]) continue;
        seen[n] = 1;
        prev[n] = c;
        if (n === to) {
          var path = [];
          var cur = to;
          while (cur !== from && cur !== -1) { path.push(cur); cur = prev[cur]; }
          path.reverse();
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  };

  /** 区域内任意两格是否连通 */
  Maze.prototype.reachable = function (from, to) {
    return this.findPath(from, to) !== null;
  };

  return {
    Maze: Maze,
    N: N, E: E, S: S, W: W,
    DIRS: DIRS,
    oppOf: oppOf,
    mulberry32: mulberry32,
    shuffle: shuffle,
    growRegions: growRegions,
    gridPath: gridPath
  };
});
