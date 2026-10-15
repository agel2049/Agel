# Vista previa local y filtros de modelos

El usuario necesita cargar videos grandes y probar Opening → fachada → plantas → 360° sin subir archivos a Supabase. Reportó el bloqueo en videos de Opening y confirmó que el GLB se agregó mediante Showroom → Subir GLB. Pide que la interfaz de modelos se limite a filtros para instalaciones, albañilería, estructura y acabados; incidencias y responsables no son necesarios.

## Límites y arquitectura

- Conservar el motor panorama sin cambios y sin pruebas manuales del visor anterior.
- Los videos seleccionados en el Opening heredado se guardan en IndexedDB por cuenta; referencias persistentes en metadata y URLs Blob solo en memoria. Ninguna selección de archivo envía bytes a un servidor. El espacio real del dispositivo/navegador sigue siendo un límite físico.
- Probar el Opening local con un archivo mayor que los límites de Supabase, recargar y reproducir desde el dispositivo. Eliminar/reemplazar no borra originales ni anuncia éxito ante un fallo de guardado.
- Corregir la normalización local del GLB: la dirección provisional usada para validar debe conservar la extensión antes de resolver el Blob propio.
- Mostrar el GLB de showroom en Modelos y 4D. Abrirlo en apps/bim/?local=<proyecto>, usando la misma sesión/cuenta y borrador. No crear una versión APS ni subir el archivo automáticamente.
- Reutilizar Three.js r128, GLTFLoader, OrbitControls y DRACOLoader para GLB. Reutilizar APS para modelos Navisworks convertidos. No implementar un lector NWD ni afirmar compatibilidad local con NWD/NWC.
- El GLB local solo solicita bibliotecas/decodificadores fijos, no sube datos. Rechazar recursos externos de modelos que no sean autocontenidos; admitir imágenes embebidas. Liberar GPU, listeners y recursos al cerrar/cambiar cuenta.
- Filtros por grupos, materiales, categorías, nivel y disciplinas que realmente existan. Presets solo cuando haya elementos correspondientes; datos desconocidos permanecen sin clasificar. Los nombres pueden ayudar a identificar elementos y deben distinguirse de propiedades BIM explícitas. No inventar MEP para un GLB monolítico.
- La interfaz de visor por defecto ofrece filtros, encuadre y controles de cámara; elimina de la navegación incidencias/responsables/4D. Conservar los registros/backend anteriores.
- Mantener permisos y límites de sincronización explícita; ninguna migración ni cambio de cuota es necesario.

## Comprobación

Reproducciones fallidas antes de arreglar: video heredado genera POST; modelo GLB local desaparece de preview; GLB ausente del listado de modelos. Probar GLB real con piezas separadas, filtros que alteran visibilidad, combinación de filtros, resultado vacío, modelo sin clasificación, rechazo de recursos externos y cierre. Probar video grande reproducible y navegación local sin POST. CI y publicación final exacta, sin modificar datos del cliente.
