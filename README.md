# AgelArq

Plataforma para presentar proyectos arquitectónicos: editor de recorridos 360°, showroom comercial con catálogo y prospectos, panel de gestión para el equipo, y visor BIM con calendario 4D.

- **Configurar el showroom inmersivo:** [`docs/SHOWROOM-INMERSIVO.md`](docs/SHOWROOM-INMERSIVO.md).
- **Para subirla a GitHub y Supabase:** [`docs/PUBLICAR.md`](docs/PUBLICAR.md), paso a paso.
- **Límites durante la prueba gratuita:** [`docs/PLAN-GRATUITO.md`](docs/PLAN-GRATUITO.md).
- **Qué cambió y cómo se probó:** [`docs/CAMBIOS.md`](docs/CAMBIOS.md).
- **Rumbo del producto:** [`docs/plan-maestro.html`](docs/plan-maestro.html) (ábrelo en el navegador).

## Las cuatro apps

| Dirección | Para quién | Qué hace |
|---|---|---|
| `index.html` | tú y tu equipo | editor de escenas y hotspots; guarda borradores y archivos en el dispositivo; la subida a la nube es explícita |
| `index.html?pub=<dirección>` | clientes | recorrido 360° publicado (versión aprobada) |
| `apps/showroom/?p=<dirección>` | público | página comercial: unidades, galería, planos, recorrido, contacto |
| `apps/panel/` | equipo | showroom, catálogo, publicaciones, prospectos, equipo, modelos, marca y uso |
| `apps/bim/?v=<versión>` | equipo | modelo de Autodesk con filtros MEP, propiedades, vistas, incidencias y 4D |

Los enlaces antiguos (`?visor=1&id=…`, `?modelo=1&id=…`) siguen funcionando.

## Estructura

```
index.html                  editor + visor + modelos D5
config.js                   dirección de Supabase y llave pública (anon). Nada secreto.
apps/
  editor/                   modo nube del editor (acceso, guardado central, publicar, importar)
  showroom/                 showroom público
  panel/                    panel de gestión
  bim/                      visor BIM (y pano.html para ver la escena 360° ligada)
packages/
  core/                     validación (schema.js), cliente de Supabase (cloud.js), interfaz sin innerHTML (dom.js)
  panorama/                 motor 360 compartido (PanoEngine)
  showroom/                 renderizador del showroom (navegador y pre-generación)
  bim/                      adaptador del visor de Autodesk, clasificación MEP, 4D
  ui/                       estilos compartidos
supabase/
  migrations/               base de datos, permisos (RLS) y Storage, en orden
  functions/                funciones de servidor: Autodesk (APS) y avisos de prospectos
  manual/                   SQL que se corre a mano en momentos concretos
  tests/                    pruebas de permisos sobre Postgres real
scripts/
  prerender-showroom.mjs    páginas estáticas de showroom para buscadores + sitemap
tests/                      pruebas en navegador real y de módulos
.github/workflows/          corre todas las pruebas en cada cambio
```

## Abrir la app en tu computadora

```bash
python3 -m http.server 8000
```

y abre <http://localhost:8000>.

## Respaldo

Sin cuenta, tus proyectos viven en el navegador (localStorage + IndexedDB): **Respaldo** descarga un `.json` con todo y **Restaurar** lo recupera. Con cuenta, viven en Supabase con historial de revisiones, y **Panel → Exportar** descarga el proyecto completo.

## Pruebas

Requisitos: Node 18+, Python 3.10+, Deno 2, Postgres 15+ y el binario de PostgREST 12 (el CI los instala solo; ver `.github/workflows/pruebas.yml`).

```bash
node tests/syntax.js index.html apps/*/index.html     # sintaxis y botones
node tests/unit_fourd.js && node tests/unit_classify.js
deno test supabase/functions/tests/                   # funciones de servidor

npm ci --prefix tests/vendor                          # una vez
pip install -r tests/requirements.txt                 # una vez
python -m playwright install chromium                 # una vez

export AGEL_PG="host=localhost port=5432 user=postgres password=…"
export AGEL_POSTGREST=/ruta/a/postgrest
python supabase/tests/run.py          # permisos de la base
python tests/e2e.py index.html        # editor sin cuenta
python tests/e2e_cloud.py             # editor con cuenta
python tests/e2e_showroom.py          # showroom
python tests/e2e_bim.py               # panel y visor BIM (Autodesk simulado)
```

Todas aceptan `-k texto` para correr solo las pruebas cuyo nombre lo contiene. Ninguna toca tu Supabase real.

## Reglas

- `main` es lo que ven tus clientes: los cambios llegan por rama y Pull Request, con las pruebas en verde.
- La llave **anon** de `config.js` es pública por diseño; lo que protege los datos son las políticas de `supabase/migrations`.
- La llave **service_role** y las credenciales de Autodesk van solo en los secretos de las funciones de Supabase. Nunca en este repositorio.
