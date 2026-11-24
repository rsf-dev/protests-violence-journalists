import { DATA_SCHEMA } from './data/schema.js';
// Réglages éditables. Les textes sont dans JS/i18n/fr.js et en.js.
export const REGLAGES = {
  defaultLanguage: 'fr',
  languages: ['fr', 'en'],
  year: 2026,
  cityName: 'News City',
  typicalSize: 100,
  publication: { indexable: false },
  schema: DATA_SCHEMA,
  files: {
    source: 'evenements.json',
    data: 'manifestations.json',
    images: { intro: 'assets/images/city-overview.webp', graph: 'assets/images/city-route.webp' },
  },
  ui: {
    panelWidth: 380,
    storyWidth: 380,
    tabletStoryWidth: 300,
    mobilePanelRatio: 0.9,
    countryPanelOpen: true,
    headerLogoWidth: 52,
    mobileHeaderLogoWidth: 40,
    footerLogoWidth: 36,
  },
  route: {
    width: 18,
    cleanWidth: 40,
    points: [
      [553, 685],
      [650, 698],
      [707, 460],
      [918, 479],
      [936, 366],
      [995, 369],
    ],
  },
  mobileView: { introScale: 1.12 },
  colors: {
    other: '#356fa4',
    neutral: '#bfc4cc',
    ...Object.fromEntries(
      [...DATA_SCHEMA.authors, ...DATA_SCHEMA.violenceTypes].map((item) => [item.id, item.color]),
    ),
  },
  animation: {
    cameraSeconds: 1.15,
    pointRadius: 2.1,
    pointEntranceSeconds: 1.7,
    swarmAmplitude: 0.65,
    routeFlashSeconds: 2.8,
    maxPixelRatio: 2,
  },
  cameras: {
    country: { x: 775, y: 530, zoom: 2.4, mobileZoom: 2.2 },
  },
  slides: [
    { id: 'news-city', titleKey: 'story.intro.title', phase: 'intro' },
    { id: 'cent-journalistes', titleKey: 'story.neutral.title', phase: 'neutral' },
    { id: 'forces-ordre', titleKey: 'story.police.title', phase: 'police' },
    { id: 'violences-police', titleKey: 'story.policeTypes.title', phase: 'police-types' },
    { id: 'autres-auteurs', titleKey: 'story.otherTypes.title', phase: 'other-types' },
    { id: 'ville-type', titleKey: 'story.overview.title', phase: 'overview' },
  ],
};
