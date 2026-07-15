/**
 * @file admin_gallery.js
 * @description Módulo de producción para la auditoría visual de los 300 cartones únicos.
 * Implementa carga asíncrona de JSON y renderizado de alta densidad.
 */

(function() {
    // Estado interno del módulo
    let loadedCards = [];

    /**
     * Inicializa y despliega el modal de galería en el DOM.
     * Se inyecta dinámicamente para mantener el HTML del admin limpio.
     */
    window.openBingoGallery = () => {
        let overlay = document.getElementById('admin-gallery-overlay');
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'admin-gallery-overlay';
            overlay.className = 'admin-gallery-modal';
            overlay.innerHTML = `
                <div class="gallery-container animate-fade-in">
                    <div class="gallery-header">
                        <div class="header-info">
                            <h2>Panel de Auditoría de Cartones</h2>
                            <p id="gallery-count-lbl">Estado: Esperando importación de bingo_cards_backup.json</p>
                        </div>
                        <div class="header-actions">
                            <button class="btn-hero btn-hero-primary" id="btn-import-gallery">
                                <i class="icon-folder"></i> IMPORTAR RESPALDO JSON
                            </button>
                            <button class="btn-hero btn-hero-outline" id="btn-close-gallery">CERRAR GALERÍA</button>
                        </div>
                    </div>
                    <div class="gallery-body neon-scroll" id="gallery-grid-main">
                        <div class="empty-gallery-msg">
                            <div class="empty-icon">📂</div>
                            <h3>Sin datos cargados</h3>
                            <p>Cargue el archivo generado por "npm run export-cards" para verificar la integridad de los 300 cartones.</p>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Vinculación de eventos de producción
            document.getElementById('btn-close-gallery').onclick = () => overlay.classList.remove('active');
            document.getElementById('btn-import-gallery').onclick = () => triggerFilePicker();
        }
        
        overlay.classList.add('active');
    };

    const triggerFilePicker = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (!data.cards || !Array.isArray(data.cards)) throw new Error("Esquema de JSON inválido.");
                    
                    loadedCards = data.cards;
                    renderGallery();
                    document.getElementById('gallery-count-lbl').innerText = `✅ Verificados: ${loadedCards.length} cartones únicos inmutables.`;
                } catch (err) {
                    alert("Error Crítico de Importación: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const renderGallery = () => {
        const container = document.getElementById('gallery-grid-main');
        const letters = ['B', 'I', 'N', 'G', 'O'];
        
        container.innerHTML = loadedCards.map(card => `
            <div class="gallery-card-item animate-scale-in">
                <div class="card-id-tag">CARTÓN #${card.id}</div>
                <div class="mini-bingo-grid">
                    ${letters.map(L => `<div class="mini-col-header">${L}</div>`).join('')}
                    ${renderCells(card, letters)}
                </div>
            </div>
        `).join('');
    };

    const renderCells = (card, letters) => {
        let cells = '';
        for (let row = 0; row < 5; row++) {
            letters.forEach(L => {
                const val = card[L][row];
                const isFree = val === "FREE";
                cells += `<div class="mini-cell ${isFree ? 'free' : ''}">${isFree ? '★' : val}</div>`;
            });
        }
        return cells;
    };
})();