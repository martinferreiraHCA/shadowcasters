// Sombras recortadas — modelo del proyecto y motor de dibujo.
//
// Un proyecto es una pieza (en mm) con capas: imágenes (con fondo quitado y
// pasadas a silueta), textos y formas. Cada capa suma (figura) o resta
// (agujero). El resultado se compone en un canvas a la resolución pedida y
// de ahí sale la vista previa, la miniatura, el PNG y —vía
// sombras-vector.js— el SVG para la cortadora.

import {
  vectorizarMascara, svgDesdeContornos, diagnosticarPiezas, mascaraDesdeAlfa,
  limpiarManchas, cerrar, abrir, morfologia
} from './vector.js';

export const VERSION_PROYECTO = 1;

export const FUENTES = [
  { id: 'Space Grotesk', nombre: 'Space Grotesk' },
  { id: 'Bangers', nombre: 'Bangers (cómic)' },
  { id: 'Bebas Neue', nombre: 'Bebas Neue (condensada)' },
  { id: 'Fredoka', nombre: 'Fredoka (redonda)' },
  { id: 'Lobster', nombre: 'Lobster (cursiva)' },
  { id: 'Pacifico', nombre: 'Pacifico (manuscrita)' },
  { id: 'Righteous', nombre: 'Righteous' },
  { id: 'Luckiest Guy', nombre: 'Luckiest Guy (gorda)' },
  { id: 'Chewy', nombre: 'Chewy' },
  { id: 'Abril Fatface', nombre: 'Abril Fatface (serif)' },
  { id: 'Permanent Marker', nombre: 'Permanent Marker (marcador)' },
  { id: 'Press Start 2P', nombre: 'Press Start 2P (pixel)' },
  { id: 'Arial', nombre: 'Arial (del sistema)' },
  { id: 'Georgia', nombre: 'Georgia (del sistema)' },
  { id: 'Impact', nombre: 'Impact (del sistema)' }
];

export const FORMAS = [
  { id: 'rect', nombre: 'Rectángulo' },
  { id: 'rectRedondo', nombre: 'Rectángulo redondeado' },
  { id: 'elipse', nombre: 'Círculo / elipse' },
  { id: 'triangulo', nombre: 'Triángulo' },
  { id: 'estrella', nombre: 'Estrella' },
  { id: 'corazon', nombre: 'Corazón' },
  { id: 'luna', nombre: 'Luna' },
  { id: 'hexagono', nombre: 'Hexágono' },
  { id: 'flecha', nombre: 'Flecha' },
  { id: 'anillo', nombre: 'Anillo' },
  { id: 'puente', nombre: 'Puente (tira fina)' },
  { id: 'nube', nombre: 'Nube' },
  { id: 'rayo', nombre: 'Rayo' },
  { id: 'gota', nombre: 'Gota' }
];

export const TIPOS_PIEZA = [
  { id: 'silueta', nombre: 'Silueta suelta', ayuda: 'Sólo lo que dibujás. Ideal para pegar en acetato o en la pared.' },
  { id: 'base', nombre: 'Silueta con base', ayuda: 'Le agrega una base rectangular abajo para pararla en una ranura o pegarla a un soporte.' },
  { id: 'marco', nombre: 'Silueta con marco', ayuda: 'Un marco alrededor: lo que toca el marco queda unido en una sola pieza.' },
  { id: 'ventana', nombre: 'Placa calada (ventana)', ayuda: 'Una placa entera donde tu diseño es el hueco: la luz pasa por el dibujo. Los pedazos que quedan sueltos adentro se caen.' }
];

// ------------------------------------------------------------------
// Modelo
// ------------------------------------------------------------------

