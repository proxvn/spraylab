(() => {
  'use strict';

  const W = 1920;
  const H = 1200;

  const stageEl = document.getElementById('stage');
  const wrapEl = document.getElementById('canvasWrap');
  const wallEl = document.getElementById('wall');
  const paintEls = [...document.querySelectorAll('.paint-layer')];
  const previewEl = document.getElementById('preview');
  const wallCtx = wallEl.getContext('2d');
  const paintCtxs = paintEls.map((el) => el.getContext('2d'));
  const vctx = previewEl.getContext('2d');
  const LAYER_COUNT = paintEls.length;

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
  const zoomInput = document.getElementById('zoomInput');
  const zoomVal = document.getElementById('zoomResetBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const splashEl = document.getElementById('splash');
  const cursorEl = document.getElementById('cursor');
  const toastEl = document.getElementById('toast');
  const layersBtn = document.getElementById('layersBtn');
  const layersPop = document.getElementById('layersPop');
  const layersList = document.getElementById('layersList');
  const layersBadge = document.getElementById('layersBadge');

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
    alpha: 1,
    smooth: 0.7,
    wall: 'brick',
    pattern: 'dots',
    brush: 'soft',
    layer: LAYER_COUNT - 1
  };

  const layers = Array.from({ length: LAYER_COUNT }, (_, i) => ({
    name: `Слой ${i + 1}`,
    visible: true
  }));

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const SMOOTH_STRENGTH = 0.9;
  const SMOOTH_LAG_BASE = 44;
  const SMOOTH_LAG_SCALE = 1.3;

  const undoHistory = [];
  const redoStack = [];
  const touchPoints = new Map();
  let drawing = null;
  let isDrawing = false;
  let activePointerId = null;
  let strokeOutside = false;
  let lastInside = null;
  let pinch = null;
  let suppressTouchDraw = false;
  let panning = null;
  let spaceDown = false;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pendingFill = null;
  const viewBounds = { stageW: 0, stageH: 0, wrapW: 0, wrapH: 0 };
  let cursorShown = false;
  let toastTimer = 0;

  // ---------- utils ----------

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

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

  // ---------- pattern brushes ----------

  const PATTERN_TILE = 96;

  function shade(hex, amount) {
    const v = parseInt(hex.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const k = Math.abs(amount);
    const mix = (ch) => Math.round(ch + (target - ch) * k);
    return `rgb(${mix((v >> 16) & 255)},${mix((v >> 8) & 255)},${mix(v & 255)})`;
  }

  function pWrap(g, size, draw) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        g.save();
        g.translate(ox * size, oy * size);
        draw();
        g.restore();
      }
    }
  }

  function pStroke(g, x1, y1, x2, y2, width, color) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  function pHeart(g, cx, cy, s, fill) {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(cx, cy + s * 0.72);
    g.bezierCurveTo(cx - s * 1.12, cy - s * 0.06, cx - s * 0.58, cy - s * 0.98, cx, cy - s * 0.36);
    g.bezierCurveTo(cx + s * 0.58, cy - s * 0.98, cx + s * 1.12, cy - s * 0.06, cx, cy + s * 0.72);
    g.fill();
  }

  function pStar(g, cx, cy, outer, inner, fill) {
    g.fillStyle = fill;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 ? inner : outer;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  const PATTERNS = [
    {
      id: 'dots',
      name: 'Горошек',
      zoom: 2,
      draw(g, t) {
        for (let y = 0; y < t.T; y += 24) {
          const off = (y / 24) % 2 ? 12 : 0;
          for (let x = 0; x < t.T; x += 24) {
            g.fillStyle = t.c;
            g.beginPath();
            g.arc(x + off + 6, y + 11, 4.6, 0, TAU);
            g.fill();
          }
        }
      }
    },
    {
      id: 'bigdots',
      name: 'Крупный горошек',
      zoom: 2.4,
      draw(g, t) {
        for (let row = 0; row < 2; row++) {
          const y = 24 + row * 48;
          const off = row % 2 ? 24 : 0;
          for (let x = 0; x < t.T; x += 48) {
            g.fillStyle = row % 2 ? t.light : t.c;
            g.beginPath();
            g.arc((x + off + 12) % t.T, y, 10.5, 0, TAU);
            g.fill();
          }
        }
      }
    },
    {
      id: 'bubbles',
      name: 'Пузырьки',
      zoom: 2.2,
      draw(g, t) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cx = 16 + i * 32;
            const cy = 16 + j * 32;
            const r = 6.5 + ((i * 2 + j * 3) % 3) * 1.7;
            g.strokeStyle = (i + j) % 2 ? t.light : t.c;
            g.lineWidth = 2.1;
            g.beginPath();
            g.arc(cx, cy, r, 0, TAU);
            g.stroke();
            g.fillStyle = t.c;
            g.beginPath();
            g.arc(cx - r * 0.34, cy - r * 0.36, Math.max(0.9, r * 0.18), 0, TAU);
            g.fill();
          }
        }
      }
    },
    {
      id: 'checker',
      name: 'Клетка',
      zoom: 2,
      draw(g, t) {
        const cell = t.T / 4;
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            if ((x + y) % 2) continue;
            g.fillStyle = t.c;
            g.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
    },
    {
      id: 'stripes',
      name: 'Полоски',
      zoom: 1.8,
      draw(g, t) {
        g.strokeStyle = t.c;
        g.lineWidth = 7;
        for (let k = -6; k <= 6; k++) {
          const off = k * 16;
          g.beginPath();
          g.moveTo(off, 0);
          g.lineTo(off + t.T, t.T);
          g.stroke();
        }
      }
    },
    {
      id: 'zigzag',
      name: 'Зигзаг',
      zoom: 2,
      draw(g, t) {
        g.strokeStyle = t.c;
        g.lineWidth = 3.4;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        for (let row = 0; row < 4; row++) {
          const base = 12 + row * 24;
          g.beginPath();
          for (let i = -1; i <= 5; i++) {
            const x = i * 24;
            const y = base + ((i + row) % 2 === 0 ? -5 : 5);
            if (i === -1) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    },
    {
      id: 'hearts',
      name: 'Сердечки',
      zoom: 2.2,
      draw(g, t) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            pHeart(g, 24 + i * 48, 24 + j * 48, 11, (i + j) % 2 ? t.light : t.c);
          }
        }
      }
    },
    {
      id: 'stars',
      name: 'Звёзды',
      zoom: 2,
      draw(g, t) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            pStar(g, 16 + i * 32, 16 + j * 32, 9.5, 4.2, (i + j) % 3 === 0 ? t.light : t.c);
          }
        }
      }
    },
    {
      id: 'crosses',
      name: 'Крестики',
      zoom: 1.8,
      draw(g, t) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cx = 16 + i * 32;
            const cy = 16 + j * 32;
            const col = (i + j) % 2 ? t.light : t.c;
            pStroke(g, cx - 6, cy - 6, cx + 6, cy + 6, 3.4, col);
            pStroke(g, cx - 6, cy + 6, cx + 6, cy - 6, 3.4, col);
          }
        }
      }
    },
    {
      id: 'bolts',
      name: 'Молнии',
      zoom: 2,
      draw(g, t) {
        const bolt = (cx, cy, fill) => {
          g.fillStyle = fill;
          g.beginPath();
          g.moveTo(cx + 2.5, cy - 11);
          g.lineTo(cx - 7, cy + 2);
          g.lineTo(cx - 0.6, cy + 2);
          g.lineTo(cx - 3, cy + 12);
          g.lineTo(cx + 7, cy - 1.5);
          g.lineTo(cx + 0.6, cy - 1.5);
          g.closePath();
          g.fill();
        };
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            bolt(24 + i * 48, 24 + j * 48, (i + j) % 2 ? t.light : t.c);
          }
        }
      }
    },
    {
      id: 'camo',
      name: 'Камуфляж',
      zoom: 2.6,
      draw(g, t) {
        const rnd = mulberry32(9137);
        const blobs = [];
        for (let i = 0; i < 8; i++) {
          blobs.push({
            x: rnd() * t.T,
            y: rnd() * t.T,
            rx: 12 + rnd() * 14,
            ry: 9 + rnd() * 12,
            rot: rnd() * Math.PI,
            fill: [t.c, t.light, t.dark][i % 3]
          });
        }
        pWrap(g, t.T, () => {
          for (const b of blobs) {
            g.fillStyle = b.fill;
            g.beginPath();
            g.ellipse(b.x, b.y, b.rx, b.ry, b.rot, 0, TAU);
            g.fill();
          }
        });
      }
    },
    {
      id: 'confetti',
      name: 'Конфетти',
      zoom: 2,
      draw(g, t) {
        const rnd = mulberry32(4711);
        const items = [];
        for (let i = 0; i < 30; i++) {
          items.push({
            x: rnd() * t.T,
            y: rnd() * t.T,
            size: 2.4 + rnd() * 4.2,
            rot: rnd() * Math.PI,
            round: rnd() < 0.4,
            fill: [t.c, t.light, t.dark][i % 3]
          });
        }
        pWrap(g, t.T, () => {
          for (const it of items) {
            g.fillStyle = it.fill;
            if (it.round) {
              g.beginPath();
              g.arc(it.x, it.y, it.size * 0.55, 0, TAU);
              g.fill();
            } else {
              g.save();
              g.translate(it.x, it.y);
              g.rotate(it.rot);
              g.fillRect(-it.size, -it.size * 0.34, it.size * 2, it.size * 0.68);
              g.restore();
            }
          }
        });
      }
    },
    {
      id: 'rain',
      name: 'Дождь',
      zoom: 1.8,
      draw(g, t) {
        for (let row = 0; row < 4; row++) {
          const y = 6 + row * 24;
          const off = row % 2 ? 12 : 0;
          for (let x = 0; x < t.T; x += 24) {
            const px = (x + off + 8) % t.T;
            pStroke(g, px, y, px - 4, y + 9, 2.2, row % 2 ? t.light : t.c);
          }
        }
      }
    },
    {
      id: 'triangles',
      name: 'Треугольники',
      zoom: 2,
      draw(g, t) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cx = 16 + i * 32;
            const cy = 16 + j * 32;
            const up = (i + j) % 2 === 0;
            g.fillStyle = up ? t.c : t.light;
            g.beginPath();
            if (up) {
              g.moveTo(cx, cy - 9);
              g.lineTo(cx + 10, cy + 7);
              g.lineTo(cx - 10, cy + 7);
            } else {
              g.moveTo(cx, cy + 9);
              g.lineTo(cx + 10, cy - 7);
              g.lineTo(cx - 10, cy - 7);
            }
            g.closePath();
            g.fill();
          }
        }
      }
    },
    {
      id: 'diamonds',
      name: 'Ромбы',
      zoom: 2,
      draw(g, t) {
        g.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const cx = 16 + i * 32;
            const cy = 16 + j * 32;
            g.strokeStyle = (i + j) % 2 ? t.light : t.c;
            g.beginPath();
            g.moveTo(cx, cy - 10);
            g.lineTo(cx + 10, cy);
            g.lineTo(cx, cy + 10);
            g.lineTo(cx - 10, cy);
            g.closePath();
            g.stroke();
          }
        }
      }
    },
    {
      id: 'waves',
      name: 'Волны',
      zoom: 2,
      draw(g, t) {
        g.strokeStyle = t.c;
        g.lineWidth = 3.3;
        g.lineCap = 'round';
        for (let row = 0; row < 4; row++) {
          const base = 12 + row * 24;
          g.beginPath();
          for (let x = 0; x <= t.T; x += 3) {
            const y = base + Math.sin((x / 48) * TAU + (row % 2) * Math.PI) * 6;
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    },
    {
      id: 'rings',
      name: 'Кольца',
      zoom: 2.2,
      draw(g, t) {
        const rings = [[4, 0], [8, 1], [12, 0]];
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            const cx = 24 + i * 48;
            const cy = 24 + j * 48;
            for (const [r, tone] of rings) {
              g.strokeStyle = tone ? t.light : t.c;
              g.lineWidth = 2.2;
              g.beginPath();
              g.arc(cx, cy, r, 0, TAU);
              g.stroke();
            }
          }
        }
      }
    },
    {
      id: 'mesh',
      name: 'Сетка',
      zoom: 2,
      draw(g, t) {
        g.strokeStyle = t.c;
        g.lineWidth = 1.8;
        for (let v = 0; v <= t.T; v += 16) {
          g.beginPath();
          g.moveTo(v, 0);
          g.lineTo(v, t.T);
          g.stroke();
          g.beginPath();
          g.moveTo(0, v);
          g.lineTo(t.T, v);
          g.stroke();
        }
      }
    },
    {
      id: 'splatter',
      name: 'Брызги',
      zoom: 2.2,
      draw(g, t) {
        const rnd = mulberry32(2027);
        const drops = [];
        for (let i = 0; i < 42; i++) {
          drops.push({
            x: rnd() * t.T,
            y: rnd() * t.T,
            r: i < 8 ? 2.4 + rnd() * 2.6 : 0.7 + rnd() * 1.8,
            fill: i % 4 === 0 ? t.light : t.c
          });
        }
        pWrap(g, t.T, () => {
          for (const d of drops) {
            g.fillStyle = d.fill;
            g.beginPath();
            g.arc(d.x, d.y, d.r, 0, TAU);
            g.fill();
          }
        });
      }
    },
    {
      id: 'smileys',
      name: 'Смайлики',
      zoom: 2.3,
      draw(g, t) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            const cx = 24 + i * 48;
            const cy = 24 + j * 48;
            const col = (i + j) % 2 ? t.light : t.c;
            g.strokeStyle = col;
            g.fillStyle = col;
            g.lineWidth = 2.4;
            g.beginPath();
            g.arc(cx, cy, 10, 0, TAU);
            g.stroke();
            g.beginPath();
            g.arc(cx - 3.6, cy - 3, 1.7, 0, TAU);
            g.fill();
            g.beginPath();
            g.arc(cx + 3.6, cy - 3, 1.7, 0, TAU);
            g.fill();
            g.beginPath();
            g.arc(cx, cy + 0.5, 5.4, Math.PI * 0.18, Math.PI * 0.82);
            g.stroke();
          }
        }
      }
    }
  ];

  const PATTERN_MAP = new Map(PATTERNS.map((p) => [p.id, p]));
  const patternTileCache = new Map();
  const patternStampCache = new Map();

  function getPatternTile(def, color) {
    const key = `${def.id}|${color}`;
    let tile = patternTileCache.get(key);
    if (tile) return tile;
    tile = makeCanvas(PATTERN_TILE, PATTERN_TILE);
    const g = tile.getContext('2d');
    def.draw(g, {
      c: color,
      light: shade(color, 0.42),
      dark: shade(color, -0.4),
      T: PATTERN_TILE
    });
    patternTileCache.set(key, tile);
    if (patternTileCache.size > 160) {
      patternTileCache.delete(patternTileCache.keys().next().value);
    }
    return tile;
  }

  function getPattern(id, color, size) {
    const def = PATTERN_MAP.get(id) || PATTERNS[0];
    const world = Math.max(12, size * def.zoom);
    const key = `${def.id}|${color}|${world.toFixed(1)}`;
    const hit = patternStampCache.get(key);
    if (hit) return hit;
    const pat = vctx.createPattern(getPatternTile(def, color), 'repeat');
    if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix === 'function') {
      const s = world / PATTERN_TILE;
      pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
    }
    patternStampCache.set(key, pat);
    if (patternStampCache.size > 600) {
      patternStampCache.delete(patternStampCache.keys().next().value);
    }
    return pat;
  }

  // ---------- brush presets ----------

  function bFill(g, color, x, y, r, a) {
    g.fillStyle = withAlpha(color, a);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function bSoftDot(g, color, x, y, r, a, core) {
    const grad = g.createRadialGradient(x, y, r * 0.04, x, y, r);
    grad.addColorStop(0, withAlpha(color, a * (core === undefined ? 0.5 : core)));
    grad.addColorStop(0.62, withAlpha(color, a * 0.32));
    grad.addColorStop(0.88, withAlpha(color, a * 0.1));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function bGrains(g, rt, x, y, r, count, maxSize, minA, maxA) {
    const rnd = rt.rng;
    for (let i = 0; i < count; i++) {
      const ang = rnd() * TAU;
      const dist = Math.sqrt(rnd()) * r;
      const s = 0.4 + rnd() * maxSize;
      g.fillStyle = withAlpha(rt.color, rt.alpha * (minA + rnd() * (maxA - minA)));
      g.fillRect(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, s);
    }
  }

  const BRUSHES = [
    {
      id: 'soft',
      name: 'Мягкая',
      spacing: 0.22,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(2.2, rt.size * 0.5 * (0.72 + 0.28 * p));
        bSoftDot(g, rt.color, x, y, r, rt.alpha, 0.45);
        for (let i = 0; i < 2; i++) {
          const ang = rnd() * TAU;
          const dist = r * 0.35 * rnd();
          bFill(
            g, rt.color,
            x + Math.cos(ang) * dist,
            y + Math.sin(ang) * dist,
            r * (0.28 + rnd() * 0.22),
            rt.alpha * 0.08
          );
        }
      }
    },
    {
      id: 'round',
      name: 'Круглая',
      spacing: 0.1,
      stamp(g, rt, x, y, p) {
        const r = Math.max(1.6, rt.size * 0.5 * (0.78 + 0.22 * p));
        const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
        grad.addColorStop(0, withAlpha(rt.color, rt.alpha * 0.5));
        grad.addColorStop(0.85, withAlpha(rt.color, rt.alpha * 0.46));
        grad.addColorStop(1, withAlpha(rt.color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
    },
    {
      id: 'air',
      name: 'Аэрограф',
      spacing: 0.15,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(2, rt.size * 0.5 * (0.8 + 0.2 * p));
        bSoftDot(g, rt.color, x, y, r, rt.alpha * 0.35, 0.35);
        const n = Math.round(r * 2.4);
        for (let i = 0; i < n; i++) {
          const ang = rnd() * TAU;
          const dist = Math.sqrt(rnd()) * r * 1.05;
          bFill(
            g, rt.color,
            x + Math.cos(ang) * dist,
            y + Math.sin(ang) * dist,
            0.35 + rnd() * 0.85,
            rt.alpha * (0.1 + rnd() * 0.32)
          );
        }
      }
    },
    {
      id: 'dry',
      name: 'Сухая',
      spacing: 0.24,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const off = (i / 6 - 0.5) * r * 1.75;
          const len = r * (0.55 + rnd() * 1.05);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.08 + rnd() * 0.26));
          g.lineWidth = 0.6 + rnd() * 1.1;
          g.beginPath();
          g.moveTo(-len * 0.5 + rnd() * 2, off + (rnd() - 0.5) * 2);
          g.lineTo(len * 0.5, off + (rnd() - 0.5) * 2);
          g.stroke();
        }
        g.restore();
        bGrains(g, rt, x, y, r * 1.1, Math.round(r * 1.4), 1.1, 0.05, 0.3);
      }
    },
    {
      id: 'bristle',
      name: 'Щетина',
      spacing: 0.34,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2.4, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const off = (rnd() - 0.5) * r * 1.7;
          const len = r * (0.8 + rnd() * 0.6);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.14 + rnd() * 0.3));
          g.lineWidth = 1 + rnd() * 1.8;
          g.beginPath();
          g.moveTo(-len, off);
          g.lineTo(len, off + (rnd() - 0.5) * 3);
          g.stroke();
        }
        g.restore();
      }
    },
    {
      id: 'fur',
      name: 'Мех',
      spacing: 0.26,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2, rt.size * 0.5 * (0.8 + 0.2 * p));
        const dir = ang == null ? -Math.PI / 4 : ang;
        bFill(g, rt.color, x, y, r * 0.35, rt.alpha * 0.12);
        g.lineCap = 'round';
        for (let i = 0; i < 12; i++) {
          const a = dir + (rnd() - 0.5) * 1.9;
          const len = r * (0.45 + rnd() * 0.95);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.12 + rnd() * 0.3));
          g.lineWidth = 0.5 + rnd() * 0.9;
          g.beginPath();
          g.moveTo(x + (rnd() - 0.5) * r * 0.4, y + (rnd() - 0.5) * r * 0.4);
          g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          g.stroke();
        }
      }
    },
    {
      id: 'chalk',
      name: 'Мел',
      spacing: 0.17,
      stamp(g, rt, x, y, p) {
        const r = Math.max(2, rt.size * 0.5 * (0.85 + 0.15 * p));
        bFill(g, rt.color, x, y, r * 0.55, rt.alpha * 0.09);
        bGrains(g, rt, x, y, r, Math.round(r * 3.2), 1.2, 0.12, 0.5);
      }
    },
    {
      id: 'charcoal',
      name: 'Уголь',
      spacing: 0.25,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2.5, rt.size * 0.5 * (0.85 + 0.15 * p));
        bFill(g, rt.color, x, y, r * 0.7, rt.alpha * 0.1);
        bGrains(g, rt, x, y, r * 1.05, Math.round(r * 2.2), 2, 0.18, 0.6);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.strokeStyle = withAlpha(rt.color, rt.alpha * 0.14);
        g.lineWidth = 1.2 + rnd() * 2;
        g.beginPath();
        g.moveTo(-r * (0.5 + rnd() * 0.5), (rnd() - 0.5) * r * 1.2);
        g.lineTo(r * (0.5 + rnd() * 0.5), (rnd() - 0.5) * r * 1.2);
        g.stroke();
        g.restore();
      }
    },
    {
      id: 'water',
      name: 'Акварель',
      spacing: 0.38,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(3, rt.size * 0.5 * (0.8 + 0.2 * p));
        for (let i = 0; i < 3; i++) {
          const ang = rnd() * TAU;
          const dist = rnd() * r * 0.55;
          const rr2 = r * (0.45 + rnd() * 0.5);
          const bx = x + Math.cos(ang) * dist;
          const by = y + Math.sin(ang) * dist;
          const grad = g.createRadialGradient(bx, by, rr2 * 0.1, bx, by, rr2);
          grad.addColorStop(0, withAlpha(rt.color, rt.alpha * 0.09));
          grad.addColorStop(0.72, withAlpha(rt.color, rt.alpha * 0.05));
          grad.addColorStop(1, withAlpha(rt.color, 0));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(bx, by, rr2, 0, TAU);
          g.fill();
        }
      }
    },
    {
      id: 'ink',
      name: 'Тушь',
      spacing: 0.075,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(1.5, rt.size * 0.34 * (0.65 + 0.35 * p));
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, withAlpha(rt.color, rt.alpha * 0.62));
        grad.addColorStop(0.88, withAlpha(rt.color, rt.alpha * 0.56));
        grad.addColorStop(1, withAlpha(rt.color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        if (rnd() < 0.3) {
          bFill(g, rt.color, x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * 0.3, rt.alpha * 0.25);
        }
      }
    },
    {
      id: 'felt',
      name: 'Фетр',
      spacing: 0.09,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const k = 0.85 + 0.15 * p;
        const len = Math.max(3, rt.size * 0.58 * k);
        const thick = Math.max(1.4, rt.size * 0.36 * k);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.fillStyle = withAlpha(rt.color, rt.alpha * 0.3);
        rr(g, -len / 2, -thick / 2, len, thick, thick * 0.4);
        g.fill();
        g.fillStyle = withAlpha(rt.color, rt.alpha * 0.14);
        g.fillRect(-len / 2 + rnd() * 2, -thick / 2, len * 0.6, thick);
        g.restore();
      }
    },
    {
      id: 'pastel',
      name: 'Пастель',
      spacing: 0.2,
      stamp(g, rt, x, y, p) {
        const r = Math.max(2.2, rt.size * 0.5 * (0.8 + 0.2 * p));
        bSoftDot(g, rt.color, x, y, r * 1.05, rt.alpha * 0.28, 0.4);
        bGrains(g, rt, x, y, r, Math.round(r * 2.2), 1.4, 0.08, 0.26);
      }
    },
    {
      id: 'sketch',
      name: 'Набросок',
      spacing: 0.15,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * r * 0.55;
          const len = r * (1.1 + rnd() * 0.5);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.12 + rnd() * 0.2));
          g.lineWidth = 0.5 + rnd() * 0.7;
          g.beginPath();
          g.moveTo(-len / 2, off + (rnd() - 0.5) * 3);
          g.lineTo(len / 2, off + (rnd() - 0.5) * 3);
          g.stroke();
        }
        g.restore();
      }
    },
    {
      id: 'point',
      name: 'Пуантилизм',
      spacing: 0.52,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(1.6, rt.size * 0.5 * (0.7 + 0.3 * p));
        const dir = ang == null ? -Math.PI / 4 : ang;
        const nx = Math.cos(dir + Math.PI / 2);
        const ny = Math.sin(dir + Math.PI / 2);
        const off = (rnd() - 0.5) * r * 1.1;
        bFill(g, rt.color, x + nx * off, y + ny * off, r * (0.24 + rnd() * 0.34), rt.alpha * 0.62);
        if (rnd() < 0.7) {
          bFill(g, rt.color, x - nx * off * 1.4, y - ny * off * 1.4, r * (0.1 + rnd() * 0.16), rt.alpha * 0.34);
        }
      }
    },
    {
      id: 'blob',
      name: 'Кляксы',
      spacing: 0.48,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(2.5, rt.size * 0.5 * (0.75 + 0.25 * p));
        const pts = 9;
        g.fillStyle = withAlpha(rt.color, rt.alpha * 0.2);
        g.beginPath();
        for (let i = 0; i < pts; i++) {
          const ang = (i / pts) * TAU;
          const rad = r * (0.45 + rnd() * 0.55);
          const px = x + Math.cos(ang) * rad;
          const py = y + Math.sin(ang) * rad;
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
        bFill(g, rt.color, x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * (0.12 + rnd() * 0.16), rt.alpha * 0.16);
      }
    },
    {
      id: 'fan',
      name: 'Веер',
      spacing: 0.3,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2.4, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a = dir + (i - 2) * 0.34 + (rnd() - 0.5) * 0.12;
          const len = r * (0.75 + rnd() * 0.5);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.13 + rnd() * 0.2));
          g.lineWidth = 0.8 + rnd() * 1.4;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
          g.stroke();
        }
      }
    },
    {
      id: 'ribbon',
      name: 'Лента',
      spacing: 0.13,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2.4, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.save();
        g.translate(x, y);
        g.rotate(dir);
        g.lineCap = 'round';
        for (let i = 0; i < 2; i++) {
          const off = (i ? 1 : -1) * r * (0.3 + rnd() * 0.12);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.2 + rnd() * 0.1));
          g.lineWidth = r * (0.34 + rnd() * 0.12);
          g.beginPath();
          g.moveTo(-r * 0.7, off);
          g.lineTo(r * 0.7, off + (rnd() - 0.5) * 2);
          g.stroke();
        }
        g.restore();
      }
    },
    {
      id: 'hair',
      name: 'Волоски',
      spacing: 0.3,
      stamp(g, rt, x, y, p, ang) {
        const rnd = rt.rng;
        const r = Math.max(2.4, rt.size * 0.5);
        const dir = ang == null ? -Math.PI / 4 : ang;
        g.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const a = dir + Math.PI + (rnd() - 0.5) * 0.7;
          const len = r * (1.3 + rnd() * 1.4);
          g.strokeStyle = withAlpha(rt.color, rt.alpha * (0.1 + rnd() * 0.22));
          g.lineWidth = 0.4 + rnd() * 0.8;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(
            x + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * r * 0.5,
            y + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * r * 0.5,
            x + Math.cos(a) * len,
            y + Math.sin(a) * len
          );
          g.stroke();
        }
      }
    },
    {
      id: 'cloud',
      name: 'Облако',
      spacing: 0.34,
      stamp(g, rt, x, y, p) {
        const rnd = rt.rng;
        const r = Math.max(4, rt.size * 0.5 * (0.8 + 0.2 * p));
        for (let i = 0; i < 3; i++) {
          const ang = rnd() * TAU;
          const dist = rnd() * r * 0.65;
          const bx = x + Math.cos(ang) * dist;
          const by = y + Math.sin(ang) * dist;
          const rr2 = r * (0.7 + rnd() * 0.55);
          const grad = g.createRadialGradient(bx, by, 0, bx, by, rr2);
          grad.addColorStop(0, withAlpha(rt.color, rt.alpha * 0.075));
          grad.addColorStop(0.6, withAlpha(rt.color, rt.alpha * 0.04));
          grad.addColorStop(1, withAlpha(rt.color, 0));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(bx, by, rr2, 0, TAU);
          g.fill();
        }
      }
    },
    {
      id: 'neon',
      name: 'Неон',
      spacing: 0.11,
      stamp(g, rt, x, y, p) {
        const r = Math.max(2, rt.size * 0.5 * (0.8 + 0.2 * p));
        const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.7);
        grad.addColorStop(0, withAlpha(rt.color, rt.alpha * 0.3));
        grad.addColorStop(0.4, withAlpha(rt.color, rt.alpha * 0.14));
        grad.addColorStop(1, withAlpha(rt.color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r * 1.7, 0, TAU);
        g.fill();
        bFill(g, rt.color, x, y, r * 0.52, rt.alpha * 0.5);
        bFill(g, '#ffffff', x, y, r * 0.24, rt.alpha * 0.55);
      }
    }
  ];

  const BRUSH_MAP = new Map(BRUSHES.map((b) => [b.id, b]));

  // ---------- drawing engine ----------

  function makeRuntime(action) {
    const layer = clamp(action.layer == null ? state.layer : action.layer, 0, LAYER_COUNT - 1);
    return {
      action,
      layer,
      paint: paintCtxs[layer],
      mode: action.mode,
      color: action.color,
      size: action.size,
      alpha: action.alpha,
      smooth: action.smooth || 0,
      rng: mulberry32(action.seed),
      pattern: action.mode === 'pattern' ? getPattern(action.pattern, action.color, action.size) : null,
      brush: action.mode === 'brush' ? (BRUSH_MAP.get(action.brush) || BRUSHES[0]) : null,
      angle: null,
      spline: null,
      lastSample: null,
      lastRaw: null,
      stab: null,
      carry: 0
    };
  }

  function pencilWidth(rt, pressure) {
    return Math.max(1.2, rt.size * 0.1 * (0.85 + 0.15 * pressure));
  }

  function solidDot(ctx, rt, pt) {
    const w = pencilWidth(rt, pt.p);
    ctx.fillStyle = rt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, w / 2, 0, TAU);
    ctx.fill();
  }

  function solidSegment(ctx, rt, a, b) {
    ctx.strokeStyle = rt.color;
    ctx.lineWidth = pencilWidth(rt, (a.p + b.p) * 0.5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

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

  function brushStamp(ctx, rt, x, y, pressure, angle) {
    if (!rt.brush) return;
    rt.brush.stamp(ctx, rt, x, y, pressure, angle);
  }

  function smoothAngle(rt, target) {
    if (rt.angle == null) {
      rt.angle = target;
      return;
    }
    let diff = target - rt.angle;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    rt.angle += diff * 0.35;
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
      sprayStamp(rt.paint, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  function brushWalk(rt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      brushStamp(rt.paint, rt, a.x, a.y, a.p, rt.angle == null ? -Math.PI / 4 : rt.angle);
      return;
    }
    smoothAngle(rt, Math.atan2(dy, dx));
    const step = Math.max(0.55, rt.size * rt.brush.spacing);
    let t = step - rt.carry;
    if (t < 0) t += step;
    while (t <= dist) {
      const k = t / dist;
      brushStamp(rt.paint, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k, rt.angle);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  function patternStamp(ctx, rt, x, y, pressure) {
    if (!rt.pattern) return;
    const r = Math.max(2.5, rt.size * 0.5 * (0.8 + 0.2 * pressure));
    ctx.fillStyle = rt.pattern;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function patternWalk(rt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      patternStamp(vctx, rt, a.x, a.y, a.p);
      return;
    }
    const step = Math.max(0.8, rt.size * 0.12);
    let t = step - rt.carry;
    if (t < 0) t += step;
    while (t <= dist) {
      const k = t / dist;
      patternStamp(vctx, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  const NIB_ANGLE = -Math.PI / 4;

  function markerNib(rt, pressure) {
    const k = 0.85 + 0.15 * pressure;
    return {
      len: Math.max(3.5, rt.size * 0.52 * k),
      thick: Math.max(1.3, rt.size * 0.16 * k)
    };
  }

  function markerStamp(ctx, rt, x, y, pressure) {
    const nib = markerNib(rt, pressure);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(NIB_ANGLE);
    ctx.fillStyle = rt.color;
    ctx.fillRect(-nib.len / 2, -nib.thick / 2, nib.len, nib.thick);
    ctx.restore();
  }

  function markerWalk(rt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      markerStamp(vctx, rt, a.x, a.y, a.p);
      return;
    }
    const thick = markerNib(rt, (a.p + b.p) * 0.5).thick;
    const step = Math.max(0.55, thick * 0.45);
    let t = step - rt.carry;
    if (t < 0) t += step;
    while (t <= dist) {
      const k = t / dist;
      markerStamp(vctx, rt, a.x + dx * k, a.y + dy * k, a.p + (b.p - a.p) * k);
      t += step;
    }
    rt.carry = (rt.carry + dist) % step;
  }

  function eraserWidth(rt) {
    return Math.max(6, rt.size * 0.9);
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

  function drawDot(rt, pt) {
    switch (rt.mode) {
      case 'spray': sprayStamp(rt.paint, rt, pt.x, pt.y, pt.p); break;
      case 'brush': brushStamp(rt.paint, rt, pt.x, pt.y, pt.p, rt.angle == null ? -Math.PI / 4 : rt.angle); break;
      case 'marker': markerStamp(vctx, rt, pt.x, pt.y, pt.p); break;
      case 'pencil': solidDot(vctx, rt, pt); break;
      case 'pattern': patternStamp(vctx, rt, pt.x, pt.y, pt.p); break;
      case 'eraser': eraseDot(rt.paint, rt, pt); break;
    }
    rt.lastSample = pt;
    rt.carry = 0;
  }

  function drawSegment(rt, a, b) {
    switch (rt.mode) {
      case 'spray': sprayWalk(rt, a, b); break;
      case 'brush': brushWalk(rt, a, b); break;
      case 'marker': markerWalk(rt, a, b); break;
      case 'pencil': solidSegment(vctx, rt, a, b); break;
      case 'pattern': patternWalk(rt, a, b); break;
      case 'eraser': eraseSegment(rt.paint, rt, a, b); break;
    }
  }

  function usesPreview(mode) {
    return mode === 'marker' || mode === 'pencil' || mode === 'pattern';
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
      if (last && !last.br && Math.abs(pt.x - last.x) < 0.2 && Math.abs(pt.y - last.y) < 0.2) return;
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
    const baseK = 1 - rt.smooth * SMOOTH_STRENGTH;
    const maxLag = SMOOTH_LAG_BASE + rt.size * SMOOTH_LAG_SCALE;
    const k = Math.max(baseK, 1 - maxLag / Math.max(dist, 0.01));
    rt.stab.x += dx * k;
    rt.stab.y += dy * k;
    rt.stab.p += (pt.p - rt.stab.p) * k;
    splinePush(rt, { x: rt.stab.x, y: rt.stab.y, p: rt.stab.p });
  }

  function finalizeStabilizer(rt) {
    if (!rt.stab || !rt.lastRaw || rt.smooth <= 0.001) return;
    const target = rt.lastRaw;
    const baseK = 1 - rt.smooth * SMOOTH_STRENGTH;
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

  function breakRuntime(rt) {
    finalizeStabilizer(rt);
    splineFlush(rt);
    rt.stab = null;
    rt.spline = null;
    rt.lastRaw = null;
    rt.lastSample = null;
    rt.carry = 0;
  }

  function composePreview(alpha, layer) {
    const target = paintCtxs[clamp(layer == null ? state.layer : layer, 0, LAYER_COUNT - 1)];
    target.save();
    target.globalAlpha = alpha;
    target.drawImage(previewEl, 0, 0);
    target.restore();
    vctx.clearRect(0, 0, W, H);
  }

  function replayStroke(action) {
    const rt = makeRuntime(action);
    for (const pt of action.points) {
      if (pt.br) {
        breakRuntime(rt);
        continue;
      }
      feedPoint(rt, pt, true);
    }
    finalizeStabilizer(rt);
    splineFlush(rt);
    if (usesPreview(action.mode)) composePreview(action.alpha, action.layer);
  }

  function renderAll() {
    for (const ctx of paintCtxs) ctx.clearRect(0, 0, W, H);
    vctx.clearRect(0, 0, W, H);
    for (const action of undoHistory) {
      if (action.type === 'clear') {
        const ctx = paintCtxs[clamp(action.layer || 0, 0, LAYER_COUNT - 1)];
        ctx.clearRect(0, 0, W, H);
        vctx.clearRect(0, 0, W, H);
        continue;
      }
      if (action.type === 'fill') {
        paintFillAction(action);
        continue;
      }
      replayStroke(action);
    }
    refreshLayerThumbs();
    updateUI();
  }

  function finishStroke() {
    if (!drawing) return;
    const action = drawing.action;
    finalizeStabilizer(drawing);
    splineFlush(drawing);
    if (usesPreview(action.mode)) composePreview(action.alpha, action.layer);
    previewEl.style.opacity = '1';
    undoHistory.push(action);
    redoStack.length = 0;
    drawing = null;
    isDrawing = false;
    activePointerId = null;
    strokeOutside = false;
    lastInside = null;
    refreshLayerThumbs();
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
    const layer = state.layer;
    undoHistory.push({ type: 'clear', layer });
    redoStack.length = 0;
    renderAll();
    showToast(`${layers[layer].name} очищен — Ctrl+Z вернёт рисунок`);
  }

  // ---------- fill ----------

  function hexRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function estimateFillTolerance(data, sx, sy) {
    const si = (sy * W + sx) * 4;
    const sr = data[si];
    const sg = data[si + 1];
    const sb = data[si + 2];
    const radius = 4;
    const x0 = Math.max(0, sx - radius);
    const x1 = Math.min(W - 1, sx + radius);
    const y0 = Math.max(0, sy - radius);
    const y1 = Math.min(H - 1, sy + radius);
    let sum = 0;
    let sum2 = 0;
    let count = 0;

    for (let y = y0; y <= y1; y++) {
      let i = (y * W + x0) * 4;
      for (let x = x0; x <= x1; x++, i += 4) {
        const dr = data[i] - sr;
        const dg = data[i + 1] - sg;
        const db = data[i + 2] - sb;
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        sum += d;
        sum2 += d * d;
        count++;
      }
    }

    const mean = sum / count;
    const sd = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
    return clamp(15 + mean * 2 + sd * 1.6, 18, 72);
  }

  function floodFillMask(srcData, paintData, sx, sy, tol, onPaint) {
    const N = W * H;
    const mask = new Uint8Array(N);
    const seen = new Uint8Array(N);
    const queue = new Int32Array(N);
    const si = (sy * W + sx) * 4;
    const sr = srcData[si];
    const sg = srcData[si + 1];
    const sb = srcData[si + 2];
    const tol2 = tol * tol;
    const seed = sy * W + sx;

    seen[seed] = 1;
    mask[seed] = 255;
    let head = 0;
    let tail = 1;
    queue[0] = seed;

    const push = (idx) => {
      if (seen[idx]) return;
      const a = paintData[idx * 4 + 3];
      if (onPaint) {
        if (a < 12) return;
      } else if (a > 0) {
        // Exact paint edge: paint underneath it, but never flood past the line.
        seen[idx] = 1;
        mask[idx] = 255;
        return;
      }
      const i = idx * 4;
      const dr = srcData[i] - sr;
      const dg = srcData[i + 1] - sg;
      const db = srcData[i + 2] - sb;
      if (dr * dr + dg * dg + db * db > tol2) return;
      seen[idx] = 1;
      mask[idx] = 255;
      queue[tail++] = idx;
    };

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % W;
      const y = (idx - x) / W;
      if (x > 0) push(idx - 1);
      if (x < W - 1) push(idx + 1);
      if (y > 0) push(idx - W);
      if (y < H - 1) push(idx + W);
    }

    return mask;
  }

  function encodeFillRuns(mask) {
    const N = W * H;
    const runs = [];

    for (let i = 0; i < N;) {
      if (!mask[i]) {
        i++;
        continue;
      }
      const start = i;
      i++;
      while (i < N && mask[i]) i++;
      runs.push(start, i - start, 255);
    }

    return runs;
  }

  function paintFillAction(action) {
    const { r, g, b } = hexRgb(action.color);
    const cv = makeCanvas();
    const cx = cv.getContext('2d');
    const img = cx.createImageData(W, H);
    const data = img.data;
    const runs = action.runs;

    for (let k = 0; k < runs.length; k += 3) {
      const end = runs[k] + runs[k + 1];
      const alpha = runs[k + 2];
      for (let i = runs[k]; i < end; i++) {
        const o = i * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = alpha;
      }
    }

    cx.putImageData(img, 0, 0);
    const target = paintCtxs[clamp(action.layer == null ? state.layer : action.layer, 0, LAYER_COUNT - 1)];
    target.save();
    if (action.under) target.globalCompositeOperation = 'destination-over';
    target.globalAlpha = action.alpha;
    target.drawImage(cv, 0, 0);
    target.restore();
  }

  function applyFill(pt) {
    ensureActiveLayerVisible();
    const sx = clamp(Math.floor(pt.x), 0, W - 1);
    const sy = clamp(Math.floor(pt.y), 0, H - 1);

    const comp = makeCanvas();
    const compCtx = comp.getContext('2d', { willReadFrequently: true });
    compCtx.drawImage(wallEl, 0, 0);
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (layers[i].visible) compCtx.drawImage(paintEls[i], 0, 0);
    }
    const srcData = compCtx.getImageData(0, 0, W, H).data;
    const paintData = paintCtxs[state.layer].getImageData(0, 0, W, H).data;

    const onPaint = paintData[(sy * W + sx) * 4 + 3] >= 12;
    const tol = onPaint ? estimateFillTolerance(srcData, sx, sy) : 150;
    const mask = floodFillMask(srcData, paintData, sx, sy, tol, onPaint);
    const runs = encodeFillRuns(mask);

    if (!runs.length) {
      showToast('Заливать нечего — область слишком мала');
      return;
    }

    const action = {
      type: 'fill',
      color: state.color,
      alpha: state.alpha,
      under: !onPaint,
      runs,
      layer: state.layer
    };
    undoHistory.push(action);
    redoStack.length = 0;
    paintFillAction(action);
    refreshLayerThumbs();
    updateUI();
  }

  function updateUI() {
    undoBtn.disabled = isDrawing || undoHistory.length === 0;
    redoBtn.disabled = isDrawing || redoStack.length === 0;
    clearBtn.disabled = isDrawing;
    saveBtn.disabled = isDrawing;
  }

  // ---------- save ----------

  function savePNG() {
    if (isDrawing) return;
    const out = makeCanvas();
    const g = out.getContext('2d');
    g.drawImage(getWallTexture(state.wall), 0, 0);
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (layers[i].visible) g.drawImage(paintEls[i], 0, 0);
    }

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

  function getCanvasPoint(e) {
    const rect = wallEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (e.clientX - rect.left) / rect.width * W,
      y: (e.clientY - rect.top) / rect.height * H,
      p: e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.1, 1) : 0.85
    };
  }

  function isInsideCanvas(pt) {
    return pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H;
  }

  function boundaryPoint(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t = 1;
    if (b.x < 0 && dx !== 0) t = Math.min(t, (0 - a.x) / dx);
    else if (b.x > W && dx !== 0) t = Math.min(t, (W - a.x) / dx);
    if (b.y < 0 && dy !== 0) t = Math.min(t, (0 - a.y) / dy);
    else if (b.y > H && dy !== 0) t = Math.min(t, (H - a.y) / dy);
    t = clamp(t, 0, 1);
    return {
      x: clamp(a.x + dx * t, 0, W),
      y: clamp(a.y + dy * t, 0, H),
      p: a.p + (b.p - a.p) * t
    };
  }

  function edgeAnchor(pt) {
    const dl = pt.x;
    const dr = W - pt.x;
    const dt = pt.y;
    const db = H - pt.y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: 0, y: pt.y, p: pt.p };
    if (m === dr) return { x: W, y: pt.y, p: pt.p };
    if (m === dt) return { x: pt.x, y: 0, p: pt.p };
    return { x: pt.x, y: H, p: pt.p };
  }

  function feedPointerEvent(rt, ev) {
    const pt = getCanvasPoint(ev);
    if (!pt) return;

    if (isInsideCanvas(pt)) {
      if (strokeOutside) {
        feedPoint(rt, edgeAnchor(pt), false);
        feedPoint(rt, pt, false);
        strokeOutside = false;
      } else {
        feedPoint(rt, pt, false);
      }
      lastInside = pt;
      return;
    }

    if (!strokeOutside && lastInside) {
      feedPoint(rt, boundaryPoint(lastInside, pt), false);
      breakRuntime(rt);
      rt.action.points.push({ br: true });
      strokeOutside = true;
    }
  }

  function capturePointer(id) {
    try {
      wrapEl.setPointerCapture(id);
    } catch (err) { /* synthetic events */ }
  }

  function cancelStroke() {
    if (!drawing) return;
    drawing = null;
    isDrawing = false;
    activePointerId = null;
    strokeOutside = false;
    lastInside = null;
    previewEl.style.opacity = '1';
    vctx.clearRect(0, 0, W, H);
    renderAll();
  }

  function abortForPinch() {
    if (!drawing) return;
    let dist = 0;
    let prev = null;
    for (const p of drawing.action.points) {
      if (p.br) {
        prev = null;
        continue;
      }
      if (prev) dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    if (dist < 6) cancelStroke();
    else finishStroke();
  }

  function startPan(e) {
    e.preventDefault();
    pendingFill = null;
    measureView();
    panning = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      panX,
      panY
    };
    capturePointer(e.pointerId);
    document.body.classList.add('is-panning');
    setCursorVisible(false);
  }

  function startPinch() {
    const pts = [...touchPoints.values()];
    if (pts.length < 2) {
      pinch = null;
      return;
    }
    const [a, b] = pts;
    const rect = wrapEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    pinch = {
      startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startZoom: zoom,
      baseX: centerX - panX,
      baseY: centerY - panY,
      ux: ((a.x + b.x) * 0.5 - centerX) / zoom,
      uy: ((a.y + b.y) * 0.5 - centerY) / zoom
    };
  }

  function updatePinch() {
    const pts = [...touchPoints.values()];
    if (!pinch || pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const cx = (a.x + b.x) * 0.5;
    const cy = (a.y + b.y) * 0.5;
    const next = clamp(pinch.startZoom * (dist / pinch.startDist), MIN_ZOOM, MAX_ZOOM);
    zoom = next;
    panX = cx - pinch.ux * next - pinch.baseX;
    panY = cy - pinch.uy * next - pinch.baseY;
    applyView();
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceDown))) {
      startPan(e);
      return;
    }

    if (e.pointerType === 'touch') {
      e.preventDefault();
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturePointer(e.pointerId);

      if (touchPoints.size >= 2) {
        if (isDrawing) abortForPinch();
        pendingFill = null;
        if (panning) {
          panning = null;
          document.body.classList.remove('is-panning');
        }
        suppressTouchDraw = true;
        startPinch();
        setCursorVisible(false);
        return;
      }

      if (suppressTouchDraw) return;
      setCursorVisible(false);
    } else {
      positionCursor(e);
    }

    if (state.mode === 'pan') {
      if (panning) return;
      startPan(e);
      return;
    }

    if (isDrawing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (state.mode === 'fill') {
      const pt = getCanvasPoint(e);
      if (!pt) return;
      e.preventDefault();
      pendingFill = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      capturePointer(e.pointerId);
      return;
    }

    const pt = getCanvasPoint(e);
    if (!pt) return;
    e.preventDefault();

    ensureActiveLayerVisible();
    activePointerId = e.pointerId;
    capturePointer(e.pointerId);

    const action = {
      type: 'stroke',
      mode: state.mode,
      color: state.color,
      size: state.size,
      alpha: state.alpha,
      smooth: state.smooth,
      pattern: state.pattern,
      brush: state.brush,
      layer: state.layer,
      seed: (Math.random() * 2147483647) | 0,
      points: []
    };

    drawing = makeRuntime(action);
    isDrawing = true;
    strokeOutside = false;
    lastInside = pt;
    if (usesPreview(state.mode)) {
      vctx.clearRect(0, 0, W, H);
      previewEl.style.opacity = String(state.alpha);
    }
    feedPoint(drawing, pt, false);
    updateUI();
  }

  function onPointerMove(e) {
    if (panning && e.pointerId === panning.id) {
      e.preventDefault();
      panX = panning.panX + (e.clientX - panning.x);
      panY = panning.panY + (e.clientY - panning.y);
      applyView();
      return;
    }

    if (pendingFill && e.pointerId === pendingFill.id) {
      if (Math.hypot(e.clientX - pendingFill.x, e.clientY - pendingFill.y) > 6) {
        pendingFill.moved = true;
      }
    }

    if (e.pointerType === 'touch') {
      if (touchPoints.has(e.pointerId)) {
        touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (pinch && touchPoints.size >= 2) {
        e.preventDefault();
        updatePinch();
        return;
      }
    } else {
      positionCursor(e);
    }

    if (!isDrawing || !drawing || e.pointerId !== activePointerId) return;
    if (e.pointerType === 'touch' && suppressTouchDraw) return;
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

    for (const ev of events) feedPointerEvent(drawing, ev);
    if (!events.includes(e)) feedPointerEvent(drawing, e);
  }

  function onPointerUp(e) {
    if (panning && e.pointerId === panning.id) {
      panning = null;
      document.body.classList.remove('is-panning');
      if (e.pointerType !== 'touch') {
        positionCursor(e);
        return;
      }
    }

    if (pendingFill && e.pointerId === pendingFill.id) {
      const pending = pendingFill;
      pendingFill = null;
      if (!pending.moved && !suppressTouchDraw && !pinch) {
        const pt = getCanvasPoint(e);
        if (pt && isInsideCanvas(pt)) applyFill(pt);
      }
    }

    if (e.pointerType === 'touch') {
      touchPoints.delete(e.pointerId);
      if (touchPoints.size >= 2) {
        startPinch();
      } else {
        pinch = null;
        if (touchPoints.size === 0) suppressTouchDraw = false;
      }
    }

    if (!isDrawing || e.pointerId !== activePointerId) return;
    finishStroke();
    if (e.pointerType !== 'touch') positionCursor(e);
  }

  wrapEl.addEventListener('pointerdown', onPointerDown);
  wrapEl.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', (e) => {
    pendingFill = null;
    onPointerUp(e);
  });

  wrapEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || spaceDown) return;
    positionCursor(e);
  });

  wrapEl.addEventListener('pointerleave', () => {
    setCursorVisible(false);
  });

  window.addEventListener('blur', () => {
    if (isDrawing) finishStroke();
    panning = null;
    pendingFill = null;
    pinch = null;
    touchPoints.clear();
    suppressTouchDraw = false;
    spaceDown = false;
    document.body.classList.remove('is-panning', 'is-pan-ready');
    setCursorVisible(false);
  });

  // ---------- cursor ----------

  const CURSOR_SCALE = {
    spray: 1,
    marker: 0.52,
    brush: 0.9,
    pencil: 0.1,
    pattern: 1,
    eraser: 0.9
  };

  function updateCursorGeometry() {
    if (!viewBounds.wrapW) measureView();
    const scale = viewBounds.wrapW ? viewBounds.wrapW * zoom / W : 0.5;
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
    if (state.mode === 'pan' || state.mode === 'fill') {
      setCursorVisible(false);
      return;
    }
    updateCursorGeometry();
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    setCursorVisible(true);
  }

  function setCursorVisible(visible) {
    cursorShown = visible;
    cursorEl.classList.toggle('is-visible', visible);
  }

  // ---------- zoom & layout ----------

  function measureView() {
    const sr = stageEl.getBoundingClientRect();
    viewBounds.stageW = sr.width;
    viewBounds.stageH = sr.height;
    viewBounds.wrapW = wrapEl.offsetWidth;
    viewBounds.wrapH = wrapEl.offsetHeight;
  }

  function clampPan() {
    if (!viewBounds.wrapW) measureView();
    const scaledW = viewBounds.wrapW * zoom;
    const scaledH = viewBounds.wrapH * zoom;
    const maxX = Math.max(0, (scaledW - viewBounds.stageW) / 2);
    const maxY = Math.max(0, (scaledH - viewBounds.stageH) / 2);
    panX = clamp(panX, -maxX, maxX);
    panY = clamp(panY, -maxY, maxY);
    if (zoom <= MIN_ZOOM + 0.001) {
      panX = 0;
      panY = 0;
    }
  }

  function applyView() {
    clampPan();
    wrapEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const pct = Math.round(zoom * 100);
    const pctValue = String(pct);
    if (zoomInput.value !== pctValue) {
      zoomInput.value = pctValue;
      updateRangeFill(zoomInput);
    }
    const label = pct + '%';
    if (zoomVal.textContent !== label) zoomVal.textContent = label;
    if (!panning) updateCursorGeometry();
  }

  function zoomAround(nextZoom, clientX, clientY) {
    const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - zoom) < 0.001) return;
    const rect = wrapEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fx = clientX == null ? cx : clientX;
    const fy = clientY == null ? cy : clientY;
    const ratio = z / zoom;
    const nx = fx - (fx - cx) * ratio;
    const ny = fy - (fy - cy) * ratio;
    panX += nx - cx;
    panY += ny - cy;
    zoom = z;
    applyView();
  }

  function stageCenter() {
    const rect = stageEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
  }

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
    measureView();
    applyView();
  }

  zoomInput.addEventListener('input', () => {
    const c = stageCenter();
    zoomAround(Number(zoomInput.value) / 100, c.x, c.y);
  });

  zoomInBtn.addEventListener('click', () => {
    const c = stageCenter();
    zoomAround(zoom + 0.25, c.x, c.y);
  });

  zoomOutBtn.addEventListener('click', () => {
    const c = stageCenter();
    zoomAround(zoom - 0.25, c.x, c.y);
  });

  zoomVal.addEventListener('click', resetView);

  stageEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomAround(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

  if ('ResizeObserver' in window) {
    new ResizeObserver(fitStage).observe(stageEl);
  }
  window.addEventListener('resize', fitStage);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitStage);
  }

  // ---------- Telegram ----------

  function syncTelegramViewport(tg) {
    const h = Math.round(tg.viewportStableHeight || tg.viewportHeight || 0);
    if (h > 0) {
      document.documentElement.style.setProperty('--app-height', h + 'px');
    }

    const safe = tg.safeAreaInset || {};
    const content = tg.contentSafeAreaInset || {};
    const setInset = (name, value) => {
      document.documentElement.style.setProperty(name, Math.max(0, Math.round(value)) + 'px');
    };
    setInset('--tg-safe-top', (safe.top || 0) + (content.top || 0));
    setInset('--tg-safe-right', (safe.right || 0) + (content.right || 0));
    setInset('--tg-safe-bottom', (safe.bottom || 0) + (content.bottom || 0));
    setInset('--tg-safe-left', (safe.left || 0) + (content.left || 0));
    fitStage();
  }

  function initTelegram() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.platform || tg.platform === 'unknown') return;

    document.body.classList.add('is-telegram');
    try { tg.ready(); } catch (err) { /* not in Telegram */ }
    try { tg.expand(); } catch (err) { /* older client */ }
    try { tg.setHeaderColor('#0a0a0b'); } catch (err) { /* unsupported */ }
    try { tg.setBackgroundColor('#0a0a0b'); } catch (err) { /* unsupported */ }

    syncTelegramViewport(tg);
    if (typeof tg.onEvent === 'function') {
      tg.onEvent('viewportChanged', () => syncTelegramViewport(tg));
      tg.onEvent('fullscreenChanged', () => syncTelegramViewport(tg));
    }
  }

  function loadTelegramSdk() {
    if (window.Telegram && window.Telegram.WebApp) {
      initTelegram();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = initTelegram;
    document.head.appendChild(s);
  }

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
    if (patternsOpen) renderPatternGrid();
    if (brushesOpen) renderBrushGrid();
  }

  colorsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button.swatch[data-color]');
    if (b) setColor(b.dataset.color, false);
  });

  colorInput.addEventListener('input', () => setColor(colorInput.value, true));

  // ---------- tools & sliders ----------

  function setMode(mode) {
    state.mode = mode;
    pendingFill = null;
    document.body.classList.toggle('is-tool-pan', mode === 'pan');
    document.body.classList.toggle('is-tool-fill', mode === 'fill');
    if (mode === 'pan' || mode === 'fill') setCursorVisible(false);
    document.querySelectorAll('.tool[data-mode]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    updateCursorGeometry();
  }

  document.querySelectorAll('.tool[data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.mode === 'pattern') openPatterns();
      else if (b.dataset.mode === 'brush') openBrushes();
      else setMode(b.dataset.mode);
    });
  });

  // ---------- pattern picker ----------

  const patternsEl = document.getElementById('patternsModal');
  const patternsGrid = document.getElementById('patternsGrid');
  const patternsClose = document.getElementById('patternsClose');
  let patternsOpen = false;
  let patternsReturnFocus = null;

  function drawPatternThumb(canvas, def) {
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const pat = g.createPattern(getPatternTile(def, state.color), 'repeat');
    if (!pat) return;
    const s = (88 * def.zoom / 2) / PATTERN_TILE;
    if (typeof pat.setTransform === 'function' && typeof DOMMatrix === 'function') {
      pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
    }
    const cy = h / 2;
    const radius = 24;
    const curveY = (x) => cy - Math.sin(((x - 26) / (w - 52)) * Math.PI) * 9;

    g.save();
    g.globalAlpha = 0.14;
    g.strokeStyle = state.color;
    g.lineWidth = radius * 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    for (let x = 26; x <= w - 26; x += 5) {
      if (x === 26) g.moveTo(x, curveY(x));
      else g.lineTo(x, curveY(x));
    }
    g.stroke();
    g.restore();

    g.fillStyle = pat;
    for (let x = 26; x <= w - 26; x += 5) {
      g.beginPath();
      g.arc(x, curveY(x), radius, 0, TAU);
      g.fill();
    }
  }

  function renderPatternGrid() {
    if (!patternsGrid) return;
    patternsGrid.innerHTML = '';
    for (const def of PATTERNS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pattern-card';
      card.dataset.pattern = def.id;
      card.title = def.name;
      const selected = state.pattern === def.id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');

      const cv = document.createElement('canvas');
      cv.className = 'pattern-thumb';
      cv.width = 168;
      cv.height = 100;
      drawPatternThumb(cv, def);

      const label = document.createElement('span');
      label.className = 'pattern-name';
      label.textContent = def.name;

      card.append(cv, label);
      patternsGrid.appendChild(card);
    }
  }

  function openPatterns() {
    if (!patternsEl || patternsOpen || brushesOpen) return;
    if (layersOpen) closeLayers();
    const active = document.activeElement;
    patternsReturnFocus = active && active !== document.body
      ? active
      : document.querySelector('.tool[data-mode="pattern"]');
    renderPatternGrid();
    patternsOpen = true;
    patternsEl.classList.add('is-open');
    patternsEl.setAttribute('aria-hidden', 'false');
    setCursorVisible(false);
    if (patternsClose) patternsClose.focus();
  }

  function closePatterns() {
    if (!patternsEl || !patternsOpen) return;
    patternsOpen = false;
    patternsEl.classList.remove('is-open');
    const target = patternsReturnFocus && patternsReturnFocus !== document.body
      ? patternsReturnFocus
      : document.querySelector('.tool[data-mode="pattern"]');
    patternsReturnFocus = null;
    if (target && typeof target.focus === 'function') target.focus();
    patternsEl.setAttribute('aria-hidden', 'true');
  }

  function choosePattern(id) {
    const def = PATTERN_MAP.get(id);
    if (!def) return;
    state.pattern = id;
    setMode('pattern');
    closePatterns();
    showToast(`Паттерн: ${def.name}`);
  }

  if (patternsEl) {
    patternsEl.addEventListener('click', (e) => {
      const card = e.target.closest('.pattern-card');
      if (card) {
        choosePattern(card.dataset.pattern);
        return;
      }
      if (e.target === patternsEl || e.target.closest('[data-close]')) closePatterns();
    });
  }

  // ---------- brush picker ----------

  const brushesEl = document.getElementById('brushesModal');
  const brushesGrid = document.getElementById('brushesGrid');
  const brushesClose = document.getElementById('brushesClose');
  let brushesOpen = false;
  let brushesReturnFocus = null;

  function drawBrushThumb(canvas, def) {
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const rt = {
      color: state.color,
      size: 44,
      alpha: 1,
      rng: mulberry32(4211),
      brush: def,
      angle: null
    };
    const x0 = 22;
    const x1 = w - 22;
    const cy = h / 2 + 2;
    const amp = 12;
    const k = (Math.PI * 1.15) / (x1 - x0);
    const curveY = (x) => cy - Math.sin((x - x0) * k) * amp;
    const step = Math.max(1.4, rt.size * def.spacing);
    for (let x = x0; x <= x1; x += step) {
      const slope = -amp * k * Math.cos((x - x0) * k);
      const t = (x - x0) / (x1 - x0);
      def.stamp(g, rt, x, curveY(x), 0.7 + 0.3 * Math.sin(t * Math.PI), Math.atan2(slope, 1));
    }
  }

  function renderBrushGrid() {
    if (!brushesGrid) return;
    brushesGrid.innerHTML = '';
    for (const def of BRUSHES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pattern-card';
      card.dataset.brush = def.id;
      card.title = def.name;
      const selected = state.brush === def.id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');

      const cv = document.createElement('canvas');
      cv.className = 'pattern-thumb';
      cv.width = 168;
      cv.height = 100;
      drawBrushThumb(cv, def);

      const label = document.createElement('span');
      label.className = 'pattern-name';
      label.textContent = def.name;

      card.append(cv, label);
      brushesGrid.appendChild(card);
    }
  }

  function openBrushes() {
    if (!brushesEl || brushesOpen || patternsOpen) return;
    if (layersOpen) closeLayers();
    const active = document.activeElement;
    brushesReturnFocus = active && active !== document.body
      ? active
      : document.querySelector('.tool[data-mode="brush"]');
    renderBrushGrid();
    brushesOpen = true;
    brushesEl.classList.add('is-open');
    brushesEl.setAttribute('aria-hidden', 'false');
    setCursorVisible(false);
    if (brushesClose) brushesClose.focus();
  }

  function closeBrushes() {
    if (!brushesEl || !brushesOpen) return;
    brushesOpen = false;
    brushesEl.classList.remove('is-open');
    const target = brushesReturnFocus && brushesReturnFocus !== document.body
      ? brushesReturnFocus
      : document.querySelector('.tool[data-mode="brush"]');
    brushesReturnFocus = null;
    if (target && typeof target.focus === 'function') target.focus();
    brushesEl.setAttribute('aria-hidden', 'true');
  }

  function chooseBrush(id) {
    const def = BRUSH_MAP.get(id);
    if (!def) return;
    state.brush = id;
    setMode('brush');
    const tool = document.querySelector('.tool[data-mode="brush"]');
    if (tool) tool.title = `Кисть: ${def.name} — B`;
    closeBrushes();
    showToast(`Кисть: ${def.name}`);
  }

  if (brushesEl) {
    brushesEl.addEventListener('click', (e) => {
      const card = e.target.closest('.pattern-card');
      if (card && card.dataset.brush) {
        chooseBrush(card.dataset.brush);
        return;
      }
      if (e.target === brushesEl || e.target.closest('[data-close]')) closeBrushes();
    });
  }

  // ---------- layers ----------

  let layersOpen = false;
  let layersReturnFocus = null;

  function updateLayerBadge() {
    if (!layersBadge) return;
    layersBadge.textContent = String(state.layer + 1);
    if (layersBtn) {
      layersBtn.setAttribute('aria-label', `Слои, активный ${layers[state.layer].name}`);
    }
  }

  function eyeIcon(visible) {
    return visible
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.7"/><path d="M6.6 6.8A17.3 17.3 0 0 0 2.5 12s3.5 6 9.5 6a10.6 10.6 0 0 0 4-.8"/></svg>';
  }

  function drawLayerThumb(canvas, index) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(paintEls[index], 0, 0, canvas.width, canvas.height);
  }

  function updateLayerRow(index) {
    if (!layersList) return;
    const row = layersList.querySelector(`.layer-row[data-layer="${index}"]`);
    if (!row) return;
    row.classList.toggle('is-active', state.layer === index);
    row.classList.toggle('is-hidden', !layers[index].visible);
    row.setAttribute('aria-pressed', state.layer === index ? 'true' : 'false');
    const eye = row.querySelector('.layer-eye');
    if (eye) {
      eye.innerHTML = eyeIcon(layers[index].visible);
      eye.setAttribute('aria-pressed', layers[index].visible ? 'true' : 'false');
      eye.setAttribute('aria-label', `${layers[index].visible ? 'Скрыть' : 'Показать'} ${layers[index].name}`);
    }
    const meta = row.querySelector('.layer-meta');
    if (meta) meta.textContent = layers[index].visible ? 'виден' : 'скрыт';
  }

  function renderLayerRows() {
    if (!layersList) return;
    layersList.innerHTML = '';
    for (let i = LAYER_COUNT - 1; i >= 0; i--) {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.dataset.layer = String(i);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-pressed', i === state.layer ? 'true' : 'false');

      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'layer-eye';
      eye.innerHTML = eyeIcon(layers[i].visible);
      eye.setAttribute('aria-pressed', layers[i].visible ? 'true' : 'false');
      eye.setAttribute('aria-label', `${layers[i].visible ? 'Скрыть' : 'Показать'} ${layers[i].name}`);

      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      thumb.width = 56;
      thumb.height = 35;
      thumb.dataset.layer = String(i);
      drawLayerThumb(thumb, i);

      const info = document.createElement('div');
      info.className = 'layer-info';
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layers[i].name;
      const meta = document.createElement('span');
      meta.className = 'layer-meta';
      meta.textContent = layers[i].visible ? 'виден' : 'скрыт';
      info.append(name, meta);

      row.append(eye, thumb, info);
      layersList.appendChild(row);
      updateLayerRow(i);
    }
  }

  function refreshLayerThumbs() {
    if (!layersOpen || !layersList) return;
    layersList.querySelectorAll('canvas.layer-thumb').forEach((cv) => {
      drawLayerThumb(cv, Number(cv.dataset.layer));
    });
  }

  function setLayerVisible(index, visible) {
    if (!layers[index]) return;
    layers[index].visible = visible;
    paintEls[index].classList.toggle('is-hidden', !visible);
    updateLayerRow(index);
    updateLayerBadge();
  }

  function setActiveLayer(index) {
    if (index < 0 || index >= LAYER_COUNT) return;
    state.layer = index;
    for (let i = 0; i < LAYER_COUNT; i++) updateLayerRow(i);
    updateLayerBadge();
    showToast(`${layers[index].name} — активный`);
  }

  function ensureActiveLayerVisible() {
    if (layers[state.layer].visible) return;
    setLayerVisible(state.layer, true);
    showToast(`${layers[state.layer].name} снова виден`);
  }

  function openLayers() {
    if (!layersPop || layersOpen) return;
    const active = document.activeElement;
    layersReturnFocus = active && active !== document.body ? active : layersBtn;
    renderLayerRows();
    layersOpen = true;
    layersPop.classList.add('is-open');
    layersPop.setAttribute('aria-hidden', 'false');
    layersBtn.classList.add('is-open');
    layersBtn.setAttribute('aria-expanded', 'true');
    setCursorVisible(false);
  }

  function closeLayers() {
    if (!layersPop || !layersOpen) return;
    layersOpen = false;
    layersPop.classList.remove('is-open');
    layersPop.setAttribute('aria-hidden', 'true');
    layersBtn.classList.remove('is-open');
    layersBtn.setAttribute('aria-expanded', 'false');
    const target = layersReturnFocus || layersBtn;
    layersReturnFocus = null;
    if (target && typeof target.focus === 'function') target.focus();
  }

  if (layersBtn) {
    layersBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (layersOpen) closeLayers();
      else openLayers();
    });
  }

  if (layersList) {
    layersList.addEventListener('click', (e) => {
      const eye = e.target.closest('.layer-eye');
      if (eye) {
        const row = eye.closest('.layer-row');
        const i = Number(row.dataset.layer);
        setLayerVisible(i, !layers[i].visible);
        showToast(`${layers[i].name} ${layers[i].visible ? 'показан' : 'скрыт'}`);
        return;
      }
      const row = e.target.closest('.layer-row');
      if (row) setActiveLayer(Number(row.dataset.layer));
    });
    layersList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.layer-row');
      if (!row || e.target.closest('.layer-eye')) return;
      e.preventDefault();
      setActiveLayer(Number(row.dataset.layer));
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!layersOpen) return;
    if (layersPop && layersPop.contains(e.target)) return;
    if (layersBtn && layersBtn.contains(e.target)) return;
    closeLayers();
  }, true);

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

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
      || el.isContentEditable
      || (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'button');
  }

  window.addEventListener('keydown', (e) => {
    if (patternsOpen || brushesOpen) return;
    if (e.code !== 'Space' || isTypingTarget(e.target)) return;
    if (!spaceDown) {
      spaceDown = true;
      document.body.classList.add('is-pan-ready');
      setCursorVisible(false);
    }
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceDown = false;
    document.body.classList.remove('is-pan-ready');
  });

  document.addEventListener('keydown', (e) => {
    if (patternsOpen || brushesOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (patternsOpen) closePatterns();
        else closeBrushes();
      }
      return;
    }

    if (layersOpen && e.key === 'Escape') {
      e.preventDefault();
      closeLayers();
      return;
    }

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
      case 'KeyB': openBrushes(); break;
      case 'KeyP': setMode('pencil'); break;
      case 'KeyT': openPatterns(); break;
      case 'KeyF': setMode('fill'); break;
      case 'KeyE': setMode('eraser'); break;
      case 'KeyH': setMode('pan'); break;
      case 'KeyL': if (layersOpen) closeLayers(); else openLayers(); break;
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

  // ---------- splash ----------

  let splashClosed = false;

  function closeSplash() {
    if (splashClosed || !splashEl) return;
    splashClosed = true;
    splashEl.classList.add('is-gone');
    splashEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => splashEl.remove(), 650);
  }

  if (splashEl) {
    splashEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      closeSplash();
    });
    splashEl.addEventListener('wheel', closeSplash, { passive: true });
    splashEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeSplash();
      }
    });
  }

  // ---------- init ----------

  fitStage();
  setWall('brick');
  setColor('#ff2e63', false);
  updateLayerBadge();
  sizeVal.textContent = String(state.size);
  alphaVal.textContent = `${Math.round(state.alpha * 100)}%`;
  smoothVal.textContent = `${Math.round(state.smooth * 100)}%`;
  updateRangeFill(sizeInput);
  updateRangeFill(alphaInput);
  updateRangeFill(smoothInput);
  updateRangeFill(zoomInput);
  loadTelegramSdk();
  renderAll();
  fitStage();
})();
