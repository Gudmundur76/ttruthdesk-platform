import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const SERVER_DIR = 'server';
const SKIP = [
  /\.test\.ts$/,
  /^server\/_core\//,
  /routers\.ts$/,
  /schema\.ts$/,
  /relations\.ts$/,
  /db\.ts$/,
  /storage\.ts$/,
  /seedKnowledgeGraph\.ts$/,
];

const files = readdirSync(SERVER_DIR)
  .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map(f => join(SERVER_DIR, f));

const untested = files.filter(f => {
  const rel = f;
  if (SKIP.some(p => p.test(rel))) return false;
  return !existsSync(f.replace(/\.ts$/, '.test.ts'));
});

console.log('Total source files:', files.length);
console.log('Untested:', untested.length);
console.log('Coverage ratio:', ((files.length - untested.length) / files.length).toFixed(2));
if (untested.length > 0) {
  console.log('\nUntested files:');
  untested.forEach(f => console.log(' -', f));
}
