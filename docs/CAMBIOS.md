# Rama Showroom Virtual · auditoría y correcciones

13 oct 2026 · contra `agel-showroom-virtual.md` (v1.0)

## Defectos corregidos (con prueba que falla si regresan)

| Defecto | Antes | Ahora |
|---|---|---|
| Arrastrar sobre un marcador lo activaba (criterio 4) | Cambiaba de escena, en showroom y en el visor de clientes | El motor distingue toque de arrastre (6 px, aunque el gesto vuelva al punto de partida). Probado en ambos; la prueba del visor falla con el código anterior |
| Flechas sin efecto en el 360° | El foco caía en un botón y se ignoraban | El foco inicial va a la vista 360°; flechas, + y − funcionan |
| Marcadores ocultos seguían en el orden de Tab | Solo se volvían transparentes | Detrás de la cámara quedan inertes (ni clic ni foco) |
| Portada con la panorámica completa | Hasta 8K antes de la primera vista | Versión ligera de 2048 px generada al subir (y una vez para las existentes al abrir el proyecto con cuenta). La completa se descarga solo al entrar al recorrido |
| Enlace a una unidad retirada | Abría sin decir nada | Avisa y muestra las disponibles |
| Superficie ambigua y estado desconocido oculto | «m²» sin tipo; «no aplica» desaparecía | El proyecto declara qué superficie publica (interior, total…); lo desconocido dice «Por confirmar» |
| Visor de clientes sin teclado en los puntos | Divs sin rol | Botones accesibles (Enter / Espacio) |

## Construido para la rama (S2–S4)

- **Explorar sobre render o planta:** zonas por unidad o edificio con color por estado, nombre al pasar o enfocar, teclado y varias vistas en pestañas. Una zona de unidad abre su ficha; una de edificio filtra la lista. Desde la ficha, «Ver en el plano» vuelve y la resalta.
- **Orientación dentro del 360°:** botón «Plano» con «Estás aquí»; tocar otro punto cambia de escena. Si el recorrido se abrió desde una unidad, «Volver a» regresa a su ficha.
- **Elegir:** búsqueda por nombre o clave, recámaras, precio máximo y superficie mínima (opciones tomadas de los datos publicados), contador, limpiar filtros y orden por precio o superficie.
- **Selección guardable y compartible:** guardar hasta 10 opciones; barra con Comparar, Compartir (enlace sin datos personales) y Pedir información. El enlace compartido recupera la selección y avisa si algo ya no está. La solicitud guarda la selección y llega al panel, al CSV y al aviso por correo o webhook.
- **Comparar dos opciones:** datos homogéneos, diferencias resaltadas, «Sin dato» explícito y cambio de cada opción.
- **Precio con fecha** de actualización en la ficha.
- **Avance de obra** comercial (fotos e hitos), separado del 4D técnico.
- **Panel:** editor de zonas y puntos 360° sobre la imagen; avance de obra; revisión antes de crear una versión (puntos rotos, estados por confirmar, zonas huérfanas, escenas sin panorámica, contacto y buscadores); vista previa en tamaño de celular.

**Pruebas:** showroom 15/15, panel y BIM 7/7, editor sin cuenta 21/21, con cuenta 10/10, permisos 40/40, funciones 13/13.

## Lo que sigue pendiente del documento

- **Tipología** como entidad (unidades que comparten distribución y recorrido, declarando a cuáles aplica).
- **Más tipos de hotspot** (producto o acabado, detalle multimedia) y **control de densidad o agrupación**. El editor solo crea navegación e información.
- **Aviso de destinos rotos dentro del editor:** hoy se detectan en la revisión del panel antes de publicar.
- **Entrada audiovisual** omitible en el showroom.
- **Medición real de LCP, INP y CLS** en teléfonos y redes definidas: no hay dispositivo real en esta sesión.
- Validación con usuarios (sección 15): las tareas están cubiertas por pruebas automáticas, pero eso no sustituye observar a compradores reales.

---

# Cambios · Fases 1 a 7 del plan maestro

Rama `plataforma` (sobre `fase-0-base-segura`) · 13 oct 2026
Para subirla: [`docs/PUBLICAR.md`](PUBLICAR.md).

---

## Evidencia: pruebas

