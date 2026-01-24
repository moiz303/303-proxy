import os, sys
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import jwt
from flask import request

from database import db_manager
sys.path.append('/app')
from proxy_logic.models import User, Extension, ClientConnection


class ExtensionAuthManager:
    """
    Менеджер аутентификации для browser extension
    """
    def __init__(self):
        self.secret_key = os.environ.get('AUTH_SECRET_KEY')
        self.token_expiry = timedelta(hours=24)
        self.rate_limit = {}

    def generate_salt(self) -> str:
        """
        Генерация криптографически безопасной соли
        """
        return secrets.token_hex(32)

    def hash_password(self, password: str, salt: str) -> str:
        """
        Хеширование пароля с солью
        """
        return hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        ).hex()

    def verify_password(self, password: str, hashed_password: str, salt: str) -> bool:
        """
        Проверка пароля
        """
        return self.hash_password(password, salt) == hashed_password

    def generate_api_key(self) -> str:
        """
        Генерация API ключа для extension
        """
        return f"ext_{secrets.token_urlsafe(32)}"

    def create_access_token(self, user_id: str, extension_id: str) -> str:
        """
        Создание JWT токена
        """
        payload = {
            'user_id': user_id,
            'extension_id': extension_id,
            'exp': datetime.utcnow() + self.token_expiry,
            'iat': datetime.utcnow(),
            'type': 'extension_access'
        }
        return jwt.encode(payload, self.secret_key, algorithm='HS256')

    def verify_token(self, token: str) -> Optional[Dict]:
        """
        Верификация JWT токена
        """
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=['HS256'])

            # Дополнительная проверка в БД
            session = db_manager.get_session()
            try:
                user = session.query(User).filter(
                    User.id == payload['user_id'],
                    User.is_active == True
                ).first()

                extension = session.query(Extension).filter(
                    Extension.id == payload['extension_id'],
                    Extension.is_active == True,
                    Extension.user_id == payload['user_id']
                ).first()

                if not user or not extension:
                    return None

                # Обновляем время последнего использования extension
                extension.last_used = datetime.utcnow()
                session.commit()

                return payload

            finally:
                session.close()

        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
        except Exception as e:
            print(f"Token verification error: {e}")
            return None

    def check_rate_limit(self, identifier: str, max_attempts: int = 5,
                         window_minutes: int = 15) -> bool:
        """
        Проверка ограничения запросов
        """
        now = datetime.utcnow()
        window_start = now - timedelta(minutes=window_minutes)

        # Очистка старых записей
        self.rate_limit = {
            k: v for k, v in self.rate_limit.items()
            if v['timestamp'] > window_start
        }

        if identifier not in self.rate_limit:
            self.rate_limit[identifier] = {
                'attempts': 1,
                'timestamp': now
            }
            return True

        if self.rate_limit[identifier]['attempts'] >= max_attempts:
            return False

        self.rate_limit[identifier]['attempts'] += 1
        return True

    def register_user(self, email: str, password: str, extension_name: str) -> Dict:
        """
        Регистрация нового пользователя и extension
        """
        session = db_manager.get_session()
        try:
            # Проверка существования пользователя
            existing_user = session.query(User).filter(User.email == email).first()
            if existing_user:
                raise Exception("User already exists")

            # Создание пользователя
            user_id = f"user_{secrets.token_urlsafe(16)}"
            salt = self.generate_salt()
            hashed_password = self.hash_password(password, salt)

            user = User(
                id=user_id,
                email=email,
                hashed_password=hashed_password,
                salt=salt
            )
            session.add(user)

            # Создание extension
            extension_id = f"ext_{secrets.token_urlsafe(16)}"
            api_key = self.generate_api_key()

            extension = Extension(
                id=extension_id,
                user_id=user_id,
                api_key=api_key,
                name=extension_name
            )
            session.add(extension)

            session.commit()

            return {
                'user_id': user_id,
                'extension_id': extension_id,
                'api_key': api_key
            }

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def authenticate_user(self, email: str, password: str, client_ip: str = None) -> Dict:
        """
        Аутентификация пользователя
        """
        # Проверка rate limit
        if not self.check_rate_limit(email):
            raise Exception("Too many attempts. Please try again later.")

        session = db_manager.get_session()
        try:
            # Поиск пользователя
            user = session.query(User).filter(
                User.email == email,
                User.is_active == True
            ).first()

            if not user:
                raise Exception("Invalid credentials")

            # Проверка пароля
            if not self.verify_password(password, user.hashed_password, user.salt):
                raise Exception("Invalid credentials")

            # Получение активного extension пользователя
            extension = session.query(Extension).filter(
                Extension.user_id == user.id,
                Extension.is_active == True
            ).first()

            if not extension:
                raise Exception("No active extensions found for user")

            # Создание токена
            access_token = self.create_access_token(user.id, extension.id)

            # Сохранение сессии в БД
            session_obj = ClientConnection(
                id=secrets.token_urlsafe(32),
                user_id=user.id,
                extension_id=extension.id,
                expires_at=datetime.utcnow() + self.token_expiry,
                ip_address=client_ip
            )
            session.add(session_obj)
            session.commit()

            return {
                'message': 'Login successful',
                'access_token': access_token,
                'token_type': 'bearer',
                'expires_in': int(self.token_expiry.total_seconds()),
                'user_id': user.id,
                'extension_id': extension.id,
                'session_id': session_obj.id
            }

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def refresh_token(self, user_id: str, extension_id: str) -> str:
        """
        Обновление JWT токена
        """
        return self.create_access_token(user_id, extension_id)

    def logout_user(self, session_id: str = None, user_id: str = None) -> bool:
        """
        Выход пользователя из системы
        """
        session = db_manager.get_session()
        try:
            if session_id:
                # Удаляем конкретную сессию
                session_obj = session.query(ClientConnection).filter(ClientConnection.id == session_id).first()
                if session_obj:
                    session.delete(session_obj)
                    session.commit()
                    return True
            elif user_id:
                # Удаляем все сессии пользователя
                result = session.query(ClientConnection).filter(ClientConnection.user_id == user_id).delete()
                session.commit()
                return result > 0

            return False

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def validate_api_key(self, api_key: str) -> Optional[Tuple[str, str]]:
        """
        Валидация API ключа extension
        """
        session = db_manager.get_session()
        try:
            extension = session.query(Extension).filter(
                Extension.api_key == api_key,
                Extension.is_active == True
            ).first()

            if extension:
                # Обновляем время последнего использования
                extension.last_used = datetime.utcnow()
                session.commit()
                return extension.user_id, extension.id

            return None

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def get_user_extensions(self, user_id: str) -> list:
        """
        Получение всех extensions пользователя
        """
        session = db_manager.get_session()
        try:
            extensions = session.query(Extension).filter(
                Extension.user_id == user_id,
                Extension.is_active == True
            ).all()

            return [
                {
                    'id': ext.id,
                    'name': ext.name,
                    'api_key': ext.api_key,
                    'created_at': ext.created_at.isoformat(),
                    'last_used': ext.last_used.isoformat() if ext.last_used else None
                }
                for ext in extensions
            ]

        finally:
            session.close()

    def update_user_password(self, user_id: str, old_password: str,
                             new_password: str) -> bool:
        """
        Обновление пароля пользователя
        """
        session = db_manager.get_session()
        try:
            user = session.query(User).filter(
                User.id == user_id,
                User.is_active == True
            ).first()

            if not user:
                return False

            # Проверка старого пароля
            if not self.verify_password(old_password, user.hashed_password, user.salt):
                return False

            # Генерация нового пароля
            new_salt = self.generate_salt()
            new_hashed_password = self.hash_password(new_password, new_salt)

            user.salt = new_salt
            user.hashed_password = new_hashed_password
            user.updated_at = datetime.utcnow()

            session.commit()
            return True

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def deactivate_extension(self, extension_id: str, user_id: str = None) -> bool:
        """
        Деактивация extension
        """
        session = db_manager.get_session()
        try:
            query = session.query(Extension).filter(
                Extension.id == extension_id
            )

            if user_id:
                query = query.filter(Extension.user_id == user_id)

            extension = query.first()

            if extension:
                extension.is_active = False
                extension.updated_at = datetime.utcnow()
                session.commit()
                return True

            return False

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def cleanup_expired_sessions(self) -> int:
        """
        Очистка просроченных сессий
        """
        session = db_manager.get_session()
        try:
            result = session.query(ClientConnection).filter(
                ClientConnection.expires_at < datetime.utcnow()
            ).delete()
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()


# Глобальный экземпляр менеджера аутентификации
auth_manager = ExtensionAuthManager()


# Декоратор для защиты endpoint'ов
def token_required(f):
    """
    Декоратор для проверки JWT токена
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        # Получение токена из заголовков
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]

        if not token:
            return {'error': 'Token is missing'}, 401

        # Верификация токена
        payload = auth_manager.verify_token(token)
        if not payload:
            return {'error': 'Invalid or expired token'}, 401

        # Добавление информации о пользователе в контекст запроса
        request.user_id = payload['user_id']
        request.extension_id = payload['extension_id']

        return f(*args, **kwargs)

    return decorated


def api_key_required(f):
    """
    Декоратор для проверки API ключа
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = None

        # Получение API ключа из заголовков
        if 'X-API-Key' in request.headers:
            api_key = request.headers['X-API-Key']

        if not api_key:
            return {'error': 'API key is missing'}, 401

        # Валидация API ключа
        result = auth_manager.validate_api_key(api_key)
        if not result:
            return {'error': 'Invalid API key'}, 401

        user_id, extension_id = result
        request.user_id = user_id
        request.extension_id = extension_id

        return f(*args, **kwargs)

    return decorated