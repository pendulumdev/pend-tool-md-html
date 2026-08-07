/* md-html markdown renderer (zero npm deps) */
(function (global) {

  // ============================================================
  //  Tiny markdown renderer: headings, lists, tables, code,
  //  blockquotes, bold/italic, inline code, links (inline +
  //  CommonMark reference-style), images, hr.
  //  Self-contained - no network dependencies.
  // ============================================================
  const slugify = (s) => s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    // After stripping emoji / punctuation, a leading space is common (e.g.
    // "🚧 1. Foo" → " 1 foo"); trim again so \s→- does not emit a leading "-".
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  // External links only: fragment (#...) and relative .md/.html links must stay
  // in the same tab so the modal click handler can scroll or open siblings.
  // (GitHub uses plain #anchors; this viewer also supports #path:anchor in the
  // location bar for deep links after a directory is loaded.)
  function mdLinkExtraAttrs(url) {
    if (/^(https?:|mailto:|tel:|ftp:|data:|javascript:)/i.test(url)) return ' target="_blank" rel="noopener"';
    if (/^\/\//.test(url)) return ' target="_blank" rel="noopener"';
    return '';
  }

  // GFM table rows: `\|` is a literal pipe (including inside code spans).
  // A naive String#split('|') creates extra columns for command lists like
  // `corten db migrate\|status\|reset`.
  function splitTableRow(line) {
    const cells = [];
    let cur = '';
    let i = 0;
    const s = String(line);
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
    if (i < s.length && s[i] === '|') i++;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') {
        cur += '|';
        i += 2;
        continue;
      }
      if (ch === '|') {
        cells.push(cur.trim());
        cur = '';
        i++;
        continue;
      }
      cur += ch;
      i++;
    }
    // A closing fence pipe leaves an empty trailing segment - drop it.
    // Content after the last real cell (no fence) is kept.
    if (cur.trim() !== '' || !/\|\s*$/.test(s)) cells.push(cur.trim());
    return cells;
  }

  // CommonMark link reference definitions:
  //   [label]: destination "optional title"
  // Labels are case-insensitive; first definition wins. Used by README
  // shield rows: [![Status][Status-shield]][Status-url]
  const normRefLabel = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const LINK_REF_DEF_RE =
    /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;

  function isLinkRefDef(line) {
    return LINK_REF_DEF_RE.test(line);
  }

  function extractLinkRefs(src) {
    const refs = new Map();
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let fence = null;
    for (const line of lines) {
      const open = line.match(/^(\s*)(```|~~~)/);
      if (!fence && open) {
        fence = open[2];
        kept.push(line);
        continue;
      }
      if (fence) {
        kept.push(line);
        if (new RegExp('^\\s*' + fence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$').test(line)) {
          fence = null;
        }
        continue;
      }
      const m = line.match(LINK_REF_DEF_RE);
      if (m) {
        const label = normRefLabel(m[1]);
        if (label && !refs.has(label)) {
          refs.set(label, {
            url: m[2],
            title: m[3] || m[4] || m[5] || '',
          });
        }
        continue;
      }
      kept.push(line);
    }
    return { refs, text: kept.join('\n') };
  }

  function imgClassForUrl(url) {
    // shields.io / for-the-badge rows should stay compact, not full-bleed photos.
    if (/shields\.io\//i.test(url) || /[?&]style=for-the-badge\b/i.test(url)) {
      return ' class="md-html-badge"';
    }
    return '';
  }

  const md = (() => {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Emphasis / strike on already-escaped text (no raw <>& left).
    const emphasis = (s) => {
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
      // GFM intra-word rule: `_` only opens/closes emphasis when not surrounded
      // by word characters on both sides. Without this `FOO_BAR_BAZ` becomes
      // `FOO<em>BAR</em>BAZ`.
      s = s.replace(/(^|[^A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      return s;
    };

    // Link/image labels may already contain \0N\0 masks (e.g. [`path`](url)).
    // Expanding those into HTML and then calling inline() would esc() the tags
    // or, worse, recurse with a fresh empty mask table and print "undefined".
    // Instead: expand masks, protect HTML, esc+emphasis on text, restore HTML.
    const labeledHtml = (txt, masks) => {
      const expanded = String(txt).replace(/\u0000(\d+)\u0000/g, (_, i) => {
        const html = masks[+i];
        return html === undefined ? '' : html;
      });
      const htmlBits = [];
      const protectedText = expanded.replace(/<[^>]+>/g, (tag) => {
        htmlBits.push(tag);
        return `\u0001${htmlBits.length - 1}\u0001`;
      });
      let body = emphasis(esc(protectedText));
      body = body.replace(/\u0001(\d+)\u0001/g, (_, i) => htmlBits[+i] ?? '');
      return body;
    };

    return (src) => {
      const { refs, text } = extractLinkRefs(src);
      const lookup = (label) => refs.get(normRefLabel(label));

      const inline = (s) => {
        // Mask code, images, and links to fully-formed HTML *before* running
        // emphasis. This way intra-word underscores in URLs (and inside link
        // text after recursion) can never be misinterpreted as italic markers.
        const masks = [];
        const mask = (html) => { masks.push(html); return `\u0000${masks.length - 1}\u0000`; };

        const imgTag = (alt, url, title) => {
          const t = title ? ` title="${esc(title)}"` : '';
          return `<img${imgClassForUrl(url)} src="${esc(url)}" alt="${esc(alt)}"${t}>`;
        };
        const aTag = (txt, url, title) => {
          const t = title ? ` title="${esc(title)}"` : '';
          return `<a href="${esc(url)}"${mdLinkExtraAttrs(url)}${t}>${labeledHtml(txt, masks)}</a>`;
        };

        s = s.replace(/`([^`]+?)`/g, (_, c) => mask(`<code>${esc(c)}</code>`));

        // Inline image, then reference image (![alt][label] / ![alt][])
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
              (_, alt, url, t) => mask(imgTag(alt, url, t || '')));
        s = s.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (full, alt, label) => {
          const ref = lookup(label || alt);
          return ref ? mask(imgTag(alt, ref.url, ref.title)) : full;
        });

        // Inline link, then full/collapsed reference link ([text][label] / [text][])
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
              (_, txt, url, t) => mask(aTag(txt, url, t || '')));
        s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (full, txt, label) => {
          const ref = lookup(label || txt);
          return ref ? mask(aTag(txt, ref.url, ref.title)) : full;
        });

        // Shortcut reference [label] when defined (CommonMark); skip if followed
        // by '(' or '[' (inline / full reference forms already handled).
        s = s.replace(/\[([^\]]+)\](?![\(\[])/g, (full, txt) => {
          if (txt.indexOf('\u0000') >= 0) return full;
          const ref = lookup(txt);
          return ref ? mask(aTag(txt, ref.url, ref.title)) : full;
        });

        s = esc(s);
        s = emphasis(s);
        s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => masks[+i] ?? '');
        return s;
      };

      const parseTable = (lines, i) => {
        // detect: header | sep | rows
        if (i + 1 >= lines.length) return null;
        const head = lines[i], sep = lines[i + 1];
        if (!/\|/.test(head) || !/^\s*\|?\s*:?-{2,}/.test(sep)) return null;
        const heads = splitTableRow(head);
        const normHead = (s) => s.replace(/\*+/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const statusColIdx = heads.findIndex((h) => normHead(h) === 'status');
        const binariesColIdx = heads.findIndex((h) => normHead(h) === 'binaries');
        const wrapCell = (k, inner) => {
          let out = inner;
          if (statusColIdx >= 0 && k === statusColIdx) {
            out = `<span class="md-html-status">${out}</span>`;
          }
          if (binariesColIdx >= 0 && k === binariesColIdx) {
            out = `<span class="md-html-nowrap">${out}</span>`;
          }
          return out;
        };
        const aligns = splitTableRow(sep).map((c) => {
          const l = /^:/.test(c), r = /:$/.test(c);
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        const rows = [];
        let j = i + 2;
        while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') {
          rows.push(splitTableRow(lines[j]));
          j++;
        }
        let html = '<table><thead><tr>';
        heads.forEach((h, k) => {
          const inner = inline(h);
          html += `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${wrapCell(k, inner)}</th>`;
        });
        html += '</tr></thead><tbody>';
        rows.forEach((row) => {
          html += '<tr>';
          // GFM: pad short rows; ignore cells beyond the header width.
          for (let k = 0; k < heads.length; k++) {
            const inner = inline(row[k] ?? '');
            html += `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${wrapCell(k, inner)}</td>`;
          }
          html += '</tr>';
        });
        html += '</tbody></table>';
        return { html, next: j };
      };

      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      let out = '';
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        // fenced code
        const fence = line.match(/^(\s*)(```|~~~)(\w*)\s*$/);
        if (fence) {
          const close = fence[2];
          const lang = fence[3];
          let body = '';
          i++;
          while (i < lines.length && !new RegExp('^\\s*' + close + '\\s*$').test(lines[i])) {
            body += lines[i] + '\n';
            i++;
          }
          i++;
          if (lang === 'mermaid') {
            out += `<pre class="mermaid">${esc(body.trimEnd())}</pre>`;
          } else {
            out += `<pre><code${lang ? ` class="lang-${lang}"` : ''}>${esc(body)}</code></pre>`;
          }
          continue;
        }

        // hr
        if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { out += '<hr>'; i++; continue; }

        // headings (with anchor id for in-doc navigation)
        const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (h) {
          const lvl = h[1].length;
          const id = slugify(h[2]);
          out += `<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`;
          i++; continue;
        }

        // tables
        if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
          const t = parseTable(lines, i);
          if (t) { out += t.html; i = t.next; continue; }
        }

        // blockquote (consume contiguous '>' lines)
        if (/^\s*>/.test(line)) {
          let body = '';
          while (i < lines.length && /^\s*>/.test(lines[i])) {
            body += lines[i].replace(/^\s*>\s?/, '') + '\n';
            i++;
          }
          out += `<blockquote>${md(body)}</blockquote>`;
          continue;
        }

        // lists: flat ul, or ol with optional nested ul (deeper indent + - * +)
        const liMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (liMatch) {
          const baseIndent = liMatch[1].length;
          const topOrdered = /\d+\./.test(liMatch[2]);
          const tag = topOrdered ? 'ol' : 'ul';
          let html = `<${tag}>`;
          while (i < lines.length) {
            const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
            if (!m || m[1].length < baseIndent) break;

            if (topOrdered && /\d+\./.test(m[2]) && m[1].length === baseIndent) {
              let item = m[3];
              i++;
              while (i < lines.length
                && lines[i].trim() !== ''
                && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])
                && !/^#{1,6}\s/.test(lines[i])
                && !/^\s*(```|~~~)/.test(lines[i])) {
                item += '\n' + lines[i].replace(/^\s+/, ' ');
                i++;
              }
              let nested = '';
              while (i < lines.length && lines[i].trim() === '') i++;
              while (i < lines.length) {
                const nm = lines[i].match(/^(\s*)([-*+])\s+(.*)$/);
                if (!nm || nm[1].length <= baseIndent) break;
                let sub = nm[3];
                i++;
                while (i < lines.length
                  && lines[i].trim() !== ''
                  && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])
                  && !/^#{1,6}\s/.test(lines[i])
                  && !/^\s*(```|~~~)/.test(lines[i])) {
                  sub += '\n' + lines[i].replace(/^\s+/, ' ');
                  i++;
                }
                if (nested === '') nested = '<ul>';
                nested += `<li>${inline(sub)}</li>`;
              }
              if (nested) nested += '</ul>';
              html += `<li>${inline(item)}${nested}</li>`;
              continue;
            }

            if (!topOrdered && m[1].length === baseIndent && /[-*+]/.test(m[2])) {
              let item = m[3];
              i++;
              while (i < lines.length
                && lines[i].trim() !== ''
                && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])
                && !/^#{1,6}\s/.test(lines[i])
                && !/^\s*(```|~~~)/.test(lines[i])) {
                item += '\n' + lines[i].replace(/^\s+/, ' ');
                i++;
              }
              html += `<li>${inline(item)}</li>`;
              continue;
            }

            break;
          }
          html += `</${tag}>`;
          out += html;
          continue;
        }

        // blank line
        if (line.trim() === '') { i++; continue; }

        // paragraph (consume contiguous non-empty, non-block-starting lines)
        let para = line;
        i++;
        while (i < lines.length
          && lines[i].trim() !== ''
          && !/^#{1,6}\s/.test(lines[i])
          && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
          && !/^\s*>/.test(lines[i])
          && !/^\s*(```|~~~)/.test(lines[i])
          && !/^\s*([-*_])\s*\1\s*\1/.test(lines[i])) {
          para += '\n' + lines[i];
          i++;
        }
        out += `<p>${inline(para)}</p>`;
      }
      return out;
    };
  })();

  // ============================================================
  //  Summary extraction
  //
  //  Pulls a short blurb out of a markdown file by skipping the
  //  H1, any leading metadata table, horizontal rules, and other
  //  headings, and returning the first useful blockquote or
  //  paragraph. For html files we read <title> / meta description.
  // ============================================================
  const cleanInline = (s) => s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  function extractMdSummary(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    const skipBlank = () => { while (i < lines.length && lines[i].trim() === '') i++; };

    skipBlank();
    // Optional YAML frontmatter
    if (lines[i] && lines[i].trim() === '---') {
      i++;
      while (i < lines.length && lines[i].trim() !== '---') i++;
      i++;
    }
    skipBlank();
    // Skip the H1 (one heading line) if present
    if (lines[i] && /^#\s/.test(lines[i])) i++;
    skipBlank();

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === '') { i++; continue; }
      if (/^[-*_]{3,}\s*$/.test(trimmed)) { i++; continue; }   // hr
      if (/^#{1,6}\s/.test(trimmed)) { i++; continue; }         // heading
      if (isLinkRefDef(line)) { i++; continue; }                 // [label]: url

      // Badge / shield rows (reference-style images) - not a summary.
      if (/^\[?!\[[^\]]+\]\[[^\]]+\]/.test(trimmed)) {
        while (i < lines.length && lines[i].trim() !== '' && /\[?!\[[^\]]+\]\[/.test(lines[i])) i++;
        continue;
      }

      // Markdown table: skip the block, but try to harvest a useful
      // row first (e.g. a "| Kind | … |" or "| Description | … |"
      // row in a metadata table).
      if (trimmed.includes('|') &&
          ((trimmed.startsWith('|')) ||
           (i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])))) {
        let candidate = '';
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          const cells = splitTableRow(lines[i]);
          if (cells.length >= 2 && /^(kind|description|summary|purpose|scope|about|intent)$/i.test(cells[0])) {
            candidate = cells.slice(1).join(' - ');
          }
          i++;
        }
        if (candidate) {
          const cleaned = cleanInline(candidate);
          if (cleaned.length >= 12) return cleaned;
        }
        continue;
      }

      // Skip list blocks (bullets and numbered) - they're rarely a
      // good description, and "Related documents" lists in particular
      // show up before the meaty content in many spec files.
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        while (i < lines.length && lines[i].trim() !== '') i++;
        continue;
      }

      // Blockquote: collect contiguous quote lines
      if (trimmed.startsWith('>')) {
        let body = '';
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          body += ' ' + lines[i].replace(/^\s*>\s?/, '');
          i++;
        }
        const cleaned = cleanInline(body);
        if (cleaned.length >= 12) return cleaned;
        continue;
      }

      // Bold-label intro like "**Related documents**" - skip and keep looking.
      if (/^\*\*[^*]+\*\*\s*:?\s*$/.test(trimmed)) { i++; continue; }

      // Plain paragraph: collect contiguous non-block lines
      let para = line;
      i++;
      while (i < lines.length
        && lines[i].trim() !== ''
        && !/^#{1,6}\s/.test(lines[i])
        && !/^\s*>/.test(lines[i])
        && !/^[-*_]{3,}\s*$/.test(lines[i].trim())
        && !lines[i].includes('|')
        && !isLinkRefDef(lines[i])) {
        para += ' ' + lines[i];
        i++;
      }
      const cleaned = cleanInline(para);
      if (cleaned.length >= 12) return cleaned;
    }
    return '';
  }

  function extractHtmlSummary(text) {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) return titleMatch[1].replace(/\s+/g, ' ').trim();
    const meta = text.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i);
    if (meta) return meta[1].trim();
    return '';
  }


  global.slugify = slugify;
  global.mdLinkExtraAttrs = mdLinkExtraAttrs;
  global.splitTableRow = splitTableRow;
  global.extractLinkRefs = extractLinkRefs;
  global.md = md;
  global.cleanInline = cleanInline;
  global.extractMdSummary = extractMdSummary;
  global.extractHtmlSummary = extractHtmlSummary;
})(window);
