# 项目长期记忆

## 项目：双面迷宫（Dual-Face Maze）

路径：`D:/projects/maze` · 起始：2026-10-21

### Git 远程（2026-10-21 建立）
- 仓库：**https://github.com/simtfer/dual-face-maze**（**PUBLIC**，用户明确选择公开）
- 远程：`git@github.com:simtfer/dual-face-maze.git`（SSH）
- 本地分支 `main` 跟踪 `origin/main`；首次提交 `1c95474`
- ⚠️ 本项目**没有** `core.sshCommand` 的 WSL 路径坑 —— 那只存在于 obsidian-vault 仓库。
  本机全局 git 身份已是 `simtfer <20667469+simtfer@users.noreply.github.com>`，
  与 GitHub 账号一致，提交归属正常。
- `.gitignore` 已排除 `.playwright-cli/`（浏览器会话产物）；`.workbuddy/memory/` **保留在版本控制内**。

### 定位
HTML 版双面迷宫游戏，**后续计划发布到抖音小游戏和微信小游戏**。
⇒ 架构上必须保证「核心逻辑与渲染不依赖 DOM」，小游戏移植只重写引导层。

### 分层约定（不要破坏）
| 文件 | 依赖 | 小游戏 |
|---|---|---|
| `src/maze.js` | 无 | 原样复用 |
| `src/game.js` | 无 | 原样复用 |
| `src/render.js` | 仅 Canvas 2D context | 原样复用 |
| `src/main.js` | DOM / 键盘 / WebAudio | 需重写 |

三个核心模块统一用 **UMD**（非 Node 环境挂 `root.MZ.X = api`，Node 环境 `module.exports = api`）。
⚠️ 统一用 `root.MZ.Game = api` 这种**具名挂载**，不要 `Object.assign(root.MZ, api)` 平铺 —— 平铺会让
`main.js` 里的 `MZ.Game` 取不到，而 Node 的 `require` 会直接返回模块，**掩盖这个 bug**。

### 玩法不变式（改动时别破坏）
- 每面切分成 k 个密室 → 隧道数 = `2k-1`，密室串成链，中间密室只有 1 进 1 出 ⇒ **隧道必须按序穿**。
- 终点需集齐全部符印才解锁。
- 🔴 **核心机制（2026-10-21 定稿，同日重写算法）：隧道 = 贯穿正反两面的垂直竖井，同一条隧道在两面是同一格。**
  - 生成顺序：**先铺骨架、再定竖井、最后长密室**：
    1. `game.js` 的 `buildRoutePath()` 在网格上铺一条**自避骨架路径** `route`（蜿蜒、不重复）；
    2. `pickShafts()` 在骨架上按**间隔**挑出 `2k-1` 个竖井落点 `shaft[0..2k-2]`，
       竖井 `j` 固定落在 `shaft[j]`；间隔预算**必须按比例分摊**给每一段
       （早期版本一次性给完，导致某间密室主脊长 43 格、其余全被挤扁）；
    3. **错位咬合（主脊级）**：正面第 i 间密室的**主脊** = 骨架上 `shaft[2i-1]→shaft[2i]` 段，
       背面第 i 间 = `shaft[2i]→shaft[2i+1]` 段；两面**错开一段**地共享竖井格。
       ⇒ 同一间密室在两面是两段**不同的**骨架切片（实测主脊重合率 0%），
       房间图仍是 `A0–B0–A1–B1–…` 简单路径，漏斗性质保留；
    4. `maze.js` 的 `growRegions()` 以各段主脊为种子做多源随机边界扩张分区
       （第 5 个参数 `exclude` = 房间之间那段骨架，在这一面封成实心）；
    5. `carveByLabel()` **主脊优先**雕刻：先打通主脊 → 其余格从主脊长成树枝 → 主脊旁掏口袋环。
       **区域是一棵树 ⇒ 两洞口最短距离恒等于主脊长度，数学上不可能被一步跨过**；
       **主脊天然连通 ⇒ 密室不会断连**。
  - 隧道对象带 `cell` 字段（= `shaft[j]`），`a.cell === b.cell` 是**不变量**。
  - ⚠️ 旧的切刀式分区（`_findCut` / `_splitRegion` / `splitIntoRegions`）**已删除**，勿复活 ——
    它无法指定"某区域必须包含某几个指定格"。
