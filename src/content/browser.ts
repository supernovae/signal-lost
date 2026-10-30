import { formatErrors, loadContent, type LoadResult } from './validate.ts';

const modules = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' });

/** The bundled content. The build has already rejected invalid content. */
export function loadBundledContent(): LoadResult {
  const result = loadContent(modules);
  if (result.errors.length > 0) throw new Error(formatErrors(result.errors));
  return result;
}
