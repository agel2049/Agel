/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · PanoEngine — motor 360 compartido (plan maestro V01)

   Antes había dos implementaciones casi iguales (editor y visor de cliente)
   que ya se comportaban distinto. Medido en navegador: el visor tenía dos
   manejadores de rueda (zoom al doble: FOV 65 contra 60 del editor con el
   mismo giro de rueda) y una inercia distinta al soltar (13,8° contra 15,7°
   con el mismo arrastre). Este motor es el único que usan el editor, el
   visor por enlace y el showroom.

   Responsabilidades del motor (y solo estas):
     cámara (lon/lat/fov), entrada unificada (ratón, táctil, lápiz) con
     inercia y pellizco, render bajo demanda, fundido entre panorámicas,
     ajuste de texturas al dispositivo, proyección de hotspots, selección de
     un punto de la esfera, rotación automática y modo VR (WebXR).
   Las reglas de negocio (escenas, permisos, publicaciones) quedan fuera.

   Requiere THREE (r128) cargado antes. Script clásico: expone
   window.AgelPano = { PanoEngine, pctToVec3, vec3ToPct }.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const RADIUS = 500;
  const MOBILE_TEX_CAP = 4096;

  const MARKER_SLOP = 6;   // px: más que esto es arrastre, no toque

  /* Convención de anclaje: x, y son porcentajes de la imagen equirectangular
     completa (no de la pantalla). x 0–100 → longitud −180°…180° (50 = centro
     de la imagen); y 0–100 → latitud 90°…−90° (50 = horizonte). Si se cambia
     la panorámica por otra con distinta orientación, hay que revisar los anclajes. */
  function pctToVec3(x, y, r = RADIUS) {
    const lo = THREE.MathUtils.degToRad((x / 100) * 360 - 180);
    const la = THREE.MathUtils.degToRad(90 - (y / 100) * 180);
    return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)).multiplyScalar(r);
  }
  function vec3ToPct(v) {
    const p = v.clone().normalize();
    const x = ((Math.atan2(p.z, p.x) + Math.PI) / (2 * Math.PI)) * 100;
    const y = ((Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, p.y)))) / Math.PI) * 100;
    return { x, y };
  }

  class PanoEngine {
    /**
     * @param {object} o
     *   canvas, container            elementos DOM
     *   fov=55, minFov=20, maxFov=100
     *   onFov(fov)                   para etiquetas de zoom
     *   onDragStart(), onDragEnd()   para el cursor propio
     *   interceptPointerDown(e)      devolver true para consumir el gesto (p. ej. colocar un hotspot)
     *   isMobile                     limita texturas a 4096 px aunque la GPU acepte más
     *   onTextureCapped(info)        aviso cuando una panorámica se reduce
     */
    constructor(o) {
      this.o = Object.assign({ fov: 55, minFov: 20, maxFov: 100 }, o);
      this.canvas = o.canvas;
      this.container = o.container || o.canvas.parentElement;
      this._lon = 0; this._lat = 0; this._fov = this.o.fov;
      this.autoRotate = false; this.autoRotateSpeed = 0.04;
      this.isDragging = false;
      this.needsRender = true;
      this.hotspots = [];
      this._vel = { lon: 0, lat: 0 }; this._inertiaRaf = null; this._xfRaf = null; this._fovRaf = null;
      this._ptrs = new Map(); this._pinch = null; this._last = null;
      this._tmp = new THREE.Vector3();
      this._rect = null;
      this._disposed = false;
      this._init();
    }

    // ── cámara ────────────────────────────────────────────────────────────
    get lon() { return this._lon; }
    set lon(v) { this._lon = v; this._applyView(); }
    get lat() { return this._lat; }
    set lat(v) { this._lat = Math.max(-85, Math.min(85, v)); this._applyView(); }
    get fov() { return this._fov; }
    set fov(v) {
      this._fov = Math.max(this.o.minFov, Math.min(this.o.maxFov, v));
      if (this.camera) { this.camera.fov = this._fov; this.camera.updateProjectionMatrix(); }
      this.invalidate();
      if (this.o.onFov) this.o.onFov(this._fov);
    }
    setView(lon, lat, fov) {
      this._lon = lon; this._lat = Math.max(-85, Math.min(85, lat));
      if (fov != null) this.fov = fov; else this._applyView();
      this._applyView();
    }
    _applyView() {
      if (!this.camera) return;
      const phi = THREE.MathUtils.degToRad(90 - this._lat);
      const th = THREE.MathUtils.degToRad(this._lon);
      this.camera.lookAt(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
      this.invalidate();
    }
    // Sensibilidad proporcional al zoom: a FOV 20 el paneo no "resbala".
    dragK() { return 0.06 * (this._fov / 55); }
    zoomBy(delta) { this.fov = this._fov + delta; }

    animateFov(to, ms = 380) {
      cancelAnimationFrame(this._fovRaf);
      const from = this._fov, t0 = performance.now();
      return new Promise(res => {
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / ms);
          this.fov = from + (to - from) * (1 - Math.pow(1 - t, 3));
          if (t < 1) this._fovRaf = requestAnimationFrame(step); else res();
        };
        this._fovRaf = requestAnimationFrame(step);
      });
    }

    invalidate() { this.needsRender = true; }

    // ── arranque ──────────────────────────────────────────────────────────
    _init() {
      const c = this.canvas;
      const w = c.clientWidth || this.container.clientWidth || 1, h = c.clientHeight || this.container.clientHeight || 1;
      this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
      this.maxTexture = this.renderer.capabilities.maxTextureSize || 4096;
      this.maxAniso = this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 1;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(this._fov, w / h, 0.1, 1000);
      this.camera.position.set(0, 0, 0.01);
      const geo = new THREE.SphereGeometry(RADIUS, 64, 32); geo.scale(-1, 1, 1);
      this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x080810 }));
      this.scene.add(this.sphere);
      // Esfera de fundido por dentro de la base: la panorámica nueva aparece encima.
      const geoF = new THREE.SphereGeometry(RADIUS * 0.96, 64, 32); geoF.scale(-1, 1, 1);
      this.fadeSphere = new THREE.Mesh(geoF, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      this.fadeSphere.visible = false; this.fadeSphere.renderOrder = 1;
      this.scene.add(this.fadeSphere);
      this._applyView();

      // setAnimationLoop (en vez de requestAnimationFrame) es obligatorio en VR.
      this.renderer.setAnimationLoop(() => this._frame());

      this._bindInput();
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(c);
      this._onWinResize = () => { this._rect = null; this.invalidate(); };
      root.addEventListener('resize', this._onWinResize);
    }

    _frame() {
      if (this._disposed) return;
      const xr = this.renderer.xr && this.renderer.xr.isPresenting;
      if (this.autoRotate && !this.isDragging && !xr) { this._lon += this.autoRotateSpeed; this._applyView(); }
      if (!this.needsRender && !xr) return;
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      if (!xr) this._syncHotspots();
    }

    resize() {
      const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
      if (!w || !h || (this.renderer.xr && this.renderer.xr.isPresenting)) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this._rect = null; this.invalidate();
    }

    // ── entrada: un solo camino para ratón, táctil y lápiz ────────────────
    _bindInput() {
      const c = this.canvas;
      c.style.touchAction = 'none';
      this._h = {
        down: e => this._onDown(e), move: e => this._onMove(e), up: e => this._onUp(e),
        wheel: e => { e.preventDefault(); this.zoomBy(e.deltaY * 0.05); }
      };
      c.addEventListener('pointerdown', this._h.down);
      c.addEventListener('pointermove', this._h.move);
      c.addEventListener('pointerup', this._h.up);
      c.addEventListener('pointercancel', this._h.up);
      c.addEventListener('wheel', this._h.wheel, { passive: false });
    }
    _onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.o.interceptPointerDown && this.o.interceptPointerDown(e)) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stopInertia(); this._vel.lon = 0; this._vel.lat = 0;
      if (this._ptrs.size === 2) {
        this.isDragging = false;
        this._pinch = { d: this._pinchDist(), fov: this._fov };
      } else if (this._ptrs.size === 1) {
        this._pinch = null; this.isDragging = true;
        this._last = { x: e.clientX, y: e.clientY, t: performance.now() };
        if (this.o.onDragStart) this.o.onDragStart();
      }
    }
    _onMove(e) {
      if (!this._ptrs.has(e.pointerId)) return;
      const mk = this._marker;      // si el gesto sobre un marcador se alejó, ya es arrastre aunque vuelva
      if (mk && mk.id === e.pointerId && !mk.moved && Math.hypot(e.clientX - mk.x, e.clientY - mk.y) > MARKER_SLOP) mk.moved = true;
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 2 && this._pinch) {
        this.fov = this._pinch.fov * (this._pinch.d / Math.max(1, this._pinchDist()));
        return;
      }
      if (!this.isDragging || !this._last) return;
      const now = performance.now(), K = this.dragK();
      const dlon = -(e.clientX - this._last.x) * K, dlat = (e.clientY - this._last.y) * K;
      this._lon += dlon; this.lat = this._lat + dlat;           // lat aplica límites y redibuja
      const cap = Math.min(Math.max(1, now - this._last.t), 32);
      this._vel.lon = Math.max(-4, Math.min(4, this._vel.lon * 0.5 + dlon * (16 / cap) * 0.5));
      this._vel.lat = Math.max(-2, Math.min(2, this._vel.lat * 0.5 + dlat * (16 / cap) * 0.5));
      this._last = { x: e.clientX, y: e.clientY, t: now };
    }
    _onUp(e) {
      if (!this._ptrs.has(e.pointerId)) return;
      this._ptrs.delete(e.pointerId);
      // Toque sobre un marcador: se activa solo si el puntero casi no se movió.
      const mk = this._marker;
      if (mk && mk.id === e.pointerId) {
        this._marker = null;
        if (!mk.moved && Math.hypot(e.clientX - mk.x, e.clientY - mk.y) <= MARKER_SLOP) {
          this._vel.lon = 0; this._vel.lat = 0;
          if (this._ptrs.size === 0) { this.isDragging = false; this._pinch = null; if (this.o.onDragEnd) this.o.onDragEnd(); }
          mk.fn({ pointerType: e.pointerType || 'mouse', el: mk.el });
          return;
        }
      }
      if (this._ptrs.size === 0) {
        const was = this.isDragging;
        this.isDragging = false; this._pinch = null;
        if (was) { this.startInertia(); if (this.o.onDragEnd) this.o.onDragEnd(); }
      } else if (this._ptrs.size === 1) {
        const [p] = this._ptrs.values();
        this._pinch = null; this.isDragging = true;
        this._last = { x: p.x, y: p.y, t: performance.now() };
      }
    }
    _pinchDist() {
      const [a, b] = [...this._ptrs.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    stopInertia() { cancelAnimationFrame(this._inertiaRaf); this._inertiaRaf = null; }
    startInertia() {
      this.stopInertia();
      const tick = () => {
        this._vel.lon *= 0.88; this._vel.lat *= 0.88;
        if (Math.abs(this._vel.lon) < 0.008 && Math.abs(this._vel.lat) < 0.008) return;
        this._lon += this._vel.lon; this.lat = this._lat + this._vel.lat;
        this._inertiaRaf = requestAnimationFrame(tick);
      };
      this._inertiaRaf = requestAnimationFrame(tick);
    }

    /**
     * Conecta un marcador (hotspot) con el motor. Arrastrar empezando sobre el
     * marcador gira la vista como en cualquier otro punto y NO lo activa; solo
     * un toque o clic sin desplazamiento (≤ 6 px) llama a fn. Enter y Espacio
     * también lo activan (fn recibe { pointerType: 'keyboard' }).
     */
    bindMarker(el, fn) {
      el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest && e.target.closest('[data-marker-ignore]')) return;   // p. ej. la tarjeta abierta
        e.preventDefault(); e.stopPropagation();
        this._marker = { el, fn, x: e.clientX, y: e.clientY, id: e.pointerId };
        this._onDown(e);
      });
      // Si el navegador no pudo capturar el puntero en el lienzo, el final llega aquí.
      el.addEventListener('pointerup', e => this._onUp(e));
      el.addEventListener('pointercancel', e => { this._marker = null; this._onUp(e); });
      el.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('[data-marker-ignore]')) return;
        e.preventDefault(); e.stopPropagation(); if (e.detail === 0) fn({ pointerType: 'keyboard', el });
      });
      if (el.tagName !== 'BUTTON' && el.tagName !== 'A') {
        if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
        el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn({ pointerType: 'keyboard', el }); } });
      }
      return el;
    }

    // Punto de la esfera bajo un clic, en porcentaje (x: 0-100 horizontal, y: 0-100 vertical).
    pick(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
      v.unproject(this.camera).sub(this.camera.position);
      const p = vec3ToPct(v);
      return { x: Math.max(1, Math.min(99, Math.round(p.x))), y: Math.max(1, Math.min(99, Math.round(p.y))) };
    }
    // Orientación (lon/lat) que mira hacia un punto en porcentaje.
    headingTo(x, y) { return { lon: (x / 100) * 360 - 180, lat: 90 - (y / 100) * 180 }; }

    // ── texturas ──────────────────────────────────────────────────────────
    textureLimit() {
      const mobile = typeof this.o.isMobile === 'function' ? this.o.isMobile() : this.o.isMobile;
      return mobile ? Math.min(this.maxTexture, MOBILE_TEX_CAP) : this.maxTexture;
    }
    /** Filtros + reducción si la imagen supera lo que este dispositivo puede dibujar. */
    prepTexture(tex) {
      if (!tex) return tex;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      try { tex.anisotropy = this.maxAniso; } catch (_) {}
      const img = tex.image;
      const w = img && (img.naturalWidth || img.width || img.videoWidth) || 0;
      const h = img && (img.naturalHeight || img.height || img.videoHeight) || 0;
      const limit = this.textureLimit();
      if (w > limit && h > 0 && !(root.HTMLVideoElement && img instanceof root.HTMLVideoElement)) {
        try {
          const nw = limit, nh = Math.max(1, Math.round(h * (limit / w)));
          const cv = document.createElement('canvas'); cv.width = nw; cv.height = nh;
          const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, nw, nh);
          tex.userData = Object.assign({}, tex.userData, { sourceUrl: img.currentSrc || img.src || null, sourceWidth: w });
          tex.image = cv; tex.needsUpdate = true;
          if (this.o.onTextureCapped) this.o.onTextureCapped({ from: w, to: nw });
        } catch (err) { console.warn('[AgelPano] No se pudo ajustar la panorámica:', err); }
      }
      return tex;
    }
    /** Carga una imagen como textura (CORS anónimo) ya preparada. */
    loadTexture(url) {
      return new Promise((resolve, reject) => {
        const l = new THREE.TextureLoader(); l.crossOrigin = 'anonymous';
        l.load(url, t => resolve(this.prepTexture(t)), undefined, err => reject(err || new Error('No se pudo cargar ' + url)));
      });
    }

    /** Muestra una textura; con fundido salvo `instant` o si no había imagen. null = esfera vacía. */
    setPano(tex, instant) {
      const swap = () => {
        const old = this.sphere.material;
        this.sphere.material = new THREE.MeshBasicMaterial(tex ? { map: tex } : { color: 0x080810 });
        if (old && old.dispose) old.dispose();
        this.fadeSphere.visible = false;
        this.invalidate();
      };
      cancelAnimationFrame(this._xfRaf); this._xfRaf = null;
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (instant || reduce || !this.sphere.material.map || !tex) { swap(); return; }
      const oldFade = this.fadeSphere.material;
      this.fadeSphere.material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      if (oldFade && oldFade.dispose) oldFade.dispose();
      this.fadeSphere.visible = true;
      const t0 = performance.now(), dur = 520;
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        this.fadeSphere.material.opacity = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.invalidate();
        if (t < 1) this._xfRaf = requestAnimationFrame(step); else { this._xfRaf = null; swap(); }
      };
      this._xfRaf = requestAnimationFrame(step);
    }
    currentTexture() { return this.sphere.material && this.sphere.material.map || null; }
    texturesInUse() { return [this.sphere.material && this.sphere.material.map, this.fadeSphere.material && this.fadeSphere.material.map].filter(Boolean); }

    // ── hotspots ──────────────────────────────────────────────────────────
    /** items: [{ el, x, y }] en porcentaje. El motor solo los posiciona (CSS --hx/--hy). */
    setHotspots(items) {
      this.hotspots = (items || []).map(it => ({ el: it.el, vec3: pctToVec3(it.x, it.y), vis: null }));
      this._rect = null; this.invalidate(); this._syncHotspots();
    }
    clearHotspots() { this.hotspots = []; }
    _syncHotspots() {
      if (!this.hotspots.length) return;
      if (!this._rect) { const r = this.canvas.getBoundingClientRect(); this._rect = { w: r.width, h: r.height }; }
      for (const it of this.hotspots) {
        this._tmp.copy(it.vec3).project(this.camera);
        if (this._tmp.z > 1) {
          // Detrás de la cámara: invisible, sin clic y fuera del orden de tabulación.
          if (it.vis !== false) { it.el.style.opacity = '0'; it.el.style.pointerEvents = 'none'; it.el.inert = true; it.vis = false; }
          continue;
        }
        if (it.vis !== true) { it.el.style.opacity = '1'; it.el.style.pointerEvents = 'all'; it.el.inert = false; it.vis = true; }
        it.el.style.setProperty('--hx', ((this._tmp.x + 1) / 2 * this._rect.w) + 'px');
        it.el.style.setProperty('--hy', ((-this._tmp.y + 1) / 2 * this._rect.h) + 'px');
      }
    }

    // ── VR (WebXR) — fase 7 ───────────────────────────────────────────────
    async xrSupported() {
      try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (_) { return false; }
    }
    async enterVR() {
      if (!(await this.xrSupported())) throw new Error('Este dispositivo o navegador no ofrece realidad virtual (WebXR).');
      this.renderer.xr.enabled = true;
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      await this.renderer.xr.setSession(session);
      session.addEventListener('end', () => { this.renderer.xr.enabled = false; this.resize(); this.invalidate(); });
      return session;
    }

    dispose() {
      this._disposed = true;
      this.renderer.setAnimationLoop(null);
      this.stopInertia(); cancelAnimationFrame(this._xfRaf); cancelAnimationFrame(this._fovRaf);
      const c = this.canvas;
      c.removeEventListener('pointerdown', this._h.down); c.removeEventListener('pointermove', this._h.move);
      c.removeEventListener('pointerup', this._h.up); c.removeEventListener('pointercancel', this._h.up);
      c.removeEventListener('wheel', this._h.wheel);
      this._ro.disconnect(); root.removeEventListener('resize', this._onWinResize);
      [this.sphere, this.fadeSphere].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      this.renderer.dispose();
    }
  }

  root.AgelPano = { PanoEngine, pctToVec3, vec3ToPct, RADIUS };
})(typeof window !== 'undefined' ? window : globalThis);
