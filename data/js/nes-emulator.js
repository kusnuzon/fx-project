// data/js/nes-emulator.js
// NES Emulator Core + Layout Editor

class NESEmulator {
  constructor() {
    this.nostalgist = null;
    this.loaded = false;
    this.canvas = null;
    this._gamepadInContainer = false;
    this._layoutStorageKey = 'nes_emulator_layout';

    this.dropZone       = document.getElementById('dropZone');
    this.subtitle       = document.querySelector('.subtitle');
    this.controlsDiv    = document.getElementById('controls');
    this.emuWrapper     = document.getElementById('emuWrapper');
    this.virtualGamepad = document.getElementById('virtualGamepad');
    this.statusText     = document.getElementById('statusText');

    this._gamepadOriginalParent  = this.virtualGamepad.parentNode;
    this._gamepadOriginalNext    = this.virtualGamepad.nextSibling;

    this._bindDropZone();
    this._bindVirtualGamepad();
    this._bindKeyboard();
    this._setupAudioUnlock();
    this._bindOrientationChange();
    this._bindFullscreenChange();
    this._initLayoutEditor();
  }

  /* ── Audio Unlock ─────────────────── */
  _setupAudioUnlock() {
    const unlock = async () => { await this._unlockAudio(); };
    document.addEventListener('pointerdown', unlock, { once: true, passive: true });
    document.addEventListener('touchstart',  unlock, { once: true, passive: true });
  }

  async _unlockAudio() {
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
  }

