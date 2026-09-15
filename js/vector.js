// Sombras recortadas — vectorizado de la silueta y armado del SVG para la
// cortadora (Cricut, Silhouette, láser).
//
// Pipeline: máscara binaria (1 = figura) → marching squares → loops →
// simplificación (Douglas-Peucker) → anidado (exteriores y agujeros) →
// path SVG en milímetros con fill-rule evenodd.
//
// Sin dependencias. Las coordenadas de los loops están en píxeles de la
// máscara; `svgDesdeContornos` los pasa a milímetros con `pxPorMm`.

// ------------------------------------------------------------------
// Marching squares
// ------------------------------------------------------------------

// Devuelve loops cerrados [[x, y], ...] en píxeles (la figura queda a la
// izquierda del recorrido: exteriores antihorarios en pantalla, agujeros
// horarios). Trabaja con claves numéricas para que aguante máscaras grandes.
export function trazarContornos(mascara, w, h) {
  const W2 = 2 * w + 3; // ancho de la grilla ×2 (con borde de ceros)
  const clave = (x, y) => (y + 2) * W2 + (x + 2);
  const v = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mascara[y * w + x];
  const salida = new Map();     // clave del punto de partida → [x, y] destino (×2)
  const salidaAlt = new Map();  // segunda salida (puntos de silla)
  const agregar = (a, b) => {
    const k = clave(a[0], a[1]);
    if (salida.has(k)) salidaAlt.set(k, b); else salida.set(k, b);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const caso = v(x, y) * 8 + v(x + 1, y) * 4 + v(x + 1, y + 1) * 2 + v(x, y + 1);
      if (caso === 0 || caso === 15) continue;
      const T = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1], B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
      switch (caso) {
        case 1: agregar(L, B); break;
        case 2: agregar(B, R); break;
        case 3: agregar(L, R); break;
        case 4: agregar(R, T); break;
        case 5: agregar(R, T); agregar(L, B); break;
        case 6: agregar(B, T); break;
        case 7: agregar(L, T); break;
        case 8: agregar(T, L); break;
        case 9: agregar(T, B); break;
        case 10: agregar(T, L); agregar(B, R); break;
        case 11: agregar(T, R); break;
        case 12: agregar(R, L); break;
        case 13: agregar(R, B); break;
        case 14: agregar(B, L); break;
      }
    }
  }
  const loops = [];
  const tomar = (p) => {
    const k = clave(p[0], p[1]);
    let s = salida.get(k);
    if (s !== undefined) {
      const alt = salidaAlt.get(k);
      if (alt !== undefined) { salida.set(k, alt); salidaAlt.delete(k); } else salida.delete(k);
      return s;
    }
    return undefined;
  };
  const limite = 8 * (w + 2) * (h + 2);
  while (salida.size) {
    const [kInicio, primero] = salida.entries().next().value;
    const inicio = [(kInicio % W2) - 2, Math.floor(kInicio / W2) - 2];
    tomar(inicio);
    const loop = [inicio, primero];
    let actual = primero, vueltas = 0;
    while (vueltas++ < limite) {
      const siguiente = tomar(actual);
      if (siguiente === undefined) break;
      if (siguiente[0] === inicio[0] && siguiente[1] === inicio[1]) break;
      loop.push(siguiente);
      actual = siguiente;
    }
    if (loop.length >= 3) loops.push(loop.map(p => [p[0] / 2, p[1] / 2]));
  }
  return loops;
}

// Douglas-Peucker sobre un loop cerrado.
export function simplificarLoop(pts, tolerancia) {
  if (pts.length < 6) return pts;
  const dp = (desde, hasta, out) => {
    const a = pts[desde], b = pts[hasta];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, maxI = -1;
    for (let i = desde + 1; i < hasta; i++) {
      const d = Math.abs(dx * (a[1] - pts[i][1]) - dy * (a[0] - pts[i][0])) / largo;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tolerancia) {
      dp(desde, maxI, out);
      out.push(pts[maxI]);
      dp(maxI, hasta, out);
    }
  };
  let lejos = 1, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > maxD) { maxD = d; lejos = i; }
  }
  const out = [pts[0]];
  dp(0, lejos, out);
  out.push(pts[lejos]);
  const cola = [];
  dp(lejos, pts.length - 1, cola);
  out.push(...cola);
  return out.length >= 3 ? out : pts;
}

