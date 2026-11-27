import { createI18n } from '../i18n/index.js';
import { DATA_SCHEMA, PUBLIC_DATA_FIELDS } from '../data/schema.js';
import { DATA_LIMITS, DataLoadError, assertPlainData } from './security.js';
import { safeSourceURL } from './security.js';
export { safeSourceURL } from './security.js';

export function validateDatasetShape(source) {
  assertPlainData(source);
  const onlyFields = (value, allowed) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))
    )
      throw new DataLoadError('error.dataShape');
  };
  onlyFields(source, PUBLIC_DATA_FIELDS.root);
  if (
    !source?.metadata ||
    !Array.isArray(source.records) ||
    !source.records.length ||
    source.records.length > DATA_LIMITS.records ||
    !Array.isArray(source.typical) ||
    source.typical.length !== 100
  )
    throw new DataLoadError('error.dataShape');
  onlyFields(source.metadata, PUBLIC_DATA_FIELDS.metadata);
  onlyFields(source.metadata.typical, PUBLIC_DATA_FIELDS.typical);
  if (
    source.metadata.schemaVersion !== 2 ||
    source.metadata.anonymized !== true ||
    source.metadata.cases !== source.records.length
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
      onlyFields(entry, PUBLIC_DATA_FIELDS.catalog);
      const reference = known.get(entry.id);
      if (
        !reference ||
        ['labelKey', 'shortKey', 'color'].some((key) => entry[key] !== reference[key])
      )
        throw new DataLoadError('error.dataShape');
    }
  }
  for (const record of source.records) {
    onlyFields(record, PUBLIC_DATA_FIELDS.record);
    if (
      !record ||
      Array.isArray(record) ||
      typeof record !== 'object' ||
      Object.values(record).some((value) => value !== null && typeof value === 'object')
    )
      throw new DataLoadError('error.dataShape');
    for (const key of ['id', 'country', 'countryCode', 'author', 'violenceType'])
      if (typeof record[key] !== 'string') throw new DataLoadError('error.dataShape');
    if (
      !/^CASE-\d{4,}$/.test(record.id) ||
      !/^[A-Z]{2,3}$/.test(record.countryCode) ||
      !Number.isInteger(record.year) ||
      record.year < 1900 ||
      record.year > 2100
    )
      throw new DataLoadError('error.dataShape');
  }
  const orders = new Set();
  for (const point of source.typical) {
    onlyFields(point, PUBLIC_DATA_FIELDS.point);
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

export function summarize(records) {
  const police = records.filter((record) => record.author === 'police');
  const other = records.filter((record) => record.author === 'other');
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
  const counts = new Map();
  if (focus)
    for (const record of records) {
      const key = record.author + ':' + record.violenceType;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  return [...records].sort((a, b) => {
    if (focus) {
      // Chaque auteur garde son propre bloc, y compris les auteurs multiples.
      const block = authorOrder.get(a.author) - authorOrder.get(b.author);
      const category =
        counts.get(b.author + ':' + b.violenceType) - counts.get(a.author + ':' + a.violenceType) ||
        typeOrder.get(a.violenceType) - typeOrder.get(b.violenceType);
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
      ordered[end].author === first.author &&
      ordered[end].violenceType === first.violenceType
    )
      end++;
    const grouped = focus === first.author;
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
    ? state.view === 'comparison'
      ? 'comparison'
      : 'overview'
    : config.slides[state.slide].phase;
  const country =
    state.inExplore && state.view === 'country'
      ? groupCountries(data.records, config.language).find((group) => group.id === state.countryId)
      : null;
  const records = country ? country.records : typicalRecords(data);
  return {
    kind: phase === 'comparison' ? 'comparison' : phase === 'intro' ? 'intro' : 'city',
    phase,
    records,
    country,
    focus: phase === 'police-types' ? 'police' : phase === 'other-types' ? 'other' : null,
    summary: summarize(records),
  };
}

export function createController(data, config) {
  const state = { slide: 0, inExplore: false, view: 'comparison', countryId: null };
  const listeners = new Set(),
    countryIds = new Set(groupCountries(data.records).map((group) => group.id));
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
      });
    },
    skip: () => update({ inExplore: true, view: 'comparison', countryId: null }),
    replay: () => update({ slide: 0, inExplore: false, view: 'comparison', countryId: null }),
    selectCountry: (id) =>
      countryIds.has(id) && update({ inExplore: true, view: 'country', countryId: id }),
  };
}
