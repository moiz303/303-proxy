FROM python:3.11-slim

WORKDIR /app

# Копируем ВСЕ из корня проекта (благодаря context: . в docker-compose)
COPY . .

# Устанавливаем зависимости для Flask-связки
RUN pip install --no-cache-dir -r requirements.txt

# Добавляем папку proxy_core в Python path
ENV PYTHONPATH="/app/proxy_logic:${PYTHONPATH}"

# Переходим в папку flask_bridge для работы
WORKDIR /app/flask_bridge

# Создаем пользователя для безопасности
RUN useradd -m -r appuser && chown -R appuser /app
USER appuser

EXPOSE 5000

# Запускаем приложение
CMD ["gunicorn", "-c", "gunicorn.conf.py", "main:app"]