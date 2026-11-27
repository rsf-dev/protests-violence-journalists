import { deriveScene } from '../core/model.js';
import { routePresentation } from '../graphics/route-groups.js';

/** Catégories interactives et petites légendes dans les cartes de texte du récit. */
export function createRouteLegend({ controller, renderer, data, config }) {
  const make = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  const buttons = [];
  let hovered = null,
    focused = null,
    pinned = null;
  function syncHighlight() {
    const id = hovered || focused || pinned;
    renderer.setHighlightedCategory(id);
    for (const button of buttons) {
      button.classList.toggle('is-highlighted', button.dataset.type === id);
      button.setAttribute('aria-pressed', String(button.dataset.type === pinned));
    }
  }
  function categoryRows(groups, list, markerClass, interactive = false) {
    list.replaceChildren();
    for (const group of groups) {
      const row = make('li');
      row.dataset.type = group.id;
      row.dataset.count = group.count;
      const marker = make('i', markerClass);
      marker.style.backgroundColor = group.color;
      marker.setAttribute('aria-hidden', 'true');
      const content = interactive ? make('button', 'category-highlight') : row;
      content.append(marker, make('strong', '', group.count), make('span', '', group.label));
      if (interactive) {
        content.type = 'button';
        content.dataset.type = group.id;
        content.style.setProperty('--category-color', group.color);
        content.setAttribute('aria-pressed', 'false');
        content.addEventListener('pointerenter', (event) => {
          if (event.pointerType === 'touch') return;
          hovered = group.id;
          syncHighlight();
        });
        content.addEventListener('pointerleave', () => {
          hovered = null;
          syncHighlight();
        });
        content.addEventListener('focus', () => {
          if (content.matches(':focus-visible')) {
            focused = group.id;
            syncHighlight();
          }
        });
        content.addEventListener('blur', () => {
          focused = null;
          syncHighlight();
        });
        content.addEventListener('click', () => {
          pinned = pinned === group.id ? null : group.id;
          syncHighlight();
        });
        content.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          hovered = focused = pinned = null;
          syncHighlight();
        });
        buttons.push(content);
        row.append(content);
      }
      list.append(row);
    }
  }
  for (const [selector, phase] of [
    ['#police-violence-list', 'police-types'],
    ['#other-violence-list', 'other-types'],
  ]) {
    const state = {
      slide: config.slides.findIndex((slide) => slide.phase === phase),
      inExplore: false,
    };
    const scene = deriveScene(state, data, config);
    categoryRows(
      routePresentation(scene, config).groups,
      document.querySelector(selector),
      'category-dot',
      true,
    );
  }

  // Les indications restent dans les cartes de texte, sous leur contenu.
  for (const [id, phase] of [
    ['cent-journalistes', 'neutral'],
    ['ville-type', 'overview'],
  ]) {
    const state = {
      slide: config.slides.findIndex((slide) => slide.phase === phase),
      inExplore: false,
    };
    const scene = deriveScene(state, data, config);
    const key = make('aside', 'story-inline-key');
    key.dataset.kind = phase === 'neutral' ? 'unit' : 'authors';
    key.setAttribute('aria-label', config.i18n.t('legend.title'));
    if (phase === 'neutral') {
      const line = make('p', 'story-key-unit');
      line.append(
        make('strong', '', scene.records.length),
        make('span', '', ' · ' + config.i18n.t('scene.unit', { year: config.year })),
      );
      key.append(line, make('p', 'story-key-point', config.i18n.t('scene.pointUnit')));
    } else
      for (const author of config.authors.filter((author) => scene.summary.authors[author.id])) {
        const line = make('p', 'story-key-author');
        const dot = make('i');
        dot.style.backgroundColor = author.color;
        dot.setAttribute('aria-hidden', 'true');
        line.append(
          dot,
          make('strong', '', scene.summary.authors[author.id]),
          make('span', '', ' · ' + author.label),
        );
        key.append(line);
      }
    const card = document.querySelector('#' + id + ' .step-card');
    const action = card.querySelector('.text-action');
    if (action) action.before(key);
    else card.append(key);
  }
  let phase = null;
  function update(state = controller.getState()) {
    const scene = deriveScene(state, data, config);
    if (phase === scene.phase && !scene.country) return;
    phase = scene.phase;
    hovered = focused = pinned = null;
    syncHighlight();
  }
  update();
  controller.subscribe(update);
}
