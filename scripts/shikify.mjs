#!/usr/bin/env node
/**
 * Shiki 代码高亮 —— 构建后处理脚本
 * ---------------------------------------------------------------------------
 * Hugo 内置的语法高亮器是 Chroma（Go 实现），无法使用 Shiki（JavaScript /
 * TextMate 语法）。因此采用社区通行的「构建后处理」方案：
 *
 *   1. hugo.toml 里设 [markup.highlight] codeFences = false
 *      → Hugo 只输出原始 <pre><code class="language-xxx">，不做着色
 *   2. hugo 构建完成后运行本脚本，扫描 public/ 下的 HTML，
 *      用 Shiki 重新渲染每个代码块并原地替换
 *
 * 产出是纯静态 HTML + 内联 CSS 变量，浏览器端零 JS 开销，也不需要任何 CDN。
 * 亮/暗两套主题写进 CSS 变量，由 assets/css/extended/shiki.css 按 PaperMod
 * 的 data-theme 属性切换。
 *
 * 用法：
 *   node scripts/shikify.mjs          # 处理 public/
 *   npm run build                     # hugo build + shikify 一条龙
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHighlighter } from 'shiki';

// --------------------------------- 配置 ---------------------------------
const PUBLIC_DIR = 'public';
const THEME_LIGHT = 'night-owl-light';
const THEME_DARK = 'night-owl';
const FALLBACK_LANG = 'text';

/** Hugo/常见写法 → Shiki 语言名（对不上时在此兜底） */
const LANG_ALIAS = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'text',
  plain: 'text',
  txt: 'text',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
};

// --------------------------------- 正则 ---------------------------------
/** 未着色的代码块：<pre><code class=language-xxx>…</code></pre>
 *  注意 hugo --minify 会去掉属性引号（class=language-js），所以不用引号锚定。
 *  代码里的 < > 已被转义为 &lt; &gt;，因此内部不可能出现字面量 </code>。 */
const BLOCK_RE = /<pre\b([^>]*)>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g;
/** 从属性串里取语言 */
const LANG_RE = /language-([A-Za-z0-9_+#.-]+)/;
/** 页面里是否有代码块 */
const HAS_CODE_RE = /<pre\b[^>]*>\s*<code\b/;
/** Shiki 已处理过的标记 */
const DONE_RE = /\bshiki\b/;

// --------------------------------- 工具 ---------------------------------
/** 递归收集目录下所有 .html */
async function walkHtml(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walkHtml(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/** 还原 HTML 实体（&amp; 必须最后处理，否则会把 &amp;lt; 误还原成 <） */
function unescapeHtml(str) {
  return str
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}

// ------------------------------- 主流程 -------------------------------
const files = await walkHtml(PUBLIC_DIR);

// ---- 第一遍：挑出实际用到的语言，避免加载整个语言包 ----
const langs = new Set();
let hasCodeBlock = false;

for (const file of files) {
  const html = await readFile(file, 'utf8');
  if (HAS_CODE_RE.test(html)) hasCodeBlock = true;
  for (const m of html.matchAll(/language-([A-Za-z0-9_+#.-]+)/g)) {
    const raw = m[1].toLowerCase();
    langs.add(LANG_ALIAS[raw] ?? raw);
  }
}

if (!hasCodeBlock) {
  console.log(`[shiki] 已扫描 ${files.length} 个 HTML，未发现代码块，跳过。`);
  process.exit(0);
}
console.log(
  `[shiki] 扫描 ${files.length} 个 HTML，代码语言：${[...langs].join(', ') || '(均未标注，按纯文本处理)'}`,
);

// ---- 初始化高亮器（只装用到的语言 + 两套主题）----
const highlighter = await createHighlighter({
  themes: [THEME_LIGHT, THEME_DARK],
  langs: [],
});

const usable = new Set();
for (const lang of langs) {
  if (lang === FALLBACK_LANG) continue;
  try {
    await highlighter.loadLanguage(lang);
    usable.add(lang);
  } catch {
    console.warn(`[shiki] 语言 "${lang}" 不受支持，将回退为纯文本`);
  }
}
console.log(`[shiki] 已加载语言：${[...usable].join(', ') || '(仅纯文本)'}`);

// ---- 第二遍：原地替换代码块 ----
let replaced = 0;
let touched = 0;

for (const file of files) {
  const html = await readFile(file, 'utf8');
  if (!HAS_CODE_RE.test(html)) continue;

  let changed = false;

  const output = html.replace(BLOCK_RE, (whole, preAttrs, codeAttrs, inner) => {
    if (DONE_RE.test(preAttrs)) return whole; // 幂等：已由 Shiki 处理过

    const lm = codeAttrs.match(LANG_RE);
    // 未标注语言的代码块也交给 Shiki 渲染成 text，否则它保留 PaperMod 的
    // 深色底，会与其余代码块视觉不一致
    const mapped = lm ? (LANG_ALIAS[lm[1].toLowerCase()] ?? lm[1].toLowerCase()) : FALLBACK_LANG;
    const lang = usable.has(mapped) ? mapped : FALLBACK_LANG;

    const code = unescapeHtml(inner).replace(/\n$/, '');
    if (!code.trim()) return whole;

    changed = true;
    replaced += 1;

    return highlighter.codeToHtml(code, {
      lang,
      themes: { light: THEME_LIGHT, dark: THEME_DARK },
      defaultColor: false, // 输出 CSS 变量而非写死颜色，供亮/暗切换
    });
  });

  if (changed) {
    await writeFile(file, output, 'utf8');
    touched += 1;
  }
}

console.log(`[shiki] 完成：高亮 ${replaced} 个代码块，写入 ${touched} 个文件。`);
