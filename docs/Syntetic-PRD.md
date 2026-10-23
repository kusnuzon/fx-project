# PRD & Mekanisme — `tools/fx-tools/Syntetic.html`

Lab tick + digit untuk **Deriv Volatility 75 (1s)** — simbol `1HZ75V`.
Dokumen ini disusun dari pembacaan dua file referensi di `tools/other-tools/`:
`OtherstDummy.html` (AstroDox-FX) dan `OtherDummyer.html` (CEBONK ASTRODOX · XAUUSD).

Versi dokumen: 1.0 · 2026-10-23 · status implementasi: v1 sudah live, dokumen ini
menjadi acuan revisi berikutnya.

---

## 1. Apa yang dipelajari dari dua dummy

### 1.1 `OtherstDummy.html` — AstroDox-FX (51 KB, 1.402 baris)

**Tentang apa.** Kalkulator astrologi statis untuk 8 pair (XAUUSD, XAGUSD, 6 forex).
Keluarannya satu keputusan per pair per hari: **arah tunggal (BUY/SELL)**, aspek pemicu,
jendela waktu di Luxor (UTC+3), jam entry/exit dalam WIB (UTC+7), dan durasi.
Sama sekali tidak memakai harga pasar — murni ephemeris langit.

**Logic-nya (5 modul berurutan).**

1. `CONFIG_SSOT` — objek `Object.freeze` berisi lokasi (Luxor 25.6872 N / 32.6396 E),
   offset zona waktu (+3 / +7, selisih 4 jam), 10 planet dengan `nature`, `avgSpeed`, `orb`,
   5 aspek dengan `harmony` + `weight`, dan 8 pair dengan `baseRulers`, `quoteRulers`,
   `orbFactor`, `phaseShift`.
2. `MathUtil` / `TimeUtil` — normalisasi 360°, selisih sudut terpendek, format DMS,
   konversi UTC ↔ offset, format durasi.
3. `EphemerisCore` — Astronomy Engine dari CDN (`astronomy.browser.min.js` 2.1.19).
   `GeoVector → Ecliptic` untuk bujur geosentris; ASC/MC dihitung dari sidereal time +
   obliquity (`Rotation_ECT_EQD`) dan lintang Luxor; ada fallback Meeus bila library gagal.
4. `ForecastEngine` — inti keputusan:
   - bangun grid 1 hari dengan **step 15 menit** (96+1 sampel), plus snapshot jam 12:00;
   - **skor bias harian**: retrograde (−), kecepatan di atas `avgSpeed` (+),
     arah deklinasi (+/−), penguasa base berbobot 1,8/1,1, penguasa quote sebagai penekan;
   - **deteksi aspek exact**: cari lokal-minimum atau zero-cross selisih sudut terhadap
     sudut aspek, toleransi < 2,4°, lalu **interpolasi linear ke tingkat menit**;
   - **kekuatan event** = polaritas aspek × posisi (base vs quote) × bobot planet ×
     bobot aspek × `1/(1+error)`;
   - **durasi jendela** = orb efektif ÷ kecepatan relatif (°/jam), di-clamp 115–265 menit;
   - `phaseShift` memberi offset 3 menit per pair supaya jam antar pair tidak identik;
   - arah final = tanda skor; lalu **pilih event terkuat yang searah** dengan arah itu
     (bukan event terkuat keseluruhan).
5. `UIController` — render 3 tabel (forecast 7 hari, matriks semua pair, ephemeris
   verifikasi), binding DOM aman (tanpa `innerHTML` dari data tak tepercaya), toast.

**Pola yang layak diadopsi.**
- Satu **SSOT** beku untuk semua konstanta; tidak ada angka sihir tersebar.
- **Pemisahan tegas**: mesin hitung murni (bisa `module.exports`, bisa dites) vs lapisan render.
- **Grid waktu + interpolasi** untuk mengubah sampel kasar menjadi timestamp presisi.
- **Disiplin satu arah**: satu bias per periode, event hanya dipakai bila searah.
- **Dua zona waktu ditampilkan berdampingan** (sumber data vs eksekusi).
- Jam dan tanggal selalu diformat dari epoch + offset, tidak pernah dari string bebas.

