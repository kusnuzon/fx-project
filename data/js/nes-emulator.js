// data/js/nes-emulator.js
// NES Emulator Core – Nostalgist.js + Virtual Gamepad + Orientation + Audio

class NESEmulator {
  constructor() {
    this.nostalgist = null;
    this.loaded = false;
    this.canvas = null;

    // Elemen UI
    this.dropZone = document.getElementById('dropZone');
    this.controlsDiv = document.getElementById('controls');
    this.emuWrapper = document.getElementById('emuWrapper');
    this.virtualGamepad = document.getElementById('virtualGamepad');
    this.statusText = document.getElementById('statusText');

    // Bind keyboard dan gamepad
    this._bindDropZone();
    this._bindVirtualGamepad();
    this._bindKeyboard();
    this._bindOrientationChange();
  }

  /* --- Drop Zone --- */
  _bindDropZone() {
    this.dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });
    this.dropZone.addEventListener('drop', async e => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });
    this.dropZone.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.nes,.zip';
      inp.onchange = e => { if (e.target.files[0]) this.handleFile(e.target.files[0]); };
      inp.click();
    });
  }

  async handleFile(file) {
    this.statusText.textContent = 'Processing...';
    try {
      const buf = await file.arrayBuffer();
      let data, name;
      if (file.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(buf);
        const nesFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.nes'));
        if (!nesFile) throw new Error('No .nes inside ZIP');
        data = await zip.files[nesFile].async('uint8array');
        name = nesFile;
      } else {
        data = new Uint8Array(buf);
        name = file.name;
      }
      await this.loadROM(data, name);
    } catch (err) {
      this.statusText.textContent = 'Error: ' + err.message;
    }
  }

  /* --- Load ROM --- */
  async loadROM(romData, fileName) {
    this.stop();
    this.statusText.textContent = 'Loading emulator...';
    try {
      // Hancurkan instance lama
      if (this.nostalgist) await this.nostalgist.exit();

      const blob = new Blob([romData], { type: 'application/octet-stream' });
      const file = new File([blob], fileName || 'game.nes');

      this.nostalgist = await Nostalgist.nes(file, {
            // Aktifkan audio dengan sample rate default
            emulateAudio: true,
            sampleRate: 44100
          });

      this.canvas = this.nostalgist.getCanvas();
      this.canvas.classList.add('nes-emulator-canvas');

      // Masukkan canvas ke wrapper
      this.emuWrapper.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'emu-container';
      container.appendChild(this.canvas);
      this.emuWrapper.appendChild(container);

      // Tampilkan kontrol dan gamepad
      this.controlsDiv.style.display = 'flex';
      this.virtualGamepad.style.display = 'flex';
      this.loaded = true;
      this.statusText.textContent = 'ROM loaded • Audio ON';
      this._applyOrientation();
    } catch (e) {
      this.statusText.textContent = 'Error: ' + e.message;
    }
  }

  /* --- Virtual Gamepad Binding --- */
  _bindVirtualGamepad() {
    const buttons = this.virtualGamepad.querySelectorAll('.gamepad-btn');
    buttons.forEach(btn => {
      const dataBtn = btn.dataset.btn;
      if (!dataBtn) return;

      const press = (e) => {
        e.preventDefault();
        btn.classList.add('active');
        this._sendKey(dataBtn, 'keydown');
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        this._sendKey(dataBtn, 'keyup');
      };

      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
    });
  }

  _sendKey(btn, type) {
    if (!this.nostalgist || !this.canvas) return;
    const key = this._btnToKey(btn);
    if (key) {
      this.canvas.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    }
  }

  _btnToKey(btn) {
    const map = {
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      a: 'x', b: 'z', start: 'Enter', select: 'Shift'
    };
    return map[btn] || '';
  }

  /* --- Keyboard fisik --- */
  _bindKeyboard() {
    const keyHandler = (e) => {
      if (!this.loaded) return;
      const btn = this._keyToBtn(e.key);
      if (btn) {
        e.preventDefault();
        this._highlightButton(btn, e.type === 'keydown');
      }
    };
    window.addEventListener('keydown', keyHandler);
    window.addEventListener('keyup', keyHandler);
  }

  _keyToBtn(key) {
    const map = {
      'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
      'x': 'a', 'z': 'b', 'Enter': 'start', 'Shift': 'select'
    };
    return map[key] || null;
  }

  _highlightButton(btn, active) {
    const el = this.virtualGamepad.querySelector(`[data-btn="${btn}"]`);
    if (el) el.classList.toggle('active', active);
  }

  /* --- Orientasi --- */
  _bindOrientationChange() {
    window.addEventListener('resize', () => this._applyOrientation());
    // Cek orientasi awal setelah ROM dimuat
    const observer = new MutationObserver(() => {
      if (this.loaded) this._applyOrientation();
    });
    observer.observe(this.emuWrapper, { childList: true });
  }

  _applyOrientation() {
    const container = document.querySelector('.emu-container');
    if (!container) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    container.classList.toggle('emu-portrait', isPortrait);
    container.classList.toggle('emu-landscape', !isPortrait);
  }

  /* --- Kontrol --- */
  stop() {
    if (this.nostalgist) {
      this.nostalgist.exit();
      this.nostalgist = null;
    }
    this.emuWrapper.innerHTML = '';
    this.controlsDiv.style.display = 'none';
    this.virtualGamepad.style.display = 'none';
    this.statusText.textContent = 'Emulator stopped.';
    this.loaded = false;
  }

  reset() {
    if (this.nostalgist) {
      this.nostalgist.restart();
      this.statusText.textContent = 'Reset.';
    }
  }

  toggleFullscreen() {
    const wrapper = document.getElementById('emuWrapper');
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }
}

// Inisialisasi setelah halaman siap
window.addEventListener('DOMContentLoaded', () => {
  window.nesEmulator = new NESEmulator();
});
