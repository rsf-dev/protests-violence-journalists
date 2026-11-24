import { layoutRouteRecords, pointOnRoute, routeMetrics } from '../core/model.js';

/** Les indications de lecture restent collectives, séparées des catégories interactives. */
export function storyKeyKind(scene) {
  if (scene.country || scene.kind === 'world') return null;
  if (scene.phase === 'neutral') return 'unit';
  return ['police', 'overview'].includes(scene.phase) ? 'authors' : null;
}

/** Les plages suivent les effectifs et les points réels, jamais un découpage arbitraire. */
export function categoryGroups(records, config, focus) {
  const order = new Map(config.violenceTypes.map((type, index) => [type.id, index]));
  const metrics = routeMetrics(config.route);
  let placed;
  if (focus === 'country') {
    const sorted = [...records].sort(
      (a, b) =>
        order.get(a.violenceType) - order.get(b.violenceType) ||
        a.author.localeCompare(b.author) ||
        a.id.localeCompare(b.id),
    );
    const margin = Math.max(0, config.route.width / 2 - config.animation.pointRadius - 1.2);
    placed = sorted.map((record, index) => {
      const progress = (index + 0.5) / sorted.length;
      const lane = ((index % 3) - 1) * margin * 0.83;
      return {
        record,
        progress,
        lane,
        phase: index * 2.399963,
        ...pointOnRoute(metrics, progress, lane),
      };
    });
  } else placed = layoutRouteRecords(records, config.route, focus, config.animation.pointRadius);
  const groups = [];
  for (const [index, point] of placed.entries()) {
    if (focus !== 'country' && point.record.author !== focus) continue;
    let group = groups.at(-1);
    if (!group || group.id !== point.record.violenceType) {
      const type = config.violenceTypes.find((type) => type.id === point.record.violenceType);
      group = {
        id: type.id,
        color: type.color,
        label: type.label,
        points: [],
        start: index / placed.length,
      };
      groups.push(group);
    }
    group.points.push(point);
    group.end = (index + 1) / placed.length;
  }
  return groups.map((group, index) => ({
    ...group,
    number: index + 1,
    count: group.points.length,
    anchor: group.points[Math.floor((group.points.length - 1) / 2)],
  }));
}

export function tint(hex, strength = 0.24) {
  const channels = hex.match(/[a-f0-9]{2}/gi).map((value) => parseInt(value, 16));
  return (
    '#' +
    channels
      .map((value) =>
        Math.round(255 + (value - 255) * strength)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Une seule géométrie alimente le dessin et la légende du récit. */
export function routePresentation(scene, config) {
  const categories = Boolean(scene.country || scene.focus || scene.phase === 'overview');
  if (categories) {
    const groups = categoryGroups(scene.records, config, scene.focus || 'country').map((group) => ({
      ...group,
      typeId: group.id,
      kind: 'category',
    }));
    const points = scene.focus
      ? layoutRouteRecords(scene.records, config.route, scene.focus, config.animation.pointRadius)
      : groups.flatMap((group) => group.points);
    return { mode: 'categories', points, groups };
  }
  const points = layoutRouteRecords(
    scene.records,
    config.route,
    null,
    config.animation.pointRadius,
  );
  if (scene.phase === 'intro' || scene.phase === 'neutral')
    return { mode: 'unit', points, groups: [] };
  const groups = [];
  for (const [index, point] of points.entries()) {
    let group = groups.at(-1);
    if (!group || group.id !== point.record.author) {
      const author = config.authors.find((author) => author.id === point.record.author);
      group = {
        id: author.id,
        kind: 'author',
        color: author.color,
        label: author.label,
        points: [],
        start: index / points.length,
      };
      groups.push(group);
    }
    group.points.push(point);
    group.end = (index + 1) / points.length;
  }
  return {
    mode: 'authors',
    points,
    groups: groups.map((group) => ({
      ...group,
      count: group.points.length,
      number: null,
      anchor: group.points[Math.floor((group.points.length - 1) / 2)],
    })),
  };
}
