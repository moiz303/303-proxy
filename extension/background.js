// Автоподключение при запуске браузера
chrome.runtime.onStartup.addListener(async () => {
  const { autoConnect, serverUrl } = await chrome.storage.local.get(['autoConnect', 'serverUrl']);

  if (autoConnect && serverUrl) {
    connectToServer(serverUrl); // Функция подключения
  }
});

async function connectToServer(url) {
  try {
    const response = await fetch(`${url}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: chrome.runtime.id })
    });

    if (response.ok) {
      try {
        // Пробуем разные методы подключения
        const promises = [
            fetch(`http://${new URL(serverUrl).hostname}:5050`).catch(e => 'failed'),
            new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve('image_ok');
                img.onerror = () => resolve('image_failed');
                img.src = `http://${new URL(serverUrl).hostname}:5050/?test=` + Date.now();
            })
        ];

        await Promise.all(promises);
        console.log('Proxy connection attempts completed');

    } catch (e) {
        console.log('Proxy connection established with errors');
    }

      console.log('Фоновое подключение успешно');
      await chrome.storage.local.set({ isConnected: true });
    }
  } catch (error) {
    console.error('Ошибка фонового подключения:', error);
  }
}