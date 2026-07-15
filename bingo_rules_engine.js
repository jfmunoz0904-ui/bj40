/**
 * @file bingo_rules_engine.js
 * @description Motor de reglas optimizado para validación de patrones de Bingo.
 * Implementa algoritmos de búsqueda sobre matrices aplanadas para máxima eficiencia.
 */

const BINGO_PATTERNS = {
    'line': {
        name: 'LÍNEA',
        description: 'Cualquier línea completa horizontal, vertical o diagonal',
        multiplier: 1.0,
        positions: [
            [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24], // Horizontales
            [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24], // Verticales
            [0,6,12,18,24], [4,8,12,16,20] // Diagonales
        ]
    },

    'full': {
        name: 'CARTÓN LLENO',
        description: 'Todos los números del cartón marcados',
        multiplier: 5.0,
        positions: [[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]]
    },

    'corners': {
        name: '4 ESQUINAS',
        description: 'Las cuatro esquinas del cartón',
        multiplier: 1.5,
        positions: [[0,4,20,24]]
    },

    'corners_center': {
        name: '4 ESQUINAS + CENTRO',
        description: 'Las cuatro esquinas más el espacio central',
        multiplier: 1.8,
        positions: [[0,4,12,20,24]]
    },

    'small_square': {
        name: 'CUADRADO PEQUEÑO',
        description: 'Cualquier bloque de 2x2',
        multiplier: 1.5,
        positions: [
            [0,1,5,6], [1,2,6,7], [2,3,7,8], [3,4,8,9],
            [5,6,10,11], [6,7,11,12], [7,8,12,13], [8,9,13,14],
            [10,11,15,16], [11,12,16,17], [12,13,17,18], [13,14,18,19],
            [15,16,20,21], [16,17,21,22], [17,18,22,23], [18,19,23,24]
        ]
    },

    // Letters
    'letter_t': {
        name: 'LETRA T',
        description: 'Letra T estándar',
        multiplier: 2.0,
        positions: [[0,5,10,15,20, 11,12,13,14]]
    },

    'letter_l': {
        name: 'LETRA L',
        description: 'Letra L estándar',
        multiplier: 2.0,
        positions: [[0,1,2,3,4, 9,14,19,24]]
    },

    'letter_h': {
        name: 'LETRA H',
        description: 'Letra H estándar',
        multiplier: 2.5,
        positions: [[0,1,2,3,4, 20,21,22,23,24, 7,12,17]]
    },

    'letter_o': {
        name: 'LETRA O',
        description: 'Borde exterior completo',
        multiplier: 2.5,
        positions: [[0,1,2,3,4, 5,9, 10,14, 15,19, 20,21,22,23,24]]
    },

    'letter_x': {
        name: 'LETRA X',
        description: 'Ambas diagonales cruzadas',
        multiplier: 2.0,
        positions: [[0,6,12,18,24, 4,8,16,20]] // 12 ya está en la primera diagonal
    },
    
    'x_shape': { // Alias para x_shape usado en admin.html
        name: 'LETRA X',
        description: 'Ambas diagonales cruzadas',
        multiplier: 2.0,
        positions: [[0,6,12,18,24, 4,8,16,20]]
    },

    'letter_c': {
        name: 'LETRA C',
        description: 'Letra C (Top, Bottom, Left)',
        multiplier: 2.2,
        positions: [[0,5,10,15,20, 1,2,3, 4,9,14,19,24]]
    },

    'letter_u': {
        name: 'LETRA U',
        description: 'Letra U (Left, Bottom, Right)',
        multiplier: 2.2,
        positions: [[0,1,2,3,4, 9,14,19, 24,23,22,21,20]]
    },

    // Shapes
    'plus': {
        name: 'PLUS (+)',
        description: 'Cruz a través del centro',
        multiplier: 1.8,
        positions: [[2,7,12,17,22, 10,11,13,14]]
    },

    'diamond': {
        name: 'DIAMANTE',
        description: 'Forma de diamante',
        multiplier: 2.0,
        positions: [[2,6,10,14,18,22,7,11,13,17]]
    },

    'heart': {
        name: 'CORAZÓN',
        description: 'Forma de corazón',
        multiplier: 3.0,
        positions: [[1,3,5,6,7,8,9,11,13,17]]
    },

    'star': {
        name: 'ESTRELLA',
        description: 'Forma de estrella',
        multiplier: 3.0,
        positions: [[2,6,7,8,10,11,13,14,16,17,18,12]]
    },

    'arrow': {
        name: 'FLECHA',
        description: 'Flecha apuntando arriba',
        multiplier: 2.2,
        positions: [[2,5,6,7, 12, 17, 22]]
    },

    'pyramid': {
        name: 'PIRÁMIDE',
        description: 'Forma de pirámide',
        multiplier: 2.5,
        positions: [[2,6,7,8,10,11,12,13,14]]
    },

    'cross': {
        name: 'CRUZ CRISTIANA',
        description: 'Cruz latina',
        multiplier: 2.0,
        positions: [[1,6,11,16,21,12,13,14,10]]
    },

    // Advanced / Figures
    'frame': {
        name: 'MARCO EXTERIOR',
        description: 'Borde del cartón',
        multiplier: 2.5,
        positions: [[0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24]]
    },

    'inner_square': {
        name: 'MARCO INTERIOR',
        description: 'Marco de 3x3 interno',
        multiplier: 2.5,
        positions: [[6,7,8,11,13,16,17,18]]
    },

    'hourglass': {
        name: 'RELOJ DE ARENA',
        description: 'Forma de reloj de arena',
        multiplier: 2.8,
        positions: [[0,5,10,15,20,6,12,18,4,9,14,19,24,8,16]]
    },

    'butterfly': {
        name: 'MARIPOSA',
        description: 'Forma de mariposa',
        multiplier: 3.0,
        positions: [[0,1,2,3,4, 20,21,22,23,24, 6,12,18, 8,16]]
    },

    'checkerboard': {
        name: 'AJEDREZ',
        description: 'Celdas alternadas',
        multiplier: 4.0,
        positions: [[0,2,4,6,8,10,12,14,16,18,20,22,24]]
    },

    'crown': {
        name: 'CORONA',
        description: 'Forma de corona',
        multiplier: 3.5,
        positions: [[0,5,10,15,20,1,21,7,12,17]]
    },

    'snake': {
        name: 'SERPIENTE',
        description: 'Culebrita pasando por el cartón',
        multiplier: 3.2,
        positions: [[0,1,2,7,12,17,22,23,24]]
    },

    'zigzag': {
        name: 'ZIG ZAG',
        description: 'Zig zag vertical',
        multiplier: 2.5,
        positions: [[0,6,10,16,20]]
    },

    // Horizontal Lines (Specific)
    'horizontal_1': { name: 'FILA 1', description: 'Superior', multiplier: 1.2, positions: [[0,5,10,15,20]] },
    'horizontal_2': { name: 'FILA 2', description: 'Segunda', multiplier: 1.2, positions: [[1,6,11,16,21]] },
    'horizontal_3': { name: 'FILA 3', description: 'Central', multiplier: 1.2, positions: [[2,7,12,17,22]] },
    'horizontal_4': { name: 'FILA 4', description: 'Cuarta', multiplier: 1.2, positions: [[3,8,13,18,23]] },
    'horizontal_5': { name: 'FILA 5', description: 'Inferior', multiplier: 1.2, positions: [[4,9,14,19,24]] },

    // Vertical Lines (Specific)
    'vertical_b': { name: 'COLUMNA B', description: 'Vertical B', multiplier: 1.2, positions: [[0,1,2,3,4]] },
    'vertical_i': { name: 'COLUMNA I', description: 'Vertical I', multiplier: 1.2, positions: [[5,6,7,8,9]] },
    'vertical_n': { name: 'COLUMNA N', description: 'Vertical N', multiplier: 1.2, positions: [[10,11,12,13,14]] },
    'vertical_g': { name: 'COLUMNA G', description: 'Vertical G', multiplier: 1.2, positions: [[15,16,17,18,19]] },
    'vertical_o': { name: 'COLUMNA O', description: 'Vertical O', multiplier: 1.2, positions: [[20,21,22,23,24]] },

    'diagonal_main': { name: 'DIAGONAL PRINCIPAL', description: 'Top-Left a Bottom-Right', multiplier: 1.5, positions: [[0,6,12,18,24]] },
    'diagonal_secondary': { name: 'DIAGONAL SECUNDARIA', description: 'Top-Right a Bottom-Left', multiplier: 1.5, positions: [[4,8,12,16,20]] },

    'perimeter': { name: 'PERÍMETRO', description: 'Todo el borde exterior', multiplier: 2.5, positions: [[0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24]] },
    'inner_perimeter': { name: 'PERÍMETRO INTERIOR', description: 'Borde interior', multiplier: 2.2, positions: [[6,7,8,11,13,16,17,18]] },
    'cross_center': { name: 'CRUZ CENTRAL', description: 'Cruz que pasa por el centro', multiplier: 1.8, positions: [[2,7,12,17,22,10,11,13,14]] }
};