**Kelemahan yang jangan ditiru.**
- 100% bergantung CDN → offline mati total, dan CSP harus mengizinkan jsdelivr.
- Tidak ada penanganan data hilang/gap, tidak ada status koneksi, tidak ada persistensi.
- Klaim arah tidak divalidasi statistik apa pun (tidak ada backtest, tidak ada CI).
- Tidak ada mekanisme "data tidak tersedia" selain tabel kosong.

### 1.2 `OtherDummyer.html` — CEBONK ASTRODOX · XAUUSD (1 MB, 8.317 baris)

**Tentang apa.** Dashboard riset astrologi untuk XAUUSD dengan banyak mode dalam satu file:
Astrologi, Al-Biruni, Follow Trend, Kill Zone, Solar Return, Fase Bulan, Swing Harian,
BaZi, Astrology News, analisis per candle M1, polaritas event, dan audit REV-01.

**Logic-nya.**
- Library **di-embed inline** (Astronomy Engine 2.1.19 + lunar-javascript 1.7.7) sebagai
  jalur utama offline, dengan loader CDN hanya sebagai cadangan.
- `CFG` di-`freeze` rekursif; seluruh perhitungan lewat `CebonkCore` yang diekspos ke
  `window` (dan `module.exports` untuk Node).
- `createEngine(A)` menyimpan cache posisi per timestamp (planet + ASC/MC + deklinasi +
  sidereal time), jadi satu titik grid dihitung sekali saja.
- `scan()` berjalan pada **grid 5 menit** untuk 1 hari, dengan `yield setTimeout(0)` tiap
  8 slot agar UI tidak membeku, progress bar, dan flag pembatalan.
- `analyse(prev, now, next)` → daftar aspek aktif (orb), kecepatan planet °/hari,
  skor legacy; `classify()` → `BUY / SELL / TRANSITION / NEUTRAL / DATA`.
- `segments()` menggabungkan slot berlabel sama menjadi blok timeline (semua interval
  dipertahankan, tidak ada yang dibuang); `longestWindow()` memilih jendela terpanjang
  yang searah dan terkuat.
- Render: tab view, panel dengan `.head` (judul + aksi), kartu metrik, tabel mentah,
  klik baris → inspector ephemeris, ekspor CSV, salin ringkasan, `aria-live` status,
  indikator **stale** saat parameter berubah tapi belum dihitung ulang.

**Pola yang layak diadopsi.**
- **Offline-first**: dependensi di-embed, bukan CDN. Ini yang membuat file tetap hidup
  walau jaringan buruk — relevan untuk HP Master.
- **Anti-fabrikasi**: state `DATA` eksplisit, empty state yang jujur, pesan error
  menjelaskan sebab, tidak pernah mengisi angka karangan saat library gagal.
- **UI shell** yang konsisten: tab, panel, kartu metrik, tabel, aksi per panel.
- **Kinerja**: cache per timestamp, throttle render, kerja berat dipecah per batch.
- **Integritas deret waktu**: setiap interval dipertahankan; penyaringan hanya untuk
  tampilan, bukan untuk perhitungan.
- **Fallback aksi**: bila clipboard diblokir, sediakan textarea salin manual.

**Kelemahan yang jangan ditiru.**
- 1 MB karena wallpaper base64 menempel di CSS → berat dibuka di HP, (sudah tercatat juga
  di memori: OtherDummyer 1,04 MB).
- Banyak panel saling tumpang tindih secara konsep; pengguna baru sulit tahu harus lihat
  yang mana.
- Tidak ada lapisan data eksternal realtime; seluruhnya perhitungan offline.
- Beberapa modul memakai `innerHTML` dengan template string panjang — rapuh saat diubah.

### 1.3 Ringkasan: yang diadopsi ke Syntetic.html