let contadorId = 0;
export function nuevoId(prefijo) {
  contadorId = (contadorId + 1) % 1e6;
  return (prefijo || 'c') + Date.now().toString(36) + contadorId.toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

export function nuevoProyecto(datos) {
  const ahora = Date.now();
  return Object.assign({
    version: VERSION_PROYECTO,
    id: nuevoId('p'),
    nombre: 'Mi sombra',
    autor: '',
    aula: '',
    creado: ahora,
    modificado: ahora,
    pieza: {
      anchoMm: 120, altoMm: 120,
      tipo: 'silueta',
      base: { anchoMm: 60, altoMm: 15 },
      marco: { grosorMm: 6 },
      ventana: { radioMm: 6 },
      espejo: false
    },
    capas: []
  }, datos || {});
}

export function nuevaCapa(tipo, datos) {
  const base = {
    id: nuevoId('c'), tipo, nombre: '', visible: true, modo: 'sumar',
    x: 60, y: 60, w: 40, h: 40, rot: 0, flipX: false, flipY: false
  };
  if (tipo === 'imagen') Object.assign(base, {
    nombre: 'Imagen', src: '', ancho: 0, alto: 0,
    proc: { fondo: 'auto', tolerancia: 40, colorClave: null, silueta: 'alfa', umbral: 128, invertir: false, suavizarMm: 0, engrosarMm: 0, limpiarMm: 1, recortar: null }
  });
  if (tipo === 'texto') Object.assign(base, {
    nombre: 'Texto', texto: 'SOMBRA', fuente: 'Bangers', negrita: false, tamMm: 20, interletra: 0, interlinea: 1.1, alineacion: 'center'
  });
  if (tipo === 'forma') Object.assign(base, {
    nombre: 'Forma', forma: 'estrella', params: { radio: 15, puntas: 5, grosor: 25, interior: 50 }
  });
  return Object.assign(base, datos || {});
}

// Clonado profundo que comparte los strings (las imágenes en dataURL no se copian).
export function clonar(v) {
  if (Array.isArray(v)) return v.map(clonar);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = clonar(v[k]); return o; }
  return v;
}

// Deja el proyecto con todos los campos que espera esta versión.
export function normalizarProyecto(p) {
  const base = nuevoProyecto();
  const out = Object.assign(base, p || {});
  out.pieza = Object.assign(base.pieza, p && p.pieza || {});
  out.pieza.base = Object.assign({ anchoMm: 60, altoMm: 15 }, out.pieza.base || {});
  out.pieza.marco = Object.assign({ grosorMm: 6 }, out.pieza.marco || {});
  out.pieza.ventana = Object.assign({ radioMm: 6 }, out.pieza.ventana || {});
  out.capas = (Array.isArray(out.capas) ? out.capas : []).map(c => {
    const n = nuevaCapa(c.tipo || 'forma');
    const m = Object.assign(n, c);
    if (c.proc) m.proc = Object.assign(n.proc || {}, c.proc);
    if (c.params) m.params = Object.assign(n.params || {}, c.params);
    return m;
  });
  return out;
}

// ------------------------------------------------------------------
// Fuentes
// ------------------------------------------------------------------

const fuentesPedidas = new Set();
export function cargarFuente(fuente) {
  if (!fuente || fuentesPedidas.has(fuente) || !document.fonts) return Promise.resolve();
  fuentesPedidas.add(fuente);
  return document.fonts.load(`20px "${fuente}"`).catch(() => {});
}
export function fuentesDelProyecto(p) {
  return Promise.all(p.capas.filter(c => c.tipo === 'texto').map(c => cargarFuente(c.fuente)));
}

// ------------------------------------------------------------------
// Imágenes: quitar fondo y pasar a silueta (con caché por capa)
// ------------------------------------------------------------------

const cacheImagenes = new Map(); // src → {img, w, h}
const cacheMascaras = new Map(); // clave de proceso → canvas con la silueta (negro + alfa)

export function cargarImagen(src) {
  const c = cacheImagenes.get(src);
  if (c) return c.promesa;
  const promesa = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = src;
  });
  cacheImagenes.set(src, { promesa });
  return promesa;
}
export function imagenLista(src) {
  const c = cacheImagenes.get(src);
  return c && c.img ? c.img : null;
}
export async function asegurarImagen(src) {
  const img = await cargarImagen(src);
  const c = cacheImagenes.get(src);
  if (c) c.img = img;
  return img;
}

