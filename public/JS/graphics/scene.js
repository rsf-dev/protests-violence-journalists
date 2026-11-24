import { deriveScene, pointOnRoute, routeMetrics } from '../core/model.js';
import { routePresentation, storyKeyKind, tint } from './route-groups.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createRenderer(
  canvas,
  images,
  data,
  config,
  { requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame } = {},
) {
  const ctx = canvas.getContext('2d'),
    metrics = routeMetrics(config.route);
  let width = 1,
    height = 1,
    ratio = 1,
    handle = null,
    previous = 0,
    clock = 0,
    age = 0;
  let state,
    scene,
    cityScene,
    reduced = false,
    suspended = false,
    visiblePoints = [],
    routeLabels = [];
  let points = [],
    recordKey = '',
    graphMix = 0;
  let presentation = { mode: 'unit', points: [], groups: [] };
  let highlightedCategory = null;
  const camera = { x: 775, y: 530, zoom: 1.65 };
  let cameraTarget = { ...camera },
    graphTarget = 0;
  const authorById = new Map(config.authors.map((author) => [author.id, author]));
  const mobile = () => width < 760;
  const instant = () => reduced;
  function cityFrame() {
    if (cityScene?.country)
      return {
        scale: Math.min(width / 1448, Math.max(1, height - 80) / 1086),
        x: width * 0.5,
        y: height * 0.5,
      };
    const compact = mobile();
    const textWidth = width <= 1050 ? config.ui.tabletStoryWidth : config.ui.storyWidth;
    const left = compact ? 16 : width * 0.06 + textWidth + 24;
    const right = compact ? width - 16 : width - 24;
    const top = compact ? (cityScene?.phase === 'overview' ? 90 : 45) : 85;
    const bottom = compact ? height * 0.4 : height - 90;
    return {
      scale: Math.min(width / 1448, height / 1086),
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      availableWidth: Math.max(120, right - left),
      availableHeight: Math.max(60, bottom - top),
    };
  }
  function cityScale(viewCamera) {
    const frame = cityFrame(),
      scale = frame.scale * viewCamera.zoom;
    if (!cityScene?.country) return scale;
    const availableHeight = height;
    // Remplir la surface visible avec le plan tout en gardant le parcours dans le cadre.
    const cover = Math.max(
      frame.x / viewCamera.x,
      (width - frame.x) / (1448 - viewCamera.x),
      frame.y / viewCamera.y,
      (availableHeight - frame.y) / (1086 - viewCamera.y),
    );
    const xs = config.route.points.map((point) => point[0]),
      ys = config.route.points.map((point) => point[1]);
    const routeFit = Math.min(
      (width - 24) / (Math.max(...xs) - Math.min(...xs) + 12),
      Math.max(1, availableHeight - 24) / (Math.max(...ys) - Math.min(...ys) + 12),
    );
    return Math.min(Math.max(scale, cover), routeFit);
  }

  function resize(nextWidth, nextHeight, pixelRatio = 1) {
    const nextRatio = Math.min(config.animation.maxPixelRatio, pixelRatio);
    if (
      width === Math.max(1, nextWidth) &&
      height === Math.max(1, nextHeight) &&
      ratio === nextRatio &&
      canvas.width === Math.round(width * ratio) &&
      canvas.height === Math.round(height * ratio)
    )
      return;
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    ratio = nextRatio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (scene) updateCameraTarget();
    wake();
  }
  function updateCameraTarget() {
    if (cityScene?.country) {
      const settings = config.cameras.country;
      cameraTarget = {
        x: settings.x,
        y: settings.y,
        zoom: mobile() ? settings.mobileZoom * Math.min(1, height / 800) : settings.zoom,
      };
    } else {
      const frame = cityFrame();
      const from = cityScene?.focus ? presentation.groups[0]?.start || 0 : 0;
      const to = cityScene?.focus ? presentation.groups.at(-1)?.end || 1 : 1;
      const vertices = [pointOnRoute(metrics, from), pointOnRoute(metrics, to)];
      for (const segment of metrics.segments) {
        const progress = (segment.start + segment.length) / metrics.length;
        if (progress > from && progress < to) vertices.push(pointOnRoute(metrics, progress));
      }
      const xs = vertices.map((point) => point.x),
        ys = vertices.map((point) => point.y);
      const padding = storyKeyKind(cityScene) ? 36 : 22;
      const x0 = Math.min(...xs) - padding,
        x1 = Math.max(...xs) + padding,
        y0 = Math.min(...ys) - padding,
        y1 = Math.max(...ys) + padding;
      const scale = Math.min(
        frame.availableWidth / (x1 - x0),
        frame.availableHeight / (y1 - y0),
        3.2,
      );
      cameraTarget = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: scale / frame.scale };
    }
    if (instant()) Object.assign(camera, cameraTarget);
  }
  function setState(next, prefersReduced = false) {
    const nextScene = deriveScene(next, data, config);
    if (nextScene.kind === 'world')
      throw new Error('Use the world map renderer for the world view.');
    const enteringRoute = scene?.kind === 'intro' && nextScene.kind === 'city';
    if (!scene || nextScene.phase !== scene.phase || nextScene.country?.id !== scene.country?.id) {
      age = 0;
      highlightedCategory = null;
    }
    const firstScene = !scene;
    state = next;
    reduced = prefersReduced;
    scene = nextScene;
    graphTarget = scene.kind === 'intro' ? 0 : 1;
    if (firstScene) graphMix = graphTarget;
    cityScene = scene;
    presentation = routePresentation(scene, config);
    updateCameraTarget();
    {
      const key = scene.records.map((record) => record.id).join('|');
      const layout = presentation.points;
      const old =
        key === recordKey && !enteringRoute
          ? new Map(points.map((point) => [point.record.id, point]))
          : new Map();
      points = layout.map((target, index) => ({
        ...target,
        currentProgress:
          old.get(target.record.id)?.currentProgress ?? (instant() ? target.progress : 0),
        currentLane: old.get(target.record.id)?.currentLane ?? 0,
        lifetime: old.get(target.record.id)?.lifetime ?? 0,
        delay: (index / Math.max(1, layout.length)) * 0.65,
      }));
      recordKey = key;
    }
    if (instant()) {
      graphMix = graphTarget;
      for (const point of points) {
        point.currentProgress = point.progress;
        point.currentLane = point.lane;
        point.lifetime = 1e6;
      }
    }
    wake();
  }
  function routePath(from = 0, to = 1) {
    const start = pointOnRoute(metrics, from);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const segment of metrics.segments) {
      const progress = (segment.start + segment.length) / metrics.length;
      if (progress > from && progress < to) ctx.lineTo(segment.b[0], segment.b[1]);
    }
    const end = pointOnRoute(metrics, to);
    ctx.lineTo(end.x, end.y);
  }
  function fillFor(record, currentScene) {
    if (currentScene.phase === 'neutral' || currentScene.phase === 'intro')
      return config.colors.neutral;
    if (currentScene.country) return authorById.get(record.author).color;
    if (record.author === 'police') return config.colors.police;
    return ['police', 'other-types', 'overview'].includes(currentScene.phase)
      ? config.colors.other
      : config.colors.neutral;
  }
  function inFocus(record) {
    return !cityScene?.focus || (record.author === 'police') === (cityScene.focus === 'police');
  }
  function drawRouteLabels(scale, anchorX, anchorY, alpha) {
    if (!storyKeyKind(cityScene)) return;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.font = '9px Arial, sans-serif';
    ctx.fillStyle = '#526976';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 3;
    ctx.textBaseline = 'top';
    for (const [key, progress, offsetX, offsetY, align] of [
      ['scene.start', 0, -4, -17, 'left'],
      ['scene.end', 1, 2, -15, 'right'],
    ]) {
      const point = pointOnRoute(metrics, progress);
      const x = anchorX + (point.x - camera.x) * scale + offsetX;
      const y = anchorY + (point.y - camera.y) * scale + offsetY;
      const text = config.i18n.t(key);
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
      routeLabels.push({ text, x, y, align });
    }
    ctx.restore();
  }
  function drawCity(alpha) {
    if (alpha < 0.001) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const intro = images.intro,
      graph = images.graph;
    const introScale =
      (mobile()
        ? Math.min(width / intro.width, (height * 0.44) / intro.height) *
          config.mobileView.introScale
        : Math.max(width / intro.width, height / intro.height)) *
      (1 + graphMix * 0.13);
    const introY = (mobile() ? height * 0.31 : height / 2) - (intro.height * introScale) / 2;
    if (graphMix < 0.999) {
      ctx.globalAlpha = alpha * (1 - graphMix);
      ctx.filter = 'saturate(0.55) contrast(0.96)';
      ctx.drawImage(
        intro,
        (width - intro.width * introScale) / 2,
        introY,
        intro.width * introScale,
        intro.height * introScale,
      );
      ctx.filter = 'none';
    }
    if (graphMix > 0.001) {
      const frame = cityFrame(),
        scale = cityScale(camera);
      const anchorX = frame.x,
        anchorY = frame.y;
      ctx.globalAlpha = alpha * graphMix;
      ctx.translate(anchorX, anchorY);
      ctx.scale(scale, scale);
      ctx.translate(-camera.x, -camera.y);
      ctx.filter = 'saturate(0.55) contrast(0.96)';
      ctx.drawImage(graph, 0, 0, 1448, 1086);
      ctx.filter = 'none';
      // Masquer les bords noirs intégrés au PNG, y compris pendant un fondu.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#f4f4f2';
      ctx.lineWidth = config.route.cleanWidth;
      routePath();
      ctx.stroke();
      if (cityScene?.phase !== 'intro') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (
          cityScene?.phase === 'neutral' &&
          !instant() &&
          age < config.animation.routeFlashSeconds
        ) {
          const glow = Math.max(0, Math.sin((age / config.animation.routeFlashSeconds) * Math.PI));
          ctx.save();
          ctx.shadowColor = '#f0797d';
          ctx.shadowBlur = 13;
          ctx.strokeStyle = `rgba(242,114,120,${glow * 0.85})`;
          ctx.lineWidth = config.route.width + 3;
          routePath();
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = '#f4f4f3';
        ctx.lineWidth = config.route.width - 3;
        routePath();
        ctx.stroke();
        if (presentation.mode !== 'unit') {
          ctx.lineWidth = config.route.width + 4;
          ctx.lineCap = 'butt';
          for (const group of presentation.groups) {
            const selected = group.id === highlightedCategory;
            ctx.globalAlpha = alpha * graphMix * (highlightedCategory && !selected ? 0.2 : 1);
            ctx.strokeStyle = tint(group.color, selected ? 0.65 : 0.35);
            routePath(group.start, group.end);
            ctx.stroke();
          }
          ctx.globalAlpha = alpha * graphMix;
          for (const group of presentation.groups.slice(1)) {
            const point = pointOnRoute(metrics, group.start);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2 / scale;
            ctx.beginPath();
            ctx.moveTo(
              point.x - point.uy * (config.route.width / 2 + 3),
              point.y + point.ux * (config.route.width / 2 + 3),
            );
            ctx.lineTo(
              point.x + point.uy * (config.route.width / 2 + 3),
              point.y - point.ux * (config.route.width / 2 + 3),
            );
            ctx.stroke();
          }
        }
        for (const point of points) {
          if (!inFocus(point.record)) continue;
          const entrance = instant() ? 1 : clamp((point.lifetime - point.delay) / 0.55, 0, 1);
          if (!entrance) continue;
          const drift = instant()
            ? 0
            : Math.sin(clock * 0.65 + point.phase) * config.animation.swarmAmplitude;
          const position = pointOnRoute(metrics, point.currentProgress, point.currentLane + drift);
          const selected = point.record.violenceType === highlightedCategory;
          const radius = Math.max(config.animation.pointRadius, 1.7 / scale) * (selected ? 1.2 : 1);
          ctx.globalAlpha =
            alpha * graphMix * entrance * (highlightedCategory && !selected ? 0.18 : 1);
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(position.x, position.y, radius + 0.55 / scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = fillFor(point.record, cityScene);
          ctx.beginPath();
          ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
          ctx.fill();
          const x = anchorX + (position.x - camera.x) * scale,
            y = anchorY + (position.y - camera.y) * scale;
          visiblePoints.push({ record: point.record, countryId: scene.country?.id || null, x, y });
        }
        if (cityScene.phase === 'police') {
          const boundary = pointOnRoute(metrics, cityScene.summary.policeShare);
          ctx.strokeStyle = '#cf304a';
          ctx.lineWidth = 1 / scale;
          ctx.beginPath();
          ctx.moveTo(boundary.x - boundary.uy * 13, boundary.y + boundary.ux * 13);
          ctx.lineTo(boundary.x + boundary.uy * 13, boundary.y - boundary.ux * 13);
          ctx.stroke();
        }
        drawRouteLabels(scale, anchorX, anchorY, alpha * graphMix);
      }
    }
    ctx.restore();
  }

  function renderFrame(time = 0) {
    if (handle !== null) cancelFrame(handle);
    handle = null;
    if (!state || suspended) return;
    const delta = previous ? Math.min(0.05, Math.max(0, (time - previous) / 1000)) : 1 / 60;
    previous = time;
    if (!instant()) {
      clock += delta;
      age += delta;
      const easing = 1 - Math.exp((-delta * 5) / Math.max(0.1, config.animation.cameraSeconds));
      for (const key of ['x', 'y', 'zoom'])
        camera[key] += (cameraTarget[key] - camera[key]) * easing;
      graphMix += (graphTarget - graphMix) * easing;
      for (const point of points) {
        point.lifetime += delta;
        const travel = clamp(
          (point.lifetime - point.delay) / config.animation.pointEntranceSeconds,
          0,
          1,
        );
        point.currentProgress +=
          (point.progress * travel - point.currentProgress) * (1 - Math.exp(-delta * 9));
        point.currentLane += (point.lane - point.currentLane) * (1 - Math.exp(-delta * 7));
      }
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8fafb';
    ctx.fillRect(0, 0, width, height);
    visiblePoints = [];
    routeLabels = [];
    drawCity(1);
    if (!instant()) handle = requestFrame(renderFrame);
  }
  function wake() {
    if (!suspended && handle === null) {
      previous = 0;
      handle = requestFrame(renderFrame);
    }
  }
  return {
    resize,
    setState,
    renderFrame,
    setHighlightedCategory(id) {
      const next = scene?.focus && presentation.groups.some((group) => group.id === id) ? id : null;
      if (highlightedCategory === next) return;
      highlightedCategory = next;
      wake();
    },
    setSuspended(value) {
      suspended = value;
      if (value && handle !== null) {
        cancelFrame(handle);
        handle = null;
      }
      if (!value) wake();
    },

    getSnapshot: () => ({
      kind: scene?.kind,
      phase: scene?.phase,
      pointCount: scene?.kind === 'intro' ? 0 : points.length,
      visiblePointCount:
        scene?.kind === 'intro' ? 0 : points.filter((point) => inFocus(point.record)).length,
      countryId: scene?.country?.id || null,
      mode: presentation.mode,
      routeLabels,
      highlightedCategory,
      highlightedPointIds: highlightedCategory
        ? visiblePoints
            .filter((point) => point.record.violenceType === highlightedCategory)
            .map((point) => point.record.id)
        : [],
      groups: presentation.groups.map((group) => ({
        id: group.id,
        typeId: group.typeId,
        number: group.number,
        count: group.count,
        start: group.start,
        end: group.end,
        anchorId: group.anchor.record.id,
      })),
      points: visiblePoints.map((point) => ({
        id: point.record.id,
        countryId: point.countryId,
        author: point.record.author,
        typeId: point.record.violenceType,
        x: point.x,
        y: point.y,
      })),
      floatingLabels: 0,
    }),
    destroy() {
      suspended = true;
      if (handle !== null) cancelFrame(handle);
    },
  };
}
