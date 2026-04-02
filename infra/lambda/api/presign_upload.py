import os
import re
from uuid import uuid4

import boto3

from common import parse_body, response

s3_client = boto3.client("s3")
UPLOADS_BUCKET = os.environ["UPLOADS_BUCKET"]
VALID_CATEGORIES = {"documents", "referenceOutputs", "policyFiles", "aiOutputs"}


def sanitize_filename(filename):
    return re.sub(r"[^A-Za-z0-9._-]", "-", filename).strip("-") or "file"


def handler(event, _context):
    payload = parse_body(event)
    files = payload.get("files", [])
    draft_id = payload.get("draftId") or f"draft-{uuid4().hex[:12]}"

    if not files:
        return response(400, {"message": "files is required"})

    uploads = []

    for file_info in files:
        filename = sanitize_filename(file_info.get("fileName", "file"))
        category = file_info.get("category")
        content_type = file_info.get("contentType") or "application/octet-stream"

        if category not in VALID_CATEGORIES:
            return response(400, {"message": f"Invalid category: {category}"})

        object_key = f"drafts/{draft_id}/{category}/{uuid4().hex[:8]}-{filename}"
        upload_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": UPLOADS_BUCKET,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=900,
        )
        uploads.append(
            {
                "fileName": filename,
                "category": category,
                "contentType": content_type,
                "objectKey": object_key,
                "uploadUrl": upload_url,
            }
        )

    return response(200, {"draftId": draft_id, "uploads": uploads})
