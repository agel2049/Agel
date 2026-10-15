# Crear un showroom inmersivo

El showroom es una página web comercial. Su primera pantalla puede ser un Opening; el botón lleva a la fachada. Desde la entrada o los niveles se abre una planta; desde la planta se elige una unidad y su recorrido 360°. No incluye Ending.

## 1. Preparar el catálogo

En **Panel → tu proyecto → Catálogo**, crea edificio, niveles y departamentos. En cada departamento marca **Escenas 360° de este espacio**. Esas asociaciones determinan qué escenas se pueden colocar en su planta y cuáles aparecen en el recorrido.

El CSV acepta `grupo,nivel,nombre,clave,m2,recamaras,banos,estacionamientos,precio,mostrar_precio,estado`. `nivel` es opcional. Las claves duplicadas se rechazan antes de importar. No se deducen niveles del nombre del departamento.

## 2. Agregar fachada y plantas

En **Showroom → Explorar: render o plano con zonas**, pulsa **Agregar vista (render o planta)**. Selecciona la fachada y después las plantas. Los archivos se guardan en tu dispositivo. Espera el aviso de guardado.

En **Experiencia del showroom → Relaciones de las vistas**, asigna a cada imagen su espacio y uso: Fachada, Lobby, Planta de nivel o Planta de unidad. Si acabas de agregar imágenes, los selectores se actualizan. Una planta de unidad debe estar asociada a ese departamento.

En cada vista pulsa **Dibujar zonas**:

- **Esta vista corresponde a** delimita su catálogo y escenas disponibles.
- **Zona de** selecciona el departamento o espacio. El destino puede ser su ficha/planta, otra vista o una escena 360°.
- Haz clic para agregar vértices; **90°** limita los segmentos nuevos a horizontal o vertical. Puedes activarlo o desactivarlo durante el dibujo sin perder puntos. Shift lo aplica temporalmente.
- **Cerrar zona** confirma el contorno. Activa **Redondear esquinas** y ajusta el radio entre 0 y 2 % del lado menor de la imagen.
- **Colocar escenas 360°** muestra las escenas del espacio asociado y sus descendientes. Selecciona una y haz clic donde está la cámara. Si cambias el alcance, corrige los puntos incompatibles antes de guardar.
- **Listo y guardar** conserva los cambios. Cancelar mantiene la vista anterior.

En la web las zonas son transparentes en reposo. Aparecen al pasar el ratón, recibir foco con teclado o seleccionarse en pantalla táctil. En táctil, un segundo toque abre el destino. Los puntos 360° tienen prioridad sobre las áreas.

## 3. Configurar Opening y entrada

En **Experiencia del showroom**:

1. Activa **Activar showroom inmersivo**.
2. Opcionalmente activa **Activar Opening**. Escribe título, subtítulo y **Texto del botón**. Puedes pegar una URL HTTPS o usar **Agregar video local** y **Agregar póster local**. Un video que no pueda reproducirse no bloquea el botón.
3. En **Fachada inicial**, selecciona el render exterior.
4. En **Planta de entrada**, selecciona el lobby u otra planta distinta de la fachada.
5. Haz clic sobre la fachada de configuración para colocar el acceso; también puedes ajustar **Entrada X/Y (%)** y su texto.
6. Pulsa **Guardar experiencia en este dispositivo**.

La imagen ocupa la pantalla. Los controles de cristal flotan encima y recuperan su opacidad al pasar el ratón o recibir foco. **Ver imagen completa** permite recuperar los bordes de una planta recortados por el modo pantalla completa. Las coordenadas de las zonas no cambian.

## 4. Revisar, subir y publicar

Estas acciones son distintas:

1. **Guardar en este dispositivo** conserva el borrador personal. La web publicada sigue con su versión anterior.
2. **Vista previa local** abre el borrador en el mismo navegador, origen y cuenta. El recorrido utiliza automáticamente la planta de la unidad, o la del nivel correspondiente; no toma una planta ajena.
3. **Respaldar archivos locales** guarda manifiesto y archivos. Si el navegador no ofrece carpetas, permite las descargas múltiples y comprueba que estén todos. Conserva también los originales. **Restaurar respaldo** requiere `agelarq-respaldo.json` y sus archivos; crea nuevas referencias y conserva los anteriores.
4. **Subir a la nube** muestra el inventario y los bloqueos. Solo **Confirmar subida** transmite archivos. **Pausar sincronización** conserva lo completado. Un reintento reutiliza reservas y archivos verificados. Un conflicto de revisión conserva el borrador y exige resolver qué versión guardar.
5. En **Publicaciones**, crea una publicación de tipo Showroom. Pulsa **Crear versión con el contenido actual**, revisa **Vista previa** y publica la versión aprobada.

Los archivos locales no tienen el límite artificial del bucket, pero dependen del espacio y las capacidades del navegador. La nube mantiene el presupuesto conservador de 800 MB y límites por archivo de 16 MiB en media y 32 MiB en models/technical. Un archivo mayor permanece local: usa una copia optimizada para publicar. Borrar datos del navegador puede eliminar el borrador; el respaldo es necesario.

## 5. Hotspots y BIM

**Apariencia de hotspots 360°** permite elegir Plano, Suelo o Pared, inclinación, giro y escala. Es una presentación visual del marcador; no cambia la geometría ni las coordenadas del motor 360.

En **BIM privado**, selecciona una versión del modelo de este proyecto. El botón BIM se muestra solo a cuentas del equipo con permiso y cuando la versión está lista. El modelo y sus ajustes no entran en el JSON comercial público.

El visor BIM ofrece Completo, MEP, Con acabados y Obra gris. MEP une las disciplinas seleccionadas. Configura categorías/disciplina/niveles reales para acabados y obra gris; un preset sin configuración no simula un resultado. La conexión real con Navisworks mediante Autodesk requiere credenciales APS, despliegue de sus funciones y conversión del archivo. Las pruebas simuladas no sustituyen esa configuración.

## Proyectos anteriores

Las publicaciones antiguas conservan sus snapshots. Para migrar, asocia las vistas existentes a espacios, configura la experiencia y crea una versión nueva después de sincronizar. No es necesario rehacer el recorrido 360°. Conserva siempre la versión publicada anterior para poder volver a ella.
