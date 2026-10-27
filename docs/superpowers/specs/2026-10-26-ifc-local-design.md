# Importación IFC local de Archgel

## Objetivo y autorización
El usuario solicita importar modelos BIM IFC y optimizar su uso. Se ejecuta bajo su autorización persistente para implementar, probar y publicar cambios del proyecto; las decisiones de integración siguientes conservan las restricciones ya acordadas.

## Flujo
Showroom → Modelo 3D permite GLB o IFC. Un IFC STEP se prepara en un Worker local con web-ifc 0.0.78 (MPL-2.0), sin subida ni conversión en Autodesk. El resultado es un GLB autocontenido compatible con Three.js r128, conservando piezas, GlobalId, categoría IFC, disciplina cuando exista evidencia, nivel espacial, sistema y material nombrado cuando el IFC los proporciona. Los originales IFC y la copia preparada se guardan en el navegador del proyecto. Caché por SHA-256 + versión del importador: repetir el mismo archivo no repite la conversión.

## Límites y seguridad
No modificar packages/panorama/pano-engine.js ni cambiar Three.js r128. No escribir nuevas tablas ni cambiar permisos de Supabase. Sin límite artificial de tamaño de nube para la selección local; memoria y almacenamiento del equipo sí limitan el proceso. Procesamiento cancelable; falla, cuota, cambio de cuenta o edición simultánea conservan el modelo previamente asignado. El IFC original queda en un índice local fuera de la carga de sincronización. La subida voluntaria solo puede incluir el GLB referenciado y sigue las comprobaciones gratuitas existentes. El QR transmite imagen del 3D; bloquear IFC, STEP y GLB originales aunque se referencien como galería o se disfracen de imágenes. SDK/WASM servidos desde el mismo sitio con licencia y versión fijadas.

## Rendimiento y geometría
Una sola lectura del archivo para huella y transferencia al Worker. Geometría compartida almacenada una vez, transformaciones por pieza y colores reutilizados. Mantener la escala métrica y el eje vertical; recentrar coordenadas grandes para la visualización, conservando la matriz de coordinación como metadato técnico. No fusionar objetos de distintas categorías para reducir tamaño: perdería los filtros. Geometrías de espacios/aberturas que no son superficies construidas no se muestran. Sin geometría visible o archivo inválido: error y sin sustituir el modelo.

## Validación
IFC4 e IFC2X3 sintéticos reales con muro, viga, tubería y acabado; parser WASM real y GLB abierto en el visor actual. Probar filtros, niveles, escala, repetición de archivo, cancelación, cuota/conflicto y recarga sin convertir otra vez. Unidades y geometría compartida con pruebas unitarias. El QR conserva bloqueo de fuentes y el flujo existente. Compatibilidad con IFC4X3 declarada solo cuando el parser detecte el esquema; no prometer que todas las entidades de un exportador estén soportadas. No requiere archivo privado del usuario para estas pruebas.
