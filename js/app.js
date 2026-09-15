// Shadow Casters — editor gráfico de sombras con la distribución de Scratch:
// panel de elementos a la izquierda (categorías + galerías y ajustes), lienzo
// al centro y vista previa + capas a la derecha. Todo en una pantalla.
//
// El modelo del proyecto y el dibujo viven en render.js / vector.js (mismo
// formato .json que «Sombras recortadas» del Generador de Actividades).

import {
  nuevoProyecto, nuevaCapa, clonar, normalizarProyecto, FUENTES, FORMAS, TIPOS_PIEZA,
  cargarFuente, leerArchivoImagen, asegurarImagen, colorEnImagen, fraccionFigura,
  pathDeForma, cajaCapa, componerCapas, componerPieza, prepararProyecto,
  vectorizarProyecto, pngDeProyecto, nombreArchivo, rectanglesBordes, aplicarConfigPieza
} from './render.js';
import { cajaGlobal } from './vector.js';
import { t, alCambiarIdioma } from './i18n.js';

const $ = id => document.getElementById(id);
const MAT_MM = 304.8;          // tapete de 12 × 12 pulgadas
const MARGEN_MAT_MM = 6;

const PRESETS_PIEZA = [
  { nombre: '10 × 10 cm', w: 100, h: 100 },
  { nombre: '12 × 12 cm', w: 120, h: 120 },
  { nombre: '15 × 15 cm', w: 150, h: 150 },
  { nombre: '20 × 15 cm', w: 200, h: 150 },
  { nombre: '20 × 20 cm', w: 200, h: 200 },
  { nombre: 'A5 (14,8 × 21 cm)', w: 148, h: 210 },
  { nombre: 'Tapete entero (29 × 29 cm)', w: 290, h: 290 }
];

const ICONO_CAPA = { imagen: '🖼', texto: '🔤', forma: '⭐' };
const ICONO_FORMA = {
  rect: '▭', rectRedondo: '▢', elipse: '⬤', triangulo: '▲', estrella: '★', corazon: '♥', luna: '☾',
  hexagono: '⬢', flecha: '➜', anillo: '◯', puente: '▬', nube: '☁', rayo: '⚡', gota: '💧'
};

// ------------------------------------------------------------------
// Estado
// ------------------------------------------------------------------
const estado = {
  proyecto: nuevoProyecto(),
  sel: null,               // id de capa seleccionada, 'pieza', o null
  zoom: 1,
  pan: { x: 0, y: 0 },
  mostrarFotos: true,
  vista: 'pieza',          // escenario: pieza | sombra | tapete
  luz: { x: 0.5, y: 0.15 },
  historial: [],
  futuro: [],
  gotero: false,
  detalleMinMm: 1.5,
  recortarSvg: true,
  puenteMm: 3,             // grosor de las uniones automáticas
  corte: null,             // último vectorizado
  arrastre: null,
  puntoSoltar: null        // dónde soltaron el elemento «subir imagen»
};

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('toast--visible'), ms || 2800);
}
function escapar(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const redondear = (n, d) => Math.round(n * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d);
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
function descargar(contenido, nombre, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}
function dataUrlABlob(dataUrl) {
  const [cab, b64] = dataUrl.split(',');
  const tipo = (cab.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: tipo });
}
function asignar(obj, ruta, valor) {
  const partes = ruta.split('.');
  let o = obj;
  for (let i = 0; i < partes.length - 1; i++) { if (!o[partes[i]]) o[partes[i]] = {}; o = o[partes[i]]; }
  o[partes[partes.length - 1]] = valor;
}
function leer(obj, ruta) { return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function leerValor(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number' || input.type === 'range') return parseFloat(input.value);
  return input.value;
}

const capaSel = () => (estado.sel && estado.sel !== 'pieza') ? estado.proyecto.capas.find(c => c.id === estado.sel) || null : null;
const idx = id => estado.proyecto.capas.findIndex(c => c.id === id);

// ------------------------------------------------------------------
// Guardado: el editor avisa (con retraso) y clase.js decide dónde guardar
// (en este navegador, en la clase del docente…). Historial para deshacer.
// ------------------------------------------------------------------
let temporizadorGuardado = null;
function guardarPronto() {
  estadoGuardado(t('● guardando…'), true);
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarAhora, 800);
}
function guardarAhora() {
  clearTimeout(temporizadorGuardado);
  if (editor.alCambiar) { try { editor.alCambiar(estado.proyecto); } catch (e) { console.error(e); } }
}
function estadoGuardado(texto, pendiente) {
  $('estadoGuardado').textContent = texto;
  $('estadoGuardado').classList.toggle('menu__guardado--pendiente', !!pendiente);
}

function anotar() {
  estado.historial.push(clonar(estado.proyecto));
  if (estado.historial.length > 80) estado.historial.shift();
  estado.futuro.length = 0;
}
function deshacer() {
  if (!estado.historial.length) { toast(t('No hay nada para deshacer')); return; }
  estado.futuro.push(clonar(estado.proyecto));
  estado.proyecto = estado.historial.pop();
  if (estado.sel && estado.sel !== 'pieza' && !capaSel()) estado.sel = null;
  cambio(true);
}
function rehacer() {
  if (!estado.futuro.length) return;
  estado.historial.push(clonar(estado.proyecto));
  estado.proyecto = estado.futuro.pop();
  if (estado.sel && estado.sel !== 'pieza' && !capaSel()) estado.sel = null;
  cambio(true);
}

// Después de cualquier modificación: redibujar todo y guardar.
// `todo` = también la paleta y la lista de capas (cambios de estructura).
function cambio(todo) {
  estado.proyecto.modificado = Date.now();
  estado.corte = null;
  redibujarLienzo();
  redibujarEscenario();
  refrescarInfo();
  if (todo) { refrescarCapas(); refrescarPaleta(); }
  else refrescarMiniaturas();
  guardarPronto();
}

// ------------------------------------------------------------------
// Lienzo
// ------------------------------------------------------------------
const zona = $('zonaLienzo');
const canvas = $('canvasLienzo');
const ctx = canvas.getContext('2d');
let dpr = 1, pxPorMm = 3, origen = { x: 0, y: 0 }, W = 0, H = 0;
let redibujarPedido = false;

