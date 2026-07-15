const fs = require('fs');
const path = require('path');

const root = __dirname;
const pub = path.join(root, 'public');
const css = path.join(pub, 'css');
const js = path.join(pub, 'js');

// Asegurar directorios
if (!fs.existsSync(pub)) fs.mkdirSync(pub, { recursive: true });
if (!fs.existsSync(css)) fs.mkdirSync(css, { recursive: true });
if (!fs.existsSync(js)) fs.mkdirSync(js, { recursive: true });

console.log('🔄 Iniciando actualización forzada de archivos...');

// Copiar HTML (Sobrescribiendo cualquier versión antigua)
fs.copyFileSync(path.join(root, 'index.html'), path.join(pub, 'index.html'));
console.log('✅ index.html (Login) actualizado.');

fs.copyFileSync(path.join(root, 'game.html'), path.join(pub, 'game.html'));
console.log('✅ game.html actualizado.');

fs.copyFileSync(path.join(root, 'admin_monitor.html'), path.join(pub, 'admin_monitor.html'));
console.log('✅ admin_monitor.html actualizado.');

// Copiar CSS
['auth.css', 'game.css', 'assistant.css', 'personalization.css'].forEach(file => {
    if (fs.existsSync(path.join(root, file))) {
        fs.copyFileSync(path.join(root, file), path.join(css, file));
        console.log(`✅ CSS actualizado: ${file}`);
    }
});

// Copiar JS
['auth.js', 'game.js', 'assistant.js', 'personalization.js'].forEach(file => {
    if (fs.existsSync(path.join(root, file))) {
        fs.copyFileSync(path.join(root, file), path.join(js, file));
        console.log(`✅ JS actualizado: ${file}`);
    }
});

console.log('\n✨ ¡Archivos actualizados! Reinicia el servidor y recarga la página (Ctrl + F5).');