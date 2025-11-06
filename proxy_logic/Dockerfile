FROM python:3.11-slim

WORKDIR /app

# Копируем ВСЕ из корня проекта
COPY . .

# Устанавливаем зависимости для основного сервера
RUN pip install --no-cache-dir -r requirements.txt

# Переходим в папку proxy_logic для работы
WORKDIR /app/proxy_logic

RUN useradd -m -r appuser && chown -R appuser /app
USER appuser

EXPOSE 5050

CMD ["python", "proxy_core.py"]