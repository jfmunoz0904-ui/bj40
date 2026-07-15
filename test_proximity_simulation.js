/**
 * 🧪 SCRIPT DE PRUEBA DE PROXIMIDAD
 * Simula 50 jugadores y verifica la detección de "A 1 número de ganar".
 */

const { io } = require("socket.io-client");
const axios = require("axios");

const SERVER_URL = "http://localhost:3000";
const TOTAL_PLAYERS = 50;
const CALL_DELAY = 50; // ms entre llamadas (rápido para el test)

// ═══════════════════════════════════════════════════════════════
// 🛠️ UTILIDADES (Replicadas del servidor para verificación local)
// ═══════════════════════════════════════════════════════════════
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function generateCard(cardId) {
    const rng = mulberry32(cardId);
    const fillCol = (min, max, count) => {
        const nums = new Set();
        let safety = 0;
        while (nums.size < count && safety < 500) {
            nums.add(Math.floor(rng() * (max - min + 1)) + min);
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

// ═══════════════════════════════════════════════════════════════
// 🚀 LÓGICA DEL TEST
// ═══════════════════════════════════════════════════════════════
async function runTest() {
    console.log(`🚀 Iniciando simulación con ${TOTAL_PLAYERS} jugadores...`);

    // 1. Conectar Admin
    const adminSocket = io(SERVER_URL);
    
    await new Promise(resolve => adminSocket.on('connect', resolve));
    console.log('✅ Admin conectado');

    // Reiniciar juego
    adminSocket.emit('admin_full_reset');
    await new Promise(r => setTimeout(r, 1000)); // Esperar reset

    // 2. Conectar Jugadores
    const players = [];
    const playerSockets = [];

    console.log('🔄 Conectando jugadores...');
    
    for (let i = 1; i <= TOTAL_PLAYERS; i++) {
        const socket = io(SERVER_URL);
        const username = `Bot_${i}`;
        const cardId = i; // Cartón 1 al 50

        socket.emit('join_game', { username, cardIds: [cardId] });
        
        players.push({ username, cardId, socket });
        playerSockets.push(socket);
        
        // Esperar un poco para no saturar conexión inicial
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 100));
    }

    // 3. Aceptar a todos los jugadores (Admin)
    // Escuchamos los eventos de nuevos jugadores en el admin y los aceptamos
    adminSocket.on('new_player_pending', (data) => {
        adminSocket.emit('admin_accept_player', data.id);
    });

    // Esperar a que todos sean aceptados
    console.log('⏳ Esperando aprobación de jugadores...');
    await new Promise(r => setTimeout(r, 3000));

    // 4. Simular Juego (Llamar números)
    console.log('🎲 Comenzando sorteo...');
    
    const calledNumbers = [];
    const availableNumbers = Array.from({length: 75}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    
    let proximityDetected = false;

    for (const num of availableNumbers) {
        if (proximityDetected) break;

        adminSocket.emit('admin_call_number', num);
        calledNumbers.push(num);
        // process.stdout.write(` ${num}`);

        // Verificar API cada 5 números o si ya llevamos varios
        if (calledNumbers.length > 4) {
            try {
                const response = await axios.get(`${SERVER_URL}/api/admin/proximity-report`);
                const report = response.data;

                if (report.length > 0) {
                    console.log(`\n\n🚨 ¡PROXIMIDAD DETECTADA! (${report.length} jugadores)`);
                    console.log(`🔢 Números llamados: ${calledNumbers.length}`);
                    
                    // 5. VERIFICACIÓN
                    let verificationPassed = true;

                    for (const item of report) {
                        const card = generateCard(item.cardId);
                        const needed = item.neededNumbers[0]; // El número que falta
                        
                        // Verificar localmente
                        const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
                        const isMarked = (val) => val === "FREE" || calledNumbers.includes(val);
                        
                        // Verificar que el número que dice la API realmente está en el cartón y NO ha salido
                        const isInCard = flatCard.includes(needed);
                        const hasBeenCalled = calledNumbers.includes(needed);
                        
                        console.log(`   👤 ${item.username} (Cartón #${item.cardId})`);
                        console.log(`      Falta: ${needed}`);
                        
                        if (isInCard && !hasBeenCalled) {
                            console.log(`      ✅ Verificación Local: CORRECTO`);
                        } else {
                            console.log(`      ❌ Verificación Local: FALLÓ (En cartón: ${isInCard}, Llamado: ${hasBeenCalled})`);
                            verificationPassed = false;
                        }
                    }

                    if (verificationPassed) {
                        console.log('\n✨ PRUEBA EXITOSA: El monitor detecta correctamente los jugadores a 1 número.');
                    } else {
                        console.log('\n❌ PRUEBA FALLIDA: Discrepancia en los datos.');
                    }

                    proximityDetected = true;
                    break;
                }
            } catch (error) {
                console.error('Error consultando API:', error.message);
            }
        }

        await new Promise(r => setTimeout(r, CALL_DELAY));
    }

    // Limpieza
    console.log('\n🧹 Limpiando conexiones...');
    playerSockets.forEach(s => s.disconnect());
    adminSocket.disconnect();
    process.exit(0);
}

runTest().catch(console.error);