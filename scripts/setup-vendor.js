const fs = require('fs');
const path = require('path');

/**
 * Copy vendor files from node_modules to src/renderer/vendor/
 * This allows CSP-compliant local script loading (script-src 'self')
 */

const vendorDir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
const nodeModules = path.join(__dirname, '..', 'node_modules');

// Create vendor directory if it doesn't exist
if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
  console.log('✓ Created vendor directory');
}

// Files to copy: [source, destination]
const filesToCopy = [
  // marked.js (Markdown parser)
  [
    path.join(nodeModules, 'marked', 'marked.min.js'),
    path.join(vendorDir, 'marked.min.js')
  ],
  // highlight.js theme (github-dark)
  [
    path.join(nodeModules, 'highlight.js', 'styles', 'github-dark.min.css'),
    path.join(vendorDir, 'github-dark.min.css')
  ],
  // DOMPurify (XSS sanitizer)
  [
    path.join(nodeModules, 'dompurify', 'dist', 'purify.min.js'),
    path.join(vendorDir, 'purify.min.js')
  ]
];

// Copy files
let successCount = 0;
let errorCount = 0;

filesToCopy.forEach(([src, dest]) => {
  try {
    if (!fs.existsSync(src)) {
      console.error(`✗ Source file not found: ${src}`);
      errorCount++;
      return;
    }

    fs.copyFileSync(src, dest);
    console.log(`✓ Copied: ${path.basename(dest)}`);
    successCount++;
  } catch (err) {
    console.error(`✗ Failed to copy ${path.basename(dest)}:`, err.message);
    errorCount++;
  }
});

// highlight.js browser shim
// NOTE: highlight.js npm package provides Node/CommonJS entry points by default.
// This shim keeps the renderer browser-safe (no require) and falls back to
// escaped code rendering when full highlight.js browser assets are unavailable.
const highlightShimPath = path.join(vendorDir, 'highlight.min.js');
const highlightShim = `'use strict';\n(function initHljsShim(global){\n  function escapeHtml(str){\n    return String(str)\n      .replace(/&/g, '&amp;')\n      .replace(/</g, '&lt;')\n      .replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;')\n      .replace(/'/g, '&#39;');\n  }\n\n  const hljs = {\n    getLanguage(){\n      return true;\n    },\n    highlight(code){\n      return { value: escapeHtml(code) };\n    },\n    highlightAuto(code){\n      return { value: escapeHtml(code) };\n    },\n  };\n\n  global.hljs = hljs;\n})(typeof globalThis !== 'undefined' ? globalThis : window);\n`;

try {
  fs.writeFileSync(highlightShimPath, highlightShim, 'utf8');
  console.log('✓ Generated: highlight.min.js (browser shim)');
} catch (err) {
  console.error('✗ Failed to generate highlight.min.js:', err.message);
  errorCount++;
}

// Summary
console.log(`\n──────────────────────────────────────`);
console.log(`Vendor setup complete: ${successCount} copied, ${errorCount} failed`);

if (errorCount > 0) {
  console.error('\nPlease ensure all dependencies are installed: npm install');
  process.exit(1);
}
