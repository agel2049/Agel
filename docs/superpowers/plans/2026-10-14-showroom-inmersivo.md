# Showroom inmersivo de AgelArq — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar el recorrido Opening → fachada → lobby/nivel → planta/unidad → 360 con miniplano, con identidad AgelArq, dibujo mejorado, archivos locales y BIM privado.

**Architecture:** Extender las aplicaciones existentes mediante módulos pequeños de relaciones, geometría, medios locales, sincronización y experiencia pública. El panel y el showroom compartirán validación y geometría. `PanoEngine` se integra como dependencia existente y no se reescribe.

**Tech Stack:** JavaScript sin framework, CSS, SVG, IndexedDB, APIs de archivos del navegador con detección de soporte, PostgreSQL/Supabase RLS, GitHub Pages, Node 22 para pruebas puras y Playwright para las interfaces nuevas.

**Spec:** [Diseño aprobado y ajustes de dibujo](../specs/2026-10-14-showroom-inmersivo-design.md).

## Global Constraints

- El motor 360 existente se conserva.
- No se repiten pruebas manuales del visor anterior.
- El acceso BIM será únicamente para el equipo con cuenta y permisos del proyecto.
- No existe Ending.
- Fondo `#0D0D0D`, texto `#EFEFEF`, acento arena/dorado `#B89D74`.
- Interacciones breves de 120–180 ms; paneles de 220–320 ms; cambios de vista de 400–550 ms, con la curva AgelArq `cubic-bezier(.22,1,.36,1)`.
- Conservar presupuesto global de 800 MB y máximos actuales de los buckets.
- No ampliar el plan ni abrir la subida pública antigua.
- No iniciar conversiones de Autodesk ni servicios de pago automáticamente.
- Mantener las versiones publicadas anteriores inmutables y los enlaces históricos.
- No anunciar tamaños ilimitados ni una conexión real con Autodesk antes de contar con credenciales y modelo listo.
- El botón 90° puede alternarse dentro de una misma figura; conserva todos los puntos anteriores.
- Las áreas del showroom son transparentes en reposo; el panel de edición conserva sus guías visibles.
- Para pruebas, usar fixtures locales pequeños; no subir medios grandes ni borrar archivos de producción.

## Review Focus

1. Un espacio eliminado, extranjero o con parentesco cíclico debe producir un alcance vacío o error explícito, nunca todas las escenas; fijarlo en tareas 1 y 8.
2. Figuras cóncavas, lados diminutos y alternancia 90° durante una figura no deben deformar datos, generar curvas no finitas ni perder puntos; fijarlo en tareas 2 y 3.
3. Cierre de sesión, otra cuenta, navegación privada y falta de cuota no deben mezclar borradores ni anunciar un guardado que falló; fijarlo en tareas 5 y 6.
4. Un archivo ya subido, una reserva pendiente y un conflicto de revisión después de sincronizar deben conservar el trabajo y evitar duplicados; fijarlo en tareas 7 y 8.
5. Destinos manipulados, video rechazado por el navegador y BIM solicitado por un anónimo no deben abrir recursos privados ni bloquear el regreso; fijarlo en tareas 9, 10 y 13.

## Secuencia de entregas y contratos

Cuatro entregas coordinadas, con tareas que se pueden revisar de forma independiente:

1. Relaciones, geometría, panel de áreas y niveles: tareas 1–4.
2. Medios locales, sincronización y publicación segura: tareas 5–8.
3. Experiencia pública, Opening, diseño y miniplano: tareas 9–12.
4. BIM privado, presets y publicación de la entrega completa: tareas 13–14.

No presentar la primera entrega como si fuera el showroom completo. No crear un PR por cada documento; usar una rama de implementación y commits por tarea, con un PR final revisable.

### Formato compartido

```js
// Autoría: IDs estables. Referencias locales se resuelven solo en el dispositivo.
const exampleView = {
  id: 'planta-101', title: 'Planta departamento 101', kind: 'plano',
  role: 'unit', spaceId: 'uuid-unidad', image: 'agel-local:uuid-medio', w: 1600, h: 900,
  regions: [{ id: 'zona-sala', space: 'uuid-unidad', points: [[10,10],[40,10],[40,40]],
    radius: 0.5, target: { type: 'scene', id: 'uuid-escena' } }],
  spots: [{ scene: 'uuid-escena', x: 20, y: 25 }]
};
const exampleExperience = {
  version: 1, facadeViewId: 'fachada', entryTargetViewId: 'lobby',
  entrance: { x: 50, y: 70, label: 'Entrar al lobby' }
};
```

`radius` representa porcentaje del lado menor de la imagen, en el intervalo 0–2. `spaceId:null` representa alcance de proyecto. `role` admite `facade`, `lobby`, `floor`, `unit`. El manifiesto público usa HTTPS y conserva UUIDs; los índices de escenas antiguos se resuelven mediante un adaptador de compatibilidad.

`opening` usa como contrato nuevo `{enabled,video,poster,title,subtitle,button}` sin Ending. El adaptador traduce los nombres del formato antiguo de `sanitizeVisorConfig` a ese contrato, conservando publicaciones anteriores; ninguna tarea posterior consume directamente los nombres antiguos.

## Task 1: Relaciones, alcance y normalización de vistas

**Files:** Create `packages/showroom/relations.js`, `tests/unit_showroom_relations.cjs`; Modify `packages/core/schema.js`.

