// Shadow Casters — portal de entrada, clases y sincronización.
//
// Tres formas de usar el taller:
//   · estudiante: entra con el código de la clase y su nombre; su diseño se
//     guarda en este navegador y viaja en vivo al panel del docente. Si la
//     clase está cerrada, sigue trabajando y se sincroniza cuando vuelva.
//   · docente: crea clases (varias a la vez), ve los diseños de todos en
//     tiempo real, los abre para retocar y descarga los SVG.
//   · por mi cuenta: sin clase; se guarda en este navegador y en .json.
//
// El editor vive en app.js; la red y el almacenamiento en aula.js.

import { editor } from './app.js';
import { almacen, nuevaAula, hospedarAula, entrarAula, normalizarCodigo, claveNombre } from './aula.js';
import { t, establecerIdioma, idiomaGuardado, alCambiarIdioma, fecha, hora } from './i18n.js';
import { nuevoProyecto, normalizarProyecto, prepararProyecto, miniaturaDeProyecto, vectorizarProyecto, nombreArchivo, TIPOS_PIEZA } from './render.js';
import { svgTapete } from './vector.js';

const $ = id => document.getElementById(id);
const CLAVE_ACTUAL = 'shadowcasters.actual';
const MAT_MM = 304.8;

const estado = {
  modo: 'portal',        // portal | solo | estudiante | docente | docente-editando
  cliente: null,         // conexión del estudiante a la clase
  hosts: new Map(),      // código → clase hospedada (el docente puede tener varias)
  claseActiva: null,     // código de la clase que se ve en el panel
  editando: null,        // { codigo, clave } cuando el docente retoca un diseño
  seleccion: new Map(),  // código → Set(claves) marcadas para el tapete
  temporizadorEnvio: null,
  versionNueva: null     // proyecto que mandó el estudiante mientras el docente lo editaba
};

