/**
 * @file server.js
 * @description Punto de entrada principal para el Servidor de Producción Yovanny Bingo.
 * Todas las funcionalidades integradas y optimizadas
 */

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { z } = require('zod');
const pino = require('pino');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const webpush = require('web-push');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const bingoEngine = require('./bingo_rules_engine');

// Carga de variables de entorno con validación de existencia
dotenv.config();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = express();
const server = http.createServer(app);

// 📝 Configuración de Morgan con Pino para logs de acceso
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

const io = new Server(server, {
    cors: { 
        origin: process.env.ALLOWED_ORIGINS?.split(',') || "http://localhost:3000",
        credentials: true 
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// 🌐 CONFIGURACIÓN REDIS ADAPTER PARA ESCALADO HORIZONTAL
if (process.env.REDIS_URL) {
    logger.info('🔌 Intentando conectar a Redis Adapter...');
    const pubClient = createClient({ 
        url: process.env.REDIS_URL,
        socket: {
            connectTimeout: 10000,
            reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
        }
    });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => logger.error('❌ Redis Pub Error:', err));
    subClient.on('error', (err) => logger.error('❌ Redis Sub Error:', err));

    Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('🚀 Redis Adapter conectado para Socket.io');
        })
        .catch(err => {
            logger.error('⚠️ Fallo al conectar Redis Adapter. El servidor continuará en modo local:', err.message);
        });
}

app.use(express.json());
app.use(express.static('public', {
    maxAge: '1d',
    etag: true
}));

// 🛡️ SEGURIDAD DE PRODUCCIÓN CON HELMET
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://cdn.jsdelivr.net"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
        },
    },
}));

// 🚦 LIMITACIÓN DE TASA PARA RUTAS DE AUTENTICACIÓN
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Límite general
    skip: (req) => req.path === '/api/login' || req.path === '/api/register', // Auth tiene su propio límite
    message: { error: 'Demasiadas solicitudes, intente de nuevo más tarde' },
    standardHeaders: true,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 15, // Límite estricto de intentos de login/registro
    message: { error: 'Demasiados intentos desde esta IP, intente de nuevo en 15 minutos' },
    standardHeaders: true,
});

// 🛡️ SCHEMAS DE VALIDACIÓN (ZOD)
const RegisterSchema = z.object({
    username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
    email: z.string().email(),
    password: z.string().min(8)
});

const LoginSchema = z.object({
    username: z.string(),
    password: z.string()
});

// ═══════════════════════════════════════════════════════════════
// 🔐 CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    ADMIN_PASS: process.env.ADMIN_PASS || "admin123",
    TOTAL_CARDS: parseInt(process.env.TOTAL_CARDS) || 300,
    MONGO_URI: process.env.MONGO_URI,
    PORT: process.env.PORT || 3000,
    AUTO_PLAY_DELAY: 5000,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY
};

if (!process.env.ADMIN_PASS) console.warn('⚠️ ALERTA: Usando ADMIN_PASS por defecto.');

if (CONFIG.VAPID_PUBLIC_KEY && CONFIG.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:admin@yovannybingo.com',
        CONFIG.VAPID_PUBLIC_KEY,
        CONFIG.VAPID_PRIVATE_KEY
    );
}

// ═══════════════════════════════════════════════════════════════
// 🗄️ CONEXIÓN MONGODB
// ═══════════════════════════════════════════════════════════════
/**
 * Establece la conexión persistente con MongoDB Atlas.
 * Implementa una estrategia de reintento para garantizar la resiliencia en entornos cloud (AWS/Heroku).
 */
const connectDB = async () => {
    try {
        if (!CONFIG.MONGO_URI) throw new Error('MONGO_URI no definida');

        const conn = await mongoose.connect(CONFIG.MONGO_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });

        logger.info(`✅ Base de datos conectada en ${conn.connection.host}`);

        await loadGameState();
    } catch (error) {
        logger.error(`❌ Error Crítico de Conexión DB: ${error.stack}`);
        setTimeout(connectDB, 5000); // Reintento exponencial en entorno real
    }
};

// ═══════════════════════════════════════════════════════════════
// 📊 ESQUEMAS MONGOOSE
// ═══════════════════════════════════════════════════════════════
const PlayerSchema = new mongoose.Schema({
    username: { type: String, required: true, trim: true, maxlength: 50, index: true },
    cardIds: [{ type: Number, min: 1, max: CONFIG.TOTAL_CARDS }],
    isActive: { type: Boolean, default: true },
    socketId: { type: String, default: null },
    pushSubscription: { type: Object, default: null },
    createdAt: { type: Date, default: Date.now },
    stats: {
        totalGames: { type: Number, default: 0 },
        wins: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        lastWinDate: { type: Date, default: null },
        currentStreak: { type: Number, default: 0 },
        maxStreak: { type: Number, default: 0 },
        totalPoints: { type: Number, default: 0 },
        patternsWon: { type: Object, default: {} },
        favoriteNumbers: { type: [Number], default: [] },
        totalPlayTime: { type: Number, default: 0 }
    },
    level: {
        current: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
        expToNext: { type: Number, default: 100 }
    },
    achievements: [{
        name: String,
        earnedAt: { type: Date, default: Date.now }
    }],
    settings: {
        theme: { type: String, default: 'dark' },
        soundVolume: { type: Number, default: 100 },
        autoMark: { type: Boolean, default: true },
        notifications: { type: Boolean, default: true }
    },
    gameHistory: [{
        date: { type: Date, default: Date.now },
        pattern: String,
        won: Boolean,
        points: Number,
        numbersCalled: Number
    }]
});

PlayerSchema.index({ cardIds: 1 });
PlayerSchema.index({ isActive: 1 });

const Player = mongoose.model('Player', PlayerSchema);

// Modelo User: cuentas registradas (logros y stats persistentes)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, trim: true, maxlength: 50, unique: true },
    email: { type: String, required: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    pushSubscription: { type: Object, default: null },
    createdAt: { type: Date, default: Date.now },
    stats: {
        totalGames: { type: Number, default: 0 },
        wins: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        lastWinDate: { type: Date, default: null },
        currentStreak: { type: Number, default: 0 },
        maxStreak: { type: Number, default: 0 },
        totalPoints: { type: Number, default: 0 },
        patternsWon: { type: Object, default: {} },
        favoriteNumbers: { type: [Number], default: [] },
        totalPlayTime: { type: Number, default: 0 }
    },
    level: {
        current: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
        expToNext: { type: Number, default: 100 }
    },
    achievements: [{ name: String, earnedAt: { type: Date, default: Date.now } }],
});
const User = mongoose.model('User', UserSchema);

// ═══════════════════════════════════════════════════════════════
// 🎨 ESQUEMA DE PREFERENCIAS (MEJORA 3)
// ═══════════════════════════════════════════════════════════════
const UserPreferencesSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    theme: { type: String, default: 'dark', enum: ['dark', 'light', 'party', 'night', 'classic', 'neon', 'ocean', 'forest'] },
    soundProfile: { type: String, default: 'balanced', enum: ['muted', 'balanced', 'loud', 'custom'] },
    customSounds: {
        bingo: String,
        numberCall: String,
        playerJoin: String,
        alert: String
    },
    animations: { type: Boolean, default: true },
    cardLayout: { type: String, default: 'grid', enum: ['grid', 'list', 'compact', 'carousel'] },
    fontSize: { type: String, default: 'medium', enum: ['small', 'medium', 'large', 'xlarge'] },
    colorBlindMode: { type: Boolean, default: false },
    notifications: {
        proximityAlerts: { type: Boolean, default: true },
        winNotifications: { type: Boolean, default: true },
        friendOnline: { type: Boolean, default: true }
    },
    accessibility: {
        highContrast: { type: Boolean, default: false },
        screenReader: { type: Boolean, default: false },
        keyboardShortcuts: { type: Boolean, default: true }
    },
    autoMark: { type: Boolean, default: true },
    showStats: { type: Boolean, default: true },
    language: { type: String, default: 'es', enum: ['es', 'en', 'fr', 'de', 'it', 'pt'] },
    // WCAG Fields (Socket.IO sync)
    visualEffects: { type: Boolean, default: true },
    bgStyle: { type: String, default: 'liquid' },
    voiceGender: { type: String, default: 'male', enum: ['male', 'female'] },
    voiceVolume: { type: Number, default: 80, min: 0, max: 100 },
    specificVoice: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const UserPreferences = mongoose.model('UserPreferences', UserPreferencesSchema);

// Modelo GameState: Persistencia del estado del juego
const GameStateSchema = new mongoose.Schema({
    calledNumbers: [Number],
    pattern: String,
    customPattern: [Boolean],
    last5Numbers: [Number],
    last5Winners: [],
    message: String,
    gameId: String,
    status: { type: String, enum: ['active', 'finished'], default: 'active' },
    currentWinner: {
        username: String,
        cardId: Number,
        patternName: String,
        calledNumbers: [Number]
    },
    winnersLog: { type: Array, default: [] },
    winnerDetectedPauseAuto: { type: Boolean, default: false },
    // 🏆 CONFIGURACIÓN DE PREMIOS (DINÁMICO)
    prizes: {
        line: { type: Number, default: 0 },
        fourCorners: { type: Number, default: 0 },
        special: { type: Number, default: 0 },
        bingo: { type: Number, default: 0 }
    },
    gameSession: {
        id: String,
        winners: [String],
        winningCards: [Number],
        lastWinnerTime: Number,
        cooldown: Number
    },
    updatedAt: { type: Date, default: Date.now }
});
const GameState = mongoose.model('GameState', GameStateSchema);

// ═══════════════════════════════════════════════════════════════
// 📝 REGISTRO MANUAL DE JUEGOS E INGRESOS (CONTABILIDAD ADMIN)
// ═══════════════════════════════════════════════════════════════
const GameReportSchema = new mongoose.Schema({
    gameTitle: { type: String, default: "Partida de Bingo" },
    totalIncome: { type: Number, default: 0 },
    observations: String,
    date: { type: Date, default: Date.now }
});
const GameReport = mongoose.model('GameReport', GameReportSchema);