**Interfaces:** `AgelShowroomRelations.normalizeSpaces(spaces,scenes)` produce espacios con `sceneIds:string[]`. `sceneIdsForScope(spaceId,spaces,scenes)` devuelve UUIDs válidos y sin duplicados. `normalizeExperience(raw,spaces,scenes,{publicMode})` valida la experiencia, vistas, destinos y límites; devuelve `{experience,views,opening,problems}`. El mismo módulo expone CommonJS en Node e IIFE global en navegador.

- [ ] Escribir la prueba inicial y ejecutarla con `node --test tests/unit_showroom_relations.cjs`; debe fallar porque el módulo aún no existe.

```js
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../packages/showroom/relations.js');
test('una unidad no hereda escenas de su hermana', () => {
  const spaces=[{id:'n',parent_id:null,sceneIds:[]},
    {id:'a',parent_id:'n',sceneIds:['sa']},{id:'b',parent_id:'n',sceneIds:['sb']}];
  const scenes=[{id:'sa'},{id:'sb'}];
  assert.deepEqual(R.sceneIdsForScope('a',spaces,scenes),['sa']);
  assert.deepEqual(R.sceneIdsForScope('n',spaces,scenes),['sa','sb']);
  assert.deepEqual(R.sceneIdsForScope('inexistente',spaces,scenes),[]);
});
```

- [ ] Implementar recorrido por descendientes con conjunto de visitados; un ID desconocido no representa proyecto. Normalizar `scene_ids` de autoría y `scenes` por índice del formato antiguo antes de filtrar.

```js
function sceneIdsForScope(spaceId, spaces, scenes) {
  const valid = new Set(scenes.map(s=>s.id));
  if (spaceId === null) return [...valid];
  if (!spaces.some(s=>s.id===spaceId)) return [];
  const ids=new Set(), visited=new Set(), queue=[spaceId];
  while(queue.length){const id=queue.shift();if(visited.has(id))throw new Error('Jerarquía cíclica');visited.add(id);
    const s=spaces.find(s=>s.id===id);if(s)for(const sid of s.sceneIds||[])if(valid.has(sid))ids.add(sid);
    for(const child of spaces)if(child.parent_id===id)queue.push(child.id);
  }return [...ids];
}
```

- [ ] Añadir pruebas de ciclo, escenas compartidas, alcance vacío, 9 vistas conservadas, 257 vistas rechazadas, vista con imagen sin zonas conservada y referencias locales rechazadas en `publicMode`.
- [ ] Conectar `sanitizeShowroom` al normalizador, conservar campos desconocidos fuera del manifiesto público y adaptar UUIDs a índices únicamente donde el renderer antiguo lo necesite.
- [ ] Ejecutar la prueba hasta PASS y `node tests/syntax.js index.html apps/showroom/index.html apps/panel/index.html`; hacer commit `feat: validate showroom views and scene scope`.

## Task 2: Geometría de dibujo a 90° y curvas de esquinas

**Files:** Create `packages/showroom/geometry.js`, `tests/unit_showroom_geometry.cjs`.

**Interfaces:** `snapPoint(previous,candidate,orthogonal)` usa puntos `[x,y]` en porcentaje. `validatePolygon(points,{w,h})` devuelve `{valid,reason}`. `roundedPath(points,{w,h,radius})` produce un SVG `d` en coordenadas de imagen, sin alterar `points`.

- [ ] Escribir y ejecutar `node --test tests/unit_showroom_geometry.cjs` esperando FAIL por módulo ausente.

```js
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../packages/showroom/geometry.js');
test('90 grados solo restringe el nuevo segmento',()=>{
 const points=[[10,10],[40,10]];
 assert.deepEqual(G.snapPoint(points.at(-1),[42,35],true),[40,35]);
 assert.deepEqual(G.snapPoint(points.at(-1),[42,35],false),[42,35]);
 assert.deepEqual(points,[[10,10],[40,10]]);
});
test('curvas finitas sin mutar el contorno',()=>{
 const p=[[0,0],[80,0],[80,80],[40,40],[0,80]],before=JSON.stringify(p);
 const d=G.roundedPath(p,{w:1600,h:900,radius:2});
 assert.ok(d.includes('Q'));assert.ok(!/NaN|Infinity/.test(d));
 assert.equal(JSON.stringify(p),before);
});
```

- [ ] Implementar el eje más cercano y el redondeo en píxeles de imagen, no en el SVG deformado de 100×100.

```js
const snapPoint=(a,b,on)=>!on||!a?b.slice():
  Math.abs(b[0]-a[0])>=Math.abs(b[1]-a[1])?[b[0],a[1]]:[a[0],b[1]];
// En cada vértice curvar desde el punto de entrada hasta el de salida con Q.
// d = min(radio * min(w,h)/100, longitudAnterior/2, longitudSiguiente/2).
// Radio cero produce M/L/Z. Validar intersecciones antes de generar curvas.
```

- [ ] Añadir casos de radio cero, lados cortos, vértice repetido, área cero, auto-intersección, figura cóncava simple, relación de aspecto y límites 0/2. Rechazar intersecciones introducidas por curvas reduciendo radio hasta un contorno simple; comunicar el ajuste.
- [ ] Confirmar PASS y hacer commit `feat: add orthogonal drawing and rounded polygon geometry`.

## Task 3: Editor de áreas con alcance y controles de dibujo

**Files:** Create `apps/panel/view-editor.js`, `tests/e2e_panel_areas.py`; Modify `apps/panel/panel.js`, `apps/panel/panel.css`, `apps/panel/index.html`.

