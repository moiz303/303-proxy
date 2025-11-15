#!/bin/bash
echo "🔄 Переключаем nginx на SSL конфигурацию..."

# Проверяем что сертификаты есть
if [ ! -f ./ssl/nginx.crt ]; then
  echo "❌ Сертификаты не найдены! Сначала запустите certbot."
  exit 1
fi

# Меняем конфиг
cp nginx.conf nginx_temp.conf
echo "✅ Конфиг обновлен на SSL версию"

# Релоадим nginx
docker compose exec nginx nginx -s reload
echo "✅ Nginx перезагружен с SSL"

# Добавляем HTTPS порт
docker compose up -d --force-recreate nginx
echo "✅ Порт 5000 с SSL активирован"

echo "🎉 SSL настроен! Теперь доступно:"
echo "   HTTP  → http://72-56-72-131.nip.io"
echo "   HTTPS → https://72-56-72-131.nip.io:5000"