// ⚡ OPTIMIZACIÓN BITWISE: Pre-procesamiento de patrones para validación en O(1)
// Convierte los arrays de posiciones en máscaras de bits (enteros de 32 bits) al cargar el módulo.
Object.keys(BINGO_PATTERNS).forEach(key => {
    const p = BINGO_PATTERNS[key];
    p.bitmasks = p.positions.map(indices => 
        indices.reduce((mask, idx) => mask | (1 << idx), 0)
    );
});

/**
 * Valida si un cartón cumple con un patrón específico.
 * @param {string} patternType - Identificador del patrón.
 * @param {Array<number|string>} flatCard - Array de 25 elementos representando el cartón.
 * @param {Array<number>} calledNumbers - Números que ya han salido en el sorteo.
 * @returns {boolean} True si el patrón se cumple.
 */
function validatePattern(patternType, flatCard, calledNumbers) {
    if (!Array.isArray(flatCard) || flatCard.length !== 25) {
        throw new Error('Estructura de cartón inválida para validación.');
    }

    const pattern = BINGO_PATTERNS[patternType];
    if (!pattern) return false;

    // Conversión a Set para búsqueda O(1) si no viene pre-procesado
    const calledSet = calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);
    let cardMask = (1 << 12); // Centro FREE siempre activo (Bit 12)

    try {
        // Generar bitmask del estado actual del cartón
        for (let i = 0; i < 25; i++) {
            if (i === 12) continue;
            if (calledSet.has(flatCard[i])) cardMask |= (1 << i);
        }

        // Comparación Bitwise: Si (Cartón & Patrón) === Patrón, el patrón está completo.
        return pattern.bitmasks.some(mask => (cardMask & mask) === mask);
    } catch (error) {
        console.error(`Error validando patrón ${patternType}:`, error);
        return false;
    }
}

