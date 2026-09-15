# Shadow Casters — Taller de sombras

Plataforma web para niños y adolescentes, con la distribución y la estética de
**Scratch**: una barra lateral de bloques de colores, un **lienzo** de trabajo al
centro y un **escenario** de previsualización a la derecha. Todo ocurre en una
sola pantalla. Los estudiantes arman su silueta con fotos (sin fondo), textos y
formas, ven la sombra proyectada y descargan el **SVG listo para la Cricut o la
láser**. Inspirado en [Shadow Scenes](https://k12maker.mit.edu/project/shadow-scenes)
(MIT K12 Maker) y en la página *Sombras recortadas* del
[Generador de Actividades](https://martinferreirahca.github.io/actividadesplataforma/sombras.html).

Interfaz en **español** (principal) e **inglés** (botón ES / EN).

## Qué hay

- **Portal de entrada**
  - *Soy estudiante*: código de la clase + nombre. Si vuelve con el mismo nombre
    (otro día, otra compu) su diseño se retoma. Con `?clase=CODIGO` en la URL el
    código viene prellenado.
  - *Soy docente*: crea clases (puede tener **varias abiertas a la vez**, en
    pestañas), comparte el código o el enlace, ve los diseños de todos **en
    tiempo real**, los abre para retocarlos, descarga SVG por estudiante o arma
    un **tapete de 12 × 12"** con los marcados, manda mensajes, exporta/importa la
    clase o los `.json` de estudiantes.
  - *Diseñar por mi cuenta*: sin clase; se guarda en el navegador.
  - *Mis proyectos en esta computadora*: galería con miniaturas para seguir donde
    se dejó.
- **Taller** (una pantalla, como Scratch)
  - Bloques por categoría: Imágenes (subir / cámara, quitar fondo, silueta),
    Texto (fuentes, tamaño, espaciado), Formas, Editar (suma/resta, centrar,
    espejar, orden), Pieza (tamaño en mm, base/marco/ventana, espejo) y Cortar
    (tapete, SVG, PNG, guardar/abrir `.json`). Se hace clic o se **arrastran al
    lienzo**.
  - Lienzo con manijas para mover, escalar y girar; zoom; arrastrar o pegar
    imágenes; atajos de teclado.
  - Escenario con la **pieza a tamaño real y sus medidas**, la **sombra
    proyectada** (bandera verde; el mouse mueve la luz) y el **tapete** de la
    cortadora con avisos (piezas sueltas, detalles finos).
  - Lista de capas con miniaturas (como los objetos de Scratch) y panel de
    información de la capa.
- **Guardado**: automático en el navegador (IndexedDB) y descarga como
  `.sombra.json` para seguir en casa sin depender de que la clase siga abierta.
  Los archivos son compatibles con *Sombras recortadas* del Generador de
  Actividades.

## Cómo funciona la clase

No hay servidor propio. La clase vive en el navegador del docente: los
estudiantes se conectan directo (WebRTC con [PeerJS](https://peerjs.com) como
servidor de señales). Si la pestaña del docente se cierra, los estudiantes siguen
trabajando y todo se sincroniza cuando la vuelve a abrir. Si la red del colegio
bloquea la conexión, queda el camino de los archivos `.json` (exportar /
importar). Para usar un servidor de señales propio, definir antes de cargar la
página:

```html
<script>window.SHADOWCASTERS_PEER = { host: '192.168.1.10', port: 9000, path: '/', secure: false };</script>
```

## Publicar

Es un sitio estático: alcanza con activar **GitHub Pages** sobre la rama
principal (carpeta raíz). Para probar en local:

```bash
python3 -m http.server 8123
# abrir http://localhost:8123/
```

La cámara y el portapapeles requieren `https://` o `localhost`.

## Estructura

```
index.html        pantalla única: portal, panel del docente y taller
css/estilo.css    estética Scratch (colores por categoría, bloques, escenario)
js/app.js         el editor: paleta de bloques, lienzo, escenario, capas
js/clase.js       portal, clases del docente, sincronización, guardado
js/aula.js        red (PeerJS) y almacenamiento (IndexedDB)
js/render.js      modelo del proyecto, quitar fondo, texto, formas, composición
js/vector.js      vectorización a SVG, tapete, diagnóstico de piezas
js/i18n.js        traducción (español base) · js/idioma-en.js diccionario inglés
vendor/peerjs.min.js
```

`render.js`, `vector.js` y `aula.js` vienen del repositorio
[actividadesplataforma](https://github.com/martinferreiraHCA/actividadesplataforma)
para que los proyectos sean intercambiables entre las dos herramientas.
