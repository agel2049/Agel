# Vista previa local y filtros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is inline under the user's existing full authorization.

**Goal:** Permitir Opening grande y GLB con filtros en la experiencia local sin subir archivos.
**Architecture:** Corregir la frontera local de medios; reutilizar Three/GLTF para GLB y APS para Navisworks. La autoría y la vista previa comparten borrador y cuenta.
**Tech Stack:** JavaScript sin compilación, IndexedDB, Three r128, GLTFLoader/OrbitControls/DRACO, APS existente, Python/Playwright.
**Spec:** docs/superpowers/specs/2026-10-15-local-preview-filters-design.md

## Global Constraints

- Motor panorama sin cambios y sin pruebas manuales del visor anterior.
- Ninguna selección de archivo envía bytes a un servidor.
- Conservar permisos y límites de sincronización explícita.
- Ninguna migración ni cambio de cuota es necesario.

## Review Focus

- Cambio de cuenta durante lectura/guardado: no aplicar Blob ajeno ni guardar metadata en otra cuenta.
- Falta de espacio: conservar video anterior y no anunciar éxito.
- GLB sin piezas o sin propiedades: mostrar geometría y filtros reales, sin disciplinas inventadas.
- Recursos externos de GLB: impedir solicitudes arbitrarias; admitir texturas embebidas.
- Filtro vacío y cierre: no mostrar todo accidentalmente; liberar render y GPU.

### Task 1: Opening personal

**Files:** index.html; apps/editor/cloud-mode.js; tests/fixtures/vm-local-videos.html; tests/e2e_opening_video_local.py.
**Interfaces:** vmHandleVideo(type,event), vmLoadLocalVideos(), vmRemoveVideo(type); consume AgelLocalMedia.open({ownerId,projectId}).

- [ ] Escribir prueba real de selección de 80 MiB, cero POST, recarga, sustitución fallida, retirada y cuenta distinta.
- [ ] Ejecutar y observar fallo por POST heredado.
- [ ] Guardar Blob/metadata personal antes de aplicar UI, resolver al cargar y limpiar URLs. Incluir Opening en vista previa del botón existente. Evitar Blob en links compartidos.
- [ ] Ejecutar prueba, sintaxis y regresiones de editor; commit de corrección.

### Task 2: GLB local y filtros

**Files:** packages/core/workspace.js; packages/bim/glb-filters.js; packages/bim/glb-viewer.js; tests/unit_glb_filters.cjs; tests/e2e_glb_local.py; fixtures GLB de prueba.
**Interfaces:** AgelGLBFilters.describe(mesh,ancestors), select(elements,{facets,query,preset}), facets(elements); AgelGLB.open(container,{blob}) → {elements,filter,fit,dispose}.

- [ ] Probar pérdida del GLB en preview, selección OR dentro de faceta/AND entre facetas, clasificación desconocida, resultado vacío y rechazo de recursos externos.
- [ ] Observar fallos antes de implementación.
- [ ] Conservar extensión en placeholder local. Cargar GLB autocontenido y devolver metadata real; filtro actualiza visibilidad sin mostrar todos cuando no coincide ninguno. Controles orbitales y encuadre de selección.
- [ ] Probar con GLB de tres piezas y materiales distintos, canvas real y liberación; commit.

### Task 3: Integración de modelos

**Files:** apps/bim/local-glb.js; apps/bim/index.html; apps/bim/bim.js; apps/bim/bim.css; apps/panel/panel.js; apps/showroom/showroom.js; apps/showroom/experience.js; tests/e2e_bim.py; tests/e2e_local_experience_full.py.
**Interfaces:** AgelLocalGLB.mount(app,{cloud,projectId,returnUrl}); acceso local via AgelWorkspace; entrada APS existente conserva autenticación.

- [ ] Probar GLB ya subido desde showroom visible en Modelos y 4D, enlace local correcto, Opening grande reproducible, fachada/entrada y acceso a filtros sin POST.
- [ ] Observar falla de integración previa.
- [ ] Añadir tarjeta y entrada GLB local; simplificar navegación APS a filtros conservando backend. Reutilizar retorno seguro y controles glass de la experiencia.
- [ ] Adaptar pruebas a navegación solicitada; verificar no hay incidencias ni responsables en UI, acceso privado y preservación del borrador; commit.

### Task 4: Entrega

**Files:** .github/workflows/pruebas.yml; docs/SHOWROOM-INMERSIVO.md; CAMBIOS.md.

- [ ] Incluir suites nuevas, ejecutar pruebas adecuadas y sintaxis; confirmar motor intacto.
- [ ] Una revisión independiente de toda la rama; un pase RED→GREEN para hallazgos importantes.
- [ ] Crear/adjuntar PR, confirmar CI, integrar y comprobar archivos publicados exactos bajo autorización existente.
- [ ] Informar límites físicos y conexión APS real pendiente si no hay credenciales; no afirmar lectura local de NWD.
