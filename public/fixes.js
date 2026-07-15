/**
 * @file fixes.js
 * @description Soluciones críticas para la interfaz del jugador, sincronización de patrones,
 * voces en español y visualización de ganadores.
 */

// 🗣️ GESTIÓN DE VOCES EN ESPAÑOL
const VoiceEngine = {
    voice: null,
    lastAnnouncedWinner: null,
    availableVoices: [],
    volume: 1.0,
    isEnabled: true,
    _uiBound: false,
    
    init() {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            
            // FIX CRÍTICO: Chrome carga voces de forma asíncrona. Si está vacío, abortamos y 
            // esperamos al evento 'onvoiceschanged' para volver a intentarlo y poblar el selector.
            if (voices.length === 0) return;
            
            this.availableVoices = voices;
            
            // Lista de voces preferidas priorizando las más naturales de alta calidad
            const preferredVoices = [
                'Microsoft Sabina Online (Natural)',
                'Microsoft Alvaro Online (Natural)',
                'Microsoft Dalia Online (Natural)',
                'Microsoft Jorge Online (Natural)',
                'Google español de Estados Unidos',
                'Google español'
            ];

            // Priorizar voces neurales/naturales (Microsoft Online o Google) que son menos robóticas
            this.voice = voices.find(v => v.lang.startsWith('es') && preferredVoices.some(pv => v.name.includes(pv))) ||
                         voices.find(v => v.lang.startsWith('es') && (v.name.includes('Natural') || v.name.includes('Online'))) || 
                         voices.find(v => v.lang.startsWith('es') && v.name.includes('Google')) || 
                         voices.find(v => v.lang.startsWith('es') && v.name.includes('Helena')) || 
                         voices.find(v => v.lang.startsWith('es')) || 
                         voices[0];
            console.log('🗣️ Motor de Voz listo:', this.voice?.name);
            
            // Inicializar la interfaz de usuario si estamos en el panel de administrador
            this.setupUI();
        };

        // Asignar evento para Google Chrome / Edge
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
        // Carga inmediata para navegadores que tienen las voces ya listas (Safari, Firefox)
        loadVoices();
    },

    setupUI() {
        const voiceSelect = document.getElementById('admin-voice-selector');
        const volumeSlider = document.getElementById('admin-voice-volume');
        const volumeDisplay = document.getElementById('admin-volume-display');

        if (voiceSelect) {
            voiceSelect.innerHTML = '';
            // Mostrar preferentemente voces en español
            const esVoices = this.availableVoices.filter(v => v.lang.startsWith('es'));
            const voicesToShow = esVoices.length > 0 ? esVoices : this.availableVoices;

            voicesToShow.forEach((v) => {
                const option = document.createElement('option');
                option.value = v.name;
                option.textContent = v.name;
                if (this.voice && v.name === this.voice.name) {
                    option.selected = true;
                }
                voiceSelect.appendChild(option);
            });

            voiceSelect.onchange = (e) => {
                const selectedName = e.target.value;
                this.voice = this.availableVoices.find(v => v.name === selectedName);
                console.log('🗣️ Voz cambiada a:', this.voice?.name);
            };
        }

        if (volumeSlider) {
            // Sincronizar valor inicial
            this.volume = parseFloat(volumeSlider.value) / 100 || 1.0;
            
            volumeSlider.oninput = (e) => {
                const vol = parseFloat(e.target.value);
                this.volume = vol / 100;
                if (volumeDisplay) volumeDisplay.textContent = vol + '%';
            };
        }

        // Usar Event Delegation para los botones, así funcionarán aunque se carguen dinámicamente
        if (!this._uiBound) {
            document.body.addEventListener('click', (e) => {
                // 1. Botón de probar voz
                const btnTest = e.target.closest('.btn-test-voice-modern, .btn-test-voice, #btn-test-voice');
                if (btnTest) {
                    e.preventDefault();
                    this.speak('El motor de voz está funcionando correctamente. Listo para el bingo.');
                }
                
                // 2. Botón para mutear/desmutear voz globalmente
                const btnToggle = e.target.closest('.btn-toggle-voice, #btn-voice');
                if (btnToggle && !btnToggle.hasAttribute('data-target')) {
                    e.preventDefault();
                    this.isEnabled = !this.isEnabled;
                    btnToggle.classList.toggle('muted', !this.isEnabled);
                    if (!this.isEnabled) window.speechSynthesis.cancel();
                }

                // 3. Botón para abrir el Sidebar/Panel de Configuración de Voz (incluso si falla el inline script)
                const btnSidebar = e.target.closest('.btn-voice-settings, [data-target="voice-sidebar"], #toggle-voice-btn');
                if (btnSidebar) {
                    e.preventDefault();
                    document.querySelector('.admin-settings-sidebar')?.classList.toggle('open');
                }
                
                // 4. Botón para cerrar el Sidebar
                const btnClose = e.target.closest('.btn-close-sidebar');
                if (btnClose) {
                    e.preventDefault();
                    document.querySelector('.admin-settings-sidebar')?.classList.remove('open');
                }
            });
            this._uiBound = true;
        }
    },

    speak(text) {
        if (!this.isEnabled || !window.speechSynthesis) return;
        
        // Gestión de cola de voz para evitar cortes abruptos en multibingos
        window.speechSynthesis.cancel();
        
        // Evitar repetir el mismo ganador si ya se anunció en esta sesión de carga
        if (text.includes('Bingo detectado') && text === this.lastAnnouncedWinner) return;
        if (text.includes('Bingo detectado')) this.lastAnnouncedWinner = text;

        const utterance = new SpeechSynthesisUtterance(text.toString());
        if (this.voice) utterance.voice = this.voice;
        utterance.lang = this.voice ? this.voice.lang : 'es-ES';
        utterance.rate = 0.9; // Velocidad ligeramente más lenta para mayor claridad y naturalidad
        utterance.pitch = 1.0;
        utterance.volume = this.volume;
        window.speechSynthesis.speak(utterance);
    }
};