- `tools/` 下四个无头测试是**回归网**，改算法后必须跑：
  `node tools/test-solvable.js` && `node tools/test-shaft.js` &&
  `node tools/test-playthrough.js` && `node tools/test-rooms.js`
  （`test-shaft.js` = "两面同位"专项；`test-rooms.js` = **密室质量量化表**，改生成算法后必看）

### 渲染层约定
- 竖井视觉：**双色半环**（左半本面色 + 右半对面色，半径 `cs*0.44`）表示贯穿两面。
- 玩家站上竖井时，**编号与双色环要补画到最上层**（`drawFace` 尾部），否则被玩家光球吃掉。
- 🔴 **翻转动画不要用 `scaleX` 镜像**！竖井两面同格 ⇒ 镜像会让玩家以为自己在别处。
  现在是「双面交叉溶解 + 光带扫过 + 竖井垂直光柱」，**网格完全不动**。
  光柱定位用 `state.lastWarp`（`{cell, id}`），**不能**用 `expectedTunnel()`（stage 已前进，会画错位置）。
- `state.lastWarp` 由 `game.js` 的 `tryTraverse()` 设置。

### ✅ 设计缺陷修复状态（2026-10-21 更新）

| 级别 | 问题 | 修复前实测 | 修复后实测 | 状态 |
|---|---|---|---|---|
| **P0** | 密室形同虚设 | 65%~86% 的密室 ≤1 步跨过 | **0%**，纵深中位 9 步 / 最小 5 步 | ✅ 已修（骨架路径 + 主脊优先雕刻） |
| **P1** | 密室内部零决策空间 | 密室内部环数 = 0 | **98.4%** 的密室有 ≥1 个环 | ✅ 已修（主脊旁掏口袋环） |
| **P1** | 两面无真实关联 | 正面背面各自独立长房间 | **同一间密室在两面主脊重合 0%**（两段不同切片） | ✅ 已修 |
| **P2** | 评级不体现双面玩法 | 穿井仅占最优步数 3% | 竖井贯穿全程，符印绕路 **+46%**（原 +73~86% 失真） | ⚠️ 部分（评级公式还没改） |
| **P2** | 零留存 | 无存档 / 无排行 | 未动 | ⏳ 未做 |

> 修复前基线（960 密室样本）仍记在 `2026-10-21.md` 的评审章节里，便于对比。

### 🔴 踩过的坑：DFS 迭代写法（2026-10-21，浪费很多时间）

重写 `carveByLabel()` 时把迭代 DFS 写成：
```js
var cur = stack.pop();          // ❌ 弹出即丢
```
这样当前格**剩下**的候选邻居会被直接丢弃、永远不再回访 ⇒ 大量区域格子成了
「有标签但走不到」的孤立碎块 ⇒ 房间看起来断连、环路统计算成负数。

正确写法（与 `maze.js` 里 `_carve()` 一致）：**窥栈顶，不弹栈**
```js
var cur = stack[stack.length - 1];
if (!cand.length) { stack.pop(); continue; }   // 只有真的没出路了才弹
```
症状极隐蔽：单区域 `growRegions` 测试连通性正常，但**多区域 + 禁区**时区域被切碎。
定位方法是「比较标签格数 vs DFS 可达格数」，而不是只看连通分量。

### 环境备忘
- 本机 `playwright-cli` 可用于浏览器实测（**file:// 协议被禁，必须起 http server**）。
  路径：`C:/Users/dingy/.workbuddy/binaries/node/versions/22.22.2-6/playwright-cli`
- playwright-cli 的浏览器会话**跨 bash 调用不保持**，open→操作→截图要放在同一条命令里。
- Node：`C:/Users/dingy/.workbuddy/binaries/node/versions/22.12.0/node.exe`
- `maze.findPath(from, to)` 返回**不含起点**的路径数组 —— 写模拟脚本时别把 `path[0]` 当起点。
- `Game.tryMove` 内部有 `if (state_.player.moving) return false` ⇒ 模拟连续移动时
  必须在**每次调用前**清掉 `player.moving`，否则第二步就卡住。
