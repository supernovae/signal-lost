import type { Content } from './schema.ts';
import { formatErrors, loadContent } from './validate.ts';

const modules = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' });

/** Loads and validates authored JSON in development. Vite supplies validated content in builds. */
export function loadBundledContent(): Content {
  const result = loadContent(modules);
  if (result.errors.length > 0) throw new Error(formatErrors(result.errors));
  return result.content;
}
