FROM python:3.11-slim

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем исходный код
COPY . .

# Создаем непривилегированного пользователя для безопасности
RUN useradd -m -r appuser && chown -R appuser /app
USER appuser

# Открываем порт Flask
EXPOSE 8080

# Запускаем приложение через gunicorn
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]