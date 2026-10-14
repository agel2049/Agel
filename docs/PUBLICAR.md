# Cómo subir AgelArq a GitHub y Supabase, paso a paso

Esta guía es para hacerlo tú, sin programar. Sigue el orden. Cada paso dice cómo comprobar que salió bien antes de pasar al siguiente.

**Tiempo estimado:** 1 a 2 horas para lo básico (pasos 1 a 7). El visor BIM (paso 9) y los avisos de prospectos (paso 10) son opcionales y puedes hacerlos otro día.

**Antes de empezar**

- Haz un **Respaldo** desde la app actual (panel de escenas → Respaldo). Guarda el archivo `.json` en un lugar seguro.
- Se reportó un aviso de gracia por consumo. Verifica el periodo y la categoría en Usage; el estado actual y el margen de prueba están en `PLAN-GRATUITO.md`.

---

## Paso 0. Revisa la cuota de Supabase

1. Entra a <https://supabase.com/dashboard> y abre tu proyecto (`ajvijnvmvniafevcrqfj`).
2. Ve a **Settings → Billing** (o **Usage**). Mira qué límite pasaste: almacenamiento, transferencia o base de datos.
3. Conserva el plan gratuito. No borres archivos sin inventario y respaldo. Eliminar archivos no reduce transferencia ya consumida.
4. Revisa por separado los contadores cached y uncached egress (5 GB cada uno). Si un límite impide escribir, no continúes el despliegue hasta resolver ese estado; no cambies de plan automáticamente.

**Comprobación:** el aviso desaparece o al menos el proyecto deja de estar en solo lectura.

---

## Paso 1. Sube el código a GitHub (en una rama, no en `main`)

Así tus clientes siguen viendo la versión actual mientras revisas la nueva.

**Con la copia preparada y revisada:**

1. Usa una copia nueva de `https://github.com/agel2049/Agel.git`; conserva su historial remoto.
2. Copia los archivos de la plataforma y las correcciones revisadas, excluyendo el `.git` del ZIP, dependencias, herramientas locales y resultados de pruebas.
3. Trabaja en `codex/agelarq-plataforma-revisada`. Publica esa rama y crea un Pull Request; conserva `main` hasta verificar base de datos, acceso y pruebas.
4. La sesión web y la autorización de la herramienta de publicación son accesos distintos. Si falta escritura, autoriza la herramienta oficial de GitHub desde tu cuenta; nunca pegues tokens ni contraseñas en un chat.

**Comprobación:** en GitHub, pestaña **Pull requests**, aparece tu PR. En la pestaña **Checks** del PR, las pruebas automáticas corren solas (tardan unos 10 minutos). Deben terminar en verde.

> Si GitHub Desktop dice que la carpeta no tiene el remoto correcto, en **Repository → Repository settings → Remote** pon `https://github.com/agel2049/Agel.git`.

---

## Paso 2. Crea las tablas y permisos en Supabase

Son 12 archivos en `supabase/migrations/`. Para el primer despliegue en un esquema public vacío, usa `supabase/manual/02-despliegue-inicial-revisado.sql`: contiene los doce, en orden y en una transacción. Cancela si ya existen tablas public. Verifica primero en local; no uses este archivo en una instalación existente.

1. En Supabase: **SQL Editor → New query**.
2. Abre el archivo de despliegue inicial revisado en un editor de texto y copia todo su contenido.
3. Pégalo, verifica que es el archivo revisado completo y pulsa **Run**. Ante un error, la transacción no debe confirmarse: revisa el mensaje antes de continuar.
4. Las migraciones incluidas son:

| # | Archivo | Qué crea |
|---|---|---|
| 1 | `…000100_acceso.sql` | organizaciones, proyectos, roles |
| 2 | `…000200_storage.sql` | espacios de archivos `media`, `models`, `technical` |
| 3 | `…000300_contenido.sql` | escenas, hotspots, historial, subidas con cuota |
| 4 | `…000400_catalogo.sql` | torres, niveles, unidades, precios |
| 5 | `…000500_publicaciones.sql` | versiones publicadas y enlaces antiguos |
| 6 | `…000600_prospectos.sql` | formulario de contacto del showroom |
| 7 | `…000700_bim.sql` | modelos BIM, vistas, incidencias |
| 8 | `…000800_etapas_4d.sql` | calendario 4D |
| 9 | `…000900_operacion.sql` | bitácora, marca, uso y exportación |
| 10 | `…001000_medicion.sql` | contadores de visitas sin datos personales |
| 11 | `…001100_aps.sql` | apoyo para Autodesk y avisos de prospectos |
| 12 | `…001200_subidas_seguras.sql` | registro de consumo protegido y margen de prueba gratuito |

Si un archivo da error, **no sigas**: revisa el estado de la transacción. No repitas migraciones a ciegas. El archivo inicial registra versiones y hashes en `app.deployment_migrations`; ese registro no sustituye el historial de Supabase CLI. Antes de usar `supabase db push` más adelante, concilia las versiones aplicadas con el historial de la CLI.

