/**
 * Test for the new Bingo Rules Engine
 */

const { BINGO_PATTERNS, validatePattern, checkWin, checkForWinners, getPatternStats } = require('./bingo_rules_engine');

// Mock card generation function
function generateMockCard(cardId) {
    return {
        id: cardId,
        B: [1, 15, 30, 45, 60],
        I: [16, 30, 44, 59, 74],
        N: [31, 45, "FREE", 60, 75],
        G: [46, 60, 74, 1, 15],
        O: [61, 75, 2, 16, 30]
    };
}

// Test 1: Verify we have exactly 50 patterns
console.log("=== TEST 1: Pattern Count ===");
const patternStats = getPatternStats();
console.log(`Total patterns: ${patternStats.totalPatterns}`);
console.log(`Expected: 50`);
console.log(`Result: ${patternStats.totalPatterns === 50 ? '✅ PASS' : '❌ FAIL'}`);

// Test 2: Verify pattern structure
console.log("\n=== TEST 2: Pattern Structure ===");
let structureValid = true;
for (const [patternName, pattern] of Object.entries(BINGO_PATTERNS)) {
    if (!pattern.name || !pattern.description || !pattern.positions) {
        console.log(`❌ ${patternName}: Invalid structure`);
        structureValid = false;
    } else {
        console.log(`✅ ${patternName}: Valid structure`);
    }
}
console.log(`Structure validation: ${structureValid ? '✅ PASS' : '❌ FAIL'}`);

// Test 3: Test pattern validation
console.log("\n=== TEST 3: Pattern Validation ===");

// Test with a mock card
const mockCard = generateMockCard(1);
const flatCard = [...mockCard.B, ...mockCard.I, ...mockCard.N, ...mockCard.G, ...mockCard.O];

// Test some patterns with appropriate called numbers
const testCases = [
    {
        pattern: 'corners',
        calledNumbers: [1, 60, 61, 30], // Should match corners (positions 0,4,20,24 contain these values)
        expected: true
    },
    {
        pattern: 'full',
        calledNumbers: [1, 15, 16, 30, 31, 44, 45, 46, 59, 60, 61, 74, 75], // Most numbers
        expected: false // Not all numbers called
    },
    {
        pattern: 'horizontal_1',
        calledNumbers: [1, 16, 31, 46, 61], // First row (positions 0,5,10,15,20 contain these values)
        expected: true
    }
];

let validationPass = true;
for (const testCase of testCases) {
    const result = validatePattern(testCase.pattern, flatCard, testCase.calledNumbers);
    const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
    console.log(`Pattern ${testCase.pattern}: ${status} (Expected: ${testCase.expected}, Got: ${result})`);
    if (result !== testCase.expected) validationPass = false;
}

// Test 4: Test checkWin function
console.log("\n=== TEST 4: CheckWin Function ===");
const winTestCases = [
    {
        pattern: 'corners',
        calledNumbers: [1, 60, 61, 30], // Should win (correct numbers for corners)
        expected: true
    },
    {
        pattern: 'full',
        calledNumbers: [1, 15], // Should not win
        expected: false
    }
];

let winTestPass = true;
for (const testCase of winTestCases) {
    const result = checkWin(mockCard, testCase.calledNumbers, testCase.pattern);
    const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
    console.log(`CheckWin ${testCase.pattern}: ${status} (Expected: ${testCase.expected}, Got: ${result})`);
    if (result !== testCase.expected) winTestPass = false;
}

// Test 5: Test winner detection
console.log("\n=== TEST 5: Winner Detection ===");
const mockPlayers = [
    {
        username: 'Player1',
        cards: [generateMockCard(1), generateMockCard(2)]
    },
    {
        username: 'Player2',
        cards: [generateMockCard(3)]
    }
];

// Mock io object
const mockIo = {
    emit: (event, data) => {
        console.log(`📢 Event emitted: ${event}`, data);
    }
};

const winners = checkForWinners(mockPlayers, [1, 60, 61, 30], 'corners', mockIo);
console.log(`Winners found: ${winners.length}`);
console.log(`Winner detection: ${winners.length > 0 ? '✅ PASS' : '❌ FAIL'}`);

// Test 6: List all patterns
console.log("\n=== TEST 6: Pattern Listing ===");
const allPatterns = Object.keys(BINGO_PATTERNS);
console.log(`All patterns (${allPatterns.length}):`);
allPatterns.forEach(patternName => {
    const pattern = BINGO_PATTERNS[patternName];
    console.log(`- ${patternName}: ${pattern.name} (${pattern.description})`);
});

// Summary
console.log("\n=== TEST SUMMARY ===");
console.log(`Pattern Count: ${patternStats.totalPatterns === 50 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Pattern Structure: ${structureValid ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Pattern Validation: ${validationPass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`CheckWin Function: ${winTestPass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Winner Detection: ${winners.length > 0 ? '✅ PASS' : '❌ FAIL'}`);

const overallPass = patternStats.totalPatterns === 50 && structureValid && validationPass && winTestPass;
console.log(`\nOVERALL RESULT: ${overallPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

module.exports = {
    testResults: {
        patternCount: patternStats.totalPatterns === 50,
        structureValid,
        validationPass,
        winTestPass,
        overallPass
    }
};