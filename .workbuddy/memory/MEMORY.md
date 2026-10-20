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
- 🔴 **核心机制（2026-10-21 定稿）：隧道 = 贯穿正反两面的垂直竖井，同一条隧道在两面是同一格。**
  - 生成顺序：**先定竖井、再长密室**（不是先分区后插隧道）：
    1. `game.js` 的 `findShaftPath()` 在网格上生成 `2k-1` 格**自避折线** `shaft[0..2k-2]`；
    2. **错位咬合**种子：正面第 i 间 = `{shaft[2i-1], shaft[2i]}`，背面第 i 间 = `{shaft[2i], shaft[2i+1]}`；
       两面共享同一批 shaft 格但**错开一格**归属 ⇒ `shaft[j]` 在两面落进不同密室 ⇒ 房间图仍是
       `A0–B0–A1–B1–…` 简单路径，漏斗性质保留；
    3. `maze.js` 的 `growRegions()` 多源随机边界扩张分区 → `carveByLabel()` 区域内跑 DFS 生成树，
       **区域之间墙体全封死**（这是"不穿竖井到不了下一间密室"的保证）。
  - 隧道对象带 `cell` 字段（= `shaft[j]`），`a.cell === b.cell` 是**不变量**。
  - ⚠️ 旧的切刀式分区（`_findCut` / `_splitRegion` / `splitIntoRegions`）**已删除**，勿复活 ——
    它无法指定"某区域必须包含某几个指定格"。
- `tools/` 下三个无头测试是**回归网**，改算法后必须跑：
  `node tools/test-solvable.js` && `node tools/test-shaft.js` && `node tools/test-playthrough.js`
  （`test-shaft.js` 是"两面同位"专项：同格 / 落点不重复 / 洞口数 / 错位咬合公式 / 编号一致）

### 渲染层约定
- 竖井视觉：**双色半环**（左半本面色 + 右半对面色，半径 `cs*0.44`）表示贯穿两面。
- 玩家站上竖井时，**编号与双色环要补画到最上层**（`drawFace` 尾部），否则被玩家光球吃掉。
- 🔴 **翻转动画不要用 `scaleX` 镜像**！竖井两面同格 ⇒ 镜像会让玩家以为自己在别处。
  现在是「双面交叉溶解 + 光带扫过 + 竖井垂直光柱」，**网格完全不动**。
  光柱定位用 `state.lastWarp`（`{cell, id}`），**不能**用 `expectedTunnel()`（stage 已前进，会画错位置）。
- `state.lastWarp` 由 `game.js` 的 `tryTraverse()` 设置。

### 🔴 已知设计缺陷（2026-10-21 实测量化，960 密室样本）
按优先级排序，**改任何算法前先看这里**：

| 级别 | 问题 | 实测数据 | 根因 | 建议修法 |
|---|---|---|---|---|
| **P0** | 密室形同虚设 | **65%~86% 的密室入口到出口只隔 ≤1 步**（内部被整体跳过） | 竖井链是**连续折线**，相邻两口井在网格上必然相邻 ⇒ 同面里密室入口格/出口格也相邻 | `findShaftPath()` 改**分散布置**（井距 ≥3 格）。原型验证：被跳过 83%→8%，房内深度中位 1→8 步，**生成成功率 42%→100%** |
| **P1** | 「双面同位」纯属视觉装饰 | 正反两面墙体一致率仅 **16%** | 两面各自独立 `growRegions`，除竖井外无几何关联 | 让背面墙体 = 正面墙体的镜像/翻转（同坐标对应），玩家才能推理"翻过去通向哪" |
| **P1** | 密室内部零决策空间 | 密室内部**环数 = 0**（纯 DFS 树），开放通道/格数 = 0.98 | `carveByLabel()` 只生成树 | DFS 后再打通 1~2 条墙，形成环路 |
| **P2** | 评级不体现双面玩法 | 穿隧道仅占全收集最优步数的 **3%**（L4：217 步中仅 7 步） | 评级只看 `steps / optimal` | 改为「步数 + 穿井次数」双指标；符印改可选 |
| **P2** | 零留存 | 无存档（刷新即丢关卡进度）、无排行榜/每日挑战 | — | 发小游戏平台前必补 |

其它实测数字（2026-10-21，seed 777+n）：
- 全收集最优 vs 最短通关：**77/21、188/26、115/35、217/35、261/39、262/40** ⇒ 符印绕路占 **73%~86%**
- 符印深度（入口→符印）中位 9 步，**44% 超过 10 步**，最大 47 步
- 竖井分散原型脚本：`tools/proto-shaft-spread.js`（可复跑对比）

### 环境备忘
- 本机 `playwright-cli` 可用于浏览器实测（**file:// 协议被禁，必须起 http server**）。
  路径：`C:/Users/dingy/.workbuddy/binaries/node/versions/22.22.2-6/playwright-cli`
- playwright-cli 的浏览器会话**跨 bash 调用不保持**，open→操作→截图要放在同一条命令里。
- Node：`C:/Users/dingy/.workbuddy/binaries/node/versions/22.12.0/node.exe`
- `maze.findPath(from, to)` 返回**不含起点**的路径数组 —— 写模拟脚本时别把 `path[0]` 当起点。
- `Game.tryMove` 内部有 `if (state_.player.moving) return false` ⇒ 模拟连续移动时
  必须在**每次调用前**清掉 `player.moving`，否则第二步就卡住。
