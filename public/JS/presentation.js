import { countryHref } from './core/routing.js';

/** Le panneau existant, sans les commandes ni le moteur de carte mondiale. */
export function enhancePresentation({ config, countries, onCountry }) {
  const t = config.i18n.t;
  const list = document.querySelector('#country-list');
  const legend = document.querySelector('#country-chart-legend');
  for (const author of config.authors) {
    const item = document.createElement('span');
    const marker = document.createElement('i');
    marker.className = 'author-marker';
    marker.style.backgroundColor = author.color;
    marker.setAttribute('aria-hidden', 'true');
    item.append(marker, document.createTextNode(author.label));
    legend.append(item);
  }
  const tools = document.createElement('div');
  tools.className = 'comparison-tools';
  const sorting = document.createElement('div');
  sorting.className = 'comparison-sort';
  const sortButtons = [];
  let sort = 'count';

  function render() {
    const selected = [...countries].sort((a, b) =>
      sort === 'count'
        ? b.count - a.count || a.label.localeCompare(b.label, config.language)
        : a.label.localeCompare(b.label, config.language),
    );
    const maximum = Math.max(1, ...countries.map((country) => country.count));
    list.replaceChildren();
    for (const country of selected) {
      const link = document.createElement('a');
      link.className = 'country-choice chart-bar-row';
      link.href = countryHref(country.id, config.language);
      link.dataset.country = country.id;
      link.dataset.count = country.count;
      const name = document.createElement('span');
      name.className = 'chart-bar-label';
      name.textContent = country.label;
      name.title = country.label;
      const track = document.createElement('span');
      track.className = 'chart-bar';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = 'country-author-graph chart-bar-fill';
      bar.style.width = (country.count / maximum) * 100 + '%';
      for (const author of config.authors) {
        const count = country.summary.authors[author.id] || 0;
        if (!count) continue;
        const segment = document.createElement('span');
        segment.className = 'country-author-segment';
        segment.dataset.author = author.id;
        segment.dataset.count = count;
        segment.style.width = (count / country.count) * 100 + '%';
        segment.style.backgroundColor = author.color;
        segment.title = t('chart.count', { author: author.label, count });
        bar.append(segment);
      }
      track.append(bar);
      const value = document.createElement('strong');
      value.className = 'chart-bar-value';
      value.textContent = country.count;
      const breakdown = config.authors
        .filter((author) => country.summary.authors[author.id])
        .map((author) =>
          t('chart.count', { author: author.label, count: country.summary.authors[author.id] }),
        )
        .join(' · ');
      link.setAttribute(
        'aria-label',
        t('chart.countryLabel', {
          country: country.label,
          count: country.count,
          breakdown,
        }),
      );
      link.append(name, track, value);
      link.addEventListener('click', (event) => {
        // Conserver l’ouverture dans un nouvel onglet et l’URL partageable du pays.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        onCountry(country.id);
      });
      list.append(link);
    }
    for (const button of sortButtons)
      button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
  }
  for (const [value, key] of [
    ['count', 'ux.sortCount'],
    ['name', 'ux.sortName'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sort = value;
    button.textContent = t(key);
    button.addEventListener('click', () => {
      sort = value;
      render();
    });
    sorting.append(button);
    sortButtons.push(button);
  }
  tools.append(sorting);
  list.before(tools);
  list.classList.add('statistics-bars');
  render();
}