| Suite | Qué corre de verdad | Resultado |
|---|---|---|
| Permisos de la base (`supabase/tests/run.py`) | las 11 migraciones sobre Postgres; dos organizaciones, cuatro roles y visitante anónimo intentando leer y escribir lo que no deben | **40 / 40** |
| Editor sin cuenta (`tests/e2e.py`) | Chromium real con WebGL; los recorridos de la fase 0 con el motor compartido | **21 / 21** |
| Editor con cuenta (`tests/e2e_cloud.py`) | navegador → PostgREST real → Postgres con RLS; acceso, guardado central, conflicto entre dos personas, roles, publicar, enlace antiguo, importar | **10 / 10** |
| Showroom (`tests/e2e_showroom.py`) | página publicada, filtros, ficha por enlace, contacto con unidad y origen, robots, recorrido bajo demanda, modelo 3D, inyección de código, vista previa privada, 390 px, página pre-generada sin JavaScript | **15 / 15** |
| Panel y BIM (`tests/e2e_bim.py`) | panel completo; funciones de servidor reales (Deno) contra la base real; **Autodesk simulado** | **7 / 7** |
| Funciones de servidor (`deno test`) | permisos, URLs firmadas, conversión, estado, token de solo lectura, avisos y bloqueo de webhooks internos | **13 / 13** |
| 4D y clasificación (Node) | CSV de TimeLiner (es/en), XML de MS Project, estados por fecha, atrasos, reglas MEP | **11 / 11 · 8 / 8** |

Dos protecciones se comprobaron al revés: se rompió a propósito una política de la base y el escape de direcciones dentro del CSS del showroom, y en ambos casos la prueba falló como debía.

**Lo que no está probado contra el servicio real:**
- **Autodesk.** Las llamadas siguen la documentación de APS (autenticación v2, OSS con URLs firmadas, Model Derivative SVF2, visor v7), pero en las pruebas Autodesk es un servidor simulado y el visor es un sustituto con la misma interfaz. La primera conversión real es la prueba de verdad.
- **Supabase Auth y Storage** están emulados; Postgres y PostgREST son los reales. Las políticas de Storage se ejecutan en Postgres igual que en Supabase.
- **Teléfonos reales.** El móvil se probó con Chromium a 390 px.

---

## Qué se construyó

### Fase 1 · Acceso y permisos
- Inicio de sesión con contraseña, enlace por correo y recuperación. "Seguir sin cuenta" conserva el modo anterior.
- Organizaciones (propietario, admin, miembro) y roles por proyecto (propietario, editor, revisor, lector). Toda regla vive en la base (RLS); la interfaz solo oculta lo que fallaría.
- Archivos por carpeta de proyecto en `media`, `models` y `technical` (privado). Cada subida se reserva antes y descuenta cuota.
- Los permisos devuelven siempre sí o no: un permiso "vacío" había dejado publicar el proyecto de otra organización en una versión intermedia; quedó cubierto por prueba.

### Fase 2 · Datos centrales y motor único
- Un solo motor 360 (`packages/panorama/pano-engine.js`) para editor y visor.
- Guardado central con número de revisión: si dos personas editan, la segunda no pisa a la primera; elige entre descargar su copia o cargar la del servidor. Historial de 200 revisiones con restauración.
- Importador de proyectos del navegador con respaldo previo y reporte.
- Publicaciones versionadas: borrador → revisión → publicada, con vista previa, volver a una versión anterior y archivar. Lo publicado es una copia fija y no incluye correos internos ni precios ocultos.
- Enlaces antiguos conectables a una publicación nueva.

### Fase 3 · Showroom comercial
- Página pública por proyecto: portada con la panorámica como franja que se arrastra, unidades en una tabla real con filtros y ficha por enlace (`?unidad=`), recorrido 360° que se descarga solo al abrirlo, galería, planos, ubicación, contacto.
- El formulario guarda unidad de interés, origen (utm) y consentimiento; solo dice "recibido" cuando la base respondió bien; límite de envíos por correo y por hora; trampa para robots.
- Medición sin datos personales: contadores diarios por evento.
- Buscadores: título, descripción, Open Graph, datos estructurados y páginas pre-generadas con `sitemap.xml`.
- Accesibilidad: navegación con teclado, foco visible, áreas táctiles de 40 px o más, movimiento reducido.

### Fase 4 · BIM con Autodesk
- Funciones de servidor `aps-upload`, `aps-translate`, `aps-status`, `aps-token`. Las credenciales solo existen en los secretos de Supabase; el navegador recibe un token de solo lectura y solo si su cuenta ve ese proyecto.
- Subida directa a Autodesk por partes (archivos grandes no pasan por Supabase).
- Visor: filtros por disciplina, sistema, nivel y etapa; propiedades; vistas guardadas ligadas a una escena 360°; incidencias con comentarios; comparación entre versiones. Corte y medición son las herramientas estándar del visor de Autodesk.
- Clasificación MEP automática (inglés y español) más reglas del proyecto; lo que no se puede clasificar queda marcado, no se inventa.