// ═══════════════════════════════════════════════════════════════
//  MANAGER DE ESTADO DE PRODUCCIÓN (SINGLETON)
// ═══════════════════════════════════════════════════════════════
/**
 * Centraliza la mutación del estado del juego.
 * Previene condiciones de carrera y asegura que las actualizaciones de estado 
 * sean atómicas antes de la persistencia en MongoDB.
 */
class GameManager {
    constructor() {
        this.state = {
            calledNumbers: [],
            pattern: 'line',
            customPattern: [],
            last5Numbers: [],
            last5Winners: [],
            message: "¡BIENVENIDOS AL BINGO YOVANNY!",
            isAutoPlaying: false,
            status: 'active',
            currentWinner: null,
            winnersLog: [],
            winnerDetectedPauseAuto: false,
            autoPlayInterval: null,
            gameId: Date.now().toString(),
            isPaused: false
        };
    }

    /**
     * Reinicia el estado para una nueva ronda.
     * Limpia memorias volátiles pero mantiene la configuración de sesión.
     */
    reset() {
        this.state.calledNumbers = [];
        this.state.last5Numbers = [];
        this.state.last5Winners = [];
        this.state.status = 'active';
        this.state.currentWinner = null;
        this.state.winnersLog = [];
        this.state.winnerDetectedPauseAuto = false;
        this.state.gameId = Date.now().toString();
        console.log(`♻️ Estado del juego reiniciado. Nuevo GameID: ${this.state.gameId}`);
    }

    /**
     * Añade un número al sorteo con validación de duplicados.
     * @param {number} num - Número entre 1 y 75.
     * @returns {boolean} - true si el número fue añadido, false si era duplicado.
     */
    addNumber(num) {
        if (this.state.calledNumbers.includes(num)) return false;
        this.state.calledNumbers.push(num);
        this.state.last5Numbers.unshift(num);
        if (this.state.last5Numbers.length > 5) this.state.last5Numbers.pop();
        return true;
    }
}

const game = new GameManager();
let gameState = game.state;

let gameSession = {
    id: Date.now().toString(),
    winners: new Set(),
    winningCards: new Set(),
    lastWinnerTime: 0,
    cooldown: 2000
};

// ═══════════════════════════════════════════════════════════════
// 💾 PERSISTENCIA DEL ESTADO
// ═══════════════════════════════════════════════════════════════
/**
 * Sincroniza el estado de la aplicación con la persistencia.
 */
const saveGameState = async () => {
    try {
        // Excluir el objeto circular Timeout de Node.js del estado antes de guardar
        const { autoPlayInterval, ...stateToSave } = gameState;
        
        const payload = {
            ...stateToSave,
            gameSession: {
                ...gameSession,
                winners: Array.from(gameSession.winners),
                winningCards: Array.from(gameSession.winningCards)
            },
            updatedAt: new Date()
        };
        await GameState.findOneAndUpdate({}, payload, { upsert: true, setDefaultsOnInsert: true });
    } catch (err) {
        console.error('Error Crítico Persistencia:', err);
    }
};

async function loadGameState() {
    try {
        const saved = await GameState.findOne({});
        if (saved) {
            gameState.calledNumbers = saved.calledNumbers || [];
            gameState.pattern = saved.pattern || 'line';
            gameState.patternName = saved.currentWinner?.patternName || 
                                   (bingoEngine.getPatternByName(saved.pattern)?.name) || 
                                   (saved.pattern === 'custom' ? 'Personalizado' : saved.pattern);
            gameState.customPattern = saved.customPattern || [];
            gameState.last5Numbers = saved.last5Numbers || [];
            gameState.winnersLog = saved.winnersLog || [];
            gameState.winnerDetectedPauseAuto = saved.winnerDetectedPauseAuto || false;
            gameState.prizes = saved.prizes || { line: 0, fourCorners: 0, special: 0, bingo: 0 };

            if (saved.gameSession) {
                gameSession.id = saved.gameSession.id;
                gameSession.winners = new Set(saved.gameSession.winners);
                gameSession.winningCards = new Set(saved.gameSession.winningCards);
                gameSession.lastWinnerTime = saved.gameSession.lastWinnerTime;
                gameSession.cooldown = saved.gameSession.cooldown;
            }
            console.log('📂 Estado del juego recuperado de MongoDB');
        }
    } catch (e) { console.error('❌ Error cargando estado:', e.message); }
}

// Jugadores en memoria
let sessionMap = new Map();      // uuid -> { username, cardIds }
let pendingPlayers = new Map();  // socketId -> datos del jugador
let takenCards = new Set();      // Cartones ocupados
const chatRateLimit = new Map(); // socketId -> timestamp
const CHAT_COOLDOWN = 1500;      // 1.5 segundos entre mensajes
const messageBuffer = [];        // Redis-like buffer para persistencia rápida
const MAX_BUFFER_SIZE = 50;

// ═══════════════════════════════════════════════════════════════
// 🎲 GENERADOR DE CARTONES DETERMINÍSTICO
// ═══════════════════════════════════════════════════════════════
/**
 * Generador de Cartones Determinístico.
 * Garantiza que el mismo ID siempre produzca la misma matriz de números.
 */
const mulberry32 = (seed) => {
    return () => {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const generateCard = (cardId) => {
    // Forzar semilla basada en el ID del cartón para inmutabilidad
    const rng = mulberry32(cardId);
    const fill = (min, max, count) => {
        const s = new Set();
        while (s.size < count) s.add(Math.floor(rng() * (max - min + 1)) + min);
        // RESTAURACIÓN: Se elimina el sort para recuperar el orden original de los cartones entregados
        return Array.from(s);
    };
    const colN = fill(31, 45, 4);
    return {
        id: cardId,
        B: fill(1, 15, 5),
        I: fill(16, 30, 5),
        N: [colN[0], colN[1], "FREE", colN[2], colN[3]],
        G: fill(46, 60, 5),
        O: fill(61, 75, 5)
    };
};

// ═══════════════════════════════════════════════════════════════
// ✅ VALIDACIÓN DE PATRONES
// ═══════════════════════════════════════════════════════════════
function checkWin(card, calledNumbers, patternType, customPattern = []) {
    // Manejar patrón personalizado localmente (ya que depende de customPattern dinámico)
    if (patternType === 'custom' && customPattern.length > 0) {
        const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
        const isMarked = (val) => val === "FREE" || calledNumbers.includes(val);
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const adminIdx = r * 5 + c;
                const cardIdx = c * 5 + r;
                if (customPattern[adminIdx] && !isMarked(flatCard[cardIdx])) {
                    return false;
                }
            }
        }
        return true;
    }

    // Delegar al motor de reglas para patrones estándar (asegurando cartón plano)
    const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
    return bingoEngine.checkWin(patternType, flatCard, calledNumbers);
}

// ═══════════════════════════════════════════════════════════════
// 📊 FUNCIONES DE BASE DE DATOS
// ═══════════════════════════════════════════════════════════════
async function getActivePlayersFromDB() {
    try {
        return await Player.find({ isActive: true }).lean() || [];
    } catch (error) {
        console.error('❌ Error obteniendo jugadores:', error);
        return [];
    }
}

async function getTakenCardsFromDB() {
    try {
        const players = await Player.find({ isActive: true }).lean();
        const cardsSet = new Set();
        players.forEach(p => {
            if (p.cardIds) p.cardIds.forEach(id => cardsSet.add(id));
        });
        return cardsSet;
    } catch (error) {
        console.error('❌ Error obteniendo cartones:', error);
        return new Set();
    }
}

async function addPlayerToDB(username, cardIds, socketId = null) {
    try {
        const player = new Player({ username, cardIds, socketId });
        await player.save();
        console.log(`✅ Jugador agregado: ${username} con cartones ${cardIds.join(', ')}`);
        return player;
    } catch (error) {
        console.error('❌ Error agregando jugador:', error);
        throw error;
    }
}

async function syncTakenCards() {
    try {
        takenCards = await getTakenCardsFromDB();
        console.log(`✅ Cartones ocupados sincronizados: ${takenCards.size}`);
        io.emit('occupied_cards', Array.from(takenCards));
        
        // Emitir disponibilidad inmediata a todos los administradores
        io.emit('card_availability', {
            takenCards: Array.from(takenCards),
            availableCount: CONFIG.TOTAL_CARDS - takenCards.size,
            usedCount: takenCards.size
        });
    } catch (error) {
        console.error('❌ Error sincronizando cartones:', error);
    }
}

async function updateFavoriteNumbers(player) {
    try {
        if (!player.cardIds || player.cardIds.length === 0) return;
        const freq = {};
        for (const id of player.cardIds) {
            const card = generateCard(id);
            const nums = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O].filter(n => n !== 'FREE');
            nums.forEach(n => freq[n] = (freq[n] || 0) + 1);
        }
        player.stats.favoriteNumbers = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(e => parseInt(e[0]));
    } catch (error) {
        console.error('❌ Error actualizando números favoritos:', error);
    }
}

