// data/js/virtual-gamepad.js
// MODULAR VIRTUAL GAMEPAD – reusable for any emulator
// Groups: D-Pad, ABXY, Start/Select, L1/L2, R1/R2
// Each group is a single unit that cannot be split.

class VirtualGamepad {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - DOM element tempat gamepad ditambahkan
   * @param {Object} options.groups - Grup tombol yang akan dirender
   * @param {Object} options.layout - Posisi grup dalam persen
   * @param {Function} options.onButton - Callback saat tombol ditekan/lepas
   */
  constructor({ container, groups = {}, layout = {}, onButton = null }) {
    if (!container) throw new Error('VirtualGamepad: container is required');

    this.container = container;
    this.groups = groups;        // Grup yang aktif, dikirim dari emulator
    this.layout = layout;        // Posisi grup dari localStorage
    this.onButton = onButton;
    this.buttons = new Map();    // Map<btnName, HTMLElement>

    this._build();
  }

  /* ── BUILD GAMEPAD ────────────────── */
  _build() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.touchAction = 'none';
    this.container.style.userSelect = 'none';

    // D-Pad (up, down, left, right)
    if (this.groups.dpad) {
      const dpad = document.createElement('div');
      dpad.className = 'vgp-group vgp-dpad';
      ['up','left','right','down'].forEach(dir => {
        const btn = this._createButton(dir, dir === 'up' ? '▲' : dir === 'left' ? '◀' : dir === 'right' ? '▶' : '▼');
        dpad.appendChild(btn);
      });
      this._positionGroup(dpad, 'dpad');
      this.container.appendChild(dpad);
    }

    // ABXY buttons (A, B, X, Y) – render sesuai yang diminta
    if (this.groups.abxy) {
      const abxy = document.createElement('div');
      abxy.className = 'vgp-group vgp-abxy';
      // Urutan render: X, A, B, Y (bisa dikustom)
      const order = this.groups.abxy.order || ['x','a','b','y'];
      order.forEach(name => {
        if (this.groups.abxy.buttons.includes(name)) {
          const label = name === 'a' ? 'A' : name === 'b' ? 'B' : name === 'x' ? 'X' : 'Y';
          const btn = this._createButton(name, label, 'vgp-btn-round');
          abxy.appendChild(btn);
        }
      });
      this._positionGroup(abxy, 'abxy');
      this.container.appendChild(abxy);
    }

    // Start/Select
    if (this.groups.startselect) {
      const ss = document.createElement('div');
      ss.className = 'vgp-group vgp-startselect';
      ['start','select'].forEach(name => {
        if (this.groups.startselect.buttons.includes(name)) {
          const label = name === 'start' ? 'START' : 'SELECT';
          const btn = this._createButton(name, label, 'vgp-btn-pill');
          ss.appendChild(btn);
        }
      });
      this._positionGroup(ss, 'startselect');
      this.container.appendChild(ss);
    }

    // L1 / L2
    if (this.groups.l1l2) {
      const l = document.createElement('div');
      l.className = 'vgp-group vgp-l1l2';
      ['l1','l2'].forEach(name => {
        if (this.groups.l1l2.buttons.includes(name)) {
          const btn = this._createButton(name, name.toUpperCase(), 'vgp-btn-pill');
          l.appendChild(btn);
        }
      });
      this._positionGroup(l, 'l1l2');
      this.container.appendChild(l);
    }

    // R1 / R2
    if (this.groups.r1r2) {
      const r = document.createElement('div');
      r.className = 'vgp-group vgp-r1r2';
      ['r1','r2'].forEach(name => {
        if (this.groups.r1r2.buttons.includes(name)) {
          const btn = this._createButton(name, name.toUpperCase(), 'vgp-btn-pill');
          r.appendChild(btn);
        }
      });
      this._positionGroup(r, 'r1r2');
      this.container.appendChild(r);
    }
  }

  /* ── CREATE SINGLE BUTTON ─────────── */
  _createButton(name, label, extraClass = '') {
    const btn = document.createElement('div');
    btn.className = `vgp-btn ${extraClass}`;
    btn.dataset.btn = name;
    btn.textContent = label;

    const press = (e) => {
      e.preventDefault();
      btn.classList.add('active');
      if (this.onButton) this.onButton({ button: name, pressed: true });
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (this.onButton) this.onButton({ button: name, pressed: false });
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release);

    this.buttons.set(name, btn);
    return btn;
  }

  /* ── POSITION GROUP ───────────────── */
  _positionGroup(groupEl, groupName) {
    const pos = this.layout?.[groupName];
    if (pos) {
      groupEl.style.position = 'absolute';
      groupEl.style.left = pos.x + '%';
      groupEl.style.top = pos.y + '%';
      groupEl.style.transform = 'translate(-50%, -50%)';
    }
  }

  /* ── UPDATE LAYOUT ────────────────── */
  updateLayout(layout) {
    this.layout = layout;
    ['dpad','abxy','startselect','l1l2','r1r2'].forEach(name => {
      const group = this.container.querySelector(`.vgp-${name}`);
      const pos = layout?.[name];
      if (group && pos) {
        group.style.left = pos.x + '%';
        group.style.top = pos.y + '%';
      }
    });
  }

  /* ── HIGHLIGHT BUTTON (keyboard) ──── */
  highlight(buttonName, active) {
    const btn = this.buttons.get(buttonName);
    if (btn) btn.classList.toggle('active', active);
  }

  /* ── DESTROY ──────────────────────── */
  destroy() {
    this.container.innerHTML = '';
    this.buttons.clear();
  }
}

// Export jika menggunakan modules (optional, fallback ke window)
if (typeof window !== 'undefined') window.VirtualGamepad = VirtualGamepad;