function medirLienzo() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(200, zona.clientWidth); H = Math.max(200, zona.clientHeight);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  const pz = estado.proyecto.pieza;
  const margen = 40;
  const base = Math.max(0.2, Math.min((W - 2 * margen) / pz.anchoMm, (H - 2 * margen - 26) / pz.altoMm));
  pxPorMm = base * estado.zoom;
  origen = {
    x: (W - pz.anchoMm * pxPorMm) / 2 + estado.pan.x,
    y: (H - 26 - pz.altoMm * pxPorMm) / 2 + estado.pan.y
  };
}
const aMm = (px, py) => ({ x: (px - origen.x) / pxPorMm, y: (py - origen.y) / pxPorMm });
const aPx = (mx, my) => ({ x: origen.x + mx * pxPorMm, y: origen.y + my * pxPorMm });
function puntoDeEvento(e) {
  const r = canvas.getBoundingClientRect();
  return aMm(e.clientX - r.left, e.clientY - r.top);
}
function aLocal(capa, p) {
  const a = -(capa.rot || 0) * Math.PI / 180;
  const dx = p.x - capa.x, dy = p.y - capa.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
function deLocal(capa, l) {
  const a = (capa.rot || 0) * Math.PI / 180;
  return { x: capa.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: capa.y + l.x * Math.sin(a) + l.y * Math.cos(a) };
}
const ESQUINAS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function manijas(capa) {
  const c = cajaCapa(capa);
  const lista = ESQUINAS.map(([sx, sy]) => ({ tipo: 'escalar', sx, sy, p: deLocal(capa, { x: sx * c.w / 2, y: sy * c.h / 2 }) }));
  lista.push({ tipo: 'rotar', p: deLocal(capa, { x: 0, y: -c.h / 2 - 26 / pxPorMm }) });
  return lista;
}
function manijaEn(capa, p) {
  const rad = 11 / pxPorMm;
  for (const m of manijas(capa)) if (Math.hypot(m.p.x - p.x, m.p.y - p.y) <= rad) return m;
  return null;
}
function capaEn(p) {
  const capas = estado.proyecto.capas;
  for (let i = capas.length - 1; i >= 0; i--) {
    const capa = capas[i];
    if (!capa.visible) continue;
    const c = cajaCapa(capa), l = aLocal(capa, p);
    if (Math.abs(l.x) <= c.w / 2 + 2 / pxPorMm && Math.abs(l.y) <= c.h / 2 + 2 / pxPorMm) return capa;
  }
  return null;
}

function redibujarLienzo() {
  if (redibujarPedido) return;
  redibujarPedido = true;
  requestAnimationFrame(() => { redibujarPedido = false; dibujarLienzo(); });
}

function dibujarLienzo() {
  medirLienzo();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const p = estado.proyecto, pz = p.pieza;
  const wPx = pz.anchoMm * pxPorMm, hPx = pz.altoMm * pxPorMm;

  // hoja
  ctx.save();
  ctx.shadowColor = 'rgba(44,26,74,0.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  ctx.fillRect(origen.x, origen.y, wPx, hPx);
  ctx.restore();
  ctx.strokeStyle = 'rgba(44,26,74,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(origen.x - 0.5, origen.y - 0.5, wPx + 1, hPx + 1);

  // fantasma del tipo de pieza (base, marco o placa)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  if (pz.tipo === 'base') {
    const bw = Math.min(wPx, pz.base.anchoMm * pxPorMm), bh = Math.min(hPx, pz.base.altoMm * pxPorMm);
    ctx.fillRect(origen.x + (wPx - bw) / 2, origen.y + hPx - bh, bw, bh);
  } else if (pz.tipo === 'marco') {
    const g = pz.marco.grosorMm * pxPorMm;
    ctx.beginPath(); ctx.rect(origen.x, origen.y, wPx, hPx); ctx.rect(origen.x + g, origen.y + g, wPx - 2 * g, hPx - 2 * g); ctx.fill('evenodd');
  } else if (pz.tipo === 'ventana') {
    ctx.fillRect(origen.x, origen.y, wPx, hPx);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (const r of rectanglesBordes(pz, wPx, hPx, pxPorMm)) ctx.fillRect(origen.x + r[0], origen.y + r[1], r[2], r[3]);
  ctx.restore();

  // capas con colores: negro suma, rojo resta
  if (p.capas.length) {
    const comp = componerCapas(p, pxPorMm * dpr, { colores: true, fotos: estado.mostrarFotos });
    ctx.drawImage(comp, origen.x, origen.y, wPx, hPx);
  }

  // selección
  const capa = capaSel();
  if (capa) {
    const c = cajaCapa(capa);
    ctx.save();
    const centro = aPx(capa.x, capa.y);
    ctx.translate(centro.x, centro.y);
    ctx.rotate((capa.rot || 0) * Math.PI / 180);
    ctx.strokeStyle = '#4C97FF'; ctx.lineWidth = 2;
    ctx.strokeRect(-c.w * pxPorMm / 2, -c.h * pxPorMm / 2, c.w * pxPorMm, c.h * pxPorMm);
    ctx.beginPath(); ctx.moveTo(0, -c.h * pxPorMm / 2); ctx.lineTo(0, -c.h * pxPorMm / 2 - 26); ctx.stroke();
    ctx.restore();
    for (const m of manijas(capa)) {
      const q = aPx(m.p.x, m.p.y);
      ctx.beginPath();
      if (m.tipo === 'rotar') { ctx.arc(q.x, q.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#4C97FF'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('↻', q.x, q.y + 0.5); }
      else { ctx.rect(q.x - 6, q.y - 6, 12, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#4C97FF'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  $('lienzoVacio').style.display = p.capas.length ? 'none' : '';
  const zoomTxt = Math.round(estado.zoom * 100) + ' %';
  $('lienzoPie').innerHTML = `<span>${t('Pieza')} <b>${pz.anchoMm} × ${pz.altoMm} mm</b></span><span>${t(p.capas.length === 1 ? '{n} capa' : '{n} capas', { n: p.capas.length })}</span>` +
    (capa ? `<span>${t('Seleccionada:')} <b>${escapar(capa.nombre)}</b> (${redondear(cajaCapa(capa).w)} × ${redondear(cajaCapa(capa).h)} mm)</span>` : `<span>${t('Hacé clic en un elemento para editarlo · arrastralo para moverlo')}</span>`) +
    `<span style="margin-left:auto">zoom ${zoomTxt}</span>`;
}

// --- interacción con el mouse / dedo
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  zona.focus({ preventScroll: true });
  const p = puntoDeEvento(e);
  canvas.setPointerCapture(e.pointerId);

  if (estado.gotero) {
    const capa = capaSel();
    if (capa && capa.tipo === 'imagen') {
      const l = aLocal(capa, p);
      const c = cajaCapa(capa);
      let fx = l.x / c.w + 0.5, fy = l.y / c.h + 0.5;
      if (capa.flipX) fx = 1 - fx; if (capa.flipY) fy = 1 - fy;
      if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
        anotar();
        capa.proc.colorClave = colorEnImagen(capa, fx, fy);
        capa.proc.fondo = 'color';
        terminarGotero();
        cambio(true);
        toast(t('Listo: ese color se quita como fondo. Ajustá la tolerancia si hace falta.'));
        return;
      }
      toast(t('Hacé clic dentro de la foto, sobre el color del fondo'));
      return;
    }
    terminarGotero();
  }

  const capa = capaSel();
  if (capa) {
    const m = manijaEn(capa, p);
    if (m) {
      anotar();
      const c = cajaCapa(capa);
      if (m.tipo === 'rotar') estado.arrastre = { tipo: 'rotar', capa, rot0: capa.rot || 0 };
      else estado.arrastre = { tipo: 'escalar', capa, sx: m.sx, sy: m.sy, c0: c, tam0: capa.tamMm, anc: deLocal(capa, { x: -m.sx * c.w / 2, y: -m.sy * c.h / 2 }) };
      return;
    }
  }
  const golpe = capaEn(p);
  if (golpe) {
    if (golpe.id !== estado.sel) seleccionar(golpe.id);
    anotar();
    estado.arrastre = { tipo: 'mover', capa: golpe, dx: golpe.x - p.x, dy: golpe.y - p.y, movio: false };
    return;
  }
  // clic en el fondo: deseleccionar
  if (estado.sel && estado.sel !== 'pieza') seleccionar(null);
});

canvas.addEventListener('pointermove', e => {
  const a = estado.arrastre;
  if (!a) {
    if (estado.gotero) return;
    const capa = capaSel();
    const p = puntoDeEvento(e);
    let cursor = 'default';
    if (capa) { const m = manijaEn(capa, p); if (m) cursor = m.tipo === 'rotar' ? 'grab' : 'nwse-resize'; }
    if (cursor === 'default' && capaEn(p)) cursor = 'move';
    canvas.style.cursor = cursor;
    return;
  }
  const p = puntoDeEvento(e);
  const capa = a.capa;
  if (a.tipo === 'mover') {
    let x = p.x + a.dx, y = p.y + a.dy;
    if (!e.altKey) {          // imán al centro y a los bordes de la pieza
      const pz = estado.proyecto.pieza, im = 3 / estado.zoom;
      if (Math.abs(x - pz.anchoMm / 2) < im) x = pz.anchoMm / 2;
      if (Math.abs(y - pz.altoMm / 2) < im) y = pz.altoMm / 2;
    }
    capa.x = x; capa.y = y; a.movio = true;
  } else if (a.tipo === 'rotar') {
    let ang = Math.atan2(p.y - capa.y, p.x - capa.x) * 180 / Math.PI + 90;
    if (!e.shiftKey) { const s = Math.round(ang / 15) * 15; if (Math.abs(ang - s) < 4) ang = s; } else ang = Math.round(ang / 15) * 15;
    ang = ((ang + 180) % 360 + 360) % 360 - 180;
    capa.rot = Math.round(ang);
  } else if (a.tipo === 'escalar') {
    const r = -(capa.rot || 0) * Math.PI / 180;
    const dx = p.x - a.anc.x, dy = p.y - a.anc.y;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    let w = Math.max(2, a.sx * lx), h = Math.max(2, a.sy * ly);
    const proporcional = capa.tipo !== 'forma' ? !e.shiftKey : e.shiftKey;
    if (proporcional || capa.tipo === 'texto') {
      const s = Math.max(w / a.c0.w, h / a.c0.h);
      w = a.c0.w * s; h = a.c0.h * s;
      if (capa.tipo === 'texto') capa.tamMm = Math.max(3, a.tam0 * s);
    }
    if (capa.tipo !== 'texto') { capa.w = w; capa.h = h; }
    const c = cajaCapa(capa);
    const centro = { x: a.sx * c.w / 2, y: a.sy * c.h / 2 };
    const rr = (capa.rot || 0) * Math.PI / 180;
    capa.x = a.anc.x + centro.x * Math.cos(rr) - centro.y * Math.sin(rr);
    capa.y = a.anc.y + centro.x * Math.sin(rr) + centro.y * Math.cos(rr);
  }
  redibujarLienzo();
  refrescarInfo();
});

function soltar(e) {
  const a = estado.arrastre;
  if (!a) return;
  estado.arrastre = null;
  if (a.tipo === 'mover' && !a.movio) { estado.historial.pop(); return; }
  cambio(false);
}
canvas.addEventListener('pointerup', soltar);
canvas.addEventListener('pointercancel', soltar);
canvas.addEventListener('dblclick', e => {
  const capa = capaEn(puntoDeEvento(e));
  if (capa && capa.tipo === 'texto') { seleccionar(capa.id); irACategoria('texto'); const ta = document.querySelector('#paleta textarea[data-prop="texto"]'); if (ta) { ta.focus({ preventScroll: true }); ta.select(); } }
});
canvas.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  ajustarZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

function ajustarZoom(factor) {
  estado.zoom = limitar(estado.zoom * factor, 0.3, 6);
  redibujarLienzo();
}
$('zoomMas').addEventListener('click', () => ajustarZoom(1.25));
$('zoomMenos').addEventListener('click', () => ajustarZoom(1 / 1.25));
$('zoomIgual').addEventListener('click', () => { estado.zoom = 1; estado.pan = { x: 0, y: 0 }; redibujarLienzo(); });

// teclado
zona.addEventListener('keydown', e => {
  const capa = capaSel();
  if (e.key === 'Escape') { if (estado.gotero) terminarGotero(); else seleccionar(null); return; }
  if (!capa) return;
  const paso = e.shiftKey ? 5 : 1;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); eliminar(capa); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); anotar(); capa.x -= paso; cambio(false); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); anotar(); capa.x += paso; cambio(false); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); anotar(); capa.y -= paso; cambio(false); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); anotar(); capa.y += paso; cambio(false); }
});
document.addEventListener('keydown', e => {
  const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && !enCampo) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); rehacer(); }
    else if (k === 'd') { e.preventDefault(); const c = capaSel(); if (c) duplicar(c); }
    else if (k === 's') { e.preventDefault(); guardarJson(); }
  }
});