async function updatePlayerStats(username, winData) {
    try {
        const player = await Player.findOne({ username });
        if (!player) return;

        player.stats.totalGames++;

        if (winData) {
            player.stats.wins++;
            player.stats.lastWinDate = new Date();
            player.stats.currentStreak++;

            if (player.stats.currentStreak > player.stats.maxStreak) {
                player.stats.maxStreak = player.stats.currentStreak;
            }

            player.stats.winRate = (player.stats.wins / player.stats.totalGames) * 100;

            // Actualizar patrones ganados
            const pKey = winData.pattern;
            if (!player.stats.patternsWon) player.stats.patternsWon = {};
            player.stats.patternsWon[pKey] = (player.stats.patternsWon[pKey] || 0) + 1;

            await updateFavoriteNumbers(player);

            const pattern = bingoEngine.getPatternByName(winData.pattern);
            const multiplier = pattern?.multiplier || 1.0;
            const speedBonus = Math.max(1.0, (75 - gameState.calledNumbers.length) / 25);
            const points = Math.round(100 * multiplier * speedBonus);

            player.stats.totalPoints += points;
            player.level.exp += Math.floor(points / 10);

            while (player.level.exp >= player.level.expToNext) {
                player.level.exp -= player.level.expToNext;
                player.level.current++;
                player.level.expToNext = Math.floor(player.level.expToNext * 1.2);
                console.log(`🎉 ${username} subió al nivel ${player.level.current}!`);
            }

            // Agregar logros
            const unlocked = checkAchievements(player, winData);
            for (const name of unlocked) {
                const s = Array.from(io.sockets.sockets.values()).find(x => x.data?.username === player.username);
                if (s) s.emit('achievement_unlocked', { name });
            }
        } else {
            player.stats.currentStreak = 0;
        }

        // Estimación de tiempo de juego (5 seg por número llamado aprox)
        player.stats.totalPlayTime += Math.round((gameState.calledNumbers.length * 5) / 60);

        player.gameHistory.push({
            date: new Date(),
            pattern: winData?.pattern || gameState.pattern,
            won: !!winData,
            points: winData ? Math.round(100 * (bingoEngine.getPatternByName(winData.pattern)?.multiplier || 1)) : 0,
            numbersCalled: gameState.calledNumbers.length
        });

        if (player.gameHistory.length > 50) {
            player.gameHistory = player.gameHistory.slice(-50);
        }

        await player.save();

        // Sincronizar con User si existe (cuenta registrada)
        try {
            const user = await User.findOne({ username: player.username.trim().toLowerCase() });
            if (user) {
                user.stats = { ...user.stats.toObject(), ...player.stats.toObject() };
                user.level = { ...user.level.toObject(), ...player.level.toObject() };
                const mergedAch = [...(user.achievements || [])];
                for (const a of player.achievements || []) {
                    if (!mergedAch.some(x => x.name === a.name)) mergedAch.push(a);
                }
                user.achievements = mergedAch;
                await user.save();
            }
        } catch (e) { /* ignorar */ }
    } catch (error) {
        console.error('❌ Error actualizando estadísticas:', error);
    }
}

/**
 * Actualiza las estadísticas persistentes del jugador.
 * Gestiona victorias, rachas, puntos, experiencia (EXP) y niveles.
 */
async function updatePlayerStats(username, winData) {
    try {
        if (!username) return;
        const normalizedUsername = username.trim().toLowerCase();
        
        // Buscar en usuarios registrados (User) o jugadores temporales (Player)
        let player = await User.findOne({ username: normalizedUsername });
        let model = User;
        
        if (!player) {
            player = await Player.findOne({ username });
            model = Player;
        }

        if (!player) return;

        // 1. Victoria y rachas
        player.stats.wins += 1;
        player.stats.totalGames += 1;
        player.stats.lastWinDate = new Date();
        player.stats.currentStreak += 1;
        if (player.stats.currentStreak > player.stats.maxStreak) {
            player.stats.maxStreak = player.stats.currentStreak;
        }

        // 2. Win Rate
        player.stats.winRate = Math.round((player.stats.wins / player.stats.totalGames) * 100);

        // 3. Puntos (Basado en el patrón y números llamados)
        const patternMult = bingoEngine.getPatternByName(winData.pattern)?.multiplier || 1.0;
        const rewardPoints = Math.round((100 / winData.numbersCalled) * patternMult * 10);
        player.stats.totalPoints += rewardPoints;

        // 4. Progresión de Niveles (EXP)
        const expGain = 50 + (rewardPoints / 2); // 50 base + bonus por puntos
        player.level.exp += Math.round(expGain);

        while (player.level.exp >= player.level.expToNext) {
            player.level.exp -= player.level.expToNext;
            player.level.current += 1;
            player.level.expToNext = player.level.current * 100;
            console.log(`✨ ¡${player.username} subió al nivel ${player.level.current}!`);
        }

        // 5. Registro de Patrones
        if (!player.stats.patternsWon) player.stats.patternsWon = {};
        player.stats.patternsWon[winData.pattern] = (player.stats.patternsWon[winData.pattern] || 0) + 1;

        // 6. Verificar Logros
        const unlocked = checkAchievements(player, winData);
        
        await player.save();

        // Notificar al cliente si está conectado
        const socket = Array.from(io.sockets.sockets.values()).find(s => s.data.username === username);
        if (socket) {
            socket.emit('player_stats_updated', {
                stats: player.stats,
                level: player.level,
                newAchievements: unlocked
            });
            if (unlocked.length > 0) {
                socket.emit('achievements_unlocked', { achievements: unlocked });
            }
        }

    } catch (error) {
        console.error('❌ Error actualizando estadísticas:', error);
    }
}

function checkAchievements(player, winData) {
    const newAchievements = [];

    if (player.stats.wins === 1) newAchievements.push('Primera Victoria');
    if (player.stats.wins === 10) newAchievements.push('Veterano');
    if (player.stats.wins === 50) newAchievements.push('Maestro del Bingo');
    if (player.stats.wins === 100) newAchievements.push('Leyenda');

    if (player.stats.currentStreak === 3) newAchievements.push('Racha de 3');
    if (player.stats.currentStreak === 5) newAchievements.push('Imparable');
    if (player.stats.currentStreak === 10) newAchievements.push('Invencible');

    if (winData && winData.pattern === 'full') newAchievements.push('Blackout');
    if (winData && winData.pattern === 'heart') newAchievements.push('Corazón de Oro');
    if (winData && winData.pattern === 'star') newAchievements.push('Estrella Brillante');

    if (gameState.calledNumbers.length <= 15) newAchievements.push('Velocista');
    if (gameState.calledNumbers.length <= 10) newAchievements.push('Rayo');

    const unlocked = [];
    for (const name of newAchievements) {
        if (!player.achievements.some(a => a.name === name)) {
            player.achievements.push({ name, earnedAt: new Date() });
            unlocked.push(name);
            console.log(`🏆 Logro desbloqueado para ${player.username}: ${name}`);
        }
    }
    return unlocked;
}

