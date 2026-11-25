import type { Artifact } from '../content/schema.ts';

/** Plain links. The client makes no GitHub API calls and holds no credentials. */
export function openArtifact(panel: HTMLElement, artifact: Artifact): void {
  const list = document.createElement('nav');
  list.className = 'artifact-links';
  list.setAttribute('aria-label', artifact.name);
  for (const link of artifact.links) {
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.label;
    list.append(anchor);
  }
  panel.replaceChildren(list);
  if (artifact.contributorRecord) openContributorRecord(panel, artifact.contributorRecord);
}

export function openContributorRecord(
  panel: HTMLElement,
  copy: NonNullable<Artifact['contributorRecord']>,
): void {
  const mount = document.createElement('div');
  panel.append(mount);
  void import('./contributor-view.ts')
    .then(({ showContributors }) => showContributors(mount, copy))
    .catch(() => {
      mount.textContent = copy.loadFailure;
    });
}
