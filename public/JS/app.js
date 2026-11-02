import { createConfig } from './config.js';
import {
  validateDataset,
  validateDatasetShape,
  typicalRecords,
  summarize,
  groupCountries,
  deriveScene,
  worldStats,
  journalistDetails,
} from './core/model.js';
import { createRenderer } from './graphics/scene.js';
import { countryHref, pageHref, readRoute, createPageController } from './core/routing.js';
import { resourceURL } from './core/resources.js';
import { DATA_LIMITS, fetchJSON, validateAtlas } from './core/security.js';

const route = readRoute(window.location.href, history.state);
let CONFIG = createConfig(route.language);
const { i18n } = CONFIG,
  { t } = i18n;
const $ = (selector) => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stepElements = [...document.querySelectorAll('.story-step')];
let page = route.page;
document.documentElement.lang = route.language;
document.body.dataset.page = page;
document.body.dataset.country = route.country;
i18n.apply($('#loading'));
$('#loading-retry').addEventListener('click', () => window.location.reload());
let loadingProgress = 0;
let controller,
  renderer,
  data,
  countries,
  scrollFrame = null,
  dragging = null,
  pendingActivation = null,
  lastJournalistId = null,
  popoverAnchor = null;
let explorerOpen =
  page === 'world' ? CONFIG.ui.worldPanelOpen : page === 'country' && CONFIG.ui.countryPanelOpen;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const fail = () => {
      clearTimeout(timeout);
      reject(new Error(t('error.image', { url })));
    };
    const timeout = setTimeout(fail, DATA_LIMITS.timeoutMs);
    image.onload = () => {
      clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = fail;
    image.src = resourceURL(url);
  });
}
function setLoadingProgress(value, message = 'loading') {
  if ($('#loading').classList.contains('error')) return;
  loadingProgress = Math.max(loadingProgress, Math.min(100, Math.round(value)));
  $('#loading-progress').setAttribute('aria-valuenow', String(loadingProgress));
  $('#loading-progress').setAttribute(
    'aria-valuetext',
    t('loading.progress', { percentage: loadingProgress }),
  );
  $('#loading-bar-fill').style.width = loadingProgress + '%';
  $('#loading-status').textContent = t(message);
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function finishLoading() {
  setLoadingProgress(100, 'loading.ready');
  $('#loading').setAttribute('aria-busy', 'false');
  if (!reducedMotion.matches) await delay(400);
  $('#loading').classList.add('is-complete');
  if (!reducedMotion.matches) await delay(400);
  $('#loading').hidden = true;
}
function openCountry(id) {
  if (countries.some((country) => country.id === id))
    window.location.assign(new URL(countryHref(id, CONFIG.language), document.baseURI).href);
}
function setPage(view) {
  const sameAddress = view === 'world' && page === 'scrolly';
  page = view;
  document.body.dataset.page = view;
  document.body.dataset.country = '';
  const state = { newsCity: { view } };
  const href = sameAddress ? window.location.href : pageHref(view, CONFIG.language);
  history.pushState(state, '', href);
  if (view === 'world') controller.skip();
  else controller.replay();
  setExplorerOpen(view === 'world');
  window.scrollTo(0, 0);
}
function updateLayout() {
  document.documentElement.style.setProperty(
    '--footer-height',
    $('.page-footer').getBoundingClientRect().height + 'px',
  );
}
function resizeScene() {
  const bounds = $('#scene').getBoundingClientRect();
  renderer.resize(bounds.width, bounds.height, devicePixelRatio || 1);
  updateLayout();
}
function setExplorerOpen(open, focus = false) {
  explorerOpen = open;
  $('#explorer').classList.toggle('is-open', open);
  document.body.classList.toggle('panel-open', open && page !== 'scrolly');
  $('#explorer-toggle').setAttribute('aria-expanded', String(open));
  $('#explorer-toggle').title = t(open ? 'panel.close' : 'panel.open');
  // Conserver le contenu pendant le coulissement de fermeture ; inert le retire du clavier.
  if (open) $('#explorer-content').hidden = false;
  $('#explorer-content').inert = !open;
  $('.explorer-surface').inert = !open;
  $('.explorer-surface').setAttribute('aria-hidden', String(!open));
  if (focus) $(open ? '#explorer-close' : '#explorer-toggle').focus({ preventScroll: true });
  updateLayout();
}
function renderCountryList() {
  const list = $('#country-list');
  list.replaceChildren();
  const legend = $('#country-chart-legend');
  legend.replaceChildren();
  for (const author of CONFIG.authors) {
    const item = document.createElement('span'),
      marker = document.createElement('i');
    marker.className = 'author-marker';
    marker.style.backgroundColor = author.color;
    marker.setAttribute('aria-hidden', 'true');
    item.append(marker, document.createTextNode(author.label));
    legend.append(item);
  }
  const maximum = Math.max(...countries.map((country) => country.count));
  for (const country of countries) {
    const link = document.createElement('a');
    link.href = countryHref(country.id, CONFIG.language);
    link.className = 'country-choice';
    link.dataset.country = country.id;
    const counts = country.summary.authors;
    link.setAttribute(
      'aria-label',
      t('chart.countryLabel', {
        country: country.label,
        count: country.count,
        breakdown: authorSummary(counts),
      }),
    );
    const name = document.createElement('span');
    name.textContent = country.label;
    const total = document.createElement('strong');
    total.textContent = country.count;
    link.append(name, total, authorBar(counts, country.count, maximum));
    list.append(link);
  }
  const select = $('#journalist-select');
  for (const record of data.records.filter(
    (record) => page === 'country' && record.countryCode === document.body.dataset.country,
  )) {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent =
      i18n.recordTitle(record) + ' · ' + (i18n.mediaName(record.media) || record.id);
    select.append(option);
  }
}
function authorSummary(counts) {
  return CONFIG.authors
    .filter((author) => counts[author.id])
    .map((author) => t('chart.count', { author: author.label, count: counts[author.id] }))
    .join(' · ');
}
function authorBar(counts, total, maximum = total) {
  const graph = document.createElement('span');
  graph.className = 'country-author-graph';
  graph.setAttribute('aria-hidden', 'true');
  graph.style.width = maximum ? (total / maximum) * 100 + '%' : '0%';
  const percentage = new Intl.NumberFormat(CONFIG.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  for (const author of CONFIG.authors) {
    const count = counts[author.id] || 0;
    if (!count) continue;
    const segment = document.createElement('span');
    segment.className = 'country-author-segment';
    segment.dataset.author = author.id;
    segment.dataset.count = count;
    segment.style.width = (count / total) * 100 + '%';
    segment.style.backgroundColor = author.color;
    segment.title = t('chart.segment', {
      author: author.label,
      count,
      percentage: percentage.format(count / total),
    });
    graph.append(segment);
  }
  return graph;
}
function showJournalist(id, anchor = null) {
  popoverAnchor = anchor || { x: window.innerWidth * 0.66, y: window.innerHeight * 0.38 };
  controller.selectJournalist(id);
  $('#tooltip').hidden = true;
}
function renderJournalistPopover(state) {
  const record = data.records.find((item) => item.id === state.journalistId),
    popover = $('#journalist-popover');
  popover.hidden = !record;
  $('#journalist-select').value = record?.id || '';
  if (!record) {
    lastJournalistId = null;
    return;
  }
  const changed = lastJournalistId !== record.id;
  lastJournalistId = record.id;
  $('#journalist-title').textContent = i18n.recordTitle(record);
  const fields = $('#journalist-details');
  fields.replaceChildren();
  for (const field of journalistDetails(record, CONFIG)) {
    const name = document.createElement('dt'),
      value = document.createElement('dd');
    name.textContent = field.label;
    if (field.href) {
      const link = document.createElement('a');
      link.href = field.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = t('record.viewSource');
      link.title = field.href;
      value.append(link);
    } else value.textContent = field.value;
    fields.append(name, value);
  }
  const anchor = popoverAnchor || { x: window.innerWidth * 0.66, y: window.innerHeight * 0.38 };
  const width = Math.min(360, window.innerWidth - 32),
    height = Math.min(500, window.innerHeight * 0.65);
  popover.style.left = Math.max(16, Math.min(window.innerWidth - width - 16, anchor.x + 14)) + 'px';
  popover.style.top =
    Math.max(16, Math.min(window.innerHeight - height - 70, anchor.y - 24)) + 'px';
  if (changed) $('#close-journalist').focus({ preventScroll: true });
}
function updateUI(state) {
  const scene = deriveScene(state, data, CONFIG),
    world = scene.kind === 'world';
  const country = scene.country?.label || CONFIG.cityName;
  const showTitle = world || (!state.inExplore && ['intro', 'overview'].includes(scene.phase));
  document.body.classList.toggle('is-exploring', state.inExplore);
  document.body.classList.toggle('has-page-title', showTitle);
  $('.infographic-title').hidden = !showTitle;
  $('#story-progress').hidden = state.inExplore;
  $('#explorer-toggle-label').textContent = t(world ? 'panel.worldToggle' : 'panel.countryToggle', {
    countries: countries.length,
    country,
  });
  $('#return-map-button').hidden = !(state.inExplore && scene.country);
  $('#globe-hint').hidden = !(world || scene.country);
  $('#globe-hint').textContent = t(world ? 'scene.globeHint' : 'scene.countryHint');
  $('#scene').tabIndex = state.inExplore ? 0 : -1;
  $('#scene').setAttribute(
    'aria-label',
    world
      ? t('scene.world')
      : scene.kind === 'intro'
        ? t('scene.intro')
        : t('scene.city', {
            country,
            count: scene.records.length,
            police: scene.summary.police,
            other: scene.summary.other,
          }) + (scene.country ? ' ' + t('scene.recordHint') : ''),
  );
  stepElements.forEach((element, index) =>
    element.classList.toggle('is-active', !state.inExplore && index === state.slide),
  );
  [...$('#story-progress').children].forEach((button, index) => {
    if (index === state.slide) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  $('#world-panel').hidden = !world;
  $('#city-panel').hidden = world;
  $('#explorer-title').textContent = world
    ? t('panel.worldTitle', {
        cases: data.records.length,
        countries: countries.length,
        year: data.metadata.year || CONFIG.year,
      })
    : country;
  $('#explorer-description').hidden = !world;
  $('#city-total').textContent = scene.records.length;
  const actors = $('#actor-counts');
  actors.replaceChildren();
  for (const author of CONFIG.authors) {
    const count = scene.summary.authors[author.id];
    if (!count) continue;
    const item = document.createElement('span'),
      marker = document.createElement('i'),
      total = document.createElement('strong'),
      label = document.createElement('span');
    marker.className = 'fill-dot';
    marker.style.backgroundColor = author.color;
    marker.setAttribute('aria-hidden', 'true');
    total.textContent = count;
    label.textContent = author.label;
    item.append(marker, total, label);
    actors.append(item);
  }
  const table = $('#violence-rows');
  table.replaceChildren();
  for (const type of CONFIG.violenceTypes) {
    const count = scene.summary.types[type.id];
    if (!count) continue;
    const row = document.createElement('tr'),
      label = document.createElement('td'),
      ring = document.createElement('i');
    ring.className = 'type-ring';
    ring.style.borderColor = type.color;
    ring.setAttribute('aria-hidden', 'true');
    label.append(ring, document.createTextNode(type.label));
    const total = document.createElement('td'),
      authors = document.createElement('td');
    total.textContent = count;
    authors.className = 'category-authors';
    authors.append(authorBar(scene.summary.byType[type.id], count));
    authors.setAttribute('aria-label', authorSummary(scene.summary.byType[type.id]));
    row.dataset.type = type.id;
    row.append(label, total, authors);
    table.append(row);
  }
  const summary = world
    ? t('summary.world', { cases: data.records.length, countries: countries.length }) +
      ' ' +
      countries.map((item) => item.label + ': ' + item.count).join('. ')
    : t('summary.country', {
        country,
        count: scene.records.length,
        breakdown: authorSummary(scene.summary.authors),
      });
  $('#accessible-summary').textContent =
    (!state.inExplore ? CONFIG.slides[state.slide].title + ' ' : '') +
    summary +
    ' ' +
    t('summary.source');
  document.title =
    (scene.country ? country + ' — ' : world ? t('page.worldPrefix') : '') +
    t('page.title', { year: data.metadata.year || CONFIG.year });
  renderer.setState(state, reducedMotion.matches);
  renderJournalistPopover(state);
  updateLayout();
}
function updateScroll() {
  scrollFrame = null;
  if (page !== 'scrolly') return;
  let index = 0;
  for (const [i, element] of stepElements.entries())
    if (element.getBoundingClientRect().top <= window.innerHeight * 0.48) index = i;
  controller.setSlide(index);
}
function queueScroll() {
  if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateScroll);
}
function wireEvents() {
  for (const selector of ['#world-data-link', '#return-map-button'])
    $(selector).addEventListener('click', (event) => {
      event.preventDefault();
      setPage('world');
    });
  for (const link of document.querySelectorAll('.brand,#reset-button'))
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setPage('scrolly');
    });
  window.addEventListener('popstate', () => window.location.reload());
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', () => {
    resizeScene();
    queueScroll();
  });
  if (globalThis.ResizeObserver) {
    new ResizeObserver(resizeScene).observe($('#scene'));
    const layoutObserver = new ResizeObserver(updateLayout);
    layoutObserver.observe($('.page-footer'));
    layoutObserver.observe($('.site-header'));
  }
  reducedMotion.addEventListener('change', () =>
    renderer.setState(controller.getState(), reducedMotion.matches),
  );
  document.addEventListener('visibilitychange', () => renderer.setSuspended(document.hidden));
  $('#explorer-toggle').addEventListener('click', () => setExplorerOpen(!explorerOpen, true));
  $('#explorer-close').addEventListener('click', () => setExplorerOpen(false, true));
  $('#close-journalist').addEventListener('click', () => {
    controller.closeJournalist();
    $('#scene').focus({ preventScroll: true });
  });
  $('#journalist-select').addEventListener('change', (event) => {
    if (event.target.value) showJournalist(event.target.value);
  });
  document.addEventListener('pointerdown', (event) => {
    if (
      controller.getState().journalistId &&
      !$('#journalist-popover').contains(event.target) &&
      event.target !== $('#journalist-select')
    )
      controller.closeJournalist();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (controller.getState().journalistId) {
      event.preventDefault();
      controller.closeJournalist();
      $('#scene').focus({ preventScroll: true });
    } else if (page !== 'scrolly' && explorerOpen) {
      event.preventDefault();
      setExplorerOpen(false, true);
    }
  });
  const canvas = $('#scene');
  canvas.addEventListener('keydown', (event) => {
    if (!controller.getState().inExplore || renderer.getSnapshot().kind !== 'world') return;
    const movement = {
      ArrowLeft: [-45, 0],
      ArrowRight: [45, 0],
      ArrowUp: [0, -35],
      ArrowDown: [0, 35],
    }[event.key];
    if (movement) {
      event.preventDefault();
      renderer.rotate(...movement);
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    pendingActivation = null;
    const snapshot = renderer.getSnapshot();
    if (snapshot.kind !== 'world' && !snapshot.countryId) return;
    if (snapshot.kind === 'world') renderer.beginRotation(event.timeStamp);
    const point = renderer.clientToScene(event.clientX, event.clientY);
    dragging = {
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      journalistId: renderer.hitJournalist(point.x, point.y, event.pointerType === 'touch')?.record
        .id,
      countryId: renderer.hitCountry(point.x, point.y)?.id,
    };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging) {
      if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 5)
        dragging.moved = true;
      if (dragging.moved && renderer.getSnapshot().kind === 'world')
        renderer.dragRotation(
          event.clientX - dragging.x,
          event.clientY - dragging.y,
          event.timeStamp,
        );
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      $('#tooltip').hidden = true;
      return;
    }
    if (controller.getState().journalistId) return;
    const point = renderer.clientToScene(event.clientX, event.clientY);
    const country = renderer.hitCountry(point.x, point.y),
      person = renderer.hitJournalist(point.x, point.y),
      tooltip = $('#tooltip');
    renderer.hoverCountry(country?.id || null);
    canvas.style.cursor =
      country || person ? 'pointer' : renderer.getSnapshot().kind === 'world' ? 'grab' : '';
    if (!country || event.pointerType === 'touch') {
      tooltip.hidden = true;
      return;
    }
    tooltip.replaceChildren();
    for (const [tag, key, values] of [
      ['strong', 'tooltip.title', { country: country.label, count: country.count }],
      ['small', 'tooltip.counts', { breakdown: authorSummary(country.summary.authors) }],
      ['small', 'tooltip.action', {}],
    ]) {
      const element = document.createElement(tag);
      element.textContent = t(key, values);
      tooltip.append(element);
    }
    tooltip.style.left = Math.max(8, Math.min(window.innerWidth - 280, event.clientX + 16)) + 'px';
    tooltip.style.top = Math.max(85, Math.min(window.innerHeight - 110, event.clientY - 70)) + 'px';
    tooltip.hidden = false;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (dragging && renderer.getSnapshot().kind === 'world') renderer.endRotation(event.timeStamp);
    pendingActivation =
      dragging && !dragging.moved
        ? { ...dragging, anchor: { x: event.clientX, y: event.clientY } }
        : null;
    dragging = null;
  });
  // Attendre le clic complet évite qu’un appui tactile referme la fiche qu’il vient d’ouvrir.
  canvas.addEventListener('click', () => {
    const activation = pendingActivation;
    pendingActivation = null;
    if (activation?.journalistId) showJournalist(activation.journalistId, activation.anchor);
    else if (activation?.countryId) openCountry(activation.countryId);
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = null;
    pendingActivation = null;
    renderer.cancelRotation();
  });
  canvas.addEventListener('pointerleave', () => {
    renderer.hoverCountry(null);
    $('#tooltip').hidden = true;
  });
}
async function init() {
  try {
    if (!globalThis.d3 || !globalThis.topojson) throw new Error(t('error.libraries'));
    setLoadingProgress(10);
    let completedResources = 0;
    const trackResource = async (promise) => {
      const result = await promise;
      completedResources += 1;
      setLoadingProgress(10 + (completedResources / 4) * 70);
      return result;
    };
    const [source, atlas, intro, graph] = await Promise.all([
      trackResource(fetchJSON(resourceURL(CONFIG.dataUrl), { maxBytes: DATA_LIMITS.eventsBytes })),
      trackResource(
        fetchJSON(resourceURL(CONFIG.atlasUrl), { maxBytes: DATA_LIMITS.atlasBytes })
          .then(validateAtlas)
          .catch(() => null),
      ),
      trackResource(loadImage(CONFIG.images.intro)),
      trackResource(loadImage(CONFIG.images.graph)),
    ]);
    validateDatasetShape(source);
    CONFIG = createConfig(CONFIG.language, source.metadata);
    data = validateDataset(source, CONFIG);
    countries = groupCountries(data.records, CONFIG.language);
    if (page === 'country' && !countries.some((country) => country.id === route.country)) {
      page = 'world';
      document.body.dataset.page = page;
      document.body.dataset.country = '';
    }
    controller = createPageController(data, CONFIG, page, document.body.dataset.country);
    const canonical = pageHref(page, CONFIG.language, document.body.dataset.country);
    history.replaceState(
      { newsCity: { view: page } },
      '',
      canonical + (['scrolly', 'world'].includes(page) ? window.location.hash : ''),
    );
    const initialSlide = CONFIG.slides.findIndex((slide) => slide.id === route.slide);
    if (page === 'scrolly' && initialSlide >= 0) controller.setSlide(initialSlide);
    const typical = summarize(typicalRecords(data)),
      totals = worldStats(data.records),
      year = data.metadata.year || CONFIG.year;
    i18n.apply(document, {
      year,
      typical: typical.total,
      police: { value: typical.police, className: 'police' },
      other: { value: typical.other, className: 'other' },
      countries: totals.countries,
      cases: totals.cases,
    });
    setLoadingProgress(85, 'loading.preparing');
    document.querySelector('meta[name="description"]').content = t('page.description');
    for (const link of document.querySelectorAll('.brand,#reset-button'))
      link.href = pageHref('scrolly', CONFIG.language);
    for (const link of document.querySelectorAll('#world-data-link,#return-map-button'))
      link.href = pageHref('world', CONFIG.language);
    for (const link of document.querySelectorAll('link[hreflang]'))
      link.href = pageHref(page, link.hreflang, document.body.dataset.country);
    document.documentElement.style.setProperty('--panel-width', CONFIG.ui.panelWidth + 'px');
    document.documentElement.style.setProperty(
      '--mobile-panel-width',
      CONFIG.ui.mobilePanelRatio * 100 + 'vw',
    );
    document.documentElement.style.setProperty(
      '--header-logo-width',
      CONFIG.ui.headerLogoWidth + 'px',
    );
    document.documentElement.style.setProperty(
      '--mobile-header-logo-width',
      CONFIG.ui.mobileHeaderLogoWidth + 'px',
    );
    document.documentElement.style.setProperty(
      '--footer-logo-width',
      CONFIG.ui.footerLogoWidth + 'px',
    );
    for (const [name, color] of Object.entries(CONFIG.colors))
      document.documentElement.style.setProperty('--' + name, color);
    const world = atlas ? topojson.feature(atlas, atlas.objects.countries) : null;
    renderer = createRenderer($('#scene'), { intro, graph }, data, CONFIG, { d3, world });
    resizeScene();
    setExplorerOpen(explorerOpen);
    for (const [selector, counts] of [
      ['#police-violence-list', typical.policeTypes],
      ['#other-violence-list', typical.otherTypes],
    ]) {
      const list = $(selector);
      list.replaceChildren();
      for (const type of CONFIG.violenceTypes) {
        const id = type.id;
        if (!counts[id]) continue;
        const item = document.createElement('li'),
          marker = document.createElement('i'),
          count = document.createElement('strong'),
          label = document.createElement('span');
        marker.className = 'type-ring';
        marker.style.borderColor = type.color;
        marker.setAttribute('aria-hidden', 'true');
        count.textContent = counts[id];
        label.textContent = type.label;
        item.append(marker, count, label);
        list.append(item);
      }
    }
    $('#country-total').textContent = totals.countries;
    $('#world-total').textContent = totals.cases;
    CONFIG.slides.forEach((slide, index) => {
      slide.title = stepElements[index].querySelector('h2').textContent.replace(/\s+/g, ' ').trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', slide.title);
      button.title = slide.title;
      button.addEventListener('click', () => {
        controller.setSlide(index);
        stepElements[index].scrollIntoView({ block: 'start', behavior: 'auto' });
      });
      $('#story-progress').append(button);
    });
    renderCountryList();
    controller.subscribe(updateUI);
    wireEvents();
    renderer.setState(controller.getState(), true);
    renderer.renderFrame(performance.now());
    updateUI(controller.getState());
    if (page === 'scrolly' && initialSlide >= 0)
      stepElements[initialSlide].scrollIntoView({ block: 'start', behavior: 'auto' });
    updateScroll();
    setLoadingProgress(95, 'loading.preparing');
    if (!atlas) $('#globe-hint').textContent = t('scene.noBorders');
    document.fonts?.ready?.then(() => {
      renderer.invalidateCallouts();
      renderer.setState(controller.getState(), reducedMotion.matches);
      updateLayout();
    });
    window.newsCity = { controller, renderer, config: CONFIG };
    await finishLoading();
  } catch (error) {
    $('#loading').classList.add('error');
    $('#loading').setAttribute('aria-busy', 'false');
    $('#loading-status').textContent = t('error.open', {
      message: error.key ? t(error.key) : error.message,
    });
    $('#loading-status').setAttribute('role', 'alert');
    $('#loading-retry').hidden = false;
    console.error(error);
  }
}
init();
