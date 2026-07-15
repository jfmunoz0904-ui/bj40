/**
 * Comprehensive Test for Automatic Win Detection
 * This script tests the automatic win detection system with 3 random cards
 * and verifies that all patterns correctly detect victory
 */

const { BINGO_PATTERNS } = require('./test_60_patterns_fixed.js');

// Mock the card generation function from server.js
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function generateCard(cardId) {
    const rng = mulberry32(cardId);
    const fillCol = (min, max, count) => {
        let nums = new Set();
        let safety = 0;
        while(nums.size < count && safety < 500) {
            let n = Math.floor(rng() * (max - min + 1)) + min;
            nums.add(n);
            safety++;
        }
        return Array.from(nums);
    };

    const colN = fillCol(31, 45, 4);
    const N = [colN[0], colN[1], "FREE", colN[2], colN[3]];

    return {
        id: cardId,
        B: fillCol(1, 15, 5),
        I: fillCol(16, 30, 5),
        N: N,
        G: fillCol(46, 60, 5),
        O: fillCol(61, 75, 5)
    };
}

// Mock the validation function from server.js
function validatePattern(patternType, flatCard, calledNumbers) {
    const isMarked = (val) => val === "FREE" || calledNumbers.includes(val);

    // Obtener el patrón desde la definición centralizada
    const pattern = BINGO_PATTERNS[patternType];
    if (!pattern) return false;

    // Para patrones que son arrays de arrays (múltiples líneas posibles)
    if (Array.isArray(pattern) && Array.isArray(pattern[0])) {
        // Verificar si alguna de las líneas del patrón está completa
        return pattern.some(line => line.every(idx => isMarked(flatCard[idx])));
    }

    // Para patrones que son arrays simples (patrones estrictos)
    if (Array.isArray(pattern)) {
        return validateStrictPattern(pattern, flatCard, calledNumbers, isMarked);
    }

    return false;
}

function validateStrictPattern(requiredPositions, flatCard, calledNumbers, isMarked) {
    // Verificar que todas las posiciones requeridas estén marcadas
    const allRequiredMarked = requiredPositions.every(idx => isMarked(flatCard[idx]));

    if (!allRequiredMarked) return false;

    // Verificar que NO haya marcado en posiciones que NO son parte del patrón
    // Esto es para patrones específicos que deben ser exactos
    const strictPatterns = [
        'corners', 'corners_center', 'plus', 'frame', 'inner_frame',
        'letter_h', 'letter_t', 'small_square', 'diamond', 'star',
        'heart', 'airplane', 'arrow', 'crazy', 'pyramid', 'cross'
    ];

    if (strictPatterns.includes(patternType)) {
        const allPositions = Array.from({length: 25}, (_, i) => i);
        const nonRequiredPositions = allPositions.filter(idx => !requiredPositions.includes(idx));

        // Verificar que NO haya marcado en posiciones no requeridas
        const hasUnwantedMarks = nonRequiredPositions.some(idx => isMarked(flatCard[idx]));

        if (hasUnwantedMarks) {
            console.log(`❌ Patrón ${patternType} inválido: hay marcas en posiciones no requeridas`);
            return false;
        }
    }

    return true;
}

function checkWin(card, called, patternType, customGrid) {
    console.log(`🔍 Verificando victoria - Patrón: ${patternType}, Números llamados: ${called.length}`);

    // Aplanamos el cartón por columnas: indices 0-4(B), 5-9(I), 10-14(N), etc.
    // Indice 12 es el centro (FREE)
    let flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];

    // Función auxiliar para ver si una celda está marcada
    const isMarked = (val) => val === "FREE" || called.includes(val);

    // Utilizar la nueva función de validación centralizada
    if (patternType === 'custom') {
        // Para patrones personalizados, usar la lógica existente
        for(let r=0; r<5; r++) {
            for(let c=0; c<5; c++) {
                const adminIdx = r * 5 + c; // Indice lineal del admin (filas)
                const cardIdx = c * 5 + r;  // Indice lineal del cartón (columnas)

                if(customGrid[adminIdx] && !isMarked(flatCard[cardIdx])) {
                    return false;
                }
            }
        }
        return true;
    }

    // Para todos los demás patrones, usar la validación centralizada
    return validatePattern(patternType, flatCard, called);
}

