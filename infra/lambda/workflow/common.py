import hashlib
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3

s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
ARTIFACTS_BUCKET = os.environ.get("ARTIFACTS_BUCKET")
EVALUATIONS_TABLE = os.environ.get("EVALUATIONS_TABLE")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def artifact_key(state, suffix):
    return f"{state['artifactPrefix'].rstrip('/')}/{suffix.lstrip('/')}"


def write_artifact(state, suffix, payload):
    key = artifact_key(state, suffix)
    s3_client.put_object(
        Bucket=ARTIFACTS_BUCKET,
        Key=key,
        Body=json.dumps(payload, default=str).encode("utf-8"),
        ContentType="application/json",
    )
    return key


def stable_noise(seed, salt):
    digest = hashlib.sha256(f"{seed}:{salt}".encode("utf-8")).hexdigest()
    value = int(digest[:8], 16) % 1000
    return ((value / 1000) - 0.5) * 3


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def to_dynamodb(value):
    if isinstance(value, list):
        return [to_dynamodb(item) for item in value]
    if isinstance(value, dict):
        return {key: to_dynamodb(item) for key, item in value.items()}
    if isinstance(value, float):
        return Decimal(str(round(value, 4)))
    return value


def update_evaluation_item(evaluation_id, fields):
    if not EVALUATIONS_TABLE:
        return

    table = dynamodb.Table(EVALUATIONS_TABLE)
    update_names = {}
    update_values = {}
    assignments = []

    for index, (key, value) in enumerate(fields.items()):
        name_key = f"#f{index}"
        value_key = f":v{index}"
        update_names[name_key] = key
        update_values[value_key] = to_dynamodb(value)
        assignments.append(f"{name_key} = {value_key}")

    table.update_item(
        Key={"evaluationId": evaluation_id},
        UpdateExpression="SET " + ", ".join(assignments),
        ExpressionAttributeNames=update_names,
        ExpressionAttributeValues=update_values,
    )
