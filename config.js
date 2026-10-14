/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · configuración pública
   Lo único que cambia entre tu proyecto y otro. Todo lo de aquí es PÚBLICO
   por diseño: la llave "anon" la ve cualquier navegador. Lo que protege tus
   datos son las políticas de la base (supabase/migrations).

   NUNCA pongas aquí la llave "service_role" / secreta ni las credenciales
   de Autodesk: esas van solo en los secretos de las funciones de servidor.
   ═══════════════════════════════════════════════════════════════════════ */
window.AGEL_CONFIG = Object.assign({
  supabaseUrl: 'https://ajvijnvmvniafevcrqfj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdmlqbnZtdm5pYWZldmNycWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjM3MjYsImV4cCI6MjA5NTU5OTcyNn0.2U2umxWVOLN3QElhnV9-j3QY2-ALzU6aGpxyN7MRZUw',
  // Dirección pública del sitio (para enlaces y QR). Vacío = la dirección actual.
  siteUrl: '',
  // Visor de Autodesk (APS). La versión 7.* recibe correcciones de Autodesk.
  apsViewerScript: 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js',
  apsViewerStyle: 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css'
}, window.AGEL_CONFIG || {});