// ------------------------------------------------------------------
// utilidades
// ------------------------------------------------------------------
const toast = (m, ms) => editor.toast(m, ms);
function escapar(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function descargar(contenido, nombre, tipo) {
  const blob = new Blob([contenido], { type: tipo || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}
function enlaceClase(codigo) { const u = new URL(location.href); u.search = ''; u.hash = ''; return `${u.href}?clase=${codigo}`; }
function pildora(el, clase, texto) { el.className = 'pildora' + (clase ? ' pildora--' + clase : ''); el.textContent = texto; }
function recordarActual(id) { try { localStorage.setItem(CLAVE_ACTUAL, id); } catch (_) { /* sin memoria */ } }

function mostrar(pantalla) {
  $('portal').hidden = pantalla !== 'portal';
  $('taller').hidden = pantalla !== 'taller';
  $('panelDocente').hidden = pantalla !== 'docente';
  document.body.dataset.pantalla = pantalla;
  document.body.dataset.modo = estado.modo;
  $('menuClase').hidden = !(estado.modo === 'estudiante' || estado.modo === 'docente-editando');
  $('btnVolverPanel').hidden = estado.modo !== 'docente-editando';
  window.scrollTo(0, 0);
  if (pantalla === 'taller') editor.refrescarTodo();
}

// ------------------------------------------------------------------
// Guardar: cada cambio del editor se guarda en este navegador y, según el
// modo, viaja a la clase.
// ------------------------------------------------------------------
editor.alCambiar = async proyecto => {
  try {
    await almacen.guardarProyecto(Object.assign({}, proyecto, { miniatura: miniaturaDeProyecto(proyecto, 160) }));
    recordarActual(proyecto.id);
    editor.estadoGuardado(t('● guardado en esta compu'));
  } catch (e) {
    editor.estadoGuardado(t('● no entra en el navegador: bajá el .json'), true);
  }
  if (estado.modo === 'estudiante' && estado.cliente) {
    clearTimeout(estado.temporizadorEnvio);
    estado.temporizadorEnvio = setTimeout(() => {
      const enviado = estado.cliente.enviarProyecto(proyecto, miniaturaDeProyecto(proyecto, 160));
      if (enviado) editor.estadoGuardado(t('● guardado y enviado al docente'));
      else editor.estadoGuardado(t('● guardado acá · se envía cuando vuelva la clase'));
    }, 1200);
  }
  if (estado.modo === 'docente-editando' && estado.editando) {
    const host = estado.hosts.get(estado.editando.codigo);
    clearTimeout(estado.temporizadorEnvio);
    estado.temporizadorEnvio = setTimeout(() => {
      if (host) host.actualizarProyecto(estado.editando.clave, proyecto, miniaturaDeProyecto(proyecto, 160));
      editor.estadoGuardado(t('● guardado en la clase y enviado al estudiante'));
    }, 1200);
  }
};
editor.alAbrirArchivo = () => {
  if (estado.modo === 'portal') { estado.modo = 'solo'; mostrar('taller'); }
};

// ------------------------------------------------------------------
// Portal
// ------------------------------------------------------------------
async function refrescarPortal() {
  // clases guardadas del docente
  const aulas = await almacen.listarAulas();
  $('misClases').hidden = !aulas.length;
  $('listaClases').innerHTML = aulas.map(a => {
    const n = Object.keys(a.estudiantes || {}).length;
    const abierta = estado.hosts.has(a.codigo);
    return `<li>
      <code>${a.codigo}</code>
      <span class="mis-clases__nombre">${escapar(a.nombre)}${abierta ? ` <em class="pildora pildora--ok">${t('abierta')}</em>` : ''}</span>
      <span class="mis-clases__meta">${t(n === 1 ? '{n} estudiante' : '{n} estudiantes', { n })} · ${fecha(a.actualizada)}</span>
      <button type="button" class="btn-chico" data-abrir="${a.codigo}">${abierta ? t('Ver') : t('Abrir')}</button>
      <button type="button" class="btn-chico btn-chico--peligro" data-borrar="${a.codigo}" title="${t('Borrar la clase y sus diseños de este navegador')}">🗑</button>
    </li>`;
  }).join('');

  // proyectos guardados en esta computadora
  const proyectos = (await almacen.listarProyectos()).slice(0, 24);
  $('misProyectos').hidden = !proyectos.length;
  $('listaProyectos').innerHTML = proyectos.map(p => `
    <button type="button" class="proyecto-tile" data-id="${p.id}">
      ${p.miniatura ? `<img src="${p.miniatura}" alt="">` : `<div class="proyecto-tile__vacio">${t('sin vista')}</div>`}
      <span>${escapar(p.nombre || t('Sin nombre'))}</span>
      <small>${p.aula ? `${t('clase')} ${p.aula} · ${escapar(p.autor || '')}` : t('por mi cuenta')} · ${fecha(p.modificado)}</small>
      <i class="proyecto-tile__borrar" data-borrar-proyecto="${p.id}" title="${t('Borrar de esta computadora')}">✕</i>
    </button>`).join('');
}

$('listaClases').addEventListener('click', async e => {
  const abrir = e.target.closest('[data-abrir]'), borrar = e.target.closest('[data-borrar]');
  if (abrir) abrirClase(abrir.dataset.abrir);
  if (borrar) {
    const cod = borrar.dataset.borrar;
    if (!confirm(t('¿Borrar la clase {codigo} y todos sus diseños de este navegador? No se puede deshacer.', { codigo: cod }))) return;
    cerrarClase(cod, true);
    await almacen.borrarAula(cod);
    refrescarPortal();
  }
});
$('listaProyectos').addEventListener('click', async e => {
  const borrar = e.target.closest('[data-borrar-proyecto]');
  if (borrar) {
    e.stopPropagation();
    if (!confirm(t('¿Borrar este proyecto de esta computadora?'))) return;
    await almacen.borrarProyecto(borrar.dataset.borrarProyecto);
    refrescarPortal();
    return;
  }
  const tile = e.target.closest('.proyecto-tile');
  if (!tile) return;
  const p = await almacen.obtenerProyecto(tile.dataset.id);
  if (!p) return;
  if (p.aula && p.autor) entrarComoEstudiante(p.aula, p.autor, p);
  else abrirSolo(p);
});
$('btnEntrarClase').addEventListener('click', () => entrarComoEstudiante($('entradaCodigo').value, $('entradaNombre').value));
$('entradaNombre').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnEntrarClase').click(); });
$('entradaCodigo').addEventListener('input', e => { e.target.value = normalizarCodigo(e.target.value); });
$('btnCrearClase').addEventListener('click', async () => {
  const aula = nuevaAula($('nuevaClaseNombre').value.trim() || t('Mi clase'));
  await almacen.guardarAula(aula);
  $('nuevaClaseNombre').value = '';
  abrirClase(aula.codigo);
});
$('nuevaClaseNombre').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnCrearClase').click(); });
$('btnSolo').addEventListener('click', async () => {
  let p = null;
  try { const id = localStorage.getItem(CLAVE_ACTUAL); if (id) p = await almacen.obtenerProyecto(id); } catch (_) { /* nada */ }
  if (p && p.aula) p = null;   // el último era de una clase: empezar uno propio
  abrirSolo(p);
});
$('btnAbrirArchivoPortal').addEventListener('click', () => $('inputJson').click());

async function abrirSolo(p) {
  cerrarConexiones();
  estado.modo = 'solo';
  mostrar('taller');
  editor.bloquearAutor(false);
  if (p) { const pr = normalizarProyecto(p); delete pr.miniatura; await prepararProyecto(pr); editor.cargar(pr); recordarActual(pr.id); }
  else editor.nuevo({});
  if (!localStorage.getItem('shadowcasters.tutorialVisto')) { editor.abrirTutorial(); try { localStorage.setItem('shadowcasters.tutorialVisto', '1'); } catch (_) { /* nada */ } }
}

// ------------------------------------------------------------------
// Estudiante
// ------------------------------------------------------------------
async function entrarComoEstudiante(codigo, nombre, proyectoLocal) {
  const cod = normalizarCodigo(codigo);
  nombre = String(nombre || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const err = $('entradaError');
  if (cod.length !== 6) { err.textContent = t('El código tiene 6 letras o números. Pedíselo al docente.'); err.hidden = false; return; }
  if (nombre.length < 2) { err.textContent = t('Escribí tu nombre y apellido: así el docente sabe de quién es cada diseño.'); err.hidden = false; return; }
  err.hidden = true;
  cerrarConexiones();

  // ¿ya había un diseño de esta persona en esta clase, en esta compu?
  let local = proyectoLocal || null;
  if (!local) local = (await almacen.listarProyectos()).find(p => p.aula === cod && claveNombre(p.autor) === claveNombre(nombre)) || null;
  if (local && local.autor) nombre = local.autor;   // conservar cómo lo escribió la primera vez
  const proyecto = local ? normalizarProyecto(local) : nuevoProyecto({ autor: nombre, aula: cod, nombre: t('Mi sombra') });
  delete proyecto.miniatura;
  proyecto.autor = nombre; proyecto.aula = cod;
  await prepararProyecto(proyecto);

  estado.modo = 'estudiante';
  mostrar('taller');
  editor.cargar(proyecto);
  editor.bloquearAutor(true);
  recordarActual(proyecto.id);
  pildora($('claseEstado'), 'espera', t('Clase {codigo} · conectando…', { codigo: cod }));

  const cliente = entrarAula(cod, nombre, async (tipo, d) => {
    if (cliente !== estado.cliente) return;
    if (tipo === 'estado') {
      const e = d.estado;
      if (e === 'conectado') pildora($('claseEstado'), 'ok', t('Clase {codigo} · conectado', { codigo: cod }));
      else if (e === 'conectando') pildora($('claseEstado'), 'espera', t('Clase {codigo} · conectando…', { codigo: cod }));
      else if (e === 'sin-aula') pildora($('claseEstado'), 'espera', t('Clase {codigo} cerrada · seguís trabajando; se envía cuando el docente la abra', { codigo: cod }));
      else if (e === 'desconectado') pildora($('claseEstado'), 'espera', t('Clase {codigo} · sin conexión, reintentando…', { codigo: cod }));
      else if (e === 'rechazado') { pildora($('claseEstado'), 'mal', d.detalle || t('Te sacaron de la clase')); toast(d.detalle || t('Te sacaron de la clase'), 6000); }
      else if (e === 'sin-peer' || e === 'error') { pildora($('claseEstado'), 'mal', t('Clase {codigo} · sin conexión', { codigo: cod })); if (d.detalle) toast(d.detalle, 6000); }
    } else if (tipo === 'bienvenido') {
      const delDocente = d.proyecto ? normalizarProyecto(d.proyecto) : null;
      const mio = editor.actual();
      if (delDocente && (!mio.capas.length || (delDocente.modificado || 0) > (mio.modificado || 0))) {
        // el docente tiene una versión más nueva (o acá no había nada): traerla
        delDocente.autor = nombre; delDocente.aula = cod; delDocente.id = mio.id;
        await prepararProyecto(delDocente);
        editor.cargar(delDocente);
        editor.guardarAhora();
        toast(t('¡Hola {nombre}! Tu diseño volvió tal como lo dejaste.', { nombre: nombre.split(' ')[0] }), 3500);
      } else {
        cliente.enviarProyecto(mio, miniaturaDeProyecto(mio, 160));
        toast(t('¡Hola {nombre}! Estás en la clase «{clase}».', { nombre: nombre.split(' ')[0], clase: d.aula && d.aula.nombre || cod }), 3500);
      }
      if (d.config) setTimeout(() => aplicarConfigDocente(d.config), 600);
    } else if (tipo === 'proyecto') {
      if (!d.proyecto) return;
      const p = normalizarProyecto(d.proyecto);
      if ((p.modificado || 0) <= (editor.actual().modificado || 0)) return;
      p.autor = nombre; p.aula = cod; p.id = editor.actual().id;
      await prepararProyecto(p);
      editor.cargar(p);
      editor.guardarAhora();
      toast(t('El docente retocó tu diseño: acá está la versión nueva.'), 5000);
    } else if (tipo === 'mensaje') {
      toast('📣 ' + t('Docente:') + ' ' + d.texto, 8000);
    } else if (tipo === 'config') {
      aplicarConfigDocente(d.config);
    }
  });
  estado.cliente = cliente;
  cliente.conectar();
}

// El docente mandó una configuración de pieza: se aplica al diseño actual sin
// tocar las capas (y sólo una vez por envío).
function aplicarConfigDocente(config) {
  if (!config || !config.pieza) return;
  if (editor.aplicarConfig(config)) {
    editor.guardarAhora();
    toast('⚙ ' + t('El docente configuró la pieza para toda la clase: {resumen}. Tu diseño sigue igual.', { resumen: resumenConfig(config.pieza) }), 7000);
  }
}
function resumenConfig(pz) {
  const partes = [];
  if (pz.anchoMm && pz.altoMm) partes.push(`${pz.anchoMm} × ${pz.altoMm} mm`);
  if (pz.tipo) partes.push(t((TIPOS_PIEZA.find(x => x.id === pz.tipo) || {}).nombre || pz.tipo).toLowerCase());
  if (pz.bordes && pz.bordes.activo) partes.push(t('marco de {g} mm', { g: pz.bordes.grosorMm }));
  if (pz.espejo) partes.push(t('espejada'));
  return partes.join(' · ');
}

// ------------------------------------------------------------------
// Docente: clases (varias a la vez)
// ------------------------------------------------------------------
async function abrirClase(codigo) {
  let host = estado.hosts.get(codigo);
  if (!host) {
    const aula = await almacen.obtenerAula(codigo);
    if (!aula) { toast(t('No encontré esa clase en este navegador')); return; }
    if (!aula.estudiantes) aula.estudiantes = {};
    host = hospedarAula(aula, (tipo, d) => alEventoClase(codigo, tipo, d));
    host._estado = { estado: 'apagada', detalle: '' };
    estado.hosts.set(codigo, host);
    estado.seleccion.set(codigo, new Set());
    host.iniciar();
  }
  cerrarCliente();
  estado.claseActiva = codigo;
  estado.modo = 'docente';
  mostrar('docente');
  renderPanel();
}

function alEventoClase(codigo, tipo, d) {
  const host = estado.hosts.get(codigo);
  if (!host) return;
  if (tipo === 'estado') { host._estado = { estado: d.estado, detalle: d.detalle || '' }; }
  if (tipo === 'estudiante') {
    // el docente está retocando justo ese diseño y el estudiante mandó otra versión
    if (estado.modo === 'docente-editando' && estado.editando && estado.editando.codigo === codigo && estado.editando.clave === d.clave && d.estudiante && d.estudiante.proyecto && !d.estudiante.editadoPorDocente) {
      estado.versionNueva = d.estudiante.proyecto;
      mostrarAvisoVersionNueva(d.estudiante.nombre);
    }
  }
  if (estado.modo === 'docente' && estado.claseActiva === codigo) {
    if (tipo === 'estado') renderCabecera(); else renderEstudiantes();
  }
  if (estado.modo === 'docente') renderPestanas();
}

function cerrarClase(codigo, silencioso) {
  const host = estado.hosts.get(codigo);
  if (!host) return;
  host.cerrar();
  estado.hosts.delete(codigo);
  estado.seleccion.delete(codigo);
  if (estado.claseActiva === codigo) estado.claseActiva = estado.hosts.keys().next().value || null;
  if (!silencioso) toast(t('Clase {codigo} cerrada. Los diseños quedan guardados en este navegador.', { codigo }));
}

// --- panel
function renderPanel() {
  renderPestanas();
  if (!estado.claseActiva) { $('claseAbierta').innerHTML = `<div class="docente__vacio"><p>${t('No hay ninguna clase abierta.')}</p></div>`; return; }
  renderCabecera();
  renderConfig();
  renderEstudiantes();
}

// Configuración de pieza para toda la clase (la forma se arma al cambiar de
// clase, no en cada evento, para no pisar lo que el docente está escribiendo).
function renderConfig() {
  const cod = estado.claseActiva, host = estado.hosts.get(cod);
  const det = $('claseConfig');
  if (!host || !det) return;
  if (det.dataset.clase === cod) return;
  det.dataset.clase = cod;
  const c = (host.aula.config && host.aula.config.pieza) || {};
  const b = Object.assign({ activo: false, grosorMm: 6, arriba: true, abajo: true, izquierda: true, derecha: true }, c.bordes || {});
  const presets = [{ id: '', nombre: t('— elegir —') }, { id: '100x100', nombre: '10 × 10 cm' }, { id: '120x120', nombre: '12 × 12 cm' }, { id: '150x150', nombre: '15 × 15 cm' }, { id: '200x150', nombre: '20 × 15 cm' }, { id: '200x200', nombre: '20 × 20 cm' }, { id: '148x210', nombre: 'A5 (14,8 × 21 cm)' }, { id: '290x290', nombre: t('Tapete entero (29 × 29 cm)') }];
  const sel = (n, v, lista) => `<select name="${n}">${lista.map(o => `<option value="${o.id}" ${String(o.id) === String(v) ? 'selected' : ''}>${escapar(o.nombre)}</option>`).join('')}</select>`;
  const chk = (n, v, texto) => `<label class="config__check"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> ${texto}</label>`;
  det.innerHTML = `
    <summary>⚙ ${t('Configuración de la pieza para toda la clase')}${host.aula.config && host.aula.config.enviada ? ` <small>${t('última enviada {hora}', { hora: hora(host.aula.config.enviada) })}</small>` : ''}</summary>
    <p class="clase__ayuda">${t('Se aplica automáticamente al diseño de cada estudiante (a los conectados ahora y a los que entren después) sin tocar lo que están dibujando: cambia sólo la hoja, el tipo de pieza, el marco y el espejo.')}</p>
    <form class="config" data-config>
      <label><span>${t('Tamaño rápido')}</span>${sel('preset', c.anchoMm && c.altoMm ? `${c.anchoMm}x${c.altoMm}` : '', presets)}</label>
      <label><span>${t('Ancho')} (mm)</span><input type="number" name="anchoMm" min="10" max="300" step="1" value="${c.anchoMm || 120}"></label>
      <label><span>${t('Alto')} (mm)</span><input type="number" name="altoMm" min="10" max="300" step="1" value="${c.altoMm || 120}"></label>
      <label><span>${t('Tipo de pieza')}</span>${sel('tipo', c.tipo || 'silueta', TIPOS_PIEZA.map(x => ({ id: x.id, nombre: t(x.nombre) })))}</label>
      <div class="config__marco">
        ${chk('bordesActivo', b.activo, `<b>${t('Marco negro en los bordes')}</b>`)}
        <label><span>${t('Grosor')} (mm)</span><input type="number" name="grosorMm" min="1" max="60" step="0.5" value="${b.grosorMm}"></label>
        <span class="config__lados">${chk('arriba', b.arriba, t('arriba'))}${chk('abajo', b.abajo, t('abajo'))}${chk('izquierda', b.izquierda, t('izquierda'))}${chk('derecha', b.derecha, t('derecha'))}</span>
      </div>
      ${chk('espejo', !!c.espejo, t('Espejar para vinilo termoadhesivo'))}
      <button type="submit" class="btn-panel btn-panel--primario">📐 ${t('Aplicar a todos ahora')}</button>
    </form>`;
  det.querySelector('[name="preset"]').addEventListener('change', e => {
    if (!e.target.value) return;
    const [w, h] = e.target.value.split('x');
    det.querySelector('[name="anchoMm"]').value = w; det.querySelector('[name="altoMm"]').value = h;
  });
  det.querySelector('[data-config]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k, min, max, def) => { const v = parseFloat(f.get(k)); return Number.isNaN(v) ? def : Math.min(max, Math.max(min, v)); };
    const config = { pieza: {
      anchoMm: num('anchoMm', 10, 300, 120), altoMm: num('altoMm', 10, 300, 120), tipo: f.get('tipo') || 'silueta', espejo: f.get('espejo') === 'on',
      bordes: { activo: f.get('bordesActivo') === 'on', grosorMm: num('grosorMm', 1, 60, 6), arriba: f.get('arriba') === 'on', abajo: f.get('abajo') === 'on', izquierda: f.get('izquierda') === 'on', derecha: f.get('derecha') === 'on' }
    } };
    const n = await host.configurar(config);
    // miniaturas al día también para los que no están conectados
    for (const e of Object.values(host.aula.estudiantes)) {
      if (!e.proyecto) continue;
      try { const p = normalizarProyecto(e.proyecto); await prepararProyecto(p); e.miniatura = miniaturaDeProyecto(p, 160); } catch (_) { /* sin miniatura */ }
    }
    await host.guardar();
    det.dataset.clase = '';
    renderConfig();
    renderEstudiantes();
    toast(t('Configuración aplicada: {resumen}. Enviada a {n} estudiantes conectados; los demás la reciben al entrar.', { resumen: resumenConfig(config.pieza), n }), 7000);
  });
}

function renderPestanas() {
  const cont = $('pestanasClases');
  let html = '';
  for (const [cod, host] of estado.hosts) {
    const n = Object.values(host.aula.estudiantes || {}).filter(e => e.conectado).length;
    const total = Object.keys(host.aula.estudiantes || {}).length;
    const st = host._estado.estado;
    html += `<button type="button" class="pestana ${cod === estado.claseActiva ? 'pestana--activa' : ''}" data-clase="${cod}">
      <span class="pestana__punto pestana__punto--${st === 'abierta' ? 'ok' : st === 'conectando' || st === 'reconectando' ? 'espera' : 'mal'}"></span>
      <span class="pestana__nombre">${escapar(host.aula.nombre)}</span>
      <code>${cod}</code>
      <small>${n}/${total}</small>
    </button>`;
  }
  html += `<button type="button" class="pestana pestana--nueva" data-nueva-clase>＋ ${t('Nueva clase')}</button>`;
  html += `<button type="button" class="pestana pestana--nueva" data-otra-clase>📚 ${t('Abrir una guardada')}</button>`;
  cont.innerHTML = html;
}
$('pestanasClases').addEventListener('click', async e => {
  const tab = e.target.closest('[data-clase]');
  if (tab) { estado.claseActiva = tab.dataset.clase; renderPanel(); return; }
  if (e.target.closest('[data-nueva-clase]')) {
    const nombre = prompt(t('Nombre de la clase nueva:'), t('Mi clase'));
    if (nombre == null) return;
    const aula = nuevaAula(nombre.trim() || t('Mi clase'));
    await almacen.guardarAula(aula);
    abrirClase(aula.codigo);
  }
  if (e.target.closest('[data-otra-clase]')) {
    const aulas = (await almacen.listarAulas()).filter(a => !estado.hosts.has(a.codigo));
    if (!aulas.length) { toast(t('No hay otras clases guardadas. Creá una nueva.')); return; }
    const resp = prompt(t('¿Cuál abrimos? Escribí el código:') + '\n' + aulas.map(a => `${a.codigo} — ${a.nombre}`).join('\n'));
    const cod = normalizarCodigo(resp);
    if (aulas.find(a => a.codigo === cod)) abrirClase(cod); else if (resp) toast(t('No encontré esa clase en este navegador'));
  }
});

function renderCabecera() {
  const cod = estado.claseActiva, host = estado.hosts.get(cod);
  if (!host) return;
  const st = host._estado;
  const textos = {
    abierta: ['ok', t('abierta: los estudiantes pueden entrar')], conectando: ['espera', t('conectando…')], reconectando: ['espera', t('reconectando…')],
    'codigo-ocupado': ['mal', t('código en uso en otra pestaña')], apagada: ['mal', t('apagada')], error: ['mal', t('sin conexión')], 'sin-peer': ['mal', t('sin conexión')]
  };
  const [clase, texto] = textos[st.estado] || ['mal', st.estado];
  const total = Object.keys(host.aula.estudiantes || {}).length;
  const conectados = Object.values(host.aula.estudiantes || {}).filter(e => e.conectado).length;
  let cab = $('claseAbierta').querySelector('.clase__cab');
  if (!cab) {
    $('claseAbierta').innerHTML = `
      <div class="clase__cab"></div>
      <div class="clase__acciones"></div>
      <details class="clase__config" id="claseConfig"></details>
      <div class="clase__estudiantes" id="gridEstudiantes"></div>
      <p class="clase__vacio" id="claseVacia"></p>`;
    renderConfig();
    cab = $('claseAbierta').querySelector('.clase__cab');
  }
  cab.innerHTML = `
    <div class="clase__codigo" title="${t('Clic para copiar el código')}" data-copiar="${cod}">
      <span class="clase__codigo-et">${t('Código de la clase')}</span>
      <span class="clase__codigo-valor">${cod.split('').map(l => `<b>${l}</b>`).join('')}</span>
      <span class="clase__codigo-enlace" data-copiar-enlace="${cod}" title="${t('Clic para copiar el enlace')}">🔗 ${escapar(enlaceClase(cod))}</span>
    </div>
    <div class="clase__datos">
      <input class="clase__nombre" type="text" value="${escapar(host.aula.nombre)}" maxlength="60" title="${t('Nombre de la clase')}" data-renombrar>
      <div class="clase__estado"><span class="pildora pildora--${clase}">${texto}</span>
        <span>${t('{a} de {b} conectados', { a: conectados, b: total })}</span>
        ${st.detalle ? `<span class="clase__detalle">${escapar(st.detalle)}</span>` : ''}
      </div>
      <p class="clase__ayuda">${t('Dejá esta pestaña abierta: los diseños aparecen abajo a medida que los estudiantes trabajan. Si cerrás la pestaña, ellos siguen diseñando y todo se sincroniza cuando la vuelvas a abrir.')}</p>
    </div>`;
  $('claseAbierta').querySelector('.clase__acciones').innerHTML = `
    <button type="button" class="btn-panel btn-panel--primario" data-accion="tapete" title="${t('Acomoda los diseños marcados en un tapete de 12 × 12 pulgadas y arma un solo SVG')}">✂ ${t('Tapete con los marcados')}</button>
    <button type="button" class="btn-panel" data-accion="marcar-todos">☑ ${t('Marcar todos')}</button>
    <button type="button" class="btn-panel" data-accion="importar">📥 ${t('Importar .json de un estudiante')}</button>
    <button type="button" class="btn-panel" data-accion="exportar">💾 ${t('Exportar la clase (.json)')}</button>
    <span class="clase__mensaje">
      <input type="text" data-mensaje placeholder="${t('Mensaje para todos (ej.: 5 minutos más)')}" maxlength="140">
      <button type="button" class="btn-panel" data-accion="mensaje">📣 ${t('Enviar')}</button>
    </span>
    <button type="button" class="btn-panel btn-panel--peligro" data-accion="cerrar">⏻ ${t('Cerrar esta clase')}</button>`;
}

function renderEstudiantes() {
  const cod = estado.claseActiva, host = estado.hosts.get(cod);
  const grid = $('gridEstudiantes');
  if (!host || !grid) return;
  const sel = estado.seleccion.get(cod) || new Set();
  const lista = Object.entries(host.aula.estudiantes || {}).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre));
  $('claseVacia').textContent = t('Todavía no entró nadie. Compartí el código (o el enlace) y dejá esta pestaña abierta.');
  $('claseVacia').style.display = lista.length ? 'none' : '';
  grid.innerHTML = lista.map(([clave, e]) => `
    <div class="estudiante ${e.conectado ? 'estudiante--conectado' : ''}" data-clave="${escapar(clave)}">
      <label class="estudiante__marca" title="${t('Marcar para el tapete')}"><input type="checkbox" data-marcar ${sel.has(clave) ? 'checked' : ''}></label>
      <div class="estudiante__mini">${e.miniatura ? `<img src="${e.miniatura}" alt="">` : `<span>${t('sin diseño todavía')}</span>`}</div>
      <div class="estudiante__nombre">${escapar(e.nombre)}</div>
      <div class="estudiante__meta">
        <span class="pildora pildora--${e.conectado ? 'ok' : 'gris'}">${e.conectado ? t('en línea') : t('desconectado')}</span>
        <span>${e.actualizado ? t('actualizado {hora}', { hora: hora(e.actualizado) }) : t('sin cambios')}</span>
        ${e.proyecto ? `<span>${escapar(e.proyecto.nombre || '')} · ${e.proyecto.pieza ? `${e.proyecto.pieza.anchoMm}×${e.proyecto.pieza.altoMm} mm` : ''} · ${t(e.proyecto.capas && e.proyecto.capas.length === 1 ? '{n} capa' : '{n} capas', { n: e.proyecto.capas ? e.proyecto.capas.length : 0 })}</span>` : ''}
      </div>
      <div class="estudiante__botones">
        <button type="button" class="btn-chico" data-est="abrir" ${e.proyecto ? '' : 'disabled'}>✏️ ${t('Abrir')}</button>
        <button type="button" class="btn-chico" data-est="svg" ${e.proyecto ? '' : 'disabled'}>⬇ SVG</button>
        <button type="button" class="btn-chico" data-est="json" ${e.proyecto ? '' : 'disabled'}>💾 .json</button>
        <button type="button" class="btn-chico btn-chico--peligro" data-est="quitar" title="${t('Quitar de la clase')}">🗑</button>
      </div>
    </div>`).join('');
}

$('claseAbierta').addEventListener('click', async e => {
  const cod = estado.claseActiva, host = estado.hosts.get(cod);
  if (!host) return;
  const copiar = e.target.closest('[data-copiar-enlace]') || e.target.closest('[data-copiar]');
  if (copiar) {
    const texto = copiar.dataset.copiarEnlace ? enlaceClase(copiar.dataset.copiarEnlace) : copiar.dataset.copiar;
    try { await navigator.clipboard.writeText(texto); toast(t('Copiado: {texto}', { texto })); } catch (_) { toast(texto); }
    return;
  }
  const accion = e.target.closest('[data-accion]');
  if (accion) {
    const a = accion.dataset.accion;
    if (a === 'mensaje') { const inp = $('claseAbierta').querySelector('[data-mensaje]'); const txt = inp.value.trim(); if (!txt) return; host.difundir(txt); inp.value = ''; toast(t('Mensaje enviado a {n} estudiantes', { n: host.conectados })); }
    else if (a === 'marcar-todos') { const sel = estado.seleccion.get(cod); const todos = Object.keys(host.aula.estudiantes); if (sel.size === todos.length) sel.clear(); else todos.forEach(k => sel.add(k)); renderEstudiantes(); }
    else if (a === 'tapete') armarTapete(cod);
    else if (a === 'importar') $('inputJsonDocente').click();
    else if (a === 'exportar') { descargar(JSON.stringify({ tipo: 'shadowcasters-clase', aula: host.aula }), `clase-${cod}.json`, 'application/json'); toast(t('Clase exportada')); }
    else if (a === 'cerrar') { cerrarClase(cod); if (estado.hosts.size) renderPanel(); else salir(); }
    return;
  }
  const card = e.target.closest('.estudiante');
  if (!card) return;
  const clave = card.dataset.clave;
  const est = host.aula.estudiantes[clave];
  if (!est) return;
  const marcar = e.target.closest('[data-marcar]');
  if (marcar) { const sel = estado.seleccion.get(cod); if (marcar.checked) sel.add(clave); else sel.delete(clave); return; }
  const b = e.target.closest('[data-est]');
  if (!b) return;
  if (b.dataset.est === 'abrir') abrirDisenoEstudiante(cod, clave);
  else if (b.dataset.est === 'svg') {
    const p = normalizarProyecto(est.proyecto); await prepararProyecto(p);
    const r = vectorizarProyecto(p, { espejo: p.pieza.espejo, recortarCaja: true, detalleMinMm: 1.5 });
    descargar(r.svg, nombreArchivo(p) + '.svg', 'image/svg+xml');
    if (r.avisos.length) toast('⚠ ' + r.avisos[0].texto, 6000);
  }
  else if (b.dataset.est === 'json') descargar(JSON.stringify(est.proyecto), nombreArchivo(est.proyecto) + '.sombra.json', 'application/json');
  else if (b.dataset.est === 'quitar') { if (confirm(t('¿Quitar a {nombre} de la clase? Su diseño se borra de este navegador.', { nombre: est.nombre }))) host.quitarEstudiante(clave); }
});
$('claseAbierta').addEventListener('change', e => {
  const inp = e.target.closest('[data-renombrar]');
  if (inp) { const host = estado.hosts.get(estado.claseActiva); if (host) { host.renombrar(inp.value.trim() || t('Mi clase')); renderPestanas(); } }
});
$('claseAbierta').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-mensaje]')) $('claseAbierta').querySelector('[data-accion="mensaje"]').click(); });
$('inputJsonDocente').addEventListener('change', async e => {
  const host = estado.hosts.get(estado.claseActiva);
  const archivos = Array.from(e.target.files || []);
  e.target.value = '';
  if (!host) return;
  for (const f of archivos) {
    try {
      const datos = JSON.parse(await f.text());
      if (datos.tipo === 'shadowcasters-clase' && datos.aula) {
        for (const est of Object.values(datos.aula.estudiantes || {})) if (est.proyecto) await host.importarProyecto(est.nombre, normalizarProyecto(est.proyecto), est.miniatura);
        toast(t('Clase importada'));
        continue;
      }
      const p = normalizarProyecto(datos.proyecto || datos);
      await prepararProyecto(p);
      await host.importarProyecto(p.autor || f.name.replace(/\.(sombra\.)?json$/i, ''), p, miniaturaDeProyecto(p, 160));
      toast(t('Importado: {nombre}', { nombre: p.autor || p.nombre }));
    } catch (err) { toast(err.message || t('No se pudo importar')); }
  }
});

