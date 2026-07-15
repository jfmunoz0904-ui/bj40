/**
 * @file auth.js
 * @description Gestor de autenticación para producción. 
 * Centraliza la comunicación con la API de usuarios y gestiona efectos sonoros.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 🔊 Inicialización del Motor de Audio para Feedback Táctil
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    function playClickSound() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }

    // Vincular sonidos a todos los elementos interactivos
    document.querySelectorAll('button, .dashboard-card').forEach(el => {
        el.addEventListener('click', playClickSound);
    });

    /**
     * Procesa el inicio de sesión.
     * Exportado al objeto window para compatibilidad con los eventos onclick del HTML.
     */
    window.doLogin = async function() {
        const username = document.getElementById('auth-username')?.value.trim();
        const password = document.getElementById('auth-password')?.value;
        const errDisplay = document.getElementById('auth-error');

        if (!username || !password) {
            return showAuthError(errDisplay, '❌ Por favor, ingresa usuario y contraseña');
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                // Sincronización con el sistema de sesión global
                if (typeof window.saveSession === 'function') {
                    window.saveSession({ loggedIn: true, username: data.username });
                }
                document.getElementById('username').value = data.username;
                document.getElementById('username').readOnly = true;
                
                // Transición fluida a la pantalla de bienvenida personalizada
                window.showScreen('welcome-screen');
            } else {
                showAuthError(errDisplay, `🔑 ${data.error || 'Credenciales inválidas'}`);
            }
        } catch (err) {
            showAuthError(errDisplay, '📡 Error de red: No se pudo contactar con el servidor');
        }
    };

    /**
     * Procesa el registro de nuevos usuarios.
     */
    window.doRegister = async function() {
        const username = document.getElementById('reg-username')?.value.trim();
        const email = document.getElementById('reg-email')?.value.trim();
        const password = document.getElementById('reg-password')?.value;
        const errDisplay = document.getElementById('reg-error');

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (data.success) {
                alert('✨ ¡Cuenta creada! Ya puedes iniciar sesión.');
                window.showScreen('auth-login');
            } else {
                showAuthError(errDisplay, `⚠️ ${data.error || 'Error en el registro'}`);
            }
        } catch (err) {
            showAuthError(errDisplay, '📡 Error crítico durante el registro');
        }
    };

    function showAuthError(el, msg) {
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => el.classList.add('shake'), 10);
        setTimeout(() => el.classList.remove('shake'), 500);
    }
});