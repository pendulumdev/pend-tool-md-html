/* md-html map - root swimlanes, nested folder columns, leaf-first sizing */
(function () {
  const VIEW_KEY = 'md-html-view';
  const ZOOM_KEY = 'md-html-map-zoom';
  const ZOOM_MIN = 0.4;
  const ZOOM_STEP = 0.1;

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

  function fileLookupKey(root, path) {
    return `${root}\0${path}`.toLowerCase();
  }

  function projectKey(f) {
    return (f.project_path || f.path).toLowerCase();
  }

  function countFiles(node) {
    let n = node.files.length;
    for (const child of node.children.values()) n += countFiles(child);
    return n;
  }

  /** Folder tree from flat section subgroups. Leaves first when measuring via nested flex. */
  function treeFromSection(sec) {
    const root = { name: sec.top, files: [], children: new Map() };
    for (const sg of sec.subgroups) {
      const parts = sg.sub ? sg.sub.split('/').filter(Boolean) : [];
      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, files: [], children: new Map() });
        }
        node = node.children.get(part);
      }
      for (const f of sg.files) node.files.push(f);
    }
    return root;
  }

  /**
   * @param {HTMLElement} host
   * @param {{ sections: Array, pathIndex?: Map, projectIndex?: Map, onOpen: Function }} opts
   */
  function render(host, opts) {
    const { sections, onOpen, onToggleRead, fileMarkClass } = opts;
    const pathIndex = opts.pathIndex || new Map();
    const projectIndex = opts.projectIndex || new Map();
    host.innerHTML = '';
    host.classList.add('map-host');

    if (!sections.length) {
      host.innerHTML = '<div class="empty">No matching <code>.md</code> files.</div>';
      return;
    }

    const viewport = document.createElement('div');
    viewport.className = 'map-viewport';

    const tools = document.createElement('div');
    tools.className = 'map-tools';

    const hint = document.createElement('div');
    hint.className = 'map-hint';
    hint.textContent = 'Hover to focus · pin to hold · scroll to pan · ⌃wheel to zoom out';

    const zoomBox = document.createElement('div');
    zoomBox.className = 'map-zoom';
    zoomBox.setAttribute('role', 'group');
    zoomBox.setAttribute('aria-label', 'Map zoom');
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'map-zoom-btn';
    zoomOutBtn.setAttribute('aria-label', 'Zoom out');
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.textContent = '−';
    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.type = 'button';
    zoomResetBtn.className = 'map-zoom-btn map-zoom-pct';
    zoomResetBtn.setAttribute('aria-label', 'Reset zoom');
    zoomResetBtn.title = 'Reset to 100%';
    zoomBox.appendChild(zoomOutBtn);
    zoomBox.appendChild(zoomResetBtn);
    tools.appendChild(hint);
    tools.appendChild(zoomBox);

    const board = document.createElement('div');
    board.className = 'map-board';

    let zoom = getStoredZoom();
    let pinnedId = null;
    let hoverId = null;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'map-svg');
    const edgeLayer = document.createElementNS(svgNS, 'g');
    edgeLayer.setAttribute('class', 'map-edges');
    svg.appendChild(edgeLayer);
    board.appendChild(svg);

    /** @type {Map<string, HTMLElement>} */
    const cardEls = new Map();
    /** @type {Map<string, object>} */
    const entryById = new Map();

    function resolveEntry(root, path, projectPath) {
      return pathIndex.get(fileLookupKey(root, path))
        || projectIndex.get(String(projectPath || path).toLowerCase())
        || entryById.get(fileLookupKey(root, path))
        || null;
    }

    function renderCard(f) {
      const id = fileLookupKey(f.root, f.path);
      entryById.set(id, f);
      const wrap = document.createElement('div');
      wrap.className = 'map-card-wrap ' + (fileMarkClass ? fileMarkClass(f) : 'is-unread');
      wrap.dataset.key = (f.root + '/' + f.path).toLowerCase();
      wrap.dataset.id = id;
      wrap.dataset.root = f.root;
      wrap.dataset.path = f.path;
      wrap.dataset.project = f.project_path || f.path;

      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'mark';
      mark.title = wrap.classList.contains('is-read') ? 'Mark unread' : 'Mark read';
      mark.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (onToggleRead) onToggleRead(f);
      });

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'map-pin';
      pin.tabIndex = -1;
      pin.setAttribute('aria-pressed', 'false');
      pin.setAttribute('aria-label', 'Hold focus');
      pin.title = 'Hold focus';
      pin.addEventListener('mousedown', (ev) => ev.preventDefault());
      pin.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        togglePinned(id);
      });

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-card' + (f.kind === 'html' ? ' html' : '');
      el.dataset.id = id;
      el.dataset.root = f.root;
      el.dataset.path = f.path;
      el.dataset.project = f.project_path || f.path;
      el.title = f.root + '/' + f.path;
      const label = f.kind === 'html' ? f.dir : f.name;
      const meta = f.summary || f.path;
      el.innerHTML =
        `<span class="map-card-name">${esc(label)}</span>` +
        `<span class="map-card-meta">${esc(meta)}</span>`;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const entry = resolveEntry(el.dataset.root, el.dataset.path, el.dataset.project);
        if (entry) onOpen(entry);
      });
      wrap.appendChild(mark);
      wrap.appendChild(pin);
      wrap.appendChild(el);
      cardEls.set(id, wrap);
      return wrap;
    }

    function renderNode(node, isLane) {
      const wrap = document.createElement(isLane ? 'section' : 'div');
      wrap.className = isLane ? 'map-lane' : 'map-folder';

      const head = document.createElement('header');
      head.className = isLane ? 'map-lane-head' : 'map-folder-head';
      const title = document.createElement('span');
      title.className = isLane ? 'map-lane-title' : 'map-folder-title';
      title.textContent = node.name;
      const count = document.createElement('span');
      count.className = isLane ? 'map-lane-count' : 'map-folder-count';
      count.textContent = String(countFiles(node));
      head.appendChild(title);
      head.appendChild(count);
      wrap.appendChild(head);

      const cols = document.createElement('div');
      cols.className = 'map-cols';

      if (node.files.length) {
        const col = document.createElement('div');
        col.className = 'map-file-col';
        if (isLane && node.children.size) {
          const label = document.createElement('div');
          label.className = 'map-col-label';
          label.textContent = 'root';
          col.appendChild(label);
        }
        for (const f of node.files) col.appendChild(renderCard(f));
        cols.appendChild(col);
      }

      const names = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        cols.appendChild(renderNode(node.children.get(name), false));
      }

      wrap.appendChild(cols);
      return wrap;
    }

    for (const sec of sections) {
      board.appendChild(renderNode(treeFromSection(sec), true));
    }

    viewport.appendChild(board);
    host.appendChild(viewport);
    host.appendChild(tools);

    const adj = new Map();
    const touch = (a, b) => {
      if (!a || !b || a === b) return;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };

    const linkPairs = [];
    const seenLink = new Set();
    for (const [id, el] of cardEls) {
      const f = entryById.get(id)
        || resolveEntry(el.dataset.root, el.dataset.path, el.dataset.project);
      if (!f || f.kind !== 'md' || !f.links) continue;
      const fromProj = projectKey(f);
      for (const target of f.links) {
        const toEntry = projectIndex.get(String(target).toLowerCase());
        if (!toEntry) continue;
        const toId = fileLookupKey(toEntry.root, toEntry.path);
        if (!cardEls.has(toId)) continue;
        const a = fromProj < String(target).toLowerCase() ? id : toId;
        const b = a === id ? toId : id;
        const ek = a + '|' + b;
        if (seenLink.has(ek)) continue;
        seenLink.add(ek);
        linkPairs.push({ fromId: id, toId, seed: ek });
        touch(id, toId);
      }
    }

    function boardPoint(el) {
      const br = board.getBoundingClientRect();
      const cr = el.getBoundingClientRect();
      const z = zoom || 1;
      return {
        x: (cr.left - br.left + cr.width / 2) / z,
        y: (cr.top - br.top + cr.height / 2) / z,
      };
    }

    function drawEdges() {
      while (edgeLayer.firstChild) edgeLayer.removeChild(edgeLayer.firstChild);
      const w = Math.max(board.scrollWidth, board.clientWidth);
      const h = Math.max(board.scrollHeight, board.clientHeight);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      for (const pair of linkPairs) {
        const a = cardEls.get(pair.fromId);
        const b = cardEls.get(pair.toId);
        if (!a || !b) continue;
        const from = boardPoint(a);
        const to = boardPoint(b);
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', curvePath(from.x, from.y, to.x, to.y, pair.seed));
        p.setAttribute('class', 'map-edge-link');
        p.dataset.from = pair.fromId;
        p.dataset.to = pair.toId;
        edgeLayer.appendChild(p);
      }
    }

    function clearHighlight() {
      viewport.classList.remove('map-focusing');
      for (const el of cardEls.values()) {
        el.classList.remove('is-focus', 'is-related', 'is-dim');
      }
      for (const p of edgeLayer.querySelectorAll('path')) {
        p.classList.remove('is-focus', 'is-dim');
      }
    }

    function paintFocus(id) {
      viewport.classList.add('map-focusing');
      const related = new Set([id]);
      const hop = adj.get(id);
      if (hop) for (const r of hop) related.add(r);
      for (const [nid, el] of cardEls) {
        el.classList.remove('is-focus', 'is-related', 'is-dim');
        if (nid === id) el.classList.add('is-focus');
        else if (related.has(nid)) el.classList.add('is-related');
        else el.classList.add('is-dim');
      }
      for (const p of edgeLayer.querySelectorAll('path')) {
        const touches = p.dataset.from === id || p.dataset.to === id;
        p.classList.toggle('is-focus', touches);
        p.classList.toggle('is-dim', !touches);
      }
    }

    function syncPins() {
      for (const [nid, el] of cardEls) {
        const on = nid === pinnedId;
        el.classList.toggle('is-pinned', on);
        const btn = el.querySelector('.map-pin');
        if (!btn) continue;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('aria-label', on ? 'Clear focus' : 'Hold focus');
        btn.title = on ? 'Clear focus' : 'Hold focus';
      }
    }

    function applyHighlight() {
      syncPins();
      const id = pinnedId || hoverId;
      if (!id) clearHighlight();
      else paintFocus(id);
    }

    function togglePinned(id) {
      pinnedId = pinnedId === id ? null : id;
      applyHighlight();
    }

    function pinCard(id) {
      if (pinnedId === id) {
        applyHighlight();
        return;
      }
      pinnedId = id;
      applyHighlight();
    }

    function applyZoom(next) {
      zoom = Math.round(Math.min(1, Math.max(ZOOM_MIN, next)) * 100) / 100;
      board.style.zoom = String(zoom);
      zoomResetBtn.textContent = Math.round(zoom * 100) + '%';
      zoomOutBtn.disabled = zoom <= ZOOM_MIN;
      zoomResetBtn.disabled = zoom >= 1;
      setStoredZoom(zoom);
      requestAnimationFrame(drawEdges);
    }

    for (const [id, el] of cardEls) {
      el.addEventListener('pointerenter', () => {
        hoverId = id;
        if (!pinnedId) applyHighlight();
      });
      el.addEventListener('pointerleave', (e) => {
        const next = e.relatedTarget && e.relatedTarget.closest
          ? e.relatedTarget.closest('.map-card-wrap')
          : null;
        if (next && board.contains(next)) return;
        hoverId = null;
        if (!pinnedId) applyHighlight();
      });
      el.addEventListener('focusin', () => pinCard(id));
      const cardBtn = el.querySelector('.map-card');
      const markBtn = el.querySelector('.mark');
      if (cardBtn) cardBtn.addEventListener('focus', () => pinCard(id));
      if (markBtn) markBtn.addEventListener('focus', () => pinCard(id));
    }

    zoomOutBtn.addEventListener('click', () => applyZoom(zoom - ZOOM_STEP));
    zoomResetBtn.addEventListener('click', () => applyZoom(1));
    viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      applyZoom(zoom + dir);
    }, { passive: false });
    viewport.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !pinnedId) return;
      pinnedId = null;
      applyHighlight();
    });

    applyZoom(zoom);
    requestAnimationFrame(() => requestAnimationFrame(drawEdges));
    if (host._mapRo) host._mapRo.disconnect();
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => drawEdges())
      : null;
    if (ro) {
      ro.observe(board);
      host._mapRo = ro;
    }
  }

  function clear(host) {
    if (host && host._mapRo) {
      host._mapRo.disconnect();
      host._mapRo = null;
    }
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

  function getStoredZoom() {
    try {
      const z = parseFloat(sessionStorage.getItem(ZOOM_KEY));
      if (Number.isFinite(z)) return Math.min(1, Math.max(ZOOM_MIN, z));
    } catch (_) {}
    return 1;
  }

  function setStoredZoom(z) {
    try { sessionStorage.setItem(ZOOM_KEY, String(z)); } catch (_) {}
  }

  window.MdHtmlMap = { render, clear, getStoredView, setStoredView };
})();