// soltar archivos y pegar imágenes
['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('lienzo__zona--soltar'); }));
zona.addEventListener('dragleave', e => { if (!zona.contains(e.relatedTarget)) zona.classList.remove('lienzo__zona--soltar'); });
zona.addEventListener('drop', e => {
  e.preventDefault(); zona.classList.remove('lienzo__zona--soltar');
  const archivos = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type));
  if (!archivos.length) { toast(t('Soltá una imagen (jpg, png, gif, webp…)')); return; }
  const r = canvas.getBoundingClientRect();
  estado.puntoSoltar = aMm(e.clientX - r.left, e.clientY - r.top);
  archivos.forEach(f => agregarImagen(f));
});
document.addEventListener('paste', e => {
  const items = Array.from(e.clipboardData && e.clipboardData.items || []);
  const img = items.find(i => /^image\//.test(i.type));
  if (img) { e.preventDefault(); agregarImagen(img.getAsFile()); }
});

new ResizeObserver(() => { redibujarLienzo(); redibujarEscenario(); }).observe(zona);
// el taller ocupa la pantalla entera: nada debe desplazar el documento
window.addEventListener('scroll', () => { if (document.body.dataset.pantalla !== 'portal' && (window.scrollX || window.scrollY)) window.scrollTo(0, 0); }, { passive: true });

// ------------------------------------------------------------------
// Escenario (previsualización): pieza | sombra | tapete
// ------------------------------------------------------------------
const escenario = $('canvasEscenario');
const ectx = escenario.getContext('2d');
const EW = 480, EH = 360;
let escenarioPedido = false;
let temporizadorCorte = null;

function redibujarEscenario() {
  if (escenarioPedido) return;
  escenarioPedido = true;
  requestAnimationFrame(() => { escenarioPedido = false; dibujarEscenario(); });
}

function cajaOcupadaMm() {
  // caja de lo dibujado (mm), a baja resolución
  const p = estado.proyecto;
  if (!p.capas.length && p.pieza.tipo === 'silueta') return null;
  const res = 2;
  const cv = componerPieza(p, res, { conEspejo: false });
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    if (d[(y * cv.width + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  return { x0: x0 / res, y0: y0 / res, w: (x1 - x0 + 1) / res, h: (y1 - y0 + 1) / res };
}

function dibujarEscenario() {
  const d = Math.min(2, window.devicePixelRatio || 1);
  if (escenario.width !== EW * d) { escenario.width = EW * d; escenario.height = EH * d; }
  ectx.setTransform(d, 0, 0, d, 0, 0);
  ectx.clearRect(0, 0, EW, EH);
  const p = estado.proyecto, pz = p.pieza;
  if (estado.vista === 'sombra') dibujarSombra(p);
  else if (estado.vista === 'tapete') dibujarTapete(p);
  else dibujarPieza(p);
  // miniatura de la pieza (tile)
  const mini = $('miniPieza'), mctx = mini.getContext('2d');
  mctx.clearRect(0, 0, 64, 64);
  mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, 64, 64);
  const esc = 56 / Math.max(pz.anchoMm, pz.altoMm);
  const comp = componerPieza(p, esc, { conEspejo: false });
  mctx.drawImage(comp, (64 - comp.width) / 2, (64 - comp.height) / 2);
  $('miniPiezaMedida').textContent = `${pz.anchoMm}×${pz.altoMm} mm`;
}

function flechaMedida(x1, y1, x2, y2, texto, vertical) {
  ectx.save();
  ectx.strokeStyle = '#FF8C1A'; ectx.fillStyle = '#FF8C1A'; ectx.lineWidth = 1.5;
  ectx.beginPath(); ectx.moveTo(x1, y1); ectx.lineTo(x2, y2); ectx.stroke();
  const cabeza = (x, y, dir) => { ectx.beginPath(); if (vertical) { ectx.moveTo(x, y); ectx.lineTo(x - 4, y - 7 * dir); ectx.lineTo(x + 4, y - 7 * dir); } else { ectx.moveTo(x, y); ectx.lineTo(x - 7 * dir, y - 4); ectx.lineTo(x - 7 * dir, y + 4); } ectx.closePath(); ectx.fill(); };
  cabeza(x1, y1, -1); cabeza(x2, y2, 1);
  ectx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif'; ectx.textAlign = 'center'; ectx.textBaseline = 'middle';
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ancho = ectx.measureText(texto).width + 8;
  ectx.fillStyle = '#fff';
  if (vertical) { ectx.save(); ectx.translate(mx, my); ectx.rotate(-Math.PI / 2); ectx.fillRect(-ancho / 2, -8, ancho, 16); ectx.fillStyle = '#DB6E00'; ectx.fillText(texto, 0, 0); ectx.restore(); }
  else { ectx.fillRect(mx - ancho / 2, my - 8, ancho, 16); ectx.fillStyle = '#DB6E00'; ectx.fillText(texto, mx, my); }
  ectx.restore();
}

function dibujarPieza(p) {
  const pz = p.pieza;
  // mesa
  const g = ectx.createLinearGradient(0, 0, 0, EH);
  g.addColorStop(0, '#f4f7fc'); g.addColorStop(1, '#dde7f5');
  ectx.fillStyle = g; ectx.fillRect(0, 0, EW, EH);
  const esc = Math.min((EW - 110) / pz.anchoMm, (EH - 90) / pz.altoMm);
  const w = pz.anchoMm * esc, h = pz.altoMm * esc;
  const x = (EW - w) / 2 + 20, y = (EH - h) / 2 + 12;
  ectx.save();
  ectx.shadowColor = 'rgba(44,26,74,0.25)'; ectx.shadowBlur = 16; ectx.shadowOffsetY = 6;
  ectx.fillStyle = '#fff'; ectx.fillRect(x, y, w, h);
  ectx.restore();
  ectx.strokeStyle = 'rgba(44,26,74,0.3)'; ectx.lineWidth = 1; ectx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  const comp = componerPieza(p, esc * 2, { conEspejo: true });
  ectx.imageSmoothingQuality = 'high';
  ectx.drawImage(comp, x, y, w, h);
  flechaMedida(x, y - 18, x + w, y - 18, `${pz.anchoMm} mm`, false);
  flechaMedida(x - 18, y, x - 18, y + h, `${pz.altoMm} mm`, true);
  if (pz.espejo) { ectx.fillStyle = '#3373CC'; ectx.font = 'bold 10px "Helvetica Neue", Arial, sans-serif'; ectx.textAlign = 'right'; ectx.fillText(t('ESPEJADA (vinilo termoadhesivo)'), x + w - 4, y + h + 12); }
  const caja = cajaOcupadaMm();
  if (caja) {
    ectx.save(); ectx.setLineDash([4, 3]); ectx.strokeStyle = 'rgba(76,151,255,0.7)'; ectx.lineWidth = 1;
    const cx = pz.espejo ? pz.anchoMm - caja.x0 - caja.w : caja.x0;
    ectx.strokeRect(x + cx * esc, y + caja.y0 * esc, caja.w * esc, caja.h * esc); ectx.restore();
    $('escenarioMedidas').innerHTML = `${t('Pieza')} <b>${pz.anchoMm} × ${pz.altoMm} mm</b> · ${t('dibujo')} <b>${redondear(caja.w, 0)} × ${redondear(caja.h, 0)} mm</b>`;
  } else {
    $('escenarioMedidas').innerHTML = `${t('Pieza')} <b>${pz.anchoMm} × ${pz.altoMm} mm</b> · ${t('todavía no hay nada dibujado')}`;
  }
  $('escenarioAvisos').innerHTML = '';
}

function dibujarSombra(p) {
  const pz = p.pieza;
  const lx = estado.luz.x * EW, ly = estado.luz.y * EH;
  const g = ectx.createRadialGradient(lx, ly, 10, lx, ly, Math.max(EW, EH) * 0.95);
  g.addColorStop(0, '#fff2c4'); g.addColorStop(0.45, '#e9b45a'); g.addColorStop(1, '#2d1a0c');
  ectx.fillStyle = g; ectx.fillRect(0, 0, EW, EH);
  // el foco
  ectx.save(); ectx.fillStyle = 'rgba(255,255,255,0.85)'; ectx.shadowColor = '#fff7d6'; ectx.shadowBlur = 30;
  ectx.beginPath(); ectx.arc(lx, ly, 9, 0, Math.PI * 2); ectx.fill(); ectx.restore();
  // la sombra: más grande cuanto más lejos de la luz, y corrida al lado opuesto
  const esc = Math.min((EW - 140) / pz.anchoMm, (EH - 110) / pz.altoMm);
  const comp = componerPieza(p, esc * 2, { conEspejo: false });
  const ox = (0.5 - estado.luz.x) * 140, oy = (0.5 - estado.luz.y) * 90;
  const dist = Math.hypot(estado.luz.x - 0.5, estado.luz.y - 0.5);
  const crecer = 1.1 + dist * 0.35;
  const w = pz.anchoMm * esc * crecer, h = pz.altoMm * esc * crecer;
  const x = (EW - w) / 2 + ox, y = (EH - h) / 2 + oy + 10;
  ectx.save();
  ectx.filter = 'blur(5px)'; ectx.globalAlpha = 0.5;
  ectx.drawImage(comp, x + ox * 0.12, y + oy * 0.12, w * 1.04, h * 1.04);
  ectx.filter = 'blur(1.2px)'; ectx.globalAlpha = 0.93;
  ectx.drawImage(comp, x, y, w, h);
  ectx.restore();
  ectx.fillStyle = 'rgba(255,255,255,0.8)'; ectx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif'; ectx.textAlign = 'left';
  ectx.fillText(t('Movés el mouse por acá y se mueve la luz 🔦'), 10, EH - 10);
  $('escenarioMedidas').innerHTML = `${t('Sombra proyectada de')} <b>${escapar(p.nombre || t('tu pieza'))}</b>`;
  $('escenarioAvisos').innerHTML = '';
}

function dibujarTapete(p) {
  const pz = p.pieza;
  ectx.fillStyle = '#e9edf3'; ectx.fillRect(0, 0, EW, EH);
  const lado = EH - 28;
  const esc = lado / MAT_MM;
  const x0 = (EW - lado) / 2, y0 = 14;
  // tapete verde tipo Cricut con grilla de 1 pulgada
  ectx.fillStyle = '#7fbf8f'; ectx.fillRect(x0, y0, lado, lado);
  ectx.strokeStyle = 'rgba(255,255,255,0.55)'; ectx.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    const pos = i * 25.4 * esc;
    ectx.beginPath(); ectx.moveTo(x0 + pos, y0); ectx.lineTo(x0 + pos, y0 + lado); ectx.stroke();
    ectx.beginPath(); ectx.moveTo(x0, y0 + pos); ectx.lineTo(x0 + lado, y0 + pos); ectx.stroke();
  }
  ectx.strokeStyle = '#3d7a4b'; ectx.lineWidth = 2; ectx.strokeRect(x0, y0, lado, lado);
  ectx.fillStyle = '#2b5a36'; ectx.font = 'bold 10px "Helvetica Neue", Arial, sans-serif'; ectx.textAlign = 'left';
  ectx.fillText(t('Tapete 12 × 12"'), x0 + 6, y0 + 12);
  // la pieza como la ve la cortadora (espejada si corresponde), en la esquina
  const m = MARGEN_MAT_MM * esc;
  const w = pz.anchoMm * esc, h = pz.altoMm * esc;
  ectx.fillStyle = 'rgba(255,255,255,0.7)'; ectx.fillRect(x0 + m, y0 + m, w, h);
  const comp = componerPieza(p, esc * 3, { conEspejo: true });
  ectx.drawImage(comp, x0 + m, y0 + m, w, h);
  ectx.strokeStyle = '#FF8C1A'; ectx.setLineDash([4, 3]); ectx.strokeRect(x0 + m, y0 + m, w, h); ectx.setLineDash([]);
  $('escenarioMedidas').innerHTML = `${t('Pieza')} <b>${pz.anchoMm} × ${pz.altoMm} mm</b> ${t('en el tapete')}${pz.espejo ? ' · <b>' + t('espejada') + '</b>' : ''} · ${t('calculando…')}`;
  // vectorizar (con retraso, es pesado) para medidas exactas y avisos
  clearTimeout(temporizadorCorte);
  temporizadorCorte = setTimeout(() => { mostrarAvisosCorte(); }, estado.corte ? 0 : 350);
}

function asegurarCorte() {
  if (!estado.corte) {
    estado.corte = vectorizarProyecto(estado.proyecto, { espejo: estado.proyecto.pieza.espejo, recortarCaja: estado.recortarSvg, margenMm: 0, detalleMinMm: estado.detalleMinMm });
  }
  return estado.corte;
}
function mostrarAvisosCorte() {
  if (estado.vista !== 'tapete') return;
  const r = asegurarCorte();
  const caja = cajaGlobal(r.piezas);
  const wMm = caja.w / r.pxPorMm, hMm = caja.h / r.pxPorMm;
  $('escenarioMedidas').innerHTML = r.piezas.length
    ? `${t('El corte mide')} <b>${redondear(wMm, 0)} × ${redondear(hMm, 0)} mm</b> · ${t(r.piezas.length === 1 ? '{n} pieza' : '{n} piezas', { n: r.piezas.length })}${estado.proyecto.pieza.espejo ? ' · <b>' + t('espejada') + '</b>' : ''}`
    : t('No hay nada para cortar todavía');
  const avisos = $('escenarioAvisos');
  avisos.innerHTML = r.avisos.length
    ? r.avisos.map(a => `<div class="aviso ${a.tipo === 'error' ? 'aviso--mal' : ''}">⚠ ${escapar(a.texto)}</div>`).join('')
    : `<div class="aviso aviso--ok">✔ ${t('¡Todo bien! Una sola pieza, sin detalles demasiado finos. Lista para cortar.')}</div>`;
}

escenario.addEventListener('pointermove', e => {
  if (estado.vista !== 'sombra') return;
  const r = escenario.getBoundingClientRect();
  estado.luz = { x: limitar((e.clientX - r.left) / r.width, 0, 1), y: limitar((e.clientY - r.top) / r.height, 0, 1) };
  redibujarEscenario();
});
escenario.addEventListener('pointerleave', () => { if (estado.vista === 'sombra') { estado.luz = { x: 0.5, y: 0.15 }; redibujarEscenario(); } });

function cambiarVista(v) {
  estado.vista = v;
  document.querySelectorAll('[data-vista]').forEach(b => b.classList.toggle('vista--activa', b.dataset.vista === v));
    if (v !== 'tapete') $('escenarioAvisos').innerHTML = '';
  redibujarEscenario();
}
document.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));
document.querySelectorAll('[data-tam]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tam]').forEach(x => x.classList.toggle('tam--activa', x === b));
  $('taller').classList.toggle('taller--escenario-grande', b.dataset.tam === 'grande');
  setTimeout(() => { redibujarLienzo(); redibujarEscenario(); }, 50);
}));