// Suavizado de Chaikin (una o dos pasadas): redondea los escalones que
// deja la grilla sin perder las esquinas grandes.
export function suavizarLoop(pts, pasadas) {
  let p = pts;
  for (let k = 0; k < (pasadas || 1); k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = out;
  }
  return p;
}

export function areaFirmada(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function puntoDentro(punto, pts) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > punto[1]) !== (b[1] > punto[1]) &&
        punto[0] < (b[0] - a[0]) * (punto[1] - a[1]) / (b[1] - a[1]) + a[0]) dentro = !dentro;
  }
  return dentro;
}

export function cajaDe(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Anida los loops: profundidad par = contorno exterior (una pieza), impar =
// agujero del exterior que lo contiene.
export function anidarLoops(loops) {
  const info = loops.map(pts => ({ pts, area: Math.abs(areaFirmada(pts)), caja: cajaDe(pts), prof: 0 }));
  for (let i = 0; i < info.length; i++) {
    const a = info[i];
    for (let j = 0; j < info.length; j++) {
      if (i === j) continue;
      const b = info[j];
      if (b.area <= a.area) continue;
      if (a.caja.x0 < b.caja.x0 || a.caja.x1 > b.caja.x1 || a.caja.y0 < b.caja.y0 || a.caja.y1 > b.caja.y1) continue;
      if (puntoDentro(a.pts[0], b.pts)) a.prof++;
    }
  }
  const piezas = [];
  for (const it of info) if (it.prof % 2 === 0) piezas.push({ pts: it.pts, agujeros: [], area: it.area, caja: it.caja, _prof: it.prof });
  for (const it of info) {
    if (it.prof % 2 === 1) {
      let padre = null;
      for (const ext of piezas) {
        if (ext._prof === it.prof - 1 && ext.area > it.area && puntoDentro(it.pts[0], ext.pts)) {
          if (!padre || ext.area < padre.area) padre = ext;
        }
      }
      if (padre) { padre.agujeros.push(it.pts); padre.area -= it.area; }
    }
  }
  piezas.sort((a, b) => b.area - a.area);
  return piezas.map(p => ({ pts: p.pts, agujeros: p.agujeros, area: p.area, caja: p.caja }));
}

// Máscara → piezas anidadas. `tolerancia` en píxeles; `suavizar` pasadas de Chaikin.
export function vectorizarMascara(mascara, w, h, opciones) {
  const op = Object.assign({ tolerancia: 0.6, suavizar: 1, areaMinima: 4 }, opciones || {});
  let loops = trazarContornos(mascara, w, h);
  loops = loops
    .map(l => {
      let p = simplificarLoop(l, op.tolerancia);
      if (op.suavizar) p = simplificarLoop(suavizarLoop(p, op.suavizar), op.tolerancia * 0.5);
      return p;
    })
    .filter(l => l.length >= 3 && Math.abs(areaFirmada(l)) > op.areaMinima);
  return anidarLoops(loops);
}

// ------------------------------------------------------------------
// SVG
// ------------------------------------------------------------------

const f2 = n => (Math.round(n * 100) / 100).toString();

// Path de una pieza (con sus agujeros) en mm. `escala` = mm por píxel.
export function pathDePieza(pieza, escala, dx, dy) {
  const anillo = pts => {
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      d += (i ? 'L' : 'M') + f2(pts[i][0] * escala + (dx || 0)) + ' ' + f2(pts[i][1] * escala + (dy || 0));
    }
    return d + 'Z';
  };
  let d = anillo(pieza.pts);
  for (const a of pieza.agujeros) d += anillo(a);
  return d;
}

