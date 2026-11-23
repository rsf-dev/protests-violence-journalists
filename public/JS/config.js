import { REGLAGES } from './reglages.js';
import { createI18n } from './i18n/index.js';

export function createConfig(language = REGLAGES.defaultLanguage, metadata = {}) {
  const i18n = createI18n(language),
    t = i18n.t;
  return {
    ...REGLAGES,
    language: i18n.language,
    i18n,
    year: metadata.year || REGLAGES.year,
    dataUrl: REGLAGES.files.data,
    atlasUrl: REGLAGES.files.atlas,
    images: REGLAGES.files.images,
    authors: (metadata.authors || REGLAGES.schema.authors).map((item) => ({
      ...item,
      color: REGLAGES.colors[item.id] || item.color,
      label: t(item.labelKey),
      short: t(item.shortKey),
    })),
    violenceTypes: (metadata.violenceTypes || REGLAGES.schema.violenceTypes).map((item) => ({
      ...item,
      color: REGLAGES.colors[item.id] || item.color,
      label: t(item.labelKey),
      short: t(item.shortKey),
    })),
    slides: REGLAGES.slides.map((slide) => ({
      ...slide,
      title: t(slide.titleKey, { typical: 100 }),
    })),
  };
}
export const CONFIG = createConfig();
