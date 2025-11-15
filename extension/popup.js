document.addEventListener('DOMContentLoaded', async () => {
  const connectButton = document.getElementById('connectButton');
  const statusElement = document.getElementById('status');
  const apiUrl = 'https://72-56-72-131.nip.io:5000';
  const proxyUrl = 'https://72-56-72-131.nip.io:5050'

  // Проверяем сохранённое состояние при загрузке
  const { isConnected } = await chrome.storage.local.get('isConnected');
  updateUI(isConnected);

  connectButton.addEventListener('click', async () => {
    try {
      if (isConnected) {
        // Если уже подключено — отключаем
        await disconnectFromServer();
      } else {
        // Если не подключено — подключаем
        await connectToServer();
      }
    } catch (error) {
      console.error('Ошибка:', error);
      statusElement.textContent = `Ошибка: ${error.message}`;
      statusElement.style.color = 'red';
    }
  });

  async function connectToServer() {
  try {
    statusElement.textContent = 'Подключение...';
    statusElement.style.color = 'blue';
    connectButton.disabled = true;

    // 1. Авторизация на сервере
    const response = await fetch(`${apiUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });

    if (!response.ok) {
      throw new Error(`Сервер ответил ошибкой: ${response.status}`);
    }

    const result = await response.json();

    // 2. Если авторизация успешна - настраиваем прокси в браузере
    if (result.status === 'success') {
      // Отправляем сообщение в background.js чтобы включить прокси
      await chrome.runtime.sendMessage({
        action: 'enableProxy',
        proxyHost: '72.56.72.131',
        proxyPort: 5050
      });

      // 3. Сохраняем статус подключения
      await chrome.storage.local.set({
        isConnected: true,
        proxyEnabled: true
      });

      updateUI(true);
      console.log('✅ Подключено успешно и прокси настроен:', result);
    } else {
      throw new Error(result.message || 'Ошибка авторизации');
    }

  } catch (error) {
    console.error('Ошибка подключения:', error);
    statusElement.textContent = `Ошибка: ${error.message}`;
    statusElement.style.color = 'red';
    connectButton.disabled = false;
  }
}

  async function disconnectFromServer() {
  try {
    // 1. Отправляем сообщение в background.js чтобы отключить прокси
    await chrome.runtime.sendMessage({ action: 'disableProxy' });

    // 2. Уведомляем сервер об отключении (опционально)
    try {
      await fetch(`${apiUrl}/api/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' })
      });
    } catch (e) {
      console.log('Сервер недоступен при отключении:', e.message);
    }

    // 3. Обновляем статус
    await chrome.storage.local.set({
      isConnected: false,
      proxyEnabled: false
    });

    updateUI(false);
    console.log('✅ Отключено успешно');

  } catch (error) {
    console.error('Ошибка отключения:', error);
    statusElement.textContent = `Ошибка отключения: ${error.message}`;
    statusElement.style.color = 'red';
  }
}

  // Обновление интерфейса
  function updateUI(connected) {
    if (connected) {
      statusElement.textContent = 'Подключено ✓';
      statusElement.style.color = 'green';
      connectButton.textContent = 'Отключиться';
    } else {
      statusElement.textContent = 'Не подключено';
      statusElement.style.color = 'inherit';
      connectButton.textContent = 'Подключиться';
    }
    connectButton.disabled = false;
  }
});