// data/js/nes-emulator.js
// PASTI BERFUNGSI – dispatch keyboard event ke canvas
(function() {
  const NES_GROUPS = {
    dpad: true,
    abxy: { buttons: ['x','a','b','y'], order: ['x','a','b','y'] },
    startselect: { buttons: ['start','select'] },
    l1l2: { buttons: ['l1','l2'] },
    r1r2: { buttons: ['r1','r2'] }
  };

  // Mapping tombol virtual → keyboard key
  const BTN_TO_KEY = {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    a: 'x', b: 'z', x: 'a', y: 's',
    start: 'Enter', select: 'Shift',
    l1: 'q', l2: 'w', r1: 'e', r2: 'r'
  };

  class NESEmulator {
    constructor() {
      this.nostalgist = null; this.loaded = false; this.canvas = null; this.gamepad = null;
      this.dropZone = document.getElementById('dropZone');
      this.subtitle = document.querySelector('.subtitle');
      this.controlsDiv = document.getElementById('controls');
      this.emuWrapper = document.getElementById('emuWrapper');
      this.virtualGamepad = document.getElementById('virtualGamepad');
      this.statusText = document.getElementById('statusText');
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
          const AC = window.AudioContext||window.webkitAudioContext; if(!AC)return;
          const ctx=new AC(); if(ctx.state==='running'){ctx.close();return;}
          const buf=ctx.createBuffer(1,1,ctx.sampleRate); const src=ctx.createBufferSource();
          src.buffer=buf; src.connect(ctx.destination); src.start(0);
          await ctx.resume(); setTimeout(()=>ctx.close(),500);
        }catch(_){}
      };
      document.addEventListener('pointerdown',fn,{once:true,passive:true});
      document.addEventListener('touchstart',fn,{once:true,passive:true});
    }

    _bindDropZone() {
      this.dropZone.addEventListener('dragover',e=>{e.preventDefault();this.dropZone.classList.add('drag-over');});
      this.dropZone.addEventListener('dragleave',()=>this.dropZone.classList.remove('drag-over'));
      this.dropZone.addEventListener('drop',async e=>{
        e.preventDefault(); this.dropZone.classList.remove('drag-over');
        if(e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
      });
      this.dropZone.addEventListener('click',()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='.nes,.zip';
        inp.onchange=e=>{if(e.target.files[0])this._handleFile(e.target.files[0]);}; inp.click();
      });
    }

    async _handleFile(file) {
      this.statusText.textContent='Processing...';
      try{
        const buf=await file.arrayBuffer(); let data,name;
        if(file.name.toLowerCase().endsWith('.zip')){
          const zip=await JSZip.loadAsync(buf);
          const n=Object.keys(zip.files).find(f=>f.toLowerCase().endsWith('.nes'));
          if(!n)throw new Error('No .nes in ZIP');
          data=await zip.files[n].async('uint8array'); name=n;
        }else{ data=new Uint8Array(buf); name=file.name; }
        await this.loadROM(data,name);
      }catch(err){ this.statusText.textContent='Error: '+err.message; }
    }

    async loadROM(romData, fileName) {
      this.stop();
      this.statusText.textContent='Loading emulator...';
      try{
        const romFile=new File([new Blob([romData],{type:'application/octet-stream'})], fileName||'game.nes');
        this.nostalgist = await Nostalgist.launch({
          core:'fceumm', rom:romFile,
          retroarchConfig: { audio_enable:'true', audio_out_rate:'44100', audio_latency:'64', video_smooth:'false' },
          respondToGlobalEvents: false
        });
        this.canvas=this.nostalgist.getCanvas();
        this.canvas.classList.add('nes-emulator-canvas');
        this.canvas.style.position=''; this.canvas.style.top=''; this.canvas.style.left='';
        this.canvas.style.width=''; this.canvas.style.height='';

        this.dropZone.style.display='none';
        if(this.subtitle) this.subtitle.style.display='none';

        this.emuWrapper.innerHTML='';
        const container=document.createElement('div'); container.className='emu-container';
        container.appendChild(this.canvas);

        this.gamepad = new VirtualGamepad({
          container: this.virtualGamepad,
          groups: NES_GROUPS,
          onButton: ({button,pressed}) => this._dispatchButton(button,pressed)
        });
        container.appendChild(this.virtualGamepad);
        this.emuWrapper.appendChild(container);

        this.controlsDiv.style.display='flex';
        this.virtualGamepad.style.display='flex';
        this.loaded=true;
        this.statusText.textContent='🎮 ROM loaded • 🔊 Audio ON';
        this._applyOrientation();
      }catch(e){ this.statusText.textContent='Error: '+e.message; }
    }

    // Kirim keyboard event ke canvas (cara yang TERBUKTI berfungsi)
    _dispatchButton(btn, pressed) {
      if (!this.canvas) return;
      const key = BTN_TO_KEY[btn];
      if (!key) return;
      const eventType = pressed ? 'keydown' : 'keyup';
      const event = new KeyboardEvent(eventType, {
        key: key,
        code: key,
        keyCode: this._keyCode(key),
        which: this._keyCode(key),
        bubbles: true,
        cancelable: true
      });
      this.canvas.dispatchEvent(event);
    }

    _keyCode(key) {
      const map = {
        'ArrowUp':38, 'ArrowDown':40, 'ArrowLeft':37, 'ArrowRight':39,
        'x':88, 'z':90, 'a':65, 's':83,
        'Enter':13, 'Shift':16,
        'q':81, 'w':87, 'e':69, 'r':82
      };
      return map[key] || 0;
    }

    _bindKeyboard() {
      window.addEventListener('keydown',e=>{
        if(!this.loaded||!this.canvas)return;
        // Keyboard fisik sudah ditangani oleh respondToGlobalEvents? Tidak, karena false.
        // Jadi kita harus meneruskan keyboard fisik ke canvas juga.
        const key = e.key;
        if (Object.values(BTN_TO_KEY).includes(key)) {
          e.preventDefault();
          // Teruskan event keyboard asli ke canvas
          const event = new KeyboardEvent('keydown', {
            key: key, code: e.code, keyCode: e.keyCode, which: e.which,
            bubbles: true, cancelable: true
          });
          this.canvas.dispatchEvent(event);
          // Highlight tombol virtual
          const btn = Object.keys(BTN_TO_KEY).find(k => BTN_TO_KEY[k] === key);
          if (btn) this.gamepad?.highlight(btn, true);
        }
      });
      window.addEventListener('keyup',e=>{
        if(!this.loaded||!this.canvas)return;
        const key = e.key;
        if (Object.values(BTN_TO_KEY).includes(key)) {
          e.preventDefault();
          const event = new KeyboardEvent('keyup', {
            key: key, code: e.code, keyCode: e.keyCode, which: e.which,
            bubbles: true, cancelable: true
          });
          this.canvas.dispatchEvent(event);
          const btn = Object.keys(BTN_TO_KEY).find(k => BTN_TO_KEY[k] === key);
          if (btn) this.gamepad?.highlight(btn, false);
        }
      });
    }

    _bindOrientationChange() {
      const fn=()=>this._applyOrientation();
      window.addEventListener('resize',fn);
      window.addEventListener('orientationchange',()=>setTimeout(fn,150));
    }

    _applyOrientation() {
      const c=this.emuWrapper.querySelector('.emu-container'); if(!c)return;
      const isPortrait=window.innerHeight>window.innerWidth;
      c.classList.toggle('portrait-layout',isPortrait);
      c.classList.toggle('landscape-layout',!isPortrait);
    }

    stop() {
      if(this.nostalgist){try{this.nostalgist.exit();}catch(_){} this.nostalgist=null;}
      this.emuWrapper.innerHTML='';
      this.controlsDiv.style.display='none';
      this.virtualGamepad.style.display='none';
      this.dropZone.style.display='';
      if(this.subtitle) this.subtitle.style.display='';
      this.statusText.textContent='Emulator stopped.';
      this.loaded=false; this.canvas=null;
    }

    reset() {
      if(this.nostalgist){ this.nostalgist.restart(); this.statusText.textContent='🔄 Reset.'; }
    }

    toggleFullscreen() {
      if(!document.fullscreenElement && !document.webkitFullscreenElement)
        (this.emuWrapper.requestFullscreen||this.emuWrapper.webkitRequestFullscreen)?.call(this.emuWrapper);
      else (document.exitFullscreen||document.webkitExitFullscreen)?.call(document);
      setTimeout(()=>this._applyOrientation(),300);
    }
  }

  window.addEventListener('DOMContentLoaded',()=>{ window.nesEmulator=new NESEmulator(); });
})();