/**
 * Obtiene los detalles de la victoria (índices ganadores).
 * @returns {Object|null} { indices: Array<number>, mask: number } o null si no hay victoria.
 */
function getWinningDetails(patternType, flatCard, calledNumbers, customPattern = []) {
    // 💡 SOPORTE PARA PATRONES PERSONALIZADOS (CUSTOM)
    if (patternType === 'custom' && Array.isArray(customPattern) && customPattern.length === 25) {
        const winningIndices = [];
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const adminIdx = r * 5 + c;
                const cardIdx = c * 5 + r; // Mapeo a flatCard (column-major)
                if (customPattern[adminIdx]) {
                    winningIndices.push(cardIdx);
                }
            }
        }
        return { indices: winningIndices };
    }

    const pattern = BINGO_PATTERNS[patternType];
    if (!pattern) return null;

    const calledSet = calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);
    let cardMask = (1 << 12); 

    for (let i = 0; i < 25; i++) {
        if (i === 12) continue;
        if (calledSet.has(flatCard[i])) cardMask |= (1 << i);
    }

    for (const mask of pattern.bitmasks) {
        if ((cardMask & mask) === mask) {
            const winningIndices = [];
            for (let i = 0; i < 25; i++) {
                if ((mask & (1 << i)) !== 0) winningIndices.push(i);
            }
            return { indices: winningIndices, mask: mask };
        }
    }
    return null;
}

