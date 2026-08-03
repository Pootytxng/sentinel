import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

export function withoutFencedCode(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && marker) {
      fence = { character: marker[0], length: marker.length };
      return '';
    }
    if (fence) {
      const closesFence = marker
        && marker[0] === fence.character
        && marker.length >= fence.length
        && /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line);
      if (closesFence) fence = null;
      return '';
    }
    return line;
  }).join('\n');
}

export function withoutInlineCodeSpans(text) {
  const masked = text.split('');
  let opener = 0;
  while (opener < text.length) {
    if (text[opener] !== '`') {
      opener += 1;
      continue;
    }

    let openerEnd = opener;
    while (text[openerEnd] === '`') openerEnd += 1;
    const delimiterLength = openerEnd - opener;
    let cursor = openerEnd;
    let closerEnd = null;
    while (cursor < text.length) {
      const nextRun = text.indexOf('`', cursor);
      if (nextRun === -1) break;
      let runEnd = nextRun;
      while (text[runEnd] === '`') runEnd += 1;
      if (runEnd - nextRun === delimiterLength) {
        closerEnd = runEnd;
        break;
      }
      cursor = runEnd;
    }

    if (closerEnd === null) {
      opener = openerEnd;
      continue;
    }
    for (let index = opener; index < closerEnd; index += 1) {
      if (masked[index] !== '\n' && masked[index] !== '\r') masked[index] = ' ';
    }
    opener = closerEnd;
  }
  return masked.join('');
}

function destinationFromInline(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close === -1 ? '' : trimmed.slice(1, close).trim();
  }
  const titleStart = trimmed.search(/\s+(?:["']|\()/);
  return (titleStart === -1 ? trimmed : trimmed.slice(0, titleStart)).trim();
}

function referenceDefinitions(text) {
  const definitions = new Map();
  for (const match of text.matchAll(/^\s{0,3}\[([^\]]+)]\s*:\s*(.*)$/gm)) {
    definitions.set(match[1].trim().replace(/\s+/g, ' ').toLowerCase(), destinationFromInline(match[2]));
  }
  return definitions;
}

function inlineDestinations(text) {
  const found = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '[' || text[start - 1] === '!') continue;
    const labelEnd = text.indexOf(']', start + 1);
    if (labelEnd === -1 || text[labelEnd + 1] !== '(') continue;

    let cursor = labelEnd + 2;
    let depth = 1;
    let angle = false;
    for (; cursor < text.length && depth > 0; cursor += 1) {
      const character = text[cursor];
      if (character === '<') angle = true;
      if (character === '>' && angle) angle = false;
      if (angle) continue;
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
    }
    if (depth === 0) {
      found.push(destinationFromInline(text.slice(labelEnd + 2, cursor - 1)));
      start = cursor - 1;
    }
  }
  return found;
}

export function markdownDestinations(text) {
  const found = [];
  const visibleText = withoutInlineCodeSpans(withoutFencedCode(text));
  const definitions = referenceDefinitions(visibleText);
  const withoutDefinitions = visibleText.replace(/^\s{0,3}\[[^\]]+]\s*:\s*.*$/gm, '');

  found.push(...inlineDestinations(withoutDefinitions));
  for (const match of withoutDefinitions.matchAll(/(?<!!)\[([^\]]+)]\[([^\]]*)]/g)) {
    const label = (match[2] || match[1]).trim().replace(/\s+/g, ' ').toLowerCase();
    if (definitions.has(label)) found.push(definitions.get(label));
  }
  for (const match of withoutDefinitions.matchAll(/\[([^\]]+)]/g)) {
    const start = match.index;
    const next = withoutDefinitions[start + match[0].length];
    if (withoutDefinitions[start - 1] === '!' || withoutDefinitions[start - 1] === ']' || next === '(' || next === '[') continue;
    const label = match[1].trim().replace(/\s+/g, ' ').toLowerCase();
    if (definitions.has(label)) found.push(definitions.get(label));
  }
  return found;
}

function localPath(destination) {
  if (!destination || destination.startsWith('#') || destination.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return null;
  const [withoutFragment] = destination.split('#', 1);
  const [withoutQuery] = withoutFragment.split('?', 1);
  if (!withoutQuery) return null;
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

export function findBrokenMarkdownLinks(rootDir = root) {
  const markdownFiles = execFileSync('git', ['ls-files', '--', '*.md'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).split(/\r?\n/).filter(Boolean);
  const broken = [];
  let checked = 0;
  for (const source of markdownFiles) {
    const text = readFileSync(path.join(rootDir, source), 'utf8');
    for (const destination of markdownDestinations(text)) {
      const local = localPath(destination);
      if (!local) continue;
      checked += 1;
      const target = path.resolve(rootDir, path.dirname(source), local);
      if (!existsSync(target)) broken.push({ source, destination });
    }
  }
  return { broken, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { broken, checked } = findBrokenMarkdownLinks();
  if (broken.length) {
    for (const { source, destination } of broken) {
      console.error(`BROKEN ${source} -> ${destination}`);
    }
    console.error(`markdown-link-guard: FAIL ${broken.length} broken link(s) (${checked} checked)`);
    process.exitCode = 1;
  } else {
    console.log(`markdown-link-guard: PASS ${checked} local link(s) checked`);
  }
}
