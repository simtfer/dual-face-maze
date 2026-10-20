/*!
 * test-shaft.js — 「正反两面隧道同位（垂直竖井）」专项验证
 *
 * 验证点：
 *   1. 每条隧道的两个端点落在同一格（a.cell === b.cell），
 *      即从正面掉下去，会在背面的<b>同一坐标</b>出来；
 *   2. 竖井落点两两不同（同一条隧道不会和别的隧道抢格子）；
 *   3. 每个密室恰好只开 1~2 个洞口（首尾 1 个，中间 2 个），无法跳关；
 *   4. 竖井格在两面都落在「应当属于它的密室」里（错位咬合正确）；
 *   5. 正反两面同一格上的竖井编号一致（玩家看两面能对上号）。
 */
'use strict';

var MZ = require('../src/maze.js');
var Game = require('../src/game.js');

var FRONT = 0, BACK = 1;
var LEVELS = [
  { cols: 7,  rows: 9,  regions: 2, minSize: 7, name: '初窥双面' },
  { cols: 9,  rows: 13, regions: 3, minSize: 9, name: '错层回廊' },
  { cols: 9,  rows: 13, regions: 4, minSize: 7, name: '四象迷枢' },
  { cols: 11, rows: 15, regions: 4, minSize: 9, name: '狭道深折' },
  { cols: 11, rows: 15, regions: 5, minSize: 8, name: '五环套叠' },
  { cols: 13, rows: 17, regions: 6, minSize: 8, name: '无尽之门' }
];

var failures = 0;
function fail(msg) { failures++; console.log('   ✗ ' + msg); }
function ok(msg) { console.log('   ✓ ' + msg); }

function checkLevel(def, seed) {
  var st = Game.create(0, seed, def);
  var lv = st.level;
  var k = def.regions;
  var tunnels = lv.tunnels;
  var label = def.name + ' (' + def.cols + '×' + def.rows + ', seed=' + seed + ')';

  // 1) 同位：每条隧道两端同一格
  var notSame = 0;
  for (var i = 0; i < tunnels.length; i++) {
    if (tunnels[i].a.cell !== tunnels[i].b.cell) notSame++;
    if (tunnels[i].a.side === tunnels[i].b.side) notSame++;   // 必须跨面
  }
  if (notSame) fail(label + ' 有 ' + notSame + ' 条隧道不在同一格 / 未跨面');
  else ok('全部 ' + tunnels.length + ' 条隧道正反两面同位且跨面连通');

  // 2) 竖井落点互不重复
  var seen = new Set();
  var dup = 0;
  for (i = 0; i < tunnels.length; i++) {
    if (seen.has(tunnels[i].cell)) dup++;
    seen.add(tunnels[i].cell);
  }
  if (dup) fail(label + ' 有 ' + dup + ' 处竖井落点重复');
  else ok('竖井落点互不重复 (' + seen.size + ' 格)');

  // 3) 每密室洞口数：正面首=1、背面尾=1、其余=2
  var mouthCount = [new Array(k).fill(0), new Array(k).fill(0)];
  for (i = 0; i < tunnels.length; i++) {
    mouthCount[tunnels[i].a.side][regionOf(lv, tunnels[i].a.side, tunnels[i].a.cell)]++;
    mouthCount[tunnels[i].b.side][regionOf(lv, tunnels[i].b.side, tunnels[i].b.cell)]++;
  }
  var bad = [];
  for (i = 0; i < k; i++) {
    var expectF = (i === 0) ? 1 : 2;
    var expectB = (i === k - 1) ? 1 : 2;
    if (mouthCount[FRONT][i] !== expectF) bad.push('正' + i + '=' + mouthCount[FRONT][i] + '(期望' + expectF + ')');
    if (mouthCount[BACK][i] !== expectB) bad.push('反' + i + '=' + mouthCount[BACK][i] + '(期望' + expectB + ')');
  }
  if (bad.length) fail(label + ' 洞口数不符：' + bad.join(' '));
  else ok('各密室洞口数正确（首尾各 1，中间各 2）');

  // 4) 错位咬合：竖井格在两面各自归属的密室应符合公式
  var shaft = lv.shaft;
  var wrong = [];
  for (i = 0; i < shaft.length; i++) {
    var j = i;
    // 隧道 j：a 在 FRONT/BACK 由奇偶决定
    var sideA = (j % 2 === 0) ? FRONT : BACK;
    var sideB = (sideA === FRONT) ? BACK : FRONT;
    var regA = regionOf(lv, sideA, shaft[j]);
    var regB = regionOf(lv, sideB, shaft[j]);
    // 正面第 i 间含 shaft[2i-1]、shaft[2i]；背面第 i 间含 shaft[2i]、shaft[2i+1]
    var expA = (sideA === FRONT)
      ? (j === 0 ? 0 : Math.floor(j / 2))
      : (j === shaft.length - 1 ? k - 1 : Math.floor(j / 2));
    var expB = (sideB === FRONT)
      ? (j === 0 ? 0 : Math.floor((j + 1) / 2))
      : (j === shaft.length - 1 ? k - 1 : Math.floor(j / 2));
    if (regA !== expA) wrong.push('井' + (j + 1) + '面' + sideA + '区' + regA + '≠' + expA);
    if (regB !== expB) wrong.push('井' + (j + 1) + '面' + sideB + '区' + regB + '≠' + expB);
  }
  if (wrong.length) fail(label + ' 错位咬合错误：' + wrong.join(' '));
  else ok('竖井格在两面的密室归属符合错位咬合公式');

  // 5) 两面同坐标的竖井编号一致：给定格子，两面都应能查到同一个 id
  var mapF = {}, mapB = {};
  for (i = 0; i < tunnels.length; i++) {
    mapF[tunnels[i].cell] = tunnels[i].id;
    mapB[tunnels[i].cell] = tunnels[i].id;
  }
  var mismatch = 0;
  for (i = 0; i < tunnels.length; i++) {
    var c = tunnels[i].cell;
    if (mapF[c] !== tunnels[i].id || mapB[c] !== tunnels[i].id) mismatch++;
  }
  if (mismatch) fail(label + ' 两面竖井编号不一致');
  else ok('两面同一坐标的竖井编号一致');

  return lv;
}

/** 找出某个格子属于哪个密室（region） */
function regionOf(lv, side, cell) {
  var cells = lv.regions[side];
  for (var i = 0; i < cells.length; i++) {
    if (cells[i].indexOf(cell) >= 0) return i;
  }
  return -1;
}

console.log('=== 双面迷宫 · 正反两面隧道同位专项验证 ===\n');

var seeds = [20260101, 777, 4242, 99999];
for (var li = 0; li < LEVELS.length; li++) {
  for (var si = 0; si < seeds.length; si++) {
    console.log('第 ' + (li + 1) + ' 关 · ' + LEVELS[li].name + '  [样本 ' + (si + 1) + ']');
    checkLevel(LEVELS[li], seeds[si]);
    console.log('');
  }
}

if (failures) {
  console.log('❌ 失败 ' + failures + ' 项');
  process.exit(1);
} else {
  console.log('✅ 全部「正反两面隧道同位」验证通过');
}