async function armarTapete(cod) {
  const host = estado.hosts.get(cod);
  const sel = estado.seleccion.get(cod);
  const claves = Array.from(sel).filter(k => host.aula.estudiantes[k] && host.aula.estudiantes[k].proyecto);
  if (!claves.length) { toast(t('Marcá al menos un estudiante con diseño (la casilla de cada tarjeta).')); return; }
  toast(t('Armando el tapete…'));
  const lista = [];
  for (const k of claves) {
    const est = host.aula.estudiantes[k];
    const p = normalizarProyecto(est.proyecto); await prepararProyecto(p);
    const r = vectorizarProyecto(p, { espejo: false, recortarCaja: true, detalleMinMm: 1.5 });
    if (r.piezas.length) lista.push({ id: nombreArchivo(p) + '-' + k.replace(/[^a-z0-9]/g, ''), nombre: est.nombre, piezas: r.piezas, pxPorMm: r.pxPorMm });
  }
  const tap = svgTapete(lista, { anchoMat: MAT_MM, altoMat: MAT_MM, sepMm: 4, margenMm: 6, espejo: false });
  descargar(tap.svg, `tapete-${cod}.svg`, 'image/svg+xml');
  if (tap.sinLugar.length) toast(t('No entraron en el tapete: {nombres}. Armá otro con ellos.', { nombres: tap.sinLugar.map(s => s.nombre).join(', ') }), 7000);
  else toast(t('Tapete listo: {n} diseños en un solo SVG', { n: tap.colocados.length }), 5000);
}

