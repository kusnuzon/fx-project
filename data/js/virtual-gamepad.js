// data/js/virtual-gamepad.js
// MODULAR VIRTUAL GAMEPAD

class VirtualGamepad {
  constructor({ container, groups = {}, onButton = null }) {
    if (!container) throw new Error('VirtualGamepad: container diperlukan');
    this.container = container;
    this.groups = groups;
    this.onButton = onButton;
    this.buttons = new Map();
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('virtual-gamepad');
    const wrapper = document.createElement('div');
    wrapper.className = 'gamepad-container';

    if (this.groups.dpad) {
      const dpad = document.createElement('div');
      dpad.className = 'vgp-group vgp-dpad';
      ['up','left','right','down'].forEach(dir => {
        const icon = dir === 'up' ? '▲' : dir === 'left' ? '◀' : dir === 'right' ? '▶' : '▼';
        dpad.appendChild(this._createButton(dir, icon));
      });
      wrapper.appendChild(dpad);
    }

    if (this.groups.abxy) {
      const abxy = document.createElement('div');
      abxy.className = 'vgp-group vgp-abxy';
      const order = this.groups.abxy.order || ['x','a','b','y'];
      order.forEach(name => {
        if (this.groups.abxy.buttons.includes(name)) {
          abxy.appendChild(this._createButton(name, name.toUpperCase(), 'vgp-btn-round'));
        }
      });
      wrapper.appendChild(abxy);
    }

    if (this.groups.startselect) {
      const ss = document.createElement('div');
      ss.className = 'vgp-group vgp-startselect';
      ['start','select'].forEach(name => {
        if (this.groups.startselect.buttons.includes(name)) {
          ss.appendChild(this._createButton(name, name === 'start' ? 'START' : 'SELECT', 'vgp-btn-pill'));
        }
      });
      wrapper.appendChild(ss);
    }

    if (this.groups.l1l2) {
      const l = document.createElement('div');
      l.className = 'vgp-group vgp-shoulder';
      ['l1','l2'].forEach(name => {
        if (this.groups.l1l2.buttons.includes(name)) {
          l.appendChild(this._createButton(name, name.toUpperCase(), 'vgp-btn-pill vgp-shoulder-btn'));
        }
      });
      wrapper.appendChild(l);
    }

    if (this.groups.r1r2) {
      const r = document.createElement('div');
      r.className = 'vgp-group vgp-shoulder';
      ['r1','r2'].forEach(name => {
        if (this.groups.r1r2.buttons.includes(name)) {
          r.appendChild(this._createButton(name, name.toUpperCase(), 'vgp-btn-pill vgp-shoulder-btn'));
        }
      });
      wrapper.appendChild(r);
    }

    this.container.appendChild(wrapper);
  }

  _createButton(name, label, extraClass = '') {
    const btn = document.createElement('div');
    btn.className = `vgp-btn ${extraClass}`;
    btn.dataset.btn = name;
    btn.textContent = label;

    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('active');
      if (this.onButton) this.onButton({ button: name, pressed: true });
    };
    const release = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('active');
      if (this.onButton) this.onButton({ button: name, pressed: false });
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release);

    this.buttons.set(name, btn);
    return btn;
  }

  highlight(btnName, active) {
    const btn = this.buttons.get(btnName);
    if (btn) btn.classList.toggle('active', active);
  }

  destroy() {
    this.container.innerHTML = '';
    this.buttons.clear();
  }
}

if (typeof window !== 'undefined') window.VirtualGamepad = VirtualGamepad;
