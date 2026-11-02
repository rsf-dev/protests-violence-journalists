import fr from './fr.js';
import en from './en.js';
import { REGLAGES } from '../reglages.js';

export const dictionaries = { fr, en };
export function createI18n(language = REGLAGES.defaultLanguage) {
  const lang = REGLAGES.languages.includes(language) ? language : REGLAGES.defaultLanguage;
  const messages = dictionaries[lang];
  const valueText = (value) =>
    String(value && typeof value === 'object' && 'value' in value ? value.value : (value ?? ''));
  function t(key, values = {}) {
    if (!(key in messages)) throw new Error('Missing translation: ' + lang + ':' + key);
    return messages[key].replace(/\{(\w+)\}/g, (token, name) =>
      name in values ? valueText(values[name]) : token,
    );
  }
  function fill(element, key, values = {}) {
    const fragment = element.ownerDocument.createDocumentFragment();
    for (const part of messages[key].split(/(\{\w+\})/g)) {
      const name = /^\{(\w+)\}$/.exec(part)?.[1],
        value = name && values[name];
      if (value && typeof value === 'object' && value.className) {
        const strong = element.ownerDocument.createElement('strong');
        strong.className = value.className;
        strong.textContent = valueText(value);
        fragment.append(strong);
      } else
        fragment.append(
          element.ownerDocument.createTextNode(name && name in values ? valueText(value) : part),
        );
    }
    element.replaceChildren(fragment);
  }
  function apply(root, values = {}) {
    root
      .querySelectorAll('[data-i18n]')
      .forEach((element) => fill(element, element.dataset.i18n, values));
    for (const attribute of ['aria-label', 'title', 'alt'])
      root
        .querySelectorAll('[data-i18n-' + attribute + ']')
        .forEach((element) =>
          element.setAttribute(
            attribute,
            t(element.getAttribute('data-i18n-' + attribute), values),
          ),
        );
  }
  const countryName = (id, fallback = id) => messages['country.' + id] || fallback;
  const cityName = (city) => messages['city.' + city] || city;
  function recordTitle(record) {
    return !record.journalistLabel || record.journalistLabel.trim().toLowerCase() === 'inconnu'
      ? t('record.unnamed', { id: record.id })
      : record.journalistLabel;
  }
  const dateLabel = (value) =>
    !value
      ? value
      : messages['date.' + value] ||
        (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
          ? new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(value))
          : value);
  const regionName = (value) => messages['region.' + value] || value;
  const mediaName = (value) => messages['media.' + value] || value;
  return {
    language: lang,
    t,
    fill,
    apply,
    countryName,
    cityName,
    recordTitle,
    dateLabel,
    regionName,
    mediaName,
  };
}