// --- el docente retoca el diseño de un estudiante
async function abrirDisenoEstudiante(codigo, clave) {
  const host = estado.hosts.get(codigo);
  const est = host && host.aula.estudiantes[clave];
  if (!est || !est.proyecto) return;
  const p = normalizarProyecto(est.proyecto);
  await prepararProyecto(p);
  estado.editando = { codigo, clave };
  estado.versionNueva = null;
  estado.modo = 'docente-editando';
  mostrar('taller');
  editor.cargar(p);
  editor.bloquearAutor(true);
  pildora($('claseEstado'), 'ok', t('Retocando el diseño de {nombre} (clase {codigo})', { nombre: est.nombre, codigo }));
  const viejo = $('btnVersionNueva'); if (viejo) viejo.remove();
}
function mostrarAvisoVersionNueva(nombre) {
  let b = $('btnVersionNueva');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button'; b.id = 'btnVersionNueva'; b.className = 'menu__accion';
    b.addEventListener('click', async () => {
      if (!estado.versionNueva) return;
      const p = normalizarProyecto(estado.versionNueva); await prepararProyecto(p);
      estado.versionNueva = null; editor.cargar(p); b.remove();
    });
    $('menuClase').appendChild(b);
  }
  b.textContent = t('↻ {nombre} mandó una versión nueva: cargarla', { nombre: nombre.split(' ')[0] });
  toast(t('{nombre} siguió editando: hay una versión más nueva de su diseño.', { nombre }), 5000);
}
$('btnVolverPanel').addEventListener('click', volverAlPanel);
function volverAlPanel() {
  editor.guardarAhora();
  estado.editando = null; estado.versionNueva = null;
  const viejo = $('btnVersionNueva'); if (viejo) viejo.remove();
  estado.modo = 'docente';
  mostrar('docente');
  renderPanel();
}

