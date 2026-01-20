import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from proxy_logic.models import Base


class DatabaseManager:
    def __init__(self, database_url: str = None):
        self.database_url = database_url or os.getenv('DATABASE_URL')
        self.engine = create_engine(self.database_url)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

        # Создаем таблицы при инициализации
        Base.metadata.create_all(bind=self.engine)

    def get_session(self):
        return self.SessionLocal()


db_manager = DatabaseManager()