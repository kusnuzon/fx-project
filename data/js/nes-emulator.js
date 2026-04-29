// data/js/nes-emulator.js
// NES Emulator Core – Nostalgist.js + Virtual Gamepad + Orientation + Audio

class NESEmulator {
  constructor() {
    this.nostalgist = null;
    this.loaded = false;
    this.canvas = null;
    this._gamepadInContainer = false; // track posisi gamepad

    // Elemen UI
    this.dropZone     = document.getElementById('dropZone');
    this.controlsDiv  = document.getElementById('controls');
    this.emuWrapper   = document.getElementById('emuWrapper');
    this.virtualGamepad = document.getElementById('virtualGamepad');
    this.statusText   = document.getElementById('statusText');

    // Simpan parent asal gamepad agar bisa dikembalikan saat stop()
    this._gamepadOriginalParent  = this.virtualGamepad.parentNode;
    this._gamepadOriginalSibling = this.virtualGamepad.nextSibling;

    this._bindDropZone();
    this._bindVirtualGamepad();
    this._bindKeyboard();
    this._bindOrientationChange();

    // ✅ FIX #1 – Unlock AudioContext sedini mungkin saat ada sentuhan pertama
    //    iOS Safari & Chrome mobile memblokir AudioContext hingga ada user gesture.
    //    Listener ini memastikan audio bisa langsung jalan saat ROM diload.
    this._setupAudioUnlock();
  }

  /* ── Audio Unlock ─────────────────────────────────────────────────────── */

  _setupAudioUnlock() {
    // Pasang listener sekali pada interaksi pertama apapun
    const unlock = async () => {
      await this._unlockAudio();
    };
    document.addEventListener('pointerdown', unlock, { once: true, passive: true });
    document.addEventListener('touchstart',  unlock, { once: true, passive: true });
  }