// ------------------------------------------------------------------
// Info de la capa + lista de capas (como los objetos de Scratch)
// ------------------------------------------------------------------
function seleccionar(id) {
  estado.sel = id;
  if (estado.gotero) terminarGotero();
  refrescarInfo(); refrescarCapas(); refrescarPaleta(); redibujarLienzo();
}

function refrescarInfo() {
  const info = $('infoCapa');
  const capa = capaSel();
  info.classList.toggle('info--sin-capa', !capa);
  info.classList.toggle('info--pieza', estado.sel === 'pieza');
  $('tilePieza').classList.toggle('pieza-tile--sel', estado.sel === 'pieza');
  if (!capa) {
    const n = $('infoNombre');
    if (document.activeElement !== n) n.value = estado.sel === 'pieza' ? t('La pieza: ajustala en el panel «Pieza»') : t('Ninguna capa seleccionada');
    n.disabled = true;
    return;
  }
  $('infoNombre').disabled = false;
  const poner = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  poner('infoNombre', capa.nombre);
  poner('infoX', redondear(capa.x)); poner('infoY', redondear(capa.y));
  poner('infoTam', redondear(cajaCapa(capa).w, 0)); poner('infoRot', Math.round(capa.rot || 0));
  $('infoVerSi').classList.toggle('info__toggle--activo', !!capa.visible);
  $('infoVerNo').classList.toggle('info__toggle--activo', !capa.visible);
  $('infoSuma').classList.toggle('info__toggle--activo', capa.modo !== 'restar');
  $('infoResta').classList.toggle('info__toggle--activo', capa.modo === 'restar');
}
$('infoNombre').addEventListener('input', e => { const c = capaSel(); if (c) { c.nombre = e.target.value; refrescarCapas(); guardarPronto(); } });
['infoX', 'infoY', 'infoRot'].forEach(id => $(id).addEventListener('change', e => {
  const c = capaSel(); if (!c) return;
  const v = parseFloat(e.target.value); if (Number.isNaN(v)) return;
  anotar();
  if (id === 'infoX') c.x = v; else if (id === 'infoY') c.y = v; else c.rot = v;
  cambio(false);
}));
$('infoTam').addEventListener('change', e => {
  const c = capaSel(); if (!c) return;
  const v = parseFloat(e.target.value); if (Number.isNaN(v) || v < 1) return;
  anotar();
  const caja = cajaCapa(c), s = v / caja.w;
  if (c.tipo === 'texto') c.tamMm = Math.max(3, c.tamMm * s); else { c.w = v; c.h = caja.h * s; }
  cambio(false);
});
$('infoVerSi').addEventListener('click', () => { const c = capaSel(); if (c) { anotar(); c.visible = true; cambio(true); } });
$('infoVerNo').addEventListener('click', () => { const c = capaSel(); if (c) { anotar(); c.visible = false; cambio(true); } });
$('infoSuma').addEventListener('click', () => { const c = capaSel(); if (c) { anotar(); c.modo = 'sumar'; cambio(true); } });
$('infoResta').addEventListener('click', () => { const c = capaSel(); if (c) { anotar(); c.modo = 'restar'; cambio(true); } });
$('tilePieza').addEventListener('click', () => { seleccionar('pieza'); irACategoria('pieza'); });

function refrescarCapas() {
  const lista = $('listaCapas');
  lista.innerHTML = '';
  const capas = estado.proyecto.capas;
  if (!capas.length) { lista.innerHTML = `<div class="capas__vacio">${t('Acá van a aparecer tus capas: cada imagen, texto o forma que agregues.')}</div>`; return; }
  for (let i = capas.length - 1; i >= 0; i--) {
    const c = capas[i];
    const tile = document.createElement('div');
    tile.className = 'capa-tile' + (c.id === estado.sel ? ' capa-tile--sel' : '') + (c.visible ? '' : ' capa-tile--oculta') + (c.modo === 'restar' ? ' capa-tile--resta' : '');
    tile.dataset.id = c.id; tile.title = c.nombre; tile.draggable = true;
    tile.innerHTML = `<button type="button" class="capa-tile__modo" data-accion="modo" title="${c.modo === 'restar' ? t('Resta (agujero). Clic para sumar') : t('Suma (figura). Clic para restar')}">${c.modo === 'restar' ? '−' : '+'}</button>
      <button type="button" class="capa-tile__borrar" data-accion="eliminar" title="${t('Eliminar')}">✕</button>
      <canvas width="104" height="104"></canvas><span>${ICONO_CAPA[c.tipo] || ''} ${escapar(c.nombre)}</span>`;
    lista.appendChild(tile);
    dibujarMiniatura(tile.querySelector('canvas'), c);
  }
}
function refrescarMiniaturas() {
  document.querySelectorAll('#listaCapas .capa-tile').forEach(tile => {
    const c = estado.proyecto.capas.find(x => x.id === tile.dataset.id);
    if (c) dibujarMiniatura(tile.querySelector('canvas'), c);
  });
}
function dibujarMiniatura(cv, capa) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const caja = cajaCapa(capa);
  const esc = 88 / Math.max(caja.w, caja.h, 1);
  const falso = { version: 1, nombre: '', capas: [Object.assign({}, capa, { x: caja.w / 2, y: caja.h / 2, rot: 0, visible: true })], pieza: { anchoMm: caja.w, altoMm: caja.h, tipo: 'silueta', base: {}, marco: {}, ventana: {}, espejo: false } };
  const comp = componerCapas(falso, esc, { colores: true, fotos: estado.mostrarFotos, colorSumar: '#111' });
  c.drawImage(comp, (cv.width - comp.width) / 2, (cv.height - comp.height) / 2);
}
$('listaCapas').addEventListener('click', e => {
  const tile = e.target.closest('.capa-tile'); if (!tile) return;
  const capa = estado.proyecto.capas.find(c => c.id === tile.dataset.id); if (!capa) return;
  const accion = e.target.closest('[data-accion]');
  if (!accion) { seleccionar(capa.id); return; }
  if (accion.dataset.accion === 'modo') { anotar(); capa.modo = capa.modo === 'restar' ? 'sumar' : 'restar'; seleccionar(capa.id); cambio(true); }
  if (accion.dataset.accion === 'eliminar') eliminar(capa);
});
// reordenar arrastrando las miniaturas
let tileArrastrado = null;
$('listaCapas').addEventListener('dragstart', e => { const t = e.target.closest('.capa-tile'); if (t) { tileArrastrado = t.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
$('listaCapas').addEventListener('dragover', e => { if (tileArrastrado) e.preventDefault(); });
$('listaCapas').addEventListener('drop', e => {
  e.preventDefault();
  const destino = e.target.closest('.capa-tile');
  if (!tileArrastrado || !destino || destino.dataset.id === tileArrastrado) { tileArrastrado = null; return; }
  anotar();
  const capas = estado.proyecto.capas;
  const de = idx(tileArrastrado), a = idx(destino.dataset.id);
  const [capa] = capas.splice(de, 1); capas.splice(a, 0, capa);
  tileArrastrado = null;
  cambio(true);
});
$('agregarCapa').querySelectorAll('[data-agregar]').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.agregar;
  if (t === 'imagen') pedirImagen(); else if (t === 'camara') abrirCamara(); else if (t === 'texto') agregarTexto(); else abrirFormas();
}));
$('agregarCapa').querySelector('.capas__agregar-btn').addEventListener('click', () => $('agregarCapa').classList.toggle('capas__agregar--abierto'));

// ------------------------------------------------------------------
// Acciones sobre capas
// ------------------------------------------------------------------
function agregarCapa(capa, punto) {
  anotar();
  const pz = estado.proyecto.pieza;
  if (punto) { capa.x = limitar(punto.x, 0, pz.anchoMm); capa.y = limitar(punto.y, 0, pz.altoMm); }
  estado.proyecto.capas.push(capa);
  estado.sel = capa.id;
  cambio(true);
}
function agregarTexto(texto, punto, fuente) {
  const pz = estado.proyecto.pieza;
  const n = estado.proyecto.capas.filter(c => c.tipo === 'texto').length + 1;
  const capa = nuevaCapa('texto', { nombre: `${t('Texto')} ${n}`, texto: texto || (estado.proyecto.autor ? estado.proyecto.autor.split(' ')[0].toUpperCase() : t('HOLA')), x: pz.anchoMm / 2, y: pz.altoMm / 2, tamMm: Math.max(8, Math.round(pz.anchoMm / 6)) });
  if (fuente) capa.fuente = fuente;
  cargarFuente(capa.fuente).then(() => { redibujarLienzo(); redibujarEscenario(); refrescarMiniaturas(); });
  agregarCapa(capa, punto);
  irACategoria('texto');
  const ta = document.querySelector('#paleta textarea[data-prop="texto"]');
  if (ta) { ta.focus({ preventScroll: true }); ta.select(); }
}
function agregarForma(forma, punto) {
  const pz = estado.proyecto.pieza;
  const lado = Math.round(Math.min(pz.anchoMm, pz.altoMm) * 0.4);
  const n = estado.proyecto.capas.filter(c => c.tipo === 'forma').length + 1;
  const nombreForma = t((FORMAS.find(f => f.id === forma) || {}).nombre || 'Forma');
  const capa = nuevaCapa('forma', { forma, nombre: `${nombreForma.split(' ')[0]} ${n}`, x: pz.anchoMm / 2, y: pz.altoMm / 2, w: lado, h: lado });
  if (forma === 'puente') { capa.w = Math.round(pz.anchoMm * 0.6); capa.h = 4; capa.nombre = `${t('Puente')} ${n}`; }
  if (forma === 'flecha') capa.h = Math.round(lado * 0.6);
  agregarCapa(capa, punto);
  irACategoria('formas');
}
function pedirImagen(reemplazarId) {
  $('inputImagen').dataset.reemplazar = reemplazarId || '';
  $('inputImagen').click();
}
$('inputImagen').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  const reemplazar = e.target.dataset.reemplazar || '';
  e.target.value = '';
  if (f) agregarImagen(f, reemplazar);
});
async function agregarImagen(archivo, reemplazarId) {
  try {
    toast(t('Leyendo la imagen…'));
    const { src, ancho, alto } = await leerArchivoImagen(archivo, 1400);
    await asegurarImagen(src);
    const pz = estado.proyecto.pieza;
    const existente = reemplazarId ? estado.proyecto.capas.find(c => c.id === reemplazarId) : null;
    if (existente) {
      anotar();
      existente.src = src; existente.ancho = ancho; existente.alto = alto;
      const s = Math.min(existente.w / ancho, existente.h / alto);
      existente.w = ancho * s; existente.h = alto * s;
      estado.sel = existente.id; cambio(true);
      return;
    }
    const s = Math.min((pz.anchoMm * 0.7) / ancho, (pz.altoMm * 0.7) / alto);
    const n = estado.proyecto.capas.filter(c => c.tipo === 'imagen').length + 1;
    const capa = nuevaCapa('imagen', { nombre: ((archivo && archivo.name) || `${t('Foto')} ${n}`).replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || `${t('Foto')} ${n}`, src, ancho, alto, x: pz.anchoMm / 2, y: pz.altoMm / 2, w: ancho * s, h: alto * s });
    let frac = fraccionFigura(capa);
    let aviso = t('¡Imagen agregada! Si quedó mal el fondo, ajustalo en el panel de la izquierda.');
    if (frac != null && frac < 0.01) { capa.proc.tolerancia = 18; frac = fraccionFigura(capa); }
    if (frac != null && (frac < 0.01 || frac > 0.97)) {
      capa.proc.fondo = 'ninguno';
      aviso = frac < 0.01 ? t('El fondo automático borraba toda la foto: la dejé entera. Usá el gotero sobre el fondo o «sólo lo oscuro».') : t('No encontré un fondo liso: la foto queda entera. Usá el gotero sobre el fondo o «sólo lo oscuro».');
    }
    const punto = estado.puntoSoltar; estado.puntoSoltar = null;
    agregarCapa(capa, punto);
    irACategoria('imagenes');
    toast(aviso, 4200);
  } catch (e) { toast(e.message || t('No se pudo cargar la imagen')); }
}
function duplicar(capa) {
  anotar();
  const copia = clonar(capa);
  copia.id = nuevaCapa(capa.tipo).id;
  copia.nombre = (capa.nombre || capa.tipo) + ' ' + t('copia');
  copia.x += 6; copia.y += 6;
  estado.proyecto.capas.splice(idx(capa.id) + 1, 0, copia);
  estado.sel = copia.id;
  cambio(true);
}
function eliminar(capa) {
  anotar();
  estado.proyecto.capas.splice(idx(capa.id), 1);
  if (estado.sel === capa.id) estado.sel = null;
  cambio(true);
}
function mover(capa, d) {
  const i = idx(capa.id), j = limitar(i + d, 0, estado.proyecto.capas.length - 1);
  if (i === j) return;
  anotar();
  estado.proyecto.capas.splice(i, 1); estado.proyecto.capas.splice(j, 0, capa);
  cambio(true);
}
function ajustarAPieza(capa) {
  const pz = estado.proyecto.pieza;
  const c = cajaCapa(capa);
  const s = Math.min((pz.anchoMm * 0.92) / c.w, (pz.altoMm * 0.92) / c.h);
  if (capa.tipo === 'texto') capa.tamMm = Math.max(3, capa.tamMm * s);
  else { capa.w = c.w * s; capa.h = c.h * s; }
  capa.x = pz.anchoMm / 2; capa.y = pz.altoMm / 2; capa.rot = 0;
}
function terminarGotero() {
  estado.gotero = false;
  zona.classList.remove('lienzo__zona--gotero');
  refrescarPaleta();
}

