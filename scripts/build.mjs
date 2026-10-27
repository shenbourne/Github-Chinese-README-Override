import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = readFileSync(new URL('src/readme-override.js', root), 'utf8').trimEnd() + '\n';
const target = new URL('github-chinese-readme-override.user.js', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Bundle is out of date');
  console.log('Bundle matches sources');
} else {
  writeFileSync(target, output, 'utf8');
  console.log(`Built ${fileURLToPath(target)}`);
}
