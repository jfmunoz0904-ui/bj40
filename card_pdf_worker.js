/**
 * @file card_pdf_worker.js
 * @description Worker thread para generar PDFs de cartones de bingo de forma asíncrona.
 * Utiliza pdfkit para una generación de alta calidad sin bloquear el event loop principal.
 */

const { parentPort, workerData } = require('worker_threads');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Lógica Determinística: Réplica exacta del generador mulberry32/generateCard.
 */
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function generateCardData(cardId) {
    const rng = mulberry32(cardId);
    const fillCol = (min, max, count) => {
        const nums = new Set();
        let safety = 0;
        while (nums.size < count && safety < 1000) {
            const n = Math.floor(rng() * (max - min + 1)) + min;
            nums.add(n);
            safety++;
        }
        return Array.from(nums).sort((a, b) => a - b);
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

async function createPDF() {
    const { cardIds, userId } = workerData;
    const tempDir = path.join(__dirname, 'public', 'temp');
    
    // Asegurar que el directorio temporal existe
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fileName = `Bingo-Cartones-${userId}-${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Título Pro
    doc.fontSize(22).fillColor('#333333').text('SUS CARTONES DE BINGO', { align: 'center' });
    doc.fontSize(10).fillColor('#666666').text(`ID de Sesión: ${userId} | Fecha: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    let cardsInPage = 0;
    const COL_WIDTH = 30;
    const CELL_SIZE = 35;
    const MARGIN_X = 180;

    for (const id of cardIds) {
        if (cardsInPage >= 3) {
            doc.addPage();
            cardsInPage = 0;
            doc.fontSize(22).fillColor('#333333').text('SUS CARTONES DE BINGO', { align: 'center' });
            doc.moveDown();
        }

        const card = generateCardData(id);
        const startY = doc.y;

        // Título del cartón
        doc.fontSize(14).fillColor('#8b5cf6').text(`CARTÓN #${id}`, { align: 'center' });
        doc.moveDown(0.5);

        // Header B-I-N-G-O
        const headers = ['B', 'I', 'N', 'G', 'O'];
        const colors = ['#3b82f6', '#d946ef', '#eab308', '#10b981', '#8b5cf6'];
        
        headers.forEach((h, i) => {
            doc.fillColor(colors[i])
               .rect(MARGIN_X + (i * CELL_SIZE), doc.y, CELL_SIZE, CELL_SIZE - 10)
               .fill()
               .fillColor('#FFFFFF')
               .fontSize(12)
               .text(h, MARGIN_X + (i * CELL_SIZE), doc.y + 5, { width: CELL_SIZE, align: 'center' });
        });

        doc.y += CELL_SIZE - 10;

        // Grid del cartón
        for (let row = 0; row < 5; row++) {
            headers.forEach((colKey, colIdx) => {
                const val = card[colKey][row];
                const x = MARGIN_X + (colIdx * CELL_SIZE);
                const y = doc.y;

                doc.fillColor('#f8f9fa')
                   .rect(x, y, CELL_SIZE, CELL_SIZE)
                   .strokeColor('#dee2e6')
                   .lineWidth(0.5)
                   .stroke()
                   .fill();

                doc.fillColor(val === "FREE" ? '#f59e0b' : '#333333')
                   .fontSize(val === "FREE" ? 8 : 12)
                   .text(val === "FREE" ? 'Libre' : val, x, y + 10, { width: CELL_SIZE, align: 'center' });
            });
            doc.y += CELL_SIZE;
        }

        doc.moveDown(3);
        cardsInPage++;
    }

    doc.end();

    stream.on('finish', () => {
        parentPort.postMessage({ success: true, fileName });
    });

    stream.on('error', (err) => {
        parentPort.postMessage({ success: false, error: err.message });
    });
}

createPDF();
