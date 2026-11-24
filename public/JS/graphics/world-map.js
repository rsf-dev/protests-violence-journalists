import { createRenderer as createStoryRenderer } from './scene.js';
import { groupCountries } from '../core/model.js';
import { countryHref } from '../core/routing.js';
import { resourceURL } from '../core/resources.js';
import { createI18n } from '../i18n/index.js';
import { basemapStyle, createBasemapControl, secureMapRequest } from './basemaps.js';

export const MAP_CLASSES = [
  { minimum: 1, maximum: 4, color: '#f7d457' },
  { minimum: 5, maximum: 9, color: '#eead45' },
  { minimum: 10, maximum: 24, color: '#dc783e' },
  { minimum: 25, maximum: 49, color: '#bd3d3d' },
  { minimum: 50, maximum: null, color: '#76001f' },
];

// Découper à l’antiméridien évite les traits traversant toute la carte (Russie, Fidji).
function splitAntimeridian(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const crosses = polygons.some((polygon) =>
    polygon.some((ring) =>
      ring.some((point, index) => index && Math.abs(point[0] - ring[index - 1][0]) > 180),
    ),
  );
  if (!crosses) return geometry;
  const clip = (ring, boundary, keepGreater) => {
    const result = [];
    let previous = ring.at(-1);
    let previousInside = keepGreater ? previous[0] >= boundary : previous[0] <= boundary;
    for (const current of ring) {
      const inside = keepGreater ? current[0] >= boundary : current[0] <= boundary;
      if (inside !== previousInside) {
        const fraction = (boundary - previous[0]) / (current[0] - previous[0]);
        result.push([boundary, previous[1] + fraction * (current[1] - previous[1])]);
      }
      if (inside) result.push(current);
      previous = current;
      previousInside = inside;
    }
    return result;
  };
  const pieces = [];
  for (const polygon of polygons) {
    const rings = polygon.map((ring) => {
      const points = [];
      for (const point of ring.slice(0, -1)) {
        let longitude = point[0];
        if (points.length) {
          while (longitude - points.at(-1)[0] > 180) longitude -= 360;
          while (longitude - points.at(-1)[0] < -180) longitude += 360;
        }
        points.push([longitude, point[1]]);
      }
      return points;
    });
    const minimum = Math.min(...rings[0].map((point) => point[0]));
    const maximum = Math.max(...rings[0].map((point) => point[0]));
    for (
      let window = Math.floor((minimum + 180) / 360);
      window <= Math.floor((maximum + 180) / 360);
      window++
    ) {
      const clipped = [];
      for (const ring of rings) {
        let points = clip(ring, -180 + window * 360, true);
        if (points.length) points = clip(points, 180 + window * 360, false);
        if (points.length < 3) continue;
        const area = points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0);
        if (Math.abs(area) < 1e-9) continue;
        points = points.map(([x, y]) => [x - window * 360, y]);
        points.push([...points[0]]);
        clipped.push(points);
      }
      if (clipped.length) pieces.push(clipped);
    }
  }
  return { type: 'MultiPolygon', coordinates: pieces };
}

export function createCountryFeatures(world, countries) {
  const english = createI18n('en');
  const byName = new Map(countries.map((country) => [english.countryName(country.id), country]));
  byName.set(
    'United States of America',
    countries.find((country) => country.id === 'US'),
  );
  byName.set(
    'Turkey',
    countries.find((country) => country.id === 'TR'),
  );
  const matched = new Set();
  const features = world.features
    .filter((feature) => feature.properties?.name !== 'Antarctica')
    .map((feature, index) => {
      const country = byName.get(feature.properties.name);
      if (country) matched.add(country.id);
      return {
        type: 'Feature',
        id: country?.id || 'atlas-' + index,
        geometry: splitAntimeridian(feature.geometry),
        properties: {
          code: country?.id || '',
          label: country?.label || feature.properties.name,
          cases: country?.count || 0,
          hasData: Boolean(country),
        },
      };
    });
  for (const country of countries) {
    if (!matched.has(country.id)) throw new Error('Country geometry missing: ' + country.id);
  }
  return { type: 'FeatureCollection', features };
}

