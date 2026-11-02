// Le même identifiant est appliqué à tous les modules par l’import map publiée.
export const ASSET_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';
export const SITE_ROOT = new URL('../../', import.meta.url);
export function resourceURL(path) {
  const url = new URL(path, SITE_ROOT);
  if (
    url.origin !== SITE_ROOT.origin ||
    !url.pathname.startsWith(SITE_ROOT.pathname) ||
    url.username ||
    url.password
  )
    throw new Error('Resource outside site');
  url.searchParams.set('v', ASSET_VERSION);
  return url.href;
}
