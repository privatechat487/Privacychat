self.addEventListener('push', function(event) {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    vibrate: [100, 50, 100],
    data: { url: data.url }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
