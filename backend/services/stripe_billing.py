"""
Stripe membership billing for Satoshi's Council.

Entitlements live SERVER-SIDE on the WorkspaceAccount row (tier /
subscription_state / stripe_customer_id) via the PerformanceStore — there is
NO stateless HMAC member cookie and no second entitlement store. Membership
therefore sits on top of the existing server-side desk sessions.

Requires env (all optional; endpoints/fns fail closed if unset):
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_ID          # recurring $24/mo price
  STRIPE_SUCCESS_URL       # e.g. https://your.app/workspace?member=1&session_id={CHECKOUT_SESSION_ID}
  STRIPE_CANCEL_URL

The `stripe` package is optional — nothing is imported unless configured, and
every entry point returns/raises cleanly when Stripe is not set up. Paper
research only; membership funds the desk, it does not change any call.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

from loguru import logger


def configured() -> bool:
    return bool(
        (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
        and (os.environ.get("STRIPE_PRICE_ID") or "").strip()
    )


def _stripe():
    try:
        import stripe  # type: ignore
    except ImportError as e:
        raise RuntimeError("stripe package not installed. pip install stripe") from e
    key = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY unset")
    stripe.api_key = key
    return stripe


def create_checkout_session(account_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    """Create a Stripe Checkout Session tied to a workspace account_id."""
    stripe = _stripe()
    price = (os.environ.get("STRIPE_PRICE_ID") or "").strip()
    success = (os.environ.get("STRIPE_SUCCESS_URL")
               or "http://localhost:8000/workspace?member=1&session_id={CHECKOUT_SESSION_ID}").strip()
    cancel = (os.environ.get("STRIPE_CANCEL_URL") or "http://localhost:8000/workspace").strip()
    key = (account_id or "anonymous").strip()

    params: Dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": price, "quantity": 1}],
        "success_url": success,
        "cancel_url": cancel,
        "client_reference_id": key,
        "metadata": {"account_id": key, "product": "council_membership"},
    }
    if email:
        params["customer_email"] = email
    session = stripe.checkout.Session.create(**params)
    return {"id": session.id, "url": session.url, "account_id": key}


def retrieve_checkout_session(session_id: str) -> Dict[str, Any]:
    """Fetch a completed Checkout Session so the browser can claim membership."""
    stripe = _stripe()
    s = stripe.checkout.Session.retrieve(str(session_id))
    return {
        "account_id": (s.get("metadata") or {}).get("account_id") or s.get("client_reference_id"),
        "customer": s.get("customer"),
        "subscription": s.get("subscription"),
        "payment_status": s.get("payment_status"),
        "status": s.get("status"),
    }


async def handle_webhook(payload: bytes, sig_header: str, store: Any) -> Tuple[bool, str]:
    """
    Verify + process a Stripe webhook, writing entitlements to `store`
    (the PerformanceStore). Signature verification is the webhook's auth.
    """
    secret = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not secret:
        return False, "STRIPE_WEBHOOK_SECRET unset"
    stripe = _stripe()
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, secret)
    except Exception as e:
        logger.warning(f"stripe webhook verify failed: {e}")
        return False, "invalid signature"

    etype = event.get("type") or ""
    data = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        account_id = (data.get("metadata") or {}).get("account_id") or data.get("client_reference_id")
        customer_id = data.get("customer")
        subscription_id = data.get("subscription")
        if account_id and customer_id:
            await store.link_stripe_customer(str(account_id), str(customer_id),
                                             str(subscription_id) if subscription_id else None)
            logger.info(f"stripe: granted membership to workspace {account_id}")
            return True, "granted"
        return False, "no account_id"

    if etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        customer_id = data.get("customer")
        status = data.get("status")
        account_id = await store.account_id_for_customer(str(customer_id)) if customer_id else None
        if not account_id:
            return True, "no linked member"
        if etype == "customer.subscription.deleted" or status in ("canceled", "unpaid", "incomplete_expired"):
            await store.set_membership(account_id, "free", "canceled")
            logger.info(f"stripe: revoked membership {account_id}")
            return True, "revoked"
        if status == "active":
            await store.set_membership(account_id, "member", "active")
            return True, "renewed"

    return True, f"ignored:{etype}"
