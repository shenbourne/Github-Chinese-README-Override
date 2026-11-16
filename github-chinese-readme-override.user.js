// ==UserScript==
// @name         Chinese README Override
// @name:zh-CN   中文 README 优先显示
// @namespace    https://github.com/local-tools/chinese-readme-override
// @version      1.1.0
// @description  Show an existing Chinese README on supported Git repository pages, with a switch back to the original.
// @description:zh-CN 在支持的 Git 仓库页面显示已有的中文 README，支持切换回原文。
// @author       shenbourne
// @license      MIT
// @homepageURL  https://github.com/shenbourne/Github-Chinese-README-Override
// @supportURL   https://github.com/shenbourne/Github-Chinese-README-Override/issues
// @match        https://github.com/*
// @match        https://gitee.com/*
// @match        https://gitlab.com/*
// @match        https://gitcode.com/*
// @connect      self
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      api.gitcode.com
// @require      https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

/* ---------------- 可配置项 ---------------- */

// 候选中文 README 文件名（按优先级排序，前面优先命中）
const CANDIDATE_NAMES = [
'README.zh-CN.md', 'README.zh_CN.md', 'README.zh-cn.md', 'README.zh.md',
'README_zh.md', 'README_zh_CN.md', 'README_ZH.md',
'README-cn.md', 'README_cn.md', 'README-CN.md', 'README_CN.md',
'README-zh.md', 'README-zh_CN.md', 'README-zh_CN.MD',
'README.zh-hans.md', 'README.zh-hans_CN.md',
'README中文.md', 'README.中文.md', 'README-中文.md', '中文README.md',
'README-CH.md', 'README-ch.md', 'README.CH.md',
];

// 每次跳转后延迟多少 ms 开始检测（给 SPA 渲染留时间）
const DETECT_DELAY = 600;

/* ---------------- 状态 ---------------- */

const ENABLED_KEY = 'cro_enabled';
let enabled = GM_getValue(ENABLED_KEY, true);
let lastUrl = null;
let translationIconCount = 0;

GM_registerMenuCommand(
(enabled ? '中文 README 覆盖：已启用（点击停用）' : '中文 README 覆盖：已停用（点击启用）'),
() => {
enabled = !enabled;
GM_setValue(ENABLED_KEY, enabled);
if (!enabled) restoreAll();
location.reload();
}
);

/* ---------------- 工具 ---------------- */

function requestReadmeData({ url, headers = {}, timeout = 10000 }) {
return new Promise((resolve, reject) => {
GM.xmlHttpRequest({
method: 'GET',
url,
headers,
timeout,
onload: (res) => resolve(res),
onerror: (err) => reject(err),
ontimeout: () => reject(new Error('timeout')),
});
});
}

// 自建站点只需在脚本顶部添加 @match，运行时自动识别平台。
const encPath = (s) => s.split('/').map(encodeURIComponent).join('/');

async function detectPlatform() {
const host = location.hostname.toLowerCase();
const known = {'github.com': 'github', 'gitlab.com': 'gitlab', 'gitee.com': 'gitee', 'gitcode.com': 'gitcode'};
if (known[host]) return known[host];
// 仅在看起来像仓库的路径上探测，且只向当前站点发请求。
if (location.pathname.split('/').filter(Boolean).length < 2) return null;
const generator = document.querySelector('meta[name="generator"]')?.content || '';
if (/gitlab/i.test(generator) || document.querySelector('meta[content="GitLab"]')) return 'gitlab';
if (/gitea|forgejo/i.test(generator)) return 'gitea';
try {
const res = await requestReadmeData({url: `${location.origin}/api/v1/version`, headers: {Accept: 'application/json'}, timeout: 3000});
if (res.status >= 200 && res.status < 300) {
const data = JSON.parse(res.responseText);
if (typeof data.version === 'string' && /^v?\d+.\d+/.test(data.version)) return 'gitea';
}
} catch (_) { /* 无法确认则不处理 */ }
return null;
}

