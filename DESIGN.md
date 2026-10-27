---
name: Archgel — presentación
colors:
  background: '#000000'
  foreground: '#EDEAE4'
  muted: '#C7C4BE'
  glass: 'rgba(18,20,20,.42)'
  line: 'rgba(237,234,228,.23)'
typography:
  display:
    fontFamily: 'Syncopate, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 700
    lineHeight: 1
  body:
    fontFamily: 'Space Grotesk, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: '999px'
spacing:
  gutter: '28px'
  mobile-gutter: '14px'
---
## Overview
Modo Experience: la arquitectura ocupa todo el lienzo. Esta dirección pertenece a la presentación del showroom; no rediseña el editor, las cuentas ni el motor 360°.

## Colors
Interfaz monocroma sobre imágenes con sus materiales y colores originales. Los planos mantienen áreas transparentes en reposo y resaltan con blanco cálido al pasar el ratón, enfocar o tocar.

## Typography
Space Grotesk para controles y textos. Fuentes alojadas en el repositorio, con licencias incluidas. No mostrar un wordmark grande ni numeración de fases que compita con la arquitectura.

## Layout
Opening a pantalla completa, logo pequeño arriba a la izquierda e Iniciar abajo al centro. El documento queda bloqueado mientras se muestra el Opening; al iniciar o desmontar se restaura el acceso al contenido de la web. Fachada con niveles a la derecha, acciones auxiliares abajo a la izquierda, nombre real del proyecto arriba a la derecha y banda inferior discreta. No hay una segunda navegación por etapas. Nivel → planta → unidad, si tiene planta propia → habitación o punto 360°. Los destinos proceden del contenido configurado, nunca de escenas inventadas. Un nivel sin planta aparece desactivado.

En móvil los niveles conservan su posición derecha y permiten desplazamiento vertical si hace falta. Las acciones auxiliares se agrupan en Proyecto. Conservar zonas táctiles de al menos 44 px, legibilidad sin hover y acceso a imagen completa. El render puede cubrir el lienzo; Ver imagen completa permite encajarlo sin recortes, manteniendo las coordenadas de las zonas.

## Elevation & Depth
Cristal translúcido con desenfoque de 22–24 px, saturación suave y reflejo de borde. La banda inferior usa una base de opacidad .24 y conserva los colores de la imagen detrás. Controles con opacidad .78, plena en hover/foco o dispositivos táctiles. Hotspots, títulos y logo mantienen visibilidad completa.

## Motion
Inspiración DAO: logo que emerge del desenfoque en el Opening, imagen que se aclara con un desplazamiento de 6 px y zoom leve, fundido real entre vistas conservando la imagen anterior, aparición escalonada de los controles periféricos. Entrada 600–850 ms, imagen 700 ms, respuesta de botones 180 ms, curva cubic-bezier(.22,1,.36,1). Sin bucles decorativos sobre los planos. El movimiento reducido cancela también animaciones ya iniciadas. El contenido saliente queda fuera del foco y se retira al terminar la transición.

## Shapes
Solo la banda editorial inferior conserva bordes rectos. Los botones flotantes, niveles, navegación lateral y accesos auxiliares tienen forma de cápsula; reglas de un píxel. Paneles de información con radio de 20 px. Hotspots de escena circulares. El radio de las áreas procede de la geometría configurada por el autor.

## Components
Logo provisional: recorte con transparencia generado a partir del PNG invertido del usuario; el original se conserva. Es una propuesta provisional, no el vector final. Opening: únicamente logo y botón Iniciar sobre video/póster. No mostrar los antiguos títulos, subtítulos o enlaces auxiliares. Maqueta, BIM privado, ubicación y contacto conservan sus funciones existentes. No presentar acciones de recorrido disponibles cuando no existen escenas.

## Do's and Don'ts
Mantener los renders despejados y las transiciones respetuosas de movimiento reducido. Usar contenido real del proyecto; los edificios ficticios pertenecen solo a pruebas/capturas de demostración. No alterar el motor panorámico.
