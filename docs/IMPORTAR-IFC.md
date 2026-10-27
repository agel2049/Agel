# Importar IFC en Archgel

1. Exporta el modelo desde tu programa BIM como **IFC (.ifc)**. No necesitas convertirlo previamente en Navisworks. La ruta local admite IFC2x3, IFC4 e IFC4.3; la compatibilidad de geometrías depende del exportador y del lector IFC.
2. En **Panel → tu proyecto → Showroom → Modelo 3D**, pulsa **Agregar modelo local (GLB o IFC)** y selecciona el archivo.
3. Espera la preparación en segundo plano. Puedes pulsar **Cancelar importación IFC**. El original y una copia GLB para visualizar se guardan en el navegador de esta Mac. No se envían a Supabase ni a Autodesk.
4. En **Modelos 3D → Ver GLB local**, abre la copia preparada. Conserva los filtros de instalaciones, albañilería, estructura, acabados, nivel y materiales cuando el IFC aporte esos datos. Los elementos sin datos suficientes se mantienen sin clasificar.
5. **Vista previa local** y **Compartir temporalmente** reutilizan esa misma copia. El QR recibe imagen del modelo; el IFC original y el GLB permanecen en la Mac.

Seleccionar otra vez exactamente el mismo IFC reutiliza la preparación guardada, incluso después de cerrar y abrir el panel. Cambiar el contenido del archivo o la versión del importador exige prepararlo otra vez. La primera lectura requiere memoria y espacio local para el original y la copia; no hay un límite artificial tomado del plan de Supabase. Para proyectos muy pesados, exporta por edificio o disciplina. No se promete un tamaño de entrada ilimitado ni compatibilidad con todas las representaciones IFC.

Si una representación IFC no aporta triángulos, la importación conserva las piezas válidas y muestra un **Resumen de importación IFC** con los identificadores de los elementos afectados (hasta 20 ejemplos). Revisa esa lista antes de presentar: una pieza omitida puede ser relevante. El original no se modifica. Si todo el IFC carece de superficies visibles, la importación se rechaza y se conserva el modelo anterior. Los datos geométricos no vacíos pero mal formados siguen dando error, ahora con el elemento y la geometría identificados.

Un archivo inválido, una cancelación, un conflicto de edición o falta de espacio no deben sustituir el modelo anterior. Conserva tus originales y un respaldo del proyecto; borrar datos del navegador elimina el almacenamiento local.

## Nube y formatos

La conexión Autodesk ya acepta IFC junto con NWD y otros formatos. Sigue siendo una ruta independiente que requiere conversión en APS y sus condiciones. La nueva importación local no inicia conversiones APS. **Subir a la nube** es voluntario: solo incluye la copia de visualización referenciada y conserva sus comprobaciones de formato/tamaño; el IFC fuente del índice local no forma parte de esa subida.

IFCZIP, IFCXML, NWF y NWC no se convierten con este importador local. Usa un IFC STEP exportado desde el modelo de autoría. La vista preparada es para presentación y filtros; no sustituye el archivo BIM de autoría ni conserva un editor completo de propiedades IFC.

## Implementación

web-ifc 0.0.78, licencia MPL-2.0 incluida, ejecutado en Worker con WASM servido desde Archgel. Preparación reutilizable mediante SHA-256 y versión del importador. Geometrías compartidas una sola vez, materiales reutilizados y objetos separados para mantener filtros. Escala métrica, niveles y GlobalId preservados; coordenadas grandes se recentran para la visualización y su matriz se registra en el GLB. El motor 360° y Three.js r128 no cambian.
