// data/js/nes-emulator.js – REWRITE
// NES Emulator + Audio + Virtual Gamepad + Layout Editor + Orientation

(function() {
  'use strict';

  /* ────────────────────────────────────
     Layout storage key
     ──────────────────────────────────── */
  const LAYOUT_KEY = 'nes_emulator_layout';

  /* ────────────────────────────────────
     Default layout (percent based)
     ──────────────────────────────────── */
  function getDefaultLayout() {
    return {
      portrait: {
        up:    { x: 25, y: 65 },
        down:  { x: 25, y: 85 },
        left:  { x: 15, y: 75 },
        right: { x: 35, y: 75 },
        a:     { x: 75, y: 70 },
        b:     { x: 65, y: 80 },
        start: { x: 40, y: 93 },
        select:{ x: 60, y: 93 }
      },
      landscape: {
        up:    { x: 8,  y: 30 },
        down:  { x: 8,  y: 50 },
        left:  { x: 3,  y: 40 },
        right: { x: 13, y: 40 },
        a:     { x: 88, y: 35 },
        b:     { x: 88, y: 55 },
        start: { x: 30, y: 85 },
        select:{ x: 55, y: 85 }
      }
    };
  }

  /* ────────────────────────────────────
     Main class
     ──────────────────────────────────── */
  class NESEmulator {
    constructor() {
      this.nostalgist = null;
      this.loaded = false;
      this.canvas = null;
      this._gamepadInContainer = false;

      // DOM refs
      this.dropZone       = document.getElementById('dropZone');
      this.subtitle       = document.querySelector('.subtitle');
      this.controlsDiv    = document.getElementById('controls');
      this.emuWrapper     = document.getElementById('emuWrapper');
      this.virtualGamepad = document.getElementById('virtualGamepad');
      this.statusText     = document.getElementById('statusText');

      // Control buttons
      this.btnStop        = document.getElementById('btnStop');
      this.btnReset       = document.getElementById('btnReset');
      this.btnFullscreen  = document.getElementById('btnFullscreen');
      this.btnSettings    = document.getElementById('btnSettings');

      // Layout editor
      this.layoutModal    = document.getElementById('layoutEditorModal');
      this.editorCanvas   = document.getElementById('editorCanvasArea');
      this.editorSelected = null;
      this.editorOrientation = 'portrait';
      this.layoutData     = this._readLayout();

      // Init
      this._bindControls();
      this._bindDropZone();
      this._bindVirtualGamepad();
      this._bindKeyboard();
      this._bindOrientationChange();
      this._bindLayoutEditor();
      this._preUnlockAudio();
    }

    /* ── Audio ─────────────────────── */
    _preUnlockAudio() {
      const unlock = async () => {
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
        } catch (_) {}
      };
      document.addEventListener('pointerdown', unlock, { once: true, passive: true });
      document.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    /* ── Dropzone ──────────────────── */
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
        if (file) this._handleFile(file);
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
        console.error(err);
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
        this.canvas.style.top = '';
        this.canvas.style.left = '';
        this.canvas.style.width = '';
        this.canvas.style.height = '';

        // Hide dropzone + subtitle
        this.dropZone.style.display = 'none';
        if (this.subtitle) this.subtitle.style.display = 'none';

        // Build UI
        this.emuWrapper.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'emu-container';
        container.appendChild(this.canvas);
        container.appendChild(this.virtualGamepad);
        this._gamepadInContainer = true;
        this.emuWrapper.appendChild(container);

        this.controlsDiv.style.display = 'flex';
        this.virtualGamepad.style.display = 'flex';
        this.loaded = true;
        this.statusText.textContent = '🎮 ROM loaded • 🔊 Audio ON';

        this._applyOrientation();
        this._applyLayout();
      } catch (e) {
        this.statusText.textContent = 'Error: ' + e.message;
        console.error(e);
      }
    }

    /* ── Virtual Gamepad Input ─────── */
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

        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointerleave', release);
        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release);
      });
    }

    _sendButton(btn, isPress) {
      if (!this.nostalgist) return;
      const key = this._btnToKey(btn);
      if (key && this.canvas) {
        const eventType = isPress ? 'keydown' : 'keyup';
        this.canvas.dispatchEvent(new KeyboardEvent(eventType, {
          key: key, code: key, keyCode: this._keyCode(key),
          bubbles: true, cancelable: true
        }));
      }
      // Also use Nostalgist API
      try {
        const nesBtn = this._btnToNes(btn);
        if (nesBtn) {
          isPress ? this.nostalgist.pressButton(nesBtn, 0) : this.nostalgist.releaseButton(nesBtn, 0);
        }
      } catch (_) {}
    }

    _btnToKey(btn) {
      const m = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', a:'x', b:'z', start:'Enter', select:'Shift' };
      return m[btn] || '';
    }
    _keyCode(key) {
      const m = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, x:88, z:90, Enter:13, Shift:16 };
      return m[key] || 0;
    }
    _btnToNes(btn) {
      const m = { up:'up', down:'down', left:'left', right:'right', a:'a', b:'b', start:'start', select:'select' };
      return m[btn] || null;
    }

    /* ── Physical Keyboard ─────────── */
    _bindKeyboard() {
      window.addEventListener('keydown', e => {
        if (!this.loaded) return;
        const btn = this._keyToBtn(e.key);
        if (btn) { e.preventDefault(); this._highlightBtn(btn, true); }
      });
      window.addEventListener('keyup', e => {
        if (!this.loaded) return;
        const btn = this._keyToBtn(e.key);
        if (btn) { e.preventDefault(); this._highlightBtn(btn, false); }
      });
    }
    _keyToBtn(key) {
      const m = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', x:'a', z:'b', Enter:'start', Shift:'select' };
      return m[key] || null;
    }
    _highlightBtn(btn, active) {
      const el = this.virtualGamepad.querySelector(`[data-btn="${btn}"]`);
      if (el) el.classList.toggle('active', active);
    }

    /* ── Controls (Stop/Reset/FS/Settings) ── */
    _bindControls() {
      this.btnStop.onclick = () => this.stop();
      this.btnReset.onclick = () => this.reset();
      this.btnFullscreen.onclick = () => this.toggleFullscreen();
      this.btnSettings.onclick = () => this._openLayoutEditor();
    }

    stop() {
      if (this.nostalgist) {
        try { this.nostalgist.exit(); } catch (_) {}
        this.nostalgist = null;
      }
      if (this._gamepadInContainer) {
        // Move gamepad back
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
      if (this.nostalgist) {
        this.nostalgist.restart();
        this.statusText.textContent = '🔄 Reset.';
      }
    }

    toggleFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (this.emuWrapper.requestFullscreen || this.emuWrapper.webkitRequestFullscreen)?.call(this.emuWrapper);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      }
      setTimeout(() => this._applyOrientation(), 300);
    }

    /* ── Orientation ───────────────── */
    _bindOrientationChange() {
      const handler = () => this._applyOrientation();
      window.addEventListener('resize', handler);
      window.addEventListener('orientationchange', () => setTimeout(handler, 150));
    }

    _applyOrientation() {
      const container = this.emuWrapper.querySelector('.emu-container');
      if (!container) return;
      const isPortrait = window.innerHeight > window.innerWidth;
      container.classList.toggle('portrait-layout', isPortrait);
      container.classList.toggle('landscape-layout', !isPortrait);
    }

    /* ── Layout Persistence ────────── */
    _readLayout() {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        return raw ? JSON.parse(raw) : getDefaultLayout();
      } catch (_) {
        return getDefaultLayout();
      }
    }

    _writeLayout() {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layoutData));
    }

    _applyLayout() {
      const container = this.emuWrapper.querySelector('.emu-container');
      const isPortrait = container?.classList.contains('portrait-layout');
      const layout = isPortrait ? this.layoutData.portrait : this.layoutData.landscape;
      if (!layout) return;

      const gamepadContainer = this.virtualGamepad.querySelector('.gamepad-container');
      if (!gamepadContainer) return;

      // Pastikan gamepad container relative untuk positioning absolute
      gamepadContainer.style.position = 'relative';
      gamepadContainer.style.width = '100%';
      gamepadContainer.style.height = '100%';

      Object.keys(layout).forEach(btnName => {
        const pos = layout[btnName];
        const el = gamepadContainer.querySelector(`[data-btn="${btnName}"]`);
        if (el) {
          el.style.position = 'absolute';
          el.style.left = pos.x + '%';
          el.style.top = pos.y + '%';
          el.style.transform = 'translate(-50%, -50%)';
        }
      });
    }

    /* ── Layout Editor ─────────────── */
    _bindLayoutEditor() {
      // Close
      this.layoutModal.querySelector('.layout-editor-overlay').onclick = () => this._closeLayoutEditor();
      this.layoutModal.querySelector('#btnCloseEditor').onclick = () => this._closeLayoutEditor();

      // Tabs
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(btn => {
        btn.onclick = () => this._switchEditorOrientation(btn.dataset.ori);
      });

      // Coord inputs
      document.getElementById('posX').onchange = () => this._updateSelectedFromInputs();
      document.getElementById('posY').onchange = () => this._updateSelectedFromInputs();

      // Action buttons
      document.getElementById('btnExport').onclick = () => this._exportLayout();
      document.getElementById('btnImport').onclick = () => this._importLayout();
      document.getElementById('btnResetLayout').onclick = () => this._resetLayout();
    }

    _openLayoutEditor() {
      this.layoutData = this._readLayout();
      this.editorOrientation = 'portrait';
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.ori === 'portrait');
      });
      this.layoutModal.classList.add('active');
      this._renderEditorCanvas();
    }

    _closeLayoutEditor() {
      this.layoutModal.classList.remove('active');
      this._writeLayout();
      this._applyLayout();
    }

    _switchEditorOrientation(ori) {
      this.editorOrientation = ori;
      this.layoutModal.querySelectorAll('.orientation-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.ori === ori);
      });
      this.editorSelected = null;
      document.getElementById('selectedName').textContent = 'Click a button';
      document.getElementById('posX').value = '';
      document.getElementById('posY').value = '';
      this._renderEditorCanvas();
    }

    _renderEditorCanvas() {
      const canvas = this.editorCanvas;
      canvas.innerHTML = '';
      const buttons = this.layoutData[this.editorOrientation];
      if (!buttons) return;

      Object.keys(buttons).forEach(btnName => {
        const pos = buttons[btnName];
        const el = document.createElement('div');
        el.className = 'draggable-btn';
        el.dataset.btn = btnName;
        el.style.left = pos.x + '%';
        el.style.top = pos.y + '%';
        el.textContent = btnName === 'a' ? 'A' : btnName === 'b' ? 'B' :
                         btnName === 'start' ? 'START' : btnName === 'select' ? 'SELECT' :
                         btnName === 'up' ? '▲' : btnName === 'down' ? '▼' :
                         btnName === 'left' ? '◀' : btnName === 'right' ? '▶' : btnName;

        el.addEventListener('pointerdown', e => this._startDrag(e, el, btnName));
        el.addEventListener('click', () => this._selectEditorButton(btnName));
        canvas.appendChild(el);
      });
    }

    _selectEditorButton(btnName) {
      this.editorSelected = btnName;
      document.getElementById('selectedName').textContent = btnName.toUpperCase();
      const pos = this.layoutData[this.editorOrientation][btnName];
      document.getElementById('posX').value = pos.x;
      document.getElementById('posY').value = pos.y;
      this.editorCanvas.querySelectorAll('.draggable-btn').forEach(el => el.classList.remove('active'));
      const el = this.editorCanvas.querySelector(`[data-btn="${btnName}"]`);
      if (el) el.classList.add('active');
    }

    _updateSelectedFromInputs() {
      if (!this.editorSelected) return;
      const x = parseFloat(document.getElementById('posX').value) || 0;
      const y = parseFloat(document.getElementById('posY').value) || 0;
      this.layoutData[this.editorOrientation][this.editorSelected] = { x, y };
      const el = this.editorCanvas.querySelector(`[data-btn="${this.editorSelected}"]`);
      if (el) { el.style.left = x + '%'; el.style.top = y + '%'; }
      this._writeLayout();
    }

    _startDrag(e, el, btnName) {
      e.preventDefault();
      this._selectEditorButton(btnName);
      const rect = this.editorCanvas.getBoundingClientRect();

      const onMove = (me) => {
        me.preventDefault();
        const cx = me.touches ? me.touches[0].clientX : me.clientX;
        const cy = me.touches ? me.touches[0].clientY : me.clientY;
        let x = ((cx - rect.left) / rect.width) * 100;
        let y = ((cy - rect.top) / rect.height) * 100;
        x = Math.max(2, Math.min(98, Math.round(x * 2) / 2));
        y = Math.max(2, Math.min(98, Math.round(y * 2) / 2));
        this.layoutData[this.editorOrientation][btnName] = { x, y };
        el.style.left = x + '%';
        el.style.top = y + '%';
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

    _exportLayout() {
      const json = JSON.stringify(this.layoutData, null, 2);
      navigator.clipboard.writeText(json).then(() => alert('Layout copied!'));
    }

    _importLayout() {
      const input = prompt('Paste layout JSON:');
      if (!input) return;
      try {
        this.layoutData = JSON.parse(input);
        this._writeLayout();
        this._renderEditorCanvas();
      } catch (e) { alert('Invalid JSON'); }
    }

    _resetLayout() {
      this.layoutData = getDefaultLayout();
      this._writeLayout();
      this._renderEditorCanvas();
    }
  }

  // Start when DOM ready
  window.addEventListener('DOMContentLoaded', () => {
    window.nesEmulator = new NESEmulator();
  });
})();
