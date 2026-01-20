from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Text, ForeignKey, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class User(Base):
    __tablename__ = 'users'
    id = Column(String(64), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    salt = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True)

    extensions = relationship("Extension", back_populates="user", cascade="all, delete-orphan")


class Extension(Base):
    __tablename__ = 'extensions'
    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey('users.id'), nullable=False, index=True)
    api_key = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="extensions")


class ClientConnection(Base):
    __tablename__ = 'client_connections'
    id = Column(Integer, primary_key=True, autoincrement=True)
    client_ip = Column(String(45), nullable=True, index=True)
    user_id = Column(String(64), ForeignKey('users.id'), nullable=False, index=True)
    extension_id = Column(String(64), ForeignKey('extensions.id'), nullable=False, index=True)
    connected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_activity = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True, index=True)

    user = relationship("User")
    extension = relationship("Extension")