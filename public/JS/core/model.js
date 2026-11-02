import { createI18n } from '../i18n/index.js';
import { DATA_SCHEMA } from '../data/schema.js';
import { DATA_LIMITS, DataLoadError, assertPlainData } from './security.js';
import { safeSourceURL } from './security.js';
export { safeSourceURL } from './security.js';

export function validateDatasetShape(source) {
  assertPlainData(source);
  if (
    !source?.metadata ||
    !Array.isArray(source.records) ||
    !source.records.length ||
    source.records.length > DATA_LIMITS.records ||
    !Array.isArray(source.typical) ||
    source.typical.length !== 100
  )
    throw new DataLoadError('error.dataShape');
  for (const key of ['authors', 'violenceTypes']) {
    const catalog = source.metadata[key],
      known = new Map(DATA_SCHEMA[key].map((item) => [item.id, item]));
    if (
      !Array.isArray(catalog) ||
      !catalog.length ||
      catalog.length > known.size ||
      new Set(catalog.map((item) => item.id)).size !== catalog.length
    )
      throw new DataLoadError('error.dataShape');
    for (const entry of catalog) {
      const reference = known.get(entry.id);
      if (
        !reference ||
        ['sourceLabel', 'labelKey', 'shortKey', 'color'].some(
          (key) => entry[key] !== reference[key],
        )
      )
        throw new DataLoadError('error.dataShape');
    }
  }
  for (const record of source.records) {
    if (
      !record ||
      Array.isArray(record) ||
      typeof record !== 'object' ||
      Object.values(record).some((value) => value !== null && typeof value === 'object')
    )
      throw new DataLoadError('error.dataShape');
    for (const key of ['id', 'country', 'countryCode', 'author', 'violenceType', 'date'])
      if (typeof record[key] !== 'string') throw new DataLoadError('error.dataShape');
    for (const key of ['journalistLabel', 'media', 'region', 'source', 'city'])
      if (record[key] != null && typeof record[key] !== 'string')
        throw new DataLoadError('error.dataShape');
    if (
      !/^[A-Z]{2,3}$/.test(record.countryCode) ||
      !Number.isInteger(record.year) ||
      record.year < 1900 ||
      record.year > 2100
    )
      throw new DataLoadError('error.dataShape');
    if (/^\d{4}-\d{2}-\d{2}T/.test(record.date)) {
      const parsed = new Date(record.date);
      if (
        !Number.isFinite(+parsed) ||
        parsed.toISOString().slice(0, 10) !== record.date.slice(0, 10) ||
        parsed.getUTCFullYear() !== record.year
      )
        throw new DataLoadError('error.dataShape');
    }
  }
  const orders = new Set();
  for (const point of source.typical) {
    if (
      !point ||
      typeof point.id !== 'string' ||
      typeof point.author !== 'string' ||
      typeof point.violenceType !== 'string' ||
      point.representative !== true ||
      !Number.isInteger(point.typicalOrder) ||
      point.typicalOrder < 0 ||
      point.typicalOrder >= 100 ||
      orders.has(point.typicalOrder)
    )
      throw new DataLoadError('error.dataShape');
    orders.add(point.typicalOrder);
  }
  return source;
}

export function validateDataset(source, config) {
  const { t } = config.i18n;
  validateDatasetShape(source);
  if (!Array.isArray(source?.records) || !source.records.length)
    throw new Error(t('error.records'));
  const ids = new Set(),
    types = new Set(config.violenceTypes.map((type) => type.id)),
    authors = new Set(config.authors.map((author) => author.id));
  for (const record of source.records) {
    if (!record.id || ids.has(record.id)) throw new Error(t('error.id'));
    ids.add(record.id);
    if (
      !record.country ||
      !record.countryCode ||
      !authors.has(record.author) ||
      !types.has(record.violenceType)
    )
      throw new Error(t('error.category', { id: record.id }));
    if (
      typeof record.longitude !== 'number' ||
      typeof record.latitude !== 'number' ||
      !Number.isFinite(record.longitude) ||
      !Number.isFinite(record.latitude) ||
      Math.abs(record.longitude) > 180 ||
      Math.abs(record.latitude) > 90
    )
      throw new Error(t('error.coordinates', { id: record.id }));
  }
  const typical = typicalRecords(source),
    typicalIds = new Set();
  if (typical.length !== config.typicalSize) throw new Error(t('error.typical'));
  for (const record of typical) {
    if (
      ids.has(record.id) ||
      typicalIds.has(record.id) ||
      !record.representative ||
      !authors.has(record.author) ||
      !types.has(record.violenceType)
    )
      throw new Error(t('error.order'));
    typicalIds.add(record.id);
  }
  return source;
}

