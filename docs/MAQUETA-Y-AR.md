# Maqueta virtual y realidad aumentada

## Abrir tu modelo

1. Entra al panel y abre el proyecto.
2. En **Showroom → Modelo 3D**, agrega un GLB autocontenido, con sus texturas embebidas.
3. Ve a **Modelos y 4D → Ver GLB local**, o abre la vista previa local del showroom y pulsa **Modelo 3D local**.
4. El archivo permanece en el dispositivo. Esta ruta no lo publica ni lo carga a Supabase o Autodesk.

El GLB debe estar en el mismo navegador y dispositivo donde lo guardaste, con su cuenta correspondiente. Actualmente, un enlace o QR no transfiere los archivos locales a otro teléfono. Para probarlo en el móvil, agrega allí el archivo.

## Controles de maqueta

- **Perspectiva, Planta, Frente, Lateral:** elige una vista; seleccionar una vista detiene el giro automático.
- **Encuadrar:** centra las piezas visibles.
- **+ / −:** acerca y aleja; también puedes usar rueda o pellizco.
- **Giro automático:** inicia o detiene el giro.
- **Filtros:** instalaciones, albañilería, estructura, acabados y obra gris, además de nivel, categoría, grupo y material cuando existen en el archivo.
- **WASD y flechas:** desplazan la vista cuando el modelo tiene foco. Son controles de maqueta, no un recorrido con colisiones dentro del edificio.

El modelo ocupa toda la pantalla y los filtros se pliegan en móvil. Los botones conservan la identidad oscura y glass de AgelArq, con mayor opacidad al recibir foco o pasar el ratón.

Si no quedan piezas tras filtrar, se muestra el contador en cero. Un GLB exportado como una sola malla no permite separar sus instalaciones. Los filtros deducidos de nombres son orientativos; para resultados fiables exporta objetos y propiedades separados.

## Colocar sobre una superficie en Android

En un dispositivo compatible con WebXR/ARCore, abre la página mediante HTTPS y pulsa **Ver en mi espacio**. El navegador solicitará permiso para la cámara.

1. Apunta a una mesa o al suelo y mueve suavemente el teléfono hasta ver el círculo.
2. Toca la superficie para colocar la maqueta. Se mantienen las piezas filtradas.
3. Puedes moverte alrededor, cambiar el tamaño máximo a **50 cm, 1 metro o 2 metros**, girarla 90° o pulsar **Recolocar**.
4. Pulsa **Salir de cámara** para recuperar la vista anterior. Si el navegador no admite los controles superpuestos, usa su botón de salida del modo AR.

La maqueta comienza con su lado mayor ajustado a 1 metro. Esto no es escala arquitectónica 1:1 ni un sistema para alinear instalaciones con una obra real. Cámara, hit-test y estabilidad dependen del dispositivo. Si se deniega el permiso, se conserva el modelo y se puede reintentar.

## iPhone y iPad

Pulsa **Preparar AR**. Se prepara el modelo local para Quick Look; después pulsa **Ver en mi espacio**. Quick Look utiliza la interfaz de Apple y muestra **la maqueta completa**, sin trasladar los filtros actuales. El GLB no se carga a un servidor para prepararlo; la biblioteca se descarga al solicitar esta función, por lo que la primera preparación requiere conexión.

La opción se ofrece inicialmente a equipos iOS/iPadOS y se verifica con la capacidad reportada por model-viewer al preparar el archivo. Si Quick Look no está disponible o no puede convertir el modelo, se muestra el error y queda disponible la vista 3D.

## Showroom publicado

Cuando una publicación contiene un GLB accesible, **Maqueta virtual** en la navegación y **Ver en 3D** en la sección del modelo abren el mismo visor, con filtros y controles. Al cerrar vuelve al showroom y al botón que lo abrió. La descarga del modelo y de Three.js se inicia al abrirlo.

Los modelos glTF públicos existentes mantienen su ruta anterior. La publicación de archivos sigue siendo explícita: esta mejora no sincroniza ni publica borradores por sí sola.

## Compatibilidad y pruebas

Se verifican automáticamente cámara virtual, filtros, teclado, móvil/escritorio, apertura pública, retorno, cambios de cuenta y ausencia de escrituras a nube en la ruta local. El ciclo AR se prueba con sesiones simuladas: superficie, colocación, tamaño, recolocación, negación de permisos, cancelación tardía y restauración. Quick Look se simula en las pruebas del flujo; no se declara validada su conversión nativa.

**Pendiente de validación física:** un Android con ARCore y un iPhone/iPad reales, incluyendo cámara, colocación, seguimiento y apariencia de un modelo del usuario. No se ha realizado una conversión RVT/NWD real. No hay cambios de esquema ni modificaciones del motor panorámico.

## Compartir temporalmente con otro celular: propuesta siguiente

Es posible añadir **Compartir temporalmente → abrir con QR**, sin publicar el modelo en Supabase ni configurar el proyecto en el celular. El QR enlazaría una sesión y el equipo de origen enviaría el GLB al teléfono. El teléfono necesita recibir los datos para renderizarlos; se podría mantener la copia durante la sesión, sin guardado permanente en el catálogo.

La opción propuesta es transferencia WebRTC. Requiere un servicio de señalización y, en redes que impiden conexión directa, un retransmisor TURN. Este retransmisor puede generar tráfico y costos: no se ha contratado ni activado ninguno. Una alternativa dentro de la misma red es servir el archivo desde la computadora; para AR el teléfono necesita un origen HTTPS válido.

**Esta función de intercambio todavía no está implementada.** La computadora debe permanecer disponible durante el envío. La memoria y capacidad gráfica del teléfono siguen limitando el tamaño práctico del modelo.

Referencias oficiales: [transferencia de datos WebRTC](https://webrtc.org/getting-started/data-channels) y [conexión, señalización y TURN](https://webrtc.org/getting-started/peer-connections).