// Lee un archivo de imagen y lo deja en dataURL PNG achicado a `maxLado`.
export function leerArchivoImagen(archivo, maxLado) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const esc = Math.min(1, (maxLado || 1200) / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * esc)), h = Math.max(1, Math.round(img.naturalHeight * esc));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        // PNG sólo si la imagen tiene transparencia; una foto opaca va en JPEG
        // (pesa 5 a 10 veces menos: viaja más rápido al aula y ocupa menos)
        const d = cx.getImageData(0, 0, w, h).data;
        let conAlfa = false;
        for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { conAlfa = true; break; }
        resolve({ src: conAlfa ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86), ancho: w, alto: h });
      };
      img.onerror = () => reject(new Error('El navegador no puede abrir ese archivo. Si es una foto .heic del iPhone, convertila a .jpg (o sacá la captura de pantalla) y volvé a subirla.'));
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

function claveProceso(capa, pxPorMmImagen) {
  const p = capa.proc;
  // la resolución sólo importa si hay pasos morfológicos (radios en mm);
  // se cuantiza para no recalcular en cada píxel de un arrastre
  const dependeDeEscala = (p.suavizarMm || 0) || (p.engrosarMm || 0) || (p.limpiarMm || 0);
  const esc = dependeDeEscala ? Math.round(pxPorMmImagen * 2) / 2 : 0;
  return [capa.src.length, capa.src.slice(-40), p.fondo, p.tolerancia, p.colorClave ? p.colorClave.join(',') : '', p.silueta, p.umbral,
    p.invertir ? 1 : 0, p.suavizarMm, p.engrosarMm, p.limpiarMm, esc, p.recortar ? p.recortar.join(',') : ''].join('|');
}

