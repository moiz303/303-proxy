document.addEventListener('DOMContentLoaded', async () => {
  const connectButton = document.getElementById('connectButton');
  const statusElement = document.getElementById('status');
  const serverUrl = 'http://72.56.72.131:8080/api';

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

  // Функция подключения
  async function connectToServer() {
    statusElement.textContent = 'Подключение...';
    statusElement.style.color = 'blue';
    connectButton.disabled = true;

    const response = await fetch(`${serverUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect' })
    });

    if (!response.ok) {
      throw new Error(`Сервер ответил ошибкой: ${response.status}`);
    }

    const result = await response.json();
    await chrome.storage.local.set({ isConnected: true });
    updateUI(true);
    console.log('Подключено успешно:', result);
  }

  // Функция отключения с логированием
  async function disconnectFromServer() {
    statusElement.textContent = 'Отключение...';
    statusElement.style.color = 'orange';
    connectButton.disabled = true;

    try {
      const response = await fetch(`${serverUrl}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' })
      });

      if (!response.ok) {
        throw new Error(`Сервер ответил ошибкой: ${response.status}`);
      }

      const result = await response.json();
      await chrome.storage.local.set({ isConnected: false });
      updateUI(false);
      console.log('Отключено успешно:', result);
    } catch (error) {
      console.error('Ошибка отключения:', error);
      statusElement.textContent = `Ошибка отключения: ${error.message}`;
      statusElement.style.color = 'red';
      connectButton.disabled = false;
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