**Interfaces:** `AgelViewEditor.open({view,spaces,scenes,onSave})`. `onSave(view)` entrega una copia con asociaciones y geometría confirmadas. Consume tareas 1–2; no escribe en Supabase directamente. Hasta la tarea 6, el llamador conserva su persistencia actual.

- [ ] Crear prueba de interfaz con fixture de dos departamentos; ejecutar `python tests/e2e_panel_areas.py -k alternar_90` esperando FAIL por control ausente. Reusar `MiniSupa` y el arranque del panel de `tests/e2e_bim.py`, sin abrir el visor antiguo.

```python
def alternar_90(pg):
    pg.get_by_role('button', name='Dibujar zonas', exact=True).click()
    toggle=pg.get_by_role('button', name='90°', exact=True)
    toggle.click()
    assert toggle.get_attribute('aria-pressed') == 'true'
    pg.get_by_label('Zona de', exact=True).select_option(label='Departamento 101')
    stage=pg.locator('.pn-vstage'); box=stage.bounding_box()
    for x,y in [(0.1,0.1),(0.4,0.12)]:
        stage.click(position={'x':box['width']*x,'y':box['height']*y})
    toggle.click()
    assert toggle.get_attribute('aria-pressed') == 'false'
    assert pg.locator('.pn-vpt').count() == 2
```

- [ ] Extraer únicamente `editView` y su estado a `view-editor.js`. Añadir selector «Esta vista corresponde a», destinos de zona, previsualización de segmento y botón 90° con Shift temporal. El cierre no rectifica puntos anteriores.

```js
const effectiveOrtho=orthogonal || (event.shiftKey && !event.target.closest('input,textarea,select'));
const next=AgelShowroomGeometry.snapPoint(draft.at(-1),pointerPoint,effectiveOrtho);
// Alternar el botón cambia orthogonal; draft se conserva.
```

- [ ] Para zonas cerradas, añadir «Redondear esquinas» y control 0–2 %, paso 0,1, valor inicial 0,5. Guardar por zona. Renderizar `path` con la geometría compartida y mantener guías visibles en el panel.
- [ ] Añadir pruebas de escena 101/102 filtrada, ámbito sin escenas, cambio de alcance con puntos incompatibles sin borrado, cierre mixto, Shift fuera de campos, guardado/reapertura de radio y cancelar sin cambiar la vista original.
- [ ] Ejecutar la suite hasta PASS, revisar sintaxis y hacer commit `feat: improve area editing and scoped scene placement`.

## Task 4: Niveles del catálogo e importación consistente

**Files:** Create `packages/showroom/catalog-import.js`, `tests/unit_catalog_import.cjs`, `supabase/migrations/20261014001300_catalogo_importacion.sql`; Modify `apps/panel/panel.js`, `supabase/tests/run.py`.

**Interfaces:** `AgelCatalogImport.parse(csv)` devuelve `{groups,levels,units,problems}`; `level.key` es compuesto por edificio/nivel. RPC `import_catalog(p_project uuid,p_catalog jsonb)` devuelve `{created,updated}` y usa permisos de edición, bloqueo por proyecto y transacción única.

- [ ] Escribir prueba pura y ejecutarla esperando FAIL.

```js
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../packages/showroom/catalog-import.js');
test('el nivel pertenece a su edificio',()=>{
 const out=C.parse('grupo,nivel,nombre,clave\nA,1,Depto 101,A101\nB,1,Depto 101,B101\n');
 assert.equal(out.levels.length,2);assert.notEqual(out.levels[0].key,out.levels[1].key);
 assert.equal(out.problems.length,0);
});
```

- [ ] Reutilizar `AgelFourD.parseCSV` para el texto y conservar columnas anteriores. Si falta `nivel`, no crear niveles ni inferirlos del nombre. Duplicados dentro del archivo detienen la operación antes de escribir; los códigos existentes ambiguos requieren resolución explícita.
- [ ] En RPC, comprobar `app.can_edit_project`, validar todos los padres y códigos, crear edificios/niveles antes de unidades y devolver el resumen. No añadir un índice único que falle silenciosamente con datos existentes duplicados.

```sql
-- Dentro de import_catalog, antes de modificar spaces:
if not app.can_edit_project(p_project) then
  raise exception 'No tienes permiso' using errcode='42501';
end if;
perform pg_advisory_xact_lock(hashtextextended(p_project::text, 13));
-- Validar primero todo p_catalog; después ejecutar las escrituras en esta transacción.
```

- [ ] Añadir pruebas SQL de lector rechazado, proyecto extranjero, archivo duplicado sin escrituras parciales y actualización por código estable. Ejecutar `python supabase/tests/run.py` únicamente contra la base local y la prueba Node hasta PASS.
- [ ] Conectar importador del panel; en modo local de la tarea 6, aplicar el mismo resultado al borrador y reservar RPC para sincronización. Commit `feat: import catalog levels without ambiguous updates`.

## Task 5: Medios y respaldo local por cuenta

**Files:** Create `packages/core/local-media.js`, `packages/core/local-backup.js`, `tests/e2e_local_media.py`.

**Interfaces:** `AgelLocalMedia.open({ownerId,projectId})` devuelve `{put,get,list,markSynced,removeLocal,estimate,persist}`. `put(file,{id,kind})` devuelve `{ref:'agel-local:<uuid>',bytes,mime,name}`. `get(ref)` devuelve Blob/registro o un error de archivo no disponible. `AgelLocalBackup.exportProject(store,snapshot)` exporta manifiesto y archivos sin cargar el conjunto entero en RAM; `importProject` valida antes de reemplazar nada.