**Comprobación:** en **Table Editor** aparecen `organizations`, `projects`, `scenes`, `spaces`, `publications`, `leads`, `models` y más. En **Storage** aparecen los buckets `media`, `models` y `technical`, además de tu `panoramas` de siempre.

> **No corras** `supabase/manual/01-cerrar-subida-publica.sql` todavía. Cierra la subida pública al bucket `panoramas` y va en el paso 8, cuando ya trabajes con tu cuenta.

---

## Paso 3. Configura el inicio de sesión

En Supabase, **Authentication**:

1. **Sign In / Providers → Email:** activado. Desactiva **Allow new users to sign up**. Así nadie puede crearse una cuenta en tu proyecto; tú invitas a quien quieras.
2. **URL Configuration:**
   - **Site URL:** la dirección donde se publica tu app. Si usas GitHub Pages, es algo como `https://agel2049.github.io/Agel/`.
   - **Redirect URLs:** agrega esa misma dirección y también `http://localhost:8000/**` si pruebas en tu computadora.
3. **Users → Add user → Create new user:** crea tu cuenta con tu correo y una contraseña segura. Marca "Auto confirm user".

**Comprobación:** tu correo aparece en la lista de usuarios.

---

## Paso 4. Ajusta `config.js`

Abre `config.js` (en la raíz). Ya tiene la dirección de tu Supabase y la llave **anon** (es pública por diseño; no es un secreto).

- Si publicas en GitHub Pages, llena `siteUrl` con la misma dirección del paso 3, por ejemplo `'https://agel2049.github.io/Agel/'`. Se usa para los enlaces y QR que compartes.
- **Nunca** pongas ahí la llave `service_role` ni las credenciales de Autodesk.

Si lo cambias, súbelo a la misma rama (GitHub Desktop: escribe un mensaje abajo a la izquierda → **Commit to plataforma** → **Push origin**).

---

## Paso 5. Prueba la nueva versión antes de publicarla

En tu computadora, dentro de la carpeta `agel`:

```
python3 -m http.server 8000
```

Abre <http://localhost:8000>.

1. Aparece la pantalla **Entrar**. Entra con la cuenta del paso 3.
2. Te pide el nombre de tu organización (tu estudio). Créala.
3. Menú de tu cuenta (arriba a la derecha) → **Importar proyectos de este navegador**. Antes de importar descarga un respaldo automáticamente; luego te muestra un reporte.

   Ojo: "este navegador" en `localhost` no tiene tus proyectos. Para importarlos, ve al paso 7 después de publicar, o restaura tu archivo de Respaldo aquí primero (Seguir sin cuenta → Restaurar → luego entra con tu cuenta e importa).

4. Abre un proyecto, sube una panorámica, recarga la página: debe seguir ahí. Arriba verás "Guardado".

**Comprobación:** en Supabase, **Table Editor → scenes** aparece tu escena; en **Storage → media** aparece la imagen dentro de una carpeta con el id del proyecto.

---

## Paso 6. Publica en `main`

Cuando el paso 5 funcione y las pruebas del PR estén en verde:

1. En GitHub, abre el Pull Request → **Merge pull request** → **Confirm merge**.
2. Si usas GitHub Pages, espera 1 o 2 minutos a que se actualice.

**Comprobación:** abre tu sitio. Aparece la pantalla de Entrar. Los enlaces antiguos de visor (`?visor=1&id=…`) que ya mandaste a clientes **siguen funcionando** igual que antes.

---

## Paso 7. Pasa tus proyectos a la nube y crea tus primeras publicaciones

1. Abre tu sitio publicado **en el mismo navegador donde trabajabas antes** (ahí viven tus proyectos locales).
2. Entra con tu cuenta → menú → **Importar proyectos de este navegador**. Revisa el reporte.
3. Para compartir un recorrido: menú → **Publicar**. Eliges una dirección corta; el enlace queda como `…/index.html?pub=torre-mirador`.
4. Para el showroom comercial: menú → **Panel**.
   - **Showroom:** textos, galería, planos, contacto, modelo 3D opcional. En **Explorar** sube un render del conjunto o una planta y pulsa **Dibujar zonas**: toca el contorno de cada edificio o unidad y coloca los puntos de las escenas 360°. En **Avance de obra** agrega hitos con fotos.
   - **Catálogo:** torres, niveles y unidades (o **Importar CSV**). El precio solo se publica si marcas "Mostrar precio".
   - **Publicaciones → Nueva publicación → Showroom** → **Crear versión** (antes revisa lo que falta o está roto) → **Vista previa** o **En celular** → **Publicar**.
   - **Enlaces antiguos:** dentro de cada publicación puedes conectar un `id=` viejo para que ese enlace abra la versión nueva.
5. **Equipo:** invita gente. Primero crea su cuenta en Supabase (paso 3, punto 3) y luego agrégala aquí con su rol.

| Rol | Puede |
|---|---|
| Propietario | todo, incluido publicar, invitar y borrar |
| Editor | editar escenas, showroom y catálogo; ver prospectos; no publica |
| Revisor | ver todo y comentar incidencias en el modelo BIM |
| Lector | solo ver |

