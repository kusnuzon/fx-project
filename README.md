🕹️ CARTRIDGE VAULT

A modular retro toolbox — automatically organized, always up to date.

[Status: Alive] [Theme: Retro Pixel] [Tools: Auto Scan] [License: MIT]

---

Welcome to CARTRIDGE VAULT!

CARTRIDGE VAULT is a retro‑themed dashboard that automatically discovers and lists all your modular HTML tools — no manual editing required. Just drop a new tool into a category folder, push to GitHub, and it appears instantly.

The entire page is styled with a dark pixel‑art aesthetic inspired by classic game consoles: SNES, Game Boy, and GBA. Every tool inherits the same global theme, so everything looks cohesive right away.

---

✨ What Makes It Special

· 📂 Automatic Scanning
    Subfolders inside tools/ are detected via the GitHub API. No need to update any index file manually.
· 🎮 Retro Pixel Design
    Dark backgrounds, soft glowing text, subtle pixel grids, drifting stars, and a cartridge‑style layout that feels like a classic console menu.
· 🌐 Global Theme System
    One CSS file (data/css/retro-theme.css) controls the look of the dashboard and every single tool. You can change the entire appearance by editing just one file.
· 📱 Responsive & Touch‑Friendly
    Tools adapt to different screen sizes. The NES emulator even switches between portrait (Game Boy style) and landscape (GBA style) automatically.
· 🔌 Modular & Reusable
    Virtual gamepad logic is separated into data/js/virtual-gamepad.js and can be used by any future emulator you add.

---

🗂️ Project Structure

```
fx-project/
├── index.html                  ← Main dashboard
├── data/
│   ├── css/
│   │   └── retro-theme.css     ← Global theme
│   └── js/
│       └── virtual-gamepad.js  ← Reusable gamepad (optional)
└── tools/
    ├── fx-tools/
    │   ├── PipsCalc 1.0.html
    │   ├── PipsCalc 2.0.html
    │   └── fx-calendar.html
    ├── any-tools/
    │   └── unit-converter.html
    ├── other-tools/
    │   └── notes.html
    ├── retro-tools/
    │   └── color-palette.html
    └── emulator-tools/
        └── nes-emulator.html
```

Tip: To add a new tool category, just create a new folder inside tools/ and drop your HTML files there. The dashboard picks them up on the next visit.

---

🚀 Getting Started

1. Fork or clone this repository.
2. Enable GitHub Pages in your repo settings (use the main branch).
3. Make sure your repository is public (the automatic scan uses the unauthenticated GitHub API, which only works for public repos).
4. Visit https://{your-username}.github.io/{repo-name}/ to see your toolbox live.

---

🎨 Customization

· Colors & Fonts
    Edit data/css/retro-theme.css to change the entire color palette, font, and animations.
· Tool Categories
    Simply add or remove subfolders inside tools/. No code changes required.
· Dashboard Layout
    The dashboard styles are in the <style> block of index.html. You can tweak the cartridge grid, header animation, or scanlines there.
· Global Components
    Reusable scripts like the virtual gamepad live in data/js/. Any new tool can load them with a single <script> tag.

---

🧰 Tools Included

Tool Category Description
PipsCalc 1.0 fx-tools Calculate pip positions for XAUUSD
PipsCalc 2.0 fx-tools Advanced risk‑reward & lot calculator
FX Calendar & News fx-tools Live economic calendar & forex news
Unit Converter any-tools Convert pips, temperature, distance
Quick Notes other-tools Save persistent notes in the browser
Retro Color Palette retro-tools Click to copy classic console colors
NES Emulator emulator-tools Play NES games directly in the browser (supports .nes and .zip ROMs)

---

🖥️ Tech Stack

· HTML5, CSS3, JavaScript (vanilla) — No frameworks, no build tools.
· GitHub Pages for hosting.
· Nostalgist.js for accurate NES emulation.
· JSZip for extracting ROMs from ZIP files.
· GamepadZilla for touch‑screen virtual gamepad support.

---

🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the project
2. Add a new tool inside tools/
3. Create a pull request with a short description

Please keep the retro theme consistent by using the existing global CSS classes.

---

📜 License

This project is licensed under the MIT License — see the LICENSE file for details.

---

Powered by GitHub API • Designed with ♥ for retro lovers