// ------------------------------------------------------------------
// Panel de elementos y ajustes (barra lateral)
//
// Como en un editor gráfico: galerías de elementos (fotos, textos, formas)
// que se hacen clic o se arrastran al lienzo, y los ajustes del elemento
// seleccionado como controles comunes.
// ------------------------------------------------------------------
const CATEGORIAS = [
  { id: 'imagenes', nombre: 'Imágenes', color: 'var(--cat-imagenes)', borde: 'var(--cat-imagenes-b)' },
  { id: 'texto', nombre: 'Texto', color: 'var(--cat-texto)', borde: 'var(--cat-texto-b)' },
  { id: 'formas', nombre: 'Formas', color: 'var(--cat-formas)', borde: 'var(--cat-formas-b)' },
  { id: 'editar', nombre: 'Ajustar', color: 'var(--cat-editar)', borde: 'var(--cat-editar-b)' },
  { id: 'pieza', nombre: 'Pieza', color: 'var(--cat-pieza)', borde: 'var(--cat-pieza-b)' },
  { id: 'cortar', nombre: 'Cortar', color: 'var(--cat-cortar)', borde: 'var(--cat-cortar-b)' }
];

// controles
const ctlNum = (prop, v, min, max, paso, unidad) => `<span class="ctl-num"><input type="number" data-prop="${prop}" value="${redondear(v, 1)}" min="${min}" max="${max}" step="${paso}">${unidad ? `<em>${unidad}</em>` : ''}</span>`;
const ctlRango = (prop, v, min, max, paso, unidad) => `<span class="ctl-rango"><input type="range" data-prop="${prop}" value="${v}" min="${min}" max="${max}" step="${paso}"><output>${v}${unidad || ''}</output></span>`;
const ctlCheck = (prop, v, texto) => `<label class="ctl-check"><input type="checkbox" data-prop="${prop}" ${v ? 'checked' : ''}><span>${texto}</span></label>`;
const ctlSelect = (prop, v, lista) => `<select class="ctl-select" data-prop="${prop}">${lista.map(o => `<option value="${o.id}" ${String(o.id) === String(v) ? 'selected' : ''}>${escapar(o.nombre)}</option>`).join('')}</select>`;

const seccion = (id, titulo, nota) => `<h3 class="panel__titulo" ${id ? `data-cat="${id}"` : ''}>${titulo}</h3>${nota ? `<p class="panel__nota">${nota}</p>` : ''}`;
const nota = texto => `<p class="panel__nota panel__nota--aviso">${texto}</p>`;
const grupo = (titulo, filas) => `<div class="ajustes"><div class="ajustes__titulo">${titulo}</div>${filas}</div>`;
const fila = (etiqueta, control, ayuda) => `<label class="ajuste"><span class="ajuste__et">${etiqueta}${ayuda ? `<small>${ayuda}</small>` : ''}</span>${control}</label>`;
const filaLibre = (etiqueta, contenido) => `<div class="ajuste"><span class="ajuste__et">${etiqueta}</span>${contenido}</div>`;

// un elemento de la galería: se hace clic (o se arrastra al lienzo)
function elemento(o) {
  const cat = CATEGORIAS.find(c => c.id === o.cat);
  const clases = ['elemento', o.grande ? 'elemento--grande' : '', o.activo ? 'elemento--activo' : '', o.clase || ''].filter(Boolean).join(' ');
  const visual = o.imagen ? `<img class="elemento__img" src="${o.imagen}" alt="">` : `<span class="elemento__icono" ${o.estilo ? `style="${o.estilo}"` : ''}>${o.icono || ''}</span>`;
  return `<button type="button" class="${clases}" style="--c:${cat.color};--cb:${cat.borde}" data-accion="${o.accion}" ${o.arrastre ? `data-arrastre='${JSON.stringify(o.arrastre)}'` : ''} ${o.titulo ? `title="${escapar(o.titulo)}"` : ''}>${visual}<span class="elemento__texto">${o.texto}</span></button>`;
}
// un botón de acción del panel de ajustes
const accionBtn = (accion, icono, texto, extra) => `<button type="button" class="accion ${extra && extra.clase || ''}" data-accion="${accion}" ${extra && extra.titulo ? `title="${escapar(extra.titulo)}"` : ''}><span class="accion__icono">${icono}</span><span>${texto}</span></button>`;

// icono de cada forma, dibujado con la forma real
const cacheIconos = new Map();
function iconoForma(id, color) {
  const clave = id + '|' + color;
  if (cacheIconos.has(clave)) return cacheIconos.get(clave);
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d'); c.fillStyle = color; c.translate(6, 6); c.scale(52, 52);
  if (id === 'puente') c.fillRect(0, 0.42, 1, 0.16);
  else c.fill(pathDeForma(id, { radio: 15, puntas: 5, grosor: 25, interior: 50 }), 'evenodd');
  const url = cv.toDataURL();
  cacheIconos.set(clave, url);
  return url;
}

function panelImagenes() {
  const capa = capaSel();
  const esImg = capa && capa.tipo === 'imagen';
  let html = seccion('imagenes', '🖼 ' + t('Imágenes'), t('Subí una foto o un dibujo: le sacamos el fondo y queda como silueta negra.'));
  html += `<div class="elementos elementos--2">`;
  html += elemento({ cat: 'imagenes', icono: '📁', texto: t('Subir imagen'), accion: 'imagen', arrastre: { tipo: 'imagen' }, grande: true, titulo: t('Elegí una foto o dibujo de tu computadora (también podés arrastrarla al lienzo o pegarla con Ctrl+V)') });
  html += elemento({ cat: 'imagenes', icono: '📷', texto: t('Sacar foto'), accion: 'camara', grande: true, titulo: t('Usa la cámara. Ideal para hacer tu propia silueta.') });
  html += `</div>`;
  if (!esImg) return html + nota(t('Seleccioná una imagen del lienzo para ajustar su fondo y su silueta.'));
  const p = capa.proc;
  const frac = fraccionFigura(capa);
  if (frac != null) {
    const pct = Math.round(frac * 100);
    let aviso = '';
    if (frac < 0.01) aviso = t('No quedó casi nada. Bajá la tolerancia, o elegí «no quitar nada» y «sólo lo oscuro».');
    else if (frac > 0.97) aviso = t('Quedó toda la foto como un bloque. Subí la tolerancia, usá el gotero sobre el fondo, o «sólo lo oscuro» si es un dibujo.');
    html += `<div class="panel__estado ${aviso ? 'panel__estado--mal' : 'panel__estado--ok'}">${t('<b>{pct} %</b> de la imagen queda como figura.', { pct })}${aviso ? ' ' + aviso : ''}</div>`;
  }
  let filas = fila(t('Fondo'), ctlSelect('proc.fondo', p.fondo, [{ id: 'auto', nombre: t('automático (desde los bordes)') }, { id: 'color', nombre: t('de un color que elijo') }, { id: 'ninguno', nombre: t('no quitar nada') }]));
  if (p.fondo !== 'ninguno') filas += fila(t('Tolerancia'), ctlRango('proc.tolerancia', p.tolerancia, 0, 160, 1), t('cuánto puede variar el color del fondo'));
  if (p.fondo === 'color') filas += filaLibre(t('Color'), `<span class="ctl-color"><button type="button" class="accion accion--chica ${estado.gotero ? 'accion--activa' : ''}" data-accion="gotero">💧 ${estado.gotero ? t('hacé clic en el fondo de la foto…') : t('elegir en la foto')}</button><span class="ctl-muestra" style="background:${p.colorClave ? `rgb(${p.colorClave.join(',')})` : 'transparent'}"></span></span>`);
  html += grupo(t('Quitar el fondo'), filas);
  filas = fila(t('La figura es'), ctlSelect('proc.silueta', p.silueta, [{ id: 'alfa', nombre: t('todo lo que quedó') }, { id: 'oscuro', nombre: t('sólo lo oscuro (dibujo a lápiz)') }, { id: 'claro', nombre: t('sólo lo claro') }]));
  if (p.silueta !== 'alfa') filas += fila(t('Umbral'), ctlRango('proc.umbral', p.umbral, 0, 255, 1));
  filas += filaLibre('', ctlCheck('proc.invertir', p.invertir, t('Invertir (negativo)')));
  filas += fila(t('Suavizar'), ctlRango('proc.suavizarMm', p.suavizarMm, 0, 3, 0.25, ' mm'), t('cierra grietas y redondea'));
  filas += fila(t('Engrosar / afinar'), ctlRango('proc.engrosarMm', p.engrosarMm, -3, 3, 0.25, ' mm'), t('+ engorda, − adelgaza'));
  filas += fila(t('Limpiar manchas'), ctlRango('proc.limpiarMm', p.limpiarMm, 0, 6, 0.5, ' mm'), t('borra pedacitos más chicos que esto'));
  filas += `<div class="acciones acciones--1">${accionBtn('reemplazar', '🔁', t('Cambiar la imagen'))}</div>`;
  html += grupo(t('Pasar a silueta'), filas);
  return html;
}

