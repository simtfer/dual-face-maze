/**
 * 集成测试：用 Game 自身的 API（tryMove / tryTraverse / update）完整通关，
 * 验证状态机：移动动画、隧道穿梭、正反翻转、终点判定、符印收集。
 * 运行： node tools/test-playthrough.js
 */
const path = require('path');
const MZ = require(path.join(__dirname, '..', 'src', 'maze.js'));
const Game = require(path.join(__dirname, '..', 'src', 'game.js'));

const DT = 1 / 60;
let failures = 0;
function assert(c, m) { if (!c) { failures++; console.log('   ✗ ' + m); } }

function dirBetween(a, b, cols) {
  const ax = a % cols, ay = Math.floor(a / cols);
  const bx = b % cols, by = Math.floor(b / cols);
  if (bx === ax + 1) return 'right';
  if (bx === ax - 1) return 'left';
  if (by === ay + 1) return 'down';
  if (by === ay - 1) return 'up';
  return null;
}

/** 推进时间直到玩家动画结束 */
function settle(st, maxSeconds = 5) {
  let t = 0;
  while ((st.player.moving || st.flip.active) && t < maxSeconds) {
    Game.update(st, DT);
    t += DT;
  }
  Game.update(st, DT);
}

function playthrough(levelIndex) {
  const st = Game.create(levelIndex, 777 + levelIndex * 31);
  const cols = st.level.def.cols;
  let guard = 0;

  while (!st.finished && guard++ < 5000) {
    const side = st.side;
    const maze = st.level.faces[side];

    // 1) 先把当前密室里的符印顺路捡了
    const comp = maze.components().comp;
    for (const c of st.level.crystals) {
      if (c.taken || c.side !== side) continue;
      if (comp[c.cell] !== comp[st.player.cell]) continue;
      for (const cell of (maze.findPath(st.player.cell, c.cell) || [])) {
        const dir = dirBetween(st.player.cell, cell, cols);
        assert(dir !== null, '符印路径方向异常');
        if (!Game.tryMove(st, dir)) return st;
        settle(st);
        assert(!st.finished, '集齐符印前就通关了（终点应处于锁定状态）');
      }
    }

    const t = Game.expectedTunnel(st);

    // 2) 最后一间密室：直接走向终点
    if (!t) {
      const route = maze.findPath(st.player.cell, st.level.goal.cell);
      assert(route !== null, '终点不可达');
      if (route === null) break;
      for (const cell of route) {
        const dir = dirBetween(st.player.cell, cell, cols);
        assert(dir !== null, '终点路径方向异常');
        if (!Game.tryMove(st, dir)) return st;
        settle(st);
      }
      break;
    }

    // 3) 走向下一个隧道洞口
    const mouth = t.a.side === side ? t.a.cell : t.b.cell;
    const route = maze.findPath(st.player.cell, mouth);
    assert(route !== null, '找不到通往洞口的路径');
    if (route === null) break;

    for (const cell of route) {
      const dir = dirBetween(st.player.cell, cell, cols);
      assert(dir !== null, '路径方向异常');
      const ok = Game.tryMove(st, dir);
      assert(ok, `移动失败 dir=${dir}`);
      if (!ok) return st;
      settle(st);
      assert(st.player.cell === cell, '移动后所在格不符');
    }

    // 4) 站在洞口 → 穿梭
    const onTunnel = Game.tunnelAtCell(st, st.player.cell);
    assert(onTunnel === t, '脚下洞口与预期隧道不符');
    const okWarp = Game.tryTraverse(st);
    assert(okWarp, '穿梭失败');
    if (!okWarp) return st;
    settle(st);
    assert(st.side !== side, '穿梭后未切换到另一面');
    const landed = (t.a.side === st.side) ? t.a.cell : t.b.cell;
    assert(st.player.cell === landed, '穿梭后落点不符');
  }

  assert(st.won, '未能通关');
  assert(st.tunnelsUsed === st.level.tunnelCount, `穿隧道数应为 ${st.level.tunnelCount}，实际 ${st.tunnelsUsed}`);
  assert(st.crystalsTaken === st.level.crystals.length, '符印未全部收集');
  assert(st.elapsed > 0, '计时器未启动');
  return st;
}

/** 自动寻路（点击格子）是否可用 */
function testAutoPath() {
  const st = Game.create(0, 2024);
  const cols = st.level.def.cols;
  const maze = st.level.faces[st.side];
  const comp = maze.components();
  const region = comp.list[comp.comp[st.player.cell]];
  const target = region.find(c => c !== st.player.cell);
  assert(target !== undefined, '找不到自动寻路目标');
  const ok = Game.pathTo(st, target);
  assert(ok, '自动寻路请求失败');
  let guard = 0;
  while (st.queue.length && guard++ < 3000) {
    Game.update(st, DT);
    if (!st.player.moving && !st.queue.length) break;
  }
  assert(st.player.cell === target, `自动寻路未到达目标 (${st.player.cell} != ${target})`);
  void cols;
}

console.log('=== 双面迷宫 · 集成通关测试 ===\n');

console.log('自动寻路');
testAutoPath();
console.log(failures === 0 ? '   ✓ 通过\n' : '   ✗ 失败\n');

for (let i = 0; i < Game.LEVELS.length; i++) {
  const st = playthrough(i);
  console.log(`第 ${i + 1} 关 ${Game.LEVELS[i].name}: 步数 ${st.steps} / 最优 ${st.level.optimal} / ` +
    `隧道 ${st.tunnelsUsed}/${st.level.tunnelCount} / 符印 ${st.crystalsTaken}/${st.level.crystals.length} / ` +
    `用时 ${st.elapsed.toFixed(1)}s`);
}

console.log('\n' + (failures === 0 ? '✅ 集成测试全部通过' : `❌ ${failures} 处断言失败`));
process.exit(failures === 0 ? 0 : 1);
