import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../github-chinese-readme-override.user.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../src/readme-override.js', import.meta.url), 'utf8');
const moduleStart = bundle.indexOf('// Bundled GitHub interface localization');
const localization = bundle.slice(moduleStart).replace(
  'function main() {',
  'globalThis.hooks = { lookup, translateAttributes, shouldSkipElement }; function main() {'
);

function runLocalization(hostname = 'github.com', enabled = true, framed = false) {
  const menus = [];
  const writes = [];
  const context = {
    location: { hostname, pathname: '/owner/repo', reload() { writes.push('reload'); } },
    window: { top: {}, self: {} },
    document: { readyState: 'loading', addEventListener() {} },
    GM_getValue(key, fallback) { return key === 'cro_github_ui_enabled' ? enabled : fallback; },
    GM_setValue(...args) { writes.push(args); },
    GM_registerMenuCommand(label, callback) { menus.push({ label, callback }); },
    console,
  };
  if (!framed) context.window.top = context.window.self;
  vm.runInNewContext(localization, context);
  return { context, menus, writes };
}

test('switch stops startup and persists its new value on click', () => {
  const { context, menus, writes } = runLocalization('github.com', false);
  assert.equal(context.hooks, undefined);
  assert.equal(menus.length, 1);
  menus[0].callback();
  assert.equal(writes[0][0], 'cro_github_ui_enabled');
  assert.equal(writes[0][1], true);
  assert.equal(writes[1], 'reload');
});

test('non-GitHub pages and frames do not start localization or add menus', () => {
  for (const result of [runLocalization('gitee.com'), runLocalization('github.com', true, true)]) {
    assert.equal(result.context.hooks, undefined);
    assert.equal(result.menus.length, 0);
  }
});

test('dictionary translates UI and leaves protected content attributes unchanged', () => {
  const { context } = runLocalization();
  assert.equal(context.hooks.lookup('Settings'), '设置');
  function element(protectedContent) {
    const attrs = new Map([['title', 'Settings']]);
    return {
      tagName: 'A',
      closest() { return protectedContent ? {} : null; },
      hasAttribute(name) { return attrs.has(name); },
      getAttribute(name) { return attrs.get(name); },
      setAttribute(name, value) { attrs.set(name, value); },
    };
  }
  const ui = element(false);
  const content = element(true);
  context.hooks.translateAttributes(ui);
  context.hooks.translateAttributes(content);
  assert.equal(ui.getAttribute('title'), '设置');
  assert.equal(content.getAttribute('title'), 'Settings');
});

test('script header exposes both features', () => {
  assert.match(header, /@version\s+1\.3\.0/);
  assert.match(header, /@name:zh-CN\s+GitHub 中文 README 覆盖与界面汉化/);
});

test('localization is scoped to GitHub and has an independent switch', () => {
  assert.match(bundle, /location\.hostname !== 'github\.com'/);
  assert.match(bundle, /GM_getValue\(key, true\)/);
  assert.match(bundle, /GitHub 界面汉化：已启用/);
});

test('localization cannot rewrite protected README attributes', () => {
  const attributes = bundle.indexOf('function translateAttributes(el) {');
  const skip = bundle.indexOf('if (shouldSkipElement(el)) return;', attributes);
  const setAttribute = bundle.indexOf('el.setAttribute(attr, translated);', attributes);
  assert.ok(attributes >= 0 && skip > attributes && setAttribute > skip, 'skip check must precede attribute rewrite');
  assert.match(bundle, /"\[data-cro-state\]"/);
  assert.match(bundle, /"\.markdown-body"/);
});
