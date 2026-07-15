/**
 * 🎨 GESTOR DE PERSONALIZACIÓN (CLIENTE)
 * Consume la API de preferencias de usuario y aplica estilos/configuraciones.
 */

const Personalization = {
    state: {
        username: null,
        preferences: null
    },

    /**
     * Inicializa el sistema de personalización
     * @param {string} username - Nombre del usuario actual
     * @param {object} socket - Instancia de Socket.io (opcional, para tiempo real)
     */
    init: async function(username, socket) {
        if (!username) return;
        this.state.username = username;
        this.socket = socket;
        
        // Escuchar actualizaciones en tiempo real desde otros dispositivos/sesiones
        if (this.socket) {
            this.socket.on('preferences_updated', (prefs) => {
                console.log('🔄 Preferencias actualizadas remotamente');
                this.applyPreferences(prefs);
            });
        }

        await this.loadPreferences();
    },

    /**
     * Carga las preferencias desde el servidor
     */
    loadPreferences: async function() {
        if (!this.state.username) return;

        try {
            const response = await fetch(`/api/user-preferences/${this.state.username}`);
            if (response.ok) {
                const prefs = await response.json();
                this.applyPreferences(prefs);
            }
        } catch (error) {
            console.error('❌ Error cargando preferencias:', error);
        }
    },

    /**
     * Guarda actualizaciones de preferencias en el servidor
     * @param {object} updates - Objeto con las propiedades a actualizar
     */
    savePreferences: async function(updates) {
        if (!this.state.username) return;

        try {
            const response = await fetch(`/api/user-preferences/${this.state.username}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            
            if (response.ok) {
                const prefs = await response.json();
                this.applyPreferences(prefs); // Aplicar cambios inmediatamente
                return prefs;
            }
        } catch (error) {
            console.error('❌ Error guardando preferencias:', error);
        }
    },

    /**
     * Aplica todas las configuraciones visuales y funcionales
     */
    applyPreferences: function(prefs) {
        this.state.preferences = prefs;

        // 1. Aplicar Tema Visual
        this.applyTheme(prefs.theme);

        // 2. Aplicar Accesibilidad
        this.applyAccessibility(prefs.accessibility);
        this.applyColorBlindMode(prefs.colorBlindMode);
        this.applyFontSize(prefs.fontSize);

        // 3. Aplicar Layout de Cartones
        this.applyCardLayout(prefs.cardLayout);

        // 4. Configurar Sonido (Integración con sistema de audio global si existe)
        if (window.bingoAudio && typeof window.bingoAudio.setProfile === 'function') {
            window.bingoAudio.setProfile(prefs.soundProfile);
        }

        console.log('✨ Preferencias aplicadas:', prefs);
    },

    applyTheme: function(theme) {
        // Establece el atributo data-theme en el elemento HTML raíz
        document.documentElement.setAttribute('data-theme', theme || 'dark');
        localStorage.setItem('yovanny_theme', theme);
    },

    applyAccessibility: function(acc) {
        if (!acc) return;
        if (acc.highContrast) document.body.classList.add('high-contrast');
        else document.body.classList.remove('high-contrast');
    },

    applyColorBlindMode: function(enabled) {
        if (enabled) document.body.classList.add('color-blind-mode');
        else document.body.classList.remove('color-blind-mode');
    },

    applyFontSize: function(size) {
        const sizes = { small: '14px', medium: '16px', large: '18px', xlarge: '20px' };
        document.documentElement.style.setProperty('--base-font-size', sizes[size] || '16px');
    },

    applyCardLayout: function(layout) {
        const container = document.getElementById('cards-container');
        if (container) {
            // Elimina clases anteriores de layout
            container.classList.remove('layout-grid', 'layout-list', 'layout-compact', 'layout-carousel');
            container.classList.add(`layout-${layout || 'grid'}`);
        }
    }
};

// Exponer al ámbito global
window.Personalization = Personalization;