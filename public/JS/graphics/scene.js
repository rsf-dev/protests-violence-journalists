import {
  deriveScene,
  groupCountries,
  layoutRouteRecords,
  pointOnRoute,
  routeMetrics,
  isGlobeVisible,
  layoutCallouts,
  calloutConnector,
} from '../core/model.js';
import { createGlobeMotion } from './globe-motion.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createRenderer(
  canvas,
  images,
  data,
  config,
  {
    d3,
    world = null,
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
  } = {},
) {
  const ctx = canvas.getContext('2d'),
    metrics = routeMetrics(config.route),
    countries = groupCountries(data.records, config.language),
    { t } = config.i18n;
  let width = 1,
    height = 1,
    ratio = 1,
    handle = null,
    previous = 0,
    clock = 0,
    age = 0,
    rotationHold = 0;
  let state,
    scene,
    cityScene,
    reduced = false,
    suspended = false,
    hovered = null,
    markers = [],
    journalists = [],
    annotations = [];
  let points = [],
    recordKey = '',
    graphMix = 0,
    worldMix = 0,
    calloutLayout = null;
  const camera = { x: 775, y: 530, zoom: 1.65 },
    rotation = [-12, -18];
  const globeMotion = createGlobeMotion(rotation, config.globeMotion);
  let cameraTarget = { ...camera },
    graphTarget = 0,
    worldTarget = 0;
  const typeById = new Map(config.violenceTypes.map((type) => [type.id, type]));
  const authorById = new Map(config.authors.map((author) => [author.id, author]));
  const globeProjection = d3.geoOrthographic().clipAngle(90),
    globePath = d3.geoPath(globeProjection, ctx),
    graticule = d3.geoGraticule10();
  const mobile = () => width < 760;
  const instant = () => reduced;
  function cityFrame() {
    const availableHeight = height;
    return {
      scale: Math.min(
        width / 1448,
        (cityScene?.country ? Math.max(1, availableHeight - 80) : availableHeight) / 1086,
      ),
      x: width * (cityScene?.country ? 0.5 : mobile() ? 0.51 : 0.69),
      y: cityScene?.country
        ? availableHeight * 0.5
        : height * (mobile() ? (height < 740 ? 0.21 : 0.31) : 0.51),
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
    calloutLayout = null;
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
    const settings =
      config.cameras[cityScene?.country ? 'country' : cityScene?.focus || 'overview'];
    cameraTarget = {
      x: settings.x,
      y: settings.y,
      zoom: mobile() ? settings.mobileZoom * Math.min(1, height / 800) : settings.zoom,
    };
    if (instant()) Object.assign(camera, cameraTarget);
  }
  function setState(next, prefersReduced = false) {
    const nextScene = deriveScene(next, data, config);
    if (nextScene.kind !== 'world' || prefersReduced) globeMotion.stop();
    const enteringRoute = scene?.kind === 'intro' && nextScene.kind === 'city';
    if (!scene || nextScene.phase !== scene.phase || nextScene.country?.id !== scene.country?.id) {
      age = 0;
      calloutLayout = null;
    }
    state = next;
    reduced = prefersReduced;
    scene = nextScene;
    graphTarget = scene.kind === 'intro' ? 0 : 1;
    worldTarget = scene.kind === 'world' ? 1 : 0;
    if (scene.kind !== 'world') cityScene = scene;
    updateCameraTarget();
    if (scene.kind !== 'world') {
      const key = scene.records.map((record) => record.id).join('|');
      if (key !== recordKey) calloutLayout = null;
      const layout = layoutRouteRecords(
        scene.records,
        config.route,
        scene.focus,
        config.animation.pointRadius,
      );
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
      worldMix = worldTarget;
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
  function calloutGroupId(record) {
    return cityScene.country
      ? record.author
      : cityScene.focus
        ? record.violenceType
        : cityScene.phase === 'neutral'
          ? 'unit'
          : record.author === 'police'
            ? 'police'
            : 'other';
  }
  function prepareCallouts(fontSize, maxWidth, anchorX, anchorY) {
    // Placer une fois par vue, dans la géométrie finale sans bourdonnement.
    // Une optimisation sur les positions animées pouvait changer de côté à chaque frame.
    const groups = new Map(),
      scale = cityScale(cameraTarget);
    for (const point of points) {
      if (!inFocus(point.record)) continue;
      const position = pointOnRoute(metrics, point.progress, point.lane),
        key = calloutGroupId(point.record);
      const group = groups.get(key) || {
        id: key,
        typeId: null,
        count: 0,
        police: 0,
        points: [],
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        fill: fillFor(point.record, cityScene),
      };
      group.count++;
      group.police += Number(point.record.author === 'police');
      group.points.push({ id: point.record.id, author: point.record.author, ...position });
      group.minX = Math.min(group.minX, position.x);
      group.maxX = Math.max(group.maxX, position.x);
      group.minY = Math.min(group.minY, position.y);
      group.maxY = Math.max(group.maxY, position.y);
      groups.set(key, group);
    }
    const items = [...groups.values()].map((group) => {
      const type = cityScene.country ? null : typeById.get(group.id);
      const label = cityScene.country
        ? authorById.get(group.id).short
        : group.id === 'unit'
          ? t('scene.unit')
          : group.id === 'police'
            ? t('actor.policeFull')
            : group.id === 'other'
              ? t('actor.otherFull')
              : type.short;
      const text = `${group.count} · ${label}`,
        lines = [];
      let line = '';
      for (const word of text.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxWidth - 39) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
      if (group.id === 'unit') lines.push(t('scene.pointUnit'));
      // Une seule attache par label, choisie parmi les points réels du groupe.
      // Elle reste identique pendant l’animation, quels que soient ses auteurs.
      const members = group.points.map((point) => ({
        id: point.id,
        author: point.author,
        x: anchorX + (point.x - cameraTarget.x) * scale,
        y: anchorY + (point.y - cameraTarget.y) * scale,
      }));
      const cx = members.reduce((sum, point) => sum + point.x, 0) / members.length,
        cy = members.reduce((sum, point) => sum + point.y, 0) / members.length;
      const visible = members.filter(
        (point) =>
          point.x >= 8 && point.x <= width - 8 && point.y >= 115 && point.y <= height - 140,
      );
      const anchor = [...(visible.length ? visible : members)].sort(
        (a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
      )[0];
      const { x, y } = anchor;
      const bounds = {
        x: anchorX + (group.minX - cameraTarget.x) * scale - 8,
        y: anchorY + (group.minY - cameraTarget.y) * scale - 8,
        width: (group.maxX - group.minX) * scale + 16,
        height: (group.maxY - group.minY) * scale + 16,
      };
      return {
        id: group.id,
        typeId: type?.id,
        author: anchor.author,
        count: group.count,
        text,
        lines,
        x,
        y,
        anchors: [anchor],
        obstacles: members,
        bounds,
        width: maxWidth,
        height: 22 + lines.length * (fontSize + 4),
        fill: group.fill,
        mixed: !!type && group.police > 0 && group.police < group.count,
        color: type?.color || '#a7adb5',
      };
    });
    const limit = cityScene.country
      ? config.authors.length
      : mobile()
        ? height < 700
          ? 4
          : config.callouts.mobileMax
        : config.callouts.desktopMax;
    const visibleItems = items.sort((a, b) => b.count - a.count).slice(0, limit);
    return layoutCallouts(visibleItems, {
      width,
      height,
      country: !!cityScene.country,
      availableHeight: cityScene.country ? height : undefined,
    }).map((item) => ({
      ...item,
      anchors: item.anchors.map((anchor) => ({
        ...anchor,
        connector: calloutConnector(item.box, anchor),
      })),
    }));
  }
  function drawCallouts(livePositions, scale, anchorX, anchorY, alpha) {
    if (cityScene.country && height < 280) return;
    if (!instant() && age < 0.5) return;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = alpha * (instant() ? 1 : clamp((age - 0.5) / 0.55, 0, 1));
    const fontSize = mobile() ? config.callouts.mobileFontSize : config.callouts.desktopFontSize;
    const maxWidth = cityScene.country
      ? mobile()
        ? 142
        : 216
      : mobile()
        ? Math.min(config.callouts.mobileWidth, (width - 36) / 2)
        : config.callouts.desktopWidth;
    ctx.font = `${fontSize}px Electrolize, sans-serif`;
    ctx.textAlign = 'left';
    if (!calloutLayout) calloutLayout = prepareCallouts(fontSize, maxWidth, anchorX, anchorY);
    annotations = calloutLayout.map((item) => ({
      ...item,
      anchors: item.anchors.flatMap((anchor) => {
        const position = livePositions.get(anchor.id);
        return position
          ? [
              {
                ...anchor,
                x: anchorX + (position.x - camera.x) * scale,
                y: anchorY + (position.y - camera.y) * scale,
              },
            ]
          : [];
      }),
    }));
    for (const item of annotations) {
      const { box } = item;
      for (const anchor of item.anchors) {
        const connector = anchor.connector,
          dx = connector.x - anchor.x,
          dy = connector.y - anchor.y,
          distance = Math.hypot(dx, dy) || 1;
        const pointEdge =
          (config.animation.pointRadius +
            (cityScene.outlined ? config.animation.pointOutlineWidth / 2 : 0)) *
          scale;
        ctx.strokeStyle = '#888d98cc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(connector.x, connector.y);
        ctx.lineTo(
          anchor.x + (dx / distance) * Math.min(pointEdge, distance),
          anchor.y + (dy / distance) * Math.min(pointEdge, distance),
        );
        ctx.stroke();
      }
    }
    // Les traits restent derrière toutes les boîtes, y compris celles dessinées avant.
    for (const item of annotations) {
      const { box } = item;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.width, box.height, 4);
      ctx.fillStyle = '#fffffff2';
      ctx.fill();
      ctx.strokeStyle = '#e1e2e6';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(box.x + 11, box.y + 13, 9, 9, 4.5);
      if (item.mixed) {
        ctx.clip();
        ctx.fillStyle = config.colors.police;
        ctx.fillRect(box.x + 11, box.y + 13, 4.5, 9);
        ctx.fillStyle = config.colors.other;
        ctx.fillRect(box.x + 15.5, box.y + 13, 4.5, 9);
      } else {
        ctx.fillStyle = item.fill;
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(box.x + 11, box.y + 13, 9, 9, 4.5);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#616773';
      ctx.font = `${fontSize}px Electrolize, sans-serif`;
      item.lines.forEach((text, i) =>
        ctx.fillText(text, box.x + 29, box.y + 20 + i * (fontSize + 4)),
      );
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
      ctx.drawImage(
        intro,
        (width - intro.width * introScale) / 2,
        introY,
        intro.width * introScale,
        intro.height * introScale,
      );
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
      ctx.drawImage(graph, 0, 0, 1448, 1086);
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
        if (!['intro', 'neutral'].includes(cityScene?.phase)) {
          ctx.lineWidth = config.route.width - 4;
          if (cityScene.summary.policeShare > 0) {
            ctx.strokeStyle = '#d64c5516';
            routePath(0, cityScene.summary.policeShare);
            ctx.stroke();
          }
          if (
            cityScene.summary.policeShare < 1 &&
            ['police', 'other-types', 'overview'].includes(cityScene.phase)
          ) {
            ctx.strokeStyle = '#4c82b61a';
            routePath(cityScene.summary.policeShare, 1);
            ctx.stroke();
          }
        }
        const livePositions = new Map();
        for (const point of points) {
          if (!inFocus(point.record)) continue;
          const entrance = instant() ? 1 : clamp((point.lifetime - point.delay) / 0.55, 0, 1);
          if (!entrance) continue;
          const drift = instant()
            ? 0
            : Math.sin(clock * 0.65 + point.phase) * config.animation.swarmAmplitude;
          const position = pointOnRoute(metrics, point.currentProgress, point.currentLane + drift);
          const radius = config.animation.pointRadius;
          ctx.globalAlpha = alpha * graphMix * entrance;
          ctx.fillStyle = fillFor(point.record, cityScene);
          ctx.beginPath();
          ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
          ctx.fill();
          if (cityScene.outlined) {
            ctx.strokeStyle = typeById.get(point.record.violenceType).color;
            ctx.lineWidth = config.animation.pointOutlineWidth;
            ctx.stroke();
          }
          if (scene.country && scene.kind === 'city') {
            const x = anchorX + (position.x - camera.x) * scale,
              y = anchorY + (position.y - camera.y) * scale;
            journalists.push({
              record: point.record,
              countryId: scene.country.id,
              x,
              y,
              radius: (radius + config.animation.pointOutlineWidth / 2) * scale,
            });
            if (state.journalistId === point.record.id) {
              ctx.beginPath();
              ctx.arc(position.x, position.y, radius + 3 / scale, 0, Math.PI * 2);
              ctx.strokeStyle = '#4b5363';
              ctx.lineWidth = 1 / scale;
              ctx.stroke();
            }
          }
          livePositions.set(point.record.id, position);
        }
        ctx.globalAlpha = alpha * graphMix;
        ctx.fillStyle = '#777b83';
        ctx.font = `${10 / scale}px Electrolize, sans-serif`;
        ctx.textAlign = 'left';
        const first = metrics.segments[0].a,
          last = metrics.segments.at(-1).b;
        if (!cityScene.focus) {
          ctx.fillText(t('scene.start'), first[0] - 20 / scale, first[1] + 30 / scale);
          ctx.fillText(t('scene.end'), last[0] + 10 / scale, last[1] + 3 / scale);
        }
        if (cityScene.phase === 'police') {
          const boundary = pointOnRoute(metrics, cityScene.summary.policeShare);
          ctx.strokeStyle = '#d64c55';
          ctx.lineWidth = 1 / scale;
          ctx.beginPath();
          ctx.moveTo(boundary.x - boundary.uy * 13, boundary.y + boundary.ux * 13);
          ctx.lineTo(boundary.x + boundary.uy * 13, boundary.y - boundary.ux * 13);
          ctx.stroke();
        }
        drawCallouts(livePositions, scale, anchorX, anchorY, alpha * graphMix);
      }
    }
    ctx.restore();
  }

  function countrySlots(count) {
    const angle = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: count }, (_, i) => {
      const radius = Math.sqrt((i + 0.5) / Math.max(1, count));
      return { x: Math.cos(i * angle) * radius, y: Math.sin(i * angle) * radius };
    });
  }
  const slots = new Map(countries.map((country) => [country.id, countrySlots(country.count)]));
  function drawWorld(alpha) {
    markers = [];
    if (alpha < 0.001) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const availableHeight = height,
      cx = width * 0.5,
      cy = 65 + (availableHeight - 65) * 0.5;
    const radius = Math.min(width * 0.44, Math.max(1, availableHeight - 100) * 0.46);
    const projection = globeProjection.translate([cx, cy]).scale(radius).rotate(rotation),
      path = globePath;
    ctx.save();
    ctx.shadowColor = '#829ba32b';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#e5edf0';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const ocean = ctx.createRadialGradient(
      cx - radius * 0.4,
      cy - radius * 0.4,
      0,
      cx,
      cy,
      radius * 1.2,
    );
    ocean.addColorStop(0, '#f7fbfc');
    ocean.addColorStop(1, '#d9e3e8');
    ctx.fillStyle = ocean;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = '#b8cbd565';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (world) {
      ctx.beginPath();
      path(world);
      ctx.fillStyle = '#fcfcf8';
      ctx.fill();
      ctx.strokeStyle = '#bac6ca';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    const shade = ctx.createRadialGradient(
      cx - radius * 0.35,
      cy - radius * 0.4,
      radius * 0.1,
      cx,
      cy,
      radius,
    );
    shade.addColorStop(0, '#ffffff00');
    shade.addColorStop(0.76, '#7b929700');
    shade.addColorStop(1, '#63798438');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
    const visible = countries
      .filter((country) => isGlobeVisible(country.longitude, country.latitude, rotation))
      .map((country) => {
        const [x, y] = projection([country.longitude, country.latitude]);
        return {
          ...country,
          x,
          y,
          anchorX: x,
          anchorY: y,
          radius: Math.sqrt(country.count) * (mobile() ? 2.35 : 2.9) + 3,
        };
      });
    // Séparer les nuées voisines tout en rappelant leur ancrage géographique.
    for (let step = 0; step < 8; step++)
      for (let i = 0; i < visible.length; i++)
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i],
            b = visible[j],
            dx = b.x - a.x,
            dy = b.y - a.y,
            distance = Math.hypot(dx, dy) || 0.01,
            minimum = a.radius + b.radius + 6;
          if (distance >= minimum) continue;
          const push = (minimum - distance) * 0.51,
            ux = distance > 0.02 ? dx / distance : 1,
            uy = distance > 0.02 ? dy / distance : 0;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
    for (const country of visible) {
      const active = hovered === country.id;
      ctx.beginPath();
      ctx.moveTo(country.anchorX, country.anchorY);
      ctx.lineTo(country.x, country.y);
      ctx.strokeStyle = '#aebac2';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(country.x, country.y, country.radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#fff' : '#ffffffc9';
      ctx.fill();
      ctx.strokeStyle = active ? '#8f879c' : '#c4cbd3';
      ctx.lineWidth = active ? 1.2 : 0.7;
      ctx.stroke();
      country.records.forEach((record, index) => {
        const slot = slots.get(country.id)[index],
          spread = country.radius - 3;
        const x = country.x + slot.x * spread,
          y = country.y + slot.y * spread,
          radius = mobile()
            ? config.animation.mobileGlobePointRadius
            : config.animation.globePointRadius;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = authorById.get(record.author).color;
        ctx.fill();
      });
      if (active || (country.count >= 16 && !mobile())) {
        const label = `${country.label} · ${country.count}`;
        ctx.font = `${mobile() ? config.callouts.mobileFontSize : config.callouts.desktopFontSize}px Electrolize, sans-serif`;
        ctx.textAlign = 'center';
        const length = ctx.measureText(label).width;
        ctx.fillStyle = '#fffffff0';
        ctx.fillRect(country.x - length / 2 - 5, country.y - country.radius - 26, length + 10, 20);
        ctx.fillStyle = '#626977';
        ctx.fillText(label, country.x, country.y - country.radius - 11);
      }
    }
    markers = visible;
    ctx.restore();
  }
  function renderFrame(time = 0) {
    handle = null;
    if (!state || suspended) return;
    const delta = previous ? Math.min(0.05, Math.max(0, (time - previous) / 1000)) : 1 / 60;
    previous = time;
    if (!instant()) {
      clock += delta;
      age += delta;
      rotationHold = Math.max(0, rotationHold - delta);
      const easing = 1 - Math.exp((-delta * 5) / Math.max(0.1, config.animation.cameraSeconds));
      for (const key of ['x', 'y', 'zoom'])
        camera[key] += (cameraTarget[key] - camera[key]) * easing;
      graphMix += (graphTarget - graphMix) * easing;
      worldMix += (worldTarget - worldMix) * easing;
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
      if (scene.kind === 'world') {
        const momentum = globeMotion.step(delta),
          motion = globeMotion.getSnapshot();
        if (!motion.dragging && !momentum && !rotationHold && !hovered && !state.journalistId)
          rotation[0] += delta * config.animation.globeSpeed;
      }
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fcfcfa';
    ctx.fillRect(0, 0, width, height);
    annotations = [];
    journalists = [];
    drawCity(1 - worldMix);
    drawWorld(worldMix);
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
    setSuspended(value) {
      suspended = value;
      if (value) globeMotion.stop();
      if (value && handle !== null) {
        cancelFrame(handle);
        handle = null;
      }
      if (!value) wake();
    },
    hitCountry(x, y) {
      return scene?.kind === 'world'
        ? markers
            .filter((marker) => Math.hypot(marker.x - x, marker.y - y) <= marker.radius + 8)
            .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] || null
        : null;
    },
    clientToScene(clientX, clientY) {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: ((clientX - bounds.left) * width) / (bounds.width || width),
        y: ((clientY - bounds.top) * height) / (bounds.height || height),
      };
    },
    hitJournalist(x, y, touch = false) {
      return scene?.kind === 'city' && scene.country && worldMix < 0.5 && graphMix > 0.5
        ? journalists
            .filter(
              (point) => Math.hypot(point.x - x, point.y - y) <= point.radius + (touch ? 5 : 2.5),
            )
            .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] || null
        : null;
    },
    hoverCountry(id) {
      if (id !== hovered) {
        hovered = id;
        wake();
      }
    },
    beginRotation(time) {
      if (scene?.kind !== 'world') return;
      globeMotion.begin(time);
      hovered = null;
      rotationHold = 8;
      wake();
    },
    dragRotation(dx, dy, time) {
      if (scene?.kind !== 'world') return;
      globeMotion.drag(dx, dy, time);
      rotationHold = 8;
      wake();
    },
    endRotation(time) {
      if (instant()) globeMotion.stop();
      else globeMotion.end(time);
      rotationHold = 8;
      wake();
    },
    cancelRotation() {
      globeMotion.stop();
      wake();
    },
    rotate(dx, dy) {
      globeMotion.stop();
      rotation[0] += dx * config.globeMotion.sensitivityX;
      rotation[1] = clamp(
        rotation[1] - dy * config.globeMotion.sensitivityY,
        -config.globeMotion.latitudeLimit,
        config.globeMotion.latitudeLimit,
      );
      rotationHold = 8;
      wake();
    },
    centerCountry(id) {
      const country = countries.find((item) => item.id === id);
      if (country) {
        globeMotion.stop();
        rotation[0] = -country.longitude;
        rotation[1] = -clamp(country.latitude, -60, 60);
        rotationHold = 8;
        wake();
      }
    },
    invalidateCallouts() {
      calloutLayout = null;
      wake();
    },
    getSnapshot: () => ({
      kind: scene?.kind,
      phase: scene?.phase,
      pointCount:
        scene?.kind === 'world' ? data.records.length : scene?.kind === 'intro' ? 0 : points.length,
      visiblePointCount:
        scene?.kind === 'world'
          ? markers.reduce((sum, marker) => sum + marker.count, 0)
          : scene?.kind === 'intro'
            ? 0
            : points.filter((point) => inFocus(point.record)).length,
      countryId: scene?.country?.id || null,
      markers: markers.map((marker) => ({
        id: marker.id,
        count: marker.count,
        x: marker.x,
        y: marker.y,
      })),
      journalists: journalists.map((point) => ({
        id: point.record.id,
        countryId: point.countryId,
        x: point.x,
        y: point.y,
      })),
      annotations,
      rotation: [...rotation],
      motion: globeMotion.getSnapshot(),
    }),
    destroy() {
      suspended = true;
      if (handle !== null) cancelFrame(handle);
    },
  };
}
