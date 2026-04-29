// data/js/virtual-gamepad.js

/**
 * VirtualGamepad – reusable touch/mouse gamepad for emulators.
 *
 * Usage:
 *   const gamepad = new VirtualGamepad({
 *       containerSelector: '#virtualGamepad',
 *       buttonActions: {
 *           up:    { down: () => ..., up: () => ... },
 *           down:  { down: () => ..., up: () => ... },
 *           left:  { down: () => ..., up: () => ... },
 *           right: { down: () => ..., up: () => ... },
 *           a:     { down: () => ..., up: () => ... },
 *           b:     { down: () => ..., up: () => ... },
 *           start: { down: () => ..., up: () => ... },
 *           select:{ down: () => ..., up: () => ... }
 *       }
 *   });
 */
class VirtualGamepad {
    constructor({ containerSelector, buttonActions }) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            console.warn(`VirtualGamepad: container not found (${containerSelector})`);
            return;
        }
        this.buttonActions = buttonActions || {};
        this.activeButtons = new Set();

        this.buttons = this.container.querySelectorAll('.gamepad-btn');
        this.buttons.forEach(btn => {
            const dataBtn = btn.dataset.btn;
            if (!dataBtn || !this.buttonActions[dataBtn]) return;

            const press = (e) => {
                e.preventDefault();
                if (this.activeButtons.has(dataBtn)) return;
                this.activeButtons.add(dataBtn);
                btn.classList.add('active');
                if (this.buttonActions[dataBtn].down) {
                    this.buttonActions[dataBtn].down();
                }
            };

            const release = (e) => {
                e.preventDefault();
                if (!this.activeButtons.has(dataBtn)) return;
                this.activeButtons.delete(dataBtn);
                btn.classList.remove('active');
                if (this.buttonActions[dataBtn].up) {
                    this.buttonActions[dataBtn].up();
                }
            };

            btn.addEventListener('pointerdown', press);
            btn.addEventListener('pointerup', release);
            btn.addEventListener('pointerleave', release);
        });
    }

    /** Force release all buttons. */
    releaseAll() {
        this.activeButtons.forEach(dataBtn => {
            const btn = this.container.querySelector(`[data-btn="${dataBtn}"]`);
            if (btn) btn.classList.remove('active');
            if (this.buttonActions[dataBtn]?.up) {
                this.buttonActions[dataBtn].up();
            }
        });
        this.activeButtons.clear();
    }

    show() {
        if (this.container) this.container.style.display = 'flex';
    }

    hide() {
        if (this.container) this.container.style.display = 'none';
    }
}
