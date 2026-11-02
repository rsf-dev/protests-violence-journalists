export const DATA_LIMITS = Object.freeze({
  records: 5000,
  fields: 100,
  text: 20000,
  eventsBytes: 5 * 1024 * 1024,
  atlasBytes: 2 * 1024 * 1024,
  timeoutMs: 30000,
});
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export class DataLoadError extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
}
export async function fetchJSON(
  url,
  { maxBytes, timeoutMs = DATA_LIMITS.timeoutMs, fetchImpl = globalThis.fetch } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new DataLoadError('error.dataLimit');
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    if (!response.ok) throw new DataLoadError('error.dataLoad');
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new DataLoadError('error.dataLimit');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new DataLoadError('error.dataLimit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    controller.abort();
    try {
      await reader?.cancel();
    } catch {}
    if (error instanceof DataLoadError) throw error;
    throw new DataLoadError('error.dataLoad');
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}
export function assertPlainData(value, depth = 0) {
  if (depth > 16) throw new DataLoadError('error.dataShape');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= DATA_LIMITS.text) return;
  if (Array.isArray(value)) {
    if (value.length > 100000) throw new DataLoadError('error.dataShape');
    for (const item of value) assertPlainData(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length > DATA_LIMITS.fields) throw new DataLoadError('error.dataShape');
    for (const [key, item] of entries) {
      if (forbidden.has(key) || key.length > 128) throw new DataLoadError('error.dataShape');
      assertPlainData(item, depth + 1);
    }
    return;
  }
  throw new DataLoadError('error.dataShape');
}
export function safeSourceURL(value) {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    !/^https:\/\//i.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function validateAtlas(atlas) {
  assertPlainData(atlas);
  const objects = atlas?.objects?.countries;
  if (
    atlas?.type !== 'Topology' ||
    objects?.type !== 'GeometryCollection' ||
    !Array.isArray(objects.geometries) ||
    objects.geometries.length > 1000 ||
    !Array.isArray(atlas.arcs) ||
    atlas.arcs.length > 20000
  )
    throw new DataLoadError('error.dataShape');
  if (
    !['scale', 'translate'].every(
      (key) =>
        Array.isArray(atlas.transform?.[key]) &&
        atlas.transform[key].length === 2 &&
        atlas.transform[key].every(Number.isFinite),
    )
  )
    throw new DataLoadError('error.dataShape');
  let points = 0;
  for (const arc of atlas.arcs) {
    if (!Array.isArray(arc)) throw new DataLoadError('error.dataShape');
    for (const pair of arc) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !pair.every(Number.isFinite) ||
        ++points > 200000
      )
        throw new DataLoadError('error.dataShape');
    }
  }
  const checkArcs = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) checkArcs(item);
    } else if (
      !Number.isSafeInteger(value) ||
      (value < 0 ? -value - 1 : value) >= atlas.arcs.length
    )
      throw new DataLoadError('error.dataShape');
  };
  for (const geometry of objects.geometries) {
    if (!['Polygon', 'MultiPolygon'].includes(geometry.type))
      throw new DataLoadError('error.dataShape');
    checkArcs(geometry.arcs);
  }
  return atlas;
}
