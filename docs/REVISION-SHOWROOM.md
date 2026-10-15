# Revisión de la entrega del showroom

La revisión independiente encontró ocho problemas importantes. Se añadieron reproducciones que fallaban y se corrigieron: formularios antiguos que pisaban cambios, recuperación D5 anterior, separación de cuenta/invitado D5, avisos de guardado falso ante falta de espacio, selección explícita local/nube D5, ciclos del catálogo, herencia de una planta ajena y niveles mezclados entre edificios. El motor panorama no cambia.

## Decisiones de implementación

- Se reutilizó el checkout aislado existente. Evita duplicar carpetas; el riesgo era mezclar trabajo local, y se comprobó que la rama estaba limpia al comenzar.
- El auxiliar de tareas no podía ejecutarse por permisos; el avance y las pruebas se registraron directamente. No se cambiaron permisos de herramientas; el coste es una trazabilidad manual en el registro.
- La comprobación de coordenadas del navegador admite menos de 0,2 puntos porcentuales por redondeo de píxeles. La horizontalidad/verticalidad sigue siendo exacta; el coste es que la prueba admite diferencias menores que esa tolerancia.
- Los respaldos crean una carpeta fechada. Restaurar genera referencias nuevas para conservar los originales. El coste es espacio adicional en el dispositivo.
- D5 usa un espacio personal separado por cuenta; los datos anteriores sin propietario se recuperan solo como invitado y se conserva su registro anterior. El coste es que pasar ese contenido a una cuenta exige una importación explícita. La ruta pública heredada para compartir D5 continúa sometida al cierre de subidas anónimas del despliegue anterior; esta entrega no reabre esa política.
- La imagen cubre el viewport conservando sus proporciones. Esto recorta bordes cuando pantalla e imagen tienen distinta proporción; **Ver imagen completa** permite recuperar el plano entero. Las zonas mantienen las coordenadas originales.

## Pendientes menores

- Cambiar de escena dentro del recorrido aún no actualiza el enlace canónico a la escena nueva.
- El Opening arranca silenciado y todavía no tiene un control para activar sonido.

## Despliegue

El PR y la transacción incremental están preparados para revisión. No integrar en `main` antes de aplicar las cuatro migraciones al Supabase autorizado. Las pruebas usan servicios locales o simulados: no acreditan una conversión real de Navisworks ni disponibilidad de Autodesk sin credenciales APS.
