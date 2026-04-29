// data/js/nes-emulator.js
// MODULAR – Uses VirtualGamepad class
// Callback mapping disesuaikan untuk NES

(function() {
  'use strict';

  const LAYOUT_KEY = 'nes_emulator_layout';

  /* ── Default layout (group positions in percent) ── */
  function defaultLayout() {
    return {
      portrait: {
        dpad:         { x: 25, y: 70 },
        abxy:         { x: 75, y: 70 },
        startselect:  { x: 50, y: 90 },
      },
      landscape: {
        dpad:         { x: 10, y: 45 },
        abxy:         { x: 90, y: 45 },
        startselect:  { x: 50, y: 90 },
      }
    };
  }

  /* ── NES button groups definition ── */
  const NES_GROUPS = {
    dpad: true,                    // up/down/left/right
    abxy: {                        // Hanya A dan B untuk NES
      buttons: ['a','b'],
      order: ['a','b']             // render order
    },
    startselect: {
      buttons: ['start','select']
    }
    // Tidak ada L/R untuk NES
  };

  /* ── Main Emulator Class ── */
  class NESEmulator {
    constructor() {
      this.nostalgist = null;
      this.loaded = false;
      this.canvas = null;
      this.gamepad = null;
      this._gamepadInContainer = false;

      // DOM
      this.dropZone       = document.getElementById('dropZone');
      this.subtitle       = document.querySelector('.subtitle');
      this.controlsDiv    = document.getElementById('controls');
      this.emuWrapper     = document.getElementById('emuWrapper');
      this.virtualGamepad = document.getElementById('virtualGamepad');
      this.statusText     = document.getElementById('statusText');
      this.layoutModal    = document.getElementById('layoutEditorModal');
      this.editorCanvas   = document.getElementById('editorCanvasArea');

      // Buttons
      document.getElementById('btnStop').onclick = () => this.stop();
      document.getElementById('btnReset').onclick = () => this.reset();
      document.getElementById('btnFullscreen').onclick = () => this.toggleFullscreen();
      document.getElementById('btnSettings').onclick = () => this._openEditor();

      // Layout
      this.layoutData     = this._readLayout();
      this.editorOrientation = 'portrait';
      this.editorSelected = null;

      this._bindDropZone();
      this._bindKeyboard();
      this._bindOrientationChange();
      this._bindEditor();
      this._preUnlockAudio();
    }

    /* ── Audio Unlock ──────────────── */
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

    /* ── Drop Zone ─────────────────── */
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

    /* ── Load ROM ──────────────────── */
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

        // Build UI
        this.emuWrapper.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'emu-container';
        container.appendChild(this.canvas);

        // Create VirtualGamepad
        this.gamepad = new VirtualGamepad({
          container: this.virtualGamepad,
          groups: NES_GROUPS,
          layout: this._currentLayout(),
          onButton: ({ button, pressed }) => this._handleGamepadButton(button, pressed)
        });

        container.appendChild(this.virtualGamepad);
        this._gamepadInContainer = true;
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
          key: key, code: key, keyCode: this._keyCode(key),
          bubbles: true, cancelable: true
        }));
      }
      // Nostalgist API
      try {
        const nesBtn = this._btnToNes(btn);
        if (nesBtn) {
          pressed ? this.nostalgist.pressButton(nesBtn, 0) : this.nostalgist.releaseButton(nesBtn, 0);
        }
      } catch (_) {}
    }

    _btnToKey(b) {
      const m = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', a:'x', b:'z', start:'Enter', select:'Shift' };
      return m[b] || '';
    }
    _keyCode(k) {
      const m = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, x:88, z:90, Enter:13, Shift:16 };
      return m[k] || 0;
    }
    _btnToNes(b) {
      const m = { up:'up', down:'down', left:'left', right:'right', a:'a', b:'b', start:'start', select:'select' };
      return m[b] || null;
    }

    /* ── Keyboard ──────────────────── */
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

    /* ── Orientation ───────────────── */
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

    /* ── Layout Persistence ────────── */
    _readLayout() {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        return raw ? JSON.parse(raw) : defaultLayout();
      } catch (_) { return defaultLayout(); }
    }
    _writeLayout() {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layoutData));
    }
    _currentLayout() {
      const isPortrait = window.innerHeight > window.innerWidth;
      return isPortrait ? this.layoutData.portrait : this.layoutData.landscape;
    }

    /* ── Controls ──────────────────── */
    stop() {
      if (this.nostalgist) { try { this.nostalgist.exit(); } catch (_) {} this.nostalgist = null; }
      if (this._gamepadInContainer) {
        document.querySelector('.container')?.appendChild(this.virtualGamepad);
        this._gamepadInContainer = false;
      }
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

    /* ── Layout Editor ─────────────── */
    _bindEditor() {
      this.layoutModal.querySelector('.layout-editor-overlay').onclick = () => this._closeEditor();
      document.getElementById('btnCloseEditor').onclick = () => this._closeEditor();
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(b => {
        b.onclick = () => this._switchEditorOrientation(b.dataset.ori);
      });
      document.getElementById('btnExport').onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(this.layoutData, null, 2)).then(() => alert('Copied!'));
      };
      document.getElementById('btnImport').onclick = () => {
        const input = prompt('Paste layout JSON:');
        if (!input) return;
        try { this.layoutData = JSON.parse(input); this._writeLayout(); this._renderEditor(); } catch (_) { alert('Invalid JSON'); }
      };
      document.getElementById('btnResetLayout').onclick = () => {
        this.layoutData = defaultLayout();
        this._writeLayout();
        this._renderEditor();
      };
    }

    _openEditor() {
      this.layoutData = this._readLayout();
      this.editorOrientation = 'portrait';
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.ori === 'portrait');
      });
      this.layoutModal.classList.add('active');
      this._renderEditor();
    }
    _closeEditor() {
      this.layoutModal.classList.remove('active');
      this._writeLayout();
      this.gamepad?.updateLayout(this._currentLayout());
    }

    _switchEditorOrientation(ori) {
      this.editorOrientation = ori;
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.ori === ori);
      });
      this.editorSelected = null;
      document.getElementById('selectedName').textContent = 'Click a group';
      document.getElementById('posX').value = '';
      document.getElementById('posY').value = '';
      this._renderEditor();
    }

    _renderEditor() {
      const canvas = this.editorCanvas;
      canvas.innerHTML = '';
      const groups = this.layoutData[this.editorOrientation];
      if (!groups) return;

      // Render setiap grup sebagai kotak yang bisa di-drag
      Object.keys(groups).forEach(groupName => {
        const pos = groups[groupName];
        const box = document.createElement('div');
        box.className = 'editor-group-box';
        box.dataset.group = groupName;
        box.style.left = pos.x + '%';
        box.style.top = pos.y + '%';

        // Label grup
        const label = document.createElement('span');
        label.style.fontSize = '0.45rem';
        label.style.color = '#9da5b4';
        label.style.fontFamily = "'Press Start 2P', cursive";
        label.textContent = groupName.toUpperCase();
        box.appendChild(label);

        box.addEventListener('pointerdown', e => this._startDrag(e, box, groupName));
        box.addEventListener('click', () => this._selectGroup(groupName));
        canvas.appendChild(box);
      });
    }

    _selectGroup(groupName) {
      this.editorSelected = groupName;
      document.getElementById('selectedName').textContent = groupName.toUpperCase();
      const pos = this.layoutData[this.editorOrientation][groupName];
      document.getElementById('posX').value = pos.x;
      document.getElementById('posY').value = pos.y;

      this.editorCanvas.querySelectorAll('.editor-group-box').forEach(b => b.classList.remove('active'));
      const box = this.editorCanvas.querySelector(`[data-group="${groupName}"]`);
      if (box) box.classList.add('active');
    }

    _startDrag(e, box, groupName) {
      e.preventDefault();
      this._selectGroup(groupName);
      const rect = this.editorCanvas.getBoundingClientRect();

      const onMove = (me) => {
        me.preventDefault();
        const cx = me.touches ? me.touches[0].clientX : me.clientX;
        const cy = me.touches ? me.touches[0].clientY : me.clientY;
        let x = ((cx - rect.left) / rect.width) * 100;
        let y = ((cy - rect.top) / rect.height) * 100;
        x = Math.max(2, Math.min(98, Math.round(x * 2) / 2));
        y = Math.max(2, Math.min(98, Math.round(y * 2) / 2));
        this.layoutData[this.editorOrientation][groupName] = { x, y };
        box.style.left = x + '%';
        box.style.top = y + '%';
        document.getElementById('posX').value = x;
        document.getElementById('posY').value = y;
        this._writeLayout();
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.nesEmulator = new NESEmulator();
  });
})();
