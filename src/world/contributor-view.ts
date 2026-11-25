import { loadBundledContributors } from '../content/contributors-browser.ts';
import { selectContributorNote } from '../content/contributors.ts';
import type { Artifact } from '../content/schema.ts';

export function showContributors(
  mount: HTMLElement,
  copy: NonNullable<Artifact['contributorRecord']>,
): void {
  const { entries, status } = loadBundledContributors();
  const section = document.createElement('section');
  section.className = 'contributor-record';
  section.setAttribute('aria-label', copy.heading);
  const heading = document.createElement('h2');
  heading.textContent = copy.heading;
  const review = document.createElement('p');
  review.textContent = copy.review;
  section.append(heading, review);

  const note = selectContributorNote(status, copy);
  if (note) {
    const message = document.createElement('p');
    message.textContent = note;
    section.append(message);
  }
  if (entries.length) {
    const list = document.createElement('ul');
    for (const { author, handle, sourcePrs } of entries) {
      const entry = document.createElement('li');
      const name = handle === undefined ? author : `${author} (${handle})`;
      entry.textContent = [name, ...sourcePrs].join(' · ');
      list.append(entry);
    }
    section.append(list);
  }
  mount.append(section);
}