function panelTexto() {
  const capa = capaSel();
  const esTxt = capa && capa.tipo === 'texto';
  let html = seccion('texto', '🔤 ' + t('Texto'), t('Tu nombre, una palabra, un título. Doble clic en un texto del lienzo para editarlo.'));
  html += `<div class="elementos elementos--2">`;
  html += elemento({ cat: 'texto', icono: 'Aa', texto: t('Agregar texto'), accion: 'texto', arrastre: { tipo: 'texto' }, grande: true, estilo: 'font-family:Bangers' });
  html += elemento({ cat: 'texto', icono: '🙋', texto: t('Mi nombre'), accion: 'nombre', arrastre: { tipo: 'nombre' }, grande: true, titulo: t('Escribe tu nombre (el de arriba) como texto') });
  html += `</div>`;
  if (esTxt) {
    let filas = filaLibre(t('Dice'), `<textarea class="ctl-texto" data-prop="texto" rows="2">${escapar(capa.texto)}</textarea>`);
    filas += fila(t('Tamaño'), ctlNum('tamMm', capa.tamMm, 3, 300, 1, 'mm'));
    filas += fila(t('Alineación'), ctlSelect('alineacion', capa.alineacion, [{ id: 'left', nombre: t('izquierda') }, { id: 'center', nombre: t('centro') }, { id: 'right', nombre: t('derecha') }]));
    filas += filaLibre('', ctlCheck('negrita', capa.negrita, t('Negrita')));
    filas += fila(t('Entre letras'), ctlRango('interletra', capa.interletra, -10, 40, 1), t('juntarlas hace que queden unidas al cortar'));
    filas += fila(t('Entre líneas'), ctlRango('interlinea', capa.interlinea, 0.6, 2, 0.05));
    html += grupo(t('El texto'), filas);
  }
  html += seccion(null, t('Tipografías'), esTxt ? t('Tocá una para cambiar la fuente del texto seleccionado.') : t('Tocá una para agregar un texto con esa fuente. Las gordas salen mejor al cortar.'));
  html += `<div class="elementos elementos--fuentes">`;
  for (const f of FUENTES) {
    html += elemento({ cat: 'texto', icono: 'Aa', estilo: `font-family:'${f.id}'`, texto: f.nombre.replace(/\s*\(.*\)/, ''), accion: `fuente:${f.id}`, activo: esTxt && capa.fuente === f.id, titulo: t(f.nombre), clase: 'elemento--fuente' });
  }
  html += `</div>`;
  return html;
}

function panelFormas() {
  const capa = capaSel();
  const esForma = capa && capa.tipo === 'forma';
  let html = seccion('formas', '⭐ ' + t('Formas'), t('Tocá una forma o arrastrala al lienzo. En modo «− resta» hacen agujeros; el puente une piezas sueltas.'));
  html += `<div class="elementos elementos--3">`;
  for (const f of FORMAS) html += elemento({ cat: 'formas', imagen: iconoForma(f.id, '#2c1a4a'), texto: t(f.nombre).replace(/\s*\(.*\)/, ''), accion: `forma:${f.id}`, arrastre: { tipo: 'forma', forma: f.id }, titulo: t(f.nombre), activo: esForma && capa.forma === f.id });
  html += `</div>`;
  if (esForma) {
    const p = capa.params;
    let filas = '';
    if (capa.forma === 'estrella') { filas += fila(t('Puntas'), ctlRango('params.puntas', p.puntas, 3, 12, 1)); filas += fila(t('Radio interior'), ctlRango('params.interior', p.interior, 15, 90, 1, ' %')); }
    if (capa.forma === 'rectRedondo') filas += fila(t('Esquinas'), ctlRango('params.radio', p.radio, 0, 50, 1, ' %'));
    if (['anillo', 'flecha', 'luna'].includes(capa.forma)) filas += fila(t('Grosor'), ctlRango('params.grosor', p.grosor, 5, 90, 1, ' %'));
    filas += fila(t('Ancho'), ctlNum('w', capa.w, 1, 600, 0.5, 'mm')) + fila(t('Alto'), ctlNum('h', capa.h, 1, 600, 0.5, 'mm'));
    html += grupo(t('Esta forma'), filas);
  }
  return html;
}

function panelEditar() {
  const capa = capaSel();
  let html = seccion('editar', '🎛 ' + t('Ajustar'), t('Todo lo que le podés hacer al elemento seleccionado.'));
  if (!capa) return html + nota(t('Seleccioná un elemento en el lienzo (o en la lista de capas) para ajustarlo.'));
  html += `<div class="ajustes"><div class="ajustes__titulo">${ICONO_CAPA[capa.tipo] || ''} ${escapar(capa.nombre)}</div>
    <div class="modo">
      <button type="button" class="modo__btn modo__btn--suma ${capa.modo !== 'restar' ? 'modo__btn--activo' : ''}" data-accion="modo:sumar" title="${t('Lo negro se corta como figura')}">＋ ${t('Suma (figura)')}</button>
      <button type="button" class="modo__btn modo__btn--resta ${capa.modo === 'restar' ? 'modo__btn--activo' : ''}" data-accion="modo:restar" title="${t('Por el agujero pasa la luz')}">－ ${t('Resta (agujero)')}</button>
    </div>
    ${fila(t('Giro'), ctlRango('rot', Math.round(capa.rot || 0), -180, 180, 1, '°'))}
    <div class="ajuste ajuste--2">${fila('x', ctlNum('x', capa.x, -500, 500, 0.5, 'mm'))}${fila('y', ctlNum('y', capa.y, -500, 500, 0.5, 'mm'))}</div>
  </div>`;
  html += `<div class="acciones">
    ${accionBtn('centrar', '⌖', t('Centrar'))}
    ${accionBtn('ajustar', '⤢', t('Llenar la pieza'))}
    ${accionBtn('flipX', '⇋', t('Espejar'))}
    ${accionBtn('flipY', '⇅', t('Voltear'))}
    ${accionBtn('adelante', '⏫', t('Adelante'))}
    ${accionBtn('atras', '⏬', t('Atrás'))}
    ${accionBtn('duplicar', '⧉', t('Duplicar'))}
    ${accionBtn('visible', capa.visible ? '◌' : '👁', capa.visible ? t('Ocultar') : t('Mostrar'))}
    ${accionBtn('eliminar', '🗑', t('Eliminar'), { clase: 'accion--peligro' })}
  </div>`;
  return html;
}

function panelPieza() {
  const pz = estado.proyecto.pieza;
  const tipo = TIPOS_PIEZA.find(x => x.id === pz.tipo) || TIPOS_PIEZA[0];
  let html = seccion('pieza', '✂ ' + t('La pieza'), t('La hoja donde diseñás: es lo que se corta. Medidas reales, en milímetros.'));
  let filas = fila(t('Tamaño rápido'), ctlSelect('pieza.preset', `${pz.anchoMm}x${pz.altoMm}`, [{ id: '', nombre: t('— elegir —') }].concat(PRESETS_PIEZA.map(p => ({ id: `${p.w}x${p.h}`, nombre: t(p.nombre) })))));
  filas += `<div class="ajuste ajuste--2">${fila(t('Ancho'), ctlNum('pieza.anchoMm', pz.anchoMm, 10, 300, 1, 'mm'))}${fila(t('Alto'), ctlNum('pieza.altoMm', pz.altoMm, 10, 300, 1, 'mm'))}</div>`;
  filas += fila(t('Tipo de pieza'), ctlSelect('pieza.tipo', pz.tipo, TIPOS_PIEZA.map(x => ({ id: x.id, nombre: t(x.nombre) }))));
  filas += `<p class="panel__nota">${escapar(t(tipo.ayuda))}</p>`;
  if (pz.tipo === 'base') filas += `<div class="ajuste ajuste--2">${fila(t('Base: ancho'), ctlNum('pieza.base.anchoMm', pz.base.anchoMm, 5, 300, 1, 'mm'))}${fila(t('Base: alto'), ctlNum('pieza.base.altoMm', pz.base.altoMm, 3, 100, 1, 'mm'))}</div>`;
  if (pz.tipo === 'marco') filas += fila(t('Grosor del marco'), ctlNum('pieza.marco.grosorMm', pz.marco.grosorMm, 2, 60, 0.5, 'mm'));
  if (pz.tipo === 'ventana') filas += fila(t('Esquinas redondeadas'), ctlNum('pieza.ventana.radioMm', pz.ventana.radioMm, 0, 60, 1, 'mm'));
  filas += filaLibre('', ctlCheck('pieza.espejo', pz.espejo, t('Espejar para vinilo termoadhesivo')));
  html += grupo(t('Medidas y tipo'), filas);
  const b = pz.bordes;
  filas = filaLibre('', ctlCheck('pieza.bordes.activo', b.activo, t('Marco negro en los bordes de la pieza')));
  if (b.activo) {
    filas += fila(t('Grosor del marco'), ctlNum('pieza.bordes.grosorMm', b.grosorMm, 1, 60, 0.5, 'mm'));
    filas += `<div class="ajuste"><span class="ajuste__et">${t('Lados')}</span><div class="lados">${ctlCheck('pieza.bordes.arriba', b.arriba, t('arriba'))}${ctlCheck('pieza.bordes.abajo', b.abajo, t('abajo'))}${ctlCheck('pieza.bordes.izquierda', b.izquierda, t('izquierda'))}${ctlCheck('pieza.bordes.derecha', b.derecha, t('derecha'))}</div></div>`;
    filas += `<p class="panel__nota">${t('El marco se corta junto con el diseño: lo que lo toca queda unido en una sola pieza.')}</p>`;
  }
  html += grupo(t('Marco'), filas);
  return html;
}

function panelCortar() {
  let html = seccion('cortar', '⬇ ' + t('Cortar y guardar'), t('El SVG se carga en Cricut Design Space (Upload → Insert → Make It) o en la láser.'));
  let filas = fila(t('Detalle mínimo'), ctlSelect('global.detalleMinMm', estado.detalleMinMm, [{ id: 1, nombre: t('1 mm (láser, cartulina)') }, { id: 1.5, nombre: t('1,5 mm (vinilo)') }, { id: 2.5, nombre: t('2,5 mm (vinilo termoadhesivo)') }]));
  filas += filaLibre('', ctlCheck('global.recortarSvg', estado.recortarSvg, t('Recortar el SVG al dibujo (sin el borde de la hoja)')));
  html += grupo(t('Para la cortadora'), filas);
  const nAuto = estado.proyecto.capas.filter(c => c.auto === 'union').length;
  filas = `<p class="panel__nota">${t('Busca las piezas sueltas (y las que quedarían dentro de un agujero) y las conecta con puentes finos por el camino más corto, para que todo salga calado en una sola pieza sin que se caiga nada. Las uniones son capas: podés moverlas o borrarlas.')}</p>`;
  filas += fila(t('Grosor de las uniones'), ctlNum('global.puenteMm', estado.puenteMm, 1, 20, 0.5, 'mm'));
  filas += `<div class="acciones acciones--1">${accionBtn('unir', '🔗', t('Unir todas las piezas'), { clase: 'accion--primaria' })}${nAuto ? accionBtn('quitarUniones', '✂', t('Quitar las {n} uniones automáticas', { n: nAuto })) : ''}</div>`;
  html += grupo(t('Unir las piezas'), filas);
  html += `<div class="acciones acciones--1">
    ${accionBtn('vista:tapete', '▦', t('Revisar en el tapete'), { titulo: t('Muestra la pieza como la ve la cortadora y avisa si hay piezas sueltas o detalles muy finos') })}
    ${accionBtn('svg', '✂', t('Descargar SVG para cortar'), { clase: 'accion--primaria' })}
    ${accionBtn('png', '🖼', t('Descargar PNG (imagen)'))}
    ${accionBtn('copiarSvg', '📋', t('Copiar el SVG'))}
  </div>`;
  html += seccion(null, t('Proyecto'), t('Se guarda solo en este navegador. Para seguir en otra compu o mandárselo al docente, bajá el .json.'));
  html += `<div class="acciones acciones--1">
    ${accionBtn('guardar', '💾', t('Guardar en mi computadora (.json)'))}
    ${accionBtn('abrir', '📂', t('Abrir un proyecto (.json)'))}
    ${accionBtn('nuevo', '✨', t('Empezar de nuevo'), { clase: 'accion--peligro' })}
  </div>`;
  return html;
}

