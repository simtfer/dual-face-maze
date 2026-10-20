/**
 * 原型验证：把「竖井链」从连续折线改成「分散布置」，
 * 看密室是否会长出真正的内部结构（而不是被一步跳过）。
 *
 * 现状问题：shaft[j] 与 shaft[j+1] 在网格上相邻
 *   → 同一面里，密室 n 的入口格(tunnels[n-1]) 与出口格(tunnels[n]) 也相邻
 *   → 65% 的密室被短路，迷宫内部根本不用走
 *
 * 假设：竖井之间要求曼哈顿距离 >= 2（不相邻）
 */
var MZ = require('../src/maze.js');

var FRONT = 0, BACK = 1;

/** 分散版竖井链：任意两口井曼哈顿距离 >= minGap */
function findShaftSpread(cols, rows, len, rng, minGap) {
  var total = cols * rows;
  for (var attempt = 0; attempt < 200; attempt++) {
    var path = [], used = new Set();
    var start = (rng() * total) | 0;
    path.push(start); used.add(start);
    while (path.length < len) {
      var cx = start % cols, cy = (start / cols) | 0;
      // 候选：所有与已选点都满足 minGap 的格子
      var cands = [];
      for (var i = 0; i < total; i++) {
        if (used.has(i)) continue;
        var x = i % cols, y = (i / cols) | 0;
        var ok = true;
        for (var j = 0; j < path.length; j++) {
          var px = path[j] % cols, py = (path[j] / cols) | 0;
          if (Math.abs(x - px) + Math.abs(y - py) < minGap) { ok = false; break; }
        }
        if (ok) cands.push(i);
      }
      if (!cands.length) break;
      var pick = cands[(rng() * cands.length) | 0];
      path.push(pick); used.add(pick);
    }
    if (path.length === len) return path;
  }
  return null;
}

/** 连续折线版（原实现） */
function findShaftPath(cols, rows, len, rng) {
  var total = cols * rows;
  for (var attempt = 0; attempt < 80; attempt++) {
    var path = [], used = new Set();
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
      if (!cands.length) break;
      var pick = cands[(rng() * cands.length) | 0];
      path.push(pick); used.add(pick); cur = pick;
    }
    if (path.length === len) return path;
  }
  return null;
}

/** 按新算法组装完整关卡（复用 game.js 的分区/雕刻思路） */
function build(cols, rows, k, minSize, rng, gap) {
  var shaft = gap >= 99 ? findShaftPath(cols, rows, 2 * k - 1, rng)
                        : findShaftSpread(cols, rows, 2 * k - 1, rng, gap);
  if (!shaft) return null;

  var seeds = [[], []];
  for (var i = 0; i < k; i++) {
    seeds[FRONT].push(i === 0 ? [shaft[0]] : [shaft[2 * i - 1], shaft[2 * i]]);
    seeds[BACK].push(i === k - 1 ? [shaft[2 * k - 2]] : [shaft[2 * i], shaft[2 * i + 1]]);
  }
  var faces = [], regionSets = [];
  for (var s = 0; s < 2; s++) {
    var grown = MZ.growRegions(cols, rows, seeds[s], rng);
    if (!grown.complete) return null;
    for (var j = 0; j < k; j++) if (grown.sizes[j] < minSize) return null;
    faces.push(MZ.Maze.fromLabels(cols, rows, grown.label, k, rng));
    regionSets.push(grown.cells);
  }
  return { shaft: shaft, faces: faces, regions: regionSets, k: k };
}

function mouthOn(t, side) { return t.a.side === side ? t.a.cell : t.b.cell; }

function analyze(level) {
  var chain = level.k * 2, trivial = 0, roomDepth = [];
  for (var n = 0; n < chain; n++) {
    var side = (n % 2 === 0) ? FRONT : BACK;
    var m = level.faces[side];
    var entry = (n === 0) ? level.regions[FRONT][0][0] : mouthOn({ a: { side: (n - 1) % 2 === 0 ? FRONT : BACK, cell: level.shaft[n - 1] }, b: { side: (n - 1) % 2 === 0 ? BACK : FRONT, cell: level.shaft[n - 1] } }, side);
    var exit = mouthOn({ a: { side: n % 2 === 0 ? FRONT : BACK, cell: level.shaft[n] }, b: { side: n % 2 === 0 ? BACK : FRONT, cell: level.shaft[n] } }, side);
    var d = m.findPath(entry, exit);
    if (d) { if (d.length <= 1) trivial++; roomDepth.push(d.length); }
  }
  roomDepth.sort(function (a, b) { return a - b; });
  return {
    trivial: trivial, total: chain,
    medDepth: roomDepth[roomDepth.length >> 1] || 0,
    maxDepth: roomDepth[roomDepth.length - 1] || 0
  };
}

var LEVELS = [
  { cols: 7,  rows: 9,  regions: 2, minSize: 7 },
  { cols: 9,  rows: 13, regions: 3, minSize: 9 },
  { cols: 9,  rows: 13, regions: 4, minSize: 7 },
  { cols: 11, rows: 15, regions: 4, minSize: 9 },
  { cols: 11, rows: 15, regions: 5, minSize: 8 },
  { cols: 13, rows: 17, regions: 6, minSize: 8 }
];

console.log('关卡 | 布局 | 密室被跳过 | 房内深度(中位/最大) | 生成成功率');
console.log('-----|------|-----------|-------------------|----------');
[99, 3, 2].forEach(function (gap) {
  var label = gap >= 99 ? '连续折线(现状)' : ('竖井间距>=' + gap);
  for (var lv = 0; lv < LEVELS.length; lv++) {
    var def = LEVELS[lv];
    var trivial = 0, total = 0, meds = [], maxs = [], ok = 0, tries = 0;
    for (var seed = 0; seed < 12; seed++) {
      tries++;
      var rng = MZ.mulberry32((5000 + lv * 97 + seed) >>> 0);
      var lvObj = build(def.cols, def.rows, def.regions, def.minSize, rng, gap);
      if (!lvObj) continue;
      ok++;
      var a = analyze(lvObj);
      trivial += a.trivial; total += a.total;
      meds.push(a.medDepth); maxs.push(a.maxDepth);
    }
    if (!ok) { console.log('L' + (lv + 1) + ' | ' + label + ' | 生成全部失败'); continue; }
    meds.sort(function (a, b) { return a - b; });
    maxs.sort(function (a, b) { return a - b; });
    console.log('L' + (lv + 1) + '  | ' + label + ' | ' +
      Math.round(trivial / total * 100) + '%' +
      ' (' + trivial + '/' + total + ') | ' +
      meds[meds.length >> 1] + ' / ' + maxs[maxs.length - 1] +
      ' | ' + Math.round(ok / tries * 100) + '%');
  }
});
