import type { InquiryPuzzle } from '../content/schema.ts';

export function openInquiry(
  panel: HTMLElement,
  puzzle: InquiryPuzzle,
  onSubmit: (fields: Record<string, string>) => void,
): void {
  const form = document.createElement('form');
  form.className = 'inquiry';
  const controls = puzzle.fields.map((field) => {
    const label = document.createElement('label');
    let control: HTMLInputElement | HTMLSelectElement;
    if (field.options) {
      const select = document.createElement('select');
      select.add(new Option('(SELECT)', ''));
      field.options.forEach((option) => select.add(new Option(option, option)));
      control = select;
    } else {
      control = document.createElement('input');
      control.autocomplete = 'off';
    }
    label.append(field.label, control);
    form.append(label);
    return { id: field.id, control };
  });
  const submit = document.createElement('button');
  submit.textContent = 'FILE REPORT';
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(Object.fromEntries(controls.map(({ id, control }) => [id, control.value])));
  });
  panel.replaceChildren(form);
}