### Fase 5 · Etapas y 4D
- Importa el CSV de TimeLiner o el XML de Microsoft Project; detecta día/mes o mes/día; avisa fechas inválidas.
- Vincula tareas con elementos por nivel, zona o sistema cuando el conjunto de TimeLiner coincide.
- Reproductor por fecha (planeado o real) con construir, demoler y temporal; lista de atrasos; reporte de tareas sin elementos.

### Fase 6 · Operación
- Panel: varias organizaciones, marca (logo, color con texto legible calculado), uso y cuota, bitácora sin datos de prospectos, exportación completa del proyecto, prospectos con estado, notas y CSV seguro para Excel.

### Fase 7 · Extras
- Realidad virtual (WebXR) en visor y showroom, solo en dispositivos que la ofrecen.
- Recorrido guiado en el showroom.
- Avisos de prospectos por correo (Resend) y webhook de CRM firmado; no llama a direcciones internas.
- Modelo 3D (GLB) con realidad aumentada en el showroom.

---

## Lo que no se hizo y por qué

- **Plugin de Navisworks** y **Pixel Streaming (Unreal)**: requieren desarrollo e infraestructura fuera de una app web (un instalable de Windows; servidores con GPU por usuario). Quedan documentados en el plan para cuando haya un cliente que lo pague.
- **Hotspots dentro de VR:** en el visor de realidad virtual se ve la panorámica; los puntos se usan fuera de VR.
- **Invitar a la organización por correo:** hoy se invita por proyecto. El acceso a toda la organización se asigna en la base.
- **Del recorrido 360° al modelo BIM:** el salto existe dentro del visor BIM (vista ↔ escena). Desde el visor público no, porque el modelo BIM es privado del equipo.
- **Botón "Presentar" cortado a 390 px** en la barra superior del editor: sigue pendiente.

---

## Correcciones a lo que te dije antes

1. **"El visor registra el arrastre dos veces / gira al doble."** Medí y no es así: el arrastre era igual en editor y visor. Lo que sí difería: la rueda del mouse cambiaba el zoom el doble por paso en el visor (con los mismos giros de rueda, el visor terminaba en 65° y el editor en 60°) y la inercia al soltar era algo distinta (13.8° contra 15.7°). Con el motor único ambos se comportan igual.

---

# Fase 0 + P0 (etapa anterior)

Rama `fase-0-base-segura` · 13 oct 2026
Base: tu `index_d5.html` (319,757 bytes), que contiene todo lo que hay en `main` más correcciones posteriores. La única diferencia de `main` que no estaba en tu archivo (un arreglo de `pointer-events` del modo D5) ya venía incluida en él.

---

## Evidencia: pruebas en navegador real

Chromium con WebGL, las mismas versiones de librerías que carga la app, y Supabase simulado con **tus políticas reales** (SELECT e INSERT públicos; UPDATE y DELETE sin política).

| Prueba | `main` (producción) | Esta rama |
|---|---|---|
| Arranque sin errores | ✅ | ✅ |
| Subir panorámica y verla | ✅ | ✅ |
| Subir rápido tras elegir escena vacía | ❌ pantalla negra | ✅ |
| Íconos cargan | ❌ botones vacíos | ✅ |
| Detalles de hotspot con comas | ❌ se parten mal | ✅ |
| Editar hotspot de navegación | ❌ nunca se guarda | ✅ |
| Persistencia al recargar | ✅ | ✅ |
| Borrar escena y deshacer | ❌ no existe | ✅ |
| Config del visor persiste | ❌ se pierde | ✅ |
| Visor por enlace | ✅ | ✅ |
| XSS en config compartida | ❌ **se ejecuta** | ✅ |
| Config inválida muestra aviso | ❌ queda en blanco | ✅ |
| Respuesta tardía no pisa la escena | ❌ | ✅ |
| Panorámica 8K en GPU de 4K | ❌ se envía entera | ✅ se ajusta |
| Respaldo: exportar / importar | ❌ no existe | ✅ |
| Respaldo recupera imagen solo-local | ❌ no existe | ✅ |
| URL `javascript:` en enlace D5 | ❌ **se ejecuta** | ✅ bloqueada |
| Modelo D5 local aislado y funcional | ❌ lee tu `localStorage` | ✅ aislado, con WebGL |
| **Total** | **5 / 18** | **18 / 18** |

Para repetirlas: ver `README.md`, sección Pruebas.

---

## Lo que cambió en `index.html`

### Seguridad (P0 · B04, B05)

