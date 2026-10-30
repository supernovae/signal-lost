import type { Archive } from '../content/schema.ts';
import { searchArchives } from './archive.ts';

export function openArchive(
  panel: HTMLElement,
  archives: () => readonly Archive[],
  onRead: (archive: Archive) => void,
): void {
  const form = document.createElement('form');
  form.className = 'archive-search';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.autocomplete = 'off';
  label.append('SEARCH', input);
  const submit = document.createElement('button');
  submit.textContent = 'QUERY';
  form.append(label, submit);

  const results = document.createElement('div');
  results.className = 'archive-results';
  const reader = document.createElement('article');
  reader.className = 'archive-reader';
  reader.tabIndex = 0;
  reader.setAttribute('aria-label', 'Message');

  const show = (archive: Archive): void => {
    const heading = document.createElement('h3');
    heading.textContent = archive.title;
    const meta = document.createElement('p');
    meta.className = 'dim';
    meta.textContent = `BOARD: ${archive.board}  FROM: ${archive.from}  DATE: ${archive.date}`;
    const body = archive.body.map((text) => {
      const line = document.createElement('p');
      line.textContent = text || ' ';
      return line;
    });
    reader.replaceChildren(heading, meta, ...body);
    if (archive.attribution) {
      const credit = document.createElement('p');
      credit.className = 'dim credit';
      const handle = archive.attribution.handle ? ` (${archive.attribution.handle})` : '';
      credit.textContent = `FILED BY: ${archive.attribution.author}${handle}`;
      reader.append(credit);
    }
    reader.scrollTop = 0;
    onRead(archive);
  };

  const query = (): void => {
    const found = searchArchives(archives(), input.value);
    results.replaceChildren(
      ...found.map((archive) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${archive.board.padEnd(10)} ${archive.date.padEnd(11)} ${archive.title}`;
        button.addEventListener('click', () => show(archive));
        return button;
      }),
    );
    if (found.length === 0) {
      const none = document.createElement('p');
      none.className = 'dim';
      none.textContent = 'NO MESSAGES MATCH.';
      results.append(none);
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    query();
  });

  const banner = document.createElement('p');
  banner.className = 'dim';
  banner.textContent = 'DEEP FIELD BBS   MESSAGE BASE   LAST CALLER: 2001-03-01';
  panel.replaceChildren(banner, form, results, reader);
  query();
}
