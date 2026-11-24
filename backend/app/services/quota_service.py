"""Quota enforcement engine (Phase 1, Rule 2).

Enforces, before every AI call: plan validity, remaining token balance, and
per-user daily/monthly token and request limits — plus a short sliding-window
request-rate limit. Counters live in `user_quotas` (portable across SQLite and
PostgreSQL) and the rate window lives in Redis.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.governance import UserQuota
from app.services.auth_billing_service import ensure_user_can_consume
from app.services.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)

# Default policy. Admin-tunable values are read from BillingSettings.system_config
# under the `quotas` key (Phase 2 will surface these in the admin UI).
DEFAULT_QUOTA_POLICY: dict[str, int] = {
    "daily_tokens": 200_000,
    "monthly_tokens": 2_000_000,
    "daily_requests": 400,
    "requests_per_minute": 20,
}

QUOTA_POLICY_KEY = "quotas"
# Per-capability overrides live under `quotas.per_feature[feature_key]`. Missing fields
# inherit the global policy, so an override can tighten one limit and leave the rest.
PER_FEATURE_KEY = "per_feature"
OVERRIDABLE_LIMITS = tuple(DEFAULT_QUOTA_POLICY.keys())
FEATURE_KEY_PATTERN = r"^[a-z][a-z0-9_]{1,63}$"


@dataclass(frozen=True)
class QuotaDecision:
    allowed: bool
    feature_key: str
    daily_tokens_used: int
    daily_tokens_limit: int
    monthly_tokens_used: int
    monthly_tokens_limit: int
    daily_requests_used: int
    daily_requests_limit: int
    tokens_remaining: int


def today_window(now: datetime | None = None) -> tuple[str, str]:
    current = now or datetime.now(timezone.utc)
    return current.strftime("%Y-%m-%d"), current.strftime("%Y-%m")


async def get_quota_policy(session: AsyncSession) -> dict[str, int]:
    """Read the admin-tunable quota policy, falling back to defaults."""
    from app.models.auth import BillingSettings

    policy = dict(DEFAULT_QUOTA_POLICY)
    try:
        billing = await session.get(BillingSettings, 1)
    except Exception:  # noqa: BLE001 - never block an AI call on policy lookup
        return policy
    raw = getattr(billing, "system_config", None) if billing is not None else None
    if isinstance(raw, dict):
        overrides = raw.get(QUOTA_POLICY_KEY)
        if isinstance(overrides, dict):
            for key, value in overrides.items():
                if key in policy and isinstance(value, int) and value >= 0:
                    policy[key] = value
    return policy


def _clean_override(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    return {
        key: int(value)
        for key, value in raw.items()
        if key in OVERRIDABLE_LIMITS and isinstance(value, int) and not isinstance(value, bool) and value >= 0
    }


async def get_feature_overrides(session: AsyncSession) -> dict[str, dict[str, int]]:
    """Per-capability overrides, keyed by feature_key (empty when none are configured)."""
    from app.models.auth import BillingSettings

    try:
        billing = await session.get(BillingSettings, 1)
    except Exception:  # noqa: BLE001 - never block an AI call on policy lookup
        return {}
    raw = getattr(billing, "system_config", None) if billing is not None else None
    if not isinstance(raw, dict) or not isinstance(raw.get(QUOTA_POLICY_KEY), dict):
        return {}
    per_feature = raw[QUOTA_POLICY_KEY].get(PER_FEATURE_KEY)
    if not isinstance(per_feature, dict):
        return {}
    return {
        str(key): cleaned
        for key, value in per_feature.items()
        if (cleaned := _clean_override(value))
    }


async def get_feature_limits(session: AsyncSession, feature_key: str) -> dict[str, int]:
    """Effective limits for one capability: global policy overlaid with its override."""
    policy = await get_quota_policy(session)
    overrides = await get_feature_overrides(session)
    return {**policy, **overrides.get(feature_key, {})}


async def get_or_create_quota(
    session: AsyncSession, *, user_id: str, feature_key: str, now: datetime | None = None
) -> UserQuota:
    """Fetch (or roll over) the quota row for this user+feature window."""
    day, month = today_window(now)
    quota = await session.scalar(
        select(UserQuota).where(
            UserQuota.user_id == user_id, UserQuota.feature_key == feature_key
        )
    )
    if quota is None:
        quota = UserQuota(
            user_id=user_id,
            feature_key=feature_key,
            window_date=day,
            window_month=month,
        )
        session.add(quota)
        await session.flush()
        return quota
    if quota.window_date != day:
        quota.window_date = day
        quota.daily_tokens_used = 0
        quota.daily_requests_used = 0
    if quota.window_month != month:
        quota.window_month = month
        quota.monthly_tokens_used = 0
    return quota


async def enforce_ai_quota(
    session: AsyncSession,
    *,
    user: User,
    feature_key: str,
    now: datetime | None = None,
) -> QuotaDecision:
    """Raise HTTP 402/429 when this user may not spend an AI call right now."""
    # Existing plan/token gate (raises 402/403 with Persian messages).
    ensure_user_can_consume(user, now=now)
    policy = await get_feature_limits(session, feature_key)

    rate = await check_rate_limit(
        identity=user.id,
        bucket=f"ai:{feature_key}",
        limit=policy["requests_per_minute"],
        window_seconds=60,
    )
    if not rate.allowed:
        logger.info("ai_quota.rate_limited user=%s feature=%s", user.id[:8], feature_key)
        raise HTTPException(
            status_code=429,
            detail="تعداد درخواست‌های شما در دقیقهٔ گذشته بیش از حد مجاز است. لطفاً کمی صبر کنید.",
            headers={"Retry-After": str(rate.retry_after_seconds)},
        )

    try:
        quota = await get_or_create_quota(
            session, user_id=user.id, feature_key=feature_key, now=now
        )
    except Exception:  # noqa: BLE001
        # Quota accounting is best-effort: a storage hiccup must not deny service.
        logger.exception("ai_quota.lookup_failed user=%s feature=%s", user.id, feature_key)
        return QuotaDecision(
            allowed=True,
            feature_key=feature_key,
            daily_tokens_used=0,
            daily_tokens_limit=policy["daily_tokens"],
            monthly_tokens_used=0,
            monthly_tokens_limit=policy["monthly_tokens"],
            daily_requests_used=0,
            daily_requests_limit=policy["daily_requests"],
            tokens_remaining=user.tokens_remaining,
        )

    if quota.daily_requests_used >= policy["daily_requests"]:
        raise HTTPException(
            status_code=429,
            detail="سهمیهٔ تعداد درخواست‌های امروز شما تکمیل شده است. فردا دوباره تلاش کنید.",
        )
    if quota.daily_tokens_used >= policy["daily_tokens"]:
        raise HTTPException(
            status_code=402,
            detail="سهمیهٔ توکن روزانهٔ شما تکمیل شده است. فردا دوباره تلاش کنید یا پلن را ارتقا دهید.",
        )
    if quota.monthly_tokens_used >= policy["monthly_tokens"]:
        raise HTTPException(
            status_code=402,
            detail="سهمیهٔ توکن ماهانهٔ شما تکمیل شده است. لطفاً پلن خود را ارتقا دهید.",
        )

    return QuotaDecision(
        allowed=True,
        feature_key=feature_key,
        daily_tokens_used=quota.daily_tokens_used,
        daily_tokens_limit=policy["daily_tokens"],
        monthly_tokens_used=quota.monthly_tokens_used,
        monthly_tokens_limit=policy["monthly_tokens"],
        daily_requests_used=quota.daily_requests_used,
        daily_requests_limit=policy["daily_requests"],
        tokens_remaining=user.tokens_remaining,
    )


async def record_ai_usage(
    session: AsyncSession,
    *,
    user_id: str | None,
    feature_key: str,
    tokens_in: int,
    tokens_out: int,
    now: datetime | None = None,
) -> None:
    """Increment quota counters after a call. Never raises into the request path."""
    if not user_id:
        return
    try:
        quota = await get_or_create_quota(
            session, user_id=user_id, feature_key=feature_key, now=now
        )
        total = max(0, tokens_in) + max(0, tokens_out)
        quota.daily_tokens_used += total
        quota.monthly_tokens_used += total
        quota.daily_requests_used += 1
    except Exception:  # noqa: BLE001 - quota accounting must not break a response
        logger.exception("ai_quota.record_failed user=%s feature=%s", user_id, feature_key)


async def get_quota_snapshot(
    session: AsyncSession, *, user_id: str, feature_key: str = "*"
) -> dict[str, int]:
    policy = await get_feature_limits(session, feature_key)
    quota = await get_or_create_quota(session, user_id=user_id, feature_key=feature_key)
    return {
        "daily_tokens_used": quota.daily_tokens_used,
        "daily_tokens_limit": policy["daily_tokens"],
        "monthly_tokens_used": quota.monthly_tokens_used,
        "monthly_tokens_limit": policy["monthly_tokens"],
        "daily_requests_used": quota.daily_requests_used,
        "daily_requests_limit": policy["daily_requests"],
        "requests_per_minute": policy["requests_per_minute"],
        "window_date": quota.window_date,
        "window_month": quota.window_month,
    }
