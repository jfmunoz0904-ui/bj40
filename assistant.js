/**
 * 🧠 ASISTENTE INTELIGENTE DE JUEGO (CLIENTE)
 * Analiza cartones en tiempo real, calcula probabilidades y sugiere estrategias.
 */

const GameAssistant = {
    state: {
        cards: [],
        calledNumbers: [],
        pattern: 'line',
        customPattern: [],
        isActive: true,
        socket: null
    },

    /**
     * Inicializa el asistente
     */
    init: function(socket, cards = []) {
        this.state.socket = socket;
        this.state.cards = cards;
        console.log('🧠 Asistente Inteligente activado');
    },

    /**
     * Actualiza el estado del juego y ejecuta análisis
     */
    update: function(calledNumbers, pattern, customPattern) {
        this.state.calledNumbers = calledNumbers || [];
        if (pattern) this.state.pattern = pattern;
        if (customPattern) this.state.customPattern = customPattern;

        if (this.state.isActive && this.state.cards.length > 0) {
            this.checkWinProximity();
            this.checkAutomaticBingo();
        }
    },

    setCards: function(cards) {
        this.state.cards = cards;
    },

    /**
     * Analiza la proximidad a la victoria para un cartón específico
     */
    analyzeWinProximity: function(card, calledNumbers, pattern, customPattern) {
        // Aplanar cartón: B, I, N, G, O
        const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
        const isMarked = (val) => val === "FREE" || calledNumbers.includes(val);
        
        let missingNumbers = 0;
        let totalRequired = 0;
        let markedCount = 0;
        let potentialWins = [];
        
        // Lógica según el patrón
        if (pattern.includes('line')) {
            // Para líneas, analizamos cada posible línea
            const lines = this.getWinningLines(pattern);
            lines.forEach((line, lineIndex) => {
                let lineMissing = 0;
                let lineTotal = 0;
                let lineMarked = 0;
                
                line.forEach(idx => {
                    lineTotal++;
                    if (isMarked(flatCard[idx])) {
                        lineMarked++;
                    } else {
                        lineMissing++;
                    }
                });
                
                // Guardar líneas prometedoras (faltan 3 o menos)
                if (lineMissing <= 3) {
                    potentialWins.push({
                        type: 'line',
                        index: lineIndex,
                        indexes: line,
                        missing: lineMissing,
                        total: lineTotal,
                        marked: lineMarked,
                        percentage: Math.round((lineMarked / lineTotal) * 100)
                    });
                }
            });

            // Calcular métricas basadas en la mejor línea
            if (potentialWins.length > 0) {
                const bestLine = potentialWins.reduce((prev, curr) => prev.missing < curr.missing ? prev : curr);
                missingNumbers = bestLine.missing;
                totalRequired = bestLine.total;
                markedCount = bestLine.marked;
            } else {
                missingNumbers = 5; // Peor caso por defecto
                totalRequired = 5;
            }

        } else {
            // Para patrones fijos (full, corners, etc.)
            let cellsToCheck = [];
            
            if (pattern === 'custom' && customPattern) {
                customPattern.forEach((isActive, idx) => {
                    if (isActive) cellsToCheck.push(idx);
                });
            } else if (pattern === 'full') {
                cellsToCheck = Array.from({length: 25}, (_, i) => i);
            } else {
                cellsToCheck = this.getPatternCells(pattern);
            }

            cellsToCheck.forEach(idx => {
                totalRequired++;
                if (isMarked(flatCard[idx])) {
                    markedCount++;
                } else {
                    missingNumbers++;
                }
            });
        }
        
        const percentage = totalRequired > 0 ? Math.round((markedCount / totalRequired) * 100) : 0;

        return {
            missingNumbers,
            totalRequired,
            markedCount,
            percentage,
            potentialWins,
            isCloseToWin: missingNumbers <= 2 && missingNumbers >= 0
        };
    },

    /**
     * Verifica todos los cartones y emite alertas si se está cerca de ganar
     */
    checkWinProximity: function() {
        if (!this.state.cards || this.state.cards.length === 0) return;
        
        let bestProximity = null;
        let closestCard = null;
        let bestLine = null;
        
        this.state.cards.forEach(card => {
            const proximity = this.analyzeWinProximity(
                card, 
                this.state.calledNumbers, 
                this.state.pattern, 
                this.state.customPattern
            );
            
            if (proximity.isCloseToWin) {
                if (!bestProximity || proximity.missingNumbers < bestProximity.missingNumbers) {
                    bestProximity = proximity;
                    closestCard = card;
                    if (proximity.potentialWins.length > 0) {
                        bestLine = proximity.potentialWins.reduce((best, current) => 
                            current.missing < best.missing ? current : best
                        );
                    }
                }
            }
        });
        
        if (bestProximity) {
            this.showProximityAlert(closestCard.id, bestProximity, bestLine);
        }
    },

    /**
     * Verifica si hay Bingo automático (por seguridad o ayuda)
     */
    checkAutomaticBingo: function() {
        this.state.cards.forEach(card => {
            const proximity = this.analyzeWinProximity(
                card, 
                this.state.calledNumbers, 
                this.state.pattern, 
                this.state.customPattern
            );

            if (proximity.missingNumbers === 0) {
                console.log(`🎉 ¡BINGO DETECTADO EN CLIENTE! Cartón #${card.id}`);
                if (this.state.socket) {
                    // Opcional: Gritar bingo automáticamente si el usuario lo configura
                    // this.state.socket.emit('bingo_shout'); 
                    this.showFloatingMessage(`¡TIENES BINGO EN EL CARTÓN #${card.id}! ¡GRÍTALO!`, 'success');
                }
            }
        });
    },

    /**
     * Muestra alertas visuales en la interfaz
     */
    showProximityAlert: function(cardId, proximity, lineInfo) {
        // Asume que los cartones tienen ID en el DOM como 'card-visual-{id}' o similar
        // Ajustar selector según tu implementación real en index.html
        const cardElement = document.getElementById(`card-${cardId}`) || document.querySelector(`[data-card-id="${cardId}"]`);
        
        if (!cardElement) return;
        
        // Evitar spam de alertas (checkear si ya tiene clase de alerta)
        if (cardElement.classList.contains('proximity-alert')) return;

        // Efectos visuales
        cardElement.classList.add('proximity-alert');
        
        // Sonido de alerta (si existe el sistema de audio)
        if (window.bingoAudio && typeof window.bingoAudio.play === 'function') {
            // window.bingoAudio.play('alert'); // Descomentar si existe
        }
        
        // Mostrar mensaje flotante
        const msg = proximity.missingNumbers === 1 ? '¡A 1 NÚMERO!' : `¡Faltan ${proximity.missingNumbers}!`;
        this.showFloatingMessage(`🚨 Cartón #${cardId}: ${msg}`, 'warning');
        
        // Resaltar línea específica si aplica
        if (lineInfo && this.state.pattern.includes('line')) {
            this.highlightLineInCard(cardElement, lineInfo);
        }
        
        // Remover efectos después de unos segundos
        setTimeout(() => {
            cardElement.classList.remove('proximity-alert');
        }, 5000);
    },

    highlightLineInCard: function(cardElement, lineInfo) {
        const cells = cardElement.querySelectorAll('.bingo-cell, .grid-cell'); // Ajustar selector
        if (!cells.length) return;

        lineInfo.indexes.forEach(idx => {
            if (cells[idx]) cells[idx].classList.add('highlight-line');
        });

        setTimeout(() => {
            lineInfo.indexes.forEach(idx => {
                if (cells[idx]) cells[idx].classList.remove('highlight-line');
            });
        }, 3000);
    },

    showFloatingMessage: function(message, type = 'info') {
        const div = document.createElement('div');
        div.className = `assistant-message ${type}`;
        div.innerHTML = `
            <span class="assistant-icon">${type === 'warning' ? '🔥' : type === 'success' ? '🎉' : '💡'}</span>
            <span class="assistant-text">${message}</span>
        `;
        
        document.body.appendChild(div);
        
        // Animación de entrada
        requestAnimationFrame(() => div.classList.add('show'));
        
        setTimeout(() => {
            div.classList.remove('show');
            setTimeout(() => div.remove(), 300);
        }, 4000);
    },

    // --- UTILIDADES DE PATRONES ---

    getWinningLines: function(pattern) {
        const lines = {
            'line_horizontal': [
                [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24]
            ],
            'line_vertical': [
                [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]
            ],
            'line_diagonal': [
                [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
            ]
        };
        
        // 'line' incluye todas
        if (pattern === 'line') {
            return [
                ...lines.line_horizontal,
                ...lines.line_vertical,
                ...lines.line_diagonal
            ];
        }
        
        return lines[pattern] || lines['line']; // Fallback
    },

    getPatternCells: function(pattern) {
        const patterns = {
            'corners': [0, 4, 20, 24],
            'x': [0, 6, 12, 18, 24, 4, 8, 16, 20], // Corregido para incluir centro si es necesario
            'x_shape': [0, 6, 12, 18, 24, 4, 8, 16, 20],
            'plus': [7, 11, 12, 13, 17],
            'corners_center': [0, 4, 12, 20, 24],
            'frame': [0,1,2,3,4,9,14,19,24,23,22,21,20,15,10,5],
            'inner_frame': [6,7,8,11,13,16,17,18],
            'letter_h': [0,5,10,15,20,2,7,12,17,22,4,9,14,19,24],
            'letter_t': [0,1,2,3,4,7,12,17],
            'small_square': [0,1,5,6],
            'diamond': [2,6,10,14,18,22],
            'star': [2,6,8,10,12,14,16,18,7,11,12,13,17],
            'heart': [1,3,6,7,8,9,11,12,13,16,18],
            'arrow': [2,7,10,11,12,13,14,17],
            'pyramid': [2,6,7,8,10,11,12,13,14,16,17,18],
            'cross': [2,7,11,12,13,17,22]
        };
        return patterns[pattern] || [];
    }
};

/**
 * 🛠️ UI UTILITIES - ECONOMY PANEL
 */
window.switchEconTab = function(tabId) {
    // Remover estados activos
    document.querySelectorAll('.econ-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.econ-tab-pane').forEach(p => p.classList.remove('active'));
    
    // Activar nueva pestaña
    const activeBtn = document.querySelector(`.econ-tab[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const activePane = document.getElementById(`econ-tab-${tabId}`);
    if (activePane) activePane.classList.add('active');

    // Reiniciar iconos de Lucide si es necesario
    if (window.lucide) window.lucide.createIcons();
};

window.applyEconomyFeedback = function(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.classList.add('card-success-flash');
    
    // Sonido sutil de confirmación
    if (window.bingoAudio) window.bingoAudio.play('click');

    setTimeout(() => {
        element.classList.remove('card-success-flash');
    }, 1500);
};

// Exponer al ámbito global
window.GameAssistant = GameAssistant;