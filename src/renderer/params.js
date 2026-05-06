'use strict';

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------
//
// Phase 2 ships only the core parameters needed to validate the editing flow.
// Phase 5 will extend PARAM_SCHEMA with the remaining 17 parameters from the
// spec (mirostat, top_k, repeat_penalty, stop, num_gpu, …).
//
// Each entry describes a single editable parameter:
//   key   — the Ollama option name (or top-level field for `model`/`system`)
//   label — Japanese label shown next to the row
//   group — section header used for grouping in the editor
//   type  — UI control: 'select-model' | 'textarea' | 'slider' | 'number'
//   min/max/step/help — only used by some types
//
// All values are stored as `null` when the user hasn't customized them; the
// main process strips `null` keys before sending to Ollama.

const PARAM_SCHEMA = [
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
    max: 1,
    step: 0.05,
    help: '出力のランダム性 (0〜1)',
  },
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
  return true;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

/**
 * Render a single parameter row.
 *
 * @param {object} spec      One entry from PARAM_SCHEMA.
 * @param {*}      value     Current value (null = use Ollama default).
 * @param {object} ctx       Shared rendering context.
 * @param {string[]} ctx.modelOptions  Available model names (for 'select-model').
 * @param {function(key, value): void} ctx.onChange  Called when the value changes.
 * @returns {HTMLElement}
 */
function renderParamRow(spec, value, ctx) {
  const row = document.createElement('div');
  row.classList.add('param-row');
  row.dataset.key = spec.key;
  if (isCustomized(value)) row.classList.add('param-row--customized');

  // Status dot + label
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

  // Control
  const control = renderControl(spec, value, ctx);
  control.classList.add('param-row__control');
  row.appendChild(control);

  return row;
}

function renderControl(spec, value, ctx) {
  switch (spec.type) {
    case 'select-model':
      return renderModelSelect(spec, value, ctx);
    case 'textarea':
      return renderTextarea(spec, value, ctx);
    case 'slider':
      return renderSlider(spec, value, ctx);
    case 'number':
      return renderNumber(spec, value, ctx);
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

  // If the saved model isn't in the available list (e.g. uninstalled), still
  // show it so the user can see what was selected.
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

  // Updating either control updates the other and reports up.
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
    if (v === '' || Number.isNaN(Number(v))) {
      ctx.onChange(spec.key, null);
    } else {
      ctx.onChange(spec.key, Number(v));
    }
  });
  return input;
}

// ---------------------------------------------------------------------------
// Editor (full re-render)
// ---------------------------------------------------------------------------

/**
 * Render the entire parameter editor into `root`, clearing previous content.
 * Re-rendering on every value change keeps the implementation simple and
 * predictable; the editor is small enough that perf is not a concern.
 */
function renderParamEditor(root, params, ctx) {
  root.innerHTML = '';

  for (const groupName of PARAM_GROUPS) {
    const specsInGroup = PARAM_SCHEMA.filter((s) => s.group === groupName);
    if (specsInGroup.length === 0) continue;

    const section = document.createElement('section');
    section.classList.add('param-group');

    const heading = document.createElement('h2');
    heading.classList.add('param-group__heading');
    heading.textContent = groupName;
    section.appendChild(heading);

    for (const spec of specsInGroup) {
      section.appendChild(renderParamRow(spec, params[spec.key] ?? null, ctx));
    }

    root.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Splitting params for the chat request
// ---------------------------------------------------------------------------
//
// `system` and `model` are top-level fields on the chat IPC payload; everything
// else goes into `options`. `null` values are forwarded as-is and stripped by
// the main process before the body hits Ollama.

function splitParamsForChat(params) {
  const { model, system, ...rest } = params || {};
  return {
    model: model ?? null,
    system: system ?? null,
    options: rest,
  };
}

// Expose a tiny module on `window` so renderer.js can use it without any
// build step (CSP forbids inline scripts; multiple <script> tags share the
// global scope as plain non-modules).
window.Params = {
  PARAM_SCHEMA,
  PARAM_GROUPS,
  emptyParams,
  isCustomized,
  renderParamEditor,
  splitParamsForChat,
};