| Pola | Sumber | Dipakai di Syntetic.html |
|---|---|---|
| SSOT beku (`CFG`/`S`) | keduanya | ya — `S` state + konstanta tema/simbol |
| Mesin hitung murni vs render | keduanya | ya — `computeStats`, `chiSquare`, `EV` terpisah dari `render*` |
| Grid waktu + bucket | Dummyer | ya — agregasi tick → 5s/15s/1m/5m |
| Cache & throttle render | Dummyer | ya — `scheduleRender()` + rAF |
| Offline-first (tanpa CDN) | Dummyer | ya — canvas tangan, tanpa pustaka eksternal |
| Anti-fabrikasi / state data | Dummyer | ya — mode LIVE vs SIMULASI berlabel, "—" saat data kurang |
| Disiplin satu-bias + pilih yang searah | OtherstDummy | tidak relevan (Syntetic tidak memprediksi arah) |
| Dua zona waktu | OtherstDummy | ya — waktu tick server (epoch) + jam lokal |
| Ekspor CSV, salin ringkasan | keduanya | ya — CSV tick + digit |
| Amankan DOM dari data liar | keduanya | ya — `textContent`, angka diformat sebelum masuk DOM |
| Wallpaper base64 / tema glass | Dummyer | **ditolak** — berat, tidak perlu |
| Panel bertumpuk tanpa hierarki | Dummyer | **ditolak** — Syntetic memakai urutan bernomor 01–08 |

---

## 2. Mekanisme Syntetic.html

### 2.1 Arsitektur (6 lapisan, satu file)

```
┌─────────────────────────────────────────────────────────────┐
│ L6 Shell      : prefs localStorage, status, toast, ekspor   │
├─────────────────────────────────────────────────────────────┤
│ L5 Render     : canvas chart, chip digit, tabel, kartu      │
├─────────────────────────────────────────────────────────────┤
│ L4 Analytics  : digit, distribusi+χ², CI, streak, EV, σ     │
├─────────────────────────────────────────────────────────────┤
│ L3 Store      : ring buffer tick {t,q,d,dir}, maks 6000     │
├─────────────────────────────────────────────────────────────┤
│ L2 Feed       : WebSocket Deriv + fallback simulasi         │
├─────────────────────────────────────────────────────────────┤
│ L1 Config     : simbol, pip, app_id, preferensi, konstanta  │
└─────────────────────────────────────────────────────────────┘
```

Aturan dependensi: lapisan atas boleh membaca lapisan bawah, **tidak sebaliknya**.
L4 tidak menyentuh DOM; L5 tidak menghitung statistik; L2 tidak tahu ada chart.

### 2.2 Alur data satu tick

```
WS message (tick)
  → validasi {symbol, epoch, quote} dan pip_size
  → normalisasi harga ke jumlah desimal simbol
  → digit = karakter terakhir dari harga terformat
  → dir = tanda(q - q_sebelumnya)
  → push {t, q, d, dir} ke ring buffer (buang tertua bila > 6000)
  → invalidate cache statistik
  → scheduleRender()  (maks 1 render per frame)
```

`loadHistory()` mengisi buffer yang sama (bukan jalur terpisah), supaya semua angka
setelah reconnect tetap dihitung dengan rumus yang identik.

### 2.3 State machine koneksi

```
        ┌──────────┐  tombol Hubungkan   ┌────────────┐
        │  IDLE    │────────────────────>│ CONNECTING │
        └──────────┘                     └─────┬──────┘
             ▲                                 │ onopen
             │ Putuskan                        ▼
        ┌────┴─────┐   gagal/timeout 7 dtk ┌──────────┐
        │ CLOSED   │<──────────────────────│  LIVE    │
        └──────────┘                       └────┬─────┘
             ▲                                  │ close/error
             │                                  ▼
        ┌────┴──────┐   retry (1,2,4,8,15 s) ┌──────────┐
        │ FALLBACK  │<───────────────────────│ RETRYING │
        │ (simulasi)│                        └──────────┘
        └───────────┘
```

- Label mode **selalu** terlihat: `LIVE · 1HZ75V` hanya bila tick asli Deriv sudah masuk;
  `SIMULASI` diberi warna berbeda dan teks penjelasan; tidak pernah menyamar.
- Timeout handshake 7 detik → masuk FALLBACK, bukan menunggu selamanya.
- Backoff maksimum 15 detik, tidak pernah lebih agresif dari itu (hindari banjir request).
- Setelah 3 kegagalan beruntun, tidak ada retry otomatis lagi; pengguna yang menekan tombol.

### 2.4 Kontrak data Deriv (yang dipakai)

| Request | Fungsi | Field yang dibaca |
|---|---|---|
| `active_symbols` | daftar simbol synthetic + pip | `display_name`, `symbol`, `market`, `submarket`, `pip`, `exchange_is_open` |
| `ticks_history` | isi awal buffer | `history.prices[]`, `history.times[]`, `pip_size` |
| `ticks` (subscribe) | stream tick | `tick.quote`, `tick.epoch`, `tick.symbol`, `tick.pip_size` |
| `ping` | latensi | `ping` (echo) |