function refrescarPaleta() {
  const paleta = $('paleta');
  const scroll = paleta.scrollTop;
  paleta.innerHTML = [panelImagenes(), panelTexto(), panelFormas(), panelEditar(), panelPieza(), panelCortar()].join('<div class="panel__separador"></div>');
  paleta.scrollTop = scroll;
  actualizarCategoriaActiva();
}

function armarCategorias() {
  $('categorias').innerHTML = CATEGORIAS.map(c => `<button type="button" class="categoria" data-cat="${c.id}"><span class="categoria__punto" style="background:${c.color};border-color:${c.borde}"></span>${t(c.nombre)}</button>`).join('');
  $('categorias').querySelectorAll('.categoria').forEach(b => b.addEventListener('click', () => irACategoria(b.dataset.cat)));
}
function irACategoria(id) {
  const paleta = $('paleta');
  const h = paleta.querySelector(`[data-cat="${id}"]`);
  if (h) paleta.scrollTo({ top: Math.max(0, h.offsetTop - 8), behavior: 'smooth' });
  $('categorias').querySelectorAll('.categoria').forEach(b => b.classList.toggle('categoria--activa', b.dataset.cat === id));
}
function actualizarCategoriaActiva() {
  const paleta = $('paleta');
  const titulos = Array.from(paleta.querySelectorAll('[data-cat]'));
  let activa = titulos[0] && titulos[0].dataset.cat;
  for (const h of titulos) if (h.offsetTop - paleta.scrollTop <= 40) activa = h.dataset.cat;
  $('categorias').querySelectorAll('.categoria').forEach(b => b.classList.toggle('categoria--activa', b.dataset.cat === activa));
}
$('paleta').addEventListener('scroll', actualizarCategoriaActiva, { passive: true });

// --- cambios en los controles
function aplicarProp(input, esFinal) {
  const prop = input.dataset.prop;
  let v = leerValor(input);
  if (input.type !== 'checkbox' && input.type !== 'text' && input.tagName !== 'TEXTAREA' && input.tagName !== 'SELECT' && Number.isNaN(v)) return;
  if (input.type === 'range') { const out = input.parentElement.querySelector('output'); if (out) out.textContent = v + (/Mm$/.test(prop) ? ' mm' : /interior|radio|grosor/.test(prop) ? ' %' : prop === 'rot' ? '°' : ''); }

  if (prop.startsWith('global.')) {
    const k = prop.slice(7);
    if (k === 'detalleMinMm') estado.detalleMinMm = parseFloat(v); else estado[k] = v;
    estado.corte = null;
    if (estado.vista === 'tapete') redibujarEscenario();
    return;
  }
  if (prop.startsWith('pieza.')) {
    const k = prop.slice(6);
    if (!esFinal) return;
    if (k === 'preset') { if (!v) return; const [w, h] = v.split('x').map(Number); anotar(); estado.proyecto.pieza.anchoMm = w; estado.proyecto.pieza.altoMm = h; cambio(true); return; }
    anotar();
    if (k === 'anchoMm' || k === 'altoMm') v = limitar(v || 10, 10, 300);
    asignar(estado.proyecto.pieza, k, v);
    cambio(true);
    return;
  }
  const capa = capaSel();
  if (!capa) return;
  if (!input._anotado) { anotar(); input._anotado = true; }
  asignar(capa, prop, v);
  if (prop === 'fuente') cargarFuente(v).then(() => cambio(false));
  const reconstruir = esFinal && ['proc.fondo', 'proc.silueta', 'forma'].includes(prop);
  cambio(reconstruir);
  if (esFinal) input._anotado = false;
}
$('paleta').addEventListener('input', e => { const i = e.target.closest('[data-prop]'); if (i && i.type !== 'checkbox' && i.tagName !== 'SELECT') aplicarProp(i, false); });
$('paleta').addEventListener('change', e => { const i = e.target.closest('[data-prop]'); if (i) aplicarProp(i, true); });

// --- clic en un elemento o acción
$('paleta').addEventListener('click', e => {
  if (e.target.closest('input, select, textarea, output')) return;
  const el = e.target.closest('[data-accion]');
  if (!el || el._arrastrado) return;
  el.classList.add('accion--pulsada');
  setTimeout(() => el.classList.remove('accion--pulsada'), 250);
  ejecutar(el.dataset.accion);
});

function ejecutar(accion) {
  const capa = capaSel();
  const [nombre, arg] = accion.split(':');
  switch (nombre) {
    case 'imagen': pedirImagen(); break;
    case 'camara': abrirCamara(); break;
    case 'reemplazar': if (capa) pedirImagen(capa.id); break;
    case 'gotero':
      if (!capa || capa.tipo !== 'imagen') return;
      estado.gotero = !estado.gotero;
      zona.classList.toggle('lienzo__zona--gotero', estado.gotero);
      toast(estado.gotero ? t('Ahora hacé clic sobre el fondo de la foto, en el lienzo') : t('Gotero cancelado'));
      refrescarPaleta();
      break;
    case 'texto': agregarTexto(); break;
    case 'nombre': agregarTexto((estado.proyecto.autor || prompt(t('¿Cómo te llamás?')) || t('YO')).toUpperCase()); break;
    case 'fuente':
      if (capa && capa.tipo === 'texto') { anotar(); capa.fuente = arg; cargarFuente(arg).then(() => cambio(true)); cambio(true); }
      else agregarTexto(null, null, arg);
      break;
    case 'forma': agregarForma(arg); break;
    case 'modo': if (capa) { anotar(); capa.modo = arg; cambio(true); } break;
    case 'centrar': if (capa) { anotar(); capa.x = estado.proyecto.pieza.anchoMm / 2; capa.y = estado.proyecto.pieza.altoMm / 2; cambio(true); } break;
    case 'ajustar': if (capa) { anotar(); ajustarAPieza(capa); cambio(true); } break;
    case 'flipX': if (capa) { anotar(); capa.flipX = !capa.flipX; cambio(false); } break;
    case 'flipY': if (capa) { anotar(); capa.flipY = !capa.flipY; cambio(false); } break;
    case 'adelante': if (capa) mover(capa, 1); break;
    case 'atras': if (capa) mover(capa, -1); break;
    case 'duplicar': if (capa) duplicar(capa); break;
    case 'visible': if (capa) { anotar(); capa.visible = !capa.visible; cambio(true); } break;
    case 'eliminar': if (capa) eliminar(capa); break;
    case 'deshacer': deshacer(); break;
    case 'rehacer': rehacer(); break;
    case 'vista': cambiarVista(arg); break;
    case 'unir': unirPiezas(); break;
    case 'quitarUniones': quitarUniones(); break;
    case 'svg': descargarSvg(); break;
    case 'png': descargarPng(); break;
    case 'copiarSvg': copiarSvg(); break;
    case 'guardar': guardarJson(); break;
    case 'abrir': $('inputJson').click(); break;
    case 'nuevo': nuevo(); break;
  }
}

// --- arrastrar elementos al lienzo
// (sin el arrastre nativo del navegador: los iconos son imágenes y, si no,
// el navegador arrastra la imagen y la suelta como archivo en el lienzo)
$('paleta').addEventListener('dragstart', e => e.preventDefault());
let arrastreElemento = null;
$('paleta').addEventListener('pointerdown', e => {
  if (e.target.closest('input, select, textarea')) return;
  const el = e.target.closest('[data-arrastre]');
  if (!el) return;
  arrastreElemento = { el, x0: e.clientX, y0: e.clientY, fantasma: null, datos: JSON.parse(el.dataset.arrastre) };
  el._arrastrado = false;
});
document.addEventListener('pointermove', e => {
  const a = arrastreElemento; if (!a) return;
  if (!a.fantasma) {
    if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 8) return;
    a.fantasma = a.el.cloneNode(true);
    a.fantasma.classList.add('elemento-fantasma');
    a.fantasma.style.width = a.el.offsetWidth + 'px';
    document.body.appendChild(a.fantasma);
    a.el._arrastrado = true;
  }
  a.fantasma.style.left = (e.clientX - a.el.offsetWidth / 2) + 'px';
  a.fantasma.style.top = (e.clientY - 24) + 'px';
  const r = zona.getBoundingClientRect();
  zona.classList.toggle('lienzo__zona--soltar', e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
});
document.addEventListener('pointerup', e => {
  const a = arrastreElemento; if (!a) return;
  arrastreElemento = null;
  zona.classList.remove('lienzo__zona--soltar');
  if (!a.fantasma) return;
  a.fantasma.remove();
  setTimeout(() => { a.el._arrastrado = false; }, 0);
  const r = zona.getBoundingClientRect();
  if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) return;
  const punto = aMm(e.clientX - r.left, e.clientY - r.top);
  const d = a.datos;
  if (d.tipo === 'forma') agregarForma(d.forma, punto);
  else if (d.tipo === 'texto') agregarTexto(null, punto);
  else if (d.tipo === 'nombre') agregarTexto((estado.proyecto.autor || prompt(t('¿Cómo te llamás?')) || t('YO')).toUpperCase(), punto);
  else if (d.tipo === 'imagen') { estado.puntoSoltar = punto; pedirImagen(); }
});

// ------------------------------------------------------------------
// Unir las piezas sueltas con puentes (árbol de expansión mínima entre los
// contornos vectorizados: cada unión va del punto más cercano de una pieza
// al de otra, con solapamiento para que queden bien pegadas).
// ------------------------------------------------------------------
function unirPiezas() {
  const p = estado.proyecto;
  if (!p.capas.length && p.pieza.tipo === 'silueta') { toast(t('Todavía no hay nada para unir')); return; }
  toast(t('Buscando las piezas sueltas…'));
  const r = vectorizarProyecto(p, { espejo: false, recortarCaja: false, detalleMinMm: estado.detalleMinMm, pxPorMm: 3 });
  const piezas = r.piezas;
  if (piezas.length < 2) { toast(t('¡Ya es una sola pieza! No hace falta unir nada.')); cambiarVista('tapete'); return; }
  const esc = 1 / r.pxPorMm;
  // contornos (exterior + agujeros) en mm, muestreados
  const contornos = piezas.map(pz => {
    const todos = [pz.pts].concat(pz.agujeros || []).flat();
    const paso = Math.max(1, Math.floor(todos.length / 320));
    const out = [];
    for (let i = 0; i < todos.length; i += paso) out.push([todos[i][0] * esc, todos[i][1] * esc]);
    return out;
  });
  const masCercanos = (A, B) => {
    let mejor = { d: Infinity, a: null, b: null };
    for (const a of A) for (const b of B) {
      const d = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
      if (d < mejor.d) mejor = { d, a, b };
    }
    mejor.d = Math.sqrt(mejor.d);
    return mejor;
  };
  const aristas = [];
  for (let i = 0; i < piezas.length; i++) for (let j = i + 1; j < piezas.length; j++) aristas.push(Object.assign({ i, j }, masCercanos(contornos[i], contornos[j])));
  aristas.sort((u, v) => u.d - v.d);
  // Kruskal
  const padre = piezas.map((_, i) => i);
  const raiz = i => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  const uniones = [];
  for (const e of aristas) {
    const ri = raiz(e.i), rj = raiz(e.j);
    if (ri === rj) continue;
    padre[ri] = rj;
    uniones.push(e);
    if (uniones.length === piezas.length - 1) break;
  }
  anotar();
  const g = estado.puenteMm;
  const n0 = p.capas.filter(c => c.auto === 'union').length;
  uniones.forEach((u, k) => {
    const dx = u.b[0] - u.a[0], dy = u.b[1] - u.a[1];
    const capa = nuevaCapa('forma', {
      forma: 'puente', nombre: `${t('Unión')} ${n0 + k + 1}`, modo: 'sumar', auto: 'union',
      x: (u.a[0] + u.b[0]) / 2, y: (u.a[1] + u.b[1]) / 2,
      w: Math.max(g, u.d + 2 * g), h: g, rot: Math.round(Math.atan2(dy, dx) * 180 / Math.PI)
    });
    p.capas.push(capa);
  });
  estado.sel = null;
  cambio(true);
  cambiarVista('tapete');
  toast(t('Listo: agregué {n} uniones y ahora todo es una sola pieza. Si alguna molesta, movela o borrala.', { n: uniones.length }), 6000);
}
function quitarUniones() {
  const p = estado.proyecto;
  const n = p.capas.filter(c => c.auto === 'union').length;
  if (!n) return;
  anotar();
  p.capas = p.capas.filter(c => c.auto !== 'union');
  if (estado.sel && !capaSel()) estado.sel = null;
  cambio(true);
  toast(t('Quité {n} uniones automáticas', { n }));
}

