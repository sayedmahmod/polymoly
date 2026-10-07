// @ts-check
/* PolyMoly plan panel: the wave graph, the model each tier runs on, and the plan itself. */
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{lang: string, dir: string, locale: string, strings: Record<string, string>}} */
  const I18N = /** @type {any} */ (window).PM_I18N ?? { lang: 'en', dir: 'ltr', locale: 'en-US', strings: {} };
  function t(key, vars) {
    const text = I18N.strings[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text;
  }

  const TIERS = ['hard', 'mid', 'low'];
  const root = /** @type {HTMLElement} */ (document.getElementById('root'));

  /** @type {any} */
  let data = null;
  /** Task ids the user picked for a partial run; empty means the whole plan. */
  let selection = new Set();
  /** The task whose isolated run trace is open in the inspector. */
  let inspectedTaskId = '';

  function post(message) {
    vscode.postMessage(message);
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  /** Small markdown subset: fenced code, inline code, bold, headings, bullets. */
  function renderMarkdown(text) {
    const parts = String(text).split(/```/);
    let html = '';
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const newline = part.indexOf('\n');
        const head = newline === -1 ? part : part.slice(0, newline).trim();
        const body = newline === -1 ? part : part.slice(newline + 1);
        // The machine-readable block is what the panel already draws; do not print it twice.
        if (head === 'polyplan') {
          return;
        }
        html += `<pre><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`;
        return;
      }
      let inList = false;
      let buffer = '';
      const closeList = () => {
        if (inList) {
          buffer += '</ul>';
          inList = false;
        }
      };
      for (const raw of escapeHtml(part).split('\n')) {
        const heading = raw.match(/^(#{1,4})\s+(.*)$/);
        const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
        if (heading) {
          closeList();
          const level = heading[1].length;
          const anchor = anchorOf(heading[2]);
          buffer += `<h${level}${anchor ? ` id="task-${anchor}"` : ''}>${inline(heading[2])}</h${level}>`;
        } else if (bullet) {
          if (!inList) {
            buffer += '<ul>';
            inList = true;
          }
          buffer += `<li>${inline(bullet[1])}</li>`;
        } else if (!raw.trim()) {
          closeList();
        } else {
          closeList();
          buffer += `<p>${inline(raw)}</p>`;
        }
      }
      closeList();
      html += buffer;
    });
    return html;
  }

  /** "T3 — title" headings get an id, so a graph node can jump to its task. */
  function anchorOf(heading) {
    const match = heading.match(/^(\w+)\s*(?:—|-|–)/);
    return match ? match[1] : '';
  }

  function inline(text) {
    return text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function taskById(id) {
    return (data?.plan?.tasks ?? []).find((task) => task.id === id);
  }

  function runOf(id) {
    return data?.run?.tasks?.[id];
  }

  function statusOf(id) {
    return runOf(id)?.status ?? 'pending';
  }

  function modelLabel(assignment) {
    if (!assignment) {
      return t('plan.noModel');
    }
    const provider = (data?.providers ?? []).find((p) => p.id === assignment.providerId);
    const model = provider?.models?.find((m) => m.id === (assignment.model ?? provider.defaultModel));
    return model?.label ?? assignment.model ?? provider?.label ?? assignment.providerId;
  }

  /** Every enabled model, grouped by provider, as one <select>. */
  function modelSelect(tier, assignment) {
    const groups = (data?.providers ?? [])
      .map((provider) => {
        const options = (provider.models ?? [])
          .map((model) => {
            const value = `${provider.id}::${model.id}`;
            const selected = assignment && assignment.providerId === provider.id && (assignment.model ?? provider.defaultModel) === model.id;
            return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(model.label)}</option>`;
          })
          .join('');
        const note = provider.kind === 'http' ? ` · ${t('plan.noFiles')}` : '';
        return options ? `<optgroup label="${escapeHtml(provider.label + note)}">${options}</optgroup>` : '';
      })
      .join('');
    return `<select class="plan-select" data-tier="${tier}">${groups}</select>`;
  }

  function effortSelect(tier, assignment) {
    const provider = (data?.providers ?? []).find((p) => p.id === assignment?.providerId);
    const model = provider?.models?.find((m) => m.id === (assignment?.model ?? provider?.defaultModel));
    const levels = model?.efforts ?? [];
    if (!levels.length) {
      return '';
    }
    const current = assignment?.effort && levels.includes(assignment.effort) ? assignment.effort : levels[levels.length - 1];
    return `<select class="plan-select effort" data-effort-tier="${tier}">${levels
      .map((level) => `<option value="${escapeHtml(level)}"${level === current ? ' selected' : ''}>${escapeHtml(t(`effort.${level}`))}</option>`)
      .join('')}</select>`;
  }

  /** One card per tier: which model runs it, and how many tasks it owns. */
  function renderTiers() {
    const counts = {};
    for (const task of data.plan.tasks ?? []) {
      counts[task.tier] = (counts[task.tier] ?? 0) + 1;
    }
    return `<div class="tier-row">${TIERS.map((tier) => {
      const assignment = data.assignments?.[tier];
      const provider = (data.providers ?? []).find((p) => p.id === assignment?.providerId);
      const warn = provider && provider.kind === 'http' ? `<div class="tier-warn">${escapeHtml(t('plan.httpWarn'))}</div>` : '';
      return `<div class="tier-card ${tier}">
        <div class="tier-head"><span class="tier-badge ${tier}">${escapeHtml(t(`tier.${tier}`))}</span>
          <span class="tier-count">${escapeHtml(t('plan.taskCount', { count: counts[tier] ?? 0 }))}</span></div>
        <div class="tier-desc">${escapeHtml(t(`tier.${tier}.hint`))}</div>
        <div class="tier-controls">${modelSelect(tier, assignment)}${effortSelect(tier, assignment)}</div>
        ${warn}
      </div>`;
    }).join('')}</div>`;
  }

  /** The waves as columns: everything in one column runs at the same time. */
  function renderGraph() {
    const waves = data.waves ?? [];
    const columns = waves
      .map((ids, index) => {
        const nodes = ids
          .map((id) => {
            const task = taskById(id);
            if (!task) {
              return '';
            }
            const status = statusOf(id);
            const deps = task.dependsOn.length ? `<div class="node-deps">← ${escapeHtml(task.dependsOn.join(', '))}</div>` : '';
            const picked = selection.has(id) ? ' picked' : '';
            return `<div class="node ${task.tier} ${status}${picked}" data-node="${escapeHtml(id)}" title="${escapeHtml(task.goal)}">
              <div class="node-head"><span class="node-id">${escapeHtml(id)}</span><span class="node-status ${status}"></span></div>
              <div class="node-title">${escapeHtml(task.title)}</div>
              ${deps}
              <div class="node-foot"><span class="tier-badge ${task.tier}">${escapeHtml(t(`tier.${task.tier}`))}</span>
                <button class="node-chat" data-chat-task="${escapeHtml(id)}" title="${escapeHtml(t('plan.viewChat'))}">${escapeHtml(t('plan.viewChat'))}</button>
                <button class="node-run" data-run-task="${escapeHtml(id)}" title="${escapeHtml(t('plan.runTask'))}">▶</button></div>
            </div>`;
          })
          .join('');
        const kind = ids.length > 1 ? t('plan.parallel') : t('plan.sequential');
        return `<div class="wave">
          <div class="wave-head">${escapeHtml(t('plan.wave', { number: index + 1 }))} <span class="wave-kind">${escapeHtml(kind)}</span></div>
          <div class="wave-nodes">${nodes}</div>
        </div>`;
      })
      .join('');
    return `<div class="graph-wrap"><svg class="graph-edges"></svg><div class="graph">${columns}</div></div>`;
  }

  /** Draws the dependency arrows once the nodes have a position. */
  function drawEdges() {
    const wrap = document.querySelector('.graph-wrap');
    const svg = document.querySelector('.graph-edges');
    if (!wrap || !svg) {
      return;
    }
    const base = wrap.getBoundingClientRect();
    svg.setAttribute('width', String(wrap.scrollWidth));
    svg.setAttribute('height', String(wrap.scrollHeight));
    svg.setAttribute('viewBox', `0 0 ${wrap.scrollWidth} ${wrap.scrollHeight}`);
    const rtl = I18N.dir === 'rtl';
    const paths = [];
    for (const task of data.plan.tasks ?? []) {
      const to = document.querySelector(`.node[data-node="${task.id}"]`);
      if (!to) {
        continue;
      }
      for (const dep of task.dependsOn) {
        const from = document.querySelector(`.node[data-node="${dep}"]`);
        if (!from) {
          continue;
        }
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = (rtl ? a.left : a.right) - base.left + wrap.scrollLeft;
        const y1 = a.top + a.height / 2 - base.top + wrap.scrollTop;
        const x2 = (rtl ? b.right : b.left) - base.left + wrap.scrollLeft;
        const y2 = b.top + b.height / 2 - base.top + wrap.scrollTop;
        const mid = (x1 + x2) / 2;
        paths.push(`<path d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" />`);
      }
    }
    svg.innerHTML = paths.join('');
  }

  function renderStatus() {
    const tasks = Object.values(data.run?.tasks ?? {});
    if (!tasks.length) {
      return '';
    }
    const count = (status) => tasks.filter((task) => task.status === status).length;
    const parts = [
      t('plan.statDone', { count: count('done') }),
      t('plan.statRunning', { count: count('running') }),
      t('plan.statFailed', { count: count('failed') + count('blocked') })
    ];
    return `<div class="run-status">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>`;
  }

  function renderWarnings() {
    const notes = [];
    if ((data.broken ?? []).length) {
      notes.push(t('plan.brokenDeps', { ids: data.broken.join(', ') }));
    }
    if (!(data.plan.tasks ?? []).length) {
      notes.push(t('plan.noTasks'));
    }
    return notes.map((note) => `<div class="plan-warning">${escapeHtml(note)}</div>`).join('');
  }

  function traceGroups(trace) {
    const groups = [];
    for (const event of trace ?? []) {
      const previous = groups[groups.length - 1];
      if (previous && previous.type === event.type && (event.type === 'thinking' || event.type === 'text')) {
        previous.text = `${previous.text ?? ''}${event.text ?? ''}`;
      } else {
        groups.push({ ...event });
      }
    }
    return groups;
  }

  function renderTrace(event) {
    const label = {
      user: t('plan.traceUser'), thinking: t('plan.traceThinking'), text: t('plan.traceText'),
      tool_start: t('plan.traceTool'), tool_end: t('plan.traceToolResult'), notice: t('plan.traceNotice'),
      error: t('plan.traceError'), usage: t('plan.traceUsage')
    }[event.type] ?? event.type;
    const content = [event.text, event.input, event.output].filter(Boolean).join(event.input || event.output ? '\n\n' : '');
    const summary = event.name ? `${label} · ${event.name}` : label;
    return `<details class="trace-event ${event.type}"${event.type === 'error' ? ' open' : ''}>
      <summary>${escapeHtml(summary)}</summary>${content ? `<pre>${escapeHtml(content)}</pre>` : ''}
    </details>`;
  }

  function renderInspector() {
    const task = taskById(inspectedTaskId);
    if (!task) return '';
    const run = runOf(task.id);
    const trace = traceGroups(run?.trace);
    const hasSession = Boolean(run?.sessionId);
    const status = run?.status ?? 'pending';
    return `<aside class="task-inspector" aria-label="${escapeHtml(t('plan.taskChat'))}">
      <div class="inspector-head"><div><div class="inspector-kicker">${escapeHtml(task.id)} · ${escapeHtml(t(`tier.${task.tier}`))}</div><strong>${escapeHtml(task.title)}</strong></div>
        <button class="btn ghost inspector-close" data-close-inspector="true">×</button></div>
      <div class="inspector-status"><span class="node-status ${escapeHtml(status)}"></span>${escapeHtml(status)}</div>
      <div class="inspector-goal">${escapeHtml(task.goal)}</div>
      <div class="trace-list">${trace.length ? trace.map(renderTrace).join('') : `<div class="inspector-empty">${escapeHtml(t('plan.traceEmpty'))}</div>`}</div>
      <form class="task-chat-form" data-task-chat="${escapeHtml(task.id)}">
        <textarea class="task-chat-input" placeholder="${escapeHtml(hasSession ? t('plan.taskChatPlaceholder') : t('plan.taskChatNoSession'))}" ${status === 'running' ? 'disabled' : ''}></textarea>
        <button class="btn primary" type="submit" ${status === 'running' ? 'disabled' : ''}>${escapeHtml(t('plan.taskChatSend'))}</button>
      </form>
    </aside>`;
  }

  function render() {
    if (!data?.plan) {
      root.innerHTML = `<div class="plan-empty">${escapeHtml(t('plan.none'))}</div>`;
      return;
    }
    const scroll = document.querySelector('.plan-scroll')?.scrollTop ?? 0;
    const running = data.running;
    const author = data.plan.authorModel ? t('plan.writtenBy', { model: data.plan.authorModel }) : '';
    const runLabel = selection.size ? t('plan.runSelected', { count: selection.size }) : t('plan.run');

    root.innerHTML = `
<div class="plan-app">
  <div class="plan-header">
    <div class="plan-heading">
      <div class="plan-title">${escapeHtml(data.plan.title)}</div>
      <div class="plan-sub">${escapeHtml([author, data.plan.path ?? ''].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="plan-actions">
      <button class="btn" data-act="markdown">${escapeHtml(t('plan.openMarkdown'))}</button>
      <button class="btn" data-act="edit">${escapeHtml(t('plan.edit'))}</button>
      <button class="btn" data-act="reload">${escapeHtml(t('plan.reload'))}</button>
      ${running
        ? `<button class="btn danger" data-act="cancel">${escapeHtml(t('plan.stop'))}</button>`
        : `<button class="btn primary" data-act="run">${escapeHtml(runLabel)}</button>`}
    </div>
  </div>
  ${renderTiers()}
  ${renderWarnings()}
  ${renderStatus()}
  <div class="plan-workspace${inspectedTaskId ? ' inspector-open' : ''}">
    <div class="plan-scroll">
      ${renderGraph()}
      <div class="plan-doc">${renderMarkdown(data.markdown ?? '')}</div>
    </div>
    ${renderInspector()}
  </div>
</div>`;

    wire();
    const scroller = document.querySelector('.plan-scroll');
    if (scroller) {
      scroller.scrollTop = scroll;
    }
    requestAnimationFrame(drawEdges);
  }

  function wire() {
    document.querySelectorAll('[data-act]').forEach((element) => {
      element.addEventListener('click', () => {
        const act = element.getAttribute('data-act');
        if (act === 'run') {
          post({ type: 'run', only: selection.size ? [...selection] : undefined });
        } else if (act === 'cancel') {
          post({ type: 'cancel' });
        } else if (act === 'markdown') {
          post({ type: 'openMarkdown' });
        } else if (act === 'edit') {
          post({ type: 'editMarkdown' });
        } else if (act === 'reload') {
          post({ type: 'reload' });
        }
      });
    });

    document.querySelectorAll('.plan-select[data-tier]').forEach((element) => {
      element.addEventListener('change', () => {
        const [providerId, model] = /** @type {HTMLSelectElement} */ (element).value.split('::');
        post({ type: 'setTier', tier: element.getAttribute('data-tier'), assignment: { providerId, model } });
      });
    });

    document.querySelectorAll('.plan-select[data-effort-tier]').forEach((element) => {
      element.addEventListener('change', () => {
        const tier = element.getAttribute('data-effort-tier');
        const assignment = data.assignments?.[tier] ?? {};
        post({
          type: 'setTier',
          tier,
          assignment: { ...assignment, effort: /** @type {HTMLSelectElement} */ (element).value }
        });
      });
    });

    document.querySelectorAll('.node').forEach((element) => {
      element.addEventListener('click', (event) => {
        const id = element.getAttribute('data-node');
        if (!id) {
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          // Cmd-click collects tasks for a partial run.
          if (selection.has(id)) {
            selection.delete(id);
          } else {
            selection.add(id);
          }
          render();
          return;
        }
        document.getElementById(`task-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.querySelectorAll('[data-run-task]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'run', only: [element.getAttribute('data-run-task')] });
      });
    });

    document.querySelectorAll('[data-chat-task]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        inspectedTaskId = element.getAttribute('data-chat-task') ?? '';
        render();
      });
    });

    document.querySelector('[data-close-inspector]')?.addEventListener('click', () => {
      inspectedTaskId = '';
      render();
    });

    document.querySelector('.task-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = /** @type {HTMLFormElement} */ (event.currentTarget);
      const input = /** @type {HTMLTextAreaElement|null} */ (form.querySelector('.task-chat-input'));
      const text = input?.value.trim() ?? '';
      if (text) {
        post({ type: 'taskChat', taskId: form.dataset.taskChat, text });
        input.value = '';
      }
    });
  }

  /** Repaints one node and the status line while a run is going. */
  function updateTask(task, running) {
    if (!data) {
      return;
    }
    data.run = data.run ?? { tasks: {} };
    data.run.tasks[task.taskId] = task;
    data.running = running;
    const node = document.querySelector(`.node[data-node="${task.taskId}"]`);
    if (!node) {
      render();
      return;
    }
    node.className = `node ${taskById(task.taskId)?.tier ?? 'mid'} ${task.status}${selection.has(task.taskId) ? ' picked' : ''}`;
    const dot = node.querySelector('.node-status');
    if (dot) {
      dot.className = `node-status ${task.status}`;
    }
    const status = document.querySelector('.run-status');
    if (status) {
      status.outerHTML = renderStatus();
    } else {
      render();
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'plan') {
      const sameplan = data?.plan?.id === message.plan?.id;
      data = message;
      if (!sameplan) {
        selection = new Set();
        inspectedTaskId = '';
      }
      render();
    } else if (message.type === 'task') {
      updateTask(message.task, message.running);
    }
  });

  window.addEventListener('resize', () => drawEdges());
  post({ type: 'ready' });
})();