// 📥 DESCARGA DE CARTONES
function requestPDFDownload(cardIds) {
    if (!window.socket) return;
    window.socket.emit('request_pdf_export', cardIds);
}

window.socket.on('pdf_ready', (data) => {
    const a = document.createElement('a');
    a.href = data.url;
    a.download = 'Mis_Cartones_Bingo.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// 🎯 SINCRONIZACIÓN DE PATRÓN EN TIEMPO REAL (Custom & Standard)
function updatePatternDisplay(patternData) {
    const nameEl = document.getElementById('pattern-name-display');
    const gridContainer = document.getElementById('pattern-preview-container');
    
    if (nameEl) nameEl.innerText = patternData.name || 'LÍNEA';
    if (!gridContainer) return;

    gridContainer.innerHTML = '';
    gridContainer.className = 'pattern-preview-grid'; 

    let activeIndices = [];
    if (patternData.type === 'custom' && patternData.grid) {
        activeIndices = patternData.grid.map((val, i) => val ? i : -1).filter(i => i !== -1);
    } else if (patternData.positions) {
        activeIndices = [...new Set(patternData.positions.flat())];
    }

    for (let v = 0; v < 25; v++) {
        const cell = document.createElement('div');
        cell.className = 'pattern-preview-cell';
        
        // 🔄 MAPEIO DE SEGURIDAD: De Row-Major (Visual) a Column-Major (Lógica Motor)
        const row = Math.floor(v / 5);
        const col = v % 5;
        const internalIdx = col * 5 + row;

        if (v === 12) cell.classList.add('free');

        if (patternData.type === 'custom') {
            // El grid personalizado viene en row-major del administrador
            if (patternData.grid && patternData.grid[v]) cell.classList.add('active');
        } else {
            // Los patrones estándar usan el índice interno de columnas
            if (activeIndices.includes(internalIdx)) cell.classList.add('active');
        }
        gridContainer.appendChild(cell);
    }
}



/**
 * Implementación de descarga masiva para el jugador.
 * Utiliza el worker thread del servidor para no bloquear el event loop.
 */
function downloadAllMyCards() {
    const userData = JSON.parse(localStorage.getItem('yovanny_user') || '{}');
    const cardIds = window.myCardIds || userData.cardIds;
    
    if (!cardIds || cardIds.length === 0) {
        alert('No tienes cartones asignados para descargar.');
        return;
    }

    console.log('📂 Solicitando exportación PDF para cartones:', cardIds);
    requestPDFDownload(cardIds);
}



// Initialize fixes when the page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Fixes de Producción inicializados');
    VoiceEngine.init();

    // 🔄 Intentar recuperación de sesión automática
    const savedUuid = localStorage.getItem('bingo_session_uuid');
    
    if (window.socket) {
        if (savedUuid) {
            window.socket.emit('rejoin_session', savedUuid);
        }

        // Hook para el botón de descarga si existe en el DOM
        const dlBtn = document.getElementById('btn-download-all');
        if (dlBtn) dlBtn.onclick = downloadAllMyCards;

        window.socket.on('init_cards', (data) => {
            if (data.uuid) localStorage.setItem('bingo_session_uuid', data.uuid);
        });

        // 🔄 SISTEMA UNIVERSAL DE PESTAÑAS (TABS) PARA EL ADMIN Y USUARIO
        document.body.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab, .tab-btn, .nav-item');
            if (!tab) return;
            
            // Si el botón ya tiene un onclick nativo (como economy), lo respetamos
            if (tab.getAttribute('onclick')) return;

            const targetSelector = tab.getAttribute('data-target');
            if (!targetSelector) return;

            // Quitar clase active de los botones de la misma fila
            const tabsContainer = tab.closest('.tabs, .tabs-neon, .admin-nav');
            if (tabsContainer) {
                tabsContainer.querySelectorAll('.tab, .tab-btn, .nav-item').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
            }

            // Mostrar el contenedor de configuraciones destino
            const targetContent = document.querySelector(targetSelector) || document.getElementById(targetSelector.replace('#', ''));
            if (targetContent && targetContent.parentElement) {
                Array.from(targetContent.parentElement.children).forEach(child => {
                    if (child.classList.contains('tab-content') || child.classList.contains('tab-pane')) {
                        child.classList.remove('active');
                    }
                });
                targetContent.classList.add('active');
            }
        });



        // 💬 Reparación de apertura de Chat
        // (toggleChat removido para usar el de index.html)



        // Sincronización total al conectar/reconectar
        window.socket.on('sync_state', (state) => {
            console.log('🔄 Estado sincronizado:', state);
            
            // Restaurar visualización de pausa
            if (state.isPaused) document.body.classList.add('is-paused');
            else document.body.classList.remove('is-paused');


            
            if (state.pattern) {
                updatePatternDisplay({
                    name: state.patternName || (state.pattern === 'custom' ? 'Figura Personalizada' : state.pattern),
                    type: state.pattern,
                    grid: state.customPattern || [],
                    positions: state.patternPositions || []
                });
            }
            
            // Actualizar disponibilidad de cartones en la UI de login
            if (state.occupied_cards) {
                window.occupiedCardsList = state.occupied_cards;
                if (typeof window.renderCardGrid === 'function') window.renderCardGrid();
            }
        });

        // Sincronización de patrón al entrar o cambiar
        window.socket.on('pattern_changed', (data) => {
            updatePatternDisplay(data);
            VoiceEngine.speak(`El patrón ha cambiado a ${data.name}`);
        });

        // Locución de números (B-5, I-20...)
        window.socket.on('number_called', async (data) => {
            const letters = { B: [1,15], I: [16,30], N: [31,45], G: [46,60], O: [61,75] };
            const letter = Object.keys(letters).find(l => data.num >= letters[l][0] && data.num <= letters[l][1]);
            
            // Usar coma para forzar una pausa natural en la síntesis de voz (ej: "B, 5")
            VoiceEngine.speak(`${letter}, ${data.num}`);
            
            // Resaltar celdas del patrón en los cartones del jugador
            document.querySelectorAll('.grid-cell').forEach(cell => {
                if (window.currentPatternPositions?.includes(parseInt(cell.dataset.index))) {
                    cell.classList.add('pattern-target');
                }
            });

            // 🚨 Efecto Visual de Proximidad en el Tablero del Admin
            if (document.querySelector('.numbers-board')) {
                try {
                    document.querySelectorAll('.board-cell.needed-to-win').forEach(c => c.classList.remove('needed-to-win'));
                    const response = await fetch('/api/admin/proximity-report');
                    if (response.ok) {
                        const report = await response.json();
                        if (report.length > 0) {
                            const neededNumbers = new Set();
                            report.forEach(item => item.neededNumbers.forEach(n => neededNumbers.add(n)));
                            
                            neededNumbers.forEach(num => {
                                const targetCell = Array.from(document.querySelectorAll('.board-cell')).find(c => c.textContent.trim() == num);
                                if (targetCell && !targetCell.classList.contains('called')) {
                                    targetCell.classList.add('needed-to-win');
                                }
                            });
                        }
                    }
                } catch (err) {
                    console.warn('Error al consultar proximidad:', err);
                }
            }
        });



        // 📢 Recibir alertas/letreros del Admin
        window.socket.on('player_receive_alert', (data) => {
            const alertOverlay = document.createElement('div');
            alertOverlay.className = 'alert-overlay active';
            alertOverlay.innerHTML = `
                <div class="alert-content animate-scale-in">
                    <div class="alert-header">
                        <span class="alert-type-badge ${data.type}">${data.type.toUpperCase()}</span>
                        <span>${data.time || ''}</span>
                    </div>
                    <div id="alert-message">${data.message}</div>
                    <button class="btn-alert-close" onclick="this.closest('.alert-overlay').remove()">ENTENDIDO</button>
                </div>
            `;
            document.body.appendChild(alertOverlay);
            
            // Auto-cerrar después de 10 segundos si no es urgente
            if (data.type !== 'urgent') {
                setTimeout(() => {
                    if (alertOverlay.parentNode) alertOverlay.remove();
                }, 10000);
            }
        });
    }
});

