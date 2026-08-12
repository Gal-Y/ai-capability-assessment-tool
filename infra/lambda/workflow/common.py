import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from xml.etree import ElementTree

import boto3

s3_client = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
ARTIFACTS_BUCKET = os.environ.get("ARTIFACTS_BUCKET")
EVALUATIONS_TABLE = os.environ.get("EVALUATIONS_TABLE")
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET")


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


def read_uploaded_file(file_ref):
    if not UPLOADS_BUCKET:
        raise RuntimeError("UPLOADS_BUCKET is not configured")

    response = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=file_ref["key"])
    content_type = (
        response.get("ContentType")
        or mimetypes.guess_type(file_ref["name"])[0]
        or "application/octet-stream"
    )

    return {
        "name": file_ref["name"],
        "contentType": content_type,
        "bytes": response["Body"].read(),
    }


def get_openai_file_content_type(name, content_type):
    normalized_name = str(name or "").lower()
    normalized_type = str(content_type or "").split(";", 1)[0].strip().lower()

    if normalized_name.endswith((".xml", ".cda", ".ccda")) or (
        normalized_type in {"application/xml", "application/hl7-v3+xml"}
        or normalized_type.endswith("+xml")
    ):
        return "text/xml"

    return normalized_type or "application/octet-stream"


def to_input_file_item(file_ref):
    uploaded = read_uploaded_file(file_ref)
    encoded = base64.b64encode(uploaded["bytes"]).decode("ascii")
    content_type = get_openai_file_content_type(
        uploaded["name"], uploaded["contentType"]
    )
    return {
        "type": "input_file",
        "filename": uploaded["name"],
        "file_data": f"data:{content_type};base64,{encoded}",
    }


def _truncate_text(value, max_chars=None):
    if max_chars is None or max_chars <= 0 or len(value) <= max_chars:
        return value
    return value[: max_chars - 1].rstrip() + "…"


def _decode_text_bytes(value):
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")


def _extract_docx_text(file_bytes):
    namespace = {
        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    }
    paragraphs = []

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
        xml_parts = sorted(
            name
            for name in archive.namelist()
            if name == "word/document.xml"
            or re.match(r"word/(header|footer)\d+\.xml$", name)
        )

        for part_name in xml_parts:
            root = ElementTree.fromstring(archive.read(part_name))

            for paragraph in root.findall(".//w:p", namespace):
                chunks = []
                for node in paragraph.iter():
                    tag = node.tag.rsplit("}", 1)[-1]
                    if tag == "t" and node.text:
                        chunks.append(node.text)
                    elif tag == "tab":
                        chunks.append("\t")
                    elif tag in {"br", "cr"}:
                        chunks.append("\n")

                text = "".join(chunks).strip()
                if text:
                    paragraphs.append(text)

    return "\n\n".join(paragraphs)


def extract_readable_text(file_ref, max_chars=None):
    uploaded = read_uploaded_file(file_ref)
    name = uploaded["name"].lower()
    content_type = uploaded["contentType"].lower()
    text = None

    if name.endswith(".docx") or (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        in content_type
    ):
        text = _extract_docx_text(uploaded["bytes"])
    elif any(
        name.endswith(extension)
        for extension in (".txt", ".md", ".json", ".csv", ".xml", ".html")
    ) or content_type.startswith("text/"):
        text = _decode_text_bytes(uploaded["bytes"])

    if text is None:
        return None

    normalized = re.sub(r"\n{3,}", "\n\n", text).strip()
    return _truncate_text(normalized, max_chars) if normalized else None


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
