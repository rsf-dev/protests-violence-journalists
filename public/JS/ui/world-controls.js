/** Commandes de la vue mondiale, sur le modèle du Bilan RSF. */
export function createWorldControls({
  config,
  controller,
  countries,
  onStats,
  onReplay,
  onReset,
  onChoropleth,
  onGeography,
  onClear,
}) {
  const t = config.i18n.t;
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const header = document.querySelector('.site-header');
  const credits = document.querySelector('.footer-credits');
  const headerOrigin = document.createComment('Position du titre dans le récit');
  const creditOrigin = document.createComment('Position des crédits dans le récit');
  header.before(headerOrigin);
  credits.before(creditOrigin);
  const root = make('section', 'map-title-panel');
  root.id = 'map-title-panel';
  root.setAttribute('aria-label', t('map.controls'));
  const heading = make('div', 'map-title-heading');
  const toggle = make('button', 'map-title-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', 'map-title-content');
  const arrow = make('span', 'map-title-chevron');
  arrow.setAttribute('aria-hidden', 'true');
  toggle.append(arrow);
  heading.append(toggle);
  const content = make('div', 'map-title-content');
  content.id = 'map-title-content';
  const filters = make('div', 'title-filter-grid');
  const country = make('select');
  country.id = 'title-country-select';
  country.setAttribute('aria-label', t('map.countryFilter'));
  const region = make('select');
  region.id = 'title-area-select';
  region.setAttribute('aria-label', t('map.regionFilter'));
  const regions = [
    ...new Set(
      countries
        .flatMap((country) => country.records.map((record) => record.region))
        .filter(Boolean),
    ),
  ].sort((a, b) =>
    config.i18n.regionName(a).localeCompare(config.i18n.regionName(b), config.language),
  );
  const option = (value, label) => {
    const item = make('option', '', label);
    item.value = value;
    return item;
  };
  region.append(
    option('', t('map.allRegions')),
    ...regions.map((value) => option(value, config.i18n.regionName(value))),
  );
  function countryOptions() {
    const previous = country.value;
    country.replaceChildren(
      option('', t('map.allCountries')),
      ...countries
        .filter(
          (item) => !region.value || item.records.some((record) => record.region === region.value),
        )
        .sort((a, b) => a.label.localeCompare(b.label, config.language))
        .map((item) => option(item.id, item.label)),
    );
    country.value = [...country.options].some((item) => item.value === previous) ? previous : '';
  }
  countryOptions();
  filters.append(country, region);
  const summary = make('p', 'map-selection-summary');
  summary.id = 'map-selection-summary';
  summary.setAttribute('role', 'status');
  const authorHost = make('div', 'title-category-list');
  authorHost.setAttribute('role', 'group');
  authorHost.setAttribute('aria-label', t('stats.filter'));
  const clear = make('button', 'title-clear-filters', t('map.clearFilters'));
  clear.id = 'title-clear-filters';
  clear.type = 'button';
  clear.hidden = true;
  clear.addEventListener('click', onClear);
  const scale = make('div', 'map-legend-host');
  scale.append(document.querySelector('.choropleth-legend'));
  content.append(filters, summary, authorHost, clear, scale);
  root.append(heading, content);
  document.body.append(root);
  new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--map-summary-height',
      root.getBoundingClientRect().height + 'px',
    ),
  ).observe(root);
  const menu = make('div', 'utility-menu');
  menu.id = 'utility-menu';
  const menuToggle = make('button', 'utility-menu-toggle');
  menuToggle.type = 'button';
  menuToggle.id = 'utility-menu-toggle';
  menuToggle.setAttribute('aria-controls', 'utility-menu-panel');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', t('menu.open'));
  const burger = make('span');
  burger.setAttribute('aria-hidden', 'true');
  burger.append(make('i'));
  menuToggle.append(burger);
  const menuPanel = make('div', 'utility-menu-panel');
  menuPanel.id = 'utility-menu-panel';
  menuPanel.hidden = true;
  menuPanel.inert = true;
  let expanded = innerWidth >= 760;
  function closeMenu(focus = false) {
    menu.classList.remove('open');
    menuPanel.hidden = true;
    menuPanel.inert = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', t('menu.open'));
    if (focus) menuToggle.focus({ preventScroll: true });
  }
  function item(id, key, action) {
    const button = make('button', 'utility-menu-item', t(key));
    button.id = id;
    button.type = 'button';
    button.addEventListener('click', () => {
      closeMenu(true);
      action();
    });
    menuPanel.append(button);
    return button;
  }
  let choroplethEnabled = true;
  const choropleth = item('utility-choropleth-toggle', 'map.choropleth', () => {
    choroplethEnabled = !choroplethEnabled;
    choropleth.setAttribute('aria-pressed', String(choroplethEnabled));
    onChoropleth(choroplethEnabled);
  });
  choropleth.setAttribute('aria-pressed', 'true');
  const stats = item('utility-country-toggle', 'menu.statistics', onStats);
  const legend = item('utility-legend-toggle', 'menu.legend', () => {
    expanded = !expanded;
    syncExpanded();
  });
  item('utility-reset-view', 'map.reset', onReset);
  item('utility-replay', 'nav.restart', onReplay);
  menu.append(menuToggle, menuPanel);
  document.body.append(menu);
  function syncExpanded() {
    root.classList.toggle('collapsed', !expanded);
    content.hidden = !expanded;
    content.inert = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', t(expanded ? 'map.collapseControls' : 'map.expandControls'));
    legend.setAttribute('aria-pressed', String(expanded));
  }
  toggle.addEventListener('click', () => {
    expanded = !expanded;
    syncExpanded();
  });
  menuToggle.addEventListener('click', () => {
    const open = menuPanel.hidden;
    if (!open) {
      closeMenu();
      return;
    }
    menuPanel.hidden = false;
    menuPanel.inert = false;
    menu.classList.add('open');
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', t('menu.close'));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !menuPanel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    },
    true,
  );
  country.addEventListener('change', () =>
    onGeography({ country: country.value, region: region.value }),
  );
  region.addEventListener('change', () => {
    countryOptions();
    onGeography({ country: country.value, region: region.value });
  });
  function scene() {
    const state = controller.getState();
    const world = state.inExplore && state.view === 'world';
    root.hidden = menu.hidden = !world;
    if (world) {
      if (header.parentElement !== heading) heading.prepend(header);
      if (credits.parentElement !== content) content.append(credits);
    } else {
      headerOrigin.after(header);
      creditOrigin.after(credits);
      closeMenu();
    }
    syncExpanded();
  }
  scene();
  controller.subscribe(scene);
  return {
    authorHost,
    setSummary({
      cases,
      countryCount,
      hasFilters,
      country: selectedCountry,
      region: selectedRegion,
    }) {
      summary.textContent = t('map.selectionSummary', { cases, countries: countryCount });
      if (region.value !== selectedRegion) {
        region.value = selectedRegion;
        countryOptions();
      }
      country.value = selectedCountry;
      clear.hidden = !hasFilters;
    },
    setPanelOpen(open) {
      stats.setAttribute('aria-pressed', String(open));
    },
  };
}
