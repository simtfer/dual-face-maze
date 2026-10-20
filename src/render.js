/*!
 * render.js — Canvas 2D 渲染：霓虹双面迷宫
 * 纯绘制，无游戏逻辑；接口保持与小游戏运行时兼容（只依赖 canvas 2d context）。
 */
(function (root, factory) {
  var api = factory(root.MZ);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MZ = root.MZ || {}; root.MZ.Render = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MZ) {
  'use strict';
  var THEME = [
    { // 正面
      wall: '#38e6ff', glow: 'rgba(56,230,255,0.40)', dim: 'rgba(56,230,255,0.10)',
      label: '正 面', labelColor: '#8df1ff'
    },
    { // 背面
      wall: '#c08cff', glow: 'rgba(192,140,255,0.40)', dim: 'rgba(192,140,255,0.10)',
      label: '背 面', labelColor: '#dcc0ff'
    }
  ];

  var TUNNEL = '#ffc861';
  var TUNNEL_SOFT = 'rgba(255,200,97,0.16)';
  var GOAL = '#5dffa8';
  var CRYSTAL = '#9be7ff';
  var PLAYER = '#ffffff';

  function font(size, weight) {
    return (weight || 600) + ' ' + size + 'px "PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif';
  }

  /** 计算迷宫在画布中的位置与格子尺寸（留白由外部按实际 DOM 高度传入） */
  function layout(W, H, cols, rows, topPad, bottomPad) {
    var pad = 16;
    var top = topPad != null ? topPad : 72;
    var bottom = bottomPad != null ? bottomPad : 62;
    var availW = W - pad * 2;
    var availH = H - top - bottom;
    var cs = Math.min(availW / cols, availH / rows);
    if (!isFinite(cs) || cs <= 0) cs = 20;
    cs = Math.max(14, Math.floor(cs));
    var gw = cs * cols, gh = cs * rows;
    var ox = Math.round((W - gw) / 2);
    var oy = Math.round(top + (availH - gh) / 2);
    return { W: W, H: H, cs: cs, ox: ox, oy: oy, gw: gw, gh: gh, cols: cols, rows: rows };
  }

  function cellCenter(lay, cell) {
    return {
      x: lay.ox + (cell % lay.cols + 0.5) * lay.cs,
      y: lay.oy + (Math.floor(cell / lay.cols) + 0.5) * lay.cs
    };
  }

  function drawBackground(ctx, lay, time) {
    var W = lay.W, H = lay.H;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070f');
    g.addColorStop(0.5, '#0a1020');
    g.addColorStop(1, '#05070f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 背景微光网格
    ctx.save();
    ctx.fillStyle = 'rgba(120,190,255,0.05)';
    var step = 34, t = (time * 6) % step;
    for (var y = -step; y < H + step; y += step) {
      for (var x = -step; x < W + step; x += step) {
        var ox = (x + t) % step, oy = (y + t * 0.6) % step;
        ctx.fillRect(ox, oy, 1.4, 1.4);
      }
    }
    ctx.restore();

    // 中心光晕
    var rg = ctx.createRadialGradient(W / 2, lay.oy + lay.gh / 2, 0, W / 2, lay.oy + lay.gh / 2, Math.max(W, H) * 0.62);
    rg.addColorStop(0, 'rgba(60,120,220,0.14)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawWalls(ctx, st, lay, side) {
    var maze = st.level.faces[side];
    var th = THEME[side];
    var cs = lay.cs;
    var cols = maze.cols, rows = maze.rows;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var i = y * cols + x;
        var w = maze.walls[i];
        var px = lay.ox + x * cs, py = lay.oy + y * cs;
        if (w & 1) { ctx.moveTo(px, py); ctx.lineTo(px + cs, py); }          // N
        if (w & 8) { ctx.moveTo(px, py); ctx.lineTo(px, py + cs); }          // W
        if (x === cols - 1 && (w & 2)) { ctx.moveTo(px + cs, py); ctx.lineTo(px + cs, py + cs); }
        if (y === rows - 1 && (w & 4)) { ctx.moveTo(px, py + cs); ctx.lineTo(px + cs, py + cs); }
      }
    }

    ctx.strokeStyle = th.glow;
    ctx.shadowColor = th.glow;
    ctx.shadowBlur = Math.max(8, cs * 0.45);
    ctx.lineWidth = Math.max(2.5, cs * 0.15);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = th.wall;
    ctx.lineWidth = Math.max(1.4, cs * 0.075);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 竖井标记：左右两半分别取本面与对面的主色，
   * 表示这口井在正反两面是同一个位置（上下贯穿）。
   * 半径要大于玩家核心，才能在玩家站上洞口时依然看得出来。
   */
  function drawShaftRing(ctx, lay, side, t, time, boost) {
    var cell = t.a.side === side ? t.a.cell : t.b.cell;
    var p = cellCenter(lay, cell);
    var cs = lay.cs;
    var pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + t.id * 0.7);
    var rr = cs * 0.44;
    var selfTh = THEME[side], otherTh = THEME[1 - side];
    var alpha = (boost ? 0.95 : 0.55) + (boost ? 0.05 : 0.25 * pulse);

    ctx.save();
    ctx.lineWidth = Math.max(1.4, cs * 0.06);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.strokeStyle = selfTh.wall;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, Math.PI * 0.5, Math.PI * 1.5);
    ctx.strokeStyle = otherTh.wall;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTunnel(ctx, st, lay, time, side, t, isNext) {
    var cell = t.a.side === side ? t.a.cell : t.b.cell;
    var p = cellCenter(lay, cell);
    var cs = lay.cs;
    var pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + t.id * 0.7);
    var r = cs * (isNext ? 0.34 : 0.28);
    // 竖井：两面同一格
    var isShaft = t.a.cell === t.b.cell;

    ctx.save();
    // 底部辉光
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.9);
    g.addColorStop(0, 'rgba(255,205,110,0.42)');
    g.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();

    // 洞口外环
    ctx.strokeStyle = 'rgba(255,205,110,' + (0.5 + 0.4 * pulse) + ')';
    ctx.lineWidth = Math.max(1.4, cs * 0.065);
    ctx.shadowColor = 'rgba(255,190,80,0.9)';
    ctx.shadowBlur = 12 + (isNext ? 10 * pulse : 0);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // 竖井标记：左右两半分别取本面与对面的主色
    if (isShaft) drawShaftRing(ctx, lay, side, t, time, false);

    // 旋涡
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,230,170,' + (0.30 + 0.3 * pulse) + ')';
    ctx.lineWidth = Math.max(1, cs * 0.035);
    ctx.beginPath();
    var turns = 1.6, rr = r * (0.75 - 0.35 * pulse);
    for (var a = 0; a <= Math.PI * 2 * turns; a += 0.12) {
      var rad = rr * (a / (Math.PI * 2 * turns));
      var xx = p.x + Math.cos(a - time * 1.6 + t.id) * rad;
      var yy = p.y + Math.sin(a - time * 1.6 + t.id) * rad;
      if (a === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // 「下一处」标记环
    if (isNext) {
      ctx.strokeStyle = 'rgba(255,240,200,' + (0.35 + 0.35 * (1 - pulse)) + ')';
      ctx.lineWidth = Math.max(1, cs * 0.045);
      ctx.setLineDash([cs * 0.16, cs * 0.16]);
      ctx.lineDashOffset = -time * cs * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 编号（玩家站上洞口时由 drawFace 在最上层补画）
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,245,215,0.96)';
    ctx.font = font(Math.round(cs * 0.42), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.id), p.x, p.y + cs * 0.02);
    ctx.restore();
  }

  function drawCrystal(ctx, st, lay, time, c) {
    var p = cellCenter(lay, c.cell);
    var cs = lay.cs;
    var bob = Math.sin(time * 2.4 + c.cell) * cs * 0.05;
    var s = cs * 0.19;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(Math.PI / 4 + Math.sin(time * 1.2 + c.cell) * 0.2);
    ctx.shadowColor = 'rgba(155,231,255,0.95)';
    ctx.shadowBlur = 14;
    var g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, CRYSTAL);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGoal(ctx, st, lay, time) {
    var g = st.level.goal;
    var p = cellCenter(lay, g.cell);
    var cs = lay.cs;
    var total = st.level.crystals.length;
    var unlocked = st.crystalsTaken >= total;
    var pulse = 0.5 + 0.5 * Math.sin(time * 2.6);

    if (!unlocked) {
      // —— 锁定态：灰色虚线圆 + 挂锁图形 + 剩余数量角标 ——
      ctx.save();
      ctx.strokeStyle = 'rgba(127,147,173,0.75)';
      ctx.lineWidth = Math.max(1.2, cs * 0.055);
      ctx.setLineDash([cs * 0.1, cs * 0.12]);
      ctx.lineDashOffset = time * cs * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cs * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 锁身
      var bw = cs * 0.2, bh = cs * 0.15;
      ctx.fillStyle = 'rgba(150,168,192,0.9)';
      ctx.beginPath();
      ctx.rect(p.x - bw / 2, p.y - bh / 2 + cs * 0.03, bw, bh);
      ctx.fill();
      // 锁梁
      ctx.strokeStyle = 'rgba(150,168,192,0.9)';
      ctx.lineWidth = Math.max(1, cs * 0.04);
      ctx.beginPath();
      ctx.arc(p.x, p.y - bh / 2 + cs * 0.03, bw * 0.32, Math.PI, 0);
      ctx.stroke();

      // 剩余符印角标
      var left = total - st.crystalsTaken;
      ctx.fillStyle = 'rgba(190,205,225,0.95)';
      ctx.font = font(Math.round(cs * 0.22), 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(left), p.x + cs * 0.33, p.y - cs * 0.3);
      ctx.restore();
      return;
    }

    ctx.save();
    var rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cs * 1.1);
    rg.addColorStop(0, 'rgba(93,255,168,0.35)');
    rg.addColorStop(1, 'rgba(93,255,168,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cs * 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(93,255,168,' + (0.45 + 0.45 * pulse) + ')';
    ctx.lineWidth = Math.max(1.4, cs * 0.07);
    ctx.shadowColor = 'rgba(93,255,168,0.9)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cs * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(93,255,168,' + (0.25 + 0.35 * (1 - pulse)) + ')';
    ctx.lineWidth = Math.max(1, cs * 0.04);
    ctx.setLineDash([cs * 0.12, cs * 0.14]);
    ctx.lineDashOffset = time * cs * 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cs * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(200,255,225,0.95)';
    ctx.font = font(Math.round(cs * 0.3), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('终', p.x, p.y);
    ctx.restore();
  }

  function drawHint(ctx, st, lay) {
    if (!st.hintOn || !st.hintPath.length) return;
    var cs = lay.cs;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, cs * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([cs * 0.14, cs * 0.16]);
    ctx.shadowColor = 'rgba(255,255,255,0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    var start = cellCenter(lay, st.player.cell);
    ctx.moveTo(start.x, start.y);
    for (var i = 0; i < st.hintPath.length; i++) {
      var p = cellCenter(lay, st.hintPath[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawPlayer(ctx, st, lay, time, side) {
    var p = st.player;
    var x = lay.ox + p.rx * lay.cs;
    var y = lay.oy + p.ry * lay.cs;
    var cs = lay.cs;
    var th = THEME[side != null ? side : st.side];

    ctx.save();
    var rg = ctx.createRadialGradient(x, y, 0, x, y, cs * 0.62);
    rg.addColorStop(0, 'rgba(255,255,255,0.55)');
    rg.addColorStop(0.45, th.glow);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, cs * 0.62, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = PLAYER;
    ctx.beginPath();
    ctx.arc(x, y, cs * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = th.wall;
    ctx.lineWidth = Math.max(1, cs * 0.035);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x, y, cs * (0.24 + 0.03 * Math.sin(time * 4)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawRipple(ctx, st, lay) {
    if (!st.ripple) return;
    var r = st.ripple;
    var p = cellCenter(lay, r.cell);
    var t = r.t;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - t)) + ')';
    ctx.lineWidth = Math.max(1, lay.cs * 0.06);
    ctx.beginPath();
    ctx.arc(p.x, p.y, lay.cs * (0.2 + t * 1.4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawFace(ctx, st, lay, time, side, withPlayer) {
    drawWalls(ctx, st, lay, side);
    drawHint(ctx, st, lay);

    var crystals = st.level.crystals;
    for (var i = 0; i < crystals.length; i++) {
      if (crystals[i].side === side && !crystals[i].taken) drawCrystal(ctx, st, lay, time, crystals[i]);
    }

    if (st.level.goal.side === side) drawGoal(ctx, st, lay, time);

    var tunnels = st.level.tunnels;
    var nextTunnel = MZ.Game.expectedTunnel(st);
    for (var k = 0; k < tunnels.length; k++) {
      var isNext = nextTunnel && tunnels[k] === nextTunnel &&
        (nextTunnel.a.side === side || nextTunnel.b.side === side);
      drawTunnel(ctx, st, lay, time, side, tunnels[k], isNext);
    }

    // 玩家在翻面时跨面淡入：旧面不画、新面画
    if (withPlayer !== false) drawPlayer(ctx, st, lay, time, side);
    drawRipple(ctx, st, lay);

    // 玩家站在竖井上时，把该竖井的标记与编号补画到最上层，避免被光球吃掉
    if (withPlayer !== false) {
      for (k = 0; k < tunnels.length; k++) {
        var tcell = tunnels[k].a.side === side ? tunnels[k].a.cell : tunnels[k].b.cell;
        if (tcell !== st.player.cell) continue;
        if (tunnels[k].a.cell === tunnels[k].b.cell) {
          drawShaftRing(ctx, lay, side, tunnels[k], time, true);
        }
        var tp = cellCenter(lay, tcell);
        var lbl = String(tunnels[k].id);
        ctx.save();
        ctx.font = font(Math.round(lay.cs * 0.42), 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, lay.cs * 0.11);
        ctx.strokeStyle = 'rgba(8,12,24,0.92)';
        ctx.lineJoin = 'round';
        ctx.strokeText(lbl, tp.x, tp.y - lay.cs * 0.30);
        ctx.fillStyle = 'rgba(255,245,215,0.98)';
        ctx.fillText(lbl, tp.x, tp.y - lay.cs * 0.30);
        ctx.restore();
      }
    }
  }

  /**
   * 翻转特效：竖井是贯穿正反两面的，所以翻转时网格保持不动，
   * 只做「双面交叉溶解 + 光带扫过 + 竖井光柱」，
   * 让玩家清楚地看到「我还在同一格，只是掉到了另一面」。
   */
  function drawFlipFx(ctx, st, lay, t, from, to) {
    var W = lay.W, H = lay.H;
    var x = W * (t * 1.45 - 0.22);
    var g = ctx.createLinearGradient(x - W * 0.24, 0, x + W * 0.24, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(190,230,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 竖井光柱：翻转点正上下的那道「井」透出光
    var cell = (st.lastWarp && st.lastWarp.cell != null) ? st.lastWarp.cell : null;
    if (cell == null) {
      var tun = MZ.Game.expectedTunnel(st);
      if (tun) cell = tun.a.side === from ? tun.a.cell : tun.b.cell;
    }
    if (cell != null) {
      var p = cellCenter(lay, cell);
      var cs = lay.cs;
      var beam = ctx.createLinearGradient(p.x, p.y - cs * 1.6, p.x, p.y + cs * 1.6);
      beam.addColorStop(0, 'rgba(255,255,255,0)');
      beam.addColorStop(0.5, 'rgba(255,240,200,' + (0.45 * Math.sin(Math.PI * t)) + ')');
      beam.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = beam;
      ctx.fillRect(p.x - cs * 0.16, p.y - cs * 1.6, cs * 0.32, cs * 3.2);
    }
    ctx.restore();
  }

  function draw(ctx, st, lay, time) {
    ctx.clearRect(0, 0, lay.W, lay.H);
    drawBackground(ctx, lay, time);

    if (st.flip.active) {
      var p = st.flip.t;
      var from = st.flip.from, to = 1 - st.flip.from;
      // 原面打底（不画玩家），目标面按进度叠加 —— 网格不发生位移
      drawFace(ctx, st, lay, time, from, false);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, (p - 0.32) / 0.46));
      drawFace(ctx, st, lay, time, to, true);
      ctx.restore();
      drawFlipFx(ctx, st, lay, p, from, to);
      return;
    }

    drawFace(ctx, st, lay, time, st.side);
  }

  return { layout: layout, draw: draw, cellCenter: cellCenter, THEME: THEME };
});
