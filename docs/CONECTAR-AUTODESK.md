# Conectar Navisworks a AgelArq

Estado al 15 de octubre de 2026: el GLB local tiene su propio visor y filtros. La conexión NWD mediante Autodesk está preparada en el código, pero todavía no tiene una app APS, claves ni funciones desplegadas verificadas con Autodesk real.

## 1. Crear el acceso gratuito

Entra con tu cuenta en [Autodesk Platform Services](https://aps.autodesk.com). Tener cuenta Autodesk no equivale a tener una app APS.

Si aún no tienes un Developer Hub, adquiere la oferta **APS Free**, asígnala a tu equipo y, en [Autodesk Account](https://manage.autodesk.com), abre **Products and Services → Hubs → Create hub → APS Developer Hub**. Nombre propuesto: **AgelArq**.

La documentación actual de Autodesk indica que el alta del plan gratuito puede solicitar un medio de pago. Realiza tú ese paso y revisa sus condiciones. Conserva **Free**; no actives Pay as You Go ni compres Flex para estas pruebas. El consumo de Autodesk es independiente de Supabase y tiene sus propios topes mensuales.

## 2. Registrar la app

En APS, abre **My applications**, selecciona el Developer Hub y pulsa **Create application**:

| Campo | Valor para esta integración |
| --- | --- |
| Nombre | AgelArq BIM |
| Tipo | Server-to-Server App |
| Descripción | Conversión privada de modelos NWD y visualización con filtros para equipos de AgelArq. |
| APIs | Data Management y Model Derivative |

Este flujo utiliza autenticación de servidor y la cuenta de AgelArq para autorizar al equipo. No necesita una URL de retorno de inicio de sesión Autodesk. Una futura conexión a proyectos ACC/BIM 360 requerirá otro diseño de permisos; no queda habilitada con esta app.

Guarda el **Client ID** y el **Client Secret** en tu gestor de contraseñas. No los pegues en el chat, GitHub ni archivos públicos.

## 3. Guardar los secretos en Supabase

Abre el proyecto **ajvijnvmvniafevcrqfj → Edge Functions → Secrets**. Añade estos nombres, introduciendo tú los valores:

| Nombre | Contenido |
| --- | --- |
| APS_CLIENT_ID | Client ID de la app |
| APS_CLIENT_SECRET | Client Secret de la app |

No configures `APS_BASE_URL`: está reservado para pruebas simuladas. `APS_BUCKET` es opcional; el servidor genera un nombre si no se define.

## 4. Desplegar y comprobar

Una vez creados la app y los secretos, se pueden desplegar las funciones existentes **aps-upload**, **aps-translate**, **aps-status** y **aps-token**. Esa etapa sigue pendiente; registrar la app no despliega funciones automáticamente.

La comprobación real será con un NWD pequeño elegido por ti, desde **Panel → Modelos 3D → Nuevo modelo → Subir versión**. Esta acción sí envía el archivo a Autodesk y solicita su conversión. El archivo viaja directamente a su almacenamiento; Supabase conserva metadatos y permisos. No se debe confundir con **Agregar GLB local**, que mantiene el archivo en el dispositivo.

Cuando la versión esté lista, abre su visor e indexa sus propiedades. Comprueba filtros de instalaciones, albañilería, estructura y acabados según los datos presentes en el modelo. La conexión seguirá siendo privada para el equipo con cuenta. Antes de convertir más archivos, consulta el consumo en el Developer Hub.

## Fuentes oficiales consultadas

- [Crear una app y proteger sus credenciales](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/create-app).
- [Preparación del Developer Hub y tipos de app](https://get-started.aps.autodesk.com/).
- [Alta del Developer Hub y requisitos del plan](https://aps.autodesk.com/blog/aps-developer-hub-setup-and-app-migration).
- [Modelo Free, topes y opciones de pago](https://aps.autodesk.com/blog/aps-business-model-evolution).
