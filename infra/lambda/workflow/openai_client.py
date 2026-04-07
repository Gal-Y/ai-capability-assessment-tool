import json
import os
import time
import urllib.error
import urllib.request


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_API_BASE_URL = os.environ.get(
    "OPENAI_API_BASE_URL", "https://api.openai.com/v1"
).strip()
DEFAULT_EVALUATOR_MODEL = os.environ.get(
    "OPENAI_EVALUATOR_MODEL", "gpt-5.4-mini"
).strip()


def extract_output_text(response_payload):
    if response_payload.get("output_text"):
        return response_payload["output_text"]

    output = response_payload.get("output", [])
    for item in output:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text", "")

    raise RuntimeError("OpenAI response did not include output text")


def parse_json_output(response_payload):
    output_text = extract_output_text(response_payload)

    try:
        return json.loads(output_text)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"OpenAI returned invalid JSON: {error.msg}"
        ) from error


def create_response(
    *,
    model,
    instructions,
    input_content,
    response_format=None,
    max_output_tokens=None,
    reasoning_effort="medium",
    verbosity="low",
    temperature=0.2,
    metadata=None,
):
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    payload = {
        "model": model,
        "store": False,
        "instructions": instructions,
        "input": [
            {
                "role": "user",
                "content": input_content,
            }
        ],
        "temperature": temperature,
        "truncation": "disabled",
    }

    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort}

    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens

    if metadata:
        payload["metadata"] = metadata

    if response_format:
        payload["text"] = {"format": response_format}
    else:
        payload["text"] = {
            "format": {"type": "text"},
            "verbosity": verbosity,
        }

    request = urllib.request.Request(
        f"{OPENAI_API_BASE_URL.rstrip('/')}/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    started_at = time.perf_counter()

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
            message = payload.get("error", {}).get("message") or body
        except json.JSONDecodeError:
            message = body or error.reason
        raise RuntimeError(f"OpenAI API error: {message}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OpenAI API request failed: {error.reason}") from error

    duration_seconds = time.perf_counter() - started_at

    if response_payload.get("error"):
        message = response_payload["error"].get("message") or "Unknown OpenAI error"
        raise RuntimeError(f"OpenAI API error: {message}")

    return response_payload, duration_seconds
