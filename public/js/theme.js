/**
 * theme.js — Yovanny Bingo
 * Modo Claro / Oscuro universal.
 * Cargar con: <script src="/js/theme.js"></script>
 */
(function () {
    const KEY = 'yb_theme';
    const ICONS = { dark: '☀️', light: '🌙' };

    function getTheme() {
        return localStorage.getItem(KEY) || 'dark';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(KEY, theme);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) btn.textContent = ICONS[theme];
        // Also apply to lobby's shell if present (lobby has its own bg vars)
        document.querySelectorAll('.shell, .app-shell').forEach(el => {
            el.setAttribute('data-theme', theme);
        });
    }

    function toggle() {
        applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    function injectButton() {
        if (document.getElementById('theme-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'theme-toggle-btn';
        btn.className = 'theme-toggle-btn';
        btn.title = 'Cambiar tema claro/oscuro';
        btn.setAttribute('aria-label', 'Cambiar tema');
        btn.textContent = ICONS[getTheme()];
        btn.onclick = toggle;
        document.body.appendChild(btn);
    }

    // Apply immediately (before paint) to avoid flash
    applyTheme(getTheme());

    // Inject button after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectButton);
    } else {
        injectButton();
    }

    // Expose global
    window.YBTheme = { toggle, apply: applyTheme, get: getTheme };
})();
