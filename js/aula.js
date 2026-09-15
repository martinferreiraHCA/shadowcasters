// Sombras recortadas — el aula.
//
// El docente crea un aula con un código; su navegador la "hospeda": los
// estudiantes entran con el código y su nombre y cada cambio del diseño
// viaja al panel del docente. La conexión es directa entre navegadores
// (WebRTC, con PeerJS para presentarse a través de un servidor de señales
// que no ve los datos). No hay servidor propio: el aula vive en el
// navegador del docente (IndexedDB) y se puede volver a abrir con el mismo
// código otro día. Si la red del colegio bloquea la conexión, queda el
// camino de los archivos .json (exportar / importar).

import { t } from './i18n.js';
import { aplicarConfigPieza } from './render.js';

const PREFIJO_PEER = 'shadowcasters-';
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I

export function generarCodigo() {
  const arr = new Uint32Array(6);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach((_, i) => arr[i] = Math.floor(Math.random() * 1e9));
  return Array.from(arr, n => ALFABETO[n % ALFABETO.length]).join('');
}
export function normalizarCodigo(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').slice(0, 6);
}
export function claveNombre(nombre) {
  return String(nombre || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
function clienteId() {
  let id = null;
  try { id = localStorage.getItem('shadowcasters_cliente'); } catch (_) {}
  if (!id) { id = 'e' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem('shadowcasters_cliente', id); } catch (_) {} }
  return id;
}

// ------------------------------------------------------------------
// Almacenamiento (IndexedDB con respaldo en memoria)
// ------------------------------------------------------------------

let dbPromesa = null;
function abrirDB() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((resolve) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    let req;
    try { req = indexedDB.open('shadowcasters', 1); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('proyectos')) db.createObjectStore('proyectos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('aulas')) db.createObjectStore('aulas', { keyPath: 'codigo' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromesa;
}
const memoria = { proyectos: new Map(), aulas: new Map() };
async function op(store, modo, fn) {
  const db = await abrirDB();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo);
    const s = tx.objectStore(store);
    const r = fn(s);
    if (r && 'onsuccess' in r) { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }
    else { tx.oncomplete = () => resolve(r); tx.onerror = () => reject(tx.error); }
  });
}
export const almacen = {
  async guardarProyecto(p) {
    const copia = Object.assign({}, p, { guardado: Date.now() });
    return op('proyectos', 'readwrite', s => s ? s.put(copia) : memoria.proyectos.set(p.id, copia));
  },
  async obtenerProyecto(id) { return op('proyectos', 'readonly', s => s ? s.get(id) : memoria.proyectos.get(id)); },
  async listarProyectos() {
    const lista = await op('proyectos', 'readonly', s => s ? s.getAll() : Array.from(memoria.proyectos.values()));
    return (lista || []).sort((a, b) => (b.modificado || 0) - (a.modificado || 0));
  },
  async borrarProyecto(id) { return op('proyectos', 'readwrite', s => s ? s.delete(id) : memoria.proyectos.delete(id)); },
  async guardarAula(a) { return op('aulas', 'readwrite', s => s ? s.put(a) : memoria.aulas.set(a.codigo, a)); },
  async obtenerAula(codigo) { return op('aulas', 'readonly', s => s ? s.get(codigo) : memoria.aulas.get(codigo)); },
  async listarAulas() {
    const lista = await op('aulas', 'readonly', s => s ? s.getAll() : Array.from(memoria.aulas.values()));
    return (lista || []).sort((a, b) => (b.actualizada || 0) - (a.actualizada || 0));
  },
  async borrarAula(codigo) { return op('aulas', 'readwrite', s => s ? s.delete(codigo) : memoria.aulas.delete(codigo)); }
};

// ------------------------------------------------------------------
// Transporte: PeerJS (global `Peer` cargado con peerjs.min.js)
// ------------------------------------------------------------------

function tienePeer() { return typeof window !== 'undefined' && typeof window.Peer === 'function'; }

// Servidor de señales: el público de PeerJS (0.peerjs.com) salvo que la
// página defina window.SHADOWCASTERS_PEER = { host, port, path, secure } para usar
// uno propio (por ejemplo `npx peer --port 9000` en la red del colegio).
function nuevoPeer(id) {
  const opciones = Object.assign({
    debug: 0,
    config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }
  }, (typeof window !== 'undefined' && window.SHADOWCASTERS_PEER) || {});
  return id ? new window.Peer(id, opciones) : new window.Peer(opciones);
}