- Endpoint: `wss://ws.derivws.com/websockets/v3?app_id=<id>` (default `1089`).
- `app_id` dapat diubah pengguna (disimpan di localStorage) untuk menghindari limit.
- Angka JSON kehilangan nol di belakang → **digit wajib** dihitung dari harga yang
  diformat dengan `pip_size` (fallback `pip` dari `active_symbols`, fallback default 2/3/4).

### 2.5 Sampling & timeframe

| Timeframe | Bucket | Catatan |
|---|---|---|
| Tick | per tick | 1 titik = 1 tick |
| 5s / 15s | `floor(epoch/tf)*tf` | candle OHLC dari tick dalam bucket |
| 1m / 5m | idem | jumlah candle dibatasi 2000 terakhir |

Sumbu waktu memakai `epoch` server, bukan `Date.now()` perangkat, supaya tidak melenceng
saat jam HP salah. Jam lokal hanya dipakai untuk label "waktu Anda".

### 2.6 Statistik (L4) — rumus yang mengikat

- **Digit** = digit terakhir harga terformat; `0..9` untuk Volatility 75 (1s).
- **Distribusi**: hitung frekuensi per digit pada jendela aktif (5/10/20/50/100/200/all).
- **χ²**: `Σ (O−E)²/E`, `E = n/10`, `df = 9`; p-value lewat fungsi gamma tak lengkap
  (series + continued fraction), bukan tabel hardcode.
- **Confidence interval** proporsi: Wilson 95% (`z = 1,96`), bukan normal naive —
  tetap masuk akal saat n kecil.
- **Streak**: run terakhir, run terpanjang, tabel run ke belakang (dengan warna per digit).
- **EV / martingale**: `EV = p·payout − (1−p)·stake`; kalkulator menampilkan modal
  kumulatif, tingkat penggandaan, dan peringatan bila EV negatif.
- **Volatilitas**: `σ` perubahan log per tick, `σ·√60` (per menit), ATR-14 harga,
  rezim `σ60/σ300` (mengembang / normal / mengempis), posisi harga dalam rentang jendela,
  dan ekspektasi gerak `q·σ·√10`.
- Semua fungsi statistik **deterministik**: input sama → output sama; tidak ada
  pembulatan yang mengubah klasifikasi.

### 2.7 Kinerja & batas

| Parameter | Nilai | Alasan |
|---|---|---|
| Buffer tick | 6000 (`MAX_TICKS`) | ~100 menit pada 1 tick/detik, cukup untuk chart & jendela 500 |
| Render | ≤ 1 per frame (`requestAnimationFrame`) | hemat baterai |
| Canvas | device pixel ratio, digambar ulang penuh | sederhana, cukup untuk 2000 candle |
| Histori awal | 1500 tick (`HISTORY_COUNT`) | chart langsung terisi tanpa membanjiri memori |
| CSV | dibangun saat diminta | tidak menyimpan string besar di memori |
| Ukuran file | < 250 KB (237 KB aktual) | satu file; 116 KB di antaranya ephemeris inline |
| Hitung astro (24 jam, 10 benda, grid 10 menit) | ±0,5–0,7 s sekali di awal, lalu tiap 10 menit | 1.440 panggilan `GeoVector` + bisection; tidak di jalur render tick |

### 2.8 Peta kegagalan

| Kejadian | Perilaku |
|---|---|
| WS diblokir / handshake 520 | timeout 7 s → FALLBACK simulasi berlabel, tombol Hubungkan tetap aktif |
| `app_id` kena limit | pesan error spesifik + saran ganti app_id |
| Simbol tutup (`exchange_is_open = 0`) | peringatan, data tetap boleh tampil bila ada |
| `pip_size` tidak dikirim | pakai `pip` dari `active_symbols`, lalu tebakan desimal |
| Tick gap (reconnect) | chart diberi penanda celah; statistik dihitung dari data yang ada |
| Buffer penuh | tick tertua dibuang, bukan menolak tick baru |
| localStorage penuh/diblokir | prefs diabaikan, aplikasi tetap berjalan |

### 2.9 Modul Time Astro (presisi waktu)