---

## Paso 8. Cierra la subida pública al bucket viejo

Hoy cualquiera con tu llave pública puede **subir** archivos a `panoramas` (no borrarlos). Ciérralo solo cuando ya trabajes con tu cuenta:

1. Comprueba que ya entras con tu cuenta y que subir panorámicas funciona (van a `media`, no a `panoramas`).
2. SQL Editor → pega todo el contenido de `supabase/manual/01-cerrar-subida-publica.sql` → **Run**.

**Comprobación:** el resultado muestra solo `public_select 1fcgrry_0`. Los enlaces viejos siguen abriendo (la lectura sigue pública); subir sin sesión ya no funciona. Desde ese momento, en el modo "Seguir sin cuenta" ya no se crean enlaces nuevos de visor: para compartir, entra y usa **Publicar**.

---

## Paso 9 (opcional). Visor BIM con Autodesk

Necesitas una cuenta de Autodesk Platform Services y la consola de Supabase en tu computadora.

**9.1 Crea la aplicación en Autodesk**

1. <https://aps.autodesk.com> → **Applications → Create application** (tipo "Server-to-Server" o "Traditional Web App").
2. Activa las APIs **Data Management** y **Model Derivative**.
3. Copia el **Client ID** y el **Client Secret**. El secreto es como una contraseña: no lo pegues en `config.js`, en GitHub ni en un chat.
4. Revisa los precios y límites gratuitos actuales de Model Derivative en la página de Autodesk antes de convertir modelos grandes.

**9.2 Sube las funciones de servidor a Supabase**

Requiere Node 18 o más nuevo. En una terminal, dentro de la carpeta `agel`:

```
npx supabase login
npx supabase link --project-ref ajvijnvmvniafevcrqfj
npx supabase secrets set APS_CLIENT_ID=tu_client_id APS_CLIENT_SECRET=tu_client_secret
npx supabase functions deploy aps-upload --use-api
npx supabase functions deploy aps-translate --use-api
npx supabase functions deploy aps-status --use-api
npx supabase functions deploy aps-token --use-api
```

Opcional: `APS_BUCKET=nombre-unico` si quieres elegir el nombre del almacenamiento en Autodesk (minúsculas, números y guiones).

**9.3 Úsalo**

Panel → **Modelos y 4D → Nuevo modelo → Subir versión** (NWD de Navisworks recomendado). Cuando diga **Listo**, **Abrir visor** → **Indexar ahora** (una vez por versión). Desde ahí: filtros por disciplina, sistema, nivel y etapa; propiedades; vistas guardadas con su escena 360°; incidencias; y **4D** si importas el calendario (CSV de TimeLiner o XML de Microsoft Project, desde el panel).

**Comprobación:** en Supabase, **Edge Functions** muestra las 4 funciones. Si algo falla, el mensaje del panel dice qué secreto falta.

---

## Paso 10 (opcional). Avisos de prospectos por correo o a tu CRM

1. Panel → **Showroom → Avisos internos:** pon el correo que recibe los avisos y/o la dirección de webhook de tu CRM (Zapier, Make, HubSpot; debe empezar con `https://`).
2. Para correo, crea una cuenta en <https://resend.com>, verifica tu dominio y obtén una API key. Luego:

```
npx supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_FROM="Avisos <avisos@tudominio.mx>"
npx supabase secrets set WEBHOOK_SECRET=una_frase_larga_al_azar
npx supabase functions deploy lead-notify --use-api
```

3. Supabase → **Database → Webhooks → Create a new hook:** tabla `leads`, evento **Insert**, tipo **Supabase Edge Functions**, función `lead-notify`, y activa **Add auth header with service key**.

**Comprobación:** envía una solicitud de prueba desde tu showroom; llega el correo o el registro a tu CRM. En el panel → Prospectos aparece de inmediato aunque el aviso falle.

---

## Paso 11 (opcional). Que Google encuentre tus showrooms

El showroom funciona sin esto, pero los buscadores leen mejor una página ya armada:

```
node scripts/prerender-showroom.mjs --site https://agel2049.github.io/Agel/
```

Crea `p/<dirección>/index.html` por cada showroom público y un `sitemap.xml`. Súbelos a GitHub (commit + push) y vuelve a correrlo cuando publiques una versión nueva. Las publicaciones marcadas **Solo con enlace** no se incluyen.

---

## Si algo sale mal

- **"La base de datos aún no tiene esta función"**: falta correr una migración del paso 2.
- **"No tienes permiso para esta acción"**: tu rol en ese proyecto no lo permite (Panel → Equipo).
- **"El archivo supera el tamaño permitido por tu plan"**: límite de Supabase; reduce la imagen o revisa el plan.
- **Modelos D5 (HTML):** Supabase entrega los archivos HTML como texto por seguridad. Si un enlace D5 muestra código en lugar del modelo, ese HTML necesita otro alojamiento (por ejemplo, la misma página de GitHub Pages).
- Para volver atrás: en GitHub, el PR fusionado tiene un botón **Revert**. Tus datos en Supabase no se borran al revertir el código.
