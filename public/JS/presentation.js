import { countryHref } from './core/routing.js';

export function enhancePresentation({ config, controller, renderer, countries }) {
  const t = config.i18n.t;
  const list = document.querySelector('#country-list');
  const legend = document.querySelector('#country-chart-legend');
  legend.replaceChildren();
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
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('ux.search');
  search.setAttribute('aria-label', t('ux.search'));
  const sorting = document.createElement('div');
  sorting.className = 'comparison-sort';
  const status = document.createElement('p');
  status.className = 'search-status';
  status.setAttribute('role', 'status');
  status.textContent = t('ux.noResults');
  status.hidden = true;
  const tabs = document.createElement('div');
  tabs.className = 'statistics-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', t('stats.filter'));
  const sortButtons = [];
  const authorButtons = [];
  let author = 'all';
  let sort = 'count';
  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const countFor = (country) =>
    author === 'all' ? country.count : country.summary.authors[author] || 0;
  const totals = Object.fromEntries(
    config.authors.map((item) => [
      item.id,
      countries.reduce((sum, country) => sum + (country.summary.authors[item.id] || 0), 0),
    ]),
  );

  function render() {
    const query = normalize(search.value.trim());
    const available = countries.filter((country) => countFor(country) > 0);
    const selected = available.filter((country) => normalize(country.label).includes(query));
    const maximum = Math.max(1, ...available.map(countFor));
    selected.sort((a, b) =>
      sort === 'count'
        ? countFor(b) - countFor(a) || a.label.localeCompare(b.label, config.language)
        : a.label.localeCompare(b.label, config.language),
    );
    list.replaceChildren();
    for (const country of selected) {
      const count = countFor(country);
      const link = document.createElement('a');
      link.className = 'country-choice chart-bar-row';
      link.href = countryHref(country.id, config.language);
      link.dataset.country = country.id;
      link.dataset.count = count;
      const name = document.createElement('span');
      name.className = 'chart-bar-label';
      name.textContent = country.label;
      name.title = country.label;
      const track = document.createElement('span');
      track.className = 'chart-bar';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = 'country-author-graph chart-bar-fill';
      bar.style.width = (count / maximum) * 100 + '%';
      for (const category of config.authors) {
        if (author !== 'all' && category.id !== author) continue;
        const value = country.summary.authors[category.id] || 0;
        if (!value) continue;
        const segment = document.createElement('span');
        segment.className = 'country-author-segment';
        segment.dataset.author = category.id;
        segment.dataset.count = value;
        segment.style.width = (value / count) * 100 + '%';
        segment.style.backgroundColor = category.color;
        segment.title = t('chart.count', { author: category.label, count: value });
        bar.append(segment);
      }
      track.append(bar);
      const value = document.createElement('strong');
      value.className = 'chart-bar-value';
      value.textContent = count;
      const breakdown = config.authors
        .filter(
          (category) =>
            (author === 'all' || category.id === author) && country.summary.authors[category.id],
        )
        .map((category) =>
          t('chart.count', { author: category.label, count: country.summary.authors[category.id] }),
        )
        .join(' · ');
      link.setAttribute(
        'aria-label',
        t('chart.countryLabel', { country: country.label, count, breakdown }),
      );
      link.append(name, track, value);
      link.addEventListener('pointerenter', () => renderer.hoverCountry(country.id));
      link.addEventListener('pointerleave', () => renderer.hoverCountry(null));
      link.addEventListener('focus', () => renderer.hoverCountry(country.id));
      link.addEventListener('blur', () => renderer.hoverCountry(null));
      list.append(link);
    }
    status.hidden = selected.length > 0;
    legend.hidden = author !== 'all';
    for (const button of sortButtons)
      button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
    for (const button of authorButtons)
      button.setAttribute('aria-pressed', String(button.dataset.author === author));
    document.querySelector('#world-total').textContent = available.reduce(
      (sum, country) => sum + countFor(country),
      0,
    );
    document.querySelector('#country-total').textContent = available.length;
    if (document.body.dataset.page === 'world') {
      document.querySelector('#accessible-summary').textContent = t('stats.selectionSummary', {
        author:
          author === 'all'
            ? t('stats.all')
            : config.authors.find((item) => item.id === author).label,
        cases: available.reduce((sum, country) => sum + countFor(country), 0),
        countries: available.length,
      });
    }
    renderer.setAuthorFilter(author);
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
  for (const id of ['all', ...config.authors.map((item) => item.id)]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.author = id;
    button.className = 'statistics-tab';
    const label = document.createElement('span');
    const count = document.createElement('span');
    label.textContent = t('stats.tab.' + id);
    count.className = 'statistics-tab-count';
    count.textContent =
      id === 'all' ? countries.reduce((sum, country) => sum + country.count, 0) : totals[id];
    const fullName =
      id === 'all' ? t('stats.all') : config.authors.find((item) => item.id === id).label;
    button.title = fullName;
    button.setAttribute('aria-label', fullName + ' · ' + count.textContent);
    button.append(label, count);
    button.addEventListener('click', () => {
      author = id;
      render();
    });
    tabs.append(button);
    authorButtons.push(button);
  }
  search.addEventListener('input', render);
  tools.append(search, sorting, status);
  legend.before(tabs);
  list.before(tools);
  list.classList.add('statistics-bars');
  render();
  function heading() {
    if (document.body.dataset.page !== 'world') return;
    document.querySelector('#explorer-title').textContent = t('ux.worldTitle');
    document.querySelector('#explorer-description').textContent = t('ux.worldDescription');
    render();
  }
  heading();
  controller.subscribe(heading);
}