// Procesa la imagen de una capa y devuelve un canvas del tamaño de la
// imagen con la silueta en negro (alfa 255) y el resto transparente.
export function mascaraDeCapaImagen(capa) {
  const img = imagenLista(capa.src);
  if (!img) return null;
  const w = img.naturalWidth, h = img.naturalHeight;
  const pxPorMmImagen = capa.w > 0 ? w / capa.w : 1; // píxeles de la imagen por mm de la pieza
  const clave = claveProceso(capa, pxPorMmImagen);
  const hit = cacheMascaras.get(clave);
  if (hit) return hit;
  if (cacheMascaras.size > 40) cacheMascaras.delete(cacheMascaras.keys().next().value);

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const p = capa.proc;
  const n = w * h;
  const figura = new Uint8Array(n);
  const opaco = new Uint8Array(n);
  for (let i = 0, q = 3; i < n; i++, q += 4) opaco[i] = d[q] > 40 ? 1 : 0;

  // 1) fondo
  if (p.fondo === 'auto' || p.fondo === 'color') {
    const tol = Math.max(0, p.tolerancia || 0);
    const tol2 = tol * tol * 3;
    const dist2 = (i, c) => { const q = i * 4; const dr = d[q] - c[0], dg = d[q + 1] - c[1], db = d[q + 2] - c[2]; return dr * dr + dg * dg + db * db; };
    if (p.fondo === 'color' && p.colorClave) {
      for (let i = 0; i < n; i++) if (opaco[i] && dist2(i, p.colorClave) <= tol2) opaco[i] = 0;
    } else {
      // inundar desde los cuatro bordes con el color de cada semilla
      const visitado = new Uint8Array(n);
      const pila = new Int32Array(n);
      const semillas = [];
      const paso = Math.max(1, Math.floor(Math.min(w, h) / 24));
      for (let x = 0; x < w; x += paso) { semillas.push(x, (h - 1) * w + x); }
      for (let y = 0; y < h; y += paso) { semillas.push(y * w, y * w + w - 1); }
      for (const s of semillas) {
        if (visitado[s] || !opaco[s]) continue;
        const c = [d[s * 4], d[s * 4 + 1], d[s * 4 + 2]];
        let top = 0; pila[top++] = s; visitado[s] = 1;
        while (top) {
          const i = pila[--top];
          if (dist2(i, c) > tol2) continue;
          opaco[i] = 0;
          const x = i % w, y = (i - x) / w;
          if (x > 0 && !visitado[i - 1]) { visitado[i - 1] = 1; pila[top++] = i - 1; }
          if (x < w - 1 && !visitado[i + 1]) { visitado[i + 1] = 1; pila[top++] = i + 1; }
          if (y > 0 && !visitado[i - w]) { visitado[i - w] = 1; pila[top++] = i - w; }
          if (y < h - 1 && !visitado[i + w]) { visitado[i + w] = 1; pila[top++] = i + w; }
        }
      }
    }
  }

  // 2) silueta
  const umbral = p.umbral == null ? 128 : p.umbral;
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    if (!opaco[i]) { figura[i] = 0; continue; }
    if (p.silueta === 'oscuro' || p.silueta === 'claro') {
      const lum = 0.2126 * d[q] + 0.7152 * d[q + 1] + 0.0722 * d[q + 2];
      figura[i] = (p.silueta === 'oscuro' ? lum < umbral : lum >= umbral) ? 1 : 0;
    } else figura[i] = 1;
  }
  // recorte rectangular dentro de la imagen (fracciones 0..1)
  if (p.recortar && p.recortar.length === 4) {
    const [fx0, fy0, fx1, fy1] = p.recortar;
    const x0 = Math.round(fx0 * w), y0 = Math.round(fy0 * h), x1 = Math.round(fx1 * w), y1 = Math.round(fy1 * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) figura[y * w + x] = 0;
  }
  if (p.invertir) for (let i = 0; i < n; i++) figura[i] = figura[i] ? 0 : 1;

  // 3) limpieza morfológica (radios en mm → px de la imagen)
  let m = figura;
  const rSuav = Math.round((p.suavizarMm || 0) * pxPorMmImagen);
  if (rSuav > 0) m = abrir(cerrar(m, w, h, rSuav), w, h, rSuav);
  const rEng = Math.round(Math.abs(p.engrosarMm || 0) * pxPorMmImagen);
  if (rEng > 0) m = morfologia(m, w, h, rEng, (p.engrosarMm || 0) > 0);
  const areaMin = Math.round(((p.limpiarMm || 0) * pxPorMmImagen) ** 2);
  if (areaMin > 1) m = limpiarManchas(m, w, h, areaMin, true);

  // 4) a canvas
  const salida = ctx.createImageData(w, h);
  const s = salida.data;
  for (let i = 0, q = 0; i < n; i++, q += 4) { s[q] = 0; s[q + 1] = 0; s[q + 2] = 0; s[q + 3] = m[i] ? 255 : 0; }
  ctx.putImageData(salida, 0, 0);
  cacheMascaras.set(clave, cv);
  return cv;
}

// Qué parte de la imagen quedó como figura (0..1) con el proceso actual.
export function fraccionFigura(capa) {
  const m = mascaraDeCapaImagen(capa);
  if (!m) return null;
  const d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, m.width, m.height).data;
  let n = 0, total = 0;
  for (let i = 3; i < d.length; i += 4 * 3) { total++; if (d[i] > 128) n++; }
  return total ? n / total : 0;
}