Tujuan: menjawab "kapan tepatnya" — bukan menampilkan candle. Semua waktu dihitung
dari satu basis waktu, lalu ditampilkan dalam WIB (UTC+7).

**Basis waktu**

| Kondisi | Sumber | Label UI |
|---|---|---|
| Tersinkron | `{"time":1}` → `time` (epoch detik). `offset = serverMs + RTT/2 − Date.now()` | `waktu server Deriv` |
| Belum/tidak pernah sync | jam perangkat | `waktu lokal` |

- Request `time` dikirim saat socket terbuka dan diulang tiap 60 s (channel yang sama
  dengan `ping`, tanpa langganan tambahan).
- Offset disimpan di `window.SYNTETIC_CLOCK`; modul astro memanggil `now()` setiap render,
  jadi kalibrasi langsung berlaku tanpa reload.
- Tabel menampilkan selisih jam perangkat ↔ server (ms) sebagai bukti kalibrasi.

**Ephemeris**

- Astronomy Engine 2.1.19 (MIT, 116 KB) **di-embed inline** — tidak ada CDN, halaman
  tetap berfungsi offline.
- 10 benda: Matahari, Bulan, Merkurius, Venus, Mars, Jupiter, Saturnus, Uranus,
  Neptunus, Pluto; posisi geosentris ekliptika (`GeoVector` → `Ecliptic`).
- 5 aspek: konjungsi 0°, seksil 60°, kudrat 90°, trigon 120°, oposisi 180°.

**Algoritma aspek exact**

1. Sampling grid 10 menit selama 24 jam ke depan (145 titik × 10 benda).
2. Tiap pasangan (45) × tiap aspek (5) dihitung `err = signed(Δλ − sudut)`.
   Crossing dideteksi saat tanda berubah, dengan penjaga `|err| < 40°` supaya
   lompatan wrap ±180° tidak dianggap aspek.
3. Waktu exact diperhalus dengan **bisection 34 iterasi** sampai `|err| < 0,00035°`
   (≈1,3 detik busur). Verifikasi independen: galat pada waktu yang dilaporkan
   ≈0,0001–0,0003°.
4. Kolom **±m** = perkiraan galat waktu dari kecepatan relatif (`0,02° ÷ |d(err)/dt|`),
   karena galat posisi mesin (±1′ untuk planet) berubah menjadi galat waktu yang
   berbeda-beda: Bulan/Merkurius ±1–3 menit, planet luar bisa jam-jaman.
5. Aspek yang masih aktif (orb ≤ 2°) tetapi exact-nya di luar jendela 24 jam tetap
   ditampilkan dengan label `aktif`.

**Bagian lain**

| Bagian | Rumus/sumber | Bergantung lokasi? |
|---|---|---|
| Fase bulan + iluminasi + umur | `MoonPhase`, `Illumination`, umur = fase/360 × 29,530588 | tidak |
| Bulan di zodiak | λ Bulan ÷ 30 | tidak |
| Retrograde | `signed(λ(t+12j) − λ(t)) < 0` (kecuali Matahari/Bulan) | tidak |
| ASC / MC | GMST (Meeus) → LST → `atan2` dengan obliquity & lintang | ya |
| Jam planet | 12 jam siang (terbit–terbenam) + 12 jam malam, urutan Chaldean, penguasa hari dari hari terbit | ya |
| Fase & node berikutnya | `SearchMoonPhase(0/90/180/270, 40 hari)`, `SearchMoonNode` | tidak |
| Timeline 24 jam | canvas: garis sekarang + penanda tiap aspek | tidak |

Lokasi preset: Jakarta, Luxor, London, New York, Ekuator (0,0). Pilihan disimpan di
`localStorage` (`syntetic.v1.astroLoc`).

**Anti-fabrikasi**

- Tidak ada angka "—" yang diisi tebakan: bila ephemeris gagal, pil berubah
  `ephemeris gagal` dan tabel kosong.
- Aspek tidak pernah diklaim sebagai sinyal entry; hanya waktu geometris.

**Grafik candle** tidak dihapus, tetapi **dilipat default** (`chartBody.is-hidden`,
tombol `Tampilkan grafik`, preferensi `syntetic.v1.showChart`) supaya tampilan pertama
adalah waktu, bukan candle.

---

## 3. PRD

### 3.1 Latar belakang