- [ ] Escribir prueba en una página fixture que carga solo el módulo y ejecutar `python tests/e2e_local_media.py -k persistencia` esperando FAIL.

```python
def persistencia(pg):
    pg.goto('/tests/fixtures/local-media.html')
    pg.get_by_role('button',name='Guardar fixture local').click()
    pg.reload()
    assert pg.get_by_role('status').inner_text() == 'Archivo local recuperado'
```

- [ ] Implementar IndexedDB con stores `media`, `drafts`, `syncJobs`, claves `[ownerId,projectId,id]` e índices de proyecto. Persistir Blob y metadatos, nunca un object URL temporal. Crear/revocar URLs solo al montar/desmontar un recurso.

```js
// Forma de la escritura atómica; promesa resuelta únicamente en tx.oncomplete.
const record={ownerId,projectId,id,blob:file,bytes:file.size,mime:file.type,name:file.name};
const tx=db.transaction('media','readwrite');
tx.objectStore('media').put(record);
```

- [ ] Comprobar `navigator.storage.estimate/persist` por soporte. Ante `QuotaExceededError`, conservar borrador previo e informar que el nuevo archivo no se guardó. Acceso a carpeta mediante feature detection; alternativa IndexedDB sin límites artificiales del bucket.
- [ ] Exportar a carpeta autorizada cuando se soporte, usando streams; alternativa manifiesto y descargas Blob individuales. Reimportar compara tamaños/IDs y detecta archivos faltantes. No convertir proyectos grandes completos a base64.
- [ ] Añadir casos de otra cuenta, sesión cerrada, falta de cuota, Blob de más de 32 MiB sin subida, archivo faltante y limpieza de object URLs. PASS y commit `feat: persist project media locally with account isolation`.

## Task 6: Borrador local como interfaz del panel y editor

**Files:** Create `packages/core/workspace.js`, `apps/panel/media-controls.js`, `tests/e2e_workspace.py`; Modify `apps/panel/panel.js`, `apps/panel/index.html`, `apps/editor/cloud-mode.js`, `index.html`.

**Interfaces:** `AgelWorkspace.open({cloud,ownerId,projectId})` produce `{load,save,addMedia,updateSpace,deleteSpace,importCatalog,dirty,baseRevision}`; `load()` devuelve `{tree,spaces,showroom,privateSettings}`. Todo cambio de contenido se guarda localmente. Operaciones administrativas de equipo/permisos y lectura de datos existentes siguen siendo remotas y explícitas.

- [ ] Escribir `python tests/e2e_workspace.py -k sin_subida_automatica` y confirmar FAIL: el panel actual hace POST a Storage al añadir una imagen.

```python
def sin_subida_automatica(pg):
    writes=[]
    pg.on('request',lambda r: writes.append(r.url) if '/storage/v1/object/' in r.url and r.method=='POST' else None)
    pg.get_by_role('button',name='Agregar archivo local',exact=True).click()
    # El fixture entrega un PNG al selector y espera «Guardado en este dispositivo».
    pg.get_by_role('status').filter(has_text='Guardado en este dispositivo').wait_for()
    assert writes == []
    pg.reload()
    assert pg.get_by_text('Archivo local',exact=True).is_visible()
```

- [ ] Cargar nube como base cuando no existe borrador; conservar revisión para sincronizar. Adaptar guardado de showroom, catálogo y vistas a workspace. Mostrar «Guardar en este dispositivo», estado de medios y «Subir a la nube».
- [ ] Añadir un hook de entrada local de panorámicas en `loadPano` y `CloudMode`, sin editar `PanoEngine`, navegación o controles del visor. `markDirty` guarda borrador, no sube miniaturas ni medios indirectamente. Aplicar lo mismo a medios D5/video que hoy se suben al seleccionarlos; conservar la acción explícita de subida.

```js
async function addMedia(file,kind){
  const media=await localMedia.put(file,{id:crypto.randomUUID(),kind});
  const draft=await load();
  draft.media=draft.media||[];
  draft.media.push({...media,kind});
  await save(draft);
  return media;
}
```

- [ ] Al cerrar sesión revocar URLs y desmontar el workspace; conservar originales bajo su cuenta. El modo invitado usa otro namespace y la importación a cuenta requiere selección explícita.
- [ ] Probar cambios simultáneos de pestañas, cuenta cambiada, fallo de guardado, borrador existente y catálogo guardado localmente. PASS y commit `feat: make project authoring local first`.

## Task 7: Sincronización explícita, reservas y recuperación

**Files:** Create `packages/core/sync.js`, `supabase/migrations/20261014001400_workspace_sync.sql`, `tests/e2e_workspace_sync.py`; Modify `packages/core/cloud.js`, `apps/panel/media-controls.js`, `supabase/tests/run.py`.

**Interfaces:** `AgelSync.plan(snapshot,store)` devuelve `{assets,totalBytes,blocked}`. `AgelSync.run({workspace,cloud,signal,onProgress})` sube y guarda el snapshot completo solo por acción explícita. `AgelSyncJournal.open({ownerId,projectId})` devuelve `journal` con `save(localId,reservation)` y `get(localId)`, sobre `syncJobs` de la tarea 5. RPC `begin_sync_asset(p_project,p_local_id,p_bucket,p_kind,p_filename,p_bytes,p_mime)` devuelve reserva existente o nueva `{asset_id,path,status,url}`. RPC `complete_sync_asset(p_asset uuid)` devuelve `{asset_id,status,url,bytes}` y es idempotente para reservas completadas. RPC `save_workspace_snapshot(p_project,p_snapshot,p_base_revision)` devuelve nueva revisión y respeta el conflicto existente.