// La foto original recortada por la silueta (lo quitado queda transparente):
// es lo que se muestra en la vista de capas para que se vea la imagen real.
const cacheFotos = new Map(); // canvas de máscara → canvas con la foto
export function fotoRecortadaDeCapa(capa) {
  const m = mascaraDeCapaImagen(capa);
  const img = imagenLista(capa.src);
  if (!m || !img) return null;
  const hit = cacheFotos.get(m);
  if (hit) return hit;
  if (cacheFotos.size > 20) cacheFotos.delete(cacheFotos.keys().next().value);
  const cv = document.createElement('canvas');
  cv.width = m.width; cv.height = m.height;
  const c = cv.getContext('2d');
  c.drawImage(m, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.drawImage(img, 0, 0, m.width, m.height);
  cacheFotos.set(m, cv);
  return cv;
}

// Color del píxel de la imagen de una capa en una fracción (0..1) de su ancho/alto.
export function colorEnImagen(capa, fx, fy) {
  const img = imagenLista(capa.src);
  if (!img) return null;
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, Math.floor(fx * img.naturalWidth), Math.floor(fy * img.naturalHeight), 1, 1, 0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// ------------------------------------------------------------------
// Formas (Path2D en un cuadro unitario 0..1 × 0..1)
// ------------------------------------------------------------------

export function pathDeForma(forma, params) {
  const p = Object.assign({ radio: 15, puntas: 5, grosor: 25, interior: 50 }, params || {});
  const path = new Path2D();
  const poligono = pts => { pts.forEach((q, i) => i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])); path.closePath(); };
  switch (forma) {
    case 'rect': path.rect(0, 0, 1, 1); break;
    case 'rectRedondo': {
      const r = Math.min(0.5, Math.max(0, p.radio / 100));
      path.moveTo(r, 0); path.lineTo(1 - r, 0); path.quadraticCurveTo(1, 0, 1, r); path.lineTo(1, 1 - r);
      path.quadraticCurveTo(1, 1, 1 - r, 1); path.lineTo(r, 1); path.quadraticCurveTo(0, 1, 0, 1 - r); path.lineTo(0, r); path.quadraticCurveTo(0, 0, r, 0); path.closePath();
      break;
    }
    case 'elipse': path.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, Math.PI * 2); break;
    case 'triangulo': poligono([[0.5, 0], [1, 1], [0, 1]]); break;
    case 'hexagono': poligono([0, 1, 2, 3, 4, 5].map(i => { const a = Math.PI / 3 * i; return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]; })); break;
    case 'estrella': {
      const n = Math.max(3, Math.round(p.puntas)), ri = Math.min(0.95, Math.max(0.1, p.interior / 100)) * 0.5;
      const pts = [];
      for (let i = 0; i < 2 * n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; const r = i % 2 ? ri : 0.5; pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]); }
      poligono(pts); break;
    }
    case 'corazon':
      path.moveTo(0.5, 1); path.bezierCurveTo(0.5, 1, 0, 0.7, 0, 0.35); path.bezierCurveTo(0, 0.1, 0.18, 0, 0.3, 0);
      path.bezierCurveTo(0.42, 0, 0.5, 0.1, 0.5, 0.2); path.bezierCurveTo(0.5, 0.1, 0.58, 0, 0.7, 0); path.bezierCurveTo(0.82, 0, 1, 0.1, 1, 0.35);
      path.bezierCurveTo(1, 0.7, 0.5, 1, 0.5, 1); path.closePath(); break;
    case 'luna': {
      const pts = [];
      const N = 48;
      for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + Math.PI * i / N; pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); }
      const d = Math.min(0.9, Math.max(0.1, p.grosor / 100));
      for (let i = N; i >= 0; i--) { const a = -Math.PI / 2 + Math.PI * i / N; pts.push([0.5 - 0.5 * (1 - 2 * d) + 0.5 * (1 - d) * Math.cos(a) + d * 0.5, 0.5 + 0.5 * (1 - d) * Math.sin(a)]); }
      poligono(pts); break;
    }
    case 'flecha': { const g = Math.min(0.9, Math.max(0.1, p.grosor / 100)); poligono([[0, 0.5 - g / 2], [0.6, 0.5 - g / 2], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.5 + g / 2], [0, 0.5 + g / 2]]); break; }
    case 'anillo': {
      const g = Math.min(0.49, Math.max(0.02, p.grosor / 100 * 0.5));
      path.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, Math.PI * 2);
      path.ellipse(0.5, 0.5, 0.5 - g, 0.5 - g, 0, 0, Math.PI * 2, true);
      break;
    }
    case 'puente': path.rect(0, 0, 1, 1); break;
    case 'nube':
      path.moveTo(0.2, 0.9); path.bezierCurveTo(0, 0.9, 0, 0.55, 0.18, 0.5); path.bezierCurveTo(0.15, 0.25, 0.4, 0.15, 0.5, 0.3);
      path.bezierCurveTo(0.6, 0.05, 0.9, 0.15, 0.85, 0.45); path.bezierCurveTo(1.05, 0.5, 1.02, 0.9, 0.8, 0.9); path.closePath(); break;
    case 'rayo': poligono([[0.55, 0], [0.15, 0.55], [0.45, 0.55], [0.35, 1], [0.85, 0.4], [0.55, 0.4], [0.7, 0]]); break;
    case 'gota': path.moveTo(0.5, 0); path.bezierCurveTo(0.5, 0.3, 1, 0.45, 1, 0.7); path.bezierCurveTo(1, 1.1, 0, 1.1, 0, 0.7); path.bezierCurveTo(0, 0.45, 0.5, 0.3, 0.5, 0); path.closePath(); break;
    default: path.rect(0, 0, 1, 1);
  }
  return path;
}

