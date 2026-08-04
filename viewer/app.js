/* md-html viewer app — API-driven (serve) or static data.js (build) */
(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    meta: null,
    files: [],
    pathIndex: new Map(), // `${root}\0${path}` lowercased
    projectIndex: new Map(), // project_path lowercased -> entry
    current: null, // { root, path, name, dir, kind, project_path }
    originalText: '',
    staticMode: false,
    staticFiles: new Map(), // key -> content
  };
  let modalDepth = 0;
  let pendingHash = null;

  const fileKey = (root, path) => `${root}\0${path}`.toLowerCase();

  /** Resolve a markdown href to a project-relative path (may leave the current root). */
  function resolveProjectPath(fromProjectPath, href) {
    if (!href || /^(https?:|mailto:|tel:|ftp:|data:|javascript:)/i.test(href)) return null;
    if (href.startsWith('#')) {
      return { projectPath: fromProjectPath, anchor: href.slice(1) };
    }
    const hashAt = href.indexOf('#');
    let target = hashAt >= 0 ? href.slice(0, hashAt) : href;
    const anchor = hashAt >= 0 ? href.slice(hashAt + 1) : '';
    if (target.startsWith('/')) {
      target = target.slice(1);
    } else {
      const fromDir = fromProjectPath.includes('/')
        ? fromProjectPath.split('/').slice(0, -1).join('/')
        : '';
      target = fromDir ? fromDir + '/' + target : target;
    }
    const parts = [];
    for (const p of target.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') { parts.pop(); continue; }
      parts.push(p);
    }
    return { projectPath: parts.join('/'), anchor };
  }

  const setStatus = (msg, kind = '') => {
    const s = $('status');
    s.className = 'status ' + kind;
    s.querySelector('.msg').textContent = msg;
  };
  const toast = (msg, kind = '') => {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast ' + kind; }, 1800);
  };

  function buildHash(root, path, anchor) {
    return '#' + encodeURIComponent(root) + '/' + path + (anchor ? ':' + anchor : '');
  }
  function parseHash(hash) {
    if (!hash || hash === '#') return null;
    const raw = hash.slice(1);
    const colon = raw.indexOf(':');
    let pathPart = colon >= 0 ? raw.slice(0, colon) : raw;
    const anchor = colon >= 0 ? raw.slice(colon + 1) : '';
    const slash = pathPart.indexOf('/');
    if (slash < 0) {
      if (!/[/\\]/.test(raw) && !/\.[a-z0-9]+$/i.test(raw)) return null;
      return null;
    }
    const root = decodeURIComponent(pathPart.slice(0, slash));
    const path = pathPart.slice(slash + 1);
    return { root, path, anchor };
  }

  function groupFiles(files) {
    // Group by root label, then by dir subgroups. Root sections follow
    // [[roots]] order from config (meta.roots), not alphabetical.
    const sections = new Map();
    for (const f of files) {
      const top = f.root;
      const sub = f.dir === '(root)' ? '' : f.dir;
      if (!sections.has(top)) sections.set(top, new Map());
      const subgroups = sections.get(top);
      if (!subgroups.has(sub)) subgroups.set(sub, []);
      subgroups.get(sub).push(f);
    }
    const configured = (state.meta && state.meta.roots) || [];
    const orderedTop = [];
    for (const r of configured) {
      if (sections.has(r.label)) orderedTop.push(r.label);
    }
    for (const key of sections.keys()) {
      if (!orderedTop.includes(key)) orderedTop.push(key);
    }
    return orderedTop.map((top) => {
      const subs = sections.get(top);
      const orderedSubs = [...subs.keys()].sort((a, b) => {
        if (a === '') return -1;
        if (b === '') return 1;
        return a.localeCompare(b);
      });
      for (const k of orderedSubs) subs.get(k).sort((a, b) => a.name.localeCompare(b.name));
      const total = orderedSubs.reduce((n, k) => n + subs.get(k).length, 0);
      return {
        top,
        total,
        subgroups: orderedSubs.map((sub) => ({ sub, files: subs.get(sub) })),
      };
    });
  }

  function renderList(filterText = '') {
    const root = $('list-root');
    root.innerHTML = '';
    const filter = filterText.trim().toLowerCase();
    const visible = state.files.filter((f) =>
      !filter
      || f.path.toLowerCase().includes(filter)
      || f.name.toLowerCase().includes(filter)
      || f.root.toLowerCase().includes(filter)
      || (f.summary || '').toLowerCase().includes(filter)
    );
    if (visible.length === 0) {
      root.innerHTML = `<div class="empty">No matching <code>.md</code> files.</div>`;
      return;
    }
    const sections = groupFiles(visible);
    for (const sec of sections) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'section';
      const head = document.createElement('div');
      head.className = 'section-head';
      head.innerHTML = `<h2></h2><span class="count">${sec.total} file${sec.total === 1 ? '' : 's'}</span>`;
      head.querySelector('h2').textContent = sec.top;
      sectionEl.appendChild(head);

      for (const sg of sec.subgroups) {
        const subWrap = document.createElement('div');
        subWrap.className = 'subgroup';
        if (sg.sub) {
          const h3 = document.createElement('h3');
          h3.className = 'subgroup-title';
          h3.textContent = sg.sub + '/';
          subWrap.appendChild(h3);
        }
        const ul = document.createElement('ul');
        ul.className = 'files';
        for (const f of sg.files) {
          const li = document.createElement('li');
          li.className = 'file loaded';
          li.dataset.key = fileKey(f.root, f.path);
          const btn = document.createElement('button');
          btn.className = 'open';
          const isHtml = f.kind === 'html';
          btn.innerHTML = `
            <div class="row">
              <span class="name"></span>
              ${isHtml ? '<span class="badge html">site ↗</span>' : '<span class="badge">md</span>'}
              <span class="path"></span>
            </div>
            <div class="desc"></div>`;
          btn.querySelector('.name').textContent = isHtml ? f.dir : f.name;
          btn.querySelector('.path').textContent = f.root + '/' + f.path;
          if (f.summary) btn.querySelector('.desc').textContent = f.summary;
          if (isHtml) {
            btn.title = 'Open in a new tab';
            btn.addEventListener('click', () => openHtmlInNewTab(f));
          } else {
            btn.addEventListener('click', () => openFile(f));
          }
          li.appendChild(btn);
          ul.appendChild(li);
        }
        subWrap.appendChild(ul);
        sectionEl.appendChild(subWrap);
      }
      root.appendChild(sectionEl);
    }
  }

  function openHtmlInNewTab(entry) {
    if (state.staticMode) {
      toast('HTML sites are only available in serve mode', 'bad');
      return;
    }
    const url = `/files/${encodeURIComponent(entry.root)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) toast('Pop-up blocked — allow pop-ups for this page', 'bad');
  }

  async function readFile(entry) {
    if (state.staticMode) {
      const key = fileKey(entry.root, entry.path);
      const content = state.staticFiles.get(key);
      if (content === undefined) throw new Error('File not in static snapshot');
      return content;
    }
    const q = new URLSearchParams({ root: entry.root, path: entry.path });
    const res = await fetch('/api/file?' + q.toString());
    if (!res.ok) throw new Error(await res.text());
    return await res.text();
  }

  async function writeFile(entry, text) {
    if (!state.meta?.writable) throw new Error('Writes disabled');
    const res = await fetch('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: entry.root, path: entry.path, content: text }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
  }

  function pushOpenState(root, path, anchor) {
    modalDepth++;
    history.pushState(
      { depth: modalDepth, root, path, anchor: anchor || '' },
      '',
      buildHash(root, path, anchor)
    );
  }

  function openFile(entry, anchor = '') {
    pushOpenState(entry.root, entry.path, anchor);
    showFile(entry, anchor);
  }

  async function showFile(entry, anchor = '') {
    state.current = entry;
    $('modal-title').firstChild.textContent = entry.name;
    $('modal-sub').textContent = entry.root + '/' + entry.path;
    $('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setView('read');
    updateNavUI();
    try {
      const text = await readFile(entry);
      state.originalText = text;
      $('modal-content').innerHTML = window.md(text);
      $('editor-text').value = text;
      await renderMermaid($('modal-content'));
      if (anchor) scrollToAnchor(anchor);
      else $('modal-body').scrollTop = 0;
    } catch (err) {
      $('modal-content').innerHTML = `<p style="color:var(--bad)">Failed to read file: ${escHtml(err.message)}</p>`;
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let mermaidLoading = null;
  async function ensureMermaid() {
    if (window.mermaid) return window.mermaid;
    if (mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      s.onload = () => {
        window.mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        resolve(window.mermaid);
      };
      s.onerror = () => reject(new Error('Mermaid CDN failed to load'));
      document.head.appendChild(s);
    });
    return mermaidLoading;
  }

  async function renderMermaid(container) {
    const nodes = container.querySelectorAll('pre.mermaid');
    if (!nodes.length) return;
    try {
      const mermaid = await ensureMermaid();
      await mermaid.run({ nodes: [...nodes] });
    } catch (_) {
      // Offline / CDN failure: leave fenced text as-is
    }
  }

  function updateModalAnchorOffset() {
    const body = $('modal-body');
    const bar = document.querySelector('#modal .modal-bar');
    if (!body || !bar) return;
    const overlap = Math.max(0, bar.getBoundingClientRect().bottom - body.getBoundingClientRect().top);
    const pad = Math.max(28, Math.ceil(overlap + 16));
    body.style.setProperty('--modal-anchor-offset', pad + 'px');
  }

  function scrollToAnchor(anchorId) {
    if (!anchorId) return;
    requestAnimationFrame(() => {
      let target = null;
      try { target = $('modal-content').querySelector('#' + CSS.escape(anchorId)); } catch (_) {}
      if (!target) return;
      updateModalAnchorOffset();
      target.scrollIntoView({ block: 'start', behavior: 'auto' });
      target.classList.remove('anchor-flash');
      void target.offsetWidth;
      target.classList.add('anchor-flash');
    });
  }

  function updateNavUI() {
    $('back-btn').hidden = modalDepth <= 1;
  }

  function closeModalUI() {
    $('modal').classList.remove('open');
    document.body.style.overflow = '';
    state.current = null;
    state.originalText = '';
    $('editor-text').value = '';
    setView('read');
    modalDepth = 0;
    updateNavUI();
  }

  function closeModal() {
    if ($('editor').classList.contains('active')
        && $('editor-text').value !== state.originalText) {
      if (!confirm('You have unsaved edits. Discard?')) return;
    }
    if (modalDepth > 0) {
      history.go(-modalDepth);
    } else {
      closeModalUI();
    }
  }

  function setView(mode) {
    const editor = $('editor');
    const content = $('modal-content');
    const editBtn = $('edit-btn');
    const saveBtn = $('save-btn');
    const cancelBtn = $('cancel-btn');
    const writable = !!(state.meta && state.meta.writable && !state.staticMode);
    if (mode === 'edit') {
      if (!writable) return;
      editor.classList.add('active');
      content.classList.add('editing');
      editBtn.hidden = true;
      saveBtn.hidden = false;
      cancelBtn.hidden = false;
      setTimeout(() => $('editor-text').focus(), 30);
    } else {
      editor.classList.remove('active');
      content.classList.remove('editing');
      editBtn.hidden = !writable;
      saveBtn.hidden = true;
      cancelBtn.hidden = true;
    }
  }

  async function saveCurrent() {
    if (!state.current) return;
    const text = $('editor-text').value;
    try {
      await writeFile(state.current, text);
      state.originalText = text;
      $('modal-content').innerHTML = window.md(text);
      await renderMermaid($('modal-content'));
      toast('Saved ✓', 'ok');
      setView('read');
    } catch (err) {
      toast('Save failed: ' + err.message, 'bad');
    }
  }

  function cancelEdit() {
    if ($('editor-text').value !== state.originalText) {
      if (!confirm('Discard unsaved edits?')) return;
    }
    $('editor-text').value = state.originalText;
    setView('read');
  }

  async function loadFromApi() {
    setStatus('Loading…');
    const [metaRes, treeRes] = await Promise.all([
      fetch('/api/meta'),
      fetch('/api/tree'),
    ]);
    if (!metaRes.ok || !treeRes.ok) throw new Error('Failed to load document index');
    state.meta = await metaRes.json();
    const tree = await treeRes.json();
    applyMetaAndTree(state.meta, tree.files || []);
  }

  function loadFromStatic() {
    const data = window.__MD_HTML_DATA__;
    if (!data) throw new Error('No static data');
    state.staticMode = true;
    state.meta = data.meta;
    for (const f of data.files || []) {
      state.staticFiles.set(fileKey(f.root, f.path), f.content);
    }
    applyMetaAndTree(data.meta, (data.tree && data.tree.files) || []);
  }

  function applyMetaAndTree(meta, files) {
    state.meta = meta;
    state.files = files;
    state.pathIndex = new Map(files.map((f) => [fileKey(f.root, f.path), f]));
    state.projectIndex = new Map(
      files.map((f) => [(f.project_path || f.path).toLowerCase(), f])
    );

    document.title = meta.title + ' — Documents';
    $('hero-title').textContent = meta.title;
    $('hero-lead').textContent = meta.description;

    $('empty').hidden = true;
    $('search').hidden = false;
    $('refresh').hidden = state.staticMode;

    const mdCount = files.filter((f) => f.kind === 'md').length;
    const htmlCount = files.filter((f) => f.kind === 'html').length;
    const parts = [`${mdCount} markdown`];
    if (htmlCount) parts.push(`${htmlCount} site${htmlCount === 1 ? '' : 's'}`);
    setStatus(`${parts.join(' · ')} across ${meta.roots?.length || 0} root(s)`, 'ok');

    setView('read');
    renderList($('search').value);
    consumePendingHash();
  }

  function consumePendingHash() {
    if (!pendingHash) return;
    const parsed = parseHash(pendingHash);
    pendingHash = null;
    if (!parsed) return;
    const entry = state.pathIndex.get(fileKey(parsed.root, parsed.path));
    if (entry && entry.kind === 'md') openFile(entry, parsed.anchor);
  }

  // Wire UI
  $('refresh').addEventListener('click', () => {
    loadFromApi().catch((e) => setStatus(e.message, 'bad'));
  });
  $('search').addEventListener('input', (e) => renderList(e.target.value));
  $('close-btn').addEventListener('click', closeModal);
  $('back-btn').addEventListener('click', () => history.back());
  $('edit-btn').addEventListener('click', () => setView('edit'));
  $('save-btn').addEventListener('click', saveCurrent);
  $('cancel-btn').addEventListener('click', cancelEdit);
  $('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  $('modal-content').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || !$('modal-content').contains(a)) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (/^(https?:|mailto:|tel:|ftp:|data:)/i.test(href)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;

    const fromProj = state.current?.project_path || state.current?.path || '';
    const resolved = resolveProjectPath(fromProj, href);
    if (!resolved) return;

    e.preventDefault();

    if (resolved.projectPath === fromProj && resolved.anchor) {
      scrollToAnchor(resolved.anchor);
      if (state.current && modalDepth > 0) {
        history.replaceState(
          { depth: modalDepth, root: state.current.root, path: state.current.path, anchor: resolved.anchor },
          '',
          buildHash(state.current.root, state.current.path, resolved.anchor)
        );
      }
      return;
    }

    const target = state.projectIndex.get(resolved.projectPath.toLowerCase());
    if (!target) {
      a.classList.add('broken');
      a.title = `Not in index: ${resolved.projectPath}`;
      toast(`Not found: ${resolved.projectPath}`, 'bad');
      return;
    }
    if (target.kind === 'html') {
      openHtmlInNewTab(target);
      return;
    }
    const editing = $('editor').classList.contains('active');
    if (editing && $('editor-text').value !== state.originalText) {
      if (!confirm('Discard unsaved edits?')) return;
    }
    openFile(target, resolved.anchor);
  });

  document.addEventListener('keydown', (e) => {
    if (!$('modal').classList.contains('open')) return;
    const editing = $('editor').classList.contains('active');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editing) cancelEdit(); else closeModal();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      if (editing) {
        e.preventDefault();
        saveCurrent();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e' && !editing) {
      e.preventDefault();
      setView('edit');
    }
  });

  if (window.location.hash) pendingHash = window.location.hash;
  history.replaceState({ depth: 0 }, '', window.location.pathname + window.location.search);

  window.addEventListener('popstate', (e) => {
    const s = e.state;
    const editing = $('editor').classList.contains('active');
    if (editing && $('editor-text').value !== state.originalText) {
      if (!confirm('Discard unsaved edits?')) {
        const cur = state.current;
        if (cur) {
          history.pushState(
            { depth: modalDepth, root: cur.root, path: cur.path, anchor: '' },
            '',
            buildHash(cur.root, cur.path, '')
          );
        }
        return;
      }
    }
    if (s && s.path && s.root) {
      modalDepth = s.depth || 1;
      const entry = state.pathIndex.get(fileKey(s.root, s.path));
      if (entry) showFile(entry, s.anchor || '');
      else closeModalUI();
    } else {
      closeModalUI();
    }
  });

  // Boot
  (async () => {
    try {
      if (window.__MD_HTML_DATA__) {
        loadFromStatic();
      } else {
        await loadFromApi();
      }
    } catch (err) {
      setStatus(err.message || String(err), 'bad');
      $('empty').hidden = false;
      $('empty').innerHTML = `<p><strong>Failed to load documents.</strong></p>
        <p style="margin:0;">Run <code>md-html serve</code> from a project with <code>md-html.toml</code>.</p>`;
    }
  })();
})();
