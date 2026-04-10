from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import settings


def _db_url() -> str:
    # Windows-safe relative path; SQLite file lands in backend/ by default
    return f"sqlite+aiosqlite:///{settings.sqlite_path}"


engine = create_async_engine(_db_url(), future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session