// ------------------------------------------------------------------
// Salir / cerrar
// ------------------------------------------------------------------
function cerrarCliente() { if (estado.cliente) { estado.cliente.cerrar(); estado.cliente = null; } }
function cerrarConexiones() { cerrarCliente(); }
function salir() {
  if (estado.modo === 'docente-editando') { volverAlPanel(); return; }
  if (estado.modo === 'estudiante' || estado.modo === 'solo') editor.guardarAhora();
  cerrarCliente();
  estado.modo = 'portal';
  mostrar('portal');
  refrescarPortal();
  if (estado.hosts.size) toast(t('Tus clases siguen abiertas mientras esta pestaña esté abierta.'), 4000);
}
$('btnSalir').addEventListener('click', salir);
$('logoInicio').addEventListener('click', e => { e.preventDefault(); salir(); });
window.addEventListener('beforeunload', e => {
  if (estado.hosts.size) { e.preventDefault(); e.returnValue = ''; }
});

// ------------------------------------------------------------------
// Idioma y arranque
// ------------------------------------------------------------------
document.querySelectorAll('[data-idioma]').forEach(b => b.addEventListener('click', () => establecerIdioma(b.dataset.idioma)));
alCambiarIdioma(() => { refrescarPortal(); if (estado.modo === 'docente') renderPanel(); });

(async function iniciar() {
  establecerIdioma(idiomaGuardado(), true);
  editor.refrescarTodo();
  const cod = normalizarCodigo(new URLSearchParams(location.search).get('clase'));
  if (cod.length === 6) { $('entradaCodigo').value = cod; $('entradaNombre').focus(); }
  await refrescarPortal();
  mostrar('portal');
})();
