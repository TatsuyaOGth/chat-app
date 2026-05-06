'use strict';

// ---------------------------------------------------------------------------
// Parameter schema — all 23 parameters from spec §6
// ---------------------------------------------------------------------------
//
// type values:
//   'select-model' — dropdown populated from Ollama model list
//   'textarea'     — multi-line text (system prompt)
//   'slider'       — range slider + number input
//   'number'       — plain number input
//   'select'       — static options list  (e.g. mirostat mode)
//   'tags'         — array of strings with chip UI (stop sequences)
//
// All values default to `null`; the main process strips nulls before
// sending to Ollama so its defaults apply.

const PARAM_SCHEMA = [
  // --- 基本 -----------------------------------------------------------------
  {
    key: 'model',
    group: '基本',
    label: 'model',
    type: 'select-model',
    help: '使用するモデル名',
  },
  {
    key: 'system',
    group: '基本',
    label: 'system',
    type: 'textarea',
    help: 'システムプロンプト',
  },
  {
    key: 'temperature',
    group: '基本',
    label: 'temperature',
    type: 'slider',
    min: 0,
    max: 2,
    step: 0.05,
    help: '出力のランダム性 (0〜2、デフォルト 0.8)',
  },

  // --- サンプリング ---------------------------------------------------------
  {
    key: 'top_p',
    group: 'サンプリング',
    label: 'top_p',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'トークン選択の多様性 (0〜1)',
  },
  {
    key: 'top_k',
    group: 'サンプリング',
    label: 'top_k',
    type: 'number',
    min: 0,
    step: 1,
    help: '上位 K トークンから選択 (0 = 無効)',
  },
  {
    key: 'repeat_penalty',
    group: 'サンプリング',
    label: 'repeat_penalty',
    type: 'slider',
    min: 0,
    max: 2,
    step: 0.05,
    help: '繰り返しトークンへのペナルティ',
  },
  {
    key: 'presence_penalty',
    group: 'サンプリング',
    label: 'presence_penalty',
    type: 'slider',
    min: -2,
    max: 2,
    step: 0.05,
    help: '既出トークンへのペナルティ（新トピック促進）',
  },
  {
    key: 'frequency_penalty',
    group: 'サンプリング',
    label: 'frequency_penalty',
    type: 'slider',
    min: -2,
    max: 2,
    step: 0.05,
    help: '出現頻度の高いトークンへのペナルティ',
  },
  {
    key: 'tfs_z',
    group: 'サンプリング',
    label: 'tfs_z',
    type: 'number',
    min: 0,
    step: 0.1,
    help: 'Tail Free Sampling (1.0 = 無効)',
  },
  {
    key: 'typical_p',
    group: 'サンプリング',
    label: 'typical_p',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Locally Typical Sampling (1.0 = 無効)',
  },

  // --- Mirostat ------------------------------------------------------------
  {
    key: 'mirostat',
    group: 'Mirostat',
    label: 'mirostat',
    type: 'select',
    options: [
      { value: 0, label: '0 — 無効' },
      { value: 1, label: '1 — Mirostat' },
      { value: 2, label: '2 — Mirostat 2.0' },
    ],
    help: 'Mirostat サンプリングモード',
  },
  {
    key: 'mirostat_tau',
    group: 'Mirostat',
    label: 'mirostat_tau',
    type: 'number',
    min: 0,
    step: 0.1,
    help: '目標エントロピー（デフォルト 5.0）',
  },
  {
    key: 'mirostat_eta',
    group: 'Mirostat',
    label: 'mirostat_eta',
    type: 'number',
    min: 0,
    step: 0.01,
    help: '学習率（デフォルト 0.1）',
  },

  // --- 生成制御 -------------------------------------------------------------
  {
    key: 'num_predict',
    group: '生成制御',
    label: 'num_predict',
    type: 'number',
    step: 1,
    help: '最大生成トークン数 (-1 = 無制限)',
  },
  {
    key: 'num_ctx',
    group: '生成制御',
    label: 'num_ctx',
    type: 'number',
    min: 1,
    step: 1,
    help: 'コンテキスト長',
  },
  {
    key: 'seed',
    group: '生成制御',
    label: 'seed',
    type: 'number',
    step: 1,
    help: '再現性のための乱数シード',
  },
  {
    key: 'stop',
    group: '生成制御',
    label: 'stop',
    type: 'tags',
    help: '生成停止トークン (Enter で追加)',
  },

  // --- システム -------------------------------------------------------------
  {
    key: 'num_gpu',
    group: 'システム',
    label: 'num_gpu',
    type: 'number',
    min: 0,
    step: 1,
    help: '使用する GPU レイヤー数',
  },
  {
    key: 'num_thread',
    group: 'システム',
    label: 'num_thread',
    type: 'number',
    min: 1,
    step: 1,
    help: '使用する CPU スレッド数',
  },
];