- [ ] Escribir el caso de reintento y ejecutar `python tests/e2e_workspace_sync.py -k reintento` esperando FAIL por RPC ausente.

```python
def reintento(pg,storage_calls):
    pg.get_by_role('button',name='Subir a la nube',exact=True).click()
    pg.get_by_role('button',name='Confirmar subida',exact=True).click()
    pg.get_by_text('Conflicto de revisión',exact=True).wait_for()
    assert storage_calls.count('archivo-ya-completado') == 1
    pg.get_by_role('button',name='Reintentar sincronización',exact=True).click()
    assert storage_calls.count('archivo-ya-completado') == 1
```

- [ ] Crear un registro privado de sincronización por usuario/proyecto/ID local. RLS o esquema privado sin grants anónimos. Reservar por las funciones seguras existentes; conservar el presupuesto de 800 MB, límites por archivo y comprobación de metadata real.
- [ ] Extraer de `cloud.upload` la fase de transferencia para aceptar una reserva; persistirla antes del POST. Si el objeto existe tras un corte, comprobar/completar la misma reserva mediante el servidor antes de crear otra. No liberar cuotas por un error de red ni permitir UPDATE público.

```js
const reservation=await cloud.rpc('begin_sync_asset',assetParams);
await journal.save(asset.id,reservation);
if(reservation.status!=='ready')await cloud.transferReserved(reservation,file,{signal,onProgress});
const verified=await cloud.rpc('complete_sync_asset',{p_asset:reservation.asset_id});
await localMedia.markSynced(asset.ref,verified);
```

- [ ] `complete_sync_asset` comprueba permiso actual, existencia, MIME/tamaño permitido y tamaño real, devolviendo también una reserva ya completada como resultado idempotente. `save_workspace_snapshot` valida IDs y permisos de todas las entidades, aplica árbol/catálogo/showroom en transacción y usa `save_project_tree` para la revisión; no sobrescribe una revisión nueva silenciosamente.
- [ ] Antes de subir mostrar bytes y bloqueos. Pausa entre archivos; cancelación conserva lo terminado y pendientes. Crear derivados como recursos separados sin sobrescribir originales. No transmitir archivos hasta «Confirmar subida».
- [ ] Probar dos pestañas, rol revocado, quota insuficiente, reserva pendiente, objeto subido antes de desconexión, reintento tras reinicio y conflicto de revisión sin perder borrador. PASS y commit `feat: synchronize local drafts through explicit quota-safe uploads`.

## Task 8: Snapshot público validado y vista previa local

**Files:** Create `supabase/migrations/20261014001500_showroom_experience.sql`; Modify `supabase/tests/run.py`, `packages/core/schema.js`, `apps/panel/panel.js`, `scripts/prerender-showroom.mjs`; Create `tests/unit_showroom_manifest.cjs`.

**Interfaces:** `AgelWorkspace.previewManifest()` construye la copia de borrador resuelta localmente y sin escribir una versión pública. `app.validate_showroom_experience(p_project,p_showroom)` comprueba referencias y límites. `app.build_snapshot` produce únicamente campos públicos autorizados; mantiene el contrato histórico y agrega la experiencia nueva.

- [ ] Escribir pruebas de manifiesto y SQL antes de implementar. Ejecutar Node y `python supabase/tests/run.py` en la base local esperando FAIL por rechazo/filtro ausente.

```js
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../packages/showroom/relations.js');
test('la copia pública no acepta un archivo local',()=>{
 const raw={views:[{id:'f',role:'facade',kind:'render',spaceId:null,image:'agel-local:abc',regions:[],spots:[]}]};
 assert.throws(()=>R.normalizeExperience(raw,[],[],{publicMode:true}),/local|sincroniz/i);
});
```

- [ ] Validar en servidor vistas ≤256, UUIDs del proyecto, referencias/targets existentes, zonas simples y radios 0–2. Una entrada no puede apuntar a sí misma ni a un destino inexistente. Un espacio eliminado no se convierte en un destino de proyecto.
- [ ] Sustituir el volcado casi completo de `projects.showroom` en `app.build_snapshot` por lista blanca. Excluir BIM privado, rutas locales, borradores, correo interno y webhook. Conservar precios ocultos fuera del JSON.

```sql
-- Construir campos públicos expresamente; no serializar privateSettings.
v_public_showroom := jsonb_build_object(
  'experience', v_validated_experience,
  'views', v_validated_views,
  'opening', v_validated_opening,
  'location', v_project.showroom -> 'location',
  'contact', v_project.showroom -> 'contact'
);
-- Incorporar los demás campos comerciales públicos ya admitidos uno por uno.
```

- [ ] La vista previa local resuelve referencias mediante IndexedDB de la misma cuenta y origen; no transporta el contenido privado en parámetros de URL. Vista previa persistida exige sincronización. No modificar snapshots publicados existentes.
- [ ] Adaptar prerender a los mismos campos, conservar texto comercial y enlaces útiles sin JavaScript; Opening y render no pueden esconder todo el contenido a buscadores.
- [ ] Añadir casos de URI manipulada, zonas de otro proyecto, radio inválido, exceso de vistas, imagen sin zonas, BIM privado y rollback de versión antigua. PASS y commit `feat: validate immersive showroom publication snapshots`.

