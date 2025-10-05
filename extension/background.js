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
      console.log('Фоновое подключение успешно');
      await chrome.storage.local.set({ isConnected: true });
    }
  } catch (error) {
    console.error('Ошибка фонового подключения:', error);
  }
}