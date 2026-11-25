#!/usr/bin/env node
/**
 * Fetch and parse the official, public Munitorum Field Manual pages.
 * Output retains source attribution and a fetch timestamp. This project does
 * not claim rights to Games Workshop's game data.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const BASE = 'https://mfm.warhammer-community.com';
const ROOT = new URL('/en', BASE);
const DEFAULT_OUTPUT = resolve('data/mfm-snapshot.json');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const decodeEntities = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()];
});
const plain = (value) => decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const tokenRe = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/gi;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of html.matchAll(tokenRe)) {
    const token = match[0];
    if (token.startsWith('<!--') || /^<!/i.test(token)) continue;
    if (/^<script\b/i.test(token)) continue;
    if (/^<\//.test(token)) {
      const tag = token.match(/^<\/\s*([\w:-]+)/)?.[1]?.toLowerCase();
      if (!tag) continue;
      for (let i = stack.length - 1; i > 0; i -= 1) { if (stack[i].tag === tag) { stack.length = i; break; } }
      continue;
    }
    if (token.startsWith('<')) {
      const tag = token.match(/^<\s*([\w:-]+)/)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attrs = parseAttributes(token.slice(tag.length + 1, token.length - 1));
      const node = { tag, attrs, children: [], parent: stack.at(-1) };
      stack.at(-1).children.push(node);
      if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
    } else {
      const node = { tag: '#text', text: decodeEntities(token), attrs: {}, children: [], parent: stack.at(-1) };
      stack.at(-1).children.push(node);
    }
  }
  return root;
}

function descendants(node, predicate, result = []) {
  for (const child of node.children || []) { if (predicate(child)) result.push(child); descendants(child, predicate, result); }
  return result;
}

function textOf(node) {
  if (node.tag === '#text') return node.text;
  return (node.children || []).map(textOf).join(' ').replace(/\s+/g, ' ').trim();
}

function textLines(node) {
  const lines = [];
  const blockTags = new Set(['div', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'section', 'table', 'tr']);
  const visit = (current) => {
    if (current.tag === '#text') { const value = current.text.replace(/\s+/g, ' ').trim(); if (value) lines.push(value); return; }
    if (blockTags.has(current.tag)) lines.push('\n');
    for (const child of current.children || []) visit(child);
    if (blockTags.has(current.tag)) lines.push('\n');
  };
  visit(node);
  return lines.join(' ').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function resolveSuspense(root) {
  const nodes = descendants(root, () => true);
  const hidden = new Map(nodes.filter((node) => node.attrs?.id?.startsWith('S:') || node.attrs?.id?.startsWith('B:')).map((node) => [node.attrs.id, node]));
  const resolve = (node, seen = new Set()) => {
    node.children = (node.children || []).flatMap((child) => {
      if (child.tag === 'template' && /^[PB]:/.test(child.attrs.id || '')) {
        const id = child.attrs.id.slice(2);
        const replacement = hidden.get(`S:${id}`) || hidden.get(`B:${id}`);
        if (!replacement || seen.has(replacement)) return [];
        const copy = structuredClone(replacement);
        copy.parent = child.parent;
        resolve(copy, new Set([...seen, replacement]));
        for (const nested of copy.children) nested.parent = child.parent;
        return copy.children;
      }
      resolve(child, seen);
      return [child];
    });
  };
  resolve(root);
  for (const node of hidden.values()) {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
  }
}

function extractCards(root) {
  const cards = descendants(root, (node) => String(node.attrs?.class || '').split(/\s+/).includes('print:break-inside-avoid-page'));
  return cards.filter((node) => !ancestorHasClass(node.parent, 'print:break-inside-avoid-page'));
}

function ancestorHasClass(node, className) {
  for (let current = node; current; current = current.parent) if (String(current.attrs?.class || '').split(/\s+/).includes(className)) return true;
  return false;
}

function pointsInCard(card) {
  const cardLines = textLines(card);
  const costRows = descendants(card, (node) => node.tag === 'li').map((node) => plain(textOf(node))).filter(Boolean);
  const costs = [];
  for (const line of costRows) {
    const match = line.match(/^(.*?)\s*(\d+)\s*pts?\b/i);
    if (!match) continue;
    const label = match[1].trim();
    const type = /^per\s/i.test(label) ? 'wargear' : 'unit';
    const rowIndex = cardLines.indexOf(line);
    const tier = cardLines.slice(0, rowIndex).reverse().find((value) => /^YOUR .* COSTS?$/i.test(value)) || '';
    costs.push({ label, points: Number(match[2]), type, tier });
  }
  return costs;
}

function labelOfCard(card) {
  const boldHeaders = descendants(card, (node) => node.tag === 'div' && /font-bold/.test(node.attrs.class || '')).map((node) => plain(textOf(node))).filter(Boolean);
  const useful = boldHeaders.find((line) => !/^(YOUR |WARGEAR|LEADER|SUPPORT|ENHANCEMENTS|DETACHMENTS|UNITS)/i.test(line));
  if (useful) return useful;
  return textLines(card).find((line) => !/^(YOUR |WARGEAR|LEADER|SUPPORT|ENHANCEMENTS|DETACHMENTS|UNITS)/i.test(line)) || '';
}

function factionDisplayName(html, slug) {
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const value = plain(title);
  return value && !/WARHAMMER/i.test(value) ? value : slug.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function parseFactionPage(html, slug) {
  const root = parseHtml(html);
  resolveSuspense(root);
  const cards = extractCards(root).map((card) => {
    const text = textLines(card);
    const heading = labelOfCard(card);
    const detachmentPoints = heading.match(/\b(\d+)\s*DP\b/i)?.[1];
    const kind = detachmentPoints ? 'detachment' : 'unit';
    const costs = pointsInCard(card).map((cost) => ({ ...cost, type: kind === 'detachment' && cost.type !== 'wargear' ? 'enhancement' : cost.type }));
    return { name: detachmentPoints ? heading.replace(/\s+\d+\s*DP\b/i, '').trim() : heading, kind, detachmentPoints: detachmentPoints ? Number(detachmentPoints) : null, text, costs };
  }).filter((card) => card.name || card.costs.length);
  const headings = descendants(root, (node) => /^h[1-4]$/.test(node.tag)).map((node) => plain(textOf(node))).filter(Boolean);
  return { slug, name: factionDisplayName(html, slug), headings, cards };
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'FORGE-40K-MFM-Scraper/0.1 (community hobby army builder)' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}: ${url}`);
        if (response.status < 500 || attempt === 2) throw error;
        lastError = error;
      } else return response.text();
    } catch (error) {
      lastError = error;
      if (/^\d{3} /.test(error.message) || attempt === 2) throw error;
    }
    await sleep(700 * (attempt + 1));
  }
  throw lastError;
}

async function discoverFactions() {
  const html = await fetchText(ROOT);
  const slugs = [...new Set([...html.matchAll(/href=["']\/en\/([a-z0-9-]+)["']/gi)].map((match) => match[1]))]
    .filter((slug) => slug !== 'en' && slug !== 'downloads' && slug !== 'articles');
  if (!slugs.length) throw new Error('No se detectaron facciones en el índice oficial; el formato del MFM pudo cambiar.');
  return slugs;
}

async function scrape(slugs) {
  const factions = [];
  const batchSize = 3;
  for (let start = 0; start < slugs.length; start += batchSize) {
    const batch = slugs.slice(start, start + batchSize);
    const results = await Promise.all(batch.map(async (slug, offset) => {
      const index = start + offset;
      const url = new URL(`/en/${slug}`, BASE);
      process.stdout.write(`[${index + 1}/${slugs.length}] ${slug} ... `);
      const html = await fetchText(url);
      const faction = parseFactionPage(html, slug);
      const count = faction.cards.reduce((sum, card) => sum + card.costs.length, 0);
      console.log(`${faction.cards.length} bloques, ${count} costes`);
      return { ...faction, sourceUrl: url.href };
    }));
    factions.push(...results);
    await sleep(250);
  }
  return factions;
}

async function writeSnapshot(factions, output) {
  const snapshot = {
    schemaVersion: 1,
    source: 'Games Workshop — Munitorum Field Manual',
    sourceUrl: ROOT.href,
    manualVersion: factions.flatMap((faction) => faction.headings).find((heading) => /^v\d+(?:\.\d+)+$/i.test(heading)) || 'unknown',
    attribution: 'Warhammer 40,000 and Munitorum Field Manual content © Games Workshop Limited. Unofficial data extract; not affiliated with or endorsed by Games Workshop.',
    scrapedAt: new Date().toISOString(),
    factions
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const csvOutput = resolve(dirname(output), 'mfm-points.csv');
  const headers = ['faction', 'slug', 'recordType', 'unit', 'groupTitle', 'detachmentPoints', 'range', 'label', 'models', 'points', 'desc', 'sourceUrl'];
  const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const records = factions.flatMap((faction) => faction.cards.flatMap((card) => card.costs.map((cost) => ({
    faction: faction.name, slug: faction.slug, recordType: cost.type,
    unit: card.name, groupTitle: card.kind === 'detachment' ? 'DETACHMENT' : 'OTHER', detachmentPoints: card.detachmentPoints ?? '',
    range: cost.tier, label: cost.label, models: cost.type === 'unit' ? cost.label : '', points: cost.points,
    desc: card.text.filter((line) => !/pts?\b/i.test(line)).join(' | '), sourceUrl: faction.sourceUrl
  }))));
  const csv = [headers.map(csvEscape).join(','), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(','))].join('\n');
  await writeFile(csvOutput, `${csv}\n`, 'utf8');
  await writeFile(resolve(dirname(output), 'MFM-ATTRIBUTION.txt'), `${snapshot.attribution}\nSource: ${snapshot.sourceUrl}\nScraped at: ${snapshot.scrapedAt}\nManual version shown by source: ${snapshot.manualVersion}\n`, 'utf8');
  return snapshot;
}

async function main() {
  const args = process.argv.slice(2);
  const inspect = args.indexOf('--inspect');
  const outputArg = args.indexOf('--output');
  const output = outputArg >= 0 ? resolve(args[outputArg + 1]) : DEFAULT_OUTPUT;
  let slugs;
  if (inspect >= 0 && args[inspect + 1]) slugs = [args[inspect + 1]];
  else slugs = await discoverFactions();
  const factions = await scrape(slugs);
  if (inspect >= 0) {
    const faction = factions[0];
    console.log(JSON.stringify({
      faction: faction.name, headings: faction.headings,
      cards: faction.cards.length,
      units: faction.cards.filter((card) => card.kind === 'unit').length,
      detachments: faction.cards.filter((card) => card.kind === 'detachment').length,
      enhancements: faction.cards.reduce((sum, card) => sum + card.costs.filter((cost) => cost.type === 'enhancement').length, 0),
      unitSample: faction.cards.filter((card) => card.kind === 'unit' && card.costs.some((cost) => cost.type === 'unit')).slice(0, 3),
      detachmentSample: faction.cards.filter((card) => card.kind === 'detachment').slice(0, 2)
    }, null, 2));
    return;
  }
  const snapshot = await writeSnapshot(factions, output);
  {
    const blocks = factions.reduce((sum, faction) => sum + faction.cards.length, 0);
    const costs = factions.reduce((sum, faction) => sum + faction.cards.reduce((n, card) => n + card.costs.length, 0), 0);
    console.log(`Guardado ${snapshot.factions.length} facciones, ${blocks} bloques y ${costs} costes en ${output}`);
  }
}

main().catch((error) => { console.error(`Scraping fallido: ${error.message}`); process.exitCode = 1; });