// Arma un SVG completo en milímetros con una pieza por <path>.
// piezas: [{pts, agujeros}], en píxeles; pxPorMm: resolución de la máscara.
// opciones: { anchoMm, altoMm, id, titulo, espejo, color, recortarCaja }
export function svgDesdeContornos(piezas, pxPorMm, opciones) {
  const op = Object.assign({ color: '#000000', espejo: false, recortarCaja: false, margenMm: 0 }, opciones || {});
  const escala = 1 / pxPorMm;
  let anchoMm = op.anchoMm, altoMm = op.altoMm, dx = 0, dy = 0;
  if (op.recortarCaja && piezas.length) {
    const caja = cajaGlobal(piezas);
    dx = -caja.x0 * escala + op.margenMm;
    dy = -caja.y0 * escala + op.margenMm;
    anchoMm = caja.w * escala + 2 * op.margenMm;
    altoMm = caja.h * escala + 2 * op.margenMm;
  }
  const paths = piezas.map((p, i) => `  <path id="pieza-${i + 1}" fill-rule="evenodd" d="${pathDePieza(p, escala, dx, dy)}"/>`).join('\n');
  const transform = op.espejo ? ` transform="translate(${f2(anchoMm)} 0) scale(-1 1)"` : '';
  const titulo = op.titulo ? `  <title>${escaparXml(op.titulo)}</title>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f2(anchoMm)}mm" height="${f2(altoMm)}mm" viewBox="0 0 ${f2(anchoMm)} ${f2(altoMm)}"${op.id ? ` id="${escaparXml(op.id)}"` : ''}>
${titulo}  <g fill="${op.color}" stroke="none"${transform}>
${paths}
  </g>
</svg>
`;
}

export function cajaGlobal(piezas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of piezas) {
    const c = p.caja || cajaDe(p.pts);
    if (c.x0 < x0) x0 = c.x0; if (c.x1 > x1) x1 = c.x1;
    if (c.y0 < y0) y0 = c.y0; if (c.y1 > y1) y1 = c.y1;
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function escaparXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Diagnóstico de la pieza para el corte
// ------------------------------------------------------------------

// Devuelve avisos sobre piezas sueltas, detalles finos y agujeros mínimos.
// pxPorMm: resolución; minDetalleMm: ancho mínimo recomendado (vinilo ≈ 1,5 mm).
export function diagnosticarPiezas(piezas, pxPorMm, minDetalleMm) {
  const avisos = [];
  const minDet = (minDetalleMm || 1.5) * pxPorMm;
  const sueltas = piezas.length;
  if (sueltas === 0) avisos.push({ tipo: 'error', texto: 'El diseño está vacío: no hay nada para cortar.' });
  if (sueltas > 1) {
    avisos.push({ tipo: 'aviso', texto: `El diseño tiene ${sueltas} piezas separadas. Al cortar quedan sueltas: si va pegado en acetato o con papel de transferencia está bien; si querés una sola pieza, unilas con un puente (una forma delgada) o con el marco.` });
  }
  let chicas = 0, agujerosChicos = 0;
  for (const p of piezas) {
    const c = p.caja || cajaDe(p.pts);
    if (c.w < minDet || c.h < minDet) chicas++;
    for (const a of p.agujeros) {
      const ca = cajaDe(a);
      if (ca.w < minDet || ca.h < minDet) agujerosChicos++;
    }
  }
  if (chicas) avisos.push({ tipo: 'aviso', texto: `${chicas} pieza${chicas > 1 ? 's' : ''} mide${chicas > 1 ? 'n' : ''} menos de ${minDetalleMm || 1.5} mm: la cortadora las levanta o las rompe. Usá «Limpiar manchas» o engrosá el diseño.` });
  if (agujerosChicos) avisos.push({ tipo: 'aviso', texto: `${agujerosChicos} agujero${agujerosChicos > 1 ? 's' : ''} muy chico${agujerosChicos > 1 ? 's' : ''} (menos de ${minDetalleMm || 1.5} mm): en vinilo son casi imposibles de despegar. Suavizá o engrosá el diseño.` });
  return avisos;
}

// ------------------------------------------------------------------
// Empaquetado en el tapete (para cortar varios diseños de una vez)
// ------------------------------------------------------------------

// items: [{id, anchoMm, altoMm}] → posiciones [{id, x, y, rotado}] en un
// tapete de anchoMm × altoMm con separación `sepMm`. Algoritmo de
// estanterías (shelf packing) ordenando por alto; devuelve también lo que
// no entró.
export function empaquetar(items, anchoMat, altoMat, sepMm) {
  const sep = sepMm == null ? 4 : sepMm;
  const orden = items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => Math.max(b.altoMm, b.anchoMm) - Math.max(a.altoMm, a.anchoMm));
  const colocados = [], sinLugar = [];
  const estantes = []; // {y, alto, xLibre}
  for (const it of orden) {
    let w = it.anchoMm, h = it.altoMm, rotado = false;
    if (w > anchoMat && h <= anchoMat && w <= altoMat) { [w, h] = [h, w]; rotado = true; }
    if (w > anchoMat || h > altoMat) { sinLugar.push(it); continue; }
    let puesto = false;
    for (const e of estantes) {
      // probar girada si así encaja en el estante
      let ww = w, hh = h, rot = rotado;
      if (hh > e.alto && ww <= e.alto && e.xLibre + hh + sep <= anchoMat + 1e-6) { [ww, hh] = [hh, ww]; rot = !rot; }
      if (hh <= e.alto + 1e-6 && e.xLibre + ww <= anchoMat + 1e-6) {
        colocados.push({ id: it.id, x: e.xLibre, y: e.y, rotado: rot, anchoMm: ww, altoMm: hh });
        e.xLibre += ww + sep;
        puesto = true; break;
      }
    }
    if (puesto) continue;
    const ultimo = estantes[estantes.length - 1];
    const yNuevo = ultimo ? ultimo.y + ultimo.alto + sep : 0;
    if (yNuevo + h <= altoMat + 1e-6) {
      estantes.push({ y: yNuevo, alto: h, xLibre: w + sep });
      colocados.push({ id: it.id, x: 0, y: yNuevo, rotado, anchoMm: w, altoMm: h });
    } else sinLugar.push(it);
  }
  return { colocados, sinLugar };
}

