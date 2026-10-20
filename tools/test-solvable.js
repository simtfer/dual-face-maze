/**
 * 无头验证：确保每个关卡
 *   1. 可以被「按序穿越隧道」完整通关；
 *   2. 不使用隧道时终点不可达（核心机制成立）；
 *   3. 每个中间密室恰好只有进/出两个洞口（链条不可跳过）。
 * 运行： node tools/test-solvable.js
 */
const path = require('path');
const MZ = require(path.join(__dirname, '..', 'src', 'maze.js'));
const Game = require(path.join(__dirname, '..', 'src', 'game.js'));

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.log('   ✗ ' + msg); }
}

function solve(level) {
  // 模拟「永远走最短路去下一个隧道洞口」的解法
  let side = level.start.side;
  let cell = level.start.cell;
  const order = level.tunnels.slice(); // 按链顺序
  const steps = [];

  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    const mouth = t.a.side === side ? t.a.cell : t.b.cell;
    const maze = level.faces[side];
    const p = maze.findPath(cell, mouth);
    assert(p !== null, `第 ${i + 1} 条隧道前无法抵达洞口`);
    if (p === null) return null;
    steps.push(p.length);
    // 穿隧道：从当前面穿到另一面
    const arrive = (t.a.side === side) ? t.b : t.a;
    side = arrive.side;
    cell = arrive.cell;
  }

  const goalPath = level.faces[side].findPath(cell, level.goal.cell);
  assert(goalPath !== null, '抵达终点密室后无法走到终点');
  if (goalPath === null) return null;
  steps.push(goalPath.length);
  return { total: steps.reduce((a, b) => a + b, 0), steps, side };
}

function reachableWithoutTunnels(level) {
  // 只在「起始面 + 起始密室」内能到的格子集合
  const maze = level.faces[level.start.side];
  const path = maze.findPath(level.start.cell, level.start.cell);
  const regions = maze.components().list;
  // 找出起点所在区域
  const comp = maze.components().comp;
  const regionId = comp[level.start.cell];
  return regions[regionId];
}

/**
 * 0-1 BFS：计算从起点到终点「最少需要穿越多少条隧道」。
 * 走格子代价 0，穿隧道代价 1。若结果等于 2k-1，说明玩家一条隧道都绕不过去。
 */
function minTunnelTraversals(level) {
  const cols = level.def.cols, rows = level.def.rows;
  const total = cols * rows;
  const N = 1, E = 2, S = 4, W = 8;
  const DIRS = [
    { bit: N, dx: 0, dy: -1, opp: S },
    { bit: E, dx: 1, dy: 0, opp: W },
    { bit: S, dx: 0, dy: 1, opp: N },
    { bit: W, dx: -1, dy: 0, opp: E }
  ];
  const sid = (s, c) => s * total + c;
  const INF = Infinity;
  const dist = new Float64Array(total * 2).fill(INF);
  const done = new Uint8Array(total * 2);
  const start = sid(level.start.side, level.start.cell);
  const goal = sid(level.goal.side, level.goal.cell);
  dist[start] = 0;

  const tunnelOf = new Map(); // "side:cell" -> 对端
  for (const t of level.tunnels) {
    tunnelOf.set(t.a.side + ':' + t.a.cell, t.b);
    tunnelOf.set(t.b.side + ':' + t.b.cell, t.a);
  }

  // Dijkstra（节点极少，直接线性取最小）
  for (let iter = 0; iter < total * 2; iter++) {
    let u = -1, best = INF;
    for (let v = 0; v < total * 2; v++) {
      if (!done[v] && dist[v] < best) { best = dist[v]; u = v; }
    }
    if (u === -1) break;
    done[u] = 1;
    if (u === goal) break;

    const s = (u / total) | 0, c = u % total;
    const maze = level.faces[s];
    const x = c % cols, y = (c / cols) | 0;

    const relax = (v, w) => {
      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    };
    // 走格子（代价 0）
    for (const d of DIRS) {
      if (maze.walls[c] & d.bit) continue;
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      relax(sid(s, ny * cols + nx), 0);
    }
    // 穿隧道（代价 1）
    const tp = tunnelOf.get(s + ':' + c);
    if (tp) relax(sid(tp.side, tp.cell), 1);
  }
  return dist[goal];
}

