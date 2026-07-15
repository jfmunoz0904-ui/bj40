self.addEventListener('push', event => {
    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'Yovanny Bingo', body: event.data.text() };
    }

    console.log('Push recibido:', data);

    const title = data.title || 'Yovanny Bingo';
    const options = {
        body: data.body || 'Hay novedades en el juego.',
        icon: data.icon || '/logo.png',
        badge: data.badge || '/logo.png', // Un ícono más pequeño para la barra de notificaciones
        vibrate: [100, 50, 100],
        data: {
            url: self.location.origin, // URL a abrir al hacer clic
        },
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const urlToOpen = event.notification.data.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Si hay una ventana abierta, la enfoca. Si no, abre una nueva.
            return clients.openWindow(urlToOpen);
        })
    );
});