// 📊 GESTOR DE ESTADÍSTICAS Y PROGRESIÓN (StatsManager)
const StatsManager = {
    async loadStats(username) {
        if (!username) return;
        try {
            const response = await fetch(`/api/stats/${encodeURIComponent(username)}`);
            if (response.ok) {
                const data = await response.json();
                this.renderProfile(data);
                return data;
            }
        } catch (err) {
            console.error('❌ Error al cargar estadísticas:', err);
        }
    },

    renderProfile(data) {
        // Actualizar valores básicos
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('stat-games', data.stats.totalGames || 0);
        setVal('stat-wins', data.stats.wins || 0);
        setVal('stat-rate', `${data.stats.winRate || 0}%`);
        setVal('stat-level', data.level.current || 1);
        setVal('stat-streak', data.stats.currentStreak || 0);
        setVal('stat-maxstreak', data.stats.maxStreak || 0);
        setVal('stat-points', data.stats.totalPoints || 0);
        
        // Actualizar barra de nivel
        setVal('lvl-current', data.level.current || 1);
        setVal('lvl-exp', `${data.level.exp || 0} / ${data.level.expToNext || 100} XP`);
        const bar = document.getElementById('lvl-bar');
        if (bar) {
            const percent = (data.level.exp / data.level.expToNext) * 100;
            bar.style.width = `${percent}%`;
        }

        // Renderizar logros (preview)
        const achPreview = document.getElementById('stats-achievements-preview');
        if (achPreview) {
            achPreview.innerHTML = '';
            const achievements = data.achievements || [];
            achievements.slice(-5).reverse().forEach(ach => {
                const div = document.createElement('div');
                div.className = 'achievement-mini-badge';
                div.title = ach.name;
                div.innerHTML = `🏅`;
                achPreview.appendChild(div);
            });
        }
        
        // Renderizar logros (grid completo)
        const achGrid = document.getElementById('achievements-grid');
        if (achGrid) {
            achGrid.innerHTML = '';
            (data.achievements || []).forEach(ach => {
                const item = document.createElement('div');
                item.className = 'achievement-card-neon';
                item.innerHTML = `
                    <div class="ach-icon">🏆</div>
                    <div class="ach-info">
                        <div class="ach-name">${ach.name}</div>
                        <div class="ach-date">${new Date(ach.earnedAt).toLocaleDateString()}</div>
                    </div>
                `;
                achGrid.appendChild(item);
            });
        }
    },

    async loadLeaderboard() {
        const lbList = document.getElementById('leaderboard-list');
        const loading = document.getElementById('lb-loading');
        if (!lbList) return;

        if (loading) loading.textContent = 'Cargando ranking...';
        
        try {
            const response = await fetch('/api/leaderboard');
            const players = await response.json();
            
            lbList.innerHTML = '';
            players.forEach((p, idx) => {
                const row = document.createElement('div');
                row.className = `lb-row ${idx < 3 ? 'top-rank' : ''}`;
                row.innerHTML = `
                    <div class="lb-rank">${idx + 1}</div>
                    <div class="lb-name">${p.username}</div>
                    <div class="lb-lvl">Nv. ${p.level?.current || 1}</div>
                    <div class="lb-wins">${p.stats?.wins || 0} vics</div>
                `;
                lbList.appendChild(row);
            });
        } catch (err) {
            console.error('❌ Error al cargar leaderboard:', err);
        } finally {
            if (loading) loading.textContent = '';
        }
    }
};

