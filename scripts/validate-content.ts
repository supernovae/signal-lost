import { resolve } from 'node:path';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, loadContent } from '../src/content/validate.ts';

const root = resolve(process.argv[2] ?? 'content');
const { errors, manifest } = loadContent(readContentDir(root));
if (errors.length > 0) {
  console.error(formatErrors(errors));
  console.error(`\n${errors.length} problem(s) found in ${root}`);
  process.exit(1);
}
console.log(`Content OK: ${manifest.entries.length} records, version ${manifest.contentVersion}`);