  async _unlockAudio() {
    // Membuat AudioContext sementara lalu resume-nya membuka "audio gate"
    // di browser sehingga AudioContext internal Nostalgist pun ikut terbuka.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      if (ctx.state === 'running') { ctx.close(); return; }
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      await ctx.resume();
      setTimeout(() => ctx.close(), 500);
    } catch (_) { /* ignore */ }
  }

  /* ── Drop Zone ────────────────────────────────────────────────────────── */

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
      await this._unlockAudio(); // drop = user gesture → unlock audio sekarang
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });
    this.dropZone.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type   = 'file';
      inp.accept = '.nes,.zip';
      inp.onchange = async e => {
        await this._unlockAudio(); // file select = user gesture
        if (e.target.files[0]) this.handleFile(e.target.files[0]);
      };
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
        name  = file.name;
      }
      await this.loadROM(data, name);
    } catch (err) {
      this.statusText.textContent = 'Error: ' + err.message;
      console.error('[NES] handleFile:', err);
    }
  }

  /* ── Load ROM ─────────────────────────────────────────────────────────── */

  async loadROM(romData, fileName) {
    this.stop();
    this.statusText.textContent = 'Loading emulator...';
    try {
      const romFile = new File(
        [new Blob([romData], { type: 'application/octet-stream' })],
        fileName || 'game.nes'
      );

      // ✅ FIX #2 – Gunakan Nostalgist.launch() dengan options yang BENAR.
      //    Nostalgist.nes(file, options) tidak mendukung parameter kedua.
      //    emulateAudio & sampleRate bukan opsi valid → diam-diam diabaikan.
      //    Konfigurasi audio yang benar ada di retroarchConfig.
      this.nostalgist = await Nostalgist.launch({
        core: 'fceumm',          // core libretro NES
        rom:  romFile,
        retroarchConfig: {
          audio_enable:   'true',
          audio_out_rate: '44100',
          audio_latency:  '64',
          video_smooth:   'false',
        },
        // ✅ FIX #3 – respondToGlobalEvents: false agar keyboard global
        //    tidak ditangkap Nostalgist sendiri (kita handle via virtual pad).
        //    Ini mencegah konflik input antara virtual gamepad dan Nostalgist.
        respondToGlobalEvents: false,
      });

      this.canvas = this.nostalgist.getCanvas();
      this.canvas.classList.add('nes-emulator-canvas');

      // Buat container baru
      this.emuWrapper.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'emu-container';
      container.appendChild(this.canvas);

      // ✅ FIX #4 – Pindahkan virtualGamepad KE DALAM container.
      //    Sebelumnya gamepad berada di luar emuWrapper, sehingga CSS rules
      //    ".emu-landscape .virtual-gamepad" tidak pernah berlaku.
      //    Dengan memindahkannya ke dalam container, layout landscape (canvas
      //    + gamepad berdampingan) dan portrait (bertumpuk) bekerja dengan benar.
      container.appendChild(this.virtualGamepad);
      this._gamepadInContainer = true;

      this.emuWrapper.appendChild(container);

      // Tampilkan kontrol dan gamepad
      this.controlsDiv.style.display = 'flex';
      this.virtualGamepad.style.display = 'flex';
      this.loaded = true;
      this.statusText.textContent = '🎮 ROM loaded  •  🔊 Audio ON';
      this._applyOrientation();
    } catch (e) {
      this.statusText.textContent = 'Error: ' + e.message;
      console.error('[NES] loadROM:', e);
    }
  }

  /* ── Virtual Gamepad ──────────────────────────────────────────────────── */

  _bindVirtualGamepad() {
    this.virtualGamepad.querySelectorAll('.gamepad-btn').forEach(btn => {
      const dataBtn = btn.dataset.btn;
      if (!dataBtn) return;

      const press = e => {
        e.preventDefault();
        btn.classList.add('active');
        this._sendButton(dataBtn, true);
      };
      const release = e => {
        e.preventDefault();
        btn.classList.remove('active');
        this._sendButton(dataBtn, false);
      };

      btn.addEventListener('pointerdown',  press);
      btn.addEventListener('pointerup',    release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release); // ← tambahan untuk multi-touch
    });
  }

  // ✅ FIX #5 – Gunakan Nostalgist pressButton/releaseButton API.
  //    Sebelumnya dispatch KeyboardEvent ke canvas – ini tidak reliable karena:
  //    (a) event.isTrusted = false → Emscripten/libretro bisa mengabaikannya,
  //    (b) canvas perlu punya focus, (c) keyCode tidak di-set.
  //    pressButton/releaseButton adalah cara resmi Nostalgist untuk input.
  _sendButton(btn, isPress) {
    if (!this.nostalgist) return;

    const nesBtn = this._btnToNostalgistBtn(btn);
    if (nesBtn) {
      try {
        if (isPress) {
          this.nostalgist.pressButton(nesBtn, 0);    // player 0
        } else {
          this.nostalgist.releaseButton(nesBtn, 0);
        }
        return; // sukses → selesai
      } catch (_) {
        // pressButton tidak tersedia di versi ini → fallback ke keyboard
      }
    }

    // Fallback: dispatch ke WINDOW (bukan canvas) agar sampai ke Nostalgist.
    // Nostalgist listen keyboard events di window/document level.
    const key  = this._btnToKey(btn);
    const type = isPress ? 'keydown' : 'keyup';
    if (key) {
      window.dispatchEvent(new KeyboardEvent(type, {
        key, code: this._keyToCode(key),
        keyCode: this._keyToKeyCode(key),
        bubbles: true, cancelable: true
      }));
    }
  }

  _btnToNostalgistBtn(btn) {
    // Nama button libretro yang didukung Nostalgist
    const map = {
      up: 'up', down: 'down', left: 'left', right: 'right',
      a: 'a', b: 'b', start: 'start', select: 'select'
    };
    return map[btn] || null;
  }

  _btnToKey(btn) {
    const map = {
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      a: 'x', b: 'z', start: 'Enter', select: 'Shift'
    };
    return map[btn] || '';
  }

  _keyToCode(key) {
    const m = {
      'ArrowUp':'ArrowUp','ArrowDown':'ArrowDown','ArrowLeft':'ArrowLeft','ArrowRight':'ArrowRight',
      'x':'KeyX','z':'KeyZ','Enter':'Enter','Shift':'ShiftLeft'
    };
    return m[key] || key;
  }

  _keyToKeyCode(key) {
    const m = {
      'ArrowUp':38,'ArrowDown':40,'ArrowLeft':37,'ArrowRight':39,
      'x':88,'z':90,'Enter':13,'Shift':16
    };
    return m[key] || 0;
  }

  /* ── Keyboard Fisik ───────────────────────────────────────────────────── */

  _bindKeyboard() {
    const handler = e => {
      if (!this.loaded) return;
      const btn = this._keyToBtn(e.key);
      if (!btn) return;
      e.preventDefault();
      this._highlightButton(btn, e.type === 'keydown');
      // Kirim ke emulator via Nostalgist API (sama dengan virtual button)
      this._sendButton(btn, e.type === 'keydown');
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup',   handler);
  }

  _keyToBtn(key) {
    const map = {
      'ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left','ArrowRight':'right',
      'x':'a','z':'b','Enter':'start','Shift':'select'
    };
    return map[key] || null;
  }

  _highlightButton(btn, active) {
    const el = this.virtualGamepad.querySelector(`[data-btn="${btn}"]`);
    if (el) el.classList.toggle('active', active);
  }

  /* ── Orientasi ────────────────────────────────────────────────────────── */

  _bindOrientationChange() {
    window.addEventListener('resize', () => this._applyOrientation());
    new MutationObserver(() => {
      if (this.loaded) this._applyOrientation();
    }).observe(this.emuWrapper, { childList: true });
  }

  _applyOrientation() {
    const container = this.emuWrapper.querySelector('.emu-container');
    if (!container) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    container.classList.toggle('emu-portrait',  isPortrait);
    container.classList.toggle('emu-landscape', !isPortrait);
  }

  /* ── Kontrol ──────────────────────────────────────────────────────────── */

  stop() {
    if (this.nostalgist) {
      try { this.nostalgist.exit(); } catch (_) {}
      this.nostalgist = null;
    }

    // ✅ FIX #4 lanjutan – Kembalikan virtualGamepad ke posisi HTML asal
    //    sebelum emuWrapper di-clear, agar tidak ikut terhapus.
    if (this._gamepadInContainer) {
      this._gamepadOriginalParent.insertBefore(
        this.virtualGamepad,
        this._gamepadOriginalSibling
      );
      this._gamepadInContainer = false;
    }

    this.emuWrapper.innerHTML = '';
    this.controlsDiv.style.display = 'none';
    this.virtualGamepad.style.display = 'none';
    this.statusText.textContent = 'Emulator stopped.';
    this.loaded = false;
    this.canvas = null;
  }

  reset() {
    if (this.nostalgist) {
      this.nostalgist.restart();
      this.statusText.textContent = '🔄 Reset.';
    }
  }

  toggleFullscreen() {
    const wrapper = document.getElementById('emuWrapper');
    if (!document.fullscreenElement) {
      (wrapper.requestFullscreen || wrapper.webkitRequestFullscreen)?.call(wrapper);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.nesEmulator = new NESEmulator();
});