- **Configuraciones compartidas validadas.** Todo enlace `?visor=1&id=`, `?modelo=1&id=` y el formato antiguo `?scenes=` pasa por un esquema: tipos, longitudes, cantidades (200 escenas, 100 hotspots por escena, 1 MB) y URLs (`https` solamente; nunca `javascript:`, `data:text/html`, `file:`). Los destinos de hotspot se comprueban contra la lista final de escenas.
- **Enlace inválido o vencido:** mensaje claro construido sin `innerHTML`. Antes, el error dejaba visible detrás el panel de configuración del editor.
- **Modelos D5 aislados según su origen real.** Un modelo remoto en Supabase vive en otro dominio y conserva su propio origen (se mantienen sus permisos). Un modelo local (`blob:`) heredaba el origen de tu app y podía leer tus datos; ahora queda en un origen opaco. Si algún export de D5 dejara de funcionar en vista **local**, cambia `D5_TRUST_LOCAL_MODELS` a `true`.

### Carga y memoria (P1 · V02)

- **Turno de escena** en editor y visor: una respuesta que llega tarde ya no reemplaza la escena que estás viendo.
- **Textura ajustada al dispositivo:** si la panorámica supera lo que la GPU acepta (o 4096 px en móvil), se reduce antes de enviarla. Antes solo se avisaba y el móvil mostraba una esfera negra. El archivo original en Storage no cambia.
- **Visor sin precarga masiva:** antes pedía todas las escenas al abrir (20 escenas a 8K ≈ 2.5 GB de memoria gráfica). Ahora: carga sin duplicados, precarga de vecinas y destinos de hotspot, y caché de 5 texturas con liberación.
- Mientras carga una escena, ya no se ven los hotspots de la anterior.

### Respaldo (Fase 0)

- Botones **Respaldo** y **Restaurar** en el panel de escenas.
- El archivo incluye proyectos, links del visor y de D5, y las imágenes que solo existen en este navegador.
- Al restaurar: valida el archivo, pide confirmación con el resumen, y **guarda una copia del estado actual** antes de reemplazar (`restoreBeforeImport()` la recupera).

### Interfaz

- **Íconos:** la app pedía `@tabler/icons-webfont@latest/tabler-icons.min.css`, un archivo que no existe en el paquete (está en `dist/`). En las pruebas, todos los botones de solo-ícono salían vacíos. Ruta corregida y versión fijada en 3.49.0.
- **Chips de proyecto:** los no seleccionados eran píldoras blancas sin texto legible (botón sin fondo declarado). Corregido.
- **Móvil:** el panel de escenas ahora sí es una hoja inferior (ver correcciones abajo); la barra de navegación y los avisos suben sobre ella.
- **Gestor de Supabase:** "Eliminar" explica que el bucket no permite borrar sin sesión, en vez de "No se pudo eliminar".

---

## Correcciones a lo que te dije en sesiones anteriores

1. **"Editar un hotspot de navegación lo convertía en hotspot de información."** El mecanismo era otro: la función duplicada exigía un título que el formulario de navegación no tiene, así que la edición **nunca se guardaba** y aparecía "Escribe un título para el hotspot". La solución (quitar el duplicado) era correcta; la descripción no.
2. **"El panel lateral en móvil ahora es una hoja inferior."** No lo era: una regla CSS posterior lo pisaba y quedaba un panel pegado arriba. Ahora sí funciona, verificado con captura a 390 px.
3. **"Cualquiera con la llave puede borrar tus panorámicas."** Falso con tus políticas: UPDATE y DELETE no tienen política, así que están denegados. Además, la llave anon **es pública por diseño**; lo que importa son las políticas. El riesgo real hoy es la subida pública (consumo de cuota), no el borrado.
4. **La prueba de `DELETE` en la consola** que te sugerí sobre una ruta inexistente no demuestra nada: falla igual con permisos abiertos. En `supabase/storage-policies.sql` está cómo probarlo bien.

---

## Pendiente (no incluido en esta rama)

- **Fase 1 · inicio de sesión.** Requisito para cerrar la subida pública (fase 2 del SQL).
- **Verificar en producción** que los modelos D5 remotos se muestran: la documentación actual de Supabase indica que Storage entrega los archivos HTML como texto plano por seguridad. Abre un enlace D5 compartido; si ves código en vez del modelo, hay que servirlos desde otro alojamiento.
- **Cuota de Supabase:** el panel muestra "Grace period is over". Al agotarse, los enlaces de tus clientes dejan de cargar.
- Barra superior en móvil: el botón "Presentar" se corta en el borde a 390 px.
- Unificar los dos motores 360 (`PanoEngine`), modularizar, BIM y showroom: fases 2–5 del plan.
