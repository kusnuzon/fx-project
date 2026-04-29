// data/js/nes-emulator.js
// DUKUNGAN .nes & .zip (rekursif) – .rar/.7z tidak didukung
(function() {
  const NES_GROUPS = {
    dpad: true,
    abxy: { buttons: ['x','a','b','y'], order: ['x','a','b','y'] },
    startselect: { buttons: ['start','select'] },
    l1l2: { buttons: ['l1','l2'] },
    r1r2: { buttons: ['r1','r2'] }
  };
  const BTN_TO_RETRO = {
    up:'up', down:'down', left:'left', right:'right',
    a:'a', b:'b', x:'x', y:'y',
    start:'start', select:'select',
    l1:'l', l2:'l2', r1:'r', r2:'r2'
  };

  class NESEmulator {
    constructor() {
      this.nostalgist = null;
      this.loaded = false;
      this.canvas = null;
      this.gamepad = null;
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
          const buf=ctx.createBuffer(1,1,ctx.sampleRate);
          const src=ctx.createBufferSource(); src.buffer=buf; src.connect(ctx.destination); src.start(0);
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
        const file = e.dataTransfer.files[0];
        if(file) this._handleFile(file);
      });
      this.dropZone.addEventListener('click',()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='.nes,.zip'; // hanya .nes & .zip
        inp.onchange=e=>{ if(e.target.files[0]) this._handleFile(e.target.files[0]); };
        inp.click();
      });
    }

    // Pencarian rekursif file .nes di dalam ZIP
    async _findROMInZip(zip) {
      const promises = [];
      const search = (obj, path='') => {
        if (obj.dir) {
          Object.keys(obj).forEach(key => search(obj[key], path+key+'/'));
        } else {
          if (obj.name && obj.name.toLowerCase().endsWith('.nes')) {
            promises.push(obj.async('uint8array').then(data => ({
              name: obj.name,
              data: data
            })));
          }
        }
      };
      search(zip.files);
      const results = await Promise.all(promises);
      return results.length > 0 ? results[0] : null; // ambil yang pertama
    }

    async _handleFile(file) {
      this.statusText.textContent='Processing file...';
      const name = file.name.toLowerCase();
      const EXT = name.includes('.') ? name.slice(name.lastIndexOf('.')+1) : '';

      try {
        if (EXT === 'nes') {
          const data = new Uint8Array(await file.arrayBuffer());
          await this.loadROM(data, file.name);
        } else if (EXT === 'zip') {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const rom = await this._findROMInZip(zip);
          if (!rom) throw new Error('No .nes file found inside ZIP');
          await this.loadROM(rom.data, rom.name);
        } else if (EXT === 'rar' || EXT === '7z') {
          throw new Error('Format .' + EXT + ' tidak didukung. Gunakan .nes atau .zip');
        } else {
          throw new Error('Format file tidak dikenal. Gunakan .nes atau .zip');
        }
      } catch (err) {
        this.statusText.textContent = 'Error: ' + err.message;
      }
    }

    async loadROM(romData, fileName) {
      this.stop();
      this.statusText.textContent='Loading emulator...';
      try {
        const romFile = new File([new Blob([romData], {type:'application/octet-stream'})], fileName||'game.nes');
        this.nostalgist = await Nostalgist.launch({
          core: 'fceumm',
          rom: romFile,
          retroarchConfig: {
            audio_enable: 'true',
            audio_out_rate: '44100',
            audio_latency: '64',
            video_smooth: 'false'
          },
          respondToGlobalEvents: false
        });
        this.canvas = this.nostalgist.getCanvas();
        this.canvas.classList.add('nes-emulator-canvas');
        this.canvas.style.position=''; this.canvas.style.top=''; this.canvas.style.left='';
        this.canvas.style.width=''; this.canvas.style.height='';

        this.dropZone.style.display='none';
        if(this.subtitle) this.subtitle.style.display='none';

        this.emuWrapper.innerHTML='';
        const container = document.createElement('div'); container.className='emu-container';
        container.appendChild(this.canvas);

        this.gamepad = new VirtualGamepad({
          container: this.virtualGamepad,
          groups: NES_GROUPS,
          onButton: ({button,pressed}) => this._pressButton(button,pressed)
        });
        container.appendChild(this.virtualGamepad);
        this.emuWrapper.appendChild(container);

        this.controlsDiv.style.display='flex';
        this.virtualGamepad.style.display='flex';
        this.loaded=true;
        this.statusText.textContent='🎮 ROM loaded • 🔊 Audio ON';
        this._applyOrientation();
      } catch(e) {
        this.statusText.textContent='Error loading ROM: ' + e.message;
      }
    }

    _pressButton(btn, pressed) {
      if (!this.nostalgist) return;
      const retroBtn = BTN_TO_RETRO[btn];
      if (retroBtn) {
        try {
          if (pressed) {
            this.nostalgist.pressButton(retroBtn, 0);
          } else {
            this.nostalgist.releaseButton(retroBtn, 0);
          }
        } catch(e) {}
      }
    }

    _bindKeyboard() {
      const keyToBtn = {
        'ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left','ArrowRight':'right',
        'z':'a','x':'b','a':'x','s':'y',
        'Enter':'start','Shift':'select',
        'q':'l1','w':'l2','e':'r1','r':'r2'
      };
      window.addEventListener('keydown', e => {
        if(!this.loaded) return;
        const btn = keyToBtn[e.key];
        if(btn){ e.preventDefault(); this.gamepad?.highlight(btn,true); this._pressButton(btn,true); }
      });
      window.addEventListener('keyup', e => {
        if(!this.loaded) return;
        const btn = keyToBtn[e.key];
        if(btn){ e.preventDefault(); this.gamepad?.highlight(btn,false); this._pressButton(btn,false); }
      });
    }

    _bindOrientationChange() {
      const fn = ()=>this._applyOrientation();
      window.addEventListener('resize',fn);
      window.addEventListener('orientationchange',()=>setTimeout(fn,150));
    }
    _applyOrientation() {
      const c = this.emuWrapper.querySelector('.emu-container');
      if(!c) return;
      const isPortrait = window.innerHeight > window.innerWidth;
      c.classList.toggle('portrait-layout', isPortrait);
      c.classList.toggle('landscape-layout', !isPortrait);
    }

    stop() {
      if(this.nostalgist){ try{this.nostalgist.exit();}catch(_){} this.nostalgist=null; }
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

  window.addEventListener('DOMContentLoaded',()=>{ window.nesEmulator = new NESEmulator(); });
})();
