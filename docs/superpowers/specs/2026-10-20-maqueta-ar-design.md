# Maqueta virtual de AgelArq

## Alcance aprobado

El usuario aprobó el análisis de alternativas y pidió comenzar sin Power BI, mejorando las funciones y la visualización virtual en maqueta. Primera entrega: visor GLB compartido por vista local y showroom público, con vistas, zoom, encuadre, giro y AR sobre una superficie. La interfaz conserva fondo oscuro, acento arena y controles glass con mayor opacidad al recibir foco o hover. El modelo ocupa el espacio disponible; filtros en panel plegable, controles en la parte inferior.

## Comportamiento

- Vistas Perspectiva, Planta, Frente y Lateral, encuadre de piezas visibles, zoom y giro automático iniciado expresamente. Teclas de flechas/WASD desplazan la vista de maqueta cuando el lienzo tiene foco; no se presentan como recorrido con colisiones.
- Mantener filtros de instalaciones, albañilería, estructura, acabados, categorías, niveles y materiales. Mostrar un estado vacío cuando no queden piezas; ninguna pieza se inventa por falta de metadatos.
- AR WebXR: detección de capacidad sin pedir cámara; sesión solamente al pulsar el botón; búsqueda de superficie con retícula, toque para colocar y opción de recolocar. Maqueta de lado mayor inicial 1 m; tamaños 0.5, 1 y 2 m y rotación de 90 grados. Conservar piezas filtradas en WebXR. Restaurar vista, controles, fondo y recursos al finalizar o cancelar.
- iPhone/iPad: Quick Look mediante model-viewer ya usado en el showroom, cargado solo cuando se solicite. Preparar el modelo, habilitar un segundo toque para abrir AR; indicar que esta ruta muestra la maqueta completa y utiliza controles de Apple. No publicar ni subir el GLB para habilitar AR.
- Equipos sin AR: vista 3D completa y mensaje claro. Cámara denegada o inicialización fallida: recuperación y reintento sin perder el modelo.
- Vista local lee el archivo del mismo dispositivo/cuenta; cierre o cambio de cuenta libera recursos. Showroom público usa exclusivamente el modelo autorizado en su publicación. Conservar compatibilidad del modelo glTF público existente por la ruta anterior.
- El acceso público a la maqueta debe estar disponible desde la navegación inmersiva y desde la sección Modelo 3D. Cierre devuelve a la ubicación previa y restaura foco.

## Límites

No Power BI, cambios de esquema, cargas automáticas, nuevas credenciales, cambios del motor panorama ni prueba manual del visor 360. No prometer AR físico validado sin Android/iPhone reales. RVT/NWD y APS conservan su conexión existente. AR a escala 1:1, alineación sobre obra, colisiones y navegación de interiores quedan fuera de esta entrega de maqueta.

## Arquitectura

El renderer GLB mantiene Three.js 0.128.0 y su API existente. Módulo maquette-math concentra vistas y tamaños; glb-ar controla sesiones XR y Quick Look; maquette concentra interfaz y filtros; local-glb mantiene permisos/lectura local y delega presentación. El showroom crea un diálogo de maqueta y descarga el renderer solo al abrir un modelo GLB. La biblioteca model-viewer se utiliza solo para Quick Look, con versión fijada y sin sustituir THREE global.

## Verificación

Pruebas unitarias de vistas/tamaños, AR denegado, cierre durante inicialización y restauración; navegador con GLB sintético y WebXR simulado para el ciclo de colocación; interfaz móvil/escritorio, filtros vacíos, teclas con foco, retorno y cero escrituras a nube. Compatibilidad automatizada existente y comprobación del hash del motor panorámico. Validación física AR pendiente y visible en la entrega.
