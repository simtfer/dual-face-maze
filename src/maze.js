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
   * @returns {{label: Int16Array, cells: number[][], sizes: number[], complete: boolean}}
   */
  function growRegions(cols, rows, seeds, rng) {
    var total = cols * rows;
    var label = new Int16Array(total);
    for (var i = 0; i < total; i++) label[i] = -1;

    var count = seeds.length;
    var cells = [], fronts = [], sizes = [];
    for (var r = 0; r < count; r++) { cells.push([]); fronts.push([]); sizes.push(0); }

    var remaining = total;
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
   * 按区域标签雕刻迷宫：
   * 每个区域内部生成一棵随机生成树（DFS），区域之间完全封死。
   * 于是「密室」内部仍是迷宫状走廊，而密室之间互不相通。
   */
  Maze.prototype.carveByLabel = function (label, regionCount, rng) {
    var total = this.cols * this.rows;
    for (var i = 0; i < total; i++) this.walls[i] = N | E | S | W;

    var byRegion = [];
    for (var r = 0; r < regionCount; r++) byRegion.push([]);
    for (i = 0; i < total; i++) byRegion[label[i]].push(i);

    for (var r = 0; r < regionCount; r++) {
      var list = byRegion[r];
      if (!list.length) continue;
      var seen = new Uint8Array(total);
      var stack = [list[0]];
      seen[list[0]] = 1;
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
        stack.push(pick[0]);
      }
    }
  };

  /** 按区域标签直接构造一个迷宫（不先生成整树再切割） */
  Maze.fromLabels = function (cols, rows, label, regionCount, rng) {
    var m = Object.create(Maze.prototype);
    m.cols = cols;
    m.rows = rows;
    m.walls = new Uint8Array(cols * rows);
    m.rng = rng || Math.random;
    m.carveByLabel(label, regionCount, m.rng);
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
    growRegions: growRegions
  };
});
