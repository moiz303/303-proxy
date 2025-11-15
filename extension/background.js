// Автоподключение при запуске браузера
chrome.runtime.onStartup.addListener(async () => {
  const { autoConnect, serverUrl } = await chrome.storage.local.get(['autoConnect', 'serverUrl']);

  if (autoConnect && serverUrl) {
    connectToServer(serverUrl);
  }
});

// Используем chrome.proxy.settings

// Обработчик сообщений от popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Получено сообщение:', request);

  if (request.action === 'enableProxy') {
    enableProxy(request.proxyHost, request.proxyPort)
      .then(() => sendResponse({ status: 'success' }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true; // Для асинхронного response
  }

  if (request.action === 'disableProxy') {
    disableProxy()
      .then(() => sendResponse({ status: 'success' }))
      .catch(error => sendResponse({ status: 'error', message: error.message }));
    return true;
  }

  // Обработчик для проверки статуса прокси
  if (request.action === 'getProxyStatus') {
    chrome.proxy.settings.get({}, (config) => {
      sendResponse({
        status: 'success',
        proxyConfig: config,
        isEnabled: config.value.mode === 'fixed_servers'
      });
    });
    return true;
  }
});

async function connectToServer(url) {
  try {
    // Используем HTTPS
    const serverHost = new URL(url).hostname;
    const httpsUrl = `https://${serverHost}:5000/api/connect`;

    console.log('Фоновое подключение к:', httpsUrl);

    const response = await fetch(httpsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: chrome.runtime.id })
    });

    if (response.ok) {
      const result = await response.json();

      if (result.status === 'success') {
        // Автоматически включаем прокси при успешном подключении
        await enableProxy(serverHost, 5050);
        console.log('✅ Фоновое подключение и прокси успешно настроены');
      } else {
        console.warn('Сервер вернул ошибку:', result.message);
      }

      await chrome.storage.local.set({
        isConnected: true,
        lastConnection: new Date().toISOString()
      });
    } else {
      console.error('Ошибка HTTP:', response.status);
    }
  } catch (error) {
    console.error('❌ Ошибка фонового подключения:', error);
    // При ошибке подключения отключаем прокси
    await disableProxy();
  }
}

// Функция для настройки прокси
async function enableProxy(host = '72.56.72.131', port = 5050) {
  return new Promise((resolve, reject) => {
    const config = {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "http", // Прокси работает по HTTP, даже если сервер HTTPS
          host: host,
          port: parseInt(port)
        },
        bypassList: ["localhost", "127.0.0.1", "72.56.72.131"] // Исключаем сам сервер
      }
    };

    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        console.error('❌ Ошибка настройки прокси:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('✅ Прокси настроен:', `${host}:${port}`);

        // Сохраняем настройки
        chrome.storage.local.set({
          isConnected: true,
          proxyEnabled: true,
          proxyHost: host,
          proxyPort: port,
          lastProxyUpdate: new Date().toISOString()
        }, () => {
          resolve();
        });
      }
    });
  });
}

// Функция для отключения прокси
async function disableProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        console.error('❌ Ошибка отключения прокси:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('✅ Прокси отключен');

        // Обновляем настройки
        chrome.storage.local.set({
          proxyEnabled: false,
          isConnected: false
        }, () => {
          resolve();
        });
      }
    });
  });
}

// Функция для проверки текущего статуса прокси
function getCurrentProxyStatus() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({}, (config) => {
      resolve({
        isEnabled: config.value.mode === 'fixed_servers',
        config: config
      });
    });
  });
}