// ------------------------------------------------------------------
// Texto
// ------------------------------------------------------------------

const ctxMedida = (() => { const c = document.createElement('canvas'); return c.getContext('2d'); })();

function fontDe(capa, px) {
  return `${capa.negrita ? 'bold ' : ''}${px}px "${capa.fuente || 'Arial'}", sans-serif`;
}

// Tamaño natural del texto en mm: {w, h, lineas, lineaMm}
export function medirTexto(capa) {
  const px = 100;
  ctxMedida.font = fontDe(capa, px);
  if ('letterSpacing' in ctxMedida) ctxMedida.letterSpacing = `${(capa.interletra || 0) * px / 100}px`;
  const lineas = String(capa.texto || '').split('\n');
  let anchoMax = 1;
  for (const l of lineas) anchoMax = Math.max(anchoMax, ctxMedida.measureText(l || ' ').width + (capa.interletra || 0) * px / 100);
  const lineaPx = px * (capa.interlinea || 1.1);
  const escala = capa.tamMm / px;
  return { w: anchoMax * escala, h: lineas.length * lineaPx * escala, lineas: lineas.length, lineaMm: lineaPx * escala };
}

function dibujarTexto(ctx, capa, pxPorMm) {
  const med = medirTexto(capa);
  const px = capa.tamMm * pxPorMm;
  ctx.font = fontDe(capa, px);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(capa.interletra || 0) * px / 100}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = capa.alineacion || 'center';
  const lineas = String(capa.texto || '').split('\n');
  const lineaPx = med.lineaMm * pxPorMm;
  const wPx = med.w * pxPorMm, hPx = med.h * pxPorMm;
  const x = capa.alineacion === 'left' ? -wPx / 2 : capa.alineacion === 'right' ? wPx / 2 : 0;
  for (let i = 0; i < lineas.length; i++) {
    const y = -hPx / 2 + lineaPx * (i + 0.5);
    ctx.fillText(lineas[i], x, y);
  }
}

// ------------------------------------------------------------------
// Caja de una capa (mm). Los textos miden solos.
// ------------------------------------------------------------------

export function cajaCapa(capa) {
  if (capa.tipo === 'texto') { const m = medirTexto(capa); return { w: m.w, h: m.h }; }
  return { w: capa.w, h: capa.h };
}

// ------------------------------------------------------------------
// Composición
// ------------------------------------------------------------------

