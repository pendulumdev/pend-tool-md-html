/* md-html mind-map — column/row layout, no overlaps, hover focus */
(function () {
  const VIEW_KEY = 'md-html-view';

  const CARD_W = 168;
  const CARD_H = 72;
  const CARD_GAP_X = 18;
  const CARD_GAP_Y = 14;
  const COL_SECTION = 120;
  const COL_SUBGROUP = 280;
  const COL_CARDS = 420;
  const PAD = 48;
  const SECTION_GAP = 56;
  const SUBGROUP_GAP = 28;
  const FILE_COLS = 3; // cards per row within a subgroup

  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Soft cubic with a light bow — still readable between grid anchors. */
  function curvePath(x1, y1, x2, y2, seed) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = Math.min(48, 0.08 * len + (hash32(seed) % 20));
    const side = hash32(seed + ':s') % 2 === 0 ? 1 : -1;
    const c1x = x1 + dx * 0.4 + nx * bow * side;
    const c1y = y1 + dy * 0.15 + ny * bow * side;
    const c2x = x1 + dx * 0.7 - nx * bow * side * 0.4;
    const c2y = y1 + dy * 0.85 - ny * bow * side * 0.4;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  function fileKey(f) {
    return (f.project_path || f.path).toLowerCase();
  }

  function subgroupBlockHeight(fileCount) {
    if (fileCount === 0) return 40;
    const rows = Math.ceil(fileCount / FILE_COLS);
    return rows * CARD_H + (rows - 1) * CARD_GAP_Y;
  }

  /**
   * @param {HTMLElement} host
   * @param {{ sections: Array, projectIndex: Map, onOpen: Function }} opts
   */
  function render(host, opts) {
    const { sections, onOpen } = opts;
    host.innerHTML = '';
    host.classList.add('map-host');

    if (!sections.length) {
      host.innerHTML = '<div class="empty">No matching <code>.md</code> files.</div>';
      return;
    }

    /** @type {Map<string, {x:number,y:number,entry:object,el?:HTMLElement,sgId:string,secId:string}>} */
    const positions = new Map();
    const hubs = []; // {id, label, count, x, y, kind, el?}
    /** @type {Array<{fromId:string,toId:string,from:{x,y},to:{x,y},seed:string,cls:string,kind:'struct'|'link',path?:SVGPathElement}>} */
    const edges = [];

    let cursorY = PAD;
    let maxX = COL_CARDS + FILE_COLS * (CARD_W + CARD_GAP_X);

    for (const sec of sections) {
      const secId = 'sec:' + sec.top;
      const secTop = cursorY;
      let blockY = secTop;

      // Measure section height from subgroups first
      let contentH = 0;
      for (const sg of sec.subgroups) {
        contentH += Math.max(40, subgroupBlockHeight(sg.files.length));
        contentH += SUBGROUP_GAP;
      }
      contentH = Math.max(48, contentH - SUBGROUP_GAP);

      const hubX = PAD + COL_SECTION / 2;
      const hubY = secTop + contentH / 2;
      hubs.push({
        id: secId,
        label: sec.top,
        count: sec.total,
        x: hubX,
        y: hubY,
        kind: 'section',
      });

      for (const sg of sec.subgroups) {
        const subLabel = sg.sub || '(root)';
        const sgId = 'sg:' + sec.top + '/' + subLabel;
        const n = sg.files.length;
        const blockH = Math.max(40, subgroupBlockHeight(n));
        const sgX = PAD + COL_SUBGROUP;
        const sgY = blockY + blockH / 2;

        hubs.push({
          id: sgId,
          label: sg.sub ? subLabel + '/' : 'root',
          count: n,
          x: sgX,
          y: sgY,
          kind: 'subgroup',
          secId,
        });
        edges.push({
          fromId: secId,
          toId: sgId,
          from: { x: hubX + 36, y: hubY },
          to: { x: sgX - 36, y: sgY },
          seed: secId + '→' + sgId,
          cls: 'map-edge-struct',
          kind: 'struct',
        });

        const rows = Math.max(1, Math.ceil(n / FILE_COLS));
        const gridH = n === 0 ? 0 : rows * CARD_H + (rows - 1) * CARD_GAP_Y;
        const gridTop = blockY + (blockH - gridH) / 2;

        for (let fi = 0; fi < n; fi++) {
          const f = sg.files[fi];
          const col = fi % FILE_COLS;
          const row = Math.floor(fi / FILE_COLS);
          const fx = PAD + COL_CARDS + col * (CARD_W + CARD_GAP_X) + CARD_W / 2;
          const fy = gridTop + row * (CARD_H + CARD_GAP_Y) + CARD_H / 2;
          const key = fileKey(f);
          positions.set(key, {
            x: fx,
            y: fy,
            entry: f,
            id: 'file:' + key,
            sgId,
            secId,
          });
          edges.push({
            fromId: sgId,
            toId: 'file:' + key,
            from: { x: sgX + 40, y: sgY },
            to: { x: fx - CARD_W / 2, y: fy },
            seed: key + ':h',
            cls: 'map-edge-struct soft',
            kind: 'struct',
          });
          maxX = Math.max(maxX, fx + CARD_W / 2);
        }

        blockY += blockH + SUBGROUP_GAP;
      }

      cursorY = secTop + contentH + SECTION_GAP;
    }

    // Relation edges between files (markdown links)
    const adj = new Map(); // id -> Set<id> (undirected, files + hubs they touch via struct)
    const touch = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };

    for (const e of edges) touch(e.fromId, e.toId);

    const seenLink = new Set();
    for (const [key, node] of positions) {
      const f = node.entry;
      if (f.kind !== 'md' || !f.links) continue;
      for (const target of f.links) {
        const toKey = String(target).toLowerCase();
        const to = positions.get(toKey);
        if (!to) continue;
        const a = key < toKey ? key : toKey;
        const b = key < toKey ? toKey : key;
        const ek = a + '|' + b;
        if (seenLink.has(ek)) continue;
        seenLink.add(ek);
        const fromId = 'file:' + key;
        const toId = 'file:' + toKey;
        edges.push({
          fromId,
          toId,
          from: { x: node.x, y: node.y },
          to: { x: to.x, y: to.y },
          seed: ek,
          cls: 'map-edge-link',
          kind: 'link',
        });
        touch(fromId, toId);
      }
    }

    const width = Math.max(960, maxX + PAD);
    const height = Math.max(560, cursorY + PAD);

    const viewport = document.createElement('div');
    viewport.className = 'map-viewport';
    viewport.tabIndex = 0;

    const hint = document.createElement('div');
    hint.className = 'map-hint';
    hint.textContent = 'Hover to focus related · drag to pan · scroll to zoom · click to open';

    const stage = document.createElement('div');
    stage.className = 'map-stage';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'map-svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const edgeLayer = document.createElementNS(svgNS, 'g');
    edgeLayer.setAttribute('class', 'map-edges');
    for (const e of edges) {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', curvePath(e.from.x, e.from.y, e.to.x, e.to.y, e.seed));
      p.setAttribute('class', e.cls);
      p.dataset.from = e.fromId;
      p.dataset.to = e.toId;
      p.dataset.kind = e.kind;
      e.path = p;
      edgeLayer.appendChild(p);
    }
    svg.appendChild(edgeLayer);

    const nodes = document.createElement('div');
    nodes.className = 'map-nodes';
    nodes.style.width = width + 'px';
    nodes.style.height = height + 'px';

    /** @type {Map<string, HTMLElement>} */
    const elById = new Map();

    for (const h of hubs) {
      const el = document.createElement('div');
      el.className = 'map-hub map-hub-' + h.kind;
      el.dataset.id = h.id;
      el.style.left = h.x + 'px';
      el.style.top = h.y + 'px';
      el.innerHTML = `<span class="map-hub-label">${esc(h.label)}</span><span class="map-hub-count">${h.count}</span>`;
      nodes.appendChild(el);
      elById.set(h.id, el);
      h.el = el;
    }

    for (const [, node] of positions) {
      const f = node.entry;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-card' + (f.kind === 'html' ? ' html' : '');
      el.dataset.id = node.id;
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.style.width = CARD_W + 'px';
      el.style.height = CARD_H + 'px';
      el.title = f.root + '/' + f.path;
      const isHtml = f.kind === 'html';
      el.innerHTML = `
        <span class="map-card-name">${esc(isHtml ? f.dir : f.name)}</span>
        <span class="map-card-meta">${esc(truncate(f.summary || f.path, 72))}</span>`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onOpen(f);
      });
      nodes.appendChild(el);
      elById.set(node.id, el);
      node.el = el;
    }

    stage.appendChild(svg);
    stage.appendChild(nodes);
    viewport.appendChild(hint);
    viewport.appendChild(stage);
    host.appendChild(viewport);

    // --- Hover focus: highlight node + related (1-hop via adj) ---
    function clearFocus() {
      viewport.classList.remove('map-focusing');
      for (const el of elById.values()) {
        el.classList.remove('is-focus', 'is-related', 'is-dim');
      }
      for (const e of edges) {
        e.path.classList.remove('is-focus', 'is-dim');
      }
    }

    function setFocus(id) {
      viewport.classList.add('map-focusing');
      const related = new Set([id]);
      const hop = adj.get(id);
      if (hop) for (const r of hop) related.add(r);

      // Also keep section hub related when focusing a file/subgroup under it
      for (const [, node] of positions) {
        if (related.has(node.id)) {
          related.add(node.sgId);
          related.add(node.secId);
        }
      }
      for (const h of hubs) {
        if (related.has(h.id) && h.secId) related.add(h.secId);
      }

      for (const [nid, el] of elById) {
        if (nid === id) el.classList.add('is-focus');
        else if (related.has(nid)) el.classList.add('is-related');
        else el.classList.add('is-dim');
      }
      for (const e of edges) {
        const bothRelated = related.has(e.fromId) && related.has(e.toId);
        if (bothRelated) e.path.classList.add('is-focus');
        else e.path.classList.add('is-dim');
      }
    }

    for (const [id, el] of elById) {
      el.addEventListener('pointerenter', () => setFocus(id));
      el.addEventListener('pointerleave', (e) => {
        // Leaving to another map node keeps focus via that node's enter
        const next = e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest('[data-id]')
          : null;
        if (!next || !nodes.contains(next)) clearFocus();
      });
    }

    // Pan / zoom
    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;

    const applyTransform = () => {
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    applyTransform();

    viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-card')) return;
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      viewport.classList.add('panning');
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      tx += dx;
      ty += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      applyTransform();
    });
    const endPan = (e) => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('panning');
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) clearFocus();
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const prev = scale;
      const next = Math.min(2.2, Math.max(0.35, scale * (e.deltaY > 0 ? 0.92 : 1.08)));
      tx = mx - (mx - tx) * (next / prev);
      ty = my - (my - ty) * (next / prev);
      scale = next;
      applyTransform();
    }, { passive: false });

    requestAnimationFrame(() => {
      const vw = viewport.clientWidth || 900;
      const vh = viewport.clientHeight || 600;
      const fitW = (vw - 32) / width;
      const fitH = (vh - 32) / height;
      const fit = Math.min(1, fitW, fitH);
      if (fit < 0.98) {
        scale = Math.max(0.4, fit);
        tx = 16;
        ty = 12;
        applyTransform();
      }
    });
  }

  function clear(host) {
    if (host) host.innerHTML = '';
  }

  function getStoredView() {
    try {
      const v = sessionStorage.getItem(VIEW_KEY);
      return v === 'map' ? 'map' : 'list';
    } catch (_) {
      return 'list';
    }
  }

  function setStoredView(view) {
    try { sessionStorage.setItem(VIEW_KEY, view); } catch (_) {}
  }

  window.MdHtmlMap = { render, clear, getStoredView, setStoredView };
})();
