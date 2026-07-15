/**
 * 🛠️ SCRIPT DE REPARACIÓN DE ESTRUCTURA
 * Elimina versiones antiguas y organiza el frontend correctamente.
 */
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const cssDir = path.join(publicDir, 'css');
const jsDir = path.join(publicDir, 'js');

// Archivos que deben ir al frontend
const files = {
    html: ['index.html', 'game.html', 'admin_monitor.html'],
    css: ['auth.css', 'game.css', 'assistant.css', 'personalization.css'],
    js: ['auth.js', 'game.js', 'assistant.js', 'personalization.js']
};

console.log('🧹 Limpiando carpeta public antigua...');
try {
    if (fs.existsSync(publicDir)) {
        fs.rmSync(publicDir, { recursive: true, force: true });
    }
} catch (e) {
    console.log('⚠️ No se pudo borrar public (quizás está en uso), continuando...');
}

console.log('📁 Creando nueva estructura...');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir);
if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir);

console.log('🚀 Moviendo archivos...');

// Mover HTML
files.html.forEach(file => {
    const src = path.join(rootDir, file);
    const dest = path.join(publicDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✅ HTML: ${file} -> public/`);
    }
});

// Mover CSS
files.css.forEach(file => {
    const src = path.join(rootDir, file);
    const dest = path.join(cssDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✅ CSS: ${file} -> public/css/`);
    }
});

// Mover JS
files.js.forEach(file => {
    const src = path.join(rootDir, file);
    const dest = path.join(jsDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✅ JS: ${file} -> public/js/`);
    }
});

console.log('\n✨ ¡Reparación completada! Reinicia el servidor con: node server.js');