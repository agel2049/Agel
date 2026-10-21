# Maqueta virtual y AR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Mejorar la maqueta GLB y permitir colocarla en una superficie mediante AR sin cargas automáticas.

**Architecture:** Separar cálculo de cámara, ciclo XR y UI. Compartir la presentación entre el GLB personal y el showroom público, preservando la carga y permisos de cada entrada.

**Tech Stack:** JavaScript clásico, Three.js 0.128.0, WebXR hit-test, model-viewer 3.5.0 para Quick Look, Node tests y Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-maqueta-ar-design.md`

## Global Constraints

- No modificar `packages/panorama/pano-engine.js` ni probar manualmente el visor 360.
- No Power BI, cambios de esquema, cargas automáticas, nuevas credenciales.
- Mantener Three.js 0.128.0 y aislar model-viewer del global THREE.
- UI oscura, acento arena, controles glass y modelo a pantalla completa.
- Pruebas físicas AR pendientes hasta disponer de teléfonos; no declararlas aprobadas.

## Review Focus

- Cierre o cambio de cuenta mientras se solicita cámara: terminar la sesión tardía, sin render residual.
- Negación de permisos o falta de hit-test: devolver control sin perder el archivo.
- Modelo con altura/anchura extrema o origen alejado: escala finita y base sobre superficie.
- Filtro vacío y mallas anidadas: no reaparecen piezas ocultas en XR.
- Showroom público/cierre móvil: retorno con foco y ninguna escritura ni carga automática.

### Task 1: Cámara y controles de maqueta

**Files:** Crear `packages/bim/maquette-math.js`, `tests/unit_maquette_math.cjs`; modificar `packages/bim/glb-viewer.js`, `tests/e2e_glb_local.py`, fixture GLB.

**Interfaces:** `AgelMaquetteMath.view(name)` devuelve dirección/up; `scaleFor(width, size)` devuelve escala positiva. Renderer agrega `setView(name)`, `zoom(factor)`, `setSpin(enabled)`, `pan(x,y)` y `snapshot()`; conserva `elements`, `filter`, `fit`, `dispose`.

- [ ] Escribir y ejecutar pruebas RED: `assert.deepEqual(math.view('top').direction,[0,1,0]); assert.equal(math.scaleFor(20,1),.05)`; comprobar rechazo de tamaños inválidos.
- [ ] Implementar matemáticas y aplicar poses/zoom/pan/giro al renderer. Usar render bajo demanda salvo giro o XR.
- [ ] Ejecutar `node --test tests/unit_maquette_math.cjs`; ampliar navegador GLB para comprobar vistas, imagen distinta, filtro vacío y limpieza.
- [ ] Registrar resultado y commit del componente.

### Task 2: Ciclo AR y Quick Look

**Files:** Crear `packages/bim/glb-ar.js`, `tests/unit_glb_ar.cjs`; integrar en `glb-viewer.js`.

**Interfaces:** `AgelGLBAR.create({renderer,scene,camera,model,bounds,controls,onState,draw})` devuelve `supported()`, `start(overlay)`, `reposition()`, `setSize(meters)`, `rotate()`, `end()`, `dispose()`; renderer expone `ar` y conserva su escena. `AgelGLBAR.quickLook({blob,width,host})` prepara visor aislado y devuelve `open()`/`dispose()`.

- [ ] Escribir RED con sesión XR simulada: requestSession denegada, sesión tardía tras dispose, hit-test sin resultados, colocación y restauración. Usar Three real para matrices.
- [ ] Implementar requestSession en acción de usuario con hit-test requerido y dom-overlay opcional, retícula y transformación en metros; detener fuentes/eventos/loops al salir.
- [ ] Implementar preparación diferida de Quick Look con Blob URL local, carga/reintento acotados, revocación y limpieza. Nunca invocar Scene Viewer para un Blob local.
- [ ] Ejecutar `node --test tests/unit_glb_ar.cjs tests/unit_maquette_math.cjs` y verificar poses con fuente XR falsa.
- [ ] Registrar resultado y commit del componente.

### Task 3: Interfaz compartida y entradas

**Files:** Crear `packages/bim/maquette.js`, `packages/bim/maquette.css`; modificar `apps/bim/local-glb.js`, `apps/bim/index.html`, `apps/showroom/showroom.js`, `apps/showroom/index.html`, `apps/showroom/experience.js`, `packages/showroom/render.js`; agregar `tests/e2e_maquette.py`.

**Interfaces:** `AgelMaquette.mount(host,{blob,title,onClose,onLoaded})` devuelve `dispose()`; el propietario de la entrada controla permisos y cierre. `onModel` abre el modelo GLB público en diálogo; la entrada local conserva `onLocalModel`.

- [ ] Escribir RED de navegador: `get_by_role('combobox',name='Vista de maqueta')`, vistas, zoom, giro, filtros, ausencia AR, error GLB y cierre. Repetir ruta local con cambio de cuenta y cero escrituras.
- [ ] Construir interfaz, panel plegable, barra de cámara y controles AR con estados. En móvil iniciar filtros plegados; no ocultar todos los controles detrás del panel.
- [ ] Conectar carga local y diálogo público; mantener glTF público anterior y no descargar SDK antes del clic.
- [ ] Ejecutar pruebas nuevas y suites GLB/local existentes. Inspeccionar capturas de escritorio y móvil en un lote; corregir defectos juntos y confirmar una vez.
- [ ] Registrar resultado y commit de la integración.

### Task 4: Verificación y publicación

**Files:** Modificar `.github/workflows/pruebas.yml`; crear `docs/MAQUETA-Y-AR.md`.

**Interfaces:** CI incluye pruebas nuevas y existentes; documentación distingue controles disponibles de la comprobación física pendiente.

- [ ] Incorporar comandos: `node --test tests/unit_maquette_math.cjs tests/unit_glb_ar.cjs` y `python tests/e2e_maquette.py`.
- [ ] Ejecutar sintaxis, módulos, suites UI afectadas y comprobar hash de panorama contra base. Verificar diff y ausencia de secretos.
- [ ] Revisión independiente de rama completa; corregir problemas importantes con regresión antes de publicar.
- [ ] Publicar mediante PR/CI usando la autorización existente; comprobar la versión desplegada y entregar instrucciones y límites físicos AR.