// Dibuja una capa centrada en su (x, y) con su rotación y espejos.
// `color` para vistas coloreadas (la máscara de la imagen se tiñe).
function dibujarCapa(ctx, capa, pxPorMm, color) {
  const caja = cajaCapa(capa);
  ctx.save();
  ctx.translate(capa.x * pxPorMm, capa.y * pxPorMm);
  ctx.rotate((capa.rot || 0) * Math.PI / 180);
  ctx.scale(capa.flipX ? -1 : 1, capa.flipY ? -1 : 1);
  ctx.fillStyle = color || '#000';
  const wPx = caja.w * pxPorMm, hPx = caja.h * pxPorMm;
  if (capa.tipo === 'imagen') {
    const m = color === 'foto' ? fotoRecortadaDeCapa(capa) : mascaraDeCapaImagen(capa);
    if (m) {
      if (color === 'foto') ctx.drawImage(m, -wPx / 2, -hPx / 2, wPx, hPx);
      else if (color && color !== '#000') {
        const t = document.createElement('canvas');
        t.width = m.width; t.height = m.height;
        const tc = t.getContext('2d');
        tc.drawImage(m, 0, 0);
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = color; tc.fillRect(0, 0, t.width, t.height);
        ctx.drawImage(t, -wPx / 2, -hPx / 2, wPx, hPx);
      } else ctx.drawImage(m, -wPx / 2, -hPx / 2, wPx, hPx);
    }
  } else if (capa.tipo === 'texto') {
    dibujarTexto(ctx, capa, pxPorMm);
  } else if (capa.tipo === 'forma') {
    ctx.translate(-wPx / 2, -hPx / 2);
    ctx.scale(wPx, hPx);
    ctx.fill(pathDeForma(capa.forma, capa.params), 'evenodd');
  }
  ctx.restore();
}

