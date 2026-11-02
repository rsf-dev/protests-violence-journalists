import { createController } from './model.js';
import { REGLAGES } from '../reglages.js';
import { createI18n } from '../i18n/index.js';

export function pageHref(page = 'scrolly', language = REGLAGES.defaultLanguage, countryId = '') {
  const lang = REGLAGES.languages.includes(language) ? language : REGLAGES.defaultLanguage;
  if (!['scrolly', 'world', 'country'].includes(page))
    throw new Error(createI18n(lang).t('error.page', { page }));
  if (page === 'country' && !/^[a-z]{2,3}$/i.test(String(countryId)))
    throw new Error(createI18n(lang).t('error.countryCode'));
  const params = new URLSearchParams();
  if (lang !== REGLAGES.defaultLanguage) params.set('lang', lang);
  if (page === 'country') params.set('country', String(countryId).toLowerCase());
  return './' + (params.size ? '?' + params : '');
}
export function countryHref(id, language = REGLAGES.defaultLanguage) {
  return pageHref('country', language, id);
}

/** Une seule entrée HTML, y compris sous un préfixe d’hébergement statique. */
export function readRoute(address, state = null) {
  const url = new URL(address, 'https://newscity.invalid/');
  const requestedLanguage = (url.searchParams.get('lang') || '').toLowerCase();
  const language = REGLAGES.languages.includes(requestedLanguage)
    ? requestedLanguage
    : REGLAGES.defaultLanguage;
  const rawCountry = url.searchParams.get('country');
  const country = /^[a-z]{2,3}$/i.test(rawCountry || '') ? rawCountry.toUpperCase() : '';
  const view = url.searchParams.get('view');
  const page = country
    ? 'country'
    : rawCountry !== null ||
        view === 'country' ||
        view === 'world' ||
        state?.newsCity?.view === 'world'
      ? 'world'
      : 'scrolly';
  let slide = '';
  try {
    slide = decodeURIComponent(url.hash.slice(1));
  } catch {
    /* Un fragment mal formé revient au début. */
  }
  return { language, page, country, slide };
}

export function createPageController(data, config, page = 'scrolly', countryId = '') {
  const controller = createController(data, config);
  if (page === 'world') controller.skip();
  else if (page === 'country') {
    if (!controller.selectCountry(countryId))
      throw new Error(config.i18n.t('error.country', { id: countryId }));
  } else if (page !== 'scrolly') throw new Error(config.i18n.t('error.page', { page }));
  return controller;
}
