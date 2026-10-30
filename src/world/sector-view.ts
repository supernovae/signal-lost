export function openCodePanel(panel: HTMLElement, onSubmit: (code: string) => void): void {
  const form = document.createElement('form');
  form.className = 'decoder-form';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.autocomplete = 'off';
  label.append('SERVICE CODE', input);
  const submit = document.createElement('button');
  submit.textContent = 'ENTER';
  form.append(label, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(input.value);
  });
  panel.replaceChildren(form);
  input.focus();
}
