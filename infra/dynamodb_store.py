import json
import logging
import os
from decimal import Decimal
from typing import Any, Optional

import boto3
from boto3.dynamodb.conditions import Attr

logger = logging.getLogger(__name__)


# Table name constants
TABLE_CERTS = "cert-lifecycle-certificates"
TABLE_NOTIFICATIONS = "cert-lifecycle-notifications"
TABLE_EMAIL_LOG = "cert-lifecycle-email-log"
TABLE_SETTINGS = "cert-lifecycle-settings"
TABLE_JOBS = "cert-lifecycle-agent-jobs"


_SKIP = object()


def _load_env() -> None:
    """
    Best-effort load of .env into process env.
    We intentionally do not hard-require python-dotenv.
    """

    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv()
    except Exception:
        return


def _get_dynamodb_resource():
    _load_env()

    region = os.getenv("AWS_REGION")
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")

    if not region or not access_key or not secret_key:
        logger.error(
            "Missing required AWS env vars (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION)."
        )

    try:
        return boto3.resource(
            "dynamodb",
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
    except Exception:
        logger.exception("Failed to initialize DynamoDB resource.")
        raise


def _to_dynamo(obj: Any) -> Any:
    """
    Recursively convert Python objects to DynamoDB-safe types:
    - bool -> bool (must be checked before int)
    - int/float -> Decimal
    - None -> removed (dict keys skipped; list elements skipped)
    - dict/list processed recursively
    """

    if obj is None:
        return _SKIP

    # bool must be checked before int (since bool is a subclass of int)
    if isinstance(obj, bool):
        return obj

    if isinstance(obj, Decimal):
        return obj

    if isinstance(obj, int):
        return Decimal(obj)

    if isinstance(obj, float):
        # Use string to avoid binary float artifacts
        return Decimal(str(obj))

    if isinstance(obj, str):
        return obj

    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            converted = _to_dynamo(v)
            if converted is _SKIP:
                continue
            out[str(k)] = converted
        return out

    if isinstance(obj, list):
        out_list: list[Any] = []
        for item in obj:
            converted = _to_dynamo(item)
            if converted is _SKIP:
                continue
            out_list.append(converted)
        return out_list

    # Fall back to string for unknown types (keeps DB writes from crashing)
    try:
        return str(obj)
    except Exception:
        return _SKIP


def _from_dynamo(obj: Any) -> Any:
    """
    Recursively convert DynamoDB-returned objects to Python types:
    - Decimal -> int if whole number else float
    - dict/list processed recursively
    """

    if isinstance(obj, Decimal):
        try:
            if obj == obj.to_integral_value():
                return int(obj)
            return float(obj)
        except Exception:
            return float(obj)

    if isinstance(obj, dict):
        return {k: _from_dynamo(v) for k, v in obj.items()}

    if isinstance(obj, list):
        return [_from_dynamo(v) for v in obj]

    return obj


def _scan_all(table, filter_expression=None) -> list[dict]:
    items: list[dict] = []
    last_evaluated_key = None

    while True:
        kwargs = {}
        if filter_expression is not None:
            kwargs["FilterExpression"] = filter_expression
        if last_evaluated_key is not None:
            kwargs["ExclusiveStartKey"] = last_evaluated_key

        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []) or [])

        last_evaluated_key = resp.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break

    return items


def db_save_cert(cert: dict) -> bool:
    """
    Upsert full cert record into TABLE_CERTS.
    """

    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_CERTS)

        item = _to_dynamo(cert)
        if not isinstance(item, dict):
            logger.error("db_save_cert expected dict after conversion.")
            return False

        table.put_item(Item=item)
        return True
    except Exception:
        logger.exception("db_save_cert failed.")
        return False