## Task 9: Máquina de navegación y enlaces del showroom

**Files:** Create `packages/showroom/navigation.js`, `tests/unit_showroom_navigation.cjs`; Modify `apps/showroom/showroom.js`.

**Interfaces:** `AgelShowroomNavigation.create(manifest)` devuelve `{state,dispatch,back,subscribe,restore,serialize}`. Estados `opening`, `facade`, `plan`, `unit`, `tour`; acciones `ENTER_PROJECT`, `OPEN_VIEW`, `OPEN_SPACE`, `OPEN_SCENE`, `BACK`, `FACADE`. Los destinos siempre se resuelven contra el manifiesto normalizado.

- [ ] Escribir la prueba de recorrido y ejecutar `node --test tests/unit_showroom_navigation.cjs` esperando FAIL.

```js
test('volver conserva el contexto de la unidad',()=>{
 const n=N.create(fixtureManifest);
 n.dispatch({type:'ENTER_PROJECT'});
 assert.equal(n.state.kind,'facade');
 n.dispatch({type:'OPEN_VIEW',id:'nivel1'});
 n.dispatch({type:'OPEN_SPACE',id:'departamento101'});
 n.dispatch({type:'OPEN_SCENE',id:'sala101'});
 n.back();assert.equal(n.state.spaceId,'departamento101');
 n.back();assert.equal(n.state.viewId,'nivel1');
});
```

- [ ] Resolver departamento a su planta individual; sin ella mostrar ficha con acceso al recorrido. Resolver niveles por `spaceId`, no nombre. El punto de entrada usa `entryTargetViewId`.
- [ ] Usar history/URL para destinos públicos sin datos privados; aceptar índices antiguos de escena por adaptador, emitir UUIDs en enlaces nuevos. Un enlace directo válido no obliga a repetir Opening.
- [ ] Cancelar cargas previas por número de navegación o AbortController. Destino inválido presenta regreso a fachada y no lanza una excepción que deje pantalla vacía.
- [ ] Probar IDs manipulados, ciclos, nivel sin planta, departamento sin escenas, navegar rápido y Back del navegador. PASS y commit `feat: connect facade floors units and tour navigation`.

## Task 10: Configuración de Opening y destinos en el panel

**Files:** Create `apps/panel/experience-settings.js`; Modify `apps/panel/panel.js`, `apps/panel/index.html`; Create `tests/e2e_experience_settings.py`.

**Interfaces:** `AgelExperienceSettings.mount(container,{workspace,onChange})` configura Opening, fachada, entrada al lobby, plantas por espacio y versión BIM privada. Usa archivos locales de tareas 5–7, sin llamadas de subida al seleccionar.

- [ ] Escribir y ejecutar `python tests/e2e_experience_settings.py -k opening` esperando FAIL.

```python
def opening(pg):
    pg.get_by_label('Activar Opening',exact=True).check()
    pg.get_by_label('Texto del botón',exact=True).fill('Ver proyecto')
    pg.get_by_label('Fachada inicial',exact=True).select_option('fachada')
    pg.get_by_label('Planta de entrada',exact=True).select_option('lobby')
    pg.get_by_role('button',name='Guardar en este dispositivo',exact=True).click()
    pg.reload()
    assert pg.get_by_label('Texto del botón',exact=True).input_value() == 'Ver proyecto'
    assert pg.get_by_text('Ending',exact=True).count() == 0
```

- [ ] Formularios pequeños: Opening, navegación, relaciones de vistas y acceso BIM. Listar referencias válidas y dar explicación para las ausentes. Posicionar el punto de entrada sobre la fachada con coordenadas de imagen.
- [ ] Separar «Vista previa local», «Subir a la nube», «Crear versión» y «Publicar». Mostrar que los cambios locales no han actualizado la web pública.
- [ ] Probar video local grande sin POST, URL HTTPS, URL inválida, video opcional, falta de fachada, entrada sin planta y ajustes BIM privados que no aparecen en la copia pública. PASS y commit `feat: configure showroom opening and navigation from the panel`.

## Task 11: Página pública con identidad AgelArq y áreas transparentes

**Files:** Create `apps/showroom/experience.js`, `apps/showroom/experience.css`, `tests/e2e_showroom_experience.py`; Modify `apps/showroom/index.html`, `apps/showroom/showroom.js`, `apps/showroom/showroom.css`, `packages/showroom/render.js`.

**Interfaces:** `AgelShowroomExperience.mount(root,{manifest,navigation,resolveMedia,openTour,onBim})` devuelve `{dispose}`. Consume tareas 1–2 y 9. `resolveMedia(ref)` puede resolver medios locales solo en vista previa; una publicación usa URLs HTTPS.

- [ ] Escribir y ejecutar `python tests/e2e_showroom_experience.py -k fachada_y_niveles` esperando FAIL. El fixture simula `openTour`, no vuelve a probar el motor existente.

```python
def fachada_y_niveles(pg):
    pg.get_by_role('button',name='Ver proyecto',exact=True).click()
    assert pg.get_by_role('img',name='Fachada',exact=True).is_visible()
    pg.get_by_role('button',name='Nivel 1',exact=True).click()
    zone=pg.get_by_role('button',name='Departamento 101',exact=True)
    assert zone.evaluate('(el)=>getComputedStyle(el).fill') in ['rgba(0, 0, 0, 0)','transparent']
    zone.hover()
    expect(zone).to_have_css('fill','rgba(184, 157, 116, 0.14)')
```

