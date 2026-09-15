// Shadow Casters — idiomas. El español es el idioma base: cada texto de la
// interfaz se escribe en español y `t()` devuelve la traducción al inglés
// cuando está activo. Si falta una traducción, queda el texto en español.
//
// En el HTML, los elementos con `data-i18n` se traducen por su contenido y
// los atributos con `data-i18n-title` / `data-i18n-placeholder` por su valor.

import { EN } from './idioma-en.js';

const CLAVE = 'shadowcasters.idioma';
export const idioma = { actual: 'es' };
const oyentes = new Set();

export function t(clave, vars) {
  let s = idioma.actual === 'en' ? (Object.prototype.hasOwnProperty.call(EN, clave) ? EN[clave] : clave) : clave;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

// El español es el idioma por defecto; el inglés queda guardado si se eligió.
export function idiomaGuardado() {
  try { return localStorage.getItem(CLAVE) === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
}

export function establecerIdioma(l, silencioso) {
  idioma.actual = l === 'en' ? 'en' : 'es';
  document.documentElement.lang = idioma.actual;
  try { localStorage.setItem(CLAVE, idioma.actual); } catch (_) { /* sin memoria */ }
  traducirDom(document);
  document.querySelectorAll('[data-idioma]').forEach(b => b.classList.toggle('idioma--activo', b.dataset.idioma === idioma.actual));
  if (!silencioso) for (const fn of oyentes) { try { fn(idioma.actual); } catch (e) { console.error(e); } }
}

export function alCambiarIdioma(fn) { oyentes.add(fn); }

export function traducirDom(raiz) {
  raiz.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nOrig == null) el.dataset.i18nOrig = el.innerHTML.trim();
    el.innerHTML = t(el.dataset.i18nOrig);
  });
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    raiz.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => {
      const k = `i18n${attr[0].toUpperCase()}${attr.slice(1).replace('-l', 'L')}Orig`;
      if (el.dataset[k] == null) el.dataset[k] = el.getAttribute(attr) || '';
      el.setAttribute(attr, t(el.dataset[k]));
    });
  }
}

// fecha y hora cortas en el idioma actual
export function hora(ts) { if (!ts) return '—'; return new Date(ts).toLocaleTimeString(idioma.actual === 'en' ? 'en-US' : 'es-UY', { hour: '2-digit', minute: '2-digit' }); }
export function fecha(ts) { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString(idioma.actual === 'en' ? 'en-US' : 'es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + hora(ts); }
