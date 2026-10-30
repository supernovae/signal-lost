import type { RasterPuzzle } from '../content/schema.ts';

const MAX_WIDTH = 30;

export function renderRaster(bits: string, width: number): string {
  const rows: string[] = [];
  for (let start = 0; start < bits.length; start += width) {
    rows.push(
      bits
        .slice(start, start + width)
        .replace(/1/g, '#')
        .replace(/0/g, '.'),
    );
  }
  return rows.join('\n');
}

export function openDecoder(
  panel: HTMLElement,
  puzzle: RasterPuzzle,
  onSubmit: (width: number, reference: string) => void,
): void {
  const width = document.createElement('input');
  width.type = 'range';
  width.min = '1';
  width.max = String(MAX_WIDTH);
  width.value = '10';

  const readout = document.createElement('output');
  const grid = document.createElement('pre');
  grid.className = 'raster';
  grid.tabIndex = 0;
  grid.setAttribute('aria-label', 'Rastered bits');

  const update = (): void => {
    const value = Number(width.value);
    readout.textContent = `BITS ${puzzle.bits.length}  WIDTH ${value}`;
    grid.textContent = renderRaster(puzzle.bits, value);
  };
  width.addEventListener('input', update);

  const widthLabel = document.createElement('label');
  widthLabel.append('RASTER WIDTH', width);

  const form = document.createElement('form');
  form.className = 'decoder-form';
  const referenceLabel = document.createElement('label');
  const reference = document.createElement('input');
  reference.autocomplete = 'off';
  referenceLabel.append('GRID REFERENCE', reference);
  const submit = document.createElement('button');
  submit.textContent = 'SUBMIT';
  form.append(referenceLabel, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(Number(width.value), reference.value);
  });

  const controls = document.createElement('div');
  controls.className = 'analyzer-controls';
  controls.append(widthLabel, readout);
  panel.replaceChildren(grid, controls, form);
  update();
}