// Exponer funciones globales para los botones de index.html
window.showStatsModal = function(type) {
    const modal = document.getElementById('stats-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    
    // Cambiar pestaña inicial si se solicita
    if (type === 'lb') {
        switchStatsTab('lb');
    } else {
        switchStatsTab('mis');
        const user = playerSession?.username || document.getElementById('username')?.value;
        if (user) StatsManager.loadStats(user);
    }
};

window.switchStatsTab = function(tab) {
    const btnMis = document.getElementById('stats-tab-mis');
    const btnLb = document.getElementById('stats-tab-lb');
    const paneMis = document.getElementById('stats-pane-mis');
    const paneLb = document.getElementById('stats-pane-lb');
    
    if (tab === 'mis') {
        btnMis?.classList.add('active');
        btnLb?.classList.remove('active');
        paneMis?.classList.add('active');
        paneLb?.classList.add('hidden');
        paneMis?.classList.remove('hidden');
    } else {
        btnLb?.classList.add('active');
        btnMis?.classList.remove('active');
        paneLb?.classList.add('active');
        paneMis?.classList.add('hidden');
        paneLb?.classList.remove('hidden');
        StatsManager.loadLeaderboard();
    }
};

window.showAchievementToast = function(name) {
    const toast = document.createElement('div');
    toast.className = 'achievement-toast animate-slide-up';
    toast.innerHTML = `
        <div class="toast-icon">🏆</div>
        <div class="toast-body">
            <div class="toast-title">¡Logro Desbloqueado!</div>
            <div class="toast-name">${name}</div>
        </div>
    `;
    document.body.appendChild(toast);
    
    if (typeof audio !== 'undefined' && audio.bingo) audio.bingo();
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

// Export functions for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fixInterfaceDisplay,
        renderPatternThumbnail,
        checkAutoBingo
    };
}