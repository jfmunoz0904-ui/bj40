/**
 * @file export_cards.js
 * @description Script de utilidad para exportar los 300 cartones determinísticos a JSON.
 * Este respaldo garantiza la integridad física de los datos generados algorítmicamente.
 */

const fs = require('fs');
const path = require('path');

/**
 * Generador de números pseudoaleatorios determinístico (mulberry32).
 * @param {number} seed - Semilla inicial basada en el cardId.
 */
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

/**
 * Genera un cartón de bingo basado en su ID siguiendo la lógica exacta de producción.
 * @param {number} cardId - ID del cartón (1-300).
 */
function generateCard(cardId) {
    const rng = mulberry32(cardId);
    const fillCol = (min, max, count) => {
        const nums = new Set();
        let safety = 0;
        while (nums.size < count && safety < 1000) {
            const n = Math.floor(rng() * (max - min + 1)) + min;
            nums.add(n);
            safety++;
        }
        return Array.from(nums);
    };
    
    const colN = fillCol(31, 45, 4);
    return {
        id: cardId,
        B: fillCol(1, 15, 5),
        I: fillCol(16, 30, 5),
        N: [colN[0], colN[1], "FREE", colN[2], colN[3]],
        G: fillCol(46, 60, 5),
        O: fillCol(61, 75, 5)
    };
}

/**
 * Ejecuta la exportación masiva a disco con manejo de errores robusto.
 */
function runExport() {
    const TOTAL_CARDS = 300;
    const cards = [];
    const outputPath = path.join(__dirname, 'bingo_cards_backup.json');

    console.log(`🚀 Generando respaldo físico para ${TOTAL_CARDS} cartones únicos...`);

    try {
        for (let i = 1; i <= TOTAL_CARDS; i++) {
            cards.push(generateCard(i));
        }

        const payload = {
            version: "1.0.0",
            exportDate: new Date().toISOString(),
            total: cards.length,
            cards: cards
        };

        fs.writeFileSync(outputPath, JSON.stringify(payload, null, 4), 'utf8');
        
        console.log(`✅ Éxito: Se ha generado el archivo '${path.basename(outputPath)}' con los 300 cartones.`);
    } catch (err) {
        console.error('❌ Error crítico en exportación:', err.stack);
        process.exit(1);
    }
}

runExport();