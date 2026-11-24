import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { REGLAGES } from '../JS/reglages.js';
import { createI18n } from '../JS/i18n/index.js';
import { summarize, worldStats, typicalRecords } from '../JS/core/model.js';

const root = new URL('../', import.meta.url);
const block = /\s*<!-- publication:start -->[\s\S]*?<!-- publication:end -->\s*/g;
const unversion = (text) => text.replace(/\?v=[\w.-]+/g, '');
const digest = (bytes, algorithm = 'sha384') =>
  createHash(algorithm).update(bytes).digest('base64');
async function files(folder) {
  const list = [];
  for (const entry of await readdir(new URL(folder, root), { withFileTypes: true })) {
    const name = folder + entry.name;
    if (entry.isDirectory()) list.push(...(await files(name + '/')));
    else list.push(name);
  }
  return list;
}

export async function prepareSite({ check = false } = {}) {
  const runtime = [
    ...(await files('JS/')),
    ...(await files('css/')),
    ...(await files('assets/')),
    REGLAGES.files.data,
  ].sort();
  const original = await readFile(new URL('index.html', root), 'utf8');
  let index = unversion(original.replace(block, '\n'));
  const data = JSON.parse(await readFile(new URL(REGLAGES.files.data, root), 'utf8'));
  const { t, storyAuthors } = createI18n('fr');
  const typical = summarize(typicalRecords(data));
  const values = {
    ...storyAuthors,
    ...worldStats(data.records),
    year: data.metadata.year,
    typical: typical.total,
    police: typical.police,
    other: typical.other,
  };
  const escape = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  index = index
    .replace(
      /(<([a-z][\w-]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)[\s\S]*?(<\/\2\s*>)/g,
      (_, start, tag, key, end) => start + escape(t(key, values)) + end,
    )
    .replace(/(<strong id="world-total">)[\s\S]*?(<\/strong>)/, '$1' + values.cases + '$2')
    .replace(/(<strong id="country-total">)[\s\S]*?(<\/strong>)/, '$1' + values.countries + '$2');
  index = index.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/,
    '$1' + escape(t('page.description')) + '$2',
  );
  const hash = createHash('sha256');
  for (const name of runtime) {
    const bytes = await readFile(new URL(name, root));
    hash
      .update(name + '\0')
      .update(name.endsWith('.css') ? unversion(bytes.toString('utf8')) : bytes);
  }
  hash.update(index.replace(/>\s+</g, '><').trim());
  const version = hash.digest('hex').slice(0, 16);
  const url = (name) => name + '?v=' + version;
  const imports = Object.fromEntries(
    runtime
      .filter((name) => name.startsWith('JS/') && name.endsWith('.js'))
      .map((name) => ['./' + name, './' + url(name)]),
  );
  const importMap = '\n' + JSON.stringify({ imports }, null, 2) + '\n';
  const policy =
    "default-src 'none'; script-src 'self' 'sha256-" +
    digest(importMap, 'sha256') +
    "'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
  const head = [
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="app-version" content="' + version + '">',
    '<link rel="icon" href="' + url('assets/icons/rsf-logo.svg') + '" type="image/svg+xml">',
    '<link rel="preload" href="' +
      url('assets/fonts/Electrolize-Regular.ttf') +
      '" as="font" type="font/ttf" crossorigin>',
  ];
  const changedCSS = [];
  for (const name of ['css/styles.css', 'css/route-legend.css', 'css/poc.css']) {
    const originalCSS = await readFile(new URL(name, root), 'utf8');
    const css = unversion(originalCSS).replace(
      '../assets/fonts/Electrolize-Regular.ttf',
      '../' + url('assets/fonts/Electrolize-Regular.ttf'),
    );
    changedCSS.push([name, originalCSS, css]);
    head.push(
      '<link rel="stylesheet" href="' +
        url(name) +
        '" integrity="sha384-' +
        digest(css) +
        '" crossorigin="anonymous">',
    );
  }
  head.push('<script type="importmap">' + importMap + '</script>');
  head.push(
    '<script type="module" src="' +
      url('JS/app.js') +
      '" integrity="sha384-' +
      digest(await readFile(new URL('JS/app.js', root))) +
      '" crossorigin="anonymous"></script>',
  );
  const charset = /<meta\s+charset=["']utf-8["']\s*\/?>(?:\s*)/i;
  if (!charset.test(index)) throw new Error('Balise UTF-8 manquante.');
  index = index.replace(
    charset,
    '<meta charset="utf-8" />\n<!-- publication:start -->\n' +
      head.join('\n') +
      '\n<!-- publication:end -->\n',
  );
  index = index.replace(
    /\b(src|href)="(assets\/[^"?]+)"/g,
    (_, attribute, name) => attribute + '="' + url(name) + '"',
  );
  if (check) {
    if (index !== original || changedCSS.some(([, before, after]) => before !== after))
      throw new Error('POC à préparer : node scripts/prepare-site.mjs');
  } else {
    for (const [name, , css] of changedCSS) await writeFile(new URL(name, root), css);
    await writeFile(new URL('index.html', root), index);
  }
  console.log('POC ' + (check ? 'vérifié' : 'préparé') + ' · version ' + version);
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareSite({ check: process.argv.includes('--check') });