function parseRepoHome(kind) {
const host = location.hostname;
if (!kind) return null;
let parts;
try { parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
catch (_) { return null; }
let project, rest = [], type = '';
if (kind === 'gitlab') {
const marker = parts.indexOf('-');
if (marker >= 0) {
if (parts[marker + 1] !== 'tree' || marker < 2) return null;
project = parts.slice(0, marker).join('/'); rest = parts.slice(marker + 2); type = 'tree';
} else {
if (parts.length < 2) return null;
project = parts.join('/');
}
} else {
if (parts.length < 2) return null;
project = parts.slice(0, 2).join('/');
const tail = parts.slice(2);
if (tail.length) {
if (kind === 'gitea' && tail[0] === 'src' && ['branch', 'tag', 'commit'].includes(tail[1])) {
type = tail[1]; rest = tail.slice(2);
} else if (kind !== 'gitea' && tail[0] === 'tree') {
type = 'tree'; rest = tail.slice(1);
} else return null;
if (!rest.length) return null;
}
}
if (['settings', 'explore', 'search', 'users', 'groups', 'dashboard'].includes(parts[0].toLowerCase())) return null;
return { host, kind, project, owner: parts[0], repo: parts[1], rest, type };
}

function apiBase(repo) {
const project = encPath(repo.project);
if (repo.kind === 'gitlab') return `${location.origin}/api/v4/projects/${encodeURIComponent(repo.project)}`;
if (repo.kind === 'github') return `https://api.github.com/repos/${project}`;
if (repo.kind === 'gitcode') return `https://api.gitcode.com/api/v5/repos/${project}`;
return `${location.origin}/api/${repo.kind === 'gitea' ? 'v1' : 'v5'}/repos/${project}`;
}

async function getJson(url) {
const res = await requestReadmeData({url, headers: {Accept: 'application/json'}});
if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`);
return JSON.parse(res.responseText);
}

async function listDirectory(repo, ref, directory) {
const base = apiBase(repo), query = `ref=${encodeURIComponent(ref)}`;
const url = repo.kind === 'gitlab'
? `${base}/repository/tree?${query}&path=${encodeURIComponent(directory)}&per_page=100`
: `${base}/contents/${encPath(directory)}?${query}`;
const list = await getJson(url);
if (!Array.isArray(list)) throw new Error('目录响应不是列表');
return list;
}

async function locatePage(repo) {
if (!repo.rest.length) {
const meta = await getJson(apiBase(repo));
if (!meta.default_branch) throw new Error('无法确定默认分支');
return {ref: meta.default_branch, directory: ''};
}
// 先尝试最长引用，接口成功时才接受；不能把子目录直接当分支。
for (let i = repo.rest.length; i > 0; i--) {
const ref = repo.rest.slice(0, i).join('/');
const directory = repo.rest.slice(i).join('/');
try {
const entries = await listDirectory(repo, ref, directory);
return {ref, directory, entries};
} catch (_) { /* 尝试较短的引用 */ }
}
throw new Error('无法识别当前分支/标签和目录，或无读取权限');
}

const readmeNamePriority = new Map(
  [...new Set([...CANDIDATE_NAMES, ...CANDIDATE_NAMES.map((name) => 'readme' + name.slice(6))])]
    .map((name, index) => [name, index]),
);

function findGitHubReadmeInFileList(repo) {
  const prefix = `/${encPath(repo.project)}/blob/`;
  let best = null;
  for (const link of document.querySelectorAll('tr a[href], [role="row"] a[href]')) {
    if (link.closest('.markdown-body')) continue;
    const name = link.textContent.trim();
    const priority = readmeNamePriority.get(name);
    if (priority === undefined || (best && priority >= best.priority)) continue;
    const url = new URL(link.href, location.origin);
    const suffix = `/${encodeURIComponent(name)}`;
    if (url.origin !== location.origin || !url.pathname.startsWith(prefix) ||
        !url.pathname.endsWith(suffix)) continue;
    try {
      const branch = decodeURIComponent(url.pathname.slice(prefix.length, -suffix.length));
      if (branch) best = { branch, name, directory: '', priority, fromFileList: true };
    } catch (_) { /* 忽略无法解码的链接 */ }
  }
  return best;
}

async function findGitHubReadmeInTree(repo, ref) {
  const index = await getJson(`${apiBase(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (index.truncated || !Array.isArray(index.tree)) return undefined;

  let best;
  for (const entry of index.tree) {
    if (entry.type !== 'blob' || entry.mode === '120000' || typeof entry.path !== 'string') continue;
    const parts = entry.path.split('/');
    const priority = readmeNamePriority.get(parts.pop());
    if (priority === undefined) continue;
    const directory = parts.join('/');
    const group = directory === '' ? 0 : directory === 'docs' ? 1 : directory.startsWith('docs/') ? 2 : 3;
    const depth = parts.length;
    if (!best || group < best.group ||
        (group === best.group && (depth < best.depth ||
          (depth === best.depth && (priority < best.priority ||
            (priority === best.priority && entry.path < best.name)))))) {
      best = { branch: ref, name: entry.path, directory, group, depth, priority };
    }
  }
  return best ? { branch: best.branch, name: best.name, directory: best.directory } : null;
}

async function findChineseReadme(repo) {
if (repo.kind === 'github' && !repo.rest.length) {
const visibleReadme = findGitHubReadmeInFileList(repo);
if (visibleReadme) return visibleReadme;
}
const page = await locatePage(repo);
if (repo.kind === 'github' && !repo.rest.length) {
  try {
    const indexed = await findGitHubReadmeInTree(repo, page.ref);
    if (indexed !== undefined) return indexed;
  } catch (_) { /* 文件索引不可用时直接查目录 */ }
}
const directories = page.directory ? [page.directory] : ['', 'docs'];
for (const directory of directories) {
let entries;
try { entries = directory === page.directory && page.entries ? page.entries : await listDirectory(repo, page.ref, directory); }
catch (_) { continue; }
const filenames = new Set(entries.filter((entry) => entry.type === 'file' || entry.type === 'blob').map((entry) => entry.name));
const filename = [...readmeNamePriority.keys()].find((name) => filenames.has(name));
if (filename) {
const path = [directory, filename].filter(Boolean).join('/');
return {branch: page.ref, name: path, directory};
}
}
return null;
}

async function fetchReadme(repo, found) {
const base = apiBase(repo), ref = encodeURIComponent(found.branch);
if (repo.kind === 'github' && found.fromFileList) {
try {
const url = `https://raw.githubusercontent.com/${encPath(repo.project)}/${encPath(found.branch)}/${encPath(found.name)}`;
const res = await requestReadmeData({ url });
if (res.status === 200 && typeof res.responseText === 'string') return res.responseText;
} catch (_) { /* 改用 GitHub 文件 API */ }
}
if (repo.kind === 'gitlab') {
const res = await requestReadmeData({url: `${base}/repository/files/${encodeURIComponent(found.name)}/raw?ref=${ref}`});
if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
return res.responseText;
}
const file = await getJson(`${base}/contents/${encPath(found.name)}?ref=${ref}`);
if (file.encoding === 'base64' && typeof file.content === 'string') {
const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
return new TextDecoder('utf-8').decode(bytes);
}
throw new Error('文件接口未返回可读取的正文');
}

function platformRoots(repo, found) {
const root = `${location.origin}/${encPath(repo.project)}`;
const ref = encodeURIComponent(found.branch);
if (repo.kind === 'github') return {raw: `https://raw.githubusercontent.com/${encPath(repo.project)}/${ref}/`, blob: `${root}/blob/${ref}/`};
if (repo.kind === 'gitlab') return {raw: `${root}/-/raw/${ref}/`, blob: `${root}/-/blob/${ref}/`};
if (repo.kind === 'gitea') return {raw: `${root}/raw/${repo.type === 'tag' ? 'tag' : repo.type === 'commit' ? 'commit' : 'branch'}/${ref}/`, blob: `${root}/src/${repo.type === 'tag' ? 'tag' : repo.type === 'commit' ? 'commit' : 'branch'}/${ref}/`};
return {raw: `${root}/raw/${ref}/`, blob: `${root}/blob/${ref}/`};
}
/* ---------------- DOM 定位 ---------------- */

function findReadmeArticle(root = document) {
const selectors = [
'[data-testid="readme"] article.markdown-body',
'.readme-holder .md',
'.readme-holder .markdown',
'[data-testid="readme-content"]',
'.repository-readme .markdown-body', // GitHub 新版
'#readme article.markdown-body',                // GitHub 旧版/兼容
'article.markdown-body',                        // GitHub 兜底
'#repo-readme .markup',                         // Gitea 新版
'.repository .markup',                          // Gitea 兜底
'#git-readme .markdown-body',                   // Gitee
'#readme .markdown-body',                       // Gitee 旧版
];
for (const sel of selectors) {
const el = root.matches?.(sel) ? root : root.querySelector(sel);
if (el && el.offsetParent !== null) return el;
}
// 最后兜底：取页面上最大的、位于 readme 容器内的 .markdown-body
const bodies = [...root.querySelectorAll('.markdown-body')];
const inReadme = bodies.filter((el) => {
const box = el.closest('[id*="readme" i], [class*="readme" i]');
return box && el.offsetParent !== null;
});
const pool = inReadme.length ? inReadme : bodies.filter((el) => el.offsetParent !== null);
if (!pool.length) return null;
return pool.reduce((a, b) => (a.innerHTML.length >= b.innerHTML.length ? a : b));
}

/* ---------------- 渲染与替换 ---------------- */

function normalizeReadmeHtml(html, found, repo) {
const template = document.createElement('template');
template.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
const {raw: rawRoot, blob: blobRoot} = platformRoots(repo, found);
const directory = found.directory ? encPath(found.directory) + '/' : '';
const rawDirectory = new URL(directory, rawRoot).href;
const blobDirectory = new URL(directory, blobRoot).href;
const imageProxies = new Map();
if (repo.kind === 'github') {
// GitHub blocks direct external images; reuse proxies already in its rendered README.
findReadmeArticle()?.querySelectorAll('img[data-canonical-src]').forEach((image) => {
const source = image.getAttribute('data-canonical-src');
const proxy = image.getAttribute('src');
if (source && proxy && new URL(proxy, location.origin).hostname === 'camo.githubusercontent.com') {
imageProxies.set(source, proxy);
}
});
}
for (const [selector, attribute, root, base] of [
['img[src]', 'src', rawRoot, rawDirectory],
['a[href]', 'href', blobRoot, blobDirectory],
]) {
template.content.querySelectorAll(selector).forEach((element) => {
const value = element.getAttribute(attribute).trim();
if (!value || value.startsWith('#')) return;
const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
const resolved = absolute ? value : value.startsWith('/') ? new URL(value.slice(1), root).href : new URL(value, base).href;
element.setAttribute(attribute, attribute === 'src' ? imageProxies.get(resolved) || resolved : resolved);
});
}
return template.innerHTML;
}

function renderReadme(md, found, repo) {
return normalizeReadmeHtml(marked.parse(md, { gfm: true, breaks: false }), found, repo);
}
function injectStyles() {
if (document.getElementById('cro-style')) return;
const style = document.createElement('style');
style.id = 'cro-style';
style.textContent = `
      .cro-translation-tab { cursor: pointer; font: inherit; color: inherit; background: transparent; border: 0; }
      [data-cro-active="false"] { font-weight: 400 !important; }
      [data-cro-active="false"]::after { background: transparent !important; }
      [data-cro-active="true"] { font-weight: 600 !important; }
      [data-cro-active="true"]::after { background: var(--underlineNav-borderColor-active, #fd8c73) !important; }
      .cro-translation-tab:focus-visible { outline: 2px solid var(--fgColor-link, #0969da); outline-offset: -2px; }
   `;
document.head.appendChild(style);
}

function applyChineseReadme(article, found, repo) {
if (article.dataset.croState === 'cn') return;
if (article.dataset.croState !== 'orig') {
origStore.set(article, article.innerHTML); // 原文保存在 WeakMap 里
}
const html = article.dataset.croHtml || '';
article.innerHTML = html;
article.dataset.croState = 'cn';
addBar(article, found, repo);
}

const origStore = new WeakMap();

function restoreOriginal(article) {
const orig = origStore.get(article);
if (orig == null) return;
article.innerHTML = orig;
article.dataset.croState = 'orig';
}

const tabStore = new WeakMap();
const tabsByHost = new WeakMap();

function addBar(article, found, repo) {
injectStyles();
const existing = tabStore.get(article);
if (existing?.tab.isConnected && existing.readmeTab.isConnected) {
existing.select(true);
return;
}
let container = article.parentElement;
let readmeTab = null;
for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
readmeTab = [...container.querySelectorAll('[role="tab"], .UnderlineNav-item, a[class*="UnderlineItem"], nav a, nav button, [data-cro-created]')]
.find((element) => !article.contains(element) &&
!element.classList.contains('cro-translation-tab') &&
(element.dataset.croCreated ||
  /^(?:README(?:\.md)?|自述文件|讀我檔案|讀我文件)$/i.test(element.textContent.trim()) ||
  (repo.kind === 'github' && (
    /(?:^|[-_])readme(?:$|[-_])/i.test(element.getAttribute('aria-controls') || '') ||
    element.querySelector('.octicon-book')
  ))));
if (readmeTab) break;
}
if (!readmeTab) {
// 其他平台没有标签栏时，放到 README 标题旁，仍不增加正文行。
container = article.closest('#repo-readme, #git-readme, #readme') || article.parentElement;
readmeTab = container.querySelector('.header a, .Box-title a, h2 a');
}
if (!readmeTab) {
readmeTab = document.createElement('button');
readmeTab.type = 'button';
readmeTab.textContent = 'README 原文';
article.before(readmeTab);
readmeTab.dataset.croCreated = 'true';
}
const insertionPoint = readmeTab.parentElement.tagName === 'LI' ? readmeTab.parentElement : readmeTab;
const host = insertionPoint.parentElement;
const previous = tabsByHost.get(host);
if (previous?.tab.isConnected && previous.readmeTab === readmeTab) {
previous.bind(article);
previous.select(true);
return;
}
previous?.cleanup();
const tab = document.createElement('button');
tab.type = 'button';
tab.className = readmeTab.className + ' cro-translation-tab';
tab.title = found.name;
tab.setAttribute('role', 'tab');
const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
icon.setAttribute('data-component', 'Octicon');
icon.setAttribute('aria-hidden', 'true');
icon.setAttribute('focusable', 'false');
icon.setAttribute('class', 'octicon cro-translation-icon');
icon.setAttribute('viewBox', '0 0 16 16');
icon.setAttribute('width', '16');
icon.setAttribute('height', '16');
icon.setAttribute('fill', 'none');
icon.setAttribute('display', 'inline-block');
icon.setAttribute('overflow', 'visible');
icon.style.verticalAlign = 'text-bottom';
const svgNS = icon.namespaceURI;
const englishShape = 'M1.9 3.15c.45-.7 1.2-1.05 2.15-1.05 1.4 0 2.25.78 2.25 2.04v4.15m0-3.66H4.08c-1.35 0-2.33.62-2.33 1.78 0 .99.75 1.64 1.8 1.64 1.18 0 2.17-.69 2.75-1.73';
const chineseShape = 'M9.1 5.65l.8 1.1 M5.65 7.65h8.55m-1.6 0c-.8 2.95-3.1 5.13-6.6 6.33m1.55-6.33c1.02 2.95 3.4 5.13 6.75 6.33';
const makeStroke = (d, color, width) => {
  const stroke = document.createElementNS(svgNS, 'path');
  stroke.setAttribute('d', d);
  stroke.setAttribute('fill', 'none');
  stroke.setAttribute('stroke', color);
  stroke.setAttribute('stroke-width', width);
  stroke.setAttribute('stroke-linecap', 'round');
  stroke.setAttribute('stroke-linejoin', 'round');
  return stroke;
};
const maskId = 'cro-translation-icon-mask-' + (++translationIconCount);
const mask = document.createElementNS(svgNS, 'mask');
mask.id = maskId;
mask.setAttribute('maskUnits', 'userSpaceOnUse');
mask.setAttribute('width', '16');
mask.setAttribute('height', '16');
const maskBackground = document.createElementNS(svgNS, 'rect');
maskBackground.setAttribute('width', '16');
maskBackground.setAttribute('height', '16');
maskBackground.setAttribute('fill', 'white');
mask.append(maskBackground, makeStroke(chineseShape, 'black', '2.6'));
const english = makeStroke(englishShape, 'currentColor', '1.25');
english.setAttribute('mask', 'url(#' + maskId + ')');
icon.append(mask, english, makeStroke(chineseShape, 'currentColor', '1.25'));
const iconWrapper = document.createElement('span');
iconWrapper.dataset.component = 'icon';
iconWrapper.appendChild(icon);
const label = document.createElement('span');
label.dataset.component = 'text';
label.dataset.content = '译文';
label.textContent = '译文';
tab.append(iconWrapper, label);
const panel = readmeTab.getAttribute('aria-controls');
if (panel) tab.setAttribute('aria-controls', panel);
const originalSelected = readmeTab.getAttribute('aria-selected');
const select = (translated) => {
readmeTab.dataset.croActive = String(!translated);
tab.dataset.croActive = String(translated);
readmeTab.setAttribute('aria-selected', String(!translated));
tab.setAttribute('aria-selected', String(translated));
};
let currentArticle = article;
let clickSequence = 0;
const onOriginal = () => {
clickSequence++;
restoreOriginal(currentArticle);
select(false);
};
const clearTranslationSelection = () => {
clickSequence++;
delete readmeTab.dataset.croActive;
tab.dataset.croActive = 'false';
tab.setAttribute('aria-selected', 'false');
};
const tabSelector = '[role="tab"], .UnderlineNav-item, [aria-controls], [aria-current], a, button';
const isOtherNativeTab = (target) => {
if (!target || !host.contains(target) || target === readmeTab || target === tab) return false;
if (target.closest('.cro-translation-tab')) return false;
// 仅处理同一排的标签，包括包在 li 中的链接和按钮。
const item = target.parentElement?.tagName === 'LI' ? target.parentElement : target;
return item.parentElement === host && item !== insertionPoint;
};
const onOtherTabClick = (event) => {
const target = event.target.closest?.(tabSelector);
if (isOtherNativeTab(target)) clearTranslationSelection();
};
host.addEventListener('click', onOtherTabClick, true);
const tabSelectionObserver = new MutationObserver((changes) => {
if (changes.some(({ target }) => {
if (!target.matches(tabSelector) || !isOtherNativeTab(target)) return false;
const current = target.getAttribute('aria-current');
return target.getAttribute('aria-selected') === 'true' || Boolean(current && current !== 'false');
})) {
clearTranslationSelection();
}
});
tabSelectionObserver.observe(host, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current'] });
readmeTab.addEventListener('click', onOriginal, true);
tab.addEventListener('click', async (event) => {
event.preventDefault();
event.stopPropagation();
const html = currentArticle.dataset.croHtml;
const url = repositoryPageKey();
// 激活网站原有 README 面板，以便从 License 标签切回。
readmeTab.click();
const sequence = clickSequence;
await new Promise((resolve) => requestAnimationFrame(resolve));
const activeArticle = await waitFor(() => {
if (!tab.isConnected || repositoryPageKey() !== url || sequence !== clickSequence) return true;
const readmePanel = panel && document.getElementById(panel);
if (readmePanel) return findReadmeArticle(readmePanel);
if (panel) return null;
return currentArticle.isConnected && currentArticle.offsetParent !== null ? currentArticle : findReadmeArticle();
}, 2000);
if (!activeArticle || activeArticle === true || sequence !== clickSequence || !tab.isConnected || repositoryPageKey() !== url) return;
activeArticle.dataset.croHtml = html;
applyChineseReadme(activeArticle, found, repo);
});
let wrapper = null;
if (insertionPoint !== readmeTab) {
wrapper = document.createElement('li');
wrapper.className = insertionPoint.className;
wrapper.appendChild(tab);
}
insertionPoint.after(wrapper || tab);
const state = { tab, readmeTab, select, bind(nextArticle) {
tabStore.delete(currentArticle);
currentArticle = nextArticle;
tabStore.set(currentArticle, state);
}, cleanup: () => {
clickSequence++;
tabStore.delete(currentArticle);
tabsByHost.delete(host);
host.removeEventListener('click', onOtherTabClick, true);
tabSelectionObserver.disconnect();
readmeTab.removeEventListener('click', onOriginal, true);
if (readmeTab.dataset.croCreated) readmeTab.remove();
delete readmeTab.dataset.croActive;
if (originalSelected == null) readmeTab.removeAttribute('aria-selected');
else readmeTab.setAttribute('aria-selected', originalSelected);
(wrapper || tab).remove();
} };
state.bind(article);
tabsByHost.set(host, state);
select(true);
}
function restoreAll() {
document.querySelectorAll('[data-cro-state]').forEach((el) => {
restoreOriginal(el);
tabStore.get(el)?.cleanup();
tabStore.delete(el);
el.removeAttribute('data-cro-state');
});
document.querySelectorAll('.cro-bar').forEach((el) => el.remove());
}

/* ---------------- GitHub 汉化兼容 ---------------- */

function repairTranslatedNavigation(root = document) {
const selector = 'nav [data-content], [role="tablist"] [data-content], .UnderlineNav [data-content], [data-component="text"][data-content]';
for (const label of root.querySelectorAll(selector)) {
if (label.closest('.markdown-body, .comment-body, [contenteditable="true"]')) continue;
if (!label.closest('a, button, [role="tab"]')) continue;
// Primer uses data-content for an invisible bold label that reserves tab width.
const text = label.textContent.trim();
if (!/[\u3400-\u9fff]/.test(text)) continue;
if (label.getAttribute('data-content') !== text) label.setAttribute('data-content', text);
}
}

function observeTranslatedNavigation() {
if (!enabled || location.hostname !== 'github.com') return;
let scheduled = false;
const schedule = () => {
if (scheduled) return;
scheduled = true;
requestAnimationFrame(() => {
scheduled = false;
repairTranslatedNavigation();
});
};
new MutationObserver(schedule).observe(document.body, {
subtree: true,
childList: true,
characterData: true,
attributes: true,
attributeFilter: ['data-content'],
});
repairTranslatedNavigation();
}

/* ---------------- 主流程 ---------------- */

let running = false;

function repositoryPageKey() {
const url = new URL(location.href);
url.hash = '';
if (url.hostname === 'github.com') url.searchParams.delete('tab');
return url.href;
}

async function process() {
if (!enabled || running) return;
running = true;
const processUrl = repositoryPageKey();
try {
const kind = await detectPlatform();
if (repositoryPageKey() !== processUrl) return;
const repo = parseRepoHome(kind);
if (!repo) return;
const found = await findChineseReadme(repo);
if (!found) return; // 没有中文 README，什么都不做
const md = await fetchReadme(repo, found);
const html = renderReadme(md, found, repo);
// 等页面 README 渲染出来
const article = await waitFor(() => findReadmeArticle(), 8000);
if (!article || repositoryPageKey() !== processUrl) return;
article.dataset.croHtml = html;
applyChineseReadme(article, found, repo);

} catch (e) {
  console.warn('[Chinese README Override]', e);
} finally {
  running = false;
  if (repositoryPageKey() !== processUrl) setTimeout(process, DETECT_DELAY);
}

}

function waitFor(fn, timeout) {
return new Promise((resolve) => {
const t0 = Date.now();
const timer = setInterval(() => {
const v = fn();
if (v || Date.now() - t0 > timeout) {
clearInterval(timer);
resolve(v || null);
}
}, 200);
});
}

// SPA（GitHub turbo / Gitea htmx）导航检测：URL 变化即重新处理
function onUrlChange() {
const url = repositoryPageKey();
if (url === lastUrl) return;
observeTranslatedNavigation();
lastUrl = url;
setTimeout(process, DETECT_DELAY);
}

window.addEventListener('popstate', onUrlChange);
document.addEventListener('turbo', onUrlChange);
document.addEventListener('pjax', onUrlChange);
new MutationObserver(() => onUrlChange()).observe(document.body, { childList: true, subtree: false });
setInterval(onUrlChange, 1000);

lastUrl = repositoryPageKey();
setTimeout(process, DETECT_DELAY);
})();