export function createRenderer(canvas, images, data, config, options) {
  const story = createStoryRenderer(canvas, images, data, config, options);
  const countries = groupCountries(data.records, config.language);
  const byId = new Map(countries.map((country) => [country.id, country]));
  const t = config.i18n.t;
  const container = document.createElement('div');
  container.id = 'world-map';
  container.hidden = true;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', t('map.accessible'));
  canvas.after(container);
  const legend = document.createElement('section');
  legend.className = 'choropleth-legend';
  legend.setAttribute('aria-label', t('map.legend'));
  legend.hidden = true;
  canvas.parentElement.append(legend);
  const status = document.createElement('p');
  status.className = 'map-status';
  status.setAttribute('role', 'status');
  status.textContent = t('map.loading');
  status.hidden = true;
  canvas.parentElement.append(status);
  let visible = false;
  let map = null;
  let mapReady = null;
  let author = 'all';
  let allowedCountries = null;
  let hovered = null;
  let features = null;
  let loaded = false;
  let destroyed = false;
  let maplibre = null;
  let popup = null;
  let basemap = config.map.basemaps.find((entry) => entry.id === config.map.defaultBasemap);
  let basemapControl = null;
  let choroplethEnabled = true;
  let sourceReadyHandler = null;
  function syncTheme() {
    document.body.classList.toggle('map-theme-dark', visible && basemap.theme === 'dark');
    document.body.dataset.basemap = basemap.id;
    document.body.dataset.mapTheme = visible ? basemap.theme : 'light';
  }
  function setBasemap(id) {
    const next = config.map.basemaps.find((entry) => entry.id === id);
    if (!next || next.id === basemap.id) return;
    basemap = next;
    loaded = false;
    if (sourceReadyHandler) map?.off('sourcedata', sourceReadyHandler);
    sourceReadyHandler = null;
    popup?.remove();
    hovered = null;
    status.textContent = t('map.loading');
    status.hidden = !visible;
    syncTheme();
    basemapControl?.sync(id);
    map?.setStyle(basemapStyle(basemap));
  }
  function setChoroplethEnabled(enabled) {
    choroplethEnabled = Boolean(enabled);
    for (const id of ['rsf-countries-fill', 'rsf-countries-outline']) {
      if (map?.getLayer(id))
        map.setLayoutProperty(id, 'visibility', choroplethEnabled ? 'visible' : 'none');
    }
    legend.hidden = !visible || !choroplethEnabled;
    popup?.remove();
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function selectedCount(country) {
    if (allowedCountries && !allowedCountries.has(country.id)) return 0;
    return author === 'all' ? country.count : country.summary.authors[author] || 0;
  }
  function updateLegend() {
    legend.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = t('map.legend');
    const selection = document.createElement('span');
    selection.className = 'choropleth-selection';
    selection.textContent =
      author === 'all' ? t('stats.all') : config.authors.find((item) => item.id === author).label;
    const scale = document.createElement('div');
    scale.className = 'choropleth-scale';
    for (const interval of MAP_CLASSES) {
      const item = document.createElement('span');
      const color = document.createElement('i');
      color.style.backgroundColor = interval.color;
      const label =
        interval.maximum === null
          ? interval.minimum + '+'
          : interval.minimum + '–' + interval.maximum;
      item.append(color, document.createTextNode(label));
      scale.append(item);
    }
    const empty = document.createElement('p');
    const marker = document.createElement('i');
    marker.style.backgroundColor = '#7890a0';
    empty.append(marker, document.createTextNode(t('map.noData')));
    legend.append(title, selection, scale, empty);
  }
  function updateSource() {
    if (!features) return;
    for (const feature of features.features) {
      const country = byId.get(feature.properties.code);
      feature.properties.cases = country ? selectedCount(country) : 0;
    }
    map?.getSource('rsf-countries')?.setData(features);
    updateLegend();
  }
  function hoverCountry(id) {
    if (map?.getSource('rsf-countries')) {
      if (hovered) map.setFeatureState({ source: 'rsf-countries', id: hovered }, { hover: false });
      if (id && byId.has(id)) map.setFeatureState({ source: 'rsf-countries', id }, { hover: true });
    }
    hovered = id;
  }
  async function initialize() {
    maplibre = await import(resourceURL('vendor/maplibre-gl.mjs'));
    if (destroyed) return;
    maplibre.setWorkerUrl(resourceURL('vendor/maplibre-gl-worker.mjs'));
    maplibre.setWorkerCount(2);
    if (!options.world) throw new Error(t('map.geometryError'));
    features = createCountryFeatures(options.world, countries);
    for (const feature of features.features) {
      const country = byId.get(feature.properties.code);
      feature.properties.cases = country ? selectedCount(country) : 0;
    }
    map = new maplibre.Map({
      container,
      style: basemapStyle(basemap),
      center: config.map.center,
      zoom: innerWidth < 760 ? config.map.mobileZoom : config.map.zoom,
      minZoom: config.map.minZoom,
      maxZoom: config.map.maxZoom,
      maxPitch: 0,
      bearing: 0,
      renderWorldCopies: false,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      attributionControl: false,
      transformRequest: (url) => secureMapRequest(url),
      canvasContextAttributes: { preserveDrawingBuffer: true },
      locale: {
        'NavigationControl.ZoomIn': t('map.zoomIn'),
        'NavigationControl.ZoomOut': t('map.zoomOut'),
      },
    });
    map.touchZoomRotate.disableRotation();
    map.getCanvas().setAttribute('aria-label', t('map.accessible'));
    map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
    basemapControl = createBasemapControl({
      entries: config.map.basemaps,
      selected: basemap.id,
      t,
      onSelect: setBasemap,
    });
    map.addControl(basemapControl, 'bottom-right');
    popup = new maplibre.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: '260px',
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(t('map.loadError'))), 30000);
      map.on('style.load', () => {
        const layers = map.getStyle().layers;
        const english = createI18n('en');
        const labels = new Map(
          countries.map((country) => [english.countryName(country.id), country.label]),
        );
        labels.set('Turkey', byId.get('TR')?.label || 'Turkey');
        labels.set('United States of America', byId.get('US')?.label || 'United States');
        const name = [
          'coalesce',
          ['get', 'name:en'],
          ['get', 'name_en'],
          ['get', 'name:latin'],
          ['get', 'name'],
        ];
        const localized = [
          'coalesce',
          ['get', 'name:' + config.language],
          ['get', 'name_' + config.language],
          ['get', 'name:latin'],
          ['get', 'name'],
        ];
        for (const layer of layers.filter((layer) => layer.id.startsWith('label_country_'))) {
          map.setLayoutProperty(layer.id, 'text-field', [
            'match',
            name,
            ...[...labels].flat(),
            localized,
          ]);
        }
        const firstLabel = layers.find((layer) => layer.type === 'symbol')?.id;
        if (sourceReadyHandler) map.off('sourcedata', sourceReadyHandler);
        if (map.getLayer('rsf-countries-outline')) map.removeLayer('rsf-countries-outline');
        if (map.getLayer('rsf-countries-fill')) map.removeLayer('rsf-countries-fill');
        if (map.getSource('rsf-countries')) map.removeSource('rsf-countries');
        map.addSource('rsf-countries', { type: 'geojson', data: features });
        map.addLayer(
          {
            id: 'rsf-countries-fill',
            type: 'fill',
            source: 'rsf-countries',
            paint: {
              'fill-color': [
                'case',
                ['>', ['get', 'cases'], 0],
                [
                  'step',
                  ['get', 'cases'],
                  '#f7d457',
                  5,
                  '#eead45',
                  10,
                  '#dc783e',
                  25,
                  '#bd3d3d',
                  50,
                  '#76001f',
                ],
                '#7890a0',
              ],
              'fill-opacity': ['case', ['>', ['get', 'cases'], 0], 0.9, 0.42],
            },
          },
          firstLabel,
        );
        map.addLayer(
          {
            id: 'rsf-countries-outline',
            type: 'line',
            source: 'rsf-countries',
            paint: {
              'line-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                '#b60038',
                '#ffffff',
              ],
              'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.6],
            },
          },
          firstLabel,
        );
        setChoroplethEnabled(choroplethEnabled);
        const done = () => {
          if (!map.isSourceLoaded('rsf-countries')) return;
          map.off('sourcedata', done);
          clearTimeout(timeout);
          loaded = true;
          status.hidden = true;
          resolve();
        };
        sourceReadyHandler = done;
        map.on('sourcedata', done);
        done();
      });
      map.on('error', (event) => {
        // Les polygones et leurs effectifs restent locaux si le fond distant tarde.
        console.warn('Basemap:', event.error?.message || event.message);
      });
    });
    map.on('mousemove', 'rsf-countries-fill', (event) => {
      const feature = event.features?.[0];
      const match = byId.get(feature?.properties.code);
      const country = match && selectedCount(match) > 0 ? match : null;
      hoverCountry(country?.id || null);
      map.getCanvas().style.cursor = country ? 'pointer' : '';
      if (!country || event.originalEvent?.pointerType === 'touch') {
        popup.remove();
        return;
      }
      const content = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('span');
      title.textContent = country.label;
      detail.textContent = t('map.countryCount', { count: selectedCount(country) });
      content.append(title, detail);
      popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    });
    map.on('mouseleave', 'rsf-countries-fill', () => {
      hoverCountry(null);
      popup.remove();
      map.getCanvas().style.cursor = '';
    });
    map.on('click', 'rsf-countries-fill', (event) => {
      const code = event.features?.[0]?.properties.code;
      if (byId.has(code) && selectedCount(byId.get(code)) > 0)
        location.assign(new URL(countryHref(code, config.language), document.baseURI));
    });
    map.on('dragstart', () => popup.remove());
    updateLegend();
    map.resize();
  }
  return {
    ...story,
    setState(next, reduced) {
      visible = next.inExplore && next.view === 'world';
      container.hidden = !visible;
      legend.hidden = !visible || !choroplethEnabled;
      syncTheme();
      status.hidden = !visible || loaded;
      canvas.hidden = visible;
      document.body.classList.toggle('has-choropleth', visible);
      if (visible) {
        story.setSuspended(true);
        mapReady ||= initialize();
        // La promesse est également attendue par le chargement et le contrôleur de présentation.
        mapReady.catch(() => {
          status.textContent = t('map.loadError');
          status.setAttribute('role', 'alert');
        });
        map?.resize();
      } else {
        map?.stop();
        popup?.remove();
        story.setState(next, reduced);
        story.setSuspended(document.hidden);
      }
    },
    resize(width, height, ratio) {
      const bounds = canvas.parentElement.getBoundingClientRect();
      story.resize(width || bounds.width, height || bounds.height, ratio);
      map?.resize();
    },
    renderFrame(time) {
      if (!visible) story.renderFrame(time);
      else map?.triggerRepaint();
    },
    setSuspended(value) {
      story.setSuspended(value || visible);
      if (!value && visible) map?.triggerRepaint();
    },
    hoverCountry(id) {
      if (visible) hoverCountry(id);
    },
    setAuthorFilter(id) {
      if (id !== 'all' && !config.authors.some((item) => item.id === id)) return;
      if (author === id) return;
      author = id;
      popup?.remove();
      updateSource();
    },
    setCountryFilter(ids) {
      const next = new Set(ids.filter((id) => byId.has(id)));
      if (
        allowedCountries &&
        next.size === allowedCountries.size &&
        [...next].every((id) => allowedCountries.has(id))
      )
        return;
      allowedCountries = next;
      popup?.remove();
      hoverCountry(null);
      updateSource();
    },
    setBasemap,
    setChoroplethEnabled,
    resetWorld() {
      map?.easeTo({
        center: config.map.center,
        zoom: innerWidth < 760 ? config.map.mobileZoom : config.map.zoom,
        duration: reducedMotion.matches ? 0 : 450,
      });
    },
    ready: () => (visible ? mapReady : Promise.resolve()),
    getMap: () => map,
    getSnapshot() {
      if (!visible) return story.getSnapshot();
      return {
        kind: 'world',
        phase: 'world',
        choropleth: choroplethEnabled,
        basemap: basemap.id,
        theme: basemap.theme,
        loaded,
        authorFilter: author,
        pointCount: data.records.length,
        visiblePointCount: 0,
        markers: [],
        points: [],
        floatingLabels: 0,
        countryId: null,
        zoom: map?.getZoom() || 0,
        center: map ? map.getCenter().toArray() : [8, 22],
        counts: Object.fromEntries(
          countries.map((country) => [country.id, selectedCount(country)]),
        ),
      };
    },
    destroy() {
      destroyed = true;
      story.destroy();
      popup?.remove();
      map?.remove();
      container.remove();
      legend.remove();
      status.remove();
    },
  };
}