// Arma el SVG del tapete con varios diseños ya vectorizados.
// disenos: [{id, nombre, piezas, pxPorMm}]; devuelve {svg, colocados, sinLugar}.
export function svgTapete(disenos, opciones) {
  const op = Object.assign({ anchoMat: 304.8, altoMat: 304.8, sepMm: 4, margenMm: 6, color: '#000000', espejo: false }, opciones || {});
  const items = disenos.map(d => {
    const caja = cajaGlobal(d.piezas);
    return { id: d.id, anchoMm: caja.w / d.pxPorMm, altoMm: caja.h / d.pxPorMm, caja, d };
  }).filter(it => it.anchoMm > 0 && it.altoMm > 0);
  const util = { w: op.anchoMat - 2 * op.margenMm, h: op.altoMat - 2 * op.margenMm };
  const { colocados, sinLugar } = empaquetar(items, util.w, util.h, op.sepMm);
  const porId = new Map(items.map(it => [it.id, it]));
  const grupos = colocados.map(c => {
    const it = porId.get(c.id);
    const escala = 1 / it.d.pxPorMm;
    const x = c.x + op.margenMm, y = c.y + op.margenMm;
    let transform;
    if (c.rotado) {
      // giro de 90° alrededor de la esquina: la caja rotada ocupa (x, y, alto, ancho)
      transform = `translate(${f2(x + it.altoMm)} ${f2(y)}) rotate(90) translate(${f2(-it.caja.x0 * escala)} ${f2(-it.caja.y0 * escala)})`;
    } else {
      transform = `translate(${f2(x - it.caja.x0 * escala)} ${f2(y - it.caja.y0 * escala)})`;
    }
    const paths = it.d.piezas.map((p, i) => `    <path id="${escaparXml(c.id)}-${i + 1}" fill-rule="evenodd" d="${pathDePieza(p, escala, 0, 0)}"/>`).join('\n');
    return `  <g id="${escaparXml(c.id)}" data-nombre="${escaparXml(it.d.nombre || c.id)}" transform="${transform}">\n${paths}\n  </g>`;
  }).join('\n');
  const espejo = op.espejo ? ` transform="translate(${f2(op.anchoMat)} 0) scale(-1 1)"` : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f2(op.anchoMat)}mm" height="${f2(op.altoMat)}mm" viewBox="0 0 ${f2(op.anchoMat)} ${f2(op.altoMat)}">
  <title>Tapete de corte</title>
  <g fill="${op.color}" stroke="none"${espejo}>
${grupos}
  </g>