console.log('=== 双面迷宫 · 关卡可解性验证 ===\n');

for (let i = 0; i < Game.LEVELS.length; i++) {
  const def = Game.LEVELS[i];
  console.log(`第 ${i + 1} 关 · ${def.name} (${def.cols}×${def.rows})`);

  let ok = true;
  for (let rep = 0; rep < 12; rep++) {
    const level = Game.create(i, 1000 + rep * 977).level;

    // --- 结构检查 ---
    const k = level.regionCount;
    assert(k >= 2, '密室数量不足');
    assert(level.tunnels.length === 2 * k - 1, '隧道数量应为 2k-1');
    assert(level.crystals.length === 2 * k, '符印数量应为 2k');

    // 每个密室洞口数：内部=2，首尾=1
    const mouthCount = level.regions.map((regs, s) =>
      regs.map((cells) => {
        const set = new Set(cells);
        let n = 0;
        for (const t of level.tunnels) {
          const m = t.a.side === s ? t.a : t.b;
          if (set.has(m.cell)) n++;
        }
        return n;
      })
    );
    const usedChain = new Set();
    // 链上被使用的区域：front[0..k-1] 与 back[0..k-1]
    for (let c = 0; c < k; c++) {
      usedChain.add('0:' + c);
      usedChain.add('1:' + c);
    }
    for (let s = 0; s < 2; s++) {
      level.regions[s].forEach((cells, c) => {
        const key = s + ':' + c;
        if (!usedChain.has(key)) {
          assert(mouthCount[s][c] === 0, `未使用区域 ${key} 不该有洞口`);
          return;
        }
        const isFirst = (s === 0 && c === 0);
        const isLast = (s === 1 && c === k - 1);
        const expect = (isFirst || isLast) ? 1 : 2;
        assert(mouthCount[s][c] === expect,
          `区域 ${key} 洞口数应为 ${expect}，实际 ${mouthCount[s][c]}`);
      });
    }

    // --- 不穿隧道是否可能到达终点 ---
    // 关键证明：到达终点最少也要穿越 2k-1 条隧道（一条都绕不过）
    const need = minTunnelTraversals(level);
    assert(need === 2 * k - 1,
      `到终点最少应穿越 ${2 * k - 1} 条隧道，实际 ${need}`);
    assert(level.goal.side !== level.start.side, '终点应与起点分处两面');
    // 终点所在的背面区域 ≠ 第一条隧道出口所在的背面区域
    const backComp = level.faces[1].components().comp;
    assert(backComp[level.goal.cell] !== backComp[level.tunnels[0].b.cell],
      '仅穿一条隧道不应就能到达终点区域');

    // --- 可解性 ---
    const res = solve(level);
    assert(res !== null, '关卡无解');
    if (res) ok = ok && res.total > 0;
  }

  const lv = Game.create(i, 42).level;
  const sample = solve(lv);
  const regionSizes = lv.regions.map((r) => r.map((x) => x.length));
  console.log(`   密室数 k=${lv.regionCount}，隧道 ${lv.tunnels.length} 条，最短解 ${sample ? sample.total : '?'} 步`);
  console.log(`   区域规模 [正] ${regionSizes[0].join('/')}  [反] ${regionSizes[1].join('/')}`);
  console.log(ok ? '   ✓ 通过\n' : '   ✗ 失败\n');
}

console.log(failures === 0 ? '✅ 全部关卡验证通过' : `❌ 共 ${failures} 处断言失败`);
process.exit(failures === 0 ? 0 : 1);