// ------------------------------------------------------------------
// Docente: hospedar el aula
// ------------------------------------------------------------------

// aula: {codigo, nombre, creada, actualizada, estudiantes: {clave: {...}}}
export function nuevaAula(nombre) {
  const ahora = Date.now();
  return { codigo: generarCodigo(), nombre: nombre || t('Mi clase'), creada: ahora, actualizada: ahora, estudiantes: {} };
}

export function hospedarAula(aula, alEvento) {
  const emitir = (tipo, datos) => { try { alEvento(tipo, datos || {}); } catch (e) { console.error(e); } };
  const conexiones = new Map(); // clave estudiante → conn
  let peer = null, estado = 'apagada', cerrado = false, reintento = null;

  function guardar() {
    aula.actualizada = Date.now();
    return almacen.guardarAula(limpiarAula(aula));
  }

  function estudiante(clave, nombre, extra) {
    if (!aula.estudiantes[clave]) aula.estudiantes[clave] = { nombre: nombre || clave, creado: Date.now(), proyecto: null, miniatura: null, actualizado: 0 };
    const e = aula.estudiantes[clave];
    if (nombre) e.nombre = nombre;
    if (extra) Object.assign(e, extra);
    return e;
  }

  function iniciar() {
    if (!tienePeer()) { estado = 'sin-peer'; emitir('estado', { estado, detalle: t('No se cargó PeerJS: la clase sólo funciona con archivos .json.') }); return; }
    cerrado = false;
    estado = 'conectando'; emitir('estado', { estado });
    try { peer = nuevoPeer(PREFIJO_PEER + aula.codigo); } catch (e) { estado = 'error'; emitir('estado', { estado, detalle: e.message }); return; }
    peer.on('open', () => { estado = 'abierta'; emitir('estado', { estado }); });
    peer.on('connection', conn => {
      let clave = null;
      conn.on('data', async msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hola') {
          clave = claveNombre(msg.nombre);
          if (!clave) { conn.send({ t: 'rechazo', motivo: t('Falta el nombre.') }); return; }
          const previa = conexiones.get(clave);
          if (previa && previa !== conn && previa.open) { try { previa.send({ t: 'rechazo', motivo: t('Entraste desde otra computadora: esta sesión se cerró.') }); previa.close(); } catch (_) {} }
          conexiones.set(clave, conn);
          const e = estudiante(clave, String(msg.nombre).trim().slice(0, 40), { clienteId: msg.clienteId, conectado: true, ultimaConexion: Date.now() });
          conn.send({ t: 'bienvenido', aula: { nombre: aula.nombre, codigo: aula.codigo }, proyecto: e.proyecto || null, config: aula.config || null });
          await guardar();
          emitir('estudiante', { clave, estudiante: e });
        } else if (msg.t === 'proyecto') {
          if (!clave) return;
          const e = estudiante(clave, null, { proyecto: msg.proyecto, miniatura: msg.miniatura || null, actualizado: Date.now(), conectado: true, editadoPorDocente: 0 });
          await guardar();
          emitir('estudiante', { clave, estudiante: e });
        } else if (msg.t === 'pedirProyecto') {
          if (!clave) return;
          const e = aula.estudiantes[clave];
          conn.send({ t: 'proyecto', proyecto: e && e.proyecto || null });
        }
      });
      const desconectar = () => {
        if (!clave) return;
        if (conexiones.get(clave) === conn) conexiones.delete(clave);
        const e = aula.estudiantes[clave];
        if (e && !conexiones.has(clave)) { e.conectado = false; emitir('estudiante', { clave, estudiante: e }); }
      };
      conn.on('close', desconectar);
      conn.on('error', desconectar);
    });
    peer.on('disconnected', () => {
      if (cerrado) return;
      estado = 'reconectando'; emitir('estado', { estado });
      clearTimeout(reintento);
      reintento = setTimeout(() => { try { peer.reconnect(); } catch (_) { reiniciar(); } }, 2000);
    });
    peer.on('error', err => {
      const tipo = err && err.type;
      if (tipo === 'unavailable-id') { estado = 'codigo-ocupado'; emitir('estado', { estado, detalle: t('Ese código ya está en uso en otra computadora (¿la clase quedó abierta en otra pestaña?).') }); return; }
      if (tipo === 'peer-unavailable') return; // no aplica al docente
      estado = 'error'; emitir('estado', { estado, detalle: describirError(err) });
      if (!cerrado && (tipo === 'network' || tipo === 'server-error' || tipo === 'socket-error' || tipo === 'socket-closed')) {
        clearTimeout(reintento); reintento = setTimeout(reiniciar, 6000);
      }
    });
  }
  function reiniciar() { if (cerrado) return; try { peer && peer.destroy(); } catch (_) {} conexiones.clear(); iniciar(); }

  function cerrar() {
    cerrado = true; clearTimeout(reintento);
    for (const c of conexiones.values()) { try { c.close(); } catch (_) {} }
    conexiones.clear();
    try { peer && peer.destroy(); } catch (_) {}
    peer = null; estado = 'apagada'; emitir('estado', { estado });
    for (const e of Object.values(aula.estudiantes)) e.conectado = false;
  }

  return {
    aula,
    iniciar, cerrar, reiniciar,
    get estado() { return estado; },
    get conectados() { return conexiones.size; },
    // el docente editó el proyecto de un estudiante: guardarlo y mandárselo
    async actualizarProyecto(clave, proyecto, miniatura) {
      const e = estudiante(clave, null, { proyecto, miniatura: miniatura || null, actualizado: Date.now(), editadoPorDocente: Date.now() });
      await guardar();
      const c = conexiones.get(clave);
      if (c && c.open) { try { c.send({ t: 'proyecto', proyecto }); } catch (_) {} }
      emitir('estudiante', { clave, estudiante: e });
    },
    // importar un .json de un estudiante (sin conexión)
    async importarProyecto(nombre, proyecto, miniatura) {
      const clave = claveNombre(nombre || proyecto.autor || 'sin nombre');
      const e = estudiante(clave, nombre || proyecto.autor, { proyecto, miniatura: miniatura || null, actualizado: Date.now() });
      await guardar();
      emitir('estudiante', { clave, estudiante: e });
      return clave;
    },
    async quitarEstudiante(clave) {
      const c = conexiones.get(clave);
      if (c) { try { c.send({ t: 'rechazo', motivo: t('El docente te quitó de la clase.') }); c.close(); } catch (_) {} conexiones.delete(clave); }
      delete aula.estudiantes[clave];
      await guardar();
      emitir('estudiante', { clave, estudiante: null });
    },
    difundir(texto) {
      for (const c of conexiones.values()) { if (c.open) { try { c.send({ t: 'mensaje', texto }); } catch (_) {} } }
    },
    // configuración de pieza para toda la clase: se guarda en el aula (la
    // reciben también los que entren después), se aplica a los diseños ya
    // guardados sin tocar sus capas y se manda a los conectados
    async configurar(config) {
      aula.config = Object.assign({}, config, { enviada: Date.now() });
      for (const e of Object.values(aula.estudiantes)) {
        if (e.proyecto && aplicarConfigPieza(e.proyecto, aula.config.pieza)) e.proyecto.configAplicada = aula.config.enviada;
      }
      await guardar();
      let n = 0;
      for (const c of conexiones.values()) { if (c.open) { try { c.send({ t: 'config', config: aula.config }); n++; } catch (_) {} } }
      emitir('estudiante', { clave: null, estudiante: null });
      return n;
    },
    async renombrar(nombre) { aula.nombre = nombre; await guardar(); },
    guardar
  };
}

