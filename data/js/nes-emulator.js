// data/js/nes-emulator.js
// NES Emulator – No Layout Editor

(function() {
  'use strict';

  const NES_GROUPS = {
    dpad: true,
    abxy: {
      buttons: ['a','b'],
      order: ['a','b']
    },
    startselect: {
      buttons: ['start','select']
    }
  };

  class NESEmulator {
    constructor() {
      this.nostalgist = null;
      this.loaded = false;
      this.canvas = null;
      this.gamepad = null;

      // DOM
      this.dropZone       = document.getElementById('dropZone');
      this.subtitle       = document.querySelector('.subtitle');
      this.controlsDiv    = document.getElementById('controls');
      this.emuWrapper     = document.getElementById('emuWrapper');
      this.virtualGamepad = document.getElementById('virtualGamepad');
      this.statusText     = document.getElementById('statusText');

      // Controls
      document.getElementById('btnStop').onclick = () => this.stop();
      document.getElementById('btnReset').onclick = () => this.reset();
      document.getElementById('btnFullscreen').onclick = () => this.toggleFullscreen();

      this._bindDropZone();
      this._bindKeyboard();
      this._bindOrientationChange();
      this._preUnlockAudio();
    }

    _preUnlockAudio() {
      const fn = async () => {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ctx = new AC();
          if (ctx.state === 'running') { ctx.close(); return; }
          const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
          const src = ctx.createBufferSource();
          src.buffer = buf; src.connect(ctx.destination); src.start(0);
          await ctx.resume();
          setTimeout(() => ctx.close(), 500);
        } catch (_) {}
      };
      document.addEventListener('pointerdown', fn, { once: true, passive: true });
      document.addEventListener('touchstart', fn, { once: true, passive: true });
    }

    _bindDropZone() {
      this.dropZone.addEventListener('dragover', e => { e.preventDefault(); this.dropZone.classList.add('drag-over'); });
      this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
      this.dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
      });
      this.dropZone.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.nes,.zip';
        inp.onchange = e => { if (e.target.files[0]) this._handleFile(e.target.files[0]); };
        inp.click();
      });
    }

    async _handleFile(file) {
      this.statusText.textContent = 'Processing...';
      try {
        const buf = await file.arrayBuffer();
        let data, name;
        if (file.name.toLowerCase().endsWith('.zip')) {
          const zip = await JSZip.loadAsync(buf);
          const n = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.nes'));
          if (!n) throw new Error('No .nes inside ZIP');
          data = await zip.files[n].async('uint8array');
          name = n;
        } else {
          data = new Uint8Array(buf);
          name = file.name;
        }
        await this.loadROM(data, name);
      } catch (err) {
        this.statusText.textContent = 'Error: ' + err.message;
      }
    }

    async loadROM(romData, fileName) {
      this.stop();
      this.statusText.textContent = 'Loading emulator...';
      try {
        const romFile = new File(
          [new Blob([romData], { type: 'application/octet-stream' })],
          fileName || 'game.nes'
        );

        this.nostalgist = await Nostalgist.launch({
          core: 'fceumm',
          rom:  romFile,
          retroarchConfig: {
            audio_enable:        'true',
            audio_out_rate:      '44100',
            audio_latency:       '64',
            video_smooth:        'false',
            input_player1_a:     'x',
            input_player1_b:     'z',
            input_player1_start: 'enter',
            input_player1_select:'shift',
            input_player1_up:    'up',
            input_player1_down:  'down',
            input_player1_left:  'left',
            input_player1_right: 'right',
          },
          respondToGlobalEvents: true,
        });

        this.canvas = this.nostalgist.getCanvas();
        this.canvas.classList.add('nes-emulator-canvas');
        this.canvas.style.position = '';
        this.canvas.style.top = this.canvas.style.left = '';
        this.canvas.style.width = this.canvas.style.height = '';

        this.dropZone.style.display = 'none';
        if (this.subtitle) this.subtitle.style.display = 'none';

        this.emuWrapper.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'emu-container';
        container.appendChild(this.canvas);

        // Virtual Gamepad
        this.gamepad = new VirtualGamepad({
          container: this.virtualGamepad,
          groups: NES_GROUPS,
          onButton: ({ button, pressed }) => this._handleGamepadButton(button, pressed)
        });

        container.appendChild(this.virtualGamepad);
        this.emuWrapper.appendChild(container);

        this.controlsDiv.style.display = 'flex';
        this.virtualGamepad.style.display = 'flex';
        this.loaded = true;
        this.statusText.textContent = '🎮 ROM loaded • 🔊 Audio ON';

        this._applyOrientation();
      } catch (e) {
        this.statusText.textContent = 'Error: ' + e.message;
      }
    }

    _handleGamepadButton(btn, pressed) {
      if (!this.nostalgist || !this.canvas) return;
      const key = this._btnToKey(btn);
      if (key) {
        const type = pressed ? 'keydown' : 'keyup';
        this.canvas.dispatchEvent(new KeyboardEvent(type, {
          key, code: key, keyCode: this._keyCode(key),
          bubbles: true, cancelable: true
        }));
      }
      try {
        const nesBtn = this._btnToNes(btn);
        if (nesBtn) {
          pressed ? this.nostalgist.pressButton(nesBtn, 0) : this.nostalgist.releaseButton(nesBtn, 0);
        }
      } catch (_) {}
    }

    _btnToKey(b) { const m = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', a:'x', b:'z', start:'Enter', select:'Shift' }; return m[b] || ''; }
    _keyCode(k) { const m = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, x:88, z:90, Enter:13, Shift:16 }; return m[k] || 0; }
    _btnToNes(b) { const m = { up:'up', down:'down', left:'left', right:'right', a:'a', b:'b', start:'start', select:'select' }; return m[b] || null; }

    _bindKeyboard() {
      const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', x:'a', z:'b', Enter:'start', Shift:'select' };
      window.addEventListener('keydown', e => {
        if (!this.loaded) return;
        const btn = map[e.key];
        if (btn) { e.preventDefault(); this.gamepad?.highlight(btn, true); }
      });
      window.addEventListener('keyup', e => {
        if (!this.loaded) return;
        const btn = map[e.key];
        if (btn) { e.preventDefault(); this.gamepad?.highlight(btn, false); }
      });
    }

    _bindOrientationChange() {
      const fn = () => this._applyOrientation();
      window.addEventListener('resize', fn);
      window.addEventListener('orientationchange', () => setTimeout(fn, 150));
    }

    _applyOrientation() {
      const c = this.emuWrapper.querySelector('.emu-container');
      if (!c) return;
      const isPortrait = window.innerHeight > window.innerWidth;
      c.classList.toggle('portrait-layout', isPortrait);
      c.classList.toggle('landscape-layout', !isPortrait);
    }

    stop() {
      if (this.nostalgist) { try { this.nostalgist.exit(); } catch (_) {} this.nostalgist = null; }
      this.emuWrapper.innerHTML = '';
      this.controlsDiv.style.display = 'none';
      this.virtualGamepad.style.display = 'none';
      this.dropZone.style.display = '';
      if (this.subtitle) this.subtitle.style.display = '';
      this.statusText.textContent = 'Emulator stopped.';
      this.loaded = false;
      this.canvas = null;
    }

    reset() {
      if (this.nostalgist) { this.nostalgist.restart(); this.statusText.textContent = '🔄 Reset.'; }
    }

    toggleFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (this.emuWrapper.requestFullscreen || this.emuWrapper.webkitRequestFullscreen)?.call(this.emuWrapper);
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