  /* ── Drop Zone ────────────────────── */
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
      await this._unlockAudio();
      const file = e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });
    this.dropZone.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type   = 'file';
      inp.accept = '.nes,.zip';
      inp.onchange = async e => {
        await this._unlockAudio();
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

  /* ── Load ROM ─────────────────────── */
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
          audio_enable:   'true',
          audio_out_rate: '44100',
          audio_latency:  '64',
          video_smooth:   'false',
          input_player1_joypad_index: '0',
          input_player1_a: 'x',
          input_player1_b: 'z',
          input_player1_start: 'enter',
          input_player1_select: 'shift',
          input_player1_up: 'up',
          input_player1_down: 'down',
          input_player1_left: 'left',
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

      this.dropZone.style.display = 'none';
      if (this.subtitle) this.subtitle.style.display = 'none';

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

      this._applyLayout();
      this._applyOrientation();
    } catch (e) {
      this.statusText.textContent = 'Error: ' + e.message;
      console.error('[NES] loadROM:', e);
    }
  }

  /* ── Virtual Gamepad Input ────────── */
  _bindVirtualGamepad() {
    this.virtualGamepad.querySelectorAll('.gamepad-btn').forEach(btn => {
      const dataBtn = btn.dataset.btn;
      if (!dataBtn) return;

      const press = e => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        this._sendButton(dataBtn, true);
      };
      const release = e => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('active');
        this._sendButton(dataBtn, false);
      };

      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        btn.classList.add('active');
        this._sendButton(dataBtn, true);
      });
      btn.addEventListener('touchend', e => {
        e.preventDefault();
        btn.classList.remove('active');
        this._sendButton(dataBtn, false);
      });
    });
  }

  _sendButton(btn, isPress) {
    if (!this.nostalgist) return;
    const key = this._btnToKey(btn);
    if (key && this.canvas) {
      const event = new KeyboardEvent(isPress ? 'keydown' : 'keyup', {
        key, code: this._keyToCode(key), keyCode: this._keyToKeyCode(key),
        which: this._keyToKeyCode(key), bubbles: true, cancelable: true
      });
      this.canvas.dispatchEvent(event);
    }
    try {
      const nesBtn = this._btnToNostalgistBtn(btn);
      if (nesBtn) {
        isPress ? this.nostalgist.pressButton(nesBtn, 0) : this.nostalgist.releaseButton(nesBtn, 0);
      }
    } catch (_) {}
  }

  _btnToNostalgistBtn(btn) {
    const map = { up:'up', down:'down', left:'left', right:'right', a:'a', b:'b', start:'start', select:'select' };
    return map[btn] || null;
  }
  _btnToKey(btn) {
    const map = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', a:'x', b:'z', start:'Enter', select:'Shift' };
    return map[btn] || '';
  }
  _keyToCode(key) {
    const m = { ArrowUp:'ArrowUp', ArrowDown:'ArrowDown', ArrowLeft:'ArrowLeft', ArrowRight:'ArrowRight', x:'KeyX', z:'KeyZ', Enter:'Enter', Shift:'ShiftLeft' };
    return m[key] || key;
  }
  _keyToKeyCode(key) {
    const m = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, x:88, z:90, Enter:13, Shift:16 };
    return m[key] || 0;
  }

  /* ── Keyboard Fisik ───────────────── */
  _bindKeyboard() {
    const handler = e => {
      if (!this.loaded) return;
      const btn = this._keyToBtn(e.key);
      if (!btn) return;
      e.preventDefault();
      this._highlightButton(btn, e.type === 'keydown');
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);
  }
  _keyToBtn(key) {
    const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', x:'a', z:'b', Enter:'start', Shift:'select' };
    return map[key] || null;
  }
  _highlightButton(btn, active) {
    const el = this.virtualGamepad.querySelector(`[data-btn="${btn}"]`);
    if (el) el.classList.toggle('active', active);
  }

  /* ── Orientasi ────────────────────── */
  _bindOrientationChange() {
    this._orientationHandler = () => this._applyOrientation();
    window.addEventListener('resize', this._orientationHandler);
    window.addEventListener('orientationchange', () => setTimeout(() => this._applyOrientation(), 150));
  }
  _applyOrientation() {
    const container = this.emuWrapper.querySelector('.emu-container');
    if (!container) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    container.classList.toggle('emu-portrait', isPortrait);
    container.classList.toggle('emu-landscape', !isPortrait);
    this._applyLayout();
  }

  /* ── Layout dari localStorage ──────── */
  _applyLayout() {
    const stored = localStorage.getItem(this._layoutStorageKey);
    if (!stored) return;
    try {
      const layout = JSON.parse(stored);
      const isPortrait = window.innerHeight > window.innerWidth;
      const currentLayout = isPortrait ? layout.portrait : layout.landscape;
      if (!currentLayout) return;
      Object.keys(currentLayout).forEach(btnName => {
        const pos = currentLayout[btnName];
        const el = this.virtualGamepad.querySelector(`[data-btn="${btnName}"]`);
        if (el) {
          el.style.position = 'absolute';
          el.style.left = pos.x + '%';
          el.style.top = pos.y + '%';
          el.style.transform = 'translate(-50%, -50%)';
        }
      });
      // Container gamepad harus relative
      if (this.virtualGamepad.querySelector('.gamepad-container')) {
        this.virtualGamepad.querySelector('.gamepad-container').style.position = 'relative';
        this.virtualGamepad.querySelector('.gamepad-container').style.width = '100%';
        this.virtualGamepad.querySelector('.gamepad-container').style.height = '100%';
      }
    } catch (e) {}
  }

  /* ── Layout Editor ─────────────────── */
  _initLayoutEditor() {
    this.editorSelected = null;
    this.editorLayout = this._loadLayout();
    this.editorOrientation = 'portrait';
  }

  _loadLayout() {
    try {
      const stored = localStorage.getItem(this._layoutStorageKey);
      return stored ? JSON.parse(stored) : {
        portrait: {
          up:{x:25,y:65}, down:{x:25,y:85}, left:{x:15,y:75}, right:{x:35,y:75},
          a:{x:75,y:70}, b:{x:65,y:80}, start:{x:40,y:93}, select:{x:60,y:93}
        },
        landscape: {
          up:{x:8,y:30}, down:{x:8,y:50}, left:{x:3,y:40}, right:{x:13,y:40},
          a:{x:88,y:35}, b:{x:88,y:55}, start:{x:30,y:85}, select:{x:55,y:85}
        }
      };
    } catch (e) {
      return {
        portrait: {},
        landscape: {}
      };
    }
  }

  _saveLayout() {
    localStorage.setItem(this._layoutStorageKey, JSON.stringify(this.editorLayout));
    this._applyLayout();
  }

  toggleLayoutEditor() {
    const modal = document.getElementById('layoutEditorModal');
    const isActive = modal.classList.contains('active');
    if (isActive) {
      modal.classList.remove('active');
      this._saveLayout();
    } else {
      this.editorLayout = this._loadLayout();
      this.editorOrientation = 'portrait';
      modal.classList.add('active');
      this._renderEditorCanvas();
    }
  }

  switchOrientation(ori) {
    this.editorOrientation = ori;
    document.getElementById('tabPortrait').classList.toggle('active', ori === 'portrait');
    document.getElementById('tabLandscape').classList.toggle('active', ori === 'landscape');
    this._renderEditorCanvas();
  }

  _renderEditorCanvas() {
    const canvas = document.getElementById('editorCanvasArea');
    canvas.innerHTML = '';
    const buttons = this.editorLayout[this.editorOrientation];
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

      el.addEventListener('pointerdown', (e) => this._startDrag(e, el, btnName));
      el.addEventListener('click', () => this._selectEditorBtn(btnName));
      canvas.appendChild(el);
    });
  }

  _selectEditorBtn(btnName) {
    this.editorSelected = btnName;
    document.getElementById('selectedName').textContent = btnName.toUpperCase();
    const pos = this.editorLayout[this.editorOrientation][btnName];
    document.getElementById('posX').value = pos.x;
    document.getElementById('posY').value = pos.y;
    document.querySelectorAll('#editorCanvasArea .draggable-btn').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`#editorCanvasArea [data-btn="${btnName}"]`);
    if (el) el.classList.add('active');
  }

  updateSelectedPosition() {
    if (!this.editorSelected) return;
    const x = parseFloat(document.getElementById('posX').value) || 0;
    const y = parseFloat(document.getElementById('posY').value) || 0;
    this.editorLayout[this.editorOrientation][this.editorSelected] = { x, y };
    const el = document.querySelector(`#editorCanvasArea [data-btn="${this.editorSelected}"]`);
    if (el) { el.style.left = x + '%'; el.style.top = y + '%'; }
    this._saveLayout();
  }

  _startDrag(e, el, btnName) {
    e.preventDefault();
    this._selectEditorBtn(btnName);
    const canvas = document.getElementById('editorCanvasArea');
    const rect = canvas.getBoundingClientRect();

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const clientY = moveEvent.touches ? moveEvent.touches[0].clientY : moveEvent.clientY;
      let x = ((clientX - rect.left) / rect.width) * 100;
      let y = ((clientY - rect.top) / rect.height) * 100;
      x = Math.max(2, Math.min(98, Math.round(x * 2) / 2));
      y = Math.max(2, Math.min(98, Math.round(y * 2) / 2));
      this.editorLayout[this.editorOrientation][btnName] = { x, y };
      el.style.left = x + '%';
      el.style.top = y + '%';
      document.getElementById('posX').value = x;
      document.getElementById('posY').value = y;
      this._saveLayout();
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

  exportLayoutJSON() {
    const json = JSON.stringify(this.editorLayout, null, 2);
    navigator.clipboard.writeText(json).then(() => alert('Layout JSON copied!'));
  }

  importLayoutJSON() {
    const input = prompt('Paste layout JSON:');
    if (!input) return;
    try {
      this.editorLayout = JSON.parse(input);
      this._saveLayout();
      this._renderEditorCanvas();
    } catch (e) { alert('Invalid JSON'); }
  }

  resetLayout() {
    this.editorLayout = {
      portrait: {
        up:{x:25,y:65}, down:{x:25,y:85}, left:{x:15,y:75}, right:{x:35,y:75},
        a:{x:75,y:70}, b:{x:65,y:80}, start:{x:40,y:93}, select:{x:60,y:93}
      },
      landscape: {
        up:{x:8,y:30}, down:{x:8,y:50}, left:{x:3,y:40}, right:{x:13,y:40},
        a:{x:88,y:35}, b:{x:88,y:55}, start:{x:30,y:85}, select:{x:55,y:85}
      }
    };
    this._saveLayout();
    this._renderEditorCanvas();
  }

  /* ── Fullscreen ───────────────────── */
  _bindFullscreenChange() {
    document.addEventListener('fullscreenchange', () => setTimeout(() => this._applyOrientation(), 200));
    document.addEventListener('webkitfullscreenchange', () => setTimeout(() => this._applyOrientation(), 200));
  }

  /* ── Kontrol ──────────────────────── */
  stop() {
    if (this.nostalgist) { try { this.nostalgist.exit(); } catch (_) {} this.nostalgist = null; }
    if (this._gamepadInContainer) {
      this._gamepadOriginalParent.insertBefore(this.virtualGamepad, this._gamepadOriginalNext);
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