Trader sintetis Deriv perlu alat yang jujur: melihat tick apa adanya, mengukur apakah
distribusi digit masih wajar, dan menghitung ekspektasi biaya strategi digit —
tanpa klaim sinyal. Alat sejenis di internet umumnya menampilkan "prediksi" tanpa
dasar statistik, atau bergantung pada CDN yang sering gagal di jaringan seluler.

### 3.2 Tujuan

1. Menyediakan lab tick + digit untuk Volatility 75 (1s) yang **berjalan offline** setelah
   file dibuka (kecuali feed Deriv itu sendiri).
2. Menampilkan bukti statistik (χ², CI, streak) agar pengguna bisa menilai sendiri apakah
   pola yang terlihat berarti.
3. Menjadi contoh pola "single-file tool" untuk `tools/fx-tools/` lainnya.

**Metrik sukses**

| Metrik | Target |
|---|---|
| Error konsol saat smoke test | 0 |
| Overflow horizontal di 390/620/1280 px | tidak ada |
| Waktu interaktif pertama (file lokal, HP) | < 1,5 s |
| Aspek exact galat sudut pada waktu yang dilaporkan | < 0,001° |
| Ukuran file | < 250 KB |
| Angka "—" saat data kurang dari minimum | selalu, tidak pernah angka palsu |

**Non-goals**

- Bukan pemberi sinyal / rekomendasi entry. Tidak ada tombol "beli".
- Tidak menyimpan atau mengirim data pengguna ke server mana pun.
- Tidak melakukan order ke Deriv (tidak memakai API trading).
- Tidak menjanjikan prediksi digit berikutnya.

### 3.3 Pengguna & skenario

| Pengguna | Kebutuhan | Skenario |
|---|---|---|
| Trader sintetis | lihat tick realtime + distribusi | buka halaman, hubungkan, amati 200 tick terakhir |
| Peneliti pola | uji apakah digit menyimpang dari uniform | andalkan χ² dan p-value, bukan mata |
| Pengguna jaringan buruk | tetap bisa belajar | fallback simulasi berlabel, semua fitur tetap jalan |
| Pengguna mobile | satu tangan | kontrol besar, tanpa hover-dependent UI |

### 3.4 Lingkup

| Fase | Isi |
|---|---|
| **v1 (selesai)** | koneksi + fallback, chart 5 timeframe + SMA20 + BB, aliran digit, ringkasan pasar, distribusi + χ², streak + tabel run, kalkulator EV/martingale, volatilitas, CSV, prefs |
| **v1.1 (usulan)** | panel "kualitas data" (uptime, gap, latensi), perbandingan 2 simbol berdampingan, auto-reconnect dengan indikator hitung mundur, ekspor JSON, mode uji chi-square berbasis sampel acak pembanding |
| **v2 (usulan)** | replay tick dari CSV, penanda sesi/waktu, uji runs-test & autocorrelation, multi-jendela (bandingkan 100 vs 1000 tick), PWA opsional |

### 3.5 Fungsional & kriteria penerimaan

**F1 — Sumber data**
Panel berisi `app_id`, pilihan simbol (dari `active_symbols`, fallback daftar statis),
tombol Hubungkan/Putuskan, indikator status, dan log singkat.
*Terima:* mengganti simbol memutus feed lama, mengosongkan buffer, memperbarui merek
halaman, dan mengisi ulang histori; tidak ada tick simbol lama yang tersisa.

**F2 — Fallback simulasi**
Aktif otomatis setelah gagal, atau manual dengan `?sim=1`.
*Terima:* label dan warna berbeda dari LIVE; dijelaskan bahwa harga bukan Deriv;
pengguna bisa kembali ke live tanpa reload.

**F3 — Chart**
Canvas: mode tick & candle (5s/15s/1m/5m), overlays SMA20 + Bollinger, pan/zoom,
crosshair + tooltip, sumbu harga kanan.
*Terima:* tidak ada overflow; data < 2 titik menampilkan "menunggu data…";
resize mengikuti DPR.

**F4 — Aliran digit**
Chip 60 digit terakhir, warna per digit, penanda digit terbaru.
*Terima:* jumlah chip tepat 60 saat data cukup; arah naik/turun sesuai perubahan harga.

**F5 — Ringkasan pasar**
Harga terakhir, perubahan, rentang jendela, jumlah tick, latensi, waktu tick.
*Terima:* semua nilai berformat desimal simbol; "—" saat belum ada data.