- [ ] Leer `impeccable/reference/craft-floor.md` antes de editar UI. Reutilizar Inter, tokens oscuros, acento arena y paneles discretos. Crear lateral de niveles, ruta de contexto, entrada al lobby, ubicación y espacio para BIM autorizado. La imagen mantiene proporción y comparte viewport SVG con la geometría.
- [ ] Renderizar todas las áreas mediante `roundedPath`. El área invisible conserva `pointer-events:fill`; relleno y borde solo aparecen en hover/focus/selección táctil. Los puntos 360 tienen prioridad de interacción y no quedan detrás de un área invisible.

```css
.sr-area { fill: transparent; stroke: transparent; pointer-events: fill; }
.sr-area:hover, .sr-area:focus-visible, .sr-area.is-selected {
  fill: rgba(184,157,116,.14); stroke: #B89D74;
}
```

- [ ] Opening: video muted/playsinline con poster y fallback ante rechazo de play; botón disponible siempre y sin Ending. Detener y desmontar el video al entrar. Solo cargar el render actual y recursos ligeros necesarios.
- [ ] Definir transiciones con tokens de duración y curva de la especificación, nunca `transition:all`. Esperar recurso antes del cambio, cancelar cambios anteriores y aplicar `prefers-reduced-motion`.
- [ ] Conservar galería, contacto, selección/comparación y contenido comercial accesible como secciones web. Diseñar estados móvil y escritorio juntos; no ocultar información únicamente porque no cabe en el lateral.
- [ ] Probar transparencia en reposo, foco, toque, puntos superpuestos, render con márgenes, video fallido, retorno a fachada, apertura de ubicación y rutas de unidad. Una revisión visual conjunta escritorio/móvil y como máximo una confirmación tras correcciones. PASS y commit `feat: publish the immersive AgelArq showroom interface`.

## Task 12: Adaptador del 360 y miniplano acotado

**Files:** Create `apps/showroom/tour-bridge.js`, `apps/showroom/hotspot-presentation.js`; Modify `apps/showroom/showroom.js`, `apps/showroom/experience.css`, `tests/e2e_showroom_experience.py`.

**Interfaces:** `AgelTourBridge.open({manifest,sceneId,spaceId,onClose,onSceneChange})` monta el recorrido existente y devuelve `{close}`. `AgelHotspotPresentation.mount(layer,{engine,items})` añade solo la apariencia propia del showroom; conserva coordenadas y destinos del motor.

- [ ] Escribir una prueba con motor falso que registre escena inicial y dispose; ejecutar `python tests/e2e_showroom_experience.py -k miniplano` esperando FAIL por integración ausente.

```python
def miniplano(pg):
    pg.get_by_role('button',name='Departamento 101',exact=True).click()
    pg.get_by_role('button',name='Sala 101',exact=True).click()
    mini=pg.get_by_role('region',name='Plano de ubicación',exact=True)
    assert mini.is_visible()
    assert mini.get_by_role('button',name='Sala 102',exact=True).count() == 0
    pg.get_by_role('button',name='Volver al departamento',exact=True).click()
    assert pg.get_by_role('img',name='Planta departamento 101',exact=True).is_visible()
```

- [ ] Extraer la integración de `openTour` sin reescribir PanoEngine. Añadir opción para escena inicial, subconjunto y vista de miniplano. Buscar primero vista de unidad, luego nivel/lobby; el mapa no toma cualquier planta del proyecto por defecto.
- [ ] Mostrar miniplano automáticamente y permitir plegarlo. Cambiar punto actual con la escena. Cerrar recorrido libera las texturas y devuelve el contexto; no queda otra instancia detrás del render.
- [ ] Presentación de hotspots: wrapper interno orientable con estilo de suelo/pared; el wrapper externo sigue la proyección del motor. No llamar esa apariencia geometría real 3D. Datos antiguos usan estilo plano. Guardar configuración en payload público validado y permitir ajustarla desde el editor de hotspots del showroom.
- [ ] Probar únicamente integración: argumentos del motor, filtrado, orientación del marcador, cierre/dispose y navegación de retorno. No ejecutar una batería manual del visor antiguo. PASS y commit `feat: connect scoped tours and apartment minimaps`.

## Task 13: Acceso BIM privado y presets basados en elementos

**Files:** Create `packages/bim/presets.js`, `supabase/migrations/20261014001600_bim_showroom_access.sql`, `tests/unit_bim_presets.cjs`; Modify `apps/bim/bim.js`, `apps/panel/experience-settings.js`, `apps/showroom/experience.js`, `supabase/tests/run.py`, `tests/e2e_bim.py`.

**Interfaces:** RPC `showroom_bim_access(p_publication uuid)` permite solo `authenticated`, verifica permiso del proyecto y devuelve versión lista/configurada o null. `AgelBimPresets.selectIds(elements,preset)` aplica unión de disciplinas dentro de un preset y restricciones de nivel/categoría; no inventa acabados. Presets privados se guardan por modelo/proyecto, fuera del snapshot público.

- [ ] Escribir el caso de unión MEP y ejecutar `node --test tests/unit_bim_presets.cjs` esperando FAIL.

```js
test('MEP une disciplinas sin exigir dos igualdades a un elemento',()=>{
 const elements=[{dbid:1,discipline:'Eléctrica'},{dbid:2,discipline:'Hidrosanitaria'},
   {dbid:3,discipline:'Estructura'}];
 assert.deepEqual(P.selectIds(elements,{disciplines:['Eléctrica','Hidrosanitaria']}),[1,2]);
});
```

