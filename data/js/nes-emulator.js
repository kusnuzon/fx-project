// data/js/nes-emulator.js
// MENGGUNAKAN EMULATORJS – STABIL & TERUJI

(function() {
  const NES_GROUPS = {
    dpad: true,
    abxy: { buttons: ['x','a','b','y'], order: ['x','a','b','y'] },
    startselect: { buttons: ['start','select'] },
    l1l2: { buttons: ['l1','l2'] },
    r1r2: { buttons: ['r1','r2'] }
  };

  const BTN_TO_KEY = {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    a: 'x', b: 'z', x: 'a', y: 's',
    start: 'Enter', select: 'Shift',
    l1: 'q', l2: 'w', r1: 'e', r2: 'r'
  };

  class NESEmulator {
    constructor() {
      this.emulator = null;
      this.loaded = false;
      this.gamepad = null;

      this.dropZone = document.getElementById('dropZone');
      this.subtitle = document.querySelector('.subtitle');
      this.controlsDiv = document.getElementById('controls');
      this.gameDiv = document.getElementById('game');
      this.emuContainer = document.querySelector('.emu-container');
      this.virtualGamepad = document.getElementById('virtualGamepad');
      this.statusText = document.getElementById('statusText');

      document.getElementById('btnStop').onclick = () => this.stop();
      document.getElementById('btnReset').onclick = () => this.reset();
      document.getElementById('btnFullscreen').onclick = () => this.toggleFullscreen();

      this._bindDropZone();
      this._bindKeyboard();
      this._bindOrientationChange();
    }

    _bindDropZone() {
      this.dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
      });
      this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
      this.dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this._loadFile(file);
      });
      this.dropZone.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.nes,.zip,.rar,.7z';
        inp.onchange = e => { if (e.target.files[0]) this._loadFile(e.target.files[0]); };
        inp.click();
      });
    }

    async _loadFile(file) {
      this.statusText.textContent = 'Loading ROM...';
      try {
        // Buat Blob URL untuk EmulatorJS
        const buffer = await file.arrayBuffer();
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        // Hentikan game sebelumnya
        if (this.emulator) {
          try { this.emulator.exit(); } catch (_) {}
          this.emulator = null;
        }

        // Reset tampilan
        this.gameDiv.innerHTML = '';
        this.gameDiv.style.display = 'block';
        this.dropZone.style.display = 'none';
        if (this.subtitle) this.subtitle.style.display = 'none';

        // Luncurkan EmulatorJS
        this.emulator = new EmulatorJS(this.gameDiv, {
          system: 'nes',
          rom: url,
          // Tidak perlu mengatur canvas, EmulatorJS membuatnya sendiri
        });

        // Tunggu emulator siap
        await this.emulator.ready;

        // Tampilkan kontrol dan gamepad
        this.controlsDiv.style.display = 'flex';
        this._setupVirtualGamepad();
        this.virtualGamepad.style.display = 'flex';
        this.loaded = true;
        this.statusText.textContent = '🎮 ROM loaded • 🔊 Audio ON';

        this._applyOrientation();

        // Bersihkan Blob URL saat halaman ditutup
        window.addEventListener('beforeunload', () => URL.revokeObjectURL(url), { once: true });
      } catch (err) {
        this.statusText.textContent = 'Error: ' + err.message;
        console.error(err);
      }
    }

    _setupVirtualGamepad() {
      if (this.gamepad) this.gamepad.destroy();
      this.gamepad = new VirtualGamepad({
        container: this.virtualGamepad,
        groups: NES_GROUPS,
        onButton: ({ button, pressed }) => this._pressButton(button, pressed)
      });
      // Pindahkan gamepad ke dalam emu-container (jika belum)
      if (this.virtualGamepad.parentNode !== this.emuContainer) {
        this.emuContainer.appendChild(this.virtualGamepad);
      }
    }

    _pressButton(btn, pressed) {
      if (!this.loaded) return;
      const key = BTN_TO_KEY[btn];
      if (key) {
        const eventType = pressed ? 'keydown' : 'keyup';
        window.dispatchEvent(new KeyboardEvent(eventType, {
          key: key,
          code: key,
          keyCode: this._keyCode(key),
          which: this._keyCode(key),
          bubbles: true,
          cancelable: true
        }));
      }
    }

    _keyCode(key) {
      const map = {
        'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
        'x': 88, 'z': 90, 'a': 65, 's': 83,
        'Enter': 13, 'Shift': 16, 'q': 81, 'w': 87, 'e': 69, 'r': 82
      };
      return map[key] || 0;
    }

    _bindKeyboard() {
      window.addEventListener('keydown', e => {
        if (!this.loaded) return;
        const btn = Object.keys(BTN_TO_KEY).find(k => BTN_TO_KEY[k] === e.key);
        if (btn) this.gamepad?.highlight(btn, true);
      });
      window.addEventListener('keyup', e => {
        if (!this.loaded) return;
        const btn = Object.keys(BTN_TO_KEY).find(k => BTN_TO_KEY[k] === e.key);
        if (btn) this.gamepad?.highlight(btn, false);
      });
    }

    _bindOrientationChange() {
      const fn = () => this._applyOrientation();
      window.addEventListener('resize', fn);
      window.addEventListener('orientationchange', () => setTimeout(fn, 150));
    }

    _applyOrientation() {
      if (!this.emuContainer) return;
      const isPortrait = window.innerHeight > window.innerWidth;
      this.emuContainer.classList.toggle('portrait-layout', isPortrait);
      this.emuContainer.classList.toggle('landscape-layout', !isPortrait);
    }

    stop() {
      if (this.emulator) {
        try { this.emulator.exit(); } catch (_) {}
        this.emulator = null;
      }
      this.gameDiv.innerHTML = '';
      this.gameDiv.style.display = 'none';
      this.controlsDiv.style.display = 'none';
      this.virtualGamepad.style.display = 'none';
      this.dropZone.style.display = '';
      if (this.subtitle) this.subtitle.style.display = '';
      this.statusText.textContent = 'Emulator stopped.';
      this.loaded = false;
      if (this.gamepad) {
        this.gamepad.destroy();
        this.gamepad = null;
      }
    }

    reset() {
      if (this.emulator) {
        try { this.emulator.restart(); } catch (_) {}
        this.statusText.textContent = '🔄 Reset.';
      }
    }

    toggleFullscreen() {
      const wrapper = document.getElementById('emuWrapper');
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (wrapper.requestFullscreen || wrapper.webkitRequestFullscreen)?.call(wrapper);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      }
      setTimeout(() => this._applyOrientation(), 300);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.nesEmulator = new NESEmulator();
  });
})();
