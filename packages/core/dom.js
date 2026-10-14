/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · utilidades de interfaz (compartidas)
   h(): crea elementos sin innerHTML — el texto siempre entra como texto,
   así un nombre de proyecto o de cliente nunca se interpreta como HTML.
   modal(): diálogo accesible (rol, foco, Escape) con el estilo de la app.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'multiple') el[k] = !!v;
      else if (k === 'html') throw new Error('h(): innerHTML no permitido');
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === true) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const icon = name => h('i', { class: `ti ti-${name}`, 'aria-hidden': 'true' });

  let _openModals = 0;
  function modal({ title, body, actions = [], onClose, wide = false, dismissable = true, label }) {
    const prevFocus = document.activeElement;
    const titleId = 'm' + Math.random().toString(36).slice(2, 8);
    const closeBtn = dismissable ? h('button', { class: 'ag-modal-x', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('x')) : null;
    const foot = h('div', { class: 'ag-modal-actions' });
    const box = h('div', { class: 'ag-modal-box' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true',
                           'aria-labelledby': title ? titleId : null, 'aria-label': title ? null : (label || 'Diálogo') },
      closeBtn,
      title ? h('h2', { class: 'ag-modal-title', id: titleId }, title) : null,
      h('div', { class: 'ag-modal-body' }, body),
      foot);
    const wrap = h('div', { class: 'ag-modal', onmousedown: e => { if (e.target === wrap && dismissable) close(); } }, box);
    const api = { el: box, close, setActions, setBusy };
    function setActions(list) {
      foot.replaceChildren(...list.map(a => h('button', {
        type: 'button', class: 'ag-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        disabled: a.disabled, onclick: () => a.onClick && a.onClick(api)
      }, a.icon ? icon(a.icon) : null, a.label)));
    }
    function setBusy(on, text) {
      foot.querySelectorAll('button').forEach(b => { b.disabled = !!on; });
      if (on && text) { const p = foot.querySelector('.primary'); if (p) p.textContent = text; }
    }
    function onKey(e) {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {                       // foco atrapado dentro del diálogo
        const f = [...box.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    let closed = false;
    function close(result) {
      if (closed) return; closed = true;
      wrap.remove(); document.removeEventListener('keydown', onKey, true);
      _openModals--;
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_) {}
      if (onClose) onClose(result);
    }
    setActions(actions);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    _openModals++;
    setTimeout(() => { const f = box.querySelector('input,select,textarea,button.primary,button'); if (f) f.focus(); }, 30);
    return api;
  }

  function field(labelText, control, hint) {
    const id = control.id || ('f' + Math.random().toString(36).slice(2, 8));
    control.id = id;
    return h('div', { class: 'ag-field' },
      h('label', { for: id }, labelText), control, hint ? h('div', { class: 'ag-hint' }, hint) : null);
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function formatDate(d, withTime) {
    if (!d) return '—';
    const x = new Date(d);
    return x.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
      (withTime ? ' ' + x.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '');
  }

  // Aviso breve. Reutiliza el #toast de la app si existe.
  let _t = null;
  function notify(msg, kind) {
    let el = document.getElementById('toast') || document.getElementById('ag-toast');
    if (!el) { el = h('div', { id: 'ag-toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('error', kind === 'error');
    el.classList.add('show');
    clearTimeout(_t); _t = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2800);
  }

  root.AgelDOM = { h, append, icon, modal, field, formatBytes, formatDate, notify,
                   get modalOpen() { return _openModals > 0; } };
})(window);
