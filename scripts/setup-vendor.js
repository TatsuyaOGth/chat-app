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
  // highlight.js (Syntax highlighting)
  [
    path.join(nodeModules, 'highlight.js', 'lib', 'index.js'),
    path.join(vendorDir, 'highlight.min.js')
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

// Summary
console.log(`\n──────────────────────────────────────`);
console.log(`Vendor setup complete: ${successCount} copied, ${errorCount} failed`);

if (errorCount > 0) {
  console.error('\nPlease ensure all dependencies are installed: npm install');
  process.exit(1);
}
