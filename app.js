(() => {
  'use strict';

  const W = 1920;
  const H = 1200;

  const stageEl = document.getElementById('stage');
  const wrapEl = document.getElementById('canvasWrap');
  const wallEl = document.getElementById('wall');
  const paintEl = document.getElementById('paint');
  const previewEl = document.getElementById('preview');
  const wallCtx = wallEl.getContext('2d');
  const pctx = paintEl.getContext('2d');
  const vctx = previewEl.getContext('2d');

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const colorsEl = document.getElementById('colors');
  const customSwatch = document.getElementById('customSwatch');
  const customInner = document.getElementById('customInner');
  const colorInput = document.getElementById('colorInput');
  const sizeInput = document.getElementById('sizeInput');
  const alphaInput = document.getElementById('alphaInput');
  const smoothInput = document.getElementById('smoothInput');
  const sizeVal = document.getElementById('sizeVal');
  const alphaVal = document.getElementById('alphaVal');
  const smoothVal = document.getElementById('smoothVal');
  const emptyHint = document.getElementById('emptyHint');
  const cursorEl = document.getElementById('cursor');
  const toastEl = document.getElementById('toast');

  const PALETTE = [
    ['#ff2e63', 'розовый неон'],
    ['#ff8a1e', 'оранжевый'],
    ['#ffe14d', 'жёлтый'],
    ['#6bff4f', 'лайм'],
    ['#22e6d0', 'бирюзовый'],
    ['#3d8bff', 'синий'],
    ['#b14cff', 'фиолетовый'],
    ['#ffffff', 'белый'],
    ['#111114', 'чёрный']
  ];

  const state = {
    mode: 'spray',
    color: '#ff2e63',
    size: 32,
    alpha: 0.8,
    smooth: 0.6,
    wall: 'brick'
  };

  const undoHistory = [];
  const redoStack = [];
  let drawing = null;
  let isDrawing = false;
  let activePointerId = null;
  let cursorShown = false;
  let toastTimer = 0;

  // ---------- utils ----------

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  function withAlpha(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w = W, h = H) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  // ---------- wall textures ----------

  function fillGrain(g, count, maxSize = 2.2, maxAlpha = 0.05) {
    for (let i = 0; i < count; i++) {
      const white = Math.random() < 0.5;
      const a = Math.random() * maxAlpha;
      g.fillStyle = white ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(Math.random() * W, Math.random() * H, rand(0.5, maxSize), rand(0.5, maxSize));
    }
  }

  function addStains(g, count, maxAlpha = 0.14) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = rand(90, 430);
      const gr = g.createRadialGradient(x, y, r * 0.05, x, y, r);
      gr.addColorStop(0, `rgba(18,12,10,${rand(0.03, maxAlpha)})`);
      gr.addColorStop(1, 'rgba(18,12,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  function addDust(g, count) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = rand(120, 440);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,225,190,${rand(0.02, 0.05)})`);
      gr.addColorStop(1, 'rgba(255,225,190,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawCracks(g, count, color) {
    for (let i = 0; i < count; i++) {
      let x = Math.random() * W;
      let y = Math.random() * H;
      let ang = Math.PI / 2 + rand(-0.6, 0.6);
      g.strokeStyle = color;
      g.lineWidth = rand(0.6, 1.6);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      const segs = 8 + Math.floor(Math.random() * 12);
      for (let s = 0; s < segs; s++) {
        ang += rand(-0.35, 0.35);
        const len = rand(8, 30);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        g.lineTo(x, y);
      }
      g.stroke();

      if (Math.random() < 0.7) {
        let bx = x;
        let by = y;
        let ba = ang + rand(-1.2, 1.2);
        g.beginPath();
        g.moveTo(bx, by);
        for (let s = 0; s < 5; s++) {
          ba += rand(-0.5, 0.5);
          bx += Math.cos(ba) * rand(6, 18);
          by += Math.sin(ba) * rand(6, 18);
          g.lineTo(bx, by);
        }
        g.stroke();
      }
    }
  }

  function addNoiseOverlay(g, strength) {
    const nw = 960;
    const nh = 600;
    const noise = makeCanvas(nw, nh);
    const ng = noise.getContext('2d');
    const img = ng.createImageData(nw, nh);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 96;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ng.putImageData(img, 0, 0);
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = strength;
    g.drawImage(noise, 0, 0, W, H);
    g.restore();
  }

  function addVignette(g, strength) {
    const cx = W * 0.5;
    const cy = H * 0.46;
    const vg = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.22, cx, cy, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.62, `rgba(0,0,0,${strength * 0.28})`);
    vg.addColorStop(1, `rgba(0,0,0,${strength})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    const bottom = g.createLinearGradient(0, H * 0.82, 0, H);
    bottom.addColorStop(0, 'rgba(0,0,0,0)');
    bottom.addColorStop(1, 'rgba(0,0,0,0.26)');
    g.fillStyle = bottom;
    g.fillRect(0, 0, W, H);
  }

  function buildBrickWall() {
    const c = makeCanvas();
    const g = c.getContext('2d');
    g.fillStyle = '#3c322c';
    g.fillRect(0, 0, W, H);
    fillGrain(g, 7000, 2.4, 0.06);

    const brickW = 164;
    const brickH = 56;
    const gap = 8;
    const rows = Math.ceil(H / (brickH + gap)) + 1;
    const cols = Math.ceil(W / (brickW + gap)) + 2;

    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? (brickW + gap) / 2 : 0;
      for (let col = -1; col < cols; col++) {
        const x = col * (brickW + gap) + offset + rand(-1.2, 1.2);
        const y = row * (brickH + gap) + rand(-1.2, 1.2);
        const hue = rand(8, 20);
        const sat = rand(26, 44);
        let light = rand(23, 34);
        if (Math.random() < 0.08) light += rand(5, 10);
        if (Math.random() < 0.07) light -= rand(4, 8);

        g.fillStyle = `hsl(${hue} ${sat}% ${light}%)`;
        rr(g, x, y, brickW, brickH, 2.5);
        g.fill();

        const grad = g.createLinearGradient(0, y, 0, y + brickH);
        grad.addColorStop(0, 'rgba(255,225,200,0.08)');
        grad.addColorStop(0.15, 'rgba(255,255,255,0)');
        grad.addColorStop(0.8, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.22)');
        g.fillStyle = grad;
        rr(g, x, y, brickW, brickH, 2.5);
        g.fill();

        for (let i = 0; i < 22; i++) {
          const dark = Math.random() < 0.6;
          const a = dark ? rand(0.03, 0.12) : rand(0.01, 0.05);
          g.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
          g.fillRect(
            x + 3 + Math.random() * (brickW - 6),
            y + 3 + Math.random() * (brickH - 6),
            rand(0.6, 2.6),
            rand(0.6, 2.6)
          );
        }

        if (Math.random() < 0.13) {
          g.fillStyle = 'rgba(18,12,10,0.24)';
          g.beginPath();
          g.ellipse(
            x + Math.random() * brickW,
            y + Math.random() * brickH,
            rand(3, 9),
            rand(2, 5),
            Math.random() * Math.PI,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
    }

    addStains(g, 9, 0.16);
    addDust(g, 4);
    drawCracks(g, 5, 'rgba(10,6,5,0.30)');

    const light = g.createLinearGradient(0, 0, 0, H);
    light.addColorStop(0, 'rgba(255,232,205,0.10)');
    light.addColorStop(0.4, 'rgba(255,232,205,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);

    addNoiseOverlay(g, 0.16);
    addVignette(g, 0.44);
    return c;
  }

  function buildConcreteWall() {
    const c = makeCanvas();
    const g = c.getContext('2d');
    g.fillStyle = '#8b877f';
    g.fillRect(0, 0, W, H);

    for (let i = 0; i < 34; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const rx = rand(80, 420);
      const ry = rand(60, 300);
      const dark = Math.random() < 0.6;
      const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gr.addColorStop(0, dark ? `rgba(55,50,44,${rand(0.04, 0.12)})` : `rgba(255,248,232,${rand(0.03, 0.08)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rx, ry, rand(-0.4, 0.4), 0, Math.PI * 2);
      g.fill();
    }

    const pw = W / 3;
    const ph = H / 2;

    const drawSeam = (x1, y1, x2, y2, vertical) => {
      g.fillStyle = 'rgba(25,22,19,0.32)';
      g.fillRect(x1 - (vertical ? 2.5 : 0), y1 - (vertical ? 0 : 2.5), vertical ? 5 : x2 - x1, vertical ? y2 - y1 : 5);
      g.fillStyle = 'rgba(255,248,235,0.10)';
      g.fillRect(x1 + (vertical ? 3 : 0), y1 + (vertical ? 0 : 3), vertical ? 1 : x2 - x1, vertical ? y2 - y1 : 1);
    };

    for (let i = 1; i < 3; i++) drawSeam(i * pw, 0, i * pw, H, true);
    drawSeam(0, ph, W, ph, false);

    const tieHole = (x, y) => {
      g.fillStyle = 'rgba(30,26,22,0.6)';
      g.beginPath();
      g.arc(x, y, 5.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,248,235,0.10)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x - 1, y - 1, 6.5, 0, Math.PI * 2);
      g.stroke();
      const streak = g.createLinearGradient(0, y + 4, 0, y + rand(40, 110));
      streak.addColorStop(0, 'rgba(60,45,32,0.12)');
      streak.addColorStop(1, 'rgba(60,45,32,0)');
      g.fillStyle = streak;
      g.fillRect(x - 4, y + 4, rand(6, 10), rand(40, 110));
    };

    for (let col = 0; col <= 3; col++) {
      for (let row = 0; row <= 2; row++) {
        if (Math.random() < 0.75) tieHole(col * pw + (col === 0 ? 40 : col === 3 ? -40 : 0), row * ph + (row === 0 ? 40 : row === 2 ? -40 : 0));
      }
    }

    fillGrain(g, 22000, 2.4, 0.07);

    for (let i = 0; i < 14; i++) {
      const x = Math.random() * W;
      const top = rand(0, H * 0.45);
      const len = rand(140, 560);
      const wd = rand(10, 80);
      const gr = g.createLinearGradient(0, top, 0, top + len);
      gr.addColorStop(0, `rgba(24,22,20,${rand(0.06, 0.17)})`);
      gr.addColorStop(1, 'rgba(24,22,20,0)');
      g.fillStyle = gr;
      g.fillRect(x, top, wd, len);
    }

    for (let i = 0; i < 18; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const rx = rand(4, 26);
      const ry = rand(3, 14);
      g.fillStyle = `rgba(40,35,30,${rand(0.06, 0.16)})`;
      g.beginPath();
      g.ellipse(x, y, rx, ry, rand(0, Math.PI), 0, Math.PI * 2);
      g.fill();
      for (let k = 0; k < 10; k++) {
        g.fillStyle = `rgba(255,248,235,${rand(0.03, 0.09)})`;
        g.fillRect(x + rand(-rx, rx), y + rand(-ry, ry), rand(0.5, 1.6), rand(0.5, 1.6));
      }
    }

    addStains(g, 10, 0.18);
    addDust(g, 4);
    drawCracks(g, 8, 'rgba(22,19,17,0.30)');

    const grime = g.createLinearGradient(0, H * 0.55, 0, H);
    grime.addColorStop(0, 'rgba(30,26,22,0)');
    grime.addColorStop(1, 'rgba(30,26,22,0.20)');
    g.fillStyle = grime;
    g.fillRect(0, 0, W, H);

    const light = g.createLinearGradient(0, 0, 0, H);
    light.addColorStop(0, 'rgba(255,248,235,0.10)');
    light.addColorStop(0.5, 'rgba(255,248,235,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.13)');
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);

    addNoiseOverlay(g, 0.2);
    addVignette(g, 0.38);
    return c;
  }

  function buildNightWall() {
    const c = makeCanvas();
    const g = c.getContext('2d');
    g.fillStyle = '#232630';
    g.fillRect(0, 0, W, H);
    fillGrain(g, 6000, 2.2, 0.05);

    const brickW = 164;
    const brickH = 56;
    const gap = 8;
    const rows = Math.ceil(H / (brickH + gap)) + 1;
    const cols = Math.ceil(W / (brickW + gap)) + 2;

    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? (brickW + gap) / 2 : 0;
      for (let col = -1; col < cols; col++) {
        const x = col * (brickW + gap) + offset + rand(-1.2, 1.2);
        const y = row * (brickH + gap) + rand(-1.2, 1.2);
        const hue = rand(208, 226);
        const sat = rand(7, 15);
        let light = rand(13, 21);
        if (Math.random() < 0.08) light += rand(3, 6);
        if (Math.random() < 0.08) light -= rand(3, 6);

        g.fillStyle = `hsl(${hue} ${sat}% ${light}%)`;
        rr(g, x, y, brickW, brickH, 2.5);
        g.fill();

        const grad = g.createLinearGradient(0, y, 0, y + brickH);
        grad.addColorStop(0, 'rgba(190,210,255,0.07)');
        grad.addColorStop(0.16, 'rgba(255,255,255,0)');
        grad.addColorStop(0.8, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        g.fillStyle = grad;
        rr(g, x, y, brickW, brickH, 2.5);
        g.fill();

        for (let i = 0; i < 18; i++) {
          const dark = Math.random() < 0.6;
          const a = dark ? rand(0.03, 0.10) : rand(0.01, 0.045);
          g.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(190,210,255,${a})`;
          g.fillRect(
            x + 3 + Math.random() * (brickW - 6),
            y + 3 + Math.random() * (brickH - 6),
            rand(0.6, 2.4),
            rand(0.6, 2.4)
          );
        }

        if (Math.random() < 0.1) {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath();
          g.ellipse(
            x + Math.random() * brickW,
            y + Math.random() * brickH,
            rand(3, 9),
            rand(2, 5),
            Math.random() * Math.PI,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
    }

    const wash = g.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, 'rgba(105,135,200,0.13)');
    wash.addColorStop(0.5, 'rgba(20,24,34,0)');
    wash.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);

    const spot = g.createRadialGradient(W * 0.46, -H * 0.12, 100, W * 0.46, -H * 0.12, H * 1.05);
    spot.addColorStop(0, 'rgba(255,208,156,0.17)');
    spot.addColorStop(0.45, 'rgba(255,208,156,0.06)');
    spot.addColorStop(1, 'rgba(255,208,156,0)');
    g.fillStyle = spot;
    g.fillRect(0, 0, W, H);

    addStains(g, 10, 0.24);
    addDust(g, 3);
    drawCracks(g, 6, 'rgba(0,0,0,0.4)');
    addNoiseOverlay(g, 0.16);
    addVignette(g, 0.56);
    return c;
  }

  const wallCache = new Map();
  const wallBuilders = {
    brick: buildBrickWall,
    concrete: buildConcreteWall,
    night: buildNightWall
  };

  function getWallTexture(type) {
    if (!wallCache.has(type)) wallCache.set(type, wallBuilders[type]());
    return wallCache.get(type);
  }

  function setWall(type) {
    state.wall = type;
    const texture = getWallTexture(type);
    wallCtx.clearRect(0, 0, W, H);
    wallCtx.drawImage(texture, 0, 0);
    document.querySelectorAll('.wall-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.wall === type);
    });
  }

  // ---------- drawing engine ----------

  function makeRuntime(action) {
    return {
      action,
      mode: action.mode,
      color: action.color,
      size: action.size,
      alpha: action.alpha,
      smooth: action.smooth || 0,
      rng: mulberry32(action.seed),
      spline: null,
      lastSample: null,
      lastRaw: null,
      stab: null,
      carry: 0
    };
  }

  const TAU = Math.PI * 2;

  function sprayStamp(ctx, rt, x, y, pressure) {
    const rnd = rt.rng;
    const r = Math.max(2, rt.size * 0.5 * (0.72 + 0.28 * pressure));
    const a = rt.alpha;

    const grad = ctx.createRadialGradient(x, y, r * 0.04, x, y, r);
    grad.addColorStop(0, withAlpha(rt.color, a * 0.17));
    grad.addColorStop(0.55, withAlpha(rt.color, a * 0.105));
    grad.addColorStop(0.85, withAlpha(rt.color, a * 0.05));
    grad.addColorStop(1, withAlpha(rt.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    const grains = Math.floor(r * 1.9);
    for (let i = 0; i < grains; i++) {
      const ang = rnd() * TAU;
      const dist = Math.sqrt(rnd()) * r * 1.02;
      const s = 0.4 + rnd() * 1.7;
      ctx.fillStyle = withAlpha(rt.color, a * (0.12 + rnd() * 0.4));
      ctx.fillRect(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, s);
    }

    const over = Math.floor(r * 0.6);
    for (let i = 0; i < over; i++) {
      const ang = rnd() * TAU;
      const dist = r * (1 + rnd() * 0.32);
      const s = 0.5 + rnd() * 1.1;
      ctx.fillStyle = withAlpha(rt.color, a * (0.03 + rnd() * 0.08));
      ctx.fillRect(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, s);
    }
  }

  function brushStamp(ctx, rt, x, y, pressure) {
    const rnd = rt.rng;
    const base = Math.max(2.2, rt.size * 0.5 * (0.6 + 0.4 * pressure));
    const r = base * (0.95 + rnd() * 0.1);
    const a = rt.alpha;
    const grad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    grad.addColorStop(0, withAlpha(rt.color, a * 0.6));
    grad.addColorStop(0.72, withAlpha(rt.color, a * 0.52));
    grad.addColorStop(0.92, withAlpha(rt.color, a * 0.22));
    grad.addColorStop(1, withAlpha(rt.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    const dabs = Math.min(4, Math.round(base / 12));
    for (let i = 0; i < dabs; i++) {
      const ang = rnd() * TAU;
      const dist = r * (0.55 + rnd() * 0.35);
      ctx.fillStyle = withAlpha(rt.color, a * 0.18);
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, r * (0.1 + rnd() * 0.12), 0, TAU);
      ctx.fill();
    }
  }

  function markerWidth(rt, p) {
    return Math.max(2, rt.size * 0.42 * (0.68 + 0.32 * p));
  }

  function pencilWidth(rt, p) {
    return Math.max(0.9, rt.size * 0.115 * (0.72 + 0.28 * p));
  }

  function eraserWidth(rt) {
    return Math.max(6, rt.size * 0.9);
  }

  function markerDot(ctx, rt, pt) {
    const w = markerWidth(rt, pt.p);
    ctx.fillStyle = rt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, w / 2, 0, TAU);
    ctx.fill();
  }

  function markerSegment(ctx, rt, a, b) {
    ctx.strokeStyle = rt.color;
    ctx.lineWidth = markerWidth(rt, b.p);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function pencilGrain(ctx, rt, x, y, w, n) {
    const rnd = rt.rng;
    for (let i = 0; i < n; i++) {
      const ang = rnd() * TAU;
      const dist = rnd() * w * 0.9;
      const s = 0.35 + rnd() * 0.85;
      ctx.fillStyle = withAlpha(rt.color, rt.alpha * (0.1 + rnd() * 0.35));
      ctx.fillRect(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, s);
    }
  }

  function pencilDot(ctx, rt, pt) {
    const w = pencilWidth(rt, pt.p);
    ctx.fillStyle = withAlpha(rt.color, Math.min(1, rt.alpha * 0.85));
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(0.7, w / 2), 0, TAU);
    ctx.fill();
    pencilGrain(ctx, rt, pt.x, pt.y, w, 8);
  }

  function pencilSegment(ctx, rt, a, b) {
    const w = pencilWidth(rt, (a.p + b.p) * 0.5);
    ctx.strokeStyle = withAlpha(rt.color, Math.min(1, rt.alpha * 0.58));
    ctx.lineWidth = Math.max(0.7, w * 0.8);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const nx = dist ? -dy / dist : 0;
    const ny = dist ? dx / dist : 0;
    const n = Math.min(10, Math.max(1, Math.round(dist / 6)));
    const rnd = rt.rng;
    for (let i = 0; i < n; i++) {
      const t = rnd();
      const off = (rnd() - 0.5) * w * 1.4;
      const s = 0.35 + rnd() * 0.9;
      ctx.fillStyle = withAlpha(rt.color, rt.alpha * (0.08 + rnd() * 0.3));
      ctx.fillRect(a.x + dx * t + nx * off, a.y + dy * t + ny * off, s, s);
    }
  }

  function eraseDot(ctx, rt, pt) {
    const w = eraserWidth(rt);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, w / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function eraseSegment(ctx, rt, a, b) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = eraserWidth(rt);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function sprayWalk(rt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const step = Math.max(1.2, rt.size * 0.14);
    let t = step - rt.carry;
    if (t < 0) t += step;
    while (t <= dist) {
      const k = t / dist;
      sprayStamp(pctx, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  function brushWalk(rt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const step = Math.max(0.9, rt.size * 0.5 * 0.22);
    let t = step - rt.carry;
    if (t < 0) t += step;
    while (t <= dist) {
      const k = t / dist;
      brushStamp(pctx, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  function drawDot(rt, pt) {
    switch (rt.mode) {
      case 'spray': sprayStamp(pctx, rt, pt.x, pt.y, pt.p); break;
      case 'marker': markerDot(vctx, rt, pt); break;
      case 'brush': brushStamp(pctx, rt, pt.x, pt.y, pt.p); break;
      case 'pencil': pencilDot(pctx, rt, pt); break;
      case 'eraser': eraseDot(pctx, rt, pt); break;
    }
    rt.lastSample = pt;
    rt.carry = 0;
  }

  function drawSegment(rt, a, b) {
    switch (rt.mode) {
      case 'spray': sprayWalk(rt, a, b); break;
      case 'marker': markerSegment(vctx, rt, a, b); break;
      case 'brush': brushWalk(rt, a, b); break;
      case 'pencil': pencilSegment(pctx, rt, a, b); break;
      case 'eraser': eraseSegment(pctx, rt, a, b); break;
    }
  }

  function emitCurve(rt, a, c, b) {
    const rough = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    if (rough < 0.05) return;
    const stepPx = Math.max(1, rt.size * 0.055);
    const steps = Math.min(320, Math.max(1, Math.ceil(rough / stepPx)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const sample = {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        p: a.p + (b.p - a.p) * t
      };
      drawSegment(rt, rt.lastSample, sample);
      rt.lastSample = sample;
    }
  }

  function splinePush(rt, pt) {
    if (!rt.spline) {
      rt.spline = { p0: pt, mid: pt };
      drawDot(rt, pt);
      return;
    }
    const mid = {
      x: (rt.spline.p0.x + pt.x) * 0.5,
      y: (rt.spline.p0.y + pt.y) * 0.5,
      p: (rt.spline.p0.p + pt.p) * 0.5
    };
    emitCurve(rt, rt.spline.mid, rt.spline.p0, mid);
    rt.spline.mid = mid;
    rt.spline.p0 = pt;
  }

  function splineFlush(rt) {
    if (!rt.spline) return;
    emitCurve(rt, rt.spline.mid, rt.spline.p0, rt.spline.p0);
    rt.spline = null;
  }

  function feedPoint(rt, pt, replay) {
    const pts = rt.action.points;
    if (!replay) {
      const last = pts[pts.length - 1];
      if (last && Math.abs(pt.x - last.x) < 0.2 && Math.abs(pt.y - last.y) < 0.2) return;
      pts.push(pt);
    }
    rt.lastRaw = pt;

    if (!rt.stab) {
      rt.stab = { x: pt.x, y: pt.y, p: pt.p };
      splinePush(rt, pt);
      return;
    }

    if (rt.smooth <= 0.001) {
      splinePush(rt, pt);
      return;
    }

    const dx = pt.x - rt.stab.x;
    const dy = pt.y - rt.stab.y;
    const dist = Math.hypot(dx, dy);
    const baseK = 1 - rt.smooth * 0.86;
    const maxLag = 40 + rt.size * 1.2;
    const k = Math.max(baseK, 1 - maxLag / Math.max(dist, 0.01));
    rt.stab.x += dx * k;
    rt.stab.y += dy * k;
    rt.stab.p += (pt.p - rt.stab.p) * k;
    splinePush(rt, { x: rt.stab.x, y: rt.stab.y, p: rt.stab.p });
  }

  function finalizeStabilizer(rt) {
    if (!rt.stab || !rt.lastRaw || rt.smooth <= 0.001) return;
    const target = rt.lastRaw;
    const baseK = 1 - rt.smooth * 0.86;
    for (let i = 0; i < 48; i++) {
      const dx = target.x - rt.stab.x;
      const dy = target.y - rt.stab.y;
      if (Math.hypot(dx, dy) < 0.35) return;
      const k = Math.min(0.7, baseK + i * 0.04);
      rt.stab.x += dx * k;
      rt.stab.y += dy * k;
      rt.stab.p += (target.p - rt.stab.p) * k;
      splinePush(rt, { x: rt.stab.x, y: rt.stab.y, p: rt.stab.p });
    }
  }

  function composePreview(alpha) {
    pctx.save();
    pctx.globalAlpha = alpha;
    pctx.drawImage(previewEl, 0, 0);
    pctx.restore();
    vctx.clearRect(0, 0, W, H);
  }

  function replayStroke(action) {
    const rt = makeRuntime(action);
    for (const pt of action.points) feedPoint(rt, pt, true);
    finalizeStabilizer(rt);
    splineFlush(rt);
    if (action.mode === 'marker') composePreview(action.alpha);
  }

  function renderAll() {
    pctx.clearRect(0, 0, W, H);
    vctx.clearRect(0, 0, W, H);
    for (const action of undoHistory) {
      if (action.type === 'clear') {
        pctx.clearRect(0, 0, W, H);
        vctx.clearRect(0, 0, W, H);
        continue;
      }
      replayStroke(action);
    }
    updateUI();
  }

  function finishStroke() {
    if (!drawing) return;
    const action = drawing.action;
    finalizeStabilizer(drawing);
    splineFlush(drawing);
    if (action.mode === 'marker') composePreview(action.alpha);
    previewEl.style.opacity = '1';
    undoHistory.push(action);
    redoStack.length = 0;
    drawing = null;
    isDrawing = false;
    activePointerId = null;
    updateUI();
  }

  // ---------- history ----------

  function undo() {
    if (isDrawing || undoHistory.length === 0) return;
    redoStack.push(undoHistory.pop());
    renderAll();
  }

  function redo() {
    if (isDrawing || redoStack.length === 0) return;
    undoHistory.push(redoStack.pop());
    renderAll();
  }

  function clearWall() {
    if (isDrawing) return;
    undoHistory.push({ type: 'clear' });
    redoStack.length = 0;
    renderAll();
    showToast('Стена очищена — Ctrl+Z вернёт рисунок');
  }

  function updateUI() {
    undoBtn.disabled = isDrawing || undoHistory.length === 0;
    redoBtn.disabled = isDrawing || redoStack.length === 0;
    clearBtn.disabled = isDrawing;
    saveBtn.disabled = isDrawing;

    const last = undoHistory[undoHistory.length - 1];
    const isEmpty = undoHistory.length === 0 || (last && last.type === 'clear');
    emptyHint.classList.toggle('is-hidden', !isEmpty);
  }

  // ---------- save ----------

  function savePNG() {
    if (isDrawing) return;
    const out = makeCanvas();
    const g = out.getContext('2d');
    g.drawImage(getWallTexture(state.wall), 0, 0);
    g.drawImage(paintEl, 0, 0);

    out.toBlob((blob) => {
      if (!blob) {
        showToast('Не удалось сохранить');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spray-lab.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('PNG сохранён');
    }, 'image/png');
  }

  // ---------- pointer input ----------

  function getPoint(e) {
    const rect = wallEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((e.clientX - rect.left) / rect.width * W, 0, W),
      y: clamp((e.clientY - rect.top) / rect.height * H, 0, H),
      p: e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.1, 1) : 0.85
    };
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') setCursorVisible(false);
    else positionCursor(e);
    if (isDrawing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pt = getPoint(e);
    if (!pt) return;
    e.preventDefault();

    activePointerId = e.pointerId;
    try {
      wrapEl.setPointerCapture(e.pointerId);
    } catch (err) { /* synthetic events */ }

    const action = {
      type: 'stroke',
      mode: state.mode,
      color: state.color,
      size: state.size,
      alpha: state.alpha,
      smooth: state.smooth,
      seed: (Math.random() * 2147483647) | 0,
      points: []
    };

    drawing = makeRuntime(action);
    isDrawing = true;
    if (state.mode === 'marker') previewEl.style.opacity = String(state.alpha);
    feedPoint(drawing, pt, false);
    updateUI();
  }

  function onPointerMove(e) {
    if (e.pointerType !== 'touch') positionCursor(e);
    if (!isDrawing || !drawing || e.pointerId !== activePointerId) return;
    e.preventDefault();

    let events = null;
    if (typeof e.getCoalescedEvents === 'function') {
      try {
        events = e.getCoalescedEvents();
      } catch (err) {
        events = null;
      }
    }
    if (!events || !events.length) events = [e];

    for (const ev of events) {
      const pt = getPoint(ev);
      if (pt) feedPoint(drawing, pt, false);
    }

    if (!events.includes(e)) {
      const pt = getPoint(e);
      if (pt) feedPoint(drawing, pt, false);
    }
  }

  function onPointerUp(e) {
    if (!isDrawing || e.pointerId !== activePointerId) return;
    finishStroke();
    if (e.pointerType !== 'touch') positionCursor(e);
  }

  function onPointerCancel(e) {
    if (!isDrawing || e.pointerId !== activePointerId) return;
    finishStroke();
  }

  wrapEl.addEventListener('pointerdown', onPointerDown);
  wrapEl.addEventListener('pointermove', onPointerMove);
  wrapEl.addEventListener('pointerup', onPointerUp);
  wrapEl.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('pointerup', onPointerUp);

  wrapEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    positionCursor(e);
  });

  wrapEl.addEventListener('pointerleave', () => {
    setCursorVisible(false);
  });

  window.addEventListener('blur', () => setCursorVisible(false));

  // ---------- cursor ----------

  const CURSOR_SCALE = {
    spray: 1,
    marker: 0.45,
    brush: 0.9,
    pencil: 0.16,
    eraser: 0.9
  };

  function updateCursorGeometry() {
    const rect = wallEl.getBoundingClientRect();
    const scale = rect.width ? rect.width / W : 0.5;
    const width = state.size * (CURSOR_SCALE[state.mode] || 1);
    const px = Math.max(state.mode === 'pencil' ? 8 : 10, width * scale);
    cursorEl.style.width = px + 'px';
    cursorEl.style.height = px + 'px';
    cursorEl.classList.toggle('is-eraser', state.mode === 'eraser');
    cursorEl.classList.toggle('is-thin', state.mode === 'pencil');
    cursorEl.style.setProperty('--dot', state.mode === 'eraser' ? '#ffffff' : state.color);
  }

  function positionCursor(e) {
    if (e.pointerType === 'touch') return;
    updateCursorGeometry();
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    setCursorVisible(true);
  }

  function setCursorVisible(visible) {
    cursorShown = visible;
    cursorEl.classList.toggle('is-visible', visible);
  }

  // ---------- layout ----------

  function fitStage() {
    const cs = getComputedStyle(stageEl);
    const availW = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;

    let w = availW;
    let h = w * (H / W);
    if (h > availH) {
      h = availH;
      w = h * (W / H);
    }
    wrapEl.style.width = Math.max(120, Math.floor(w)) + 'px';
    wrapEl.style.height = Math.max(75, Math.floor(h)) + 'px';
    updateCursorGeometry();
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(fitStage).observe(stageEl);
  }
  window.addEventListener('resize', fitStage);

  // ---------- colors ----------

  for (const [hex, name] of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = hex;
    b.style.background = hex;
    b.title = name;
    b.setAttribute('aria-label', `Цвет: ${name}`);
    colorsEl.insertBefore(b, customSwatch);
  }

  function setColor(hex, custom = false) {
    state.color = hex;
    document.querySelectorAll('.swatch[data-color]').forEach((b) => {
      b.classList.toggle('is-active', !custom && b.dataset.color.toLowerCase() === hex.toLowerCase());
    });
    customSwatch.classList.toggle('is-active', custom);
    customInner.style.background = custom ? hex : '';
    customInner.textContent = custom ? '' : '+';
    updateCursorGeometry();
  }

  colorsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button.swatch[data-color]');
    if (b) setColor(b.dataset.color, false);
  });

  colorInput.addEventListener('input', () => setColor(colorInput.value, true));

  // ---------- tools & sliders ----------

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.tool[data-mode]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    updateCursorGeometry();
  }

  document.querySelectorAll('.tool[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

  document.querySelectorAll('.wall-btn').forEach((b) => {
    b.addEventListener('click', () => setWall(b.dataset.wall));
  });

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty('--fill', ((value - min) / (max - min) * 100).toFixed(2) + '%');
  }

  sizeInput.addEventListener('input', () => {
    state.size = Number(sizeInput.value);
    sizeVal.textContent = String(state.size);
    updateRangeFill(sizeInput);
    updateCursorGeometry();
  });

  alphaInput.addEventListener('input', () => {
    state.alpha = Number(alphaInput.value) / 100;
    alphaVal.textContent = `${alphaInput.value}%`;
    updateRangeFill(alphaInput);
  });

  smoothInput.addEventListener('input', () => {
    state.smooth = Number(smoothInput.value) / 100;
    smoothVal.textContent = `${smoothInput.value}%`;
    updateRangeFill(smoothInput);
  });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearWall);
  saveBtn.addEventListener('click', savePNG);

  // ---------- keyboard ----------

  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'INPUT' && e.target.type === 'text') return;

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        savePNG();
        return;
      }
      return;
    }

    if (e.altKey) return;

    switch (e.code) {
      case 'KeyS': setMode('spray'); break;
      case 'KeyM': setMode('marker'); break;
      case 'KeyB': setMode('brush'); break;
      case 'KeyP': setMode('pencil'); break;
      case 'KeyE': setMode('eraser'); break;
      default:
        if (/^Digit[1-9]$/.test(e.code)) {
          const idx = Number(e.code.slice(5)) - 1;
          if (PALETTE[idx]) setColor(PALETTE[idx][0], false);
        }
    }
  });

  // ---------- toast ----------

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2400);
  }

  // ---------- init ----------

  fitStage();
  setWall('brick');
  setColor('#ff2e63', false);
  sizeVal.textContent = String(state.size);
  alphaVal.textContent = `${Math.round(state.alpha * 100)}%`;
  smoothVal.textContent = `${Math.round(state.smooth * 100)}%`;
  updateRangeFill(sizeInput);
  updateRangeFill(alphaInput);
  updateRangeFill(smoothInput);
  renderAll();
  fitStage();
})();
