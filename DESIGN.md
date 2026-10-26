---
name: Archgel — presentación
colors:
  background: '#000000'
  foreground: '#EDEAE4'
  muted: '#C7C4BE'
  glass: 'rgba(12,12,12,.78)'
  line: 'rgba(237,234,228,.23)'
typography:
  display:
    fontFamily: 'Syncopate, system-ui, sans-serif'
    fontSize: '48px'
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
Space Grotesk para controles y textos; Syncopate para la numeración de fases. Fuentes alojadas en el repositorio, con licencias incluidas. No mostrar un wordmark grande.

## Layout
Opening a pantalla completa, logo pequeño arriba a la izquierda e Iniciar abajo al centro. Fachada con selector de niveles izquierdo, acciones auxiliares debajo, nombre real del proyecto arriba a la derecha, etapas verticales a la derecha y banda editorial inferior. Las fases 02–04 describen fachada, planta y recorrido; no son niveles del edificio.

En móvil los niveles y etapas son horizontales, con desplazamiento cuando hace falta. Las acciones auxiliares se agrupan en Opciones del proyecto. Conservar zonas táctiles de al menos 44 px, legibilidad sin hover y acceso a imagen completa. El render puede cubrir el lienzo; Ver imagen completa permite encajarlo sin recortes, manteniendo las coordenadas de las zonas.

## Elevation & Depth
Cristal oscuro y blur de 19 px exclusivamente en controles sobre imagen. Opacidad de controles .78, plena en hover/foco o dispositivos táctiles. Hotspots, títulos y logo mantienen visibilidad completa.

## Shapes
Solo la banda editorial inferior conserva bordes rectos. Los botones flotantes, niveles, navegación lateral y accesos auxiliares tienen forma de cápsula; reglas de un píxel. Paneles de información con radio de 20 px. Hotspots de escena circulares. El radio de las áreas procede de la geometría configurada por el autor.

## Components
Logo provisional: recorte con transparencia generado a partir del PNG invertido del usuario; el original se conserva. Es una propuesta provisional, no el vector final. Opening: únicamente logo y botón Iniciar sobre video/póster. No mostrar los antiguos títulos, subtítulos o enlaces auxiliares. Maqueta, BIM privado, ubicación y contacto conservan sus funciones existentes. No presentar acciones de recorrido disponibles cuando no existen escenas.

## Do's and Don'ts
Mantener los renders despejados y las transiciones respetuosas de movimiento reducido. Usar contenido real del proyecto; los edificios ficticios pertenecen solo a pruebas/capturas de demostración. No alterar el motor panorámico.