export const typicalRecords = (data) => data.typical || [];

export function worldStats(records) {
  return {
    cases: records.length,
    countries: new Set(records.map((record) => record.countryCode)).size,
  };
}

export function journalistDetails(record, config) {
  const { i18n } = config,
    { t } = i18n;
  const authors = Object.fromEntries(config.authors.map((author) => [author.id, author.label]));
  const known = [
    ['id', t('field.id'), record.id],
    ['date', t('field.date'), i18n.dateLabel(record.date)],
    ['country', t('field.country'), i18n.countryName(record.countryCode, record.country)],
    ['region', t('field.region'), i18n.regionName(record.region)],
    ['city', t('field.city'), i18n.cityName(record.city)],
    ['media', t('field.media'), i18n.mediaName(record.media)],
    ['author', t('field.author'), authors[record.author] || record.author],
    [
      'violenceType',
      t('field.violenceType'),
      config.violenceTypes.find((type) => type.id === record.violenceType)?.label ||
        record.violenceType,
    ],
    ['source', t('field.source'), record.source || t('record.sourceMissing')],
  ];
  const excluded = new Set([
    ...known.map(([key]) => key),
    'journalistLabel',
    'typicalOrder',
    'countryCode',
    'longitude',
    'latitude',
    'year',
    'synthetic',
    'sourceRow',
    'representative',
  ]);
  const extra = Object.entries(record)
    .filter(([key, value]) => !excluded.has(key) && value != null)
    .map(([key, value]) => [
      key,
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ]);
  return [...known, ...extra]
    .filter(([, , value]) => value != null && value !== '')
    .map(([key, label, value]) => ({
      key,
      label,
      value: String(value),
      ...(key === 'source' && safeSourceURL(value) ? { href: safeSourceURL(value) } : {}),
    }));
}

/** Point du bord du libellé, jamais à l’intérieur de la boîte. */
export function calloutConnector(box, target) {
  const x = Math.max(box.x, Math.min(box.x + box.width, target.x));
  const y = Math.max(box.y, Math.min(box.y + box.height, target.y));
  if (
    target.x < box.x ||
    target.x > box.x + box.width ||
    target.y < box.y ||
    target.y > box.y + box.height
  )
    return { x, y };
  const edges = [
    { x: box.x, y },
    { x: box.x + box.width, y },
    { x, y: box.y },
    { x, y: box.y + box.height },
  ];
  return edges.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
}

/** Placement de libellés en pixels écran, avec évitement des groupes et des autres boîtes. */
export function layoutCallouts(items, viewport) {
  const mobile = viewport.width < 760,
    left = mobile || viewport.country ? 12 : viewport.width * 0.35,
    right = viewport.width - 18;
  const top = viewport.country ? 85 : mobile ? 125 : 140;
  const bottom = viewport.country
    ? Math.max(top + 90, (viewport.availableHeight ?? viewport.height) - 38)
    : mobile
      ? Math.max(top + 220, Math.min(viewport.height * 0.47, viewport.height - 300))
      : viewport.height - 130;
  const occupied = [],
    result = [];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  for (const [index, item] of items.entries()) {
    const width = Math.min(item.width, right - left),
      height = item.height,
      gap = mobile ? 18 : 25;
    const candidates = [
      { x: item.x - width - gap, y: item.y - height / 2 },
      { x: item.x + gap, y: item.y - height / 2 },
      { x: item.x - width / 2, y: item.y - gap - height },
      { x: item.x - width / 2, y: item.y + gap },
    ];
    for (const distance of [gap * 2, gap * 3, gap * 4])
      candidates.push(
        { x: item.x - width - distance, y: item.y - height / 2 },
        { x: item.x + distance, y: item.y - height / 2 },
        { x: item.x - width / 2, y: item.y - distance - height },
        { x: item.x - width / 2, y: item.y + distance },
      );
    if (item.bounds)
      candidates.push(
        { x: item.bounds.x - width - gap, y: item.y - height / 2 },
        { x: item.bounds.x + item.bounds.width + gap, y: item.y - height / 2 },
        { x: item.x - width / 2, y: item.bounds.y - height - gap },
        { x: item.x - width / 2, y: item.bounds.y + item.bounds.height + gap },
      );
    for (const x of [left, right - width])
      for (const y of [top, top + height + 12, bottom - height, bottom - height * 2 - 12])
        candidates.push({ x, y });
    const boxes = candidates.map((candidate) => ({
      x: clamp(candidate.x, left, right - width),
      y: clamp(candidate.y, top, Math.max(top, bottom - height)),
      width,
      height,
    }));
    // Éviter les points eux-mêmes : le rectangle englobant d’un virage
    // contient beaucoup de vide et forçait les libellés trop loin du parcours.
    const score = (box) =>
      occupied.reduce((sum, prior) => sum + overlap(box, prior), 0) * 10000 +
      items.reduce(
        (sum, other) =>
          sum +
          (other.obstacles
            ? other.obstacles.reduce(
                (area, point) =>
                  area + overlap(box, { x: point.x - 8, y: point.y - 8, width: 16, height: 16 }),
                0,
              )
            : overlap(
                box,
                other.bounds || { x: other.x - 7, y: other.y - 7, width: 14, height: 14 },
              )),
        0,
      ) *
        400 +
      Math.hypot(box.x + width / 2 - item.x, box.y + height / 2 - item.y) +
      ((index % 2 ? box.x < item.x : box.x > item.x) ? 15 : 0);
    // Un recouvrement même minime entre libellés ne doit pas être préféré
    // à une position libre pour seulement mieux éviter quelques points.
    const clearBoxes = boxes.filter((box) => occupied.every((prior) => overlap(box, prior) === 0));
    const ranked = clearBoxes.length ? clearBoxes : boxes;
    ranked.sort((a, b) => score(a) - score(b));
    const box = ranked[0];
    occupied.push(box);
    result.push({ ...item, box, connector: calloutConnector(box, item) });
  }
  return result;
}