const PARAM_GROUPS = ['基本', 'サンプリング', 'Mirostat', '生成制御', 'システム'];

/** Build a fresh params object with every schema key set to null. */
function emptyParams() {
  const params = {};
  for (const spec of PARAM_SCHEMA) params[spec.key] = null;
  return params;
}

/** Whether this value should be considered "customized" (sent to Ollama). */
function isCustomized(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

function renderParamRow(spec, value, ctx) {
  const row = document.createElement('div');
  row.classList.add('param-row');
  row.dataset.key = spec.key;
  if (isCustomized(value)) row.classList.add('param-row--customized');

  const header = document.createElement('div');
  header.classList.add('param-row__header');

  const dot = document.createElement('span');
  dot.classList.add('param-row__dot');
  dot.setAttribute('aria-hidden', 'true');

  const label = document.createElement('label');
  label.classList.add('param-row__label');
  label.textContent = spec.label;
  if (spec.help) label.title = spec.help;

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.classList.add('param-row__reset');
  reset.textContent = '×';
  reset.title = 'デフォルトに戻す';
  reset.setAttribute('aria-label', `${spec.label} をデフォルトに戻す`);
  reset.addEventListener('click', () => ctx.onChange(spec.key, null));

  header.appendChild(dot);
  header.appendChild(label);
  header.appendChild(reset);
  row.appendChild(header);

  const control = renderControl(spec, value, ctx);
  control.classList.add('param-row__control');
  row.appendChild(control);

  return row;
}

function renderControl(spec, value, ctx) {
  switch (spec.type) {
    case 'select-model': return renderModelSelect(spec, value, ctx);
    case 'textarea':     return renderTextarea(spec, value, ctx);
    case 'slider':       return renderSlider(spec, value, ctx);
    case 'number':       return renderNumber(spec, value, ctx);
    case 'select':       return renderSelect(spec, value, ctx);
    case 'tags':         return renderTags(spec, value, ctx);
    default: {
      const div = document.createElement('div');
      div.textContent = `(unsupported type: ${spec.type})`;
      return div;
    }
  }
}

function renderModelSelect(spec, value, ctx) {
  const select = document.createElement('select');
  select.classList.add('select');

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（未選択）';
  select.appendChild(placeholder);

  for (const name of ctx.modelOptions || []) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  if (value && !(ctx.modelOptions || []).includes(value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${value} (未インストール)`;
    select.appendChild(opt);
  }

  select.value = value ?? '';
  select.addEventListener('change', () => {
    ctx.onChange(spec.key, select.value === '' ? null : select.value);
  });
  return select;
}

function renderTextarea(spec, value, ctx) {
  const ta = document.createElement('textarea');
  ta.classList.add('param-textarea');
  ta.rows = 3;
  ta.placeholder = '（デフォルト）';
  ta.value = value ?? '';
  ta.addEventListener('change', () => {
    const v = ta.value;
    ctx.onChange(spec.key, v.trim() === '' ? null : v);
  });
  return ta;
}

function renderSlider(spec, value, ctx) {
  const wrap = document.createElement('div');
  wrap.classList.add('slider-wrap');

  const range = document.createElement('input');
  range.type = 'range';
  range.classList.add('range');
  range.min = String(spec.min);
  range.max = String(spec.max);
  range.step = String(spec.step ?? 0.01);

  const number = document.createElement('input');
  number.type = 'number';
  number.classList.add('number');
  number.min = String(spec.min);
  number.max = String(spec.max);
  number.step = String(spec.step ?? 0.01);
  number.placeholder = '—';

  const display = value === null || value === undefined ? '' : String(value);
  range.value = display === '' ? String((spec.min + spec.max) / 2) : display;
  number.value = display;

  const commit = (raw) => {
    if (raw === '' || raw === null || Number.isNaN(Number(raw))) {
      ctx.onChange(spec.key, null);
      return;
    }
    const n = Number(raw);
    range.value = String(n);
    number.value = String(n);
    ctx.onChange(spec.key, n);
  };

  range.addEventListener('input', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));

  wrap.appendChild(range);
  wrap.appendChild(number);
  return wrap;
}

function renderNumber(spec, value, ctx) {
  const input = document.createElement('input');
  input.type = 'number';
  input.classList.add('number', 'number--wide');
  if (spec.min !== undefined) input.min = String(spec.min);
  if (spec.max !== undefined) input.max = String(spec.max);
  if (spec.step !== undefined) input.step = String(spec.step);
  input.placeholder = '（デフォルト）';
  input.value = value === null || value === undefined ? '' : String(value);
  input.addEventListener('change', () => {
    const v = input.value;
    ctx.onChange(spec.key, v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  });
  return input;
}

function renderSelect(spec, value, ctx) {
  const select = document.createElement('select');
  select.classList.add('select');

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（デフォルト）';
  select.appendChild(placeholder);

  for (const opt of spec.options || []) {
    const el = document.createElement('option');
    el.value = String(opt.value);
    el.textContent = opt.label;
    select.appendChild(el);
  }

  select.value = value !== null && value !== undefined ? String(value) : '';
  select.addEventListener('change', () => {
    const v = select.value;
    ctx.onChange(spec.key, v === '' ? null : Number(v));
  });
  return select;
}

/** Tag-chip input for string[] values (e.g. stop sequences). */
function renderTags(spec, value, ctx) {
  const currentTags = Array.isArray(value) ? [...value] : [];

  const wrap = document.createElement('div');
  wrap.classList.add('tags-wrap');

  const chipList = document.createElement('div');
  chipList.classList.add('tags-chips');

  const input = document.createElement('input');
  input.type = 'text';
  input.classList.add('tags-input');
  input.placeholder = 'Enter で追加';

  function rebuildChips() {
    chipList.innerHTML = '';
    for (let i = 0; i < currentTags.length; i++) {
      const chip = document.createElement('span');
      chip.classList.add('tag-chip');

      const text = document.createElement('span');
      text.classList.add('tag-chip__text');
      text.textContent = currentTags[i];

      const del = document.createElement('button');
      del.type = 'button';
      del.classList.add('tag-chip__del');
      del.textContent = '×';
      del.setAttribute('aria-label', `「${currentTags[i]}」を削除`);
      del.addEventListener('click', () => {
        currentTags.splice(i, 1);
        ctx.onChange(spec.key, currentTags.length ? [...currentTags] : null);
      });

      chip.appendChild(text);
      chip.appendChild(del);
      chipList.appendChild(chip);
    }
  }

  rebuildChips();

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tag = input.value.trim();
    if (!tag || currentTags.includes(tag)) { input.value = ''; return; }
    currentTags.push(tag);
    input.value = '';
    ctx.onChange(spec.key, [...currentTags]);
  });

  wrap.appendChild(chipList);
  wrap.appendChild(input);
  return wrap;
}

// ---------------------------------------------------------------------------
// Editor (full re-render with collapsible groups)
// ---------------------------------------------------------------------------

function renderParamEditor(root, params, ctx) {
  // Persist which groups are open across re-renders.
  const openGroups = new Set();
  root.querySelectorAll('details[open]').forEach((d) => {
    openGroups.add(d.dataset.group);
  });
  // Default: open '基本' on first render.
  if (openGroups.size === 0) openGroups.add('基本');

  root.innerHTML = '';

  for (const groupName of PARAM_GROUPS) {
    const specsInGroup = PARAM_SCHEMA.filter((s) => s.group === groupName);
    if (specsInGroup.length === 0) continue;

    const details = document.createElement('details');
    details.classList.add('param-group');
    details.dataset.group = groupName;
    if (openGroups.has(groupName)) details.open = true;

    const summary = document.createElement('summary');
    summary.classList.add('param-group__heading');

    // Count customized params in this group for a badge.
    const customCount = specsInGroup.filter(
      (s) => isCustomized(params[s.key] ?? null)
    ).length;

    const titleSpan = document.createElement('span');
    titleSpan.textContent = groupName;
    summary.appendChild(titleSpan);

    if (customCount > 0) {
      const badge = document.createElement('span');
      badge.classList.add('param-group__badge');
      badge.textContent = String(customCount);
      summary.appendChild(badge);
    }

    details.appendChild(summary);

    for (const spec of specsInGroup) {
      details.appendChild(renderParamRow(spec, params[spec.key] ?? null, ctx));
    }

    root.appendChild(details);
  }
}

// ---------------------------------------------------------------------------
// Splitting params for the chat request
// ---------------------------------------------------------------------------

function splitParamsForChat(params) {
  const { model, system, ...rest } = params || {};
  return {
    model: model ?? null,
    system: system ?? null,
    options: rest,
  };
}

window.Params = {
  PARAM_SCHEMA,
  PARAM_GROUPS,
  emptyParams,
  isCustomized,
  renderParamEditor,
  splitParamsForChat,
};