- [ ] Añadir tabla/configuración privada con RLS y cuatro presets: Completo, MEP, Con acabados y Obra gris. Completo llama showAll; MEP usa disciplinas; acabados/obra gris requieren conjuntos/categorías configurados. Un preset vacío muestra «Configura los elementos de esta vista», sin fingir un resultado.
- [ ] RPC autenticada comprueba publicación/proyecto, versión y permiso; no devuelve secreto ni token. Mantener `aps-token` limitado al recurso autorizado. No desplegar nuevas credenciales ni iniciar conversiones durante pruebas.
- [ ] Obtener el botón BIM por la RPC solo si hay sesión; al pulsarlo abrir visor con ruta de retorno local validada. No aceptar `return=https://otro-sitio` ni redirecciones abiertas.

```js
const access=cloud.session ? await cloud.rpc('showroom_bim_access',{p_publication:publicationId}) : null;
if(access) mountBimButton({versionId:access.version_id,returnPath:location.pathname+location.search});
```

- [ ] Probar anónimo, miembro de otro proyecto, lector autorizado, versión no lista, presets incompletos y regreso al showroom. Usar APS simulado para el código; la conversión real seguirá reportada como pendiente hasta recibir configuración. PASS y commit `feat: add authorized BIM access and model view presets`.

## Task 14: Integración, documentación, revisión y despliegue

**Files:** Modify `.github/workflows/pruebas.yml`, `docs/CAMBIOS.md`, `docs/PUBLICAR.md`, `README.md`; Create `docs/SHOWROOM-INMERSIVO.md`, `tests/fixtures/showroom-experience.json`.

**Interfaces:** Fixture canónico con dos niveles, dos departamentos, fachada, lobby, planta individual y escenas pequeñas. Los comandos de CI incorporan módulos y suites nuevos manteniendo los controles existentes. No se confunde CI automática con pruebas manuales del visor.

- [ ] Crear el fixture canónico; agregar un caso de recorrido completo que use un adaptador de tour falso y llame los mismos contratos de publicación y navegación. Confirmar FAIL si se rompe deliberadamente la asociación 101/102 y restaurar antes de continuar.
- [ ] Añadir a CI los comandos `node --test tests/unit_showroom_*.cjs tests/unit_catalog_import.cjs tests/unit_bim_presets.cjs` y las suites de panel/workspace/experiencia. Incorporar cada nuevo módulo global a las páginas antes de sus consumidores.
- [ ] Ejecutar controles locales apropiados y pruebas SQL en base desechable. Revisar diff contra origin/main; comprobar que `packages/panorama/pano-engine.js` no cambió, no hay secretos, archivos gigantes ni borrado de datos.
- [ ] Escribir guía de configuración de fachada, niveles, áreas 90°/redondeo, Opening, medios locales/subida, vista previa y BIM. Explicar cambios visibles, estados pendientes y migración desde vistas antiguas.
- [ ] Usar `requesting-code-review` para la revisión de toda la rama. Corregir problemas reales y repetir solo las comprobaciones afectadas. `verification-before-completion` exige evidencia actual antes de declarar PASS.
- [ ] Crear PR con la funcionalidad final, validaciones y limitación real de Autodesk; adjuntarlo a este chat. Probar migraciones 13–16 en copia local del estado previo; revisar y aplicar únicamente esas migraciones, en orden, al proyecto autorizado. No repetir `02-despliegue-inicial-revisado.sql` ni borrar objetos.
- [ ] Esperar CI del commit final. Integrar y comprobar GitHub Pages para ese commit solo dentro de la autorización de publicación vigente; si aparece una nueva acción sensible, pedir aprobación sobre el resultado concreto. Mantener el plan gratuito y verificar contadores sin descargar panorámicas de producción.
- [ ] Informar por separado: código publicado, migraciones aplicadas, funciones APS desplegadas o pendientes y recursos reales que el propietario debe configurar. No afirmar que el modelo real funciona a partir de un mock.

## Cobertura de la especificación

| Requisito | Tareas |
|---|---|
| Opening sin Ending, fachada, lobby y niveles | 9–11 |
| Plantas, unidades, miniplano y regreso | 1, 3, 9, 12 |
| 90° alternable, redondeo, deshacer y contorno simple | 2–3 |
| Zonas transparentes, hover/foco/toque y prioridad de puntos | 2, 11 |
| Identidad AgelArq y transiciones accesibles | 11 |
| Escenas filtradas, vistas antiguas y 256 vistas | 1, 3, 8 |
| CSV con niveles y códigos no ambiguos | 4 |
| Archivos locales, cuota, respaldo y cuentas | 5–6 |
| Subida explícita, reintentos y conflictos | 7 |
| Versiones públicas seguras, SEO y compatibilidad | 8, 14 |
| Ubicación, BIM privado, MEP y acabados/obra gris reales | 11, 13 |
| Sin cambios al motor ni pruebas manuales del visor antiguo | Global Constraints, 12, 14 |

## Estado de ejecución

Diseño aprobado con los ajustes de dibujo. Este plan está preparado para revisión del propietario y selección del método de ejecución. Ninguna tarea de producto se ha marcado como realizada; la rama sigue conteniendo documentación en esta etapa.

Método recomendado: ejecución directa por el asistente en esta sesión, con revisión independiente de toda la rama al final. Los módulos comparten contratos de medios y publicación, por lo que mantener el contexto reduce el coste de coordinación. El propietario puede elegir delegación por tareas si prefiere revisiones independientes en cada una.