export function summarize(records) {
  const police = records.filter((record) => record.author === 'police');
  const other = records.filter((record) => record.author !== 'police');
  const breakdown = (items) =>
    Object.fromEntries(
      DATA_SCHEMA.violenceTypes.map((type) => [
        type.id,
        items.filter((item) => item.violenceType === type.id).length,
      ]),
    );
  const authors = Object.fromEntries(
    DATA_SCHEMA.authors.map((author) => [
      author.id,
      records.filter((record) => record.author === author.id).length,
    ]),
  );
  const byType = Object.fromEntries(
    DATA_SCHEMA.violenceTypes.map((type) => [
      type.id,
      Object.fromEntries(
        DATA_SCHEMA.authors.map((author) => [
          author.id,
          records.filter((record) => record.author === author.id && record.violenceType === type.id)
            .length,
        ]),
      ),
    ]),
  );
  return {
    total: records.length,
    police: police.length,
    other: other.length,
    policeShare: records.length ? police.length / records.length : 0,
    policeTypes: breakdown(police),
    otherTypes: breakdown(other),
    types: breakdown(records),
    authors,
    byType,
  };
}

export function groupCountries(records, language = 'fr') {
  const groups = new Map(),
    i18n = createI18n(language);
  for (const record of records) {
    if (!groups.has(record.countryCode))
      groups.set(record.countryCode, {
        id: record.countryCode,
        label: i18n.countryName(record.countryCode, record.country),
        longitude: +record.longitude,
        latitude: +record.latitude,
        records: [],
      });
    groups.get(record.countryCode).records.push(record);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, count: group.records.length, summary: summarize(group.records) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, i18n.language));
}

export function routeMetrics(route) {
  const segments = [],
    points = route.points;
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index],
      distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!distance) continue;
    segments.push({
      a,
      b,
      start: length,
      length: distance,
      ux: (b[0] - a[0]) / distance,
      uy: (b[1] - a[1]) / distance,
    });
    length += distance;
  }
  if (!length) throw new Error('Le parcours doit comporter deux positions distinctes.');
  return { segments, length, width: route.width };
}

export function pointOnRoute(metrics, progress, offset = 0) {
  const distance = Math.max(0, Math.min(1, progress)) * metrics.length;
  const segment =
    metrics.segments.find((item) => distance <= item.start + item.length) ||
    metrics.segments.at(-1);
  const along = Math.min(segment.length, Math.max(0, distance - segment.start));
  const lane = Math.max(-metrics.width / 2, Math.min(metrics.width / 2, offset));
  return {
    x: segment.a[0] + segment.ux * along - segment.uy * lane,
    y: segment.a[1] + segment.uy * along + segment.ux * lane,
    ux: segment.ux,
    uy: segment.uy,
  };
}