**F6 — Distribusi digit**
Bar 0–9 + frekuensi, garis ekspektasi 10%, χ², df, p-value, CI Wilson per digit.
*Terima:* jumlah frekuensi = jumlah tick jendela; p-value ∈ [0,1]; jendela berubah
menghitung ulang tanpa reload.

**F7 — Streak & pola**
Run saat ini, run terpanjang, tabel run terakhir (digit, panjang, rentang waktu).
*Terima:* run dihitung dari jendela aktif yang sama dengan distribusi (konsisten).

**F8 — Kalkulator EV/risiko**
Input payout %, stake, probabilitas (manual atau dari frekuensi digit terpilih),
skenario martingale.
*Terima:* EV bertanda benar; peringatan muncul saat EV < 0; tidak ada klaim "pasti profit".

**F9 — Volatilitas**
σ per tick, proyeksi per menit, ATR-14, rezim σ60/σ300, posisi harga dalam rentang.
*Terima:* σ = 0 tidak menghasilkan `NaN`/`Infinity`; label rezim punya ambang eksplisit.

**F10 — Ekspor**
CSV tick (waktu, harga, digit, arah) + tombol salin ringkasan.
*Terima:* file terunduh di Android Chrome; isi sesuai buffer; nama file memuat simbol
dan tanggal.

**F11 — Preferensi**
Simbol, app_id, jendela, timeframe, overlay, tema disimpan di localStorage.
*Terima:* reload memulihkan pilihan; data rusak/kosong tidak membuat halaman gagal.

**F13 — Time Astro (presisi waktu)**
Panel waktu: jam WIB/UTC/drift, aspek exact 24 jam + countdown, fase bulan, bulan di
zodiak, jam planet, ASC/MC, retrograde, fase & node berikutnya, timeline 24 jam.
*Terima:* semua jam memakai basis waktu server Deriv bila tersinkron (label berubah);
waktu exact aspek galat < 0,001°; mengganti lokasi hanya mengubah ASC/MC + jam planet;
`node --check` bersih; tidak ada overflow di 390/620/1280 px; grafik candle default
terlipat dan preferensinya pulih setelah reload.

**F12 — Dokumentasi & etika**
Bagian catatan: cara kerja, batas statistik, disclaimer bukan nasihat keuangan.

### 3.6 Non-fungsional

| Aspek | Aturan |
|---|---|
| Offline | tanpa CDN; ephemeris di-embed inline; hanya WS Deriv yang butuh jaringan |
| CSP | tidak boleh butuh `unsafe-eval`; inline script/style boleh (single file) |
| Aksesibilitas | kontras ≥ 4.5:1 untuk teks utama, tombol ≥ 44 px, `aria-live` untuk status |
| Responsif | grid 2 kolom ≥ 900 px, 1 kolom < 900 px; diuji 390/620/1280 |
| Bahasa | Indonesia, istilah teknis tetap Inggris bila lazim |
| Keamanan | tidak ada `innerHTML` dari data feed; tidak ada token/API key disimpan |
| Determinisme | simulasi memakai seed tetap agar bug bisa direproduksi |
| Presisi waktu | aspek geosentris dihitung ulang tiap 10 menit; countdown diperbarui 4×/detik |

### 3.7 Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| WS Deriv diblokir operator (HTTP 520) | tidak ada feed live | fallback berlabel + dokumentasi; uji di jaringan lain |
| `app_id` publik kena rate limit | koneksi ditolak | input app_id yang bisa diubah + pesan error jelas |
| Digit salah karena `pip_size` absen | seluruh statistik salah | resolusi pip 3 lapis + tampilkan desimal aktif di UI |
| p-value dianggap "prediksi" | salah tafsir | teks eksplisit: χ² mengukur penyimpangan, bukan arah berikutnya |
| Buffer besar di HP kelas bawah | lag | batas 6000 tick, render per frame, CSV on-demand |
| Jam perangkat salah | label waktu menyesatkan | `time` Deriv tiap 60 s + tampilkan drift; label `waktu lokal` bila belum sync |
| Galat ephemeris planet luar | waktu aspek meleset jam-jaman | kolom ±m per baris + catatan; angka tidak disembunyikan |
| Lokasi salah dipilih | ASC/MC & jam planet keliru | pemilih lokasi eksplisit + catatan bahwa aspek tidak bergantung lokasi |

