document.addEventListener('DOMContentLoaded', () => {
    // Elementos del DOM
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const formsSlider = document.getElementById('forms-slider');
    const toRegisterBtn = document.getElementById('to-register');
    const toLoginBtn = document.getElementById('to-login');
    const errorDisplay = document.getElementById('error-display');

    // 🔊 Efecto de Sonido para Botones (Generado con Web Audio API)
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    function playClickSound() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(600, audioCtx.currentTime); // Frecuencia en Hz
        osc.type = 'sine'; // Tipo de onda (suave)
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }

    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', playClickSound);
    });

    // Gestión de Animación (Slide)
    function showRegister() {
        errorDisplay.textContent = '';
        formsSlider.style.transform = 'translateX(-50%)';
    }

    function showLogin() {
        errorDisplay.textContent = '';
        formsSlider.style.transform = 'translateX(0)';
    }

    toRegisterBtn.addEventListener('click', showRegister);
    toLoginBtn.addEventListener('click', showLogin);

    // Manejo de Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector('button');
        setLoading(btn, true);

        const username = document.getElementById('login-user').value;
        const password = document.getElementById('login-pass').value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (data.success) {
                // Guardar sesión y redirigir
                localStorage.setItem('yovanny_user', JSON.stringify(data));
                window.location.href = '/game.html'; // Asumiendo que el juego está aquí o en otra ruta
            } else {
                showError(data.error || 'Error al iniciar sesión');
            }
        } catch (err) {
            showError('Error de conexión con el servidor');
        } finally {
            setLoading(btn, false);
        }
    });

    // Manejo de Registro
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = registerForm.querySelector('button');
        setLoading(btn, true);

        const username = document.getElementById('reg-user').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-pass').value;

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await res.json();

            if (data.success) {
                // Auto-login tras registro exitoso
                showLogin();
                document.getElementById('login-user').value = username;
                document.getElementById('login-pass').value = password;
                showError('¡Registro exitoso! Iniciando sesión...', 'green');
                setTimeout(() => loginForm.dispatchEvent(new Event('submit')), 1000);
            } else {
                showError(data.error || 'Error al registrarse');
            }
        } catch (err) {
            showError('Error de conexión con el servidor');
        } finally {
            setLoading(btn, false);
        }
    });

    function showError(msg, color = '#ef4444') {
        errorDisplay.style.color = color;
        errorDisplay.textContent = msg;
        errorDisplay.classList.add('fade-in');
    }

    function setLoading(btn, isLoading) {
        if (isLoading) {
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Procesando...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
        } else {
            btn.textContent = btn.dataset.originalText;
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
});