def db_load_manual_certs() -> list[dict]:
    """
    Scan TABLE_CERTS where date_mode IN ['manual', 'imported', 'live'].
    """

    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_CERTS)

        filter_expr = Attr("date_mode").is_in(["manual", "imported", "live"])
        items = _scan_all(table, filter_expression=filter_expr)
        return [_from_dynamo(i) for i in items]
    except Exception:
        logger.exception("db_load_manual_certs failed.")
        return []


def db_delete_cert(certificate_id: str) -> bool:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_CERTS)
        table.delete_item(Key={"certificate_id": certificate_id})
        return True
    except Exception:
        logger.exception("db_delete_cert failed.")
        return False


def db_save_notification(notif: dict) -> bool:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_NOTIFICATIONS)

        item = _to_dynamo(notif)
        if not isinstance(item, dict):
            logger.error("db_save_notification expected dict after conversion.")
            return False

        table.put_item(Item=item)
        return True
    except Exception:
        logger.exception("db_save_notification failed.")
        return False


def db_load_notifications() -> list[dict]:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_NOTIFICATIONS)

        items = _scan_all(table)
        out = [_from_dynamo(i) for i in items]
        out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return out
    except Exception:
        logger.exception("db_load_notifications failed.")
        return []


def db_save_email_log_entry(entry: dict) -> bool:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_EMAIL_LOG)

        item = _to_dynamo(entry)
        if not isinstance(item, dict):
            logger.error("db_save_email_log_entry expected dict after conversion.")
            return False

        table.put_item(Item=item)
        return True
    except Exception:
        logger.exception("db_save_email_log_entry failed.")
        return False


def db_load_email_log() -> list[dict]:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_EMAIL_LOG)

        items = _scan_all(table)
        out = [_from_dynamo(i) for i in items]
        out.sort(key=lambda x: x.get("sent_at") or "", reverse=True)
        return out
    except Exception:
        logger.exception("db_load_email_log failed.")
        return []


def db_save_setting(key: str, value: dict) -> bool:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_SETTINGS)

        item = {"setting_key": key, "data": json.dumps(value)}
        table.put_item(Item=item)
        return True
    except Exception:
        logger.exception("db_save_setting failed.")
        return False


def db_load_setting(key: str) -> Optional[dict]:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_SETTINGS)

        resp = table.get_item(Key={"setting_key": key})
        item = resp.get("Item")
        if not item:
            return None

        data = item.get("data")
        if not data:
            return None

        try:
            return json.loads(data)
        except Exception:
            logger.exception("db_load_setting: failed to json.loads setting data.")
            return None
    except Exception:
        logger.exception("db_load_setting failed.")
        return None


def db_save_job(job: dict) -> bool:
    """
    Upsert job into TABLE_JOBS by certificate_id.
    """

    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_JOBS)

        item = _to_dynamo(job)
        if not isinstance(item, dict):
            logger.error("db_save_job expected dict after conversion.")
            return False

        table.put_item(Item=item)
        return True
    except Exception:
        logger.exception("db_save_job failed.")
        return False


def db_load_jobs() -> list[dict]:
    try:
        dynamodb = _get_dynamodb_resource()
        table = dynamodb.Table(TABLE_JOBS)

        items = _scan_all(table)
        return [_from_dynamo(i) for i in items]
    except Exception:
        logger.exception("db_load_jobs failed.")
        return []


def db_health_check() -> dict:
    """
    Try to describe each table; return {table_name: 'ok'/'error'} for all 5 tables.
    """

    results: dict[str, str] = {}
    tables = [
        TABLE_CERTS,
        TABLE_NOTIFICATIONS,
        TABLE_EMAIL_LOG,
        TABLE_SETTINGS,
        TABLE_JOBS,
    ]

    try:
        dynamodb = _get_dynamodb_resource()
        client = dynamodb.meta.client
    except Exception:
        # _get_dynamodb_resource already logged
        return {t: "error" for t in tables}

    for t in tables:
        try:
            client.describe_table(TableName=t)
            results[t] = "ok"
        except Exception:
            logger.exception("db_health_check: describe_table failed for %s", t)
            results[t] = "error"

    return results