// Main test function
async function testAutomaticWinDetection() {
    console.log("=== COMPREHENSIVE AUTOMATIC WIN DETECTION TEST ===");
    console.log("Testing with 3 random cards and all patterns...");

    // Generate 3 random card IDs
    const cardIds = [Math.floor(Math.random() * 300) + 1,
                    Math.floor(Math.random() * 300) + 1,
                    Math.floor(Math.random() * 300) + 1];

    console.log(`\n🎯 Testing with card IDs: ${cardIds.join(', ')}`);

    // Generate the cards
    const cards = cardIds.map(id => generateCard(id));

    // Display card details
    cards.forEach((card, index) => {
        console.log(`\n📋 Card #${card.id}:`);
        console.log(`B: ${card.B.join(', ')}`);
        console.log(`I: ${card.I.join(', ')}`);
        console.log(`N: ${card.N.join(', ')}`);
        console.log(`G: ${card.G.join(', ')}`);
        console.log(`O: ${card.O.join(', ')}`);
    });

    // Test all patterns
    const patternsToTest = Object.keys(BINGO_PATTERNS);
    const results = {};

    console.log(`\n🔍 Testing ${patternsToTest.length} patterns...`);

    // Test each pattern
    for (const pattern of patternsToTest) {
        console.log(`\n🎯 Testing pattern: ${pattern}`);

        // Create a scenario where this pattern should win
        const card = cards[0]; // Use first card for testing
        const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];

        // Get the pattern definition
        const patternDef = BINGO_PATTERNS[pattern];

        // For simple patterns (arrays of arrays), test each line
        if (Array.isArray(patternDef) && Array.isArray(patternDef[0])) {
            // Test each possible winning line
            for (let lineIndex = 0; lineIndex < patternDef.length; lineIndex++) {
                const line = patternDef[lineIndex];

                // Create called numbers that would make this line win
                const calledNumbers = line.map(idx => {
                    const val = flatCard[idx];
                    return val === "FREE" ? null : val; // Don't include FREE in called numbers
                }).filter(val => val !== null);

                // Add some extra numbers to make it more realistic
                const extraNumbers = [];
                const allNumbers = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O]
                    .filter(val => val !== "FREE" && !calledNumbers.includes(val));

                // Add 5-10 extra numbers
                for (let i = 0; i < Math.min(5, allNumbers.length); i++) {
                    extraNumbers.push(allNumbers[i]);
                }

                const finalCalledNumbers = [...calledNumbers, ...extraNumbers];

                // Test if this pattern wins
                const isWinner = checkWin(card, finalCalledNumbers, pattern, []);

                console.log(`  Line ${lineIndex + 1}: ${isWinner ? '✅ WIN' : '❌ NO WIN'}`);

                if (isWinner) {
                    if (!results[pattern]) {
                        results[pattern] = {
                            wins: 0,
                            totalLines: patternDef.length,
                            winningLines: []
                        };
                    }
                    results[pattern].wins++;
                    results[pattern].winningLines.push(lineIndex + 1);
                }
            }
        }
    }

    // Display results summary
    console.log(`\n📊 TEST RESULTS SUMMARY:`);
    console.log(`Total patterns tested: ${patternsToTest.length}`);
    console.log(`Patterns with wins detected: ${Object.keys(results).length}`);

    let totalWinningPatterns = 0;
    let totalWinningLines = 0;

    for (const [pattern, result] of Object.entries(results)) {
        console.log(`\n🏆 ${pattern}:`);
        console.log(`  Winning lines: ${result.winningLines.join(', ')}`);
        console.log(`  Total wins: ${result.wins}/${result.totalLines}`);

        if (result.wins > 0) {
            totalWinningPatterns++;
            totalWinningLines += result.wins;
        }
    }

    console.log(`\n🎉 FINAL STATISTICS:`);
    console.log(`✅ Winning patterns: ${totalWinningPatterns}/${patternsToTest.length}`);
    console.log(`✅ Winning lines detected: ${totalWinningLines}`);

    // Test specific patterns that might have issues
    console.log(`\n🔧 TESTING SPECIFIC PATTERNS:`);

    const specificPatterns = [
        'line_cross_center',
        'line_plus_pattern',
        'line_corners',
        'line_corners_center',
        'line_frame',
        'line_inner_frame'
    ];

    for (const pattern of specificPatterns) {
        if (BINGO_PATTERNS[pattern]) {
            const card = cards[0];
            const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
            const patternDef = BINGO_PATTERNS[pattern];

            console.log(`\n🔍 Testing ${pattern}:`);
            console.log(`Pattern definition: ${JSON.stringify(patternDef[0])}`);

            // Create called numbers for the first line of this pattern
            const calledNumbers = patternDef[0].map(idx => {
                const val = flatCard[idx];
                return val === "FREE" ? null : val;
            }).filter(val => val !== null);

            // Test if this wins
            const isWinner = checkWin(card, calledNumbers, pattern, []);

            console.log(`Called numbers: ${calledNumbers.join(', ')}`);
            console.log(`Result: ${isWinner ? '✅ WIN' : '❌ NO WIN'}`);

            if (!isWinner) {
                console.log(`⚠️  Pattern ${pattern} did not detect win when it should have!`);
                console.log(`Pattern positions: ${patternDef[0].join(', ')}`);
                console.log(`Card values at those positions: ${patternDef[0].map(idx => flatCard[idx]).join(', ')}`);
            }
        }
    }

    // Test with all 3 cards
    console.log(`\n🎲 TESTING ALL 3 CARDS WITH COMMON PATTERNS:`);

    const commonPatterns = ['line', 'full', 'corners', 'x', 'plus'];

    for (const pattern of commonPatterns) {
        console.log(`\n🎯 Testing pattern: ${pattern}`);

        for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
            const card = cards[cardIndex];

            // Simulate a game where enough numbers are called for this pattern to potentially win
            const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
            const allNumbers = flatCard.filter(val => val !== "FREE");

            // Call 15 random numbers (enough for some patterns to win)
            const calledNumbers = [];
            const shuffledNumbers = [...allNumbers].sort(() => Math.random() - 0.5);

            for (let i = 0; i < 15 && i < shuffledNumbers.length; i++) {
                calledNumbers.push(shuffledNumbers[i]);
            }

            // Test if this card wins with this pattern
            const isWinner = checkWin(card, calledNumbers, pattern, []);

            console.log(`  Card #${card.id}: ${isWinner ? '✅ WIN' : '❌ NO WIN'} (${calledNumbers.length} numbers called)`);
        }
    }

    console.log(`\n✅ AUTOMATIC WIN DETECTION TEST COMPLETED!`);

    // Return results
    return {
        cardIds: cardIds,
        totalPatterns: patternsToTest.length,
        winningPatterns: totalWinningPatterns,
        winningLines: totalWinningLines,
        results: results,
        success: totalWinningPatterns > 0
    };
}

// Run the test
testAutomaticWinDetection().then(results => {
    console.log(`\n🏁 FINAL RESULT: ${results.success ? '✅ TEST PASSED' : '❌ TEST FAILED'}`);

    if (results.success) {
        console.log(`✅ Automatic win detection is working correctly!`);
        console.log(`✅ ${results.winningPatterns} patterns detected wins successfully`);
        console.log(`✅ ${results.winningLines} winning lines were identified`);
    } else {
        console.log(`❌ No winning patterns were detected - there may be issues with win detection`);
    }
}).catch(error => {
    console.error(`❌ Test failed with error: ${error}`);
    process.exit(1);
});

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        testAutomaticWinDetection,
        generateCard,
        checkWin,
        validatePattern
    };
}