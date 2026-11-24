export const canonical = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Méthode des plus forts restes, stable en cas d’égalité. */
export function apportion(counts, size) {
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  if (!total || !Number.isInteger(size) || size < 0)
    throw new Error('Répartition normalisée invalide');
  const allocated = counts.map((item, index) => ({
    ...item,
    index,
    quota: (item.count / total) * size,
    allocated: Math.floor((item.count / total) * size),
  }));
  const remaining = size - allocated.reduce((sum, item) => sum + item.allocated, 0);
  const ranked = [...allocated].sort(
    (a, b) => b.quota - b.allocated - (a.quota - a.allocated) || a.index - b.index,
  );
  for (let index = 0; index < remaining; index++) ranked[index].allocated++;
  return allocated.map(({ index, quota, ...item }) => item);
}
export function buildTypical(records, authors, types, size = 100) {
  const allocations = apportion(
    authors.map((author) => ({
      id: author.id,
      count: records.filter((record) => record.author === author.id).length,
    })),
    size,
  );
  const typical = [];
  for (const author of allocations) {
    if (!author.allocated) continue;
    const counts = types.map((type) => ({
      id: type.id,
      count: records.filter(
        (record) => record.author === author.id && record.violenceType === type.id,
      ).length,
    }));
    for (const type of apportion(counts, author.allocated))
      for (let index = 0; index < type.allocated; index++) {
        typical.push({
          id: 'TYPICAL-' + String(typical.length + 1).padStart(3, '0'),
          author: author.id,
          violenceType: type.id,
          representative: true,
          typicalOrder: typical.length,
        });
      }
  }
  return typical;
}
export function normalizeEvents(
  rows,
  countries,
  schema,
  { source = 'evenements.json', size = 100 } = {},
) {
  assertPlainData(rows);
  if (!Array.isArray(rows) || !rows.length)
    throw new Error('Le fichier doit contenir une liste de cas.');
  if (rows.length > DATA_LIMITS.records) throw new Error('Le fichier dépasse la limite de cas.');
  const authors = new Map(schema.authors.map((item) => [canonical(item.sourceLabel), item]));
  const types = new Map(schema.violenceTypes.map((item) => [canonical(item.sourceLabel), item]));
  const countryIndex = new Map(
    Object.entries(countries).map(([name, value]) => [canonical(name), value]),
  );
  const duplicates = new Map();
  const records = rows.map((row, index) => {
    const line = index + 1,
      country = countryIndex.get(canonical(row.pays)),
      author = authors.get(canonical(row.auteur)),
      type = types.get(canonical(row.categorie));
    if (!country) throw new Error('Ligne ' + line + ' : pays inconnu — ' + row.pays);
    if (!author) throw new Error('Ligne ' + line + ' : auteur inconnu — ' + row.auteur);
    if (!type) throw new Error('Ligne ' + line + ' : catégorie inconnue — ' + row.categorie);
    const year = Number(String(row.date).match(/\b20\d{2}\b/)?.[0]);
    if (!year || year < 1900 || year > 2100)
      throw new Error('Ligne ' + line + ' : année absente ou invalide de la date.');
    const key = JSON.stringify(row),
      group = duplicates.get(key) || [];
    group.push(line);
    duplicates.set(key, group);
    return {
      id: 'EVT-' + String(line).padStart(4, '0'),
      sourceRow: line,
      journalistLabel: String(row.journaliste || '').trim(),
      media: String(row.media || '').trim(),
      country: String(row.pays).trim(),
      countryCode: country.id,
      region: String(row.region || '').trim(),
      date: String(row.date).trim(),
      year,
      author: author.id,
      violenceType: type.id,
      source: String(row.URL || '').trim(),
      synthetic: false,
      longitude: country.longitude,
      latitude: country.latitude,
    };
  });
  const catalog = (items, key) =>
    items
      .map((item) => ({
        ...item,
        count: records.filter((record) => record[key] === item.id).length,
      }))
      .filter((item) => item.count)
      .sort(
        (a, b) =>
          b.count - a.count ||
          items.findIndex((x) => x.id === a.id) - items.findIndex((x) => x.id === b.id),
      );
  const authorCatalog = catalog(schema.authors, 'author'),
    typeCatalog = catalog(schema.violenceTypes, 'violenceType');
  const years = [...new Set(records.map((record) => record.year))].sort(),
    countriesCount = new Set(records.map((record) => record.countryCode)).size;
  const metadata = {
    sourceFile: source,
    synthetic: false,
    unit: 'case',
    year: years.length === 1 ? years[0] : years.join('–'),
    years,
    cases: records.length,
    countries: countriesCount,
    authors: authorCatalog,
    violenceTypes: typeCatalog,
    typical: {
      size,
      sourceCases: records.length,
      method: 'largest-remainder-by-author-then-category',
    },
    anonymousCases: records.filter(
      (record) => !record.journalistLabel || canonical(record.journalistLabel) === 'inconnu',
    ).length,
    missingSources: records.filter((record) => !record.source).length,
  };
  return {
    metadata,
    records,
    typical: buildTypical(records, authorCatalog, typeCatalog, size),
    audit: { identicalRows: [...duplicates.values()].filter((group) => group.length > 1) },
  };
}
import { DATA_LIMITS, assertPlainData } from '../core/security.js';