/**
 * Verifica la victoria de un cartón individual.
 * @param {Object} card - Objeto del cartón (B, I, N, G, O).
 * @param {Array<number>} calledNumbers - Números sorteados.
 * @param {string} patternType - Tipo de patrón a buscar.
 * @param {Array<boolean>} customPattern - Opcional, patrón definido manualmente.
 * @returns {boolean}
 */
function checkWin(card, calledNumbers, patternType) {
    const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
    const calledSet = new Set(calledNumbers);
    return validatePattern(patternType, flatCard, calledSet);
}

/**
 * Escanea todos los jugadores en busca de ganadores.
 * @param {Array} players - Lista de jugadores activos.
 * @param {Array<number>} calledNumbers - Números sorteados.
 * @param {string} patternType - Patrón activo.
 * @param {Object} io - Instancia de Socket.io para emisión inmediata.
 * @returns {Array} Lista de ganadores detectados.
 */
function checkForWinners(players, calledNumbers, patternType, io) {
    const winners = [];
    const pattern = BINGO_PATTERNS[patternType];
    if (!pattern) return winners;

    // Optimización masiva: Crear el Set de números llamados UNA SOLA VEZ para todos los jugadores
    const calledSet = new Set(calledNumbers);

    // Check each player's cards
    for (const player of players) {
        for (const card of player.cards) {
            // Generar bitmask localmente para evitar overhead de llamadas a checkWin
            const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
            let cardMask = (1 << 12);
            
            for (let i = 0; i < 25; i++) {
                if (i === 12) continue;
                if (calledSet.has(flatCard[i])) cardMask |= (1 << i);
            }

            if (pattern.bitmasks.some(mask => (cardMask & mask) === mask)) {
                winners.push({
                    username: player.username,
                    cardId: card.id,
                    pattern: patternType,
                    time: new Date()
                });

                // 🎵 TRIGGER WINNER EVENT IMMEDIATELY
                io.emit('winner_detected', {
                    username: player.username,
                    cardId: card.id,
                    pattern: patternType,
                    calledNumbers: calledNumbers,
                    timestamp: new Date().toISOString()
                });

                // 📢 ADMIN NOTIFICATION
                io.emit('admin_winner_alert', {
                    winner: player.username,
                    cardId: card.id,
                    pattern: BINGO_PATTERNS[patternType].name,
                    numbersCalled: calledNumbers.length
                });

                // 🎉 CELEBRATION EVENT
                io.emit('bingo_celebration', {
                    message: `¡BINGO! ${player.username} ha ganado con ${BINGO_PATTERNS[patternType].name}!`,
                    winner: player.username,
                    pattern: patternType
                });
            }
        }
    }

    return winners;
}

// 📊 PATTERN STATISTICS
function getPatternStats() {
    return {
        totalPatterns: Object.keys(BINGO_PATTERNS).length,
        patternNames: Object.keys(BINGO_PATTERNS),
        patternDetails: BINGO_PATTERNS
    };
}

// 🔧 UTILITY FUNCTIONS
function getPatternByName(name) {
    return BINGO_PATTERNS[name];
}

function listAllPatterns() {
    return Object.keys(BINGO_PATTERNS).map(patternName => ({
        name: patternName,
        displayName: BINGO_PATTERNS[patternName].name,
        description: BINGO_PATTERNS[patternName].description
    }));
}

// 📈 EXPORT THE ENGINE
module.exports = {
    BINGO_PATTERNS,
    validatePattern,
    checkWin: validatePattern,
    getWinningDetails,
    checkForWinners,
    getPatternStats,
    getPatternByName,
    listAllPatterns
};