export function orderRouteRecords(records, focus = null) {
  const authorOrder = new Map(DATA_SCHEMA.authors.map((author, index) => [author.id, index])),
    typeOrder = new Map(DATA_SCHEMA.violenceTypes.map((type, index) => [type.id, index]));
  return [...records].sort((a, b) => {
    if (focus) {
      // Les vues de détail réunissent les violences de tous les auteurs
      // du bloc affiché, en conservant la séparation police / autres.
      const block = Number(a.author !== 'police') - Number(b.author !== 'police');
      const category = typeOrder.get(a.violenceType) - typeOrder.get(b.violenceType);
      if (block || category) return block || category;
    }
    return (
      authorOrder.get(a.author) - authorOrder.get(b.author) ||
      typeOrder.get(a.violenceType) - typeOrder.get(b.violenceType) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function layoutRouteRecords(records, route, focus = null, radius = 3.25) {
  const ordered = orderRouteRecords(records, focus),
    metrics = routeMetrics(route),
    result = [];
  const margin = Math.max(0, route.width / 2 - radius - 1.2);
  let start = 0;
  while (start < ordered.length) {
    const first = ordered[start];
    let end = start + 1;
    while (
      end < ordered.length &&
      (focus
        ? (ordered[end].author === 'police') === (first.author === 'police')
        : ordered[end].author === first.author) &&
      ordered[end].violenceType === first.violenceType
    )
      end++;
    const grouped = focus && (focus === 'police') === (first.author === 'police');
    const gap = grouped ? Math.min(0.008, ((end - start) / ordered.length) * 0.12) : 0;
    for (let i = start; i < end; i++) {
      const progress = grouped
        ? start / ordered.length +
          gap +
          ((i - start + 0.5) / (end - start)) * ((end - start) / ordered.length - gap * 2)
        : (i + 0.5) / ordered.length;
      const lane = ((i % 3) - 1) * margin * 0.83;
      result.push({
        record: ordered[i],
        progress,
        lane,
        phase: i * 2.399963,
        ...pointOnRoute(metrics, progress, lane),
      });
    }
    start = end;
  }
  return result;
}

export function deriveScene(state, data, config) {
  const phase = state.inExplore
    ? state.view === 'world'
      ? 'world'
      : 'overview'
    : config.slides[state.slide].phase;
  const country =
    state.inExplore && state.view === 'country'
      ? groupCountries(data.records, config.language).find((group) => group.id === state.countryId)
      : null;
  const records = country ? country.records : typicalRecords(data);
  return {
    kind: phase === 'world' ? 'world' : phase === 'intro' ? 'intro' : 'city',
    phase,
    records,
    country,
    focus: phase === 'police-types' ? 'police' : phase === 'other-types' ? 'other' : null,
    summary: summarize(records),
    outlined: ['police-types', 'other-types', 'overview'].includes(phase),
  };
}

export function isGlobeVisible(longitude, latitude, rotation) {
  const radians = Math.PI / 180,
    lat = latitude * radians,
    centerLat = -rotation[1] * radians;
  return (
    Math.sin(lat) * Math.sin(centerLat) +
      Math.cos(lat) * Math.cos(centerLat) * Math.cos((longitude + rotation[0]) * radians) >
    0.06
  );
}

export function createController(data, config) {
  const state = { slide: 0, inExplore: false, view: 'world', countryId: null, journalistId: null };
  const listeners = new Set(),
    countryIds = new Set(groupCountries(data.records).map((group) => group.id));
  const recordById = new Map(data.records.map((record) => [record.id, record]));
  const update = (patch) => {
    if (Object.entries(patch).every(([key, value]) => state[key] === value)) return false;
    Object.assign(state, patch);
    listeners.forEach((listener) => listener({ ...state }));
    return true;
  };
  return {
    getState: () => ({ ...state }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSlide: (slide) => {
      const next = Math.max(0, Math.min(config.slides.length - 1, slide));
      return update({
        slide: next,
        inExplore: false,
        journalistId: next === state.slide && !state.inExplore ? state.journalistId : null,
      });
    },
    skip: () => update({ inExplore: true, view: 'world', countryId: null, journalistId: null }),
    replay: () =>
      update({ slide: 0, inExplore: false, view: 'world', countryId: null, journalistId: null }),
    selectCountry: (id) =>
      countryIds.has(id) &&
      update({ inExplore: true, view: 'country', countryId: id, journalistId: null }),
    selectJournalist: (id) =>
      state.inExplore &&
      state.view === 'country' &&
      recordById.get(id)?.countryCode === state.countryId &&
      update({ journalistId: id }),
    closeJournalist: () => update({ journalistId: null }),
  };
}
