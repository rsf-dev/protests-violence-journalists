import { resourceURL } from '../core/resources.js';

const origins = new Set(['https://tiles.openfreemap.org', 'https://server.arcgisonline.com']);

/** Les deux fournisseurs sont ceux de la carte Bilan fournie en référence. */
export function secureMapRequest(value, base = location.href) {
  const source = new URL(base);
  const target = new URL(value, source);
  if (
    target.username ||
    target.password ||
    !['https:', 'http:'].includes(target.protocol) ||
    (target.origin !== source.origin && !origins.has(target.origin))
  ) {
    throw new Error('Map resource outside allowed origins');
  }
  return { url: target.href, credentials: 'omit', referrerPolicy: 'no-referrer' };
}

export function basemapStyle(entry) {
  if (entry.type === 'vector')
    return entry.url.startsWith('https://') ? entry.url : resourceURL(entry.url);
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [entry.url],
        tileSize: 256,
        maxzoom: entry.maxZoom,
        attribution: entry.attribution,
      },
    },
    layers: [
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 150 } },
    ],
  };
}

/** Même sélection de fonds en bas à droite que le contrôle de couches de l’exemple. */
export function createBasemapControl({ entries, selected, t, onSelect }) {
  const root = document.createElement('div');
  root.className = 'maplibregl-ctrl basemap-control';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'basemap-toggle';
  toggle.setAttribute('aria-label', t('map.basemaps'));
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'basemap-options');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5');
  svg.append(path);
  toggle.append(svg);
  const panel = document.createElement('fieldset');
  panel.id = 'basemap-options';
  panel.hidden = true;
  const legend = document.createElement('legend');
  legend.textContent = t('map.basemaps');
  panel.append(legend);
  const inputs = [];
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
  }
  for (const entry of entries) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'basemap';
    input.value = entry.id;
    input.checked = entry.id === selected;
    input.addEventListener('change', () => {
      onSelect(entry.id);
      setOpen(false);
      toggle.focus({ preventScroll: true });
    });
    inputs.push(input);
    label.append(input, document.createTextNode(t(entry.labelKey)));
    panel.append(label);
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  root.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') setOpen(true);
  });
  root.addEventListener('pointerleave', () => {
    if (!root.contains(document.activeElement)) setOpen(false);
  });
  const outside = (event) => {
    if (!root.contains(event.target)) setOpen(false);
  };
  const keyboard = (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false);
    toggle.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
  };
  root.append(toggle, panel);
  return {
    onAdd() {
      document.addEventListener('pointerdown', outside);
      root.addEventListener('keydown', keyboard);
      return root;
    },
    onRemove() {
      document.removeEventListener('pointerdown', outside);
      root.removeEventListener('keydown', keyboard);
      root.remove();
    },
    sync(id) {
      for (const input of inputs) input.checked = input.value === id;
    },
  };
}