function limpiarAula(aula) {
  const copia = { codigo: aula.codigo, nombre: aula.nombre, creada: aula.creada, actualizada: aula.actualizada, config: aula.config || null, estudiantes: {} };
  for (const [k, e] of Object.entries(aula.estudiantes)) {
    const resto = {};
    for (const [ck, cv] of Object.entries(e)) if (ck !== 'conectado' && !ck.startsWith('_')) resto[ck] = cv;
    copia.estudiantes[k] = resto;
  }
  return copia;
}

function describirError(err) {
  const tipo = err && err.type;
  if (tipo === 'browser-incompatible') return t('Este navegador no soporta conexiones directas (WebRTC).');
  if (tipo === 'network' || tipo === 'server-error' || tipo === 'socket-error' || tipo === 'socket-closed') return t('No se pudo llegar al servidor de señales (¿la red bloquea la conexión?). Se reintenta solo; mientras tanto se puede trabajar con archivos .json.');
  if (tipo === 'peer-unavailable') return t('No hay ninguna clase abierta con ese código. Pedile al docente que la abra (tiene que tener la página abierta).');
  return (err && err.message) || t('Error de conexión.');
}

// ------------------------------------------------------------------
// Estudiante: entrar al aula
// ------------------------------------------------------------------

export function entrarAula(codigo, nombre, alEvento) {
  const emitir = (tipo, datos) => { try { alEvento(tipo, datos || {}); } catch (e) { console.error(e); } };
  const cod = normalizarCodigo(codigo);
  let peer = null, conn = null, estado = 'apagada', cerrado = false, reintento = null, pendiente = null;
  const miId = clienteId();

  function conectar() {
    if (cerrado) return;
    if (!tienePeer()) { estado = 'sin-peer'; emitir('estado', { estado, detalle: t('No se cargó PeerJS: guardá el .json y mandáselo al docente.') }); return; }
    estado = 'conectando'; emitir('estado', { estado });
    try { peer = nuevoPeer(null); } catch (e) { estado = 'error'; emitir('estado', { estado, detalle: e.message }); programar(); return; }
    peer.on('open', () => {
      // serialización binaria (la de PeerJS por defecto): parte los mensajes
      // grandes en trozos de 16 KB. En modo 'json' un proyecto con foto supera
      // el tamaño máximo de un mensaje WebRTC y nunca llega.
      conn = peer.connect(PREFIJO_PEER + cod, { reliable: true, serialization: 'binary' });
      conn.on('open', () => {
        estado = 'conectado'; emitir('estado', { estado });
        conn.send({ t: 'hola', nombre, clienteId: miId });
        if (pendiente) { try { conn.send(pendiente); } catch (_) {} pendiente = null; }
      });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'bienvenido') emitir('bienvenido', { aula: msg.aula, proyecto: msg.proyecto || null });
        else if (msg.t === 'proyecto') emitir('proyecto', { proyecto: msg.proyecto || null });
        else if (msg.t === 'mensaje') emitir('mensaje', { texto: msg.texto });
        else if (msg.t === 'config') emitir('config', { config: msg.config || null });
        else if (msg.t === 'rechazo') { cerrado = true; estado = 'rechazado'; emitir('estado', { estado, detalle: msg.motivo }); try { peer.destroy(); } catch (_) {} }
      });
      conn.on('close', () => { if (cerrado) return; estado = 'desconectado'; emitir('estado', { estado }); programar(); });
      conn.on('error', () => { if (cerrado) return; estado = 'desconectado'; emitir('estado', { estado }); programar(); });
    });
    peer.on('error', err => {
      if (cerrado) return;
      estado = err && err.type === 'peer-unavailable' ? 'sin-aula' : 'error';
      emitir('estado', { estado, detalle: describirError(err) });
      programar(err && err.type === 'peer-unavailable' ? 8000 : 6000);
    });
    peer.on('disconnected', () => { if (cerrado) return; programar(); });
  }
  function programar(ms) {
    clearTimeout(reintento);
    reintento = setTimeout(() => { try { peer && peer.destroy(); } catch (_) {} conn = null; conectar(); }, ms || 5000);
  }

  return {
    codigo: cod, nombre,
    conectar,
    get estado() { return estado; },
    get conectado() { return !!(conn && conn.open); },
    enviarProyecto(proyecto, miniatura) {
      const msg = { t: 'proyecto', proyecto, miniatura: miniatura || null };
      if (conn && conn.open) { try { conn.send(msg); return true; } catch (_) {} }
      pendiente = msg; // sale cuando se reconecte
      return false;
    },
    pedirProyecto() { if (conn && conn.open) conn.send({ t: 'pedirProyecto' }); },
    cerrar() { cerrado = true; clearTimeout(reintento); try { conn && conn.close(); } catch (_) {} try { peer && peer.destroy(); } catch (_) {} estado = 'apagada'; emitir('estado', { estado }); }
  };
}