// Compone todas las capas (sin la base ni el marco) en un canvas del tamaño
// de la pieza. opciones.colores: true → sumar en negro, restar en rojo (vista
// de capas); false → sólo negro con restar recortando de verdad.
// opciones.fotos: en la vista de capas, las imágenes que suman se dibujan con
// la foto real (recortada por la silueta) en vez de negro.
export function componerCapas(proyecto, pxPorMm, opciones) {
  const op = opciones || {};
  const w = Math.max(1, Math.round(proyecto.pieza.anchoMm * pxPorMm));
  const h = Math.max(1, Math.round(proyecto.pieza.altoMm * pxPorMm));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const capa of proyecto.capas) {
    if (!capa.visible) continue;
    if (capa.modo === 'restar') {
      if (op.colores) { ctx.globalCompositeOperation = 'source-over'; dibujarCapa(ctx, capa, pxPorMm, op.colorRestar || '#e0405a'); }
      else { ctx.globalCompositeOperation = 'destination-out'; dibujarCapa(ctx, capa, pxPorMm, '#000'); }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      dibujarCapa(ctx, capa, pxPorMm, (op.fotos && capa.tipo === 'imagen') ? 'foto' : (op.colorSumar || '#000'));
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

// La pieza completa: capas + tipo de pieza (base, marco o ventana). Negro
// opaco sobre transparente. Aplica el espejo de la pieza si `conEspejo`.
export function componerPieza(proyecto, pxPorMm, opciones) {
  const op = opciones || {};
  const pz = proyecto.pieza;
  const capas = componerCapas(proyecto, pxPorMm, { colores: false });
  const w = capas.width, h = capas.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  if (pz.tipo === 'ventana') {
    const r = Math.max(0, (pz.ventana.radioMm || 0) * pxPorMm);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, r); else ctx.rect(0, 0, w, h);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(capas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.drawImage(capas, 0, 0);
    if (pz.tipo === 'base') {
      const bw = Math.min(w, pz.base.anchoMm * pxPorMm), bh = Math.min(h, pz.base.altoMm * pxPorMm);
      ctx.fillRect((w - bw) / 2, h - bh, bw, bh);
    }
    if (pz.tipo === 'marco') {
      const g = Math.min(w / 2, h / 2, pz.marco.grosorMm * pxPorMm);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(g, g, w - 2 * g, h - 2 * g); ctx.fill('evenodd');
    }
  }
  if (op.conEspejo && pz.espejo) {
    const e = document.createElement('canvas');
    e.width = w; e.height = h;
    const ec = e.getContext('2d');
    ec.translate(w, 0); ec.scale(-1, 1); ec.drawImage(cv, 0, 0);
    return e;
  }
  return cv;
}

// Binariza la pieza compuesta y la vectoriza. Devuelve todo lo que hace
// falta para descargar: piezas, svg, avisos, medidas.
export function vectorizarProyecto(proyecto, opciones) {
  const op = Object.assign({ pxPorMm: 5, tolerancia: 0.15, suavizar: 1, detalleMinMm: 1.5, recortarCaja: false, margenMm: 0, espejo: null }, opciones || {});
  const lado = Math.max(proyecto.pieza.anchoMm, proyecto.pieza.altoMm);
  const pxPorMm = Math.min(op.pxPorMm, 2400 / lado);
  const cv = componerPieza(proyecto, pxPorMm, { conEspejo: false });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const w = cv.width, h = cv.height;
  const datos = ctx.getImageData(0, 0, w, h).data;
  const mascara = mascaraDesdeAlfa(datos, w, h, 128);
  const piezas = vectorizarMascara(mascara, w, h, { tolerancia: op.tolerancia * pxPorMm, suavizar: op.suavizar, areaMinima: 0.25 * pxPorMm * pxPorMm });
  const espejo = op.espejo == null ? !!proyecto.pieza.espejo : !!op.espejo;
  const svg = svgDesdeContornos(piezas, pxPorMm, {
    anchoMm: proyecto.pieza.anchoMm, altoMm: proyecto.pieza.altoMm,
    id: nombreArchivo(proyecto), titulo: `${proyecto.nombre || 'Sombra'}${proyecto.autor ? ' — ' + proyecto.autor : ''}`,
    espejo, recortarCaja: op.recortarCaja, margenMm: op.margenMm
  });
  const avisos = diagnosticarPiezas(piezas, pxPorMm, op.detalleMinMm);
  return { piezas, pxPorMm, svg, avisos, anchoMm: proyecto.pieza.anchoMm, altoMm: proyecto.pieza.altoMm, espejo, canvas: cv };
}

export function nombreArchivo(proyecto) {
  const base = [proyecto.autor, proyecto.nombre].filter(Boolean).join('-') || 'sombra';
  return base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'sombra';
}

// PNG (dataURL) de la pieza: negro sobre transparente, o sobre blanco.
export function pngDeProyecto(proyecto, pxPorMm, fondoBlanco) {
  const cv = componerPieza(proyecto, pxPorMm || 5, { conEspejo: true });
  if (!fondoBlanco) return cv.toDataURL('image/png');
  const b = document.createElement('canvas');
  b.width = cv.width; b.height = cv.height;
  const bc = b.getContext('2d');
  bc.fillStyle = '#fff'; bc.fillRect(0, 0, b.width, b.height);
  bc.drawImage(cv, 0, 0);
  return b.toDataURL('image/png');
}

// Miniatura chica (dataURL) para el panel del aula.
export function miniaturaDeProyecto(proyecto, ladoPx) {
  const lado = ladoPx || 160;
  const pxPorMm = lado / Math.max(proyecto.pieza.anchoMm, proyecto.pieza.altoMm, 1);
  const cv = componerPieza(proyecto, pxPorMm, { conEspejo: false });
  const b = document.createElement('canvas');
  b.width = lado; b.height = lado;
  const bc = b.getContext('2d');
  bc.fillStyle = '#fff'; bc.fillRect(0, 0, lado, lado);
  bc.drawImage(cv, (lado - cv.width) / 2, (lado - cv.height) / 2);
  return b.toDataURL('image/png');
}

// Todas las imágenes del proyecto cargadas (para dibujar sin esperar).
export async function prepararProyecto(proyecto) {
  await Promise.all(proyecto.capas.filter(c => c.tipo === 'imagen' && c.src).map(c => asegurarImagen(c.src).catch(() => null)));
  await fuentesDelProyecto(proyecto);
}
