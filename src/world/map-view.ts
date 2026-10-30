import type { MapNode } from './map.ts';

const SVG = 'http://www.w3.org/2000/svg';

export function openMap(
  panel: HTMLElement,
  nodes: readonly MapNode[],
  onSelect: (node: MapNode) => void,
): void {
  const map = document.createElement('div');
  map.className = 'network-map';
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'Network map');

  const links = document.createElementNS(SVG, 'svg');
  links.setAttribute('viewBox', '0 0 100 100');
  links.setAttribute('preserveAspectRatio', 'none');
  links.setAttribute('aria-hidden', 'true');
  nodes.forEach((node, index) => {
    const next = nodes[(index + 1) % nodes.length]!;
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', String(node.sector.position.x));
    line.setAttribute('y1', String(node.sector.position.y));
    line.setAttribute('x2', String(next.sector.position.x));
    line.setAttribute('y2', String(next.sector.position.y));
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    if (!node.enterable || !next.enterable) line.setAttribute('stroke-dasharray', '3 5');
    links.append(line);
  });
  map.append(links);

  for (const node of nodes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = node.enterable ? 'map-node' : 'map-node map-node-locked';
    button.style.left = `${node.sector.position.x}%`;
    button.style.top = `${node.sector.position.y}%`;
    button.textContent = node.sector.name;
    button.addEventListener('click', () => onSelect(node));
    map.append(button);
  }
  panel.replaceChildren(map);
}
