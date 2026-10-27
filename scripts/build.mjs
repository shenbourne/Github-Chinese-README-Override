import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const replaceOnce = (source, from, to) => {
  if (source.split(from).length !== 2) {
    throw new Error(`Expected exactly one integration point: ${from}`);
  }
  return source.replace(from, to);
};

let localization = read('vendor/github-zh-i18n.user.js');
const headerEnd = localization.indexOf('// ==/UserScript==');
if (headerEnd < 0) throw new Error('Missing upstream userscript header');
localization = localization.slice(headerEnd + '// ==/UserScript=='.length).trim();
// Check the exclusion before touching attributes, including observer updates.
localization = replaceOnce(localization,
  'function translateAttributes(el) {',
  'function translateAttributes(el) {\n    if (shouldSkipElement(el)) return;');
localization = replaceOnce(localization,
  'var EXCLUDE_SELECTOR = [',
  'var EXCLUDE_SELECTOR = [\n    "[data-cro-state]",\n    "[data-cro-html]",\n    \'[data-testid="readme-content"]\',\n    "#readme",\n    "#repo-readme",\n    "#git-readme",');

const gate = `
// Bundled GitHub interface localization by Moss & WorkBuddy (MIT).
// See THIRD_PARTY_NOTICES.md for source and integration changes.
(function () {
  'use strict';
  if (window.top !== window.self || location.hostname !== 'github.com') return;
  const key = 'cro_github_ui_enabled';
  const enabled = GM_getValue(key, true);
  GM_registerMenuCommand(
    enabled ? 'GitHub 界面汉化：已启用（点击停用）' : 'GitHub 界面汉化：已停用（点击启用）',
    () => { GM_setValue(key, !enabled); location.reload(); }
  );
  if (!enabled) return;
${localization}
})();
`;
const output = read('src/readme-override.js').trimEnd() + '\n' + gate;
const target = new URL('github-chinese-readme-override.user.js', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Bundle is out of date');
  console.log('Bundle matches sources');
} else {
  writeFileSync(target, output, 'utf8');
  console.log(`Built ${fileURLToPath(target)}`);
}