// ═══════════════════════════════════════════════════════════════
// 🔍 DETECCIÓN AUTOMÁTICA DE GANADORES
// ═══════════════════════════════════════════════════════════════
async function checkForAutomaticWinners() {
    const now = Date.now();
    if (now - gameSession.lastWinnerTime < gameSession.cooldown) return;

    // Optimizacion: Solo verificar si hay una partida activa y números llamados
    if (gameState.calledNumbers.length === 0) return;

    // Obtener todos los jugadores activos conectados
    const sockets = Array.from(io.sockets.sockets.values());
    const connectedPlayers = sockets
        .filter(s => s.data.username && s.data.cardIds?.length > 0)
        .map(s => ({ username: s.data.username, cardIds: s.data.cardIds, socketId: s.id }));

    // Obtener jugadores de la base de datos que están activos
    const dbPlayers = await Player.find({ isActive: true, cardIds: { $exists: true, $not: { $size: 0 } } }).lean();
    const connectedUsernames = new Set(connectedPlayers.map(p => p.username));

    // Filtrar jugadores de DB que no están conectados
    const dbPlayersList = dbPlayers
        .filter(p => !connectedUsernames.has(p.username))
        .map(p => ({ username: p.username, cardIds: p.cardIds, type: 'database' }));

    // Combinar listas de verificación
    const allCheckList = [...connectedPlayers, ...dbPlayersList];

    const currentWinners = [];

    for (const player of allCheckList) {
        // Se elimina la restricción de victoria única por jugador para permitir múltiples bingos simultáneos con diferentes cartones
        // if (gameSession.winners.has(player.username)) continue;

        for (const cardId of player.cardIds) {
            if (gameSession.winningCards.has(cardId)) continue;
            // Solo verificar si el cartón está en takenCards (sincronizado)
            if (!takenCards.has(cardId)) continue;

            const card = generateCard(cardId);
            const hasWon = checkWin(card, gameState.calledNumbers, gameState.pattern, gameState.customPattern);

            if (hasWon) {
                currentWinners.push({ player, cardId, card });
            }
        }
    }

    if (currentWinners.length > 0) {
        // Detener modo automático al detectar ganador
        if (gameState.isAutoPlaying) {
            gameState.winnerDetectedPauseAuto = true;
            if (gameState.autoPlayInterval) {
                clearInterval(gameState.autoPlayInterval);
                gameState.autoPlayInterval = null;
            }
            gameState.isAutoPlaying = false;
            io.emit('auto_play_stopped');
            console.log('⏹️ Tiro automático detenido por BINGO');
        }

        gameSession.lastWinnerTime = Date.now();
        const winnersData = [];

        for (const win of currentWinners) {
            const { player, cardId, card } = win;
            
            // Doble verificación para evitar duplicados en el mismo lote
            if (gameSession.winningCards.has(cardId)) continue;

            const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
            const winningDetails = bingoEngine.getWinningDetails(gameState.pattern, flatCard, gameState.calledNumbers, gameState.customPattern);

            const winData = {
                user: player.username,
                card: cardId,
                cardGrid: flatCard,
                winningIndices: winningDetails ? winningDetails.indices : [],
                time: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }),
                numbersCalled: gameState.calledNumbers.length,
                pattern: gameState.pattern,
                patternName: bingoEngine.getPatternByName(gameState.pattern)?.name || (gameState.pattern === 'custom' ? 'Personalizado' : gameState.pattern)
            };

            gameSession.winners.add(player.username);
            gameSession.winningCards.add(cardId);

            // Persistencia del ganador principal para sincronización de reconexión
            const logEntry = {
                username: player.username,
                cardId: cardId,
                patternName: winData.patternName,
                calledNumbers: [...gameState.calledNumbers]
            };
            if (!gameState.winnersLog) gameState.winnersLog = [];
            gameState.winnersLog.push(logEntry);
            gameState.currentWinner = gameState.winnersLog[0];

            gameState.last5Winners.unshift(winData);
            if (gameState.last5Winners.length > 50) gameState.last5Winners.pop();

            await updatePlayerStats(player.username, winData);
            winnersData.push(winData);
        }

        await saveGameState();
        io.emit('bingo_audio', { playSound: true });
        io.emit('update_history', gameState.last5Winners);

        // Lógica de Multibingo vs Bingo Normal
        if (winnersData.length > 1) {
            console.log(`🏆 ¡MULTIBINGO! ${winnersData.length} ganadores.`);
            io.emit('multibingo', { winners: winnersData });
            io.emit('bingo_celebration', {
                message: `¡MULTIBINGO! ${winnersData.length} GANADORES SIMULTÁNEOS!`,
                winners: winnersData
            });
        } else if (winnersData.length === 1) {
            const w = winnersData[0];
            console.log(`🏆 ¡GANADOR AUTOMÁTICO! ${w.user} con cartón #${w.card}`);
            io.emit('winner_announced', w);
            io.emit('nuevo_ganador', w);
            io.emit('bingo_declarado', w); // 🏆 NUEVO EVENTO GLOBAL OBLIGATORIO
            io.emit('bingo_celebration', {
                message: `¡BINGO! ${w.user} con cartón #${w.card}`,
                winner: w
            });
        }

        // Enviar detalles de cartones para todos los ganadores (para admin y pantallas)
        for (const win of currentWinners) {
            const wd = winnersData.find(w => w.card === win.cardId);
            if (wd) {
                io.emit('winner_card_details', {
                    username: win.player.username,
                    cardId: win.cardId,
                    card: win.card,
                    calledNumbers: [...gameState.calledNumbers],
                    pattern: gameState.pattern,
                    patternName: wd.patternName,
                    customPattern: gameState.customPattern,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
}

function resetWinnerManagement() {
    gameSession = {
        id: Date.now().toString(),
        winners: new Set(),
        winningCards: new Set(),
        lastWinnerTime: 0,
        cooldown: 2000
    };
    gameState.gameId = gameSession.id;
}

// ═══════════════════════════════════════════════════════════════
// 🚨 DETECCIÓN DE PROXIMIDAD (ASISTENTE)
// ═══════════════════════════════════════════════════════════════
async function checkForProximity() {
    const sockets = Array.from(io.sockets.sockets.values());

    for (const socket of sockets) {
        if (!socket.data.username || !socket.data.cardIds) continue;

        for (const cardId of socket.data.cardIds) {
            if (gameSession.winningCards.has(cardId)) continue;

            const card = generateCard(cardId);
            const analysis = getCardAnalysis(card, gameState.calledNumbers, gameState.pattern, gameState.customPattern);

            if (analysis.missing === 1) {
                socket.emit('assistant_proximity_alert', {
                    cardId: cardId,
                    missing: 1,
                    pattern: gameState.pattern,
                    message: "🔥 ¡A 1 número de ganar!"
                });
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 🧠 ASISTENTE INTELIGENTE (Lógica de MEJORA_2)
// ═══════════════════════════════════════════════════════════════
function getCardAnalysis(card, calledNumbers, patternType, customPattern) {
    const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
    const isMarked = (val) => val === "FREE" || calledNumbers.includes(val);

    let minMissing = 25;
    let totalToMark = 0;
    let markedCount = 0;
    let bestNeededNumbers = [];

    if (patternType === 'custom' && customPattern && customPattern.length > 0) {
        let currentMissing = 0;
        let currentTotal = 0;
        let currentMarked = 0;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const adminIdx = r * 5 + c;
                const cardIdx = c * 5 + r;
                if (customPattern[adminIdx]) {
                    currentTotal++;
                    if (isMarked(flatCard[cardIdx])) currentMarked++;
                    else {
                        currentMissing++;
                        if (currentMissing === 1) bestNeededNumbers.push(flatCard[cardIdx]);
                    }
                }
            }
        }
        minMissing = currentMissing;
        totalToMark = currentTotal;
        markedCount = currentMarked;
        // Si faltan más de 1, la lista bestNeededNumbers podría no ser exacta aquí sin lógica extra, 
        // pero para missing===1 funciona bien.
    } else {
        const pattern = bingoEngine.getPatternByName(patternType);
        if (!pattern || !pattern.positions) return { cardId: card.id, missing: 25, status: 'Desconocido' };

        for (const line of pattern.positions) {
            let currentMissing = 0;
            let currentTotal = 0;
            let currentMarked = 0;
            let currentNeeded = [];
            for (const idx of line) {
                currentTotal++;
                if (isMarked(flatCard[idx])) currentMarked++;
                else {
                    currentMissing++;
                    currentNeeded.push(flatCard[idx]);
                }
            }
            if (currentMissing < minMissing) {
                minMissing = currentMissing;
                totalToMark = currentTotal;
                markedCount = currentMarked;
                bestNeededNumbers = currentNeeded;
            }
        }
    }

    const percentage = totalToMark > 0 ? (markedCount / totalToMark) * 100 : 0;
    let status = 'Normal';
    if (minMissing === 0) status = '¡GANADOR!';
    else if (minMissing === 1) status = '🔥 ¡A 1 número!';
    else if (minMissing <= 2) status = '⚠️ Muy cerca';
    else if (percentage > 75) status = '✅ Excelente';

    return {
        cardId: card.id,
        missing: minMissing,
        percentage: Math.round(percentage),
        status,
        neededNumbers: bestNeededNumbers
    };
}

// ═══════════════════════════════════════════════════════════════
// 🎯 FUNCIONES DE UTILIDAD
// ═══════════════════════════════════════════════════════════════
async function getActivePlayers() {
    const connected = Array.from(io.sockets.sockets.values())
        .filter(s => s.data.username)
        .map(s => ({
            id: s.id,
            name: s.data.username,
            cardCount: s.data.cardIds?.length || 0,
            cardIds: s.data.cardIds || [],
            status: 'online',
            stats: s.data.stats || {},
            level: s.data.level || { current: 1 }
        }));

    // También incluir jugadores de la DB que están activos pero no conectados
    try {
        const dbPlayers = await Player.find({ isActive: true }).lean();
        const dbPlayersList = dbPlayers
            .filter(p => {
                // Solo incluir si no está ya en la lista de conectados
                const isConnected = connected.some(c => c.name === p.username);
                return !isConnected;
            })
            .map(p => ({
                id: `db_${p._id}`,
                name: p.username,
                cardCount: p.cardIds?.length || 0,
                status: 'offline',
                cardIds: p.cardIds
            }));

        return [...connected, ...dbPlayersList];
    } catch (error) {
        console.error('Error obteniendo jugadores de DB:', error);
        return connected;
    }
}

function getPendingPlayers() {
    return Array.from(pendingPlayers.entries()).map(([socketId, p]) => ({
        id: socketId,
        name: p.username,
        cardCount: p.cardIds.length,
        cardIds: p.cardIds,
        timestamp: p.timestamp
    }));
}

// ═══════════════════════════════════════════════════════════════
// 🌐 ENDPOINTS HTTP
// ═══════════════════════════════════════════════════════════════
app.post('/admin-login', (req, res) => {
    res.json({ success: CONFIG.ADMIN_PASS && req.body.password === CONFIG.ADMIN_PASS });
});

app.get('/api/patterns', (req, res) => {
    const patterns = Object.entries(bingoEngine.BINGO_PATTERNS).map(([key, val]) => ({
        id: key,
        name: val.name,
        description: val.description,
        multiplier: val.multiplier || 1.0
    }));
    res.json(patterns);
});

// 🩺 RUTA DE SALUD (HEALTH CHECK) PARA RAILWAY
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/api/stats/:username', async (req, res) => {
    try {
        const u = (req.params.username || '').trim().toLowerCase();
        const user = await User.findOne({ username: u });
        if (user) {
            return res.json({ stats: user.stats, level: user.level, achievements: user.achievements || [] });
        }
        const player = await Player.findOne({ username: req.params.username.trim() });
        if (player) {
            return res.json({ stats: player.stats, level: player.level, achievements: player.achievements || [] });
        }
        res.status(404).json({ error: 'Jugador no encontrado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/player-stats/:username', async (req, res) => {
    try {
        const username = req.params.username.trim();
        // Intentar buscar en usuarios registrados primero
        let statsData = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });

        // Si no, buscar en jugadores activos/temporales
        if (!statsData) {
            statsData = await Player.findOne({ username });
        }

        if (!statsData) {
            return res.status(404).json({ message: 'No hay estadísticas disponibles para este jugador', stats: null });
        }

        const stats = statsData.stats;
        const avgGameTime = stats.totalGames > 0 ? Math.round(stats.totalPlayTime / stats.totalGames) : 0;

        res.json({
            ...statsData.toObject(),
            stats: {
                ...statsData.stats.toObject(), // Asegurar que es objeto plano
                avgGameTime
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/stats/summary', async (req, res) => {
    try {
        const totalPlayers = await User.countDocuments();
        const activePlayers = await Player.countDocuments({ isActive: true });
        const totalWinsResult = await User.aggregate([{ $group: { _id: null, total: { $sum: "$stats.wins" } } }]);
        const totalWins = totalWinsResult[0]?.total || 0;

        // Calcular win rate promedio de usuarios con al menos 1 juego
        const avgWinRateResult = await User.aggregate([
            { $match: { "stats.totalGames": { $gt: 0 } } },
            { $group: { _id: null, avg: { $avg: "$stats.winRate" } } }
        ]);
        const avgWinRate = Math.round(avgWinRateResult[0]?.avg || 0);

        res.json({
            totalPlayers,
            activePlayers,
            totalWins,
            avgWinRate,
            topPlayers: await User.find().sort({ "stats.wins": -1 }).limit(5).select('username stats.wins level')
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        // Registered users (more reliable data)
        const users = await User.find({ 'stats.totalGames': { $gt: 0 } })
            .sort({ 'stats.wins': -1 })
            .limit(limit)
            .select('username stats level')
            .lean();

        // Active players (guests or those not yet registered)
        const players = await Player.find({ 'stats.totalGames': { $gt: 0 } })
            .sort({ 'stats.wins': -1 })
            .limit(limit)
            .select('username stats level')
            .lean();

        // Merge: registered users take priority; add players not already in list
        const seen = new Set(users.map(u => u.username.toLowerCase()));
        const combined = [
            ...users,
            ...players.filter(p => !seen.has(p.username.toLowerCase()))
        ];

        // Sort merged list by wins descending
        combined.sort((a, b) => (b.stats?.wins || 0) - (a.stats?.wins || 0));

        res.json(combined.slice(0, limit));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/assist/suggestions/:username', async (req, res) => {
    try {
        const username = req.params.username.trim();
        // Buscar jugador (incluso si está offline pero activo en DB)
        const player = await Player.findOne({ username });

        if (!player || !player.cardIds || player.cardIds.length === 0) {
            return res.json({ suggestions: [] });
        }

        const analysis = player.cardIds.map(id => {
            const card = generateCard(id);
            return getCardAnalysis(card, gameState.calledNumbers, gameState.pattern, gameState.customPattern);
        });

        // Ordenar por proximidad a la victoria (menos números faltantes primero)
        analysis.sort((a, b) => a.missing - b.missing || b.percentage - a.percentage);

        res.json({ pattern: gameState.pattern, suggestions: analysis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find({ isActive: true })
            .sort({ 'stats.totalPoints': -1 })
            .limit(10)
            .select('username stats.totalPoints stats.wins level.current');
        res.json(players);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint actualizado para incluir los números específicos que faltan
app.get('/api/admin/proximity-report', async (req, res) => {
    try {
        // 1. Obtener jugadores conectados
        const connectedPlayers = Array.from(io.sockets.sockets.values())
            .filter(s => s.data.username && s.data.cardIds?.length > 0)
            .map(s => ({ username: s.data.username, cardIds: s.data.cardIds, source: 'online' }));

        // 2. Obtener jugadores de DB (offline pero activos)
        const dbPlayers = await getActivePlayersFromDB();
        const connectedUsernames = new Set(connectedPlayers.map(p => p.username));

        const dbPlayersList = dbPlayers
            .filter(p => !connectedUsernames.has(p.username) && p.cardIds && p.cardIds.length > 0)
            .map(p => ({ username: p.username, cardIds: p.cardIds, source: 'offline' }));

        const allPlayers = [...connectedPlayers, ...dbPlayersList];
        const closePlayers = [];

        for (const player of allPlayers) {
            for (const cardId of player.cardIds) {
                if (gameSession.winningCards.has(cardId)) continue;
                if (!takenCards.has(cardId)) continue;

                const card = generateCard(cardId);
                const analysis = getCardAnalysis(card, gameState.calledNumbers, gameState.pattern, gameState.customPattern);

                if (analysis.missing === 1) {
                    closePlayers.push({
                        username: player.username,
                        cardId: cardId,
                        missing: 1,
                        neededNumbers: analysis.neededNumbers, // Nuevo campo
                        pattern: gameState.pattern,
                        status: player.source
                    });
                }
            }
        }

        res.json(closePlayers.sort((a, b) => a.username.localeCompare(b.username)));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user-preferences/:username', async (req, res) => {
    try {
        const username = req.params.username.trim();
        let prefs = await UserPreferences.findOne({ username });

        if (!prefs) {
            // Crear preferencias por defecto si no existen
            prefs = new UserPreferences({ username });
            await prefs.save();
        }

        res.json(prefs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user-preferences/:username', async (req, res) => {
    try {
        const username = req.params.username.trim();
        const updates = req.body;

        const prefs = await UserPreferences.findOneAndUpdate(
            { username },
            { ...updates, updatedAt: new Date() },
            { new: true, upsert: true }
        );

        // Notificar cambios en tiempo real si el usuario está conectado
        const socket = Array.from(io.sockets.sockets.values()).find(s => s.data?.username === username);
        if (socket) {
            socket.emit('preferences_updated', prefs);
        }

        res.json(prefs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Procesa el registro de nuevos usuarios.
 * Implementa hash de contraseña con factor de costo 12 y sanitización estricta de nombres.
 */
app.post('/api/register', authLimiter, async (req, res, next) => {
    try {
        const { username, email, password } = RegisterSchema.parse(req.body);
        const sanitizedUser = username.toLowerCase();

        const exists = await User.findOne({ 
            $or: [{ username: sanitizedUser }, { email: email.toLowerCase() }] 
        });

        if (exists) return res.status(409).json({ error: 'Usuario o Email ya registrado' });

        const hash = await bcrypt.hash(password, 12);
        await User.create({ 
            username: sanitizedUser, 
            email: email.toLowerCase(), 
            passwordHash: hash 
        });

        res.status(201).json({ success: true, user: sanitizedUser });
    } catch (err) {
        if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
        logger.error(`Error en Registro: ${err.stack}`);
        next(err);
    }
});

app.post('/api/update-profile', async (req, res) => {
    try {
        const { currentUsername, newUsername, newPassword } = req.body || {};
        if (!currentUsername) return res.status(400).json({ error: 'Usuario actual requerido' });

        const userLower = currentUsername.trim().toLowerCase();
        const user = await User.findOne({ username: userLower });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const updates = {};

        // Cambio de nombre
        if (newUsername && newUsername.trim().toLowerCase() !== userLower) {
            const desired = newUsername.trim().toLowerCase();
            if (desired.length < 2) return res.status(400).json({ error: 'Nombre demasiado corto' });

            const existing = await User.findOne({ username: desired });
            if (existing) return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });

            updates.username = desired;
        }

        // Cambio de contraseña
        if (newPassword) {
            if (newPassword.length < 4) return res.status(400).json({ error: 'Contraseña demasiado corta' });
            updates.passwordHash = await bcrypt.hash(newPassword, 10);
        }

        if (Object.keys(updates).length === 0) {
            return res.json({ success: true, message: 'No hay cambios pendientes' });
        }

        // Aplicar actualizaciones
        if (updates.username) {
            // Actualizar en cascada (Cuidado: esto escala con el volumen de datos)
            await Player.updateMany({ username: currentUsername }, { username: updates.username });
            user.username = updates.username;
        }
        if (updates.passwordHash) {
            user.passwordHash = updates.passwordHash;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Perfil actualizado correctamente',
            username: user.username
        });

    } catch (e) {
        res.status(500).json({ error: e.message || 'Error al actualizar perfil' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }
        const user = await User.findOne({ username: username.trim().toLowerCase() });
        if (!user) return res.status(401).json({ error: 'El usuario no existe en la base de datos' });
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'La contraseña es incorrecta' });
        res.json({
            success: true,
            username: user.username,
            stats: user.stats,
            level: user.level,
            achievements: user.achievements || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Error al iniciar sesión' });
    }
});

/**
 * Endpoint para obtener estadísticas detalladas de un jugador.
 */
app.get('/api/stats/:username', async (req, res) => {
    try {
        const username = req.params.username.trim().toLowerCase();
        let player = await User.findOne({ username });
        
        if (!player) {
            player = await Player.findOne({ username: req.params.username });
        }

        if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

        res.json({
            username: player.username,
            stats: player.stats,
            level: player.level,
            achievements: player.achievements || []
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

/**
 * Endpoint para obtener el ranking global de jugadores (Top 100).
 */
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topPlayers = await User.find({}, {
            username: 1,
            stats: 1,
            level: 1
        })
        .sort({ "stats.wins": -1, "stats.totalPoints": -1 })
        .limit(100)
        .lean();

        res.json(topPlayers);
    } catch (err) {
        res.status(500).json({ error: 'Error al generar ranking' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { username, email } = req.body || {};
        if (!username || !email) {
            return res.status(400).json({ error: 'Usuario y correo requeridos' });
        }
        const user = await User.findOne({
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase()
        });
        if (!user) {
            return res.status(404).json({ error: 'Los datos no coinciden con ninguna cuenta' });
        }
        res.json({ success: true, message: 'Datos verificados' });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Error en el servidor' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { username, email, newPassword } = req.body || {};
        if (!username || !email || !newPassword) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
        }

        const user = await User.findOne({
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase()
        });

        if (!user) {
            return res.status(401).json({ error: 'Verificación fallida' });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Error al restablecer contraseña' });
    }
});

app.get('/api/active-game/:username', async (req, res) => {
    try {
        await syncTakenCards();
        const username = (req.params.username || '').trim().toLowerCase();
        const player = await Player.findOne({ username, isActive: true }).lean();
        if (!player || !player.cardIds || player.cardIds.length === 0) {
            return res.json({ hasGame: false, cardIds: [] });
        }
        const allTaken = Array.from(takenCards);
        const valid = player.cardIds.every(id => allTaken.includes(id));
        if (!valid) return res.json({ hasGame: false, cardIds: [] });
        res.json({ hasGame: true, cardIds: player.cardIds });
    } catch (e) {
        res.status(500).json({ hasGame: false, cardIds: [] });
    }
});

app.get('/api/vapid-public-key', (req, res) => {
    if (CONFIG.VAPID_PUBLIC_KEY) {
        res.send(CONFIG.VAPID_PUBLIC_KEY);
    } else {
        res.status(500).send('VAPID public key no configurada en el servidor.');
    }
});

app.post('/api/subscribe', async (req, res) => {
    const { subscription, username } = req.body;
    if (!subscription || !username) {
        return res.status(400).json({ error: 'Faltan datos de suscripción o usuario.' });
    }

    try {
        const userLower = username.trim().toLowerCase();
        // Guardar en el jugador activo y en la cuenta de usuario registrada
        await Player.findOneAndUpdate({ username }, { pushSubscription: subscription });
        await User.findOneAndUpdate({ username: userLower }, { pushSubscription: subscription });

        console.log(`📲 Suscripción Push guardada para ${username}`);

        // Enviar una notificación de bienvenida
        const payload = JSON.stringify({
            title: '¡Suscripción Exitosa!',
            body: 'Ahora recibirás notificaciones de Yovanny Bingo.',
            icon: '/logo.png'
        });
        await webpush.sendNotification(subscription, payload);

        res.status(201).json({ message: 'Suscripción guardada.' });
    } catch (error) {
        console.error('Error guardando suscripción:', error);
        res.status(500).json({ error: 'Error al guardar la suscripción.' });
    }
});

app.get('/api/export-winners', (req, res) => {
    try {
        const headers = ['Usuario', 'Carton', 'Hora', 'Patron', 'Numeros Llamados'];
        const rows = gameState.last5Winners.map(w => [
            w.user, w.card, w.time, w.patternName || w.pattern, w.numbersCalled
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        res.header('Content-Type', 'text/csv');
        res.attachment(`ganadores_bingo_${Date.now()}.csv`);
        res.send(csvContent);
    } catch (e) { res.status(500).send('Error exportando CSV'); }
});

// ═══════════════════════════════════════════════════════════════
// 🔌 SOCKET.IO EVENTOS
// ═══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log(`[AUTH] 🔌 Nueva conexión: ${socket.id}`);

    // Heartbeat check
    socket.conn.on('packet', (packet) => {
        if (packet.type === 'pong') socket.data.lastSeen = Date.now();
    });

    // 🔄 RECONEXIÓN POR UUID (Session Recovery)
    socket.on('rejoin_session', (uuid) => {
        if (sessionMap.has(uuid)) {
            const session = sessionMap.get(uuid);
            socket.data.username = session.username;
            socket.data.cardIds = session.cardIds;
            socket.data.uuid = uuid;
            
            console.log(`🔄 Sesión recuperada para: ${session.username} (${uuid})`);
            const cards = session.cardIds.map(id => generateCard(id));
            socket.emit('reconnection_success', { cards, username: session.username });
        } else {
            socket.emit('session_expired');
        }
    });

    /**
     * Helper para sincronización total centralizada.
     * Garantiza que los patrones personalizados se compartan correctamente.
     */
    function getSyncState() {
        const patternInfo = bingoEngine.getPatternByName(gameState.pattern);
        const allPatterns = Object.keys(bingoEngine.BINGO_PATTERNS).map(k => ({
            id: k,
            name: bingoEngine.BINGO_PATTERNS[k].name,
            description: bingoEngine.BINGO_PATTERNS[k].description || '',
            positions: bingoEngine.BINGO_PATTERNS[k].positions || [],
            multiplier: bingoEngine.BINGO_PATTERNS[k].multiplier || 1
        }));

        const isCustom = gameState.pattern === 'custom' || (gameState.customPattern && gameState.customPattern.length > 0);
        
        if (isCustom) {
            const customIndices = Array.isArray(gameState.customPattern) 
                ? gameState.customPattern.map((v, i) => {
                    if (!v) return -1;
                    const row = Math.floor(i / 5);
                    const col = i % 5;
                    return (col * 5 + row);
                }).filter(idx => idx !== -1)
                : [];
            
            allPatterns.push({
                id: 'custom',
                name: 'Personalizado',
                description: 'Figura creada manualmente por el administrador',
                positions: [customIndices],
                multiplier: 1
            });
        }

        // Excluir timers para evitar error de referencias circulares por websockets
        const { autoPlayInterval, ...safeState } = gameState;

        return {
            ...safeState,
            customPattern: gameState.customPattern, // Asegurar envío explícito del array de 25 bools
            patternName: patternInfo?.name || (gameState.pattern === 'custom' ? 'Personalizado' : gameState.pattern),
            patternPositions: patternInfo?.positions || (isCustom ? [gameState.customPattern.map((v, i) => {
                if (!v) return -1;
                const row = Math.floor(i / 5);
                const col = i % 5;
                return (col * 5 + row);
            }).filter(idx => idx !== -1)] : []),
            patterns: allPatterns
        };
    }

    // 🔄 SINCRONIZACIÓN TOTAL AL CONECTAR
    socket.emit('sync_state', getSyncState());
    
    // Actualizar listas inmediatamente
    socket.emit('update_pending_players', getPendingPlayers());
    getActivePlayers().then(players => socket.emit('update_players', players));
    socket.emit('occupied_cards', Array.from(takenCards));
    
    // Enviar disponibilidad de cartones al Admin
    socket.emit('card_availability', {
        takenCards: Array.from(takenCards),
        availableCount: CONFIG.TOTAL_CARDS - takenCards.size,
        usedCount: takenCards.size
    });

    // ─────────────────────────────────────────────────────────────
    // JUGADOR: Unirse al juego
    // ─────────────────────────────────────────────────────────────
    socket.on('join_game', async (data) => {
        try {
            let ids = [];
            if (Array.isArray(data.cardIds)) ids = data.cardIds;
            else if (typeof data.cardIds === 'string') {
                ids = data.cardIds.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
            } else if (typeof data.cardIds === 'number') {
                ids = [data.cardIds];
            }

            ids = ids.filter(id => id >= 1 && id <= CONFIG.TOTAL_CARDS);
            if (ids.length === 0) return;

            // Evitar spam de solicitudes del mismo socket
            if (pendingPlayers.has(socket.id)) {
                 socket.emit('waiting_approval', {
                    message: `Ya tienes una solicitud pendiente. Espera al administrador.`
                });
                return;
            }

            await syncTakenCards();
            const duplicates = ids.filter(id => takenCards.has(id));

            if (duplicates.length > 0) {
                socket.emit('join_error', {
                    message: `Cartón(es) #${duplicates.join(', #')} ya en uso`
                });
                return;
            }

            pendingPlayers.set(socket.id, {
                username: data.username,
                cardIds: ids,
                socket: socket,
                timestamp: Date.now()
            });

            io.emit('update_pending_players', getPendingPlayers());
            io.emit('player_joined', { id: socket.id, username: data.username });
            io.emit('new_player_pending', { id: socket.id, name: data.username, cardCount: ids.length });

            socket.emit('waiting_approval', {
                message: `Esperando aprobación... (${ids.length} cartones)`
            });

        } catch (error) {
            console.error('Error en join_game:', error);
            socket.emit('join_error', { message: 'Error al procesar solicitud' });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // WCAG: Sincronización Pura de Preferencias
    // ─────────────────────────────────────────────────────────────
    socket.on('update_preferences', async (data) => {
        try {
            if (!data.username) return;
            const username = data.username.trim();
            const updates = {
                visualEffects: data.visualEffects,
                notifications: data.notifications,
                bgStyle: data.bgStyle,
                voiceGender: data.voiceGender,
                voiceVolume: data.voiceVolume,
                specificVoice: data.specificVoice
            };

            await UserPreferences.findOneAndUpdate(
                { username },
                { $set: updates, updatedAt: new Date() },
                { new: true, upsert: true }
            );

            console.log(`[WCAG] Preferencias actualizadas vía Socket para: ${username}`);
            socket.emit('preferences_updated', { success: true });
        } catch (error) {
            console.error('Error guardando preferencias (Socket):', error);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // JUGADOR: Reconexión
    // ─────────────────────────────────────────────────────────────
    socket.on('reconnect_player', async (data) => {
        const { username, cardIds } = data;
        await syncTakenCards();

        const isValid = cardIds.every(id => takenCards.has(id));

        if (isValid) {
            socket.data = { username, cardIds };

            // Actualizar socketId en DB para respaldo del chat
            try {
                await Player.findOneAndUpdate({ username }, { socketId: socket.id, isActive: true });
            } catch (e) { console.error('Error updating socketId:', e); }

            const cards = cardIds.map(id => generateCard(id));
            socket.emit('reconnection_success', { cards });
            io.emit('update_players', getActivePlayers());
            console.log(`✅ ${username} reconectado`);
        } else {
            socket.emit('reconnection_failed', { message: 'Cartones no disponibles' });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // JUGADOR: Gritar Bingo
    // ─────────────────────────────────────────────────────────────
    socket.on('bingo_shout', async () => {
        const { username, cardIds } = socket.data || {};
        if (!cardIds?.length) return;

        let hasWonAny = false;

        for (const cardId of cardIds) {
            const card = generateCard(cardId);
            if (checkWin(card, gameState.calledNumbers, gameState.pattern, gameState.customPattern)) {
                hasWonAny = true;
                
                // Detener modo automático si un jugador canta bingo válido
                if (gameState.isAutoPlaying) {
                    gameState.winnerDetectedPauseAuto = true;
                    if (gameState.autoPlayInterval) {
                        clearInterval(gameState.autoPlayInterval);
                        gameState.autoPlayInterval = null;
                    }
                    gameState.isAutoPlaying = false;
                    io.emit('auto_play_stopped');
                }

                const flatCard = [...card.B, ...card.I, ...card.N, ...card.G, ...card.O];
                const winningDetails = bingoEngine.getWinningDetails(gameState.pattern, flatCard, gameState.calledNumbers, gameState.customPattern);

                const winData = {
                    user: username,
                    card: cardId,
                    cardGrid: flatCard,
                    winningIndices: winningDetails ? winningDetails.indices : [],
                    time: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }),
                    pattern: gameState.pattern,
                    patternName: bingoEngine.getPatternByName(gameState.pattern)?.name || (gameState.pattern === 'custom' ? 'Personalizado' : gameState.pattern)
                };

                const isDup = gameState.last5Winners.some(w => w.user === username && w.card === cardId);
                if (!isDup) {
                    gameState.last5Winners.unshift(winData);
                    if (gameState.last5Winners.length > 50) gameState.last5Winners.pop();
                    
                    const logEntry = {
                        username: username,
                        cardId: cardId,
                        patternName: winData.patternName,
                        calledNumbers: [...gameState.calledNumbers]
                    };
                    if (!gameState.winnersLog) gameState.winnersLog = [];
                    gameState.winnersLog.push(logEntry);
                    gameState.currentWinner = gameState.winnersLog[0];
                }

                await updatePlayerStats(username, winData);
                saveGameState();

                io.emit('winner_announced', winData);
                io.emit('nuevo_ganador', winData);
                io.emit('bingo_declarado', winData); // 🏆 NUEVO EVENTO GLOBAL OBLIGATORIO
                // También enviar el evento bingo_celebration para activar sonidos/confetti extra
                io.emit('bingo_celebration', {
                    message: `¡BINGO! ${username} con cartón #${cardId}`,
                    winner: winData
                });
            }
        }

        if (!hasWonAny) {
            socket.emit('invalid_bingo');
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Llamar número
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_call_number', (num) => {
        if (num < 1 || num > 75) {
            socket.emit('admin_error', { message: `Número inválido: ${num}` });
            return;
        }

        const added = game.addNumber(num);
        if (!added) {
            socket.emit('admin_error', { message: `El ${num} ya fue llamado` });
            return;
        }

        saveGameState();
        io.emit('number_called', {
            num,
            last5: gameState.last5Numbers,
            totalCalled: gameState.calledNumbers.length,
            pattern: gameState.pattern
        });

        // Verificar ganadores automáticos después de un breve delay
        setTimeout(async () => {
            await checkForAutomaticWinners();
            await checkForProximity();
        }, 200);
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Deshacer último número
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_undo_number', () => {
        if (gameState.calledNumbers.length === 0) {
            socket.emit('admin_error', { message: 'No hay números para deshacer' });
            return;
        }

        const lastNum = gameState.calledNumbers.pop();
        const idx = gameState.last5Numbers.indexOf(lastNum);
        if (idx !== -1) gameState.last5Numbers.splice(idx, 1);

        console.log(`🔙 Deshecho número ${lastNum}`);

        saveGameState();
        io.emit('number_undone', {
            number: lastNum,
            calledNumbers: gameState.calledNumbers,
            last5: gameState.last5Numbers,
            totalCalled: gameState.calledNumbers.length
        });
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Establecer patrón
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_set_pattern', (data) => {
        gameState.pattern = data.type;
        if (data.type === 'custom' && data.grid) {
            gameState.customPattern = data.grid;
        }

        // Resetear ganadores cuando se cambia el patrón
        resetWinnerManagement();

        const patternInfo = bingoEngine.getPatternByName(data.type);
        console.log(`🎯 Patrón cambiado a: ${patternInfo?.name || data.type}`);

        // Calcular posiciones si es personalizado para visualización correcta en clientes
        let currentPositions = patternInfo?.positions;
        if (data.type === 'custom' && Array.isArray(gameState.customPattern)) {
            const customIndices = gameState.customPattern.map((isActive, index) => {
                if (!isActive) return -1;
                const row = Math.floor(index / 5);
                const col = index % 5;
                return (col * 5 + row);
            }).filter(idx => idx !== -1);
            currentPositions = [customIndices];
        }

        // Emitir a todos con información completa del patrón
        io.emit('pattern_changed', {
            type: data.type,
            name: patternInfo?.name || (data.type === 'custom' ? 'Personalizado' : data.type),
            description: patternInfo?.description || '',
            positions: currentPositions || [],
            multiplier: patternInfo?.multiplier || 1,
            grid: gameState.customPattern // Enviar el grid completo para persistencia visual en todos los clientes
        });

        io.emit('sync_state', getSyncState());
        saveGameState();
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Mensaje global
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_set_message', (msg) => {
        gameState.message = msg;
        saveGameState();
        io.emit('message_updated', msg);
    });

    // ─────────────────────────────────────────────────────────────
    // CHAT: Mensajería global y moderación
    // ─────────────────────────────────────────────────────────────
    socket.on('send_chat', (text) => {
        const now = Date.now();
        const lastSend = chatRateLimit.get(socket.id) || 0;

        if (now - lastSend < CHAT_COOLDOWN) {
            return socket.emit('chat_error', { message: 'Demasiado rápido. Espera un momento.' });
        }

        // Sanitización Estricta para Producción
        const cleanText = (text || '')
            .toString()
            .replace(/<[^>]*>?/gm, '') // Remover HTML
            .trim()
            .substring(0, 150); // Límite razonable

        if (!cleanText) return;

        chatRateLimit.set(socket.id, now);
        const username = socket.data?.username || 'Usuario';
        
        const msgId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        const msg = {
            id: msgId,
            user: username,
            text: cleanText,
            time: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }),
            isAdmin: false
        };

        messageBuffer.push(msg);
        if (messageBuffer.length > MAX_BUFFER_SIZE) messageBuffer.shift();

        io.emit('chat_message', msg);
    });

    socket.on('admin_send_chat', (text) => {
        const cleanText = (text || '').trim().substring(0, 500);
        if (!cleanText) return;

        const msgId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        io.emit('chat_message', {
            id: msgId,
            user: 'ADMIN',
            text: cleanText,
            time: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }),
            isAdmin: true
        });
    });

    socket.on('admin_delete_chat', (msgId) => {
        io.emit('chat_message_deleted', msgId);
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Aceptar jugador
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_accept_player', async (socketId) => {
        try {
            const pending = pendingPlayers.get(socketId);
            if (!pending) return;

            await syncTakenCards();
            const duplicates = pending.cardIds.filter(id => takenCards.has(id));

            if (duplicates.length > 0) {
                pending.socket.emit('join_error', {
                    message: `Cartón(es) #${duplicates.join(', #')} ya en uso`
                });
                pendingPlayers.delete(socketId);
                io.emit('update_pending_players', getPendingPlayers());
                return;
            }

            pending.cardIds.forEach(id => takenCards.add(id));
            
            // Sincronizar datos del socket para el chat y reconexión
            pending.socket.data.username = pending.username;
            pending.socket.data.cardIds = pending.cardIds;

            // Registrar sesión persistente
            const sessionUuid = Date.now().toString(36) + Math.random().toString(36).substr(2);
            sessionMap.set(sessionUuid, { 
                username: pending.username, 
                cardIds: pending.cardIds 
            });

            await addPlayerToDB(pending.username, pending.cardIds, socketId);

            const cards = pending.cardIds.map(id => generateCard(id));
            pending.socket.emit('init_cards', { cards, uuid: sessionUuid });
            pending.socket.emit('player_accepted');

            pendingPlayers.delete(socketId);
            io.emit('update_pending_players', getPendingPlayers());

            // Actualizar lista de jugadores activos (ahora incluye DB)
            const activePlayers = await getActivePlayers();
            io.emit('update_players', activePlayers);

            console.log(`✅ Jugador aceptado: ${pending.username}`);
        } catch (error) {
            console.error('❌ Error crítico al aceptar jugador:', error);
            socket.emit('admin_error', { message: 'Fallo en DB: No se pudo aceptar al jugador.' });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Rechazar jugador
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_reject_player', (socketId) => {
        const pending = pendingPlayers.get(socketId);
        if (pending) {
            pending.socket.emit('player_rejected', { message: 'Solicitud rechazada' });
            pendingPlayers.delete(socketId);
            io.emit('update_pending_players', getPendingPlayers());
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Agregar jugador manualmente
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_add_player', async (data) => {
        try {
            const { name, cardIds } = data;
            const validIds = cardIds.filter(id => id >= 1 && id <= CONFIG.TOTAL_CARDS);

            if (validIds.length === 0) {
                socket.emit('admin_error', { message: 'No hay cartones válidos' });
                return;
            }

            await syncTakenCards();
            const duplicates = validIds.filter(id => takenCards.has(id));

            if (duplicates.length > 0) {
                socket.emit('admin_error', {
                    message: `Cartón(es) #${duplicates.join(', #')} ya en uso`
                });
                return;
            }

            validIds.forEach(id => takenCards.add(id));
            await addPlayerToDB(name, validIds);

            // Actualizar lista de jugadores activos (ahora incluye DB)
            const activePlayers = await getActivePlayers();
            io.emit('update_players', activePlayers);

            socket.emit('admin_success', {
                message: `Jugador "${name}" agregado con ${validIds.length} cartones`
            });
        } catch (error) {
            console.error('Error agregando jugador:', error);
            socket.emit('admin_error', { message: 'Error agregando jugador' });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Expulsar jugador (online u offline)
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_kick_player', async (data) => {
        let playerToRemove = null;
        let cardIdsToFree = [];

        // Normalizar entrada para manejar strings directos o objetos con id/socketId
        const socketId = typeof data === 'string' ? data : (data?.socketId || data?.id);

        if (socketId && io.sockets.sockets.has(socketId)) {
            const target = io.sockets.sockets.get(socketId);
            if (target?.data.cardIds) {
                cardIdsToFree = target.data.cardIds;
                playerToRemove = target.data.username;

                target.emit('kicked');
                target.disconnect();
            }
        }
        // Si es un nombre de jugador (jugador offline)
        else if (data && data.username) {
            try {
                const player = await Player.findOne({ username: data.username, isActive: true });
                if (player) {
                    playerToRemove = player.username;
                    cardIdsToFree = player.cardIds || [];

                    // Marcar como inactivo en la base de datos
                    await Player.findOneAndUpdate(
                        { username: data.username },
                        { isActive: false }
                    );
                }
            } catch (error) {
                console.error('Error eliminando jugador offline:', error);
                socket.emit('admin_error', { message: 'Error al eliminar jugador' });
                return;
            }
        }

        // Liberar cartones (si tiene) y actualizar lista siempre que haya un jugador identificado
        if (playerToRemove) {
            if (cardIdsToFree && cardIdsToFree.length > 0) {
                cardIdsToFree.forEach(id => takenCards.delete(id));
            }

            console.log(`🗑️ Jugador eliminado: ${playerToRemove}`);

            const activePlayers = await getActivePlayers();
            io.emit('update_players', activePlayers);

            socket.emit('admin_success', {
                message: `Jugador "${playerToRemove}" eliminado correctamente`
            });
        } else {
            socket.emit('admin_error', { message: 'Jugador no encontrado' });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Disponibilidad de cartones
    // ─────────────────────────────────────────────────────────────
    socket.on('get_card_availability', async () => {
        await syncTakenCards();
        socket.emit('card_availability', {
            takenCards: Array.from(takenCards),
            availableCount: CONFIG.TOTAL_CARDS - takenCards.size,
            usedCount: takenCards.size
        });
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Nueva ronda
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_reset', async () => {
        gameState.calledNumbers = [];
        gameState.last5Numbers = [];
        gameState.last5Winners = [];
        resetWinnerManagement();

        // Enviar notificaciones push para la nueva ronda
        try {
            const playersWithSubs = await Player.find({
                isActive: true,
                pushSubscription: { $ne: null }
            });

            const notificationPayload = JSON.stringify({
                title: '🎲 ¡Nueva Ronda de Bingo!',
                body: 'Una nueva partida está a punto de comenzar. ¡Únete ahora!',
                icon: '/logo.png',
            });

            for (const player of playersWithSubs) {
                if (player.pushSubscription) {
                    webpush.sendNotification(player.pushSubscription, notificationPayload)
                        .catch(err => {
                            console.error(`Error enviando notificación a ${player.username}:`, err.statusCode);
                            // Si la suscripción es inválida (e.g., 410 Gone), la eliminamos
                            if (err.statusCode === 410 || err.statusCode === 404) {
                                Player.updateOne({ _id: player._id }, { $set: { pushSubscription: null } }).exec();
                            }
                        });
                }
            }
        } catch (error) {
            console.error('Error al enviar notificaciones push:', error);
        }

        saveGameState();
        io.emit('game_reset');
        io.emit('update_pending_players', getPendingPlayers());
        getActivePlayers().then(players => {
            io.emit('update_players', players);
        });

        console.log('🔄 Nueva ronda iniciada');
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Reinicio completo
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_full_reset', async () => {
        gameState.calledNumbers = [];
        gameState.last5Numbers = [];
        gameState.last5Winners = [];
        resetWinnerManagement();

        // Desconectar todos los jugadores
        const sockets = Array.from(io.sockets.sockets.values());
        sockets.forEach(s => {
            if (s.data.cardIds) {
                s.emit('full_reset');
                s.emit('kicked');
                s.disconnect();
            }
        });

        takenCards.clear();
        pendingPlayers.clear();

        // Limpiar estado guardado
        await GameState.deleteMany({});

        try {
            const result = await Player.deleteMany({});
            console.log(`🧹 ${result.deletedCount} jugadores eliminados (logros de cuentas registradas se mantienen)`);
        } catch (error) {
            console.error('Error limpiando DB:', error);
        }

        io.emit('game_reset');
        io.emit('update_history', []);
        io.emit('update_pending_players', []);
        io.emit('update_players', []);

        console.log('🔄 REINICIO COMPLETO');
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: REGISTRO MANUAL DE INGRESOS
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_save_report', async (data) => {
        try {
            const report = new GameReport({
                gameTitle: data.title,
                totalIncome: parseFloat(data.income),
                observations: data.obs
            });
            await report.save();
            socket.emit('admin_success', { message: 'Reporte de ingresos guardado.' });
        } catch (e) {
            socket.emit('admin_error', { message: 'Error al guardar reporte.' });
        }
    });

    socket.on('admin_get_reports', async () => {
        const reports = await GameReport.find().sort({ date: -1 }).limit(10);
        socket.emit('reports_data', reports);
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Tiro automático
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_start_auto', (speedMs) => {
        if (gameState.isAutoPlaying) return;

        const delay = Math.max(3000, Math.min(parseInt(speedMs) || 5000, 15000));

        gameState.isAutoPlaying = true;
        gameState.winnerDetectedPauseAuto = false;
        gameState.autoPlayInterval = setInterval(() => {
            if (gameState.winnerDetectedPauseAuto) return;
            
            const available = [];
            for (let i = 1; i <= 75; i++) {
                if (!gameState.calledNumbers.includes(i)) available.push(i);
            }

            if (available.length === 0) {
                clearInterval(gameState.autoPlayInterval);
                gameState.isAutoPlaying = false;
                io.emit('auto_play_stopped');
                return;
            }

            const num = available[Math.floor(Math.random() * available.length)];
            gameState.calledNumbers.push(num);
            gameState.last5Numbers.unshift(num);
            if (gameState.last5Numbers.length > 5) gameState.last5Numbers.pop();

            saveGameState();
            io.emit('number_called', {
                num,
                last5: gameState.last5Numbers,
                totalCalled: gameState.calledNumbers.length,
                pattern: gameState.pattern
            });

            setTimeout(async () => {
                await checkForAutomaticWinners();
                await checkForProximity();
            }, 200);
        }, delay);

        io.emit('auto_play_started');
        console.log(`▶️ Tiro automático iniciado (${delay/1000}s)`);
    });
    socket.on('admin_stop_auto', () => {
        if (gameState.autoPlayInterval) {
            clearInterval(gameState.autoPlayInterval);
            gameState.autoPlayInterval = null;
        }
        gameState.isAutoPlaying = false;
        io.emit('auto_play_stopped');
        console.log('⏹️ Tiro automático detenido');
    });

    socket.on('admin_end_game', () => {
        gameState.status = 'finished';
        saveGameState();
        io.emit('game_ended', { message: 'El administrador ha finalizado la partida.' });
        console.log('🏁 Partida finalizada manualmente');
    });

    // ─────────────────────────────────────────────────────────────
    // ADMIN: Pausar Juego
    // ─────────────────────────────────────────────────────────────
    socket.on('admin_toggle_pause', () => {
        gameState.isPaused = !gameState.isPaused;

        // Si se pausa, detener el auto-play si está activo
        if (gameState.isPaused && gameState.isAutoPlaying) {
            clearInterval(gameState.autoPlayInterval);
            gameState.autoPlayInterval = null;
            gameState.isAutoPlaying = false;
            io.emit('auto_play_stopped');
        }

        io.emit('game_paused', gameState.isPaused);
        console.log(`⏸️ Juego ${gameState.isPaused ? 'PAUSADO' : 'REANUDADO'}`);
    });

    // ─────────────────────────────────────────────────────────────
    // GENERACIÓN ASÍNCRONA DE PDF (WORKER THREADS)
    // ─────────────────────────────────────────────────────────────
    socket.on('request_pdf_export', (cardIds) => {
        if (!cardIds || !Array.isArray(cardIds)) return;

        socket.emit('export_status', { message: 'Generando sus cartones, por favor espere...' });

        const worker = new Worker(path.join(__dirname, 'card_pdf_worker.js'), {
            workerData: { cardIds, userId: socket.id }
        });

        worker.on('message', (result) => {
            if (result.success) {
                socket.emit('pdf_ready', { url: `/temp/${result.fileName}` });
            } else {
                socket.emit('export_error', { message: 'Error al generar el PDF.' });
            }
        });

        worker.on('error', (err) => {
            console.error('[WORKER ERROR]', err);
            socket.emit('export_error', { message: 'Fallo crítico en exportación.' });
        });
    });

    // ─────────────────────────────────────────────────────────────
    // Desconexión
    // ─────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        // Cuando un jugador se desconecta, NO lo marcamos como inactivo ni liberamos sus cartones.
        // El jugador sigue 'isActive: true' en la DB para poder reconectarse.
        // Simplemente actualizamos su socketId a null para que la UI lo muestre como 'offline'.
        if (socket.data?.username) {
            try {
                await Player.findOneAndUpdate(
                    { username: socket.data.username },
                    { socketId: null }
                );
            } catch (error) {
                console.error('Error actualizando jugador desconectado:', error);
            }
        }

        if (socket.data?.username) {
            io.emit('player_left', { username: socket.data.username });
        }

        if (pendingPlayers.has(socket.id)) {
            pendingPlayers.delete(socket.id);
            io.emit('update_pending_players', getPendingPlayers());
        }

        getActivePlayers().then(players => io.emit('update_players', players));
        console.log(`🔌 Desconectado: ${socket.id}`);
    });

    // 📢 SISTEMA DE ALERTAS Y ANUNCIOS (BROADCAST)
    socket.on('admin_broadcast_alert', (data) => {
        // data: { message: string, type: 'info'|'urgent'|'prize' }
        io.emit('player_receive_alert', {
            message: data.message,
            type: data.type || 'info',
            time: new Date().toLocaleTimeString()
        });
        console.log(`📢 Alerta [${data.type}]: ${data.message}`);
    });
});

// 🚨 MANEJADOR GLOBAL DE ERRORES (EXPRESS)
app.use((err, req, res, next) => {
    logger.error(`[Global Error]: ${err.stack}`);
    const status = err.status || 500;
    res.status(status).json({
        error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message
    });
});

// ═══════════════════════════════════════════════════════════════
// 🚀 INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        // 1. Conectar a Base de Datos y Cargar Estado
        await connectDB();

        // 2. Sincronizar Cartones
        await syncTakenCards();

        // 4. Iniciar Servidor HTTP - Escuchando en 0.0.0.0 para compatibilidad total con Cloud/Railway
        server.listen(Number(PORT), '0.0.0.0', () => {
            logger.info(`🚀 Servidor HTTP iniciado en puerto ${PORT}`);
            console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🎱  YOVANNY BINGO V15 - SISTEMA COMPLETO                   ║
║                                                              ║
║   Puerto: ${PORT}                                              ║
║   Patrones: ${Object.keys(bingoEngine.BINGO_PATTERNS).length} disponibles                               ║
║   Cartones: ${CONFIG.TOTAL_CARDS} únicos                                      ║
║                                                              ║
║   ✅ MongoDB conectado                                       ║
║   ✅ Socket.io listo                                         ║
║   ✅ Detección automática de ganadores                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `);
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar el servidor:', error);
        process.exit(1);
    }
};

startServer();

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    if (gameState.autoPlayInterval) {
        clearInterval(gameState.autoPlayInterval);
    }
    await mongoose.connection.close();
    console.log('🔌 MongoDB cerrado');
    process.exit(0);
});