</svg>
`;
  return { svg, colocados: colocados.map(c => ({ ...c, x: c.x + op.margenMm, y: c.y + op.margenMm, nombre: (porId.get(c.id).d.nombre || c.id) })), sinLugar: sinLugar.map(s => ({ id: s.id, nombre: s.d.nombre || s.id })) };
}

// ------------------------------------------------------------------
// Utilidades de máscara
// ------------------------------------------------------------------

// Componentes conexos (4-vecinos) sobre una máscara binaria; borra los que
// tienen menos de `areaMinima` píxeles. Se aplica a la figura y, si
// `tambienAgujeros`, a los huecos (invirtiendo la máscara).
export function limpiarManchas(mascara, w, h, areaMinima, tambienAgujeros) {
  const quitar = (m, valor) => {
    const etiq = new Int32Array(w * h);
    const pila = new Int32Array(w * h);
    let siguiente = 1;
    for (let i = 0; i < w * h; i++) {
      if (m[i] !== valor || etiq[i]) continue;
      let top = 0, cuenta = 0;
      pila[top++] = i; etiq[i] = siguiente;
      const lista = [];
      while (top) {
        const p = pila[--top];
        lista.push(p); cuenta++;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && m[p - 1] === valor && !etiq[p - 1]) { etiq[p - 1] = siguiente; pila[top++] = p - 1; }
        if (x < w - 1 && m[p + 1] === valor && !etiq[p + 1]) { etiq[p + 1] = siguiente; pila[top++] = p + 1; }
        if (y > 0 && m[p - w] === valor && !etiq[p - w]) { etiq[p - w] = siguiente; pila[top++] = p - w; }
        if (y < h - 1 && m[p + w] === valor && !etiq[p + w]) { etiq[p + w] = siguiente; pila[top++] = p + w; }
      }
      if (cuenta < areaMinima) for (const q of lista) m[q] = valor ? 0 : 1;
      siguiente++;
    }
  };
  quitar(mascara, 1);
  if (tambienAgujeros) {
    // sólo los huecos que no tocan el borde (los del borde son fondo)
    const toca = new Uint8Array(w * h);
    const pila = [];
    for (let x = 0; x < w; x++) { pila.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { pila.push(y * w, y * w + w - 1); }
    while (pila.length) {
      const p = pila.pop();
      if (mascara[p] || toca[p]) continue;
      toca[p] = 1;
      const x = p % w, y = (p - x) / w;
      if (x > 0) pila.push(p - 1); if (x < w - 1) pila.push(p + 1);
      if (y > 0) pila.push(p - w); if (y < h - 1) pila.push(p + w);
    }
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = (!mascara[i] && !toca[i]) ? 1 : 0;
    quitar(inv, 1);
    for (let i = 0; i < w * h; i++) if (!mascara[i] && !toca[i] && !inv[i]) mascara[i] = 1;
  }
  return mascara;
}

// Dilatación / erosión con elemento circular de radio r (px). Separable
// aproximada: dos pasadas de máximo/mínimo en cuadrado y luego recorte
// por distancia; suficiente para engrosar o afinar unos milímetros.
export function morfologia(mascara, w, h, r, dilatar) {
  if (r <= 0) return mascara;
  const R = Math.round(r);
  const val = dilatar ? 1 : 0;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const fila = y * w;
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = -R; k <= R; k++) {
        const xx = x + k;
        const m = (xx < 0 || xx >= w) ? (dilatar ? 0 : 0) : mascara[fila + xx];
        if (m === val) { hit = 1; break; }
      }
      tmp[fila + x] = hit ? val : (1 - val);
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let hit = 0;
      for (let k = -R; k <= R; k++) {
        const yy = y + k;
        const m = (yy < 0 || yy >= h) ? (dilatar ? 0 : 0) : tmp[yy * w + x];
        if (m === val) { hit = 1; break; }
      }
      out[y * w + x] = hit ? val : (1 - val);
    }
  }
  return out;
}

// Cierra grietas (dilata y erosiona) o abre (erosiona y dilata).
export function cerrar(mascara, w, h, r) { return morfologia(morfologia(mascara, w, h, r, true), w, h, r, false); }
export function abrir(mascara, w, h, r) { return morfologia(morfologia(mascara, w, h, r, false), w, h, r, true); }

// Máscara desde el canal alfa de un ImageData (umbral 0..255).
export function mascaraDesdeAlfa(datos, w, h, umbral) {
  const m = new Uint8Array(w * h);
  const u = umbral == null ? 128 : umbral;
  for (let i = 0, p = 3; i < w * h; i++, p += 4) m[i] = datos[p] >= u ? 1 : 0;
  return m;
}