### 3.8 Rencana uji & gerbang penerimaan

1. **Statis**: `node --check` pada blok skrip (diekstrak) → 0 error.
2. **Smoke Playwright** (`?sim=1`): 0 error konsol, 0 error halaman.
3. **Data**: setelah ±60 tick → 60 chip, ≥ 10 bar distribusi, semua metrik terisi,
   total frekuensi = jumlah tick.
4. **Interaksi**: ganti simbol, ganti timeframe, pan/zoom, ekspor CSV, putuskan,
   hubungkan ulang, reload (prefs pulih).
5. **Layout**: 390/620/1280 px → `scrollWidth <= clientWidth`.
6. **Fallback**: paksa gagal (`?sim=1` lalu putuskan) → label SIMULASI, fitur tetap jalan.
7. **Angka**: n < minimum → semua "—", tanpa `NaN` di DOM.
8. **Astro**: hitung ulang galat sudut pada setiap `ms` aspek yang dilaporkan → < 0,001°;
   ganti lokasi → ASC/MC berubah, baris aspek tetap; toggle grafik + reload → preferensi pulih.

### 3.9 Definition of Done

- Semua F1–F12 lulus kriteria penerimaan di 3 lebar layar.
- Tidak ada `console.error` / `pageerror` pada smoke test.
- Ukuran file < 250 KB, tanpa dependensi eksternal (ephemeris inline).
- Live URL GitHub Pages mengembalikan 200 dan merender identik dengan lokal.
- Catatan & disclaimer ada dan akurat.

---

## 4. Gap analysis: file sekarang vs PRD

| Butir | Status di `Syntetic.html` v1 | Tindakan |
|---|---|---|
| Kontrak data + resolusi pip 3 lapis | ada | — |
| Fallback simulasi berlabel | ada | — |
| Chart 5 TF + SMA/BB + pan/zoom | ada | — |
| Distribusi + χ² + CI Wilson | ada | — |
| Streak + tabel run | ada | — |
| EV/martingale | ada | — |
| Volatilitas + rezim | ada | — |
| CSV + prefs | ada | — |
| Time Astro (aspek exact, fase, jam planet, ASC/MC, sync jam Deriv) | ada | — |
| Grafik candle | ada, terlipat default | — |
| Panel kualitas data (uptime/gap/latensi) | **belum** | v1.1 |
| Rumah astrologi (12 house) & aspek asteroid | **belum** | v2 |
| Perbandingan 2 simbol | **belum** | v1.1 |
| Auto-reconnect dengan hitung mundur | **belum** (manual) | v1.1 |
| Ekspor JSON | **belum** | v1.1 |
| Replay CSV | **belum** | v2 |
| Runs-test / autocorrelation | **belum** | v2 |
| Uji multi-jendela berdampingan | **belum** | v2 |

---

## 5. Lampiran

**Simbol target.** `1HZ75V` — Volatility 75 (1s), 1 tick/detik, 2 desimal,
digit 0–9 dari digit terakhir harga. Simbol lain yang didukung lewat `active_symbols`
(mis. `1HZ10V`, `1HZ25V`, `1HZ100V`, `R_75`, dst).

**Berkas terkait**

| Berkas | Peran |
|---|---|
| `tools/fx-tools/Syntetic.html` | implementasi |
| `tools/fx-tools/trailing-stop-planner.html` | acuan gaya visual (tema navy/gold, kartu, metrik) |
| `tools/other-tools/OtherstDummy.html` | acuan SSOT + mesin murni + interpolasi |
| `tools/other-tools/OtherDummyer.html` | acuan UI shell + anti-fabrikasi + kinerja |
| `docs/Syntetic-PRD.md` | dokumen ini |

**Ephemeris.** Astronomy Engine 2.1.19, MIT, © 2019–2023 Don Cross
(https://github.com/cosinekitty/astronomy), disalin inline ke dalam file (116 KB) agar
tidak bergantung CDN. Akurasi bawaan: planet ±1′; waktu exact aspek mengikuti kecepatan
relatif (lihat kolom ±m).

**Referensi eksternal.** Deriv API docs (`developers.deriv.com/docs`), skema `ticks`,
`ticks_history`, `active_symbols`; uji χ² df 9; interval proporsi Wilson.