// ------------------------------------------------------------------
// Elegir forma (modal, desde el botón + de capas)
// ------------------------------------------------------------------
function abrirFormas() {
  const g = $('formasGrilla');
  g.innerHTML = FORMAS.map(f => {
    const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
    const c = cv.getContext('2d'); c.fillStyle = '#389438'; c.scale(44, 44); c.translate(0.045, 0.045);
    if (f.id === 'puente') { c.fillRect(0, 0.42, 1, 0.16); } else c.fill(pathDeForma(f.id, { radio: 15, puntas: 5, grosor: 25, interior: 50 }), 'evenodd');
    return `<button type="button" class="forma-btn" data-forma="${f.id}"><img src="${cv.toDataURL()}" width="48" height="48" alt="">${escapar(t(f.nombre))}</button>`;
  }).join('');
  g.querySelectorAll('[data-forma]').forEach(b => b.addEventListener('click', () => { cerrarModal($('modalFormas')); agregarForma(b.dataset.forma); }));
  abrirModal($('modalFormas'));
}

// ------------------------------------------------------------------
// Cámara
// ------------------------------------------------------------------
let camaraStream = null, camaraFrente = true;
async function abrirCamara() {
  const modal = $('modalCamara');
  $('camaraError').hidden = true;
  abrirModal(modal);
  await encenderCamara();
}
async function encenderCamara() {
  apagarCamara();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(t('Este navegador no permite usar la cámara.'));
    camaraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camaraFrente ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    $('camaraVideo').srcObject = camaraStream;
  } catch (e) {
    $('camaraError').textContent = t('No pude abrir la cámara: {motivo}. Fijate que el navegador tenga permiso, o subí una foto desde un archivo.', { motivo: e.message || e.name });
    $('camaraError').hidden = false;
  }
}
function apagarCamara() {
  if (camaraStream) { camaraStream.getTracks().forEach(t => t.stop()); camaraStream = null; }
  $('camaraVideo').srcObject = null;
}
$('btnCambiarCamara').addEventListener('click', () => { camaraFrente = !camaraFrente; encenderCamara(); });
$('btnCapturar').addEventListener('click', () => {
  const v = $('camaraVideo');
  if (!v.videoWidth) { toast(t('La cámara todavía no arrancó')); return; }
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
  const c = cv.getContext('2d');
  if (camaraFrente) { c.translate(cv.width, 0); c.scale(-1, 1); }   // como en un espejo
  c.drawImage(v, 0, 0);
  cv.toBlob(blob => {
    cerrarModal($('modalCamara'));
    const n = estado.proyecto.capas.filter(x => x.tipo === 'imagen').length + 1;
    agregarImagen(new File([blob], `${t('Foto')} ${n}.jpg`, { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.92);
});

// ------------------------------------------------------------------
// Modales
// ------------------------------------------------------------------
function abrirModal(m) { m.hidden = false; }
function cerrarModal(m) { m.hidden = true; if (m.id === 'modalCamara') apagarCamara(); }
document.querySelectorAll('.modal').forEach(m => {
  m.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', () => cerrarModal(m)));
  m.addEventListener('click', e => { if (e.target === m) cerrarModal(m); });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(cerrarModal); });

// ------------------------------------------------------------------
// Archivo: nuevo, abrir, guardar, descargar
// ------------------------------------------------------------------
function nuevo() {
  if (estado.proyecto.capas.length && !confirm(t('¿Empezar un proyecto nuevo? El de ahora queda guardado en este navegador (y en la clase, si estás en una).'))) return;
  const autor = estado.proyecto.autor, aula = estado.proyecto.aula;
  cargarProyecto(nuevoProyecto({ autor, aula, nombre: t('Mi sombra') }));
  guardarPronto();
  toast(t('Proyecto nuevo. ¡A diseñar!'));
}
function cargarProyecto(p) {
  estado.proyecto = p;
  estado.historial.length = 0; estado.futuro.length = 0;
  estado.sel = null; estado.zoom = 1; estado.pan = { x: 0, y: 0 }; estado.corte = null;
  if (estado.gotero) terminarGotero();
  $('nombreProyecto').value = p.nombre || '';
  $('autorProyecto').value = p.autor || '';
  cambiarVista('pieza');
  refrescarTodo();
}
function refrescarTodo() {
  refrescarInfo(); refrescarCapas(); refrescarPaleta();
  redibujarLienzo(); redibujarEscenario();
}
function guardarJson() {
  guardarAhora();
  descargar(JSON.stringify(estado.proyecto), nombreArchivo(estado.proyecto) + '.sombra.json', 'application/json');
  toast(t('Proyecto guardado en tu computadora. Con ese archivo podés seguir en cualquier otra compu.'), 4000);
}
$('inputJson').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const datos = JSON.parse(await f.text());
    const p = normalizarProyecto(datos.proyecto || datos);
    await prepararProyecto(p);
    if (editor.alAbrirArchivo) editor.alAbrirArchivo(p);
    cargarProyecto(p);
    guardarPronto();
    toast(t('Proyecto abierto: {nombre}', { nombre: p.nombre || f.name }));
  } catch (err) { toast(t('Ese archivo no es un proyecto válido (.json)')); }
});
function descargarSvg() {
  if (!estado.proyecto.capas.length && estado.proyecto.pieza.tipo === 'silueta') { toast(t('Todavía no hay nada para cortar: agregá una imagen, un texto o una forma')); return; }
  const r = asegurarCorte();
  descargar(r.svg, nombreArchivo(estado.proyecto) + '.svg', 'image/svg+xml');
  cambiarVista('tapete');
  toast(t('SVG descargado. Cargalo en Cricut Design Space → Upload → Insert → Make It'), 4500);
}
function descargarPng() {
  descargar(dataUrlABlob(pngDeProyecto(estado.proyecto, 8, true)), nombreArchivo(estado.proyecto) + '.png');
  toast(t('PNG descargado (negro sobre blanco)'));
}
async function copiarSvg() {
  try { await navigator.clipboard.writeText(asegurarCorte().svg); toast(t('SVG copiado al portapapeles')); }
  catch (e) { toast(t('No se pudo copiar; descargalo con el otro botón')); }
}

// menú superior
document.querySelectorAll('.menu__item--desplegable').forEach(item => {
  const btn = item.querySelector('.menu__boton');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const abierto = item.classList.contains('menu__item--abierto');
    document.querySelectorAll('.menu__item--abierto').forEach(x => x.classList.remove('menu__item--abierto'));
    item.classList.toggle('menu__item--abierto', !abierto);
    btn.setAttribute('aria-expanded', String(!abierto));
  });
});
document.addEventListener('click', () => document.querySelectorAll('.menu__item--abierto').forEach(x => x.classList.remove('menu__item--abierto')));
document.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.menu;
  const capa = capaSel();
  if (k === 'nuevo') nuevo(); else if (k === 'abrir') $('inputJson').click(); else if (k === 'guardar') guardarJson();
  else if (k === 'svg') descargarSvg(); else if (k === 'png') descargarPng();
  else if (k === 'deshacer') deshacer(); else if (k === 'rehacer') rehacer();
  else if (k === 'tutorial') abrirModal($('modalAyuda'));
  else if (k === 'duplicar') { if (capa) duplicar(capa); else toast(t('Seleccioná una capa primero')); }
  else if (k === 'eliminar') { if (capa) eliminar(capa); else toast(t('Seleccioná una capa primero')); }
}));
$('btnDescargarSvg').addEventListener('click', descargarSvg);
$('btnGuardarJson').addEventListener('click', guardarJson);
$('btnDeshacer').addEventListener('click', deshacer);
$('btnRehacer').addEventListener('click', rehacer);
$('chkFotos').addEventListener('change', e => { estado.mostrarFotos = e.target.checked; redibujarLienzo(); refrescarMiniaturas(); });
$('nombreProyecto').addEventListener('input', e => { estado.proyecto.nombre = e.target.value; guardarPronto(); });
$('autorProyecto').addEventListener('input', e => { estado.proyecto.autor = e.target.value; guardarPronto(); });

// ------------------------------------------------------------------
// API para clase.js (portal, clases y sincronización)
// ------------------------------------------------------------------
export const editor = {
  alCambiar: null,          // (proyecto) → guardar donde corresponda
  alAbrirArchivo: null,     // (proyecto) → al abrir un .json
  cargar: cargarProyecto,
  actual: () => estado.proyecto,
  nuevo: datos => { cargarProyecto(nuevoProyecto(Object.assign({ nombre: t('Mi sombra') }, datos || {}))); guardarPronto(); },
  refrescarTodo,
  guardarAhora,
  estadoGuardado,
  toast,
  abrirTutorial: () => abrirModal($('modalAyuda')),
  // configuración de pieza mandada por el docente: se aplica sin tocar las capas
  aplicarConfig(config) {
    if (!config || !config.pieza) return false;
    if (config.enviada && estado.proyecto.configAplicada === config.enviada) return false;
    anotar();
    aplicarConfigPieza(estado.proyecto, config.pieza);
    estado.proyecto.configAplicada = config.enviada || Date.now();
    cambio(true);
    return true;
  },
  bloquearAutor(si) { $('autorProyecto').readOnly = !!si; $('autorProyecto').classList.toggle('menu__nombre--fijo', !!si); }
};

// ------------------------------------------------------------------
// Arranque
// ------------------------------------------------------------------
window.shadowcasters = { estado };   // para mirar el estado desde la consola
armarCategorias();
$('nombreProyecto').value = estado.proyecto.nombre;
refrescarTodo();
alCambiarIdioma(() => { armarCategorias(); refrescarTodo(); });
if (document.fonts) document.fonts.ready.then(() => { redibujarLienzo(); redibujarEscenario(); refrescarMiniaturas(); });
