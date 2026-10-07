// @ts-check
/* PolyMoly chat webview: transcript, model menu, action palette, settings modal, composer. */
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{lang: string, dir: string, locale: string, strings: Record<string, string>}} */
  const I18N = /** @type {any} */ (window).PM_I18N ?? { lang: 'de', dir: 'ltr', locale: 'de-DE', strings: {} };
  const LOCALE = I18N.locale;
  /** Translated string; `{name}` placeholders are filled from vars (callers escape HTML themselves). */
  function t(key, vars) {
    const text = I18N.strings[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text;
  }

  const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

  /** Status words shown while a turn runs, one picked at random. */
  const THINKING_WORDS = `
    Babbeling Gebabbelling Schnuddeling Gugging Schaffing Huddeling Daddeling Bembeling Äppelwoing
    Grübeling Knoddeling Rödeling Wurschteling Muddelding EiGudeing Hibbeling Knoddering Raffeling
    Schluffing Schlappeling Brabbeling Plausching Schwätzing Schnacking Gebabbering Rumgugging
    Rumwurschteling Rumhuddeling Rumschaffing Rumknoddeling Rumdaddeling Rumrödeling Rumraffeling
    Rumbrabbeling Rumschnuddeling Rumhibbeling Rumknoddering Rumplausching Rumtrödeling Rumstochering
    Rumwerkeling Rumfrickeling Rumfummeling Rumkraming Rumtüfteling Rumkaspering Rumhocking Rumstehing
    Rumrenning Rumlatsching Rumlungering Rumgurking Rumstolpering Rumschlurfang Rumschlurfing
    Rumwackeling Rumwuseling Rumkruscheling Rumkrameling Rumknorzing Rummeckering Rumnörgeling
    Rummauling Rummauscheling Rumgeigeling Rumklimpering Rumklüngeling Rumfriemeling Rumfranzeling
    Rumdengeling Rumschraubing Rumbohring Rumhämmering Rumklopping Rumklöppeling Rumpriemeling
    Rumprokeling Rumzupfing Rumzuppeling Rumdrücking Rumdrückseling Rumquetsching Rumknautsching
    Rumkneting Rumzerring Rumzuppling Rumzuckeling Rumschauing Rumhorching Rumschnüffeling Rumrieching
    Rumglotzing Rumstauning Rumgrinsing Rumkichering Rumlaching Rumfluching Rumschimpfing Rumkeifing
    Rumgranteling Nuing Sächseling Muggeling Mahlzeiting Guggning Machning Latsching Trödeling
    Pfriemeling Frickeling Fummeling Wuseling Kraming Tüfteling Kruscheling Kruschteling Krameling
    Puscheling Mumpeling Muffeling Meckering Nörgeling Mosering Mauling Schnoddering Schnattering
    Quasseling Labering Plappering Schwatzening Rumning Rummachning Rumguggning Rumpfriemeling
    Rummuggeling Rummosering Rumschnoddering Rumschnattering Rumquasseling Rumlabering Rumplappering
    Rumschwatzening Rumdödeling Rumknispeling Rumknispering Rumknurpseling Rumknarzing Rumknaubeling
    Rumkrabbeling Rumstiefeling Rumstapfing Rumhopsing Rumhüpfing Rumhusching Rumsausing Rumflitzing
    Rumschlendering Rumschleiching Rumstiering Rumgaffing Rumlausching Rumschnuppering Rumknabbering
    Rumkauing Rumschmatzing Rumschlürfing Rumsüffeling Rumtrinking Rumfuttering Rummampfing
    Rumschmausing Rumvespering Rumprusting Rumseufzing Rumächzing Rumstöhning Rumjammering Rumzetering
    Rumquengeling Rumknatsching Rumzanking Rumpöbeling Rumstänkering Rumrotzing Rumrotzeling Servusing
    Grüßgotting Oachkatzling Granteling Brotzeiting Gaudying Ratsching Ratschning Dahoaming Griabiging
    Zamrucking Zamsitzing Zamreding Zamratschening Zamwerkeling Zamschraubing Zamsaufing Zamessing
    Zamfeiering Zamgranteling Schmarrning Kaspering Kraxeling Hatsching Schleiching Schlurfang
    Schlurfing Werkeling Basteling Friemeling Dengeling Klopfing Klöppeling Bohring Schraubing Hämmering
    Säging Feiling Schmirgeling Zupfing Zuppling Drücking Pressing Quetsching Knautsching Kneting
    Zerring Zuckeling Wackeling Rumpeling Poltering Scheppering Kraching Klimpering Klappering
    Klingeling Bimmeling Läuting Jodeling Juchzing Juchheing Platteling Schuhplatteling Schunkeling
    Tanzing Hupfing Hüpfing Hopsing Sausing Flitzing Kutschering Radeling Berging Alming Hüttening
    Gipfeling Kraxning Wandering Stapfing Schneestapfing Bergsteigering Abfahring Rodeling Schlitteling
    Skifahring Wedeling Brezeling Weißwursting Leberkäsing Obatzding Radiing Maßing Biering Schnapsing
    Specking Knödeling Kaiserschmarrning Zwetschging Krapfening Zamkraming Zamwurschteling Zamfriemeling
    Zamgranting Zamgugging Zamhocking Zamlatsching Zamhatsching Zamtrödeling Zamwuseling Zamratsching
    Zamplappering Zamschnacking Zamgrübeling Zamdengeling Zamklimpering
  `.trim().split(/\s+/);
  const SPINNER_WORDS = I18N.lang === 'de' ? THINKING_WORDS : t('spinner.words').split('|');
  const WORD_SECONDS = 8;

  /** @type {{providers: any[], conversation: any, handoff?: any, attachments?: any[], running: boolean, version?: string}} */
  let state = { providers: [], conversation: null, handoff: null, attachments: [], running: false };
  /** Files dropped from outside VS Code larger than this are refused (they travel base64 over postMessage). */
  const MAX_DROP_BYTES = 30 * 1024 * 1024;
  let dragDepth = 0;
  /** @type {null | 'palette' | 'models' | 'history'} */
  let menu = null;
  let paletteFilter = '';
  /** Stored chats for the history panel; null until the extension answers. */
  let historyItems = null;
  let historyCurrentId = null;
  let historyFilter = '';
  /** Highlighted row of the filtered history list, for arrow-key navigation. */
  let historyIndex = 0;
  let draft = '';
  let streaming = false;
  /** Usage windows of the current provider, or null when the provider reports none. */
  let limits = null;
  /** Tool calls and thinking blocks the user opened; everything else shows a clipped preview. */
  const expandedTools = new Set();
  const expandedThinking = new Set();
  /** Running turn's spinner: start time, current word and when it was picked. */
  let spinner = null;
  /** Seconds left before an unanswered plan suggestion switches the mode by itself. */
  let planCountdown = null;
  let planTimer = null;

  let settingsOpen = false;
  let settingsTab = 'providers';
  /** @type {any} */
  let settings = null;
  let settingsError = '';
  const expandedProviders = new Set();
  const providerChecks = {};
  /** Filter text of each provider's model list in the settings modal. */
  const modelSearch = {};
  /** Filter text of the provider list itself; the built-in API templates make it long. */
  let providerSearch = '';
  /** MCP server being edited: null, or { previousName, name, server }. */
  let mcpDraft = null;
  /** Result line of the last skill install, or null. */
  let skillStatus = null;
  let addingProvider = false;

  const root = /** @type {HTMLElement} */ (document.getElementById('root'));
  const modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  document.body.appendChild(modalRoot);

  const ICONS = {
    history:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.4 1.6" stroke-linecap="round"/></svg>',
    plus:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 3.5v9M3.5 8h9" stroke-linecap="round"/></svg>',
    slash:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M9.6 5.2 6.4 10.8" stroke-linecap="round"/></svg>',
    arrowUp:
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 12.5v-9M4 7.5 8 3.5l4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
    check:
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>',
    chevron:
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3.5 10.5 8 6 12.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plan:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="2" width="10" height="12" rx="2"/><path d="M5.8 5.6h4.4M5.8 8h4.4M5.8 10.4h2.6" stroke-linecap="round"/></svg>',
    gear:
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" stroke-linecap="round"/></svg>'
  };

  const LOGO_URL = document.body.dataset.logo ?? '';
  const logo = (cls) => `<img class="${cls}" src="${LOGO_URL}" alt="" />`;
  const HERO_LOGO_URL = document.body.dataset.logoAnimated || LOGO_URL;

  // ---------- helpers ----------

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /** Small markdown subset: fenced code, inline code, bold, bullets. */
  function renderMarkdown(text) {
    const parts = String(text).split(/```/);
    let html = '';
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const newline = part.indexOf('\n');
        const body = newline === -1 ? part : part.slice(newline + 1);
        html += `<pre><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`;
        return;
      }
      const lines = escapeHtml(part).split('\n');
      let inList = false;
      let buffer = '';
      const closeList = () => {
        if (inList) {
          buffer += '</ul>';
          inList = false;
        }
      };
      for (const line of lines) {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          if (!inList) {
            buffer += '<ul>';
            inList = true;
          }
          buffer += `<li>${inline(bullet[1])}</li>`;
        } else if (!line.trim()) {
          closeList();
          buffer += '<p></p>';
        } else {
          closeList();
          buffer += `<p>${inline(line)}</p>`;
        }
      }
      closeList();
      html += buffer;
    });
    return html;
  }

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function currentProvider() {
    if (!state.conversation) {
      return null;
    }
    return state.providers.find((p) => p.id === state.conversation.providerId) ?? null;
  }

  function currentModel() {
    const provider = currentProvider();
    const modelId = state.conversation?.model ?? provider?.defaultModel;
    return provider?.models?.find((m) => m.id === modelId) ?? null;
  }

  function currentModelLabel() {
    const model = currentModel();
    return model?.label ?? state.conversation?.model ?? currentProvider()?.defaultModel ?? t('model.choose');
  }

  /** Effort levels of the current model, lowest first. */
  function effortLevels() {
    return currentModel()?.efforts ?? [];
  }

  /** Mirrors effortFor() in the extension: wanted level, else the closest one the model has. */
  function effectiveEffort() {
    const levels = effortLevels();
    if (!levels.length) {
      return null;
    }
    const wanted = state.conversation?.effort;
    if (wanted && levels.includes(wanted)) {
      return wanted;
    }
    const rank = EFFORT_ORDER.indexOf(wanted ?? currentModel()?.defaultEffort ?? 'high');
    if (rank < 0) {
      return levels[0];
    }
    return levels.reduce((best, level) =>
      Math.abs(EFFORT_ORDER.indexOf(level) - rank) < Math.abs(EFFORT_ORDER.indexOf(best) - rank) ? level : best
    );
  }

  function effortLabel(level) {
    return level ? t(`effort.${level}`) : level;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function shortArgs(input) {
    if (input == null) {
      return '';
    }
    if (typeof input === 'string') {
      return input.replace(/\s+/g, ' ').slice(0, 120);
    }
    if (Array.isArray(input)) {
      return input.join(' ').slice(0, 120);
    }
    const values = Object.entries(input)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(', ');
    return values.replace(/\s+/g, ' ').slice(0, 120);
  }

  /** Grey text next to the tool name: the model's own description, else the arguments. */
  function toolTitle(input) {
    if (input && typeof input === 'object' && !Array.isArray(input) && typeof input.description === 'string') {
      return input.description;
    }
    return shortArgs(input);
  }

  /** Main argument of a tool call, shown in the IN row. */
  function toolInput(input) {
    if (input == null) {
      return '';
    }
    if (typeof input === 'string') {
      return input;
    }
    if (Array.isArray(input)) {
      return input.join(' ');
    }
    for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt']) {
      if (typeof input[key] === 'string') {
        return input[key];
      }
    }
    return JSON.stringify(input, null, 2);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(LOCALE).format(Math.round(value || 0));
  }

  /** "41k" style for token counts in compact places. */
  function formatTokens(value) {
    const n = Math.round(value || 0);
    return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(n / 1000)}k` : String(n);
  }

  /** Display name of the model behind a message. */
  function messageModelLabel(message) {
    const provider = state.providers.find((p) => p.id === message.providerId);
    const id = message.model ?? provider?.defaultModel;
    return provider?.models?.find((m) => m.id === id)?.label ?? id ?? provider?.label ?? message.providerId ?? '';
  }

  function formatUsage(usage) {
    if (!usage) {
      return '';
    }
    const number = (value) => new Intl.NumberFormat(LOCALE).format(Math.round(value || 0));
    const parts = [`${number(usage.inputTokens)} in`, `${number(usage.outputTokens)} out`];
    if (usage.cacheReadTokens) {
      parts.push(`${number(usage.cacheReadTokens)} cache read`);
    }
    if (usage.cacheWriteTokens) {
      parts.push(`${number(usage.cacheWriteTokens)} cache write`);
    }
    if (typeof usage.costUsd === 'number' && usage.costUsd > 0) {
      parts.push(`$${usage.costUsd.toFixed(4)}`);
    }
    return parts.join(' · ');
  }

  /** "13:47" today, "Tuesday 12:25" within a week, otherwise a date. */
  function formatReset(ms) {
    const date = new Date(ms);
    const time = date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return time;
    }
    if (ms - now.getTime() < 6.5 * 86_400_000) {
      return `${date.toLocaleDateString(LOCALE, { weekday: 'long' })} ${time}`;
    }
    return `${date.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  // ---------- palette & model menu items ----------

  function effortItem(group) {
    const levels = effortLevels();
    const current = effectiveEffort();
    if (!levels.length) {
      return null;
    }
    return {
      group,
      label: t('palette.effort'),
      suffix: effortLabel(current),
      control: 'dots',
      levels,
      current,
      run: () => {
        const index = levels.indexOf(current);
        post({ type: 'setEffort', effort: levels[(index + 1) % levels.length] });
      }
    };
  }

  function thinkingItem(group) {
    const conversation = state.conversation ?? {};
    return {
      group,
      label: t('palette.thinking'),
      control: 'switch',
      on: conversation.thinking !== false,
      run: () => post({ type: 'setThinking', thinking: conversation.thinking === false })
    };
  }

  // One dial for every provider, least to most permissive; the extension maps each level onto
  // the claude CLI, the codex sandbox or the local tools of API providers (src/chat/permissions.ts).
  const PERMISSION_LEVELS = ['readonly', 'edit', 'write', 'auto', 'full'];
  // Native CLI values and older stored values, as a level.
  const LEGACY_PERMISSIONS = {
    plan: 'readonly',
    'read-only': 'readonly',
    manual: 'edit',
    dontAsk: 'edit',
    acceptEdits: 'edit',
    'workspace-write': 'auto',
    bypassPermissions: 'full',
    'danger-full-access': 'full'
  };

  /** Ordered permission levels for the current provider, or none if it has no such dial. */
  function permissionLevels() {
    const provider = currentProvider();
    if (provider?.kind === 'http') {
      return ['readonly', 'edit', 'write', 'auto'];
    }
    if (provider?.protocol === 'claude-stream-json') {
      return ['readonly', 'edit', 'auto', 'full'];
    }
    if (provider?.protocol === 'codex-jsonl') {
      return ['readonly', 'auto', 'full'];
    }
    return [];
  }

  /** A stored value as one of the current provider's levels, stepping down when it has no exact match. */
  function permissionLevel(value) {
    const levels = permissionLevels();
    const level = PERMISSION_LEVELS.includes(value) ? value : LEGACY_PERMISSIONS[value];
    if (!level || !levels.length) {
      return undefined;
    }
    if (level === 'full') {
      return levels[levels.length - 1];
    }
    const rank = PERMISSION_LEVELS.indexOf(level);
    const fitting = levels.filter((candidate) => PERMISSION_LEVELS.indexOf(candidate) <= rank);
    return fitting[fitting.length - 1] ?? levels[0];
  }

  /** Matches the fallback each adapter reads from `polyagent.*` when the chat has no override. */
  function permissionDefault() {
    const provider = currentProvider();
    const defaults = state.permissionDefaults ?? {};
    if (provider?.kind === 'http') {
      return permissionLevel(defaults.http || 'write');
    }
    if (provider?.protocol === 'claude-stream-json') {
      return permissionLevel(defaults.claude || 'acceptEdits');
    }
    if (provider?.protocol === 'codex-jsonl') {
      return permissionLevel(defaults.codex || 'workspace-write');
    }
    return undefined;
  }

  /** The level the current chat runs with. */
  function currentPermission() {
    return permissionLevel(state.conversation?.permission) || permissionDefault();
  }

  function permissionLabel(mode) {
    return t(`perm.${mode}`);
  }

  /** Composer chip for the current chat's permission level; hidden for HTTP providers. */
  function permissionChip() {
    const levels = permissionLevels();
    // Plan and ask mode force read-only rights, so the chip would only lie about them.
    if (!levels.length || currentMode() !== 'chat') {
      return '';
    }
    const current = currentPermission();
    return `<button class="chip ghost permission-chip" data-act="permission" title="${escapeHtml(t('palette.permission'))}">${escapeHtml(permissionLabel(current))}</button>`;
  }

  /** Per-chat override of the CLI's permission mode, e.g. "always ask" vs. "full access". */
  function permissionItem(group) {
    const levels = permissionLevels();
    if (!levels.length) {
      return null;
    }
    const current = currentPermission();
    return {
      group,
      label: t('palette.permission'),
      suffix: permissionLabel(current),
      control: 'permission',
      levels,
      current,
      run: () => {
        const index = levels.indexOf(current);
        post({ type: 'setPermission', mode: levels[(index + 1) % levels.length] });
      }
    };
  }

  const MODES = ['chat', 'plan', 'ask'];

  function currentMode() {
    return state.mode ?? state.conversation?.mode ?? 'chat';
  }

  /** Chat / Plan / Ask, the three ways a message is treated. */
  function renderModes() {
    const mode = currentMode();
    return `<div class="modes">${MODES.map(
      (name) =>
        `<button class="mode-tab${name === mode ? ' active' : ''}" data-mode="${name}" title="${escapeHtml(t(`mode.${name}.hint`))}">${escapeHtml(t(`mode.${name}`))}</button>`
    ).join('')}</div>`;
  }

  /** Counts a plan suggestion down; silence means yes, so the switch happens by itself. */
  function syncPlanCountdown() {
    const pending = state.pending;
    const wanted = pending && pending.kind === 'planSuggest';
    if (!wanted) {
      clearInterval(planTimer);
      planTimer = null;
      planCountdown = null;
      return;
    }
    if (planTimer) {
      return;
    }
    planCountdown = 30;
    planTimer = setInterval(() => {
      planCountdown -= 1;
      const label = document.querySelector('.pending-count');
      if (label) {
        label.textContent = String(Math.max(0, planCountdown));
      }
      if (planCountdown <= 0) {
        clearInterval(planTimer);
        planTimer = null;
        resolvePending('plan');
      }
    }, 1000);
  }

  function resolvePending(action) {
    clearInterval(planTimer);
    planTimer = null;
    planCountdown = null;
    if (action === 'models') {
      menu = 'models';
      render();
      return;
    }
    if (action !== 'cancel') {
      streaming = true;
    }
    post({ type: 'pendingResolve', action });
  }

  /** The card that asks whether the mode still fits the message the user just wrote. */
  function renderPending() {
    const pending = state.pending;
    if (!pending || state.running) {
      return '';
    }
    const excerpt = pending.text.replace(/\s+/g, ' ').slice(0, 160);
    const quote = `<div class="pending-quote">${escapeHtml(excerpt)}${pending.text.length > 160 ? '…' : ''}</div>`;

    if (pending.kind === 'planSuggest') {
      return `<div class="pending">
        <div class="pending-head">${escapeHtml(t('pending.planHead'))}</div>
        ${quote}
        <div class="pending-body">${t('pending.planBody', { seconds: `<span class="pending-count">${planCountdown ?? 30}</span>` })}</div>
        <div class="handoff-actions">
          <button class="btn primary" data-pending="plan">${escapeHtml(t('pending.planNow'))}</button>
          <button class="btn" data-pending="chat">${escapeHtml(t('pending.stayChat'))}</button>
          <button class="btn ghost" data-pending="cancel">${escapeHtml(t('common.cancel'))}</button>
        </div>
      </div>`;
    }

    if (pending.kind === 'planWarn') {
      return `<div class="pending warn">
        <div class="pending-head">${escapeHtml(t('pending.weakHead', { model: pending.modelLabel ?? '' }))}</div>
        <div class="pending-body">${escapeHtml(t('pending.weakBody'))}</div>
        ${quote}
        <div class="handoff-actions">
          <button class="btn primary" data-pending="models">${escapeHtml(t('pending.switchModel'))}</button>
          <button class="btn" data-pending="plan">${escapeHtml(t('pending.planAnyway'))}</button>
          <button class="btn ghost" data-pending="cancel">${escapeHtml(t('common.cancel'))}</button>
        </div>
      </div>`;
    }

    return `<div class="pending">
      <div class="pending-head">${escapeHtml(t('pending.askHead'))}</div>
      ${quote}
      <div class="pending-body">${escapeHtml(t('pending.askBody'))}</div>
      <div class="handoff-actions">
        <button class="btn primary" data-pending="chat">${escapeHtml(t('pending.toChat'))}</button>
        <button class="btn" data-pending="plan">${escapeHtml(t('pending.toPlan'))}</button>
        <button class="btn" data-pending="ask">${escapeHtml(t('pending.askAnyway'))}</button>
        <button class="btn ghost" data-pending="cancel">${escapeHtml(t('common.cancel'))}</button>
      </div>
    </div>`;
  }

  /** Preview card of a written plan; the full plan opens in the editor area. */
  function renderPlanCard(message) {
    const plan = message.plan;
    return `<div class="plan-card" data-plan-message="${escapeHtml(message.id)}" data-plan-path="${escapeHtml(plan.path ?? '')}">
      <div class="plan-card-head">${ICONS.plan}<span>${escapeHtml(t('plan.title'))}</span>
        <span class="plan-card-meta">${escapeHtml(t('plan.cardMeta', { tasks: plan.taskCount, waves: plan.waveCount }))}</span>
      </div>
      <div class="plan-card-title">${escapeHtml(plan.title)}</div>
      <div class="plan-card-preview">${renderMarkdown(plan.preview)}</div>
      <div class="plan-card-fade"></div>
      <button class="btn plan-card-open" data-plan-open="1">${escapeHtml(t('plan.openFull'))} →</button>
    </div>`;
  }

  function paletteItems() {
    const conversation = state.conversation ?? {};
    const mcpCount = settings ? Object.keys(settings.mcpServers ?? {}).length : null;
    const items = [
      { group: t('group.context'), label: t('palette.attach'), run: () => closeAnd(() => post({ type: 'attachFile' })) },
      {
        group: t('group.context'),
        label: t('palette.mention'),
        run: () => closeAnd(() => post({ type: 'mentionFile' }))
      },
      { group: t('group.context'), label: t('palette.clear'), run: () => closeAnd(() => post({ type: 'clear' })) },
      { group: t('group.context'), label: t('palette.rewind'), run: () => closeAnd(() => post({ type: 'rewind' })) },
      {
        group: t('group.model'),
        label: t('palette.switchModel'),
        value: currentModelLabel(),
        run: () => {
          menu = 'models';
          render();
        }
      },
      {
        group: t('group.model'),
        label: t('palette.mode'),
        value: t(`mode.${currentMode()}`),
        run: () => closeAnd(() => post({ type: 'setMode', mode: MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length] }))
      },
      effortItem(t('group.model')),
      thinkingItem(t('group.model')),
      permissionItem(t('group.model')),
      {
        group: t('group.model'),
        label: t('palette.showTools'),
        control: 'switch',
        on: conversation.showTools !== false,
        run: () => post({ type: 'setShowTools', showTools: conversation.showTools === false })
      },
      {
        group: t('group.customize'),
        label: t('palette.mcp'),
        value: mcpCount === null ? '' : String(mcpCount),
        run: () => closeAnd(() => openSettings('mcp'))
      },
      {
        group: t('group.customize'),
        label: t('palette.skills'),
        value: String((state.skills ?? []).length),
        run: () => closeAnd(() => openSettings('skills'))
      },
      { group: t('group.customize'), label: t('palette.providers'), run: () => closeAnd(() => openSettings('providers')) },
      { group: t('group.settings'), label: t('palette.general'), run: () => closeAnd(() => openSettings('general')) },
      { group: t('group.settings'), label: t('palette.usage'), run: () => closeAnd(() => post({ type: 'openUsage' })) },
      { group: t('group.settings'), label: t('palette.check'), run: () => closeAnd(() => post({ type: 'checkProviders' })) },
      { group: t('group.settings'), label: t('palette.settingsJson'), run: () => closeAnd(() => post({ type: 'openSettingsJson' })) }
    ];
    for (const skill of state.skills ?? []) {
      items.push({
        group: t('group.skills'),
        label: `/${skill.name}`,
        run: () => closeAnd(() => (draft = `/${skill.name} ${draft.replace(/^[/$][\w-]+\s*/, '')}`))
      });
    }
    return items.filter(Boolean);
  }

  function modelMenuItems() {
    const conversation = state.conversation ?? {};
    const items = [];
    for (const provider of state.providers) {
      const activeModel = conversation.model ?? provider.defaultModel;
      for (const model of provider.models ?? []) {
        items.push({
          group: provider.label,
          label: model.label ?? model.id,
          description: model.description ?? '',
          active: provider.id === conversation.providerId && model.id === activeModel,
          run: () => closeAnd(() => post({ type: 'selectModel', providerId: provider.id, model: model.id }))
        });
      }
    }
    return items;
  }

  function closeAnd(action) {
    menu = null;
    paletteFilter = '';
    action();
    render();
  }

  function closeMenu() {
    menu = null;
    paletteFilter = '';
    historyFilter = '';
    render();
  }

  function filterItems(items) {
    const needle = paletteFilter.toLowerCase();
    return items.filter((item) => `${item.label} ${item.group ?? ''}`.toLowerCase().includes(needle));
  }

  // ---------- rendering ----------

  function render() {
    const conversation = state.conversation;
    const scrollTop = document.querySelector('.scroll')?.scrollTop;
    const atBottom = wasAtBottom();
    const listScroll = document.querySelector('.palette-list')?.scrollTop ?? 0;
    const effort = effectiveEffort();

    root.innerHTML = `
<div class="app">
  <div class="header">
    <div class="header-title">${escapeHtml(!conversation?.title || conversation.title === 'Untitled' ? t('common.untitled') : conversation.title)}</div>
    <button class="icon-button${menu === 'history' ? ' active' : ''}" data-act="history" title="${escapeHtml(t('header.history'))}">${ICONS.history}</button>
    <button class="icon-button outlined" data-act="new" title="${escapeHtml(t('header.newChat'))}">${ICONS.plus}</button>
    ${menu === 'history' ? renderHistory() : ''}
  </div>
  <div class="scroll">${renderBody()}</div>
  ${menu === 'palette' ? renderPalette() : ''}
  ${menu === 'models' ? renderModelMenu() : ''}
  <div class="composer-wrap">
    <div class="composer${draft || menu ? ' focused' : ''}">
      ${renderAttachments()}
      <textarea rows="2" dir="auto" placeholder="${escapeHtml(t('composer.placeholder', { name: currentProvider()?.label ?? 'Agent' }))}">${escapeHtml(draft)}</textarea>
      <div class="composer-bar">
        ${renderModes()}
        <button class="icon-button" data-act="attach" title="${escapeHtml(t('composer.attach'))}">${ICONS.plus}</button>
        <button class="icon-button${menu === 'palette' ? ' active' : ''}" data-act="palette" title="${escapeHtml(t('composer.actions'))}">${ICONS.slash}</button>
        <button class="chip${menu === 'models' ? ' active' : ''}" data-act="model" title="${escapeHtml(currentProvider()?.label ?? '')}">${escapeHtml(currentModelLabel())}${
          effort ? `<span class="muted">${escapeHtml(effortLabel(effort))}</span>` : ''
        }</button>
        ${permissionChip()}
        <div class="spacer"></div>
        <button class="send${state.running ? ' stop' : ''}" data-act="${state.running ? 'abort' : 'send'}" title="${escapeHtml(t(state.running ? 'composer.stop' : 'composer.send'))}">${state.running ? ICONS.stop : ICONS.arrowUp}</button>
      </div>
    </div>
    ${renderLimits()}
  </div>
</div>`;

    wire();

    const list = document.querySelector('.palette-list');
    if (list) {
      list.scrollTop = listScroll;
    }
    const scroll = document.querySelector('.scroll');
    if (scroll) {
      scroll.scrollTop = atBottom ? scroll.scrollHeight : scrollTop ?? 0;
    }
  }

  const KIND_ICON = { image: '🖼', pdf: '📄', text: '📝', other: '📦' };

  function formatSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /** Chips of the files attached to the draft, plus why the current model cannot take some. */
  function renderAttachments() {
    const files = state.attachments ?? [];
    if (!files.length) {
      return '';
    }
    const chips = files
      .map((file) => {
        const level = file.support?.level ?? 'ok';
        const note = file.support?.note ? ` — ${file.support.note}` : '';
        return `<span class="attachment ${level}" title="${escapeHtml(file.path + note)}">
          <span class="attachment-icon">${KIND_ICON[file.kind] ?? '📎'}</span>
          <span class="attachment-name">${escapeHtml(file.name)}</span>
          <span class="attachment-size">${formatSize(file.size)}</span>
          <button class="attachment-remove" data-remove="${escapeHtml(file.id)}" title="${escapeHtml(t('common.remove'))}">${ICONS.close}</button>
        </span>`;
      })
      .join('');
    const notes = files
      .filter((file) => file.support?.level && file.support.level !== 'ok')
      .map((file) => `<div class="attachment-note ${file.support.level}">${file.support.level === 'block' ? '✗' : '⚠'} ${escapeHtml(file.name)}: ${escapeHtml(file.support.note ?? '')}</div>`)
      .join('');
    return `<div class="attachments">${chips}</div>${notes}`;
  }

  function renderLimits() {
    if (!limits || !limits.windows?.length) {
      return '';
    }
    const rows = limits.windows
      .map((window) => {
        const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
        const period = window.kind === 'weekly' ? ` ${t('limit.thisWeek')}${window.scope ? ` (${window.scope})` : ''}` : '';
        const reset = window.resetsAt ? ` · ${t('limit.resets', { time: formatReset(window.resetsAt) })}` : '';
        const level = percent >= 90 ? ' crit' : percent >= 75 ? ' warn' : '';
        return `<div class="limit-row" title="${escapeHtml(t(window.kind === 'weekly' ? 'limit.weekly' : 'limit.session'))}">
          <div class="limit-track"><div class="limit-fill${level}" style="width:${percent}%"></div></div>
          <span class="limit-text">${escapeHtml(t('limit.used', { percent }))}${escapeHtml(period)}${escapeHtml(reset)}</span>
        </div>`;
      })
      .join('');
    return `<div class="limits" data-act="refreshLimits">${rows}</div>`;
  }

  function wasAtBottom() {
    const scroll = document.querySelector('.scroll');
    if (!scroll) {
      return true;
    }
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
  }

  function renderBody() {
    const messages = state.conversation?.messages ?? [];
    if (!messages.length) {
      return `<div class="empty">
        <img class="hero-logo" src="${HERO_LOGO_URL}" alt="" />
        <div class="wordmark">PolyMoly</div>
      </div>`;
    }
    let lastModel = '';
    const html = messages
      .map((message) => {
        if (message.role === 'system') {
          return `<div class="switch-note">${escapeHtml(message.text)}</div>`;
        }
        if (message.role !== 'assistant' || !message.providerId) {
          return renderMessage(message);
        }
        // Tag the answer whenever the model differs from the previous answer's.
        const key = `${message.providerId}|${message.model ?? ''}`;
        const tag = lastModel && key !== lastModel ? `<div class="model-switch">↪ ${escapeHtml(messageModelLabel(message))}</div>` : '';
        lastModel = key;
        return tag + renderMessage(message);
      })
      .join('');
    return `<div class="messages">${html}${streaming ? renderSpinner() : ''}${renderHandoff()}${renderPending()}</div>`;
  }

  function randomWord(previous) {
    let word = previous;
    while (word === previous && SPINNER_WORDS.length > 1) {
      word = SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)];
    }
    return word;
  }

  function spinnerParts() {
    const now = Date.now();
    if (!spinner) {
      spinner = { startedAt: now, word: randomWord(''), wordAt: now };
    } else if (now - spinner.wordAt > WORD_SECONDS * 1000) {
      spinner.word = randomWord(spinner.word);
      spinner.wordAt = now;
    }
    const seconds = Math.floor((now - spinner.startedAt) / 1000);
    return {
      word: `${spinner.word}…`,
      time: `(${seconds}s)`
    };
  }

  /** "Babbeling… (12s)" with the pulsing logo under the transcript while a turn runs. */
  function renderSpinner() {
    const part = spinnerParts();
    return `<div class="spinner">${logo('spinner-logo')}<span class="spinner-word">${escapeHtml(part.word)}</span><span class="spinner-time">${part.time}</span></div>`;
  }

  /** Animates the spinner in place, without repainting the transcript. */
  setInterval(() => {
    if (!streaming) {
      spinner = null;
      return;
    }
    const element = document.querySelector('.spinner');
    if (!element) {
      return;
    }
    const part = spinnerParts();
    const [, word, time] = element.children;
    word.textContent = part.word;
    time.textContent = part.time;
  }, 120);

  /** Card offering to continue on another model after the current one ran out of quota. */
  function renderHandoff() {
    const handoff = state.handoff;
    if (!handoff || state.running) {
      return '';
    }
    const reset = handoff.resetsAt ? ` · ${t('limit.resets', { time: formatReset(handoff.resetsAt) })}` : '';
    const head = `<div class="handoff-head"><span class="handoff-dot"></span>${t('handoff.empty', { name: escapeHtml(handoff.from.label) })}${escapeHtml(reset)}</div>
      <div class="handoff-reason">${escapeHtml(handoff.reason)}</div>`;

    if (!handoff.to) {
      return `<div class="handoff">${head}
        <div class="handoff-question">${escapeHtml(t('handoff.none'))}</div>
        <div class="handoff-actions">
          <button class="btn primary" data-act="handoff-change">${escapeHtml(t('model.choose'))}</button>
          <button class="btn" data-act="handoff-dismiss">${escapeHtml(t('common.close'))}</button>
        </div>
      </div>`;
    }

    const to = handoff.to;
    const transfer = to.transfer;
    const lines = [];
    if (transfer.resumesSession) {
      lines.push(
        transfer.tokens
          ? t('handoff.resumeTokens', { name: escapeHtml(to.label), messages: transfer.messages, tokens: formatNumber(transfer.tokens) })
          : t('handoff.resumeAll', { name: escapeHtml(to.label) })
      );
    } else {
      const omitted = transfer.omitted ? t('handoff.omitted', { count: transfer.omitted }) : '';
      const fits = transfer.contextWindow
        ? t('handoff.fits', { tokens: formatTokens(transfer.tokens), window: formatTokens(transfer.contextWindow) })
        : '';
      lines.push(t('handoff.transfer', { tokens: formatNumber(transfer.tokens), messages: transfer.messages, omitted, fits }));
    }
    lines.push(
      t('handoff.coldCache') +
        (to.costUsd !== undefined ? ` (≈ $${to.costUsd.toFixed(3)})` : '') +
        (transfer.resumesSession || to.transfer.tokens === 0 ? '' : t('handoff.cliExtra')) +
        '.'
    );
    const used = handoff.from.lastUsage;
    if (used) {
      const cache = used.cacheReadTokens ? t('handoff.cacheRead', { count: formatNumber(used.cacheReadTokens) }) : '';
      lines.push(t('handoff.compare', { name: escapeHtml(handoff.from.label), input: formatNumber(used.inputTokens + used.cacheWriteTokens), cache }));
    }
    const effort = to.effort ? ` · ${escapeHtml(effortLabel(to.effort))}` : '';

    return `<div class="handoff">${head}
      <div class="handoff-question">${t('handoff.question', { name: escapeHtml(to.label), effort, provider: escapeHtml(to.providerLabel) })}</div>
      <ul class="handoff-stats">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
      <div class="handoff-actions">
        <button class="btn primary" data-act="handoff-accept">${escapeHtml(t('handoff.accept'))}</button>
        <button class="btn" data-act="handoff-change">${escapeHtml(t('handoff.other'))}</button>
        <button class="btn" data-act="handoff-dismiss">${escapeHtml(t('handoff.no'))}</button>
      </div>
    </div>`;
  }

  function renderMessage(message) {
    if (message.role === 'user') {
      const files = (message.attachments ?? [])
        .map((file) => `<span class="attachment sent" title="${escapeHtml(file.path)}"><span class="attachment-icon">${KIND_ICON[file.kind] ?? '📎'}</span><span class="attachment-name">${escapeHtml(file.name)}</span></span>`)
        .join('');
      const skipped = (message.skippedAttachments ?? [])
        .map((file) => `<div class="attachment-note block">✗ ${escapeHtml(t('msg.notSent'))}: ${escapeHtml(file.name)} — ${escapeHtml(file.note)}</div>`)
        .join('');
      return `<div class="msg msg-user${message.handoff ? ' msg-handoff' : ''}" dir="auto">${escapeHtml(message.text)}${
        files ? `<div class="attachments">${files}</div>` : ''
      }${skipped}</div>`;
    }

    const showTools = state.conversation?.showTools !== false;
    const showThinking = state.conversation?.thinking !== false;
    const steps = [];

    if (showThinking && message.thinking) {
      const open = expandedThinking.has(message.id);
      steps.push(`<div class="step step-thinking" data-thinking="${escapeHtml(message.id)}">
        <div class="step-head toggle">${escapeHtml(t('step.thinking'))}</div>
        ${open ? `<div class="thinking">${escapeHtml(message.thinking)}</div>` : ''}
      </div>`);
    }
    if (showTools) {
      for (const tool of message.tools ?? []) {
        const status = tool.isError ? 'error' : tool.done ? 'done' : 'pending';
        const open = expandedTools.has(tool.id);
        const input = toolInput(tool.input);
        const output = tool.output ? String(tool.output).slice(0, open ? 20000 : 2000) : '';
        const rows = [
          input ? `<div class="io-row"><span class="io-label">IN</span><pre class="io-text">${escapeHtml(input)}</pre></div>` : '',
          output ? `<div class="io-row"><span class="io-label">OUT</span><pre class="io-text${tool.isError ? ' error' : ''}">${escapeHtml(output)}</pre></div>` : ''
        ].join('');
        steps.push(`<div class="step step-tool ${status}" data-tool="${escapeHtml(tool.id)}">
          <div class="step-head tool-head"><span class="tool-name">${escapeHtml(tool.name)}</span><span class="tool-args">${escapeHtml(toolTitle(tool.input))}</span></div>
          ${rows ? `<div class="io${open ? ' open' : ''}">${rows}</div>` : ''}
        </div>`);
      }
    }
    if (message.text) {
      steps.push(`<div class="step step-text"><div class="msg-assistant" dir="auto">${renderMarkdown(message.text)}</div></div>`);
    }
    if (message.plan) {
      steps.push(`<div class="step step-plan">${renderPlanCard(message)}</div>`);
    }
    if (message.error) {
      steps.push(`<div class="step step-error"><div class="msg-error">${escapeHtml(message.error)}</div></div>`);
    }
    const usage = formatUsage(message.usage);
    return `<div class="msg"><div class="timeline">${steps.join('')}</div>${
      usage ? `<div class="msg-usage">${escapeHtml(usage)}</div>` : ''
    }</div>`;
  }

  function renderControl(item) {
    if (item.control === 'switch') {
      return `<div class="switch${item.on ? ' on' : ''}"><div class="knob"></div></div>`;
    }
    if (item.control === 'dots') {
      return `<div class="dots">${item.levels
        .map(
          (level) =>
            `<div class="dot${level === item.current ? ' on' : ''}${level === 'max' || level === 'ultra' ? ' max' : ''}" data-effort="${escapeHtml(level)}" title="${escapeHtml(effortLabel(level))}"></div>`
        )
        .join('')}</div>`;
    }
    if (item.control === 'permission') {
      return `<div class="dots">${item.levels
        .map(
          (level) =>
            `<div class="dot${level === item.current ? ' on' : ''}${level === item.levels[item.levels.length - 1] ? ' max' : ''}" data-permission="${escapeHtml(level)}" title="${escapeHtml(permissionLabel(level))}"></div>`
        )
        .join('')}</div>`;
    }
    if (item.value) {
      return `<span class="value">${escapeHtml(item.value)}</span>`;
    }
    return '';
  }

  function renderItemList(items) {
    let html = '';
    let group = '';
    items.forEach((item, index) => {
      if (item.group !== group) {
        if (group) {
          html += '<div class="palette-sep"></div>';
        }
        group = item.group;
        html += `<div class="palette-group">${escapeHtml(group)}</div>`;
      }
      html += `<div class="palette-item" data-index="${index}">
        <span class="label">${escapeHtml(item.label)}${item.suffix ? ` <span class="suffix">(${escapeHtml(item.suffix)})</span>` : ''}</span>
        ${renderControl(item)}
      </div>`;
    });
    return html || `<div class="palette-group">${escapeHtml(t('palette.noMatch'))}</div>`;
  }

  function renderPalette() {
    const items = filterItems(paletteItems());
    const footer = paletteFilter
      ? ''
      : `<div class="palette-sep"></div><div class="palette-footer"><span>PolyMoly</span><span>v${escapeHtml(state.version ?? '')}</span></div>`;
    return `<div class="palette-wrap"><div class="palette">
      <input class="palette-filter" placeholder="${escapeHtml(t('palette.filter'))}" value="${escapeHtml(paletteFilter)}" />
      <div class="palette-list">${renderItemList(items)}${footer}</div>
    </div></div>`;
  }

  // ---------- chat history ----------

  function filteredHistory() {
    const needle = historyFilter.trim().toLowerCase();
    const items = historyItems ?? [];
    return needle
      ? items.filter((item) => `${item.title} ${item.providerId} ${item.model ?? ''}`.toLowerCase().includes(needle))
      : items;
  }

  /** Bucket of a chat by its last activity, like Claude Code's past-conversations list. */
  function historyGroup(ms) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = startOfToday.getTime();
    if (ms >= today) {
      return t('history.today');
    }
    if (ms >= today - 86_400_000) {
      return t('history.yesterday');
    }
    if (ms >= today - 7 * 86_400_000) {
      return t('history.last7');
    }
    if (ms >= today - 30 * 86_400_000) {
      return t('history.last30');
    }
    return t('history.older');
  }

  const relativeTime = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });

  function formatAge(ms) {
    const seconds = Math.round((ms - Date.now()) / 1000);
    const steps = [
      [60, 'second'],
      [60, 'minute'],
      [24, 'hour'],
      [7, 'day'],
      [4.35, 'week'],
      [12, 'month'],
      [Infinity, 'year']
    ];
    let value = seconds;
    for (const [size, unit] of steps) {
      if (Math.abs(value) < size) {
        return Math.abs(value) < 45 && unit === 'second' ? t('history.justNow') : relativeTime.format(Math.round(value), unit);
      }
      value /= size;
    }
    return '';
  }

  function renderHistory() {
    return `<div class="history-wrap"><div class="palette history">
      <input class="history-filter" placeholder="${escapeHtml(t('history.search'))}" value="${escapeHtml(historyFilter)}" />
      <div class="history-list">${renderHistoryList()}</div>
    </div></div>`;
  }

  function renderHistoryList() {
    if (!historyItems) {
      return `<div class="history-empty">${escapeHtml(t('common.loading'))}</div>`;
    }
    const items = filteredHistory();
    if (!items.length) {
      return `<div class="history-empty">${escapeHtml(t(historyFilter ? 'history.noMatch' : 'history.empty'))}</div>`;
    }
    historyIndex = Math.min(historyIndex, items.length - 1);
    let html = '';
    let group = '';
    items.forEach((item, index) => {
      const itemGroup = historyGroup(item.updatedAt);
      if (itemGroup !== group) {
        group = itemGroup;
        html += `<div class="palette-group">${escapeHtml(group)}</div>`;
      }
      const current = item.id === historyCurrentId;
      const meta = `${item.model ?? item.providerId} · ${t('history.messages', { count: item.messageCount })}`;
      html += `<div class="history-item${index === historyIndex ? ' selected' : ''}${current ? ' current' : ''}" data-history-id="${escapeHtml(item.id)}" data-history-index="${index}" title="${escapeHtml(item.title)}">
        <div class="history-text">
          <div class="history-title">${escapeHtml(item.title === 'Untitled' ? t('common.untitled') : item.title)}</div>
          <div class="history-meta">${escapeHtml(meta)}</div>
        </div>
        <span class="history-age">${escapeHtml(formatAge(item.updatedAt))}</span>
        <button class="history-delete" data-history-delete="${escapeHtml(item.id)}" title="${escapeHtml(t('common.delete'))}">${ICONS.close}</button>
      </div>`;
    });
    return html;
  }

  function openHistory(id) {
    menu = null;
    historyFilter = '';
    if (id !== historyCurrentId) {
      draft = '';
      post({ type: 'openConversation', id });
    }
    render();
  }

  function wireHistoryList() {
    document.querySelectorAll('.history-item').forEach((element) => {
      const el = /** @type {HTMLElement} */ (element);
      el.addEventListener('click', () => openHistory(el.dataset.historyId));
    });
    document.querySelectorAll('.history-delete').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'deleteConversation', id: /** @type {HTMLElement} */ (element).dataset.historyDelete });
      });
    });
  }

  function refreshHistoryList() {
    const list = document.querySelector('.history-list');
    if (list) {
      list.innerHTML = renderHistoryList();
      wireHistoryList();
      document.querySelector('.history-item.selected')?.scrollIntoView({ block: 'nearest' });
    }
  }

  function wireHistory() {
    const input = /** @type {HTMLInputElement|null} */ (document.querySelector('.history-filter'));
    if (!input) {
      return;
    }
    input.focus();
    input.selectionStart = input.value.length;
    input.addEventListener('input', () => {
      historyFilter = input.value;
      historyIndex = 0;
      refreshHistoryList();
    });
    input.addEventListener('keydown', (event) => {
      const count = filteredHistory().length;
      if (event.key === 'Escape') {
        closeMenu();
      } else if (event.key === 'ArrowDown' && count) {
        event.preventDefault();
        historyIndex = (historyIndex + 1) % count;
        refreshHistoryList();
      } else if (event.key === 'ArrowUp' && count) {
        event.preventDefault();
        historyIndex = (historyIndex - 1 + count) % count;
        refreshHistoryList();
      } else if (event.key === 'Enter' && count) {
        event.preventDefault();
        openHistory(filteredHistory()[historyIndex].id);
      }
    });
    wireHistoryList();
  }

  function renderModelMenu() {
    const models = modelMenuItems();
    let html = `<div class="menu-title">${escapeHtml(t('model.menuTitle'))}</div>`;
    let group = '';
    models.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        html += `<div class="model-group">${escapeHtml(group)}</div>`;
      }
      html += `<div class="model-item${item.active ? ' active' : ''}" data-model-index="${index}">
        <div class="model-text">
          <div class="model-name">${escapeHtml(item.label)}</div>
          ${item.description ? `<div class="model-desc">${escapeHtml(item.description)}</div>` : ''}
        </div>
        ${item.active ? `<span class="model-check">${ICONS.check}</span>` : ''}
      </div>`;
    });
    if (!models.length) {
      html += `<div class="model-group">${escapeHtml(t('model.noneActive'))}</div>`;
    }
    const options = modelOptions()
      .map(
        (item, index) => `<div class="palette-item option-item" data-option-index="${index}">
        <span class="label">${escapeHtml(item.label)}${item.suffix ? ` <span class="suffix">(${escapeHtml(item.suffix)})</span>` : ''}</span>
        ${renderControl(item)}
      </div>`
      )
      .join('');
    return `<div class="palette-wrap"><div class="palette model-menu">
      <div class="palette-list">${html}</div>
      ${options ? `<div class="menu-footer">${options}</div>` : ''}
    </div></div>`;
  }

  /** Effort and thinking controls, only where the current model supports them. */
  function modelOptions() {
    return [
      effortItem(t('group.options')),
      currentProvider()?.supportsThinking ? thinkingItem(t('group.options')) : null,
      permissionItem(t('group.options'))
    ].filter(Boolean);
  }

  // ---------- settings modal ----------

  function openSettings(tab) {
    settingsOpen = true;
    settingsTab = tab;
    settingsError = '';
    post({ type: 'getSettings' });
    renderModal();
  }

  function closeSettings() {
    settingsOpen = false;
    mcpDraft = null;
    skillStatus = null;
    addingProvider = false;
    renderModal();
  }

  function saveSetting(payload) {
    settingsError = '';
    post({ type: 'settings', ...payload });
  }

  /** Re-renders the modal, keeping unsaved input values and focus. */
  function renderModal() {
    if (!settingsOpen) {
      modalRoot.innerHTML = '';
      return;
    }
    const kept = {};
    modalRoot.querySelectorAll('[data-keep]').forEach((element) => {
      const input = /** @type {HTMLInputElement} */ (element);
      if (input.dataset.dirty === '1') {
        kept[input.dataset.keep ?? ''] = input.value;
      }
    });
    const focused = /** @type {HTMLElement|null} */ (document.activeElement)?.dataset?.keep;
    const bodyScroll = modalRoot.querySelector('.modal-body')?.scrollTop ?? 0;
    const modelScroll = {};
    modalRoot.querySelectorAll('.model-rows').forEach((element) => {
      modelScroll[/** @type {HTMLElement} */ (element).dataset.provider ?? ''] = element.scrollTop;
    });

    const tabs = [
      ['providers', t('tab.providers')],
      ['mcp', t('tab.mcp')],
      ['skills', t('tab.skills')],
      ['general', t('tab.general')]
    ];
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-act="close-backdrop">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">${ICONS.gear}<span>${escapeHtml(t('settings.title'))}</span></div>
          <button class="icon-button" data-modal-act="close" title="${escapeHtml(t('common.close'))}">${ICONS.close}</button>
        </div>
        <div class="modal-tabs">${tabs
          .map(
            ([id, label]) =>
              `<button class="tab${settingsTab === id ? ' on' : ''}" data-modal-act="tab" data-tab="${id}">${escapeHtml(label)}</button>`
          )
          .join('')}</div>
        ${settingsError ? `<div class="modal-error">${escapeHtml(settingsError)}</div>` : ''}
        <div class="modal-body">${
          !settings
            ? `<div class="muted-block">${escapeHtml(t('common.loading'))}</div>`
            : settingsTab === 'providers'
              ? renderProvidersTab()
              : settingsTab === 'mcp'
                ? renderMcpTab()
                : settingsTab === 'skills'
                  ? renderSkillsTab()
                  : renderGeneralTab()
        }</div>
      </div>
    </div>`;

    modalRoot.querySelectorAll('[data-keep]').forEach((element) => {
      const input = /** @type {HTMLInputElement} */ (element);
      const key = input.dataset.keep ?? '';
      if (key in kept) {
        input.value = kept[key];
        input.dataset.dirty = '1';
      }
      input.addEventListener('input', () => (input.dataset.dirty = '1'));
      if (key === focused) {
        input.focus();
      }
    });
    const body = modalRoot.querySelector('.modal-body');
    if (body) {
      body.scrollTop = bodyScroll;
    }
    modalRoot.querySelectorAll('.model-rows').forEach((element) => {
      element.scrollTop = modelScroll[/** @type {HTMLElement} */ (element).dataset.provider ?? ''] ?? 0;
    });
    wireModal();
  }

  function field(label, control, hint) {
    return `<label class="field"><span class="field-label">${escapeHtml(label)}</span>${control}${
      hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : ''
    }</label>`;
  }

  function textInput(key, value, attrs = '') {
    return `<input class="input" data-keep="${escapeHtml(key)}" value="${escapeHtml(value ?? '')}" ${attrs} />`;
  }

  function select(key, value, options) {
    return `<select class="input" data-keep="${escapeHtml(key)}">${options
      .map(([id, label]) => `<option value="${escapeHtml(id)}"${id === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')}</select>`;
  }

  function renderProvidersTab() {
    const cards = settings.providers.map(renderProviderCard).join('');
    const filter =
      settings.providers.length > 8
        ? `<input class="input provider-search" placeholder="${escapeHtml(t('providers.filter'))}" />`
        : '';
    const addForm = addingProvider
      ? `<div class="card">
          <div class="card-title">${escapeHtml(t('providers.newTitle'))}</div>
          ${field(t('field.id'), textInput('new.id', '', `placeholder="${escapeHtml(t('common.eg', { value: 'openrouter' }))}"`))}
          ${field(t('field.name'), textInput('new.label', '', 'placeholder="OpenRouter"'))}
          ${field(t('field.baseUrl'), textInput('new.baseUrl', '', 'placeholder="https://openrouter.ai/api/v1"'))}
          ${field(t('field.apiFormat'), select('new.api', 'openai', [['openai', 'OpenAI Chat Completions'], ['anthropic', 'Anthropic Messages']]))}
          ${field(t('field.models'), textInput('new.models', '', `placeholder="${escapeHtml(t('field.modelsPlaceholder'))}"`), t('field.modelsHint'))}
          ${field(t('field.apiKey'), textInput('new.apiKey', '', 'type="password" autocomplete="off"'))}
          <div class="row-actions">
            <button class="btn" data-modal-act="add-provider-cancel">${escapeHtml(t('common.cancel'))}</button>
            <button class="btn primary" data-modal-act="add-provider-save">${escapeHtml(t('common.create'))}</button>
          </div>
        </div>`
      : `<button class="btn wide" data-modal-act="add-provider">${escapeHtml(t('providers.add'))}</button>`;
    return `<div class="tab-intro">${escapeHtml(t('providers.intro'))}</div>${filter}${cards}${addForm}`;
  }

  function renderProviderCard(provider) {
    const open = expandedProviders.has(provider.id);
    const check = providerChecks[provider.id];
    const kindLabel = provider.kind === 'cli' ? 'CLI' : 'API';
    const enabledModels = provider.models.filter((m) => m.enabled).length;

    let body = '';
    if (open) {
      const apiKey = field(
        t('field.apiKey'),
        `<div class="inline">${textInput(`p.${provider.id}.apiKey`, '', `type="password" autocomplete="off" placeholder="${escapeHtml(t(provider.hasApiKey ? 'key.saved' : 'key.unset'))}"`)}
          <button class="btn" data-modal-act="secret-save" data-provider="${escapeHtml(provider.id)}" data-which="api">${escapeHtml(t('common.save'))}</button>
          ${provider.hasApiKey ? `<button class="btn ghost" data-modal-act="secret-clear" data-provider="${escapeHtml(provider.id)}" data-which="api">${escapeHtml(t('common.delete'))}</button>` : ''}</div>`,
        provider.apiKeyEnv ? t('field.cliKeyHint', { env: provider.apiKeyEnv }) : undefined
      );
      const connection =
        provider.kind === 'cli'
          ? `${field(
              t('field.cliCommand'),
              textInput(`p.${provider.id}.command`, provider.command, `data-save="providerField" data-provider="${escapeHtml(provider.id)}" data-field="command"`),
              t(provider.needsApiKey ? 'field.cliKeyCommandHint' : 'field.cliHint')
            )}
            ${provider.needsApiKey ? apiKey : ''}`
          : `${field(
              t('field.baseUrl'),
              textInput(`p.${provider.id}.baseUrl`, provider.baseUrl, `data-save="providerField" data-provider="${escapeHtml(provider.id)}" data-field="baseUrl"`)
            )}
            ${apiKey}`;

      const admin = field(
        t('field.adminKey'),
        `<div class="inline">${textInput(`p.${provider.id}.adminKey`, '', `type="password" autocomplete="off" placeholder="${escapeHtml(t(provider.hasAdminKey ? 'key.saved' : 'key.unset'))}"`)}
          <button class="btn" data-modal-act="secret-save" data-provider="${escapeHtml(provider.id)}" data-which="admin">${escapeHtml(t('common.save'))}</button>
          ${provider.hasAdminKey ? `<button class="btn ghost" data-modal-act="secret-clear" data-provider="${escapeHtml(provider.id)}" data-which="admin">${escapeHtml(t('common.delete'))}</button>` : ''}</div>`,
        t('field.adminHint')
      );

      const models = provider.models
        .map(
          (model) => `<div class="model-row" data-search="${escapeHtml(`${model.label} ${model.id}`.toLowerCase())}">
            <span class="model-row-name">${escapeHtml(model.label)}<span class="model-row-id">${escapeHtml(model.id)}</span></span>
            ${model.custom ? `<button class="btn ghost small" data-modal-act="remove-model" data-provider="${escapeHtml(provider.id)}" data-model="${escapeHtml(model.id)}">${escapeHtml(t('common.remove'))}</button>` : ''}
            <div class="switch${model.enabled ? ' on' : ''}" data-modal-act="toggle-model" data-provider="${escapeHtml(provider.id)}" data-model="${escapeHtml(model.id)}" data-enabled="${model.enabled ? '1' : '0'}"><div class="knob"></div></div>
          </div>`
        )
        .join('');

      body = `<div class="card-body">
        ${connection}
        <div class="inline check-row">
          <button class="btn" data-modal-act="check" data-provider="${escapeHtml(provider.id)}">${escapeHtml(t('providers.check'))}</button>
          ${check ? `<span class="${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓' : '✗'} ${escapeHtml(check.detail)}</span>` : ''}
        </div>
        <div class="section-head">
          <span class="section-label">${escapeHtml(t('field.models'))}</span>
          ${
            provider.kind === 'http'
              ? `<button class="btn small" data-modal-act="fetch-models" data-provider="${escapeHtml(provider.id)}" title="GET ${escapeHtml(provider.baseUrl ?? '')}/models">${escapeHtml(t('providers.fetchModels'))}</button>`
              : ''
          }
          <button class="btn ghost small" data-modal-act="all-models" data-provider="${escapeHtml(provider.id)}" data-enabled="1">${escapeHtml(t('providers.allOn'))}</button>
          <button class="btn ghost small" data-modal-act="all-models" data-provider="${escapeHtml(provider.id)}" data-enabled="0">${escapeHtml(t('providers.allOff'))}</button>
        </div>
        ${
          provider.models.length > 8
            ? `<input class="input model-search" data-provider="${escapeHtml(provider.id)}" placeholder="${escapeHtml(t('providers.filterModels'))}" />`
            : ''
        }
        <div class="model-rows" data-provider="${escapeHtml(provider.id)}">${models || `<div class="muted-block">${escapeHtml(t('providers.noModels'))}</div>`}</div>
        <div class="inline">
          ${textInput(`p.${provider.id}.newModel`, '', `placeholder="${escapeHtml(t('providers.moreModel'))}"`)}
          <button class="btn" data-modal-act="add-model" data-provider="${escapeHtml(provider.id)}">${escapeHtml(t('common.add'))}</button>
        </div>
        ${admin}
        <div class="row-actions">
          ${
            provider.builtin
              ? `<button class="btn ghost" data-modal-act="reset-provider" data-provider="${escapeHtml(provider.id)}">${escapeHtml(t('providers.reset'))}</button>`
              : `<button class="btn danger" data-modal-act="remove-provider" data-provider="${escapeHtml(provider.id)}">${escapeHtml(t('providers.remove'))}</button>`
          }
        </div>
      </div>`;
    }

    const search = `${provider.label} ${provider.id} ${provider.baseUrl ?? ''} ${provider.command ?? ''}`.toLowerCase();
    return `<div class="card provider-card${provider.enabled ? '' : ' off'}" data-search="${escapeHtml(search)}">
      <div class="card-head" data-modal-act="expand" data-provider="${escapeHtml(provider.id)}">
        <span class="chev${open ? ' open' : ''}">${ICONS.chevron}</span>
        <div class="card-head-text">
          <div class="card-name">${escapeHtml(provider.label)} <span class="badge">${kindLabel}</span></div>
          <div class="card-sub">${escapeHtml(t('providers.activeCount', { on: enabledModels, total: provider.models.length }))}${provider.description ? ` · ${escapeHtml(provider.description)}` : ''}</div>
        </div>
        <div class="switch${provider.enabled ? ' on' : ''}" data-modal-act="toggle-provider" data-provider="${escapeHtml(provider.id)}" data-enabled="${provider.enabled ? '1' : '0'}"><div class="knob"></div></div>
      </div>
      ${body}
    </div>`;
  }

  function renderMcpTab() {
    const servers = Object.entries(settings.mcpServers ?? {});
    const list = servers
      .map(([name, server]) => {
        const detail = server.url ? `${server.type ?? 'http'} · ${server.url}` : [server.command, ...(server.args ?? [])].join(' ');
        return `<div class="card${server.disabled ? ' off' : ''}">
          <div class="card-head static">
            <div class="card-head-text">
              <div class="card-name">${escapeHtml(name)} <span class="badge">${server.url ? escapeHtml((server.type ?? 'http').toUpperCase()) : 'STDIO'}</span></div>
              <div class="card-sub mono">${escapeHtml(detail)}</div>
            </div>
            <button class="btn ghost small" data-modal-act="mcp-edit" data-name="${escapeHtml(name)}">${escapeHtml(t('common.edit'))}</button>
            <button class="btn ghost small" data-modal-act="mcp-remove" data-name="${escapeHtml(name)}">${escapeHtml(t('common.delete'))}</button>
            <div class="switch${server.disabled ? '' : ' on'}" data-modal-act="mcp-toggle" data-name="${escapeHtml(name)}" data-enabled="${server.disabled ? '0' : '1'}"><div class="knob"></div></div>
          </div>
        </div>`;
      })
      .join('');

    let form = `<button class="btn wide" data-modal-act="mcp-new">${escapeHtml(t('mcp.add'))}</button>`;
    if (mcpDraft) {
      const server = mcpDraft.server;
      const type = server.url !== undefined || server.type === 'http' || server.type === 'sse' ? server.type ?? 'http' : 'stdio';
      const envText = Object.entries(server.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
      const headerText = Object.entries(server.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      form = `<div class="card">
        <div class="card-title">${escapeHtml(t(mcpDraft.previousName ? 'mcp.editTitle' : 'mcp.newTitle'))}</div>
        ${field(t('field.name'), textInput('mcp.name', mcpDraft.name, `placeholder="${escapeHtml(t('common.eg', { value: 'github' }))}"`))}
        ${field(t('mcp.type'), select('mcp.type', type, [['stdio', t('mcp.stdio')], ['http', 'HTTP'], ['sse', 'SSE']]))}
        <div class="mcp-stdio"${type === 'stdio' ? '' : ' hidden'}>
          ${field(t('mcp.command'), textInput('mcp.command', server.command ?? '', 'placeholder="npx"'))}
          ${field(t('mcp.args'), `<textarea class="input" rows="3" data-keep="mcp.args" placeholder="-y&#10;@modelcontextprotocol/server-github">${escapeHtml((server.args ?? []).join('\n'))}</textarea>`, t('mcp.argsHint'))}
          ${field(t('mcp.env'), `<textarea class="input" rows="2" data-keep="mcp.env" placeholder="GITHUB_TOKEN=…">${escapeHtml(envText)}</textarea>`, t('mcp.envHint'))}
        </div>
        <div class="mcp-http"${type === 'stdio' ? ' hidden' : ''}>
          ${field('URL', textInput('mcp.url', server.url ?? '', 'placeholder="https://…/mcp"'))}
          ${field(t('mcp.headers'), `<textarea class="input" rows="2" data-keep="mcp.headers" placeholder="Authorization: Bearer …">${escapeHtml(headerText)}</textarea>`, t('mcp.headersHint'))}
        </div>
        <div class="row-actions">
          <button class="btn" data-modal-act="mcp-cancel">${escapeHtml(t('common.cancel'))}</button>
          <button class="btn primary" data-modal-act="mcp-save">${escapeHtml(t('common.save'))}</button>
        </div>
      </div>`;
    }

    return `<div class="tab-intro">${t('mcp.intro')}</div>
      ${list || `<div class="muted-block">${escapeHtml(t('mcp.none'))}</div>`}
      ${form}`;
  }

  function renderSkillsTab() {
    const skills = settings.skills ?? { installed: [], importable: [], root: '' };
    const list = skills.installed
      .map(
        (skill) => `<div class="card${skill.enabled ? '' : ' off'}">
          <div class="card-head static">
            <div class="card-head-text">
              <div class="card-name">/${escapeHtml(skill.name)}</div>
              <div class="card-sub skill-desc" title="${escapeHtml(skill.description)}">${escapeHtml(skill.description || t('skills.noDescription'))}</div>
            </div>
            <button class="btn ghost small" data-modal-act="skill-reveal" data-name="${escapeHtml(skill.name)}">${escapeHtml(t('skills.folder'))}</button>
            <button class="btn ghost small" data-modal-act="skill-remove" data-name="${escapeHtml(skill.name)}">${escapeHtml(t('common.delete'))}</button>
            <div class="switch${skill.enabled ? ' on' : ''}" data-modal-act="skill-toggle" data-name="${escapeHtml(skill.name)}" data-enabled="${skill.enabled ? '1' : '0'}"><div class="knob"></div></div>
          </div>
        </div>`
      )
      .join('');

    const importable = skills.importable.length
      ? `<div class="card"><div class="card-body">
          <div class="card-name">${escapeHtml(skills.importable.length === 1 ? t('skills.foundOne') : t('skills.foundMany', { count: skills.importable.length }))}</div>
          <div class="card-sub">${escapeHtml(skills.importable.map((s) => `${s.name} (${s.from})`).join(', '))}</div>
          <div class="row-actions"><button class="btn primary" data-modal-act="skill-import">${escapeHtml(t('skills.importAll'))}</button></div>
        </div></div>`
      : '';

    const status = skillStatus
      ? `<span class="${skillStatus.ok ? 'ok' : 'bad'}">${skillStatus.ok ? '✓' : '✗'} ${escapeHtml(skillStatus.detail)}</span>`
      : '';

    return `<div class="tab-intro">${t('skills.intro')}</div>
      <div class="card"><div class="card-body">
        ${field(t('skills.installFrom'), textInput('skill.source', '', `placeholder="${escapeHtml(t('skills.sourcePlaceholder'))}"`), t('skills.sourceHint'))}
        <div class="inline check-row">
          <button class="btn primary" data-modal-act="skill-install">${escapeHtml(t('skills.install'))}</button>
          <button class="btn" data-modal-act="skill-pick">${escapeHtml(t('skills.pick'))}</button>
          <button class="btn ghost" data-modal-act="skill-reveal">${escapeHtml(t('skills.openFolder'))}</button>
          ${status}
        </div>
        <div class="card-sub mono">${escapeHtml(skills.root)}</div>
      </div></div>
      ${importable}
      ${list || `<div class="muted-block">${escapeHtml(t('skills.none'))}</div>`}`;
  }

  function renderGeneralTab() {
    const general = settings.general;
    const providerOptions = settings.providers.filter((p) => p.enabled).map((p) => [p.id, p.label]);
    return `<div class="card"><div class="card-body">
      ${field(
        t('general.language'),
        select('g.language', general.language ?? 'auto', [['auto', t('general.languageAuto')], ...(general.languages ?? [])])
      )}
      ${field(t('general.defaultProvider'), select('g.defaultProvider', general.defaultProvider, providerOptions))}
      ${field(
        t('general.claudePermission'),
        select('g.claudePermissionMode', general.claudePermissionMode, [
          ['plan', `plan (${t('general.permPlan')})`],
          ['manual', `manual (${t('general.permManual')})`],
          ['dontAsk', `dontAsk (${t('general.permDontAsk')})`],
          ['acceptEdits', `acceptEdits (${t('general.permAcceptEdits')})`],
          ['auto', `auto (${t('general.permAuto')})`],
          ['bypassPermissions', `bypassPermissions (${t('general.permBypass')})`]
        ])
      )}
      ${field(
        t('general.codexSandbox'),
        select('g.codexSandbox', general.codexSandbox, [
          ['read-only', 'read-only'],
          ['workspace-write', 'workspace-write'],
          ['danger-full-access', 'danger-full-access']
        ])
      )}
      ${field(
        t('general.httpPermission'),
        select('g.httpPermissionMode', general.httpPermissionMode ?? 'write', [
          ['readonly', `readonly (${t('general.permReadonly')})`],
          ['edit', `edit (${t('general.permEditOnly')})`],
          ['write', `write (${t('general.permWrite')})`],
          ['auto', `auto (${t('general.permFullAuto')})`]
        ])
      )}
      ${field(
        t('general.planParallel'),
        textInput('g.planMaxParallelTasks', general.planMaxParallelTasks ?? 4, 'type="number" min="1" max="8" step="1"'),
        t('general.planParallelHint')
      )}
      ${field(
        t('general.contextBudget'),
        textInput('g.contextTokenBudget', general.contextTokenBudget ?? 1400, 'type="number" min="400" max="8000" step="100"'),
        t('general.contextBudgetHint')
      )}
    </div></div>`;
  }

  function inputValue(key) {
    const element = /** @type {HTMLInputElement|null} */ (modalRoot.querySelector(`[data-keep="${CSS.escape(key)}"]`));
    return element?.value ?? '';
  }

  function clearDirty(keys) {
    for (const key of keys) {
      const element = /** @type {HTMLInputElement|null} */ (modalRoot.querySelector(`[data-keep="${CSS.escape(key)}"]`));
      if (element) {
        element.value = '';
        element.dataset.dirty = '';
      }
    }
  }

  function parseLines(text, separator) {
    const result = {};
    for (const line of text.split('\n')) {
      const index = line.indexOf(separator);
      if (index > 0) {
        result[line.slice(0, index).trim()] = line.slice(index + separator.length).trim();
      }
    }
    return result;
  }

  function wireModal() {
    modalRoot.querySelectorAll('[data-save="providerField"]').forEach((element) => {
      const input = /** @type {HTMLInputElement} */ (element);
      input.addEventListener('change', () => {
        input.dataset.dirty = '';
        saveSetting({ op: 'providerField', providerId: input.dataset.provider, field: input.dataset.field, value: input.value });
      });
    });

    modalRoot.querySelectorAll('select[data-keep^="g."], input[data-keep^="g."]').forEach((element) => {
      const input = /** @type {HTMLSelectElement} */ (element);
      input.addEventListener('change', () => {
        input.dataset.dirty = '';
        saveSetting({ op: 'general', key: (input.dataset.keep ?? '').slice(2), value: input.value });
      });
    });

    const providerFilter = /** @type {HTMLInputElement|null} */ (modalRoot.querySelector('.provider-search'));
    if (providerFilter) {
      const apply = () => {
        const needle = providerFilter.value.trim().toLowerCase();
        providerSearch = providerFilter.value;
        modalRoot
          .querySelectorAll('.provider-card')
          .forEach((card) => card.toggleAttribute('hidden', Boolean(needle) && !(/** @type {HTMLElement} */ (card).dataset.search ?? '').includes(needle)));
      };
      providerFilter.value = providerSearch;
      apply();
      providerFilter.addEventListener('input', apply);
    }

    modalRoot.querySelectorAll('.model-search').forEach((element) => {
      const input = /** @type {HTMLInputElement} */ (element);
      const providerId = input.dataset.provider ?? '';
      const apply = () => {
        const needle = input.value.trim().toLowerCase();
        modelSearch[providerId] = input.value;
        modalRoot
          .querySelectorAll(`.model-rows[data-provider="${CSS.escape(providerId)}"] .model-row`)
          .forEach((row) => row.toggleAttribute('hidden', Boolean(needle) && !(/** @type {HTMLElement} */ (row).dataset.search ?? '').includes(needle)));
      };
      input.value = modelSearch[providerId] ?? '';
      apply();
      input.addEventListener('input', apply);
    });

    const mcpType = /** @type {HTMLSelectElement|null} */ (modalRoot.querySelector('[data-keep="mcp.type"]'));
    mcpType?.addEventListener('change', () => {
      const stdio = mcpType.value === 'stdio';
      modalRoot.querySelector('.mcp-stdio')?.toggleAttribute('hidden', !stdio);
      modalRoot.querySelector('.mcp-http')?.toggleAttribute('hidden', stdio);
    });

    modalRoot.querySelectorAll('[data-modal-act]').forEach((element) => {
      const el = /** @type {HTMLElement} */ (element);
      el.addEventListener('click', (event) => {
        const act = el.dataset.modalAct;
        const providerId = el.dataset.provider;
        if (act === 'close-backdrop') {
          if (event.target === el) {
            closeSettings();
          }
          return;
        }
        event.stopPropagation();

        switch (act) {
          case 'close':
            closeSettings();
            return;
          case 'tab':
            settingsTab = el.dataset.tab ?? 'providers';
            settingsError = '';
            renderModal();
            return;
          case 'expand':
            if (providerId && expandedProviders.has(providerId)) {
              expandedProviders.delete(providerId);
            } else if (providerId) {
              expandedProviders.add(providerId);
            }
            renderModal();
            return;
          case 'toggle-provider':
            saveSetting({ op: 'providerEnabled', providerId, enabled: el.dataset.enabled !== '1' });
            return;
          case 'toggle-model':
            saveSetting({ op: 'modelEnabled', providerId, modelId: el.dataset.model, enabled: el.dataset.enabled !== '1' });
            return;
          case 'fetch-models':
            providerChecks[providerId ?? ''] = { ok: true, detail: t('providers.fetching') };
            renderModal();
            saveSetting({ op: 'fetchModels', providerId });
            return;
          case 'all-models':
            saveSetting({ op: 'setAllModels', providerId, enabled: el.dataset.enabled === '1' });
            return;
          case 'remove-model':
            saveSetting({ op: 'removeModel', providerId, modelId: el.dataset.model });
            return;
          case 'add-model': {
            const key = `p.${providerId}.newModel`;
            const modelId = inputValue(key).trim();
            if (modelId) {
              clearDirty([key]);
              saveSetting({ op: 'addModel', providerId, modelId });
            }
            return;
          }
          case 'secret-save': {
            const key = `p.${providerId}.${el.dataset.which === 'admin' ? 'adminKey' : 'apiKey'}`;
            const value = inputValue(key);
            if (value) {
              clearDirty([key]);
              saveSetting({ op: 'setSecret', providerId, which: el.dataset.which, value });
            }
            return;
          }
          case 'secret-clear':
            saveSetting({ op: 'setSecret', providerId, which: el.dataset.which, value: '' });
            return;
          case 'check':
            providerChecks[providerId ?? ''] = { ok: true, detail: t('providers.checking') };
            renderModal();
            saveSetting({ op: 'checkProvider', providerId });
            return;
          case 'reset-provider':
            saveSetting({ op: 'resetProvider', providerId });
            return;
          case 'remove-provider':
            expandedProviders.delete(providerId ?? '');
            saveSetting({ op: 'removeProvider', providerId });
            return;
          case 'add-provider':
            addingProvider = true;
            renderModal();
            return;
          case 'add-provider-cancel':
            addingProvider = false;
            renderModal();
            return;
          case 'add-provider-save': {
            const keys = ['new.id', 'new.label', 'new.baseUrl', 'new.api', 'new.models', 'new.apiKey'];
            const [id, label, baseUrl, api, models, apiKey] = keys.map(inputValue);
            saveSetting({ op: 'addProvider', id, label, baseUrl, api, models, apiKey });
            addingProvider = false;
            clearDirty(keys);
            return;
          }
          case 'mcp-new':
            mcpDraft = { previousName: '', name: '', server: { command: '', args: [] } };
            renderModal();
            return;
          case 'mcp-edit': {
            const name = el.dataset.name ?? '';
            mcpDraft = { previousName: name, name, server: { ...(settings.mcpServers?.[name] ?? {}) } };
            renderModal();
            return;
          }
          case 'mcp-cancel':
            mcpDraft = null;
            renderModal();
            return;
          case 'mcp-save': {
            const type = inputValue('mcp.type');
            const server =
              type === 'stdio'
                ? {
                    command: inputValue('mcp.command'),
                    args: inputValue('mcp.args').split('\n').map((a) => a.trim()).filter(Boolean),
                    env: parseLines(inputValue('mcp.env'), '=')
                  }
                : { type, url: inputValue('mcp.url'), headers: parseLines(inputValue('mcp.headers'), ':') };
            saveSetting({ op: 'mcpSet', previousName: mcpDraft?.previousName, name: inputValue('mcp.name'), server });
            mcpDraft = null;
            return;
          }
          case 'mcp-toggle':
            saveSetting({ op: 'mcpToggle', name: el.dataset.name, enabled: el.dataset.enabled !== '1' });
            return;
          case 'mcp-remove':
            saveSetting({ op: 'mcpRemove', name: el.dataset.name });
            return;
          case 'skill-install': {
            const source = inputValue('skill.source').trim();
            if (source) {
              skillStatus = { ok: true, detail: t('skills.installing') };
              clearDirty(['skill.source']);
              saveSetting({ op: 'skillInstall', source });
              renderModal();
            }
            return;
          }
          case 'skill-pick':
            saveSetting({ op: 'skillPick' });
            return;
          case 'skill-import':
            saveSetting({ op: 'skillImport' });
            return;
          case 'skill-toggle':
            saveSetting({ op: 'skillToggle', name: el.dataset.name, enabled: el.dataset.enabled !== '1' });
            return;
          case 'skill-remove':
            saveSetting({ op: 'skillRemove', name: el.dataset.name });
            return;
          case 'skill-reveal':
            post({ type: 'settings', op: 'skillReveal', name: el.dataset.name });
            return;
          default:
            return;
        }
      });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsOpen) {
      closeSettings();
    }
  });

  // ---------- events ----------

  function wire() {
    const textarea = /** @type {HTMLTextAreaElement|null} */ (document.querySelector('.composer textarea'));
    if (textarea) {
      autoGrow(textarea);
      textarea.addEventListener('input', () => {
        draft = textarea.value;
        autoGrow(textarea);
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          send();
        } else if (event.key === '/' && textarea.value === '') {
          event.preventDefault();
          menu = 'palette';
          render();
        } else if (event.key === 'Escape' && menu) {
          closeMenu();
        }
      });
      if (!menu && !settingsOpen) {
        textarea.focus();
        textarea.selectionStart = textarea.value.length;
      }
    }

    const filter = /** @type {HTMLInputElement|null} */ (document.querySelector('.palette-filter'));
    if (filter) {
      filter.focus();
      filter.selectionStart = filter.value.length;
      filter.addEventListener('input', () => {
        paletteFilter = filter.value;
        const list = document.querySelector('.palette-list');
        if (list) {
          list.innerHTML = renderItemList(filterItems(paletteItems()));
          wireMenuItems();
        }
      });
      filter.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeMenu();
        } else if (event.key === 'Enter') {
          /** @type {HTMLElement|null} */ (document.querySelector('.palette-item'))?.click();
        }
      });
    }

    const modelMenu = /** @type {HTMLElement|null} */ (document.querySelector('.model-menu'));
    if (modelMenu) {
      modelMenu.tabIndex = -1;
      modelMenu.focus();
      modelMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeMenu();
        }
      });
    }

    wireMenuItems();
    wireHistory();

    document.querySelector('.scroll')?.addEventListener('mousedown', () => {
      if (menu) {
        closeMenu();
      }
    });

    document.querySelectorAll('[data-act]:not(.handoff [data-act])').forEach((element) => {
      element.addEventListener('click', () => {
        const act = element.getAttribute('data-act');
        if (act === 'send') {
          send();
        } else if (act === 'abort') {
          post({ type: 'abort' });
        } else if (act === 'new') {
          draft = '';
          menu = null;
          post({ type: 'newChat' });
        } else if (act === 'history') {
          menu = menu === 'history' ? null : 'history';
          historyFilter = '';
          historyIndex = 0;
          if (menu) {
            post({ type: 'history' });
          }
          render();
        } else if (act === 'attach') {
          post({ type: 'attachFile' });
        } else if (act === 'palette') {
          menu = menu === 'palette' ? null : 'palette';
          paletteFilter = '';
          if (menu && !settings) {
            post({ type: 'getSettings' });
          }
          render();
        } else if (act === 'model') {
          menu = menu === 'models' ? null : 'models';
          render();
        } else if (act === 'permission') {
          const levels = permissionLevels();
          const current = currentPermission();
          const index = levels.indexOf(current);
          post({ type: 'setPermission', mode: levels[(index + 1) % levels.length] });
        } else if (act === 'refreshLimits') {
          post({ type: 'refreshLimits' });
        }
      });
    });

    document.querySelectorAll('.attachment-remove').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'removeAttachment', id: element.getAttribute('data-remove') });
      });
    });

    textarea?.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        attachFiles(files);
      }
    });

    wireToolHeads();
    wireHandoff();
    wireModes();
  }

  /** Mode tabs, mode questions and plan cards, re-bound after every repaint. */
  function wireModes() {
    document.querySelectorAll('.mode-tab').forEach((element) => {
      element.addEventListener('click', () => {
        const mode = element.getAttribute('data-mode');
        if (mode && mode !== currentMode()) {
          post({ type: 'setMode', mode });
        }
      });
    });
    document.querySelectorAll('[data-pending]').forEach((element) => {
      element.addEventListener('click', () => resolvePending(element.getAttribute('data-pending')));
    });
    document.querySelectorAll('.plan-card').forEach((element) => {
      const open = () =>
        post({
          type: 'openPlan',
          messageId: element.getAttribute('data-plan-message'),
          path: element.getAttribute('data-plan-path') || undefined
        });
      element.querySelector('[data-plan-open]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });
      element.addEventListener('click', () => {
        if (!window.getSelection()?.toString()) {
          open();
        }
      });
    });
  }

  function wireMenuItems() {
    const paletteList = filterItems(paletteItems());
    const models = modelMenuItems();
    const options = modelOptions();

    document.querySelectorAll('.palette-item, .model-item').forEach((element) => {
      const el = /** @type {HTMLElement} */ (element);
      el.addEventListener('click', () => {
        if (el.dataset.modelIndex !== undefined) {
          models[Number(el.dataset.modelIndex)]?.run();
        } else if (el.dataset.optionIndex !== undefined) {
          options[Number(el.dataset.optionIndex)]?.run();
        } else {
          paletteList[Number(el.dataset.index)]?.run?.();
        }
      });
    });

    document.querySelectorAll('.dot[data-effort]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'setEffort', effort: /** @type {HTMLElement} */ (element).dataset.effort });
      });
    });

    document.querySelectorAll('.dot[data-permission]').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'setPermission', mode: /** @type {HTMLElement} */ (element).dataset.permission });
      });
    });
  }

  /** Buttons inside the transcript, re-bound after every transcript repaint. */
  function wireHandoff() {
    document.querySelectorAll('.handoff [data-act]').forEach((element) => {
      element.addEventListener('click', () => {
        const act = element.getAttribute('data-act');
        if (act === 'handoff-accept') {
          streaming = true;
          post({ type: 'handoffAccept' });
        } else if (act === 'handoff-dismiss') {
          post({ type: 'handoffDismiss' });
        } else if (act === 'handoff-change') {
          menu = 'models';
          render();
        }
      });
    });
  }

  function wireToolHeads() {
    const toggle = (set, id) => {
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      renderTranscript();
    };
    document.querySelectorAll('.step-tool .tool-head, .step-tool .io').forEach((el) => {
      el.addEventListener('click', () => {
        if (window.getSelection()?.toString()) {
          return;
        }
        const id = el.closest('.step-tool')?.getAttribute('data-tool');
        if (id) {
          toggle(expandedTools, id);
        }
      });
    });
    document.querySelectorAll('.step-thinking .step-head').forEach((head) => {
      head.addEventListener('click', () => {
        const id = head.parentElement?.getAttribute('data-thinking');
        if (id) {
          toggle(expandedThinking, id);
        }
      });
    });
  }

  /** Repaints only the transcript, so the composer keeps focus and caret. */
  function renderTranscript() {
    const scroll = document.querySelector('.scroll');
    if (!scroll) {
      render();
      return;
    }
    const atBottom = wasAtBottom();
    scroll.innerHTML = renderBody();
    wireToolHeads();
    wireHandoff();
    wireModes();
    if (atBottom) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  let frameQueued = false;
  function scheduleTranscript() {
    if (frameQueued) {
      return;
    }
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      renderTranscript();
    });
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 260) + 'px';
  }

  function send() {
    const text = draft.trim();
    if ((!text && !(state.attachments ?? []).length) || state.running) {
      return;
    }
    draft = '';
    streaming = true;
    post({ type: 'send', text });
  }

  // ---------- drag & drop ----------

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return btoa(binary);
  }

  /** Files without a path (Finder, clipboard) travel as base64; the extension stores them. */
  function attachFiles(files) {
    for (const file of files) {
      if (file.size > MAX_DROP_BYTES) {
        post({ type: 'notify', text: t('drop.tooBig', { name: file.name }) });
        continue;
      }
      file.arrayBuffer().then((buffer) =>
        post({ type: 'addAttachmentData', name: file.name || 'clipboard.png', mime: file.type, data: toBase64(buffer) })
      );
    }
  }

  function setDragging(on) {
    document.querySelector('.composer')?.classList.toggle('dragging', on);
  }

  document.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth++;
    setDragging(true);
  });
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      setDragging(false);
    }
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    const data = event.dataTransfer;
    if (!data) {
      return;
    }
    // From the VS Code explorer or editor tabs: URIs, no file contents.
    const uriList = data.getData('application/vnd.code.uri-list') || data.getData('text/uri-list');
    const uris = uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    if (uris.length) {
      post({ type: 'addAttachments', uris });
      return;
    }
    if (data.files?.length) {
      attachFiles([...data.files]);
    }
  });

  // ---------- extension messages ----------

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'state') {
      const previousProvider = state.conversation?.providerId;
      state = message.state;
      if (state.conversation?.providerId !== previousProvider) {
        limits = null;
      }
      streaming = state.running;
      render();
      syncPlanCountdown();
    } else if (message.type === 'historyList') {
      historyItems = message.items;
      historyCurrentId = message.currentId;
      if (menu === 'history') {
        refreshHistoryList();
      }
    } else if (message.type === 'limits') {
      if (message.providerId === state.conversation?.providerId) {
        limits = message.limits;
        render();
      }
    } else if (message.type === 'running') {
      state.running = message.running;
      streaming = message.running;
      render();
    } else if (message.type === 'event') {
      applyEvent(message.event);
    } else if (message.type === 'insert') {
      draft += message.text;
      render();
    } else if (message.type === 'settingsData') {
      settings = message.settings;
      renderModal();
      if (menu === 'palette') {
        render();
      }
    } else if (message.type === 'settingsError') {
      settingsError = message.message;
      renderModal();
    } else if (message.type === 'skillStatus') {
      skillStatus = { ok: message.ok, detail: message.detail };
      renderModal();
    } else if (message.type === 'providerCheck') {
      providerChecks[message.providerId] = { ok: message.ok, detail: message.detail };
      renderModal();
    } else if (message.type === 'providerChecks') {
      const lines = message.results
        .map((result) => `${result.ok ? '✓' : '✗'} ${result.label}: ${result.detail}`)
        .join('\n');
      const conversation = state.conversation;
      if (conversation) {
        conversation.messages.push({
          id: 'check_' + Date.now(),
          role: 'assistant',
          text: '```\n' + lines + '\n```',
          createdAt: Date.now()
        });
      }
      render();
    }
  });

  /** Applies a streaming event to the last assistant message and repaints. */
  function applyEvent(event) {
    const conversation = state.conversation;
    if (!conversation) {
      return;
    }
    let last = conversation.messages[conversation.messages.length - 1];
    if (!last || last.role !== 'assistant') {
      last = { id: 'a_' + Date.now(), role: 'assistant', text: '', thinking: '', tools: [], createdAt: Date.now() };
      conversation.messages.push(last);
    }

    switch (event.type) {
      case 'text_delta':
        last.text = (last.text ?? '') + event.text;
        break;
      case 'thinking_delta':
        last.thinking = (last.thinking ?? '') + event.text;
        break;
      case 'tool_start':
        last.tools = last.tools ?? [];
        last.tools.push({ id: event.id, name: event.name, input: event.input, done: false });
        renderTranscript();
        return;
      case 'tool_end': {
        const tool = (last.tools ?? []).find((entry) => entry.id === event.id);
        if (tool) {
          tool.output = event.output;
          tool.isError = event.isError;
          tool.done = true;
        }
        renderTranscript();
        return;
      }
      case 'usage':
        last.usage = event.usage;
        renderTranscript();
        return;
      case 'error':
        last.error = [last.error, event.message].filter(Boolean).join('\n');
        renderTranscript();
        return;
      case 'done':
        streaming = false;
        state.running = false;
        render();
        return;
      default:
        break;
    }
    scheduleTranscript();
  }

  post({ type: 'ready' });
})();
