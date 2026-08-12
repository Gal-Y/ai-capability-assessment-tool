import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_common_module():
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *_args, **_kwargs: None
    boto3.resource = lambda *_args, **_kwargs: None
    sys.modules["boto3"] = boto3

    path = ROOT / "infra/lambda/workflow/common.py"
    spec = importlib.util.spec_from_file_location("workflow_common", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COMMON = load_common_module()


class OpenAiFileContentTypeTests(unittest.TestCase):
    def test_application_xml_is_normalized_for_model_file_input(self):
        self.assertEqual(
            COMMON.get_openai_file_content_type("report.xml", "application/xml"),
            "text/xml",
        )

    def test_cda_extension_is_normalized_even_with_generic_mime_type(self):
        self.assertEqual(
            COMMON.get_openai_file_content_type(
                "report.cda", "application/octet-stream"
            ),
            "text/xml",
        )

    def test_pdf_content_type_is_preserved(self):
        self.assertEqual(
            COMMON.get_openai_file_content_type("report.pdf", "application/pdf"),
            "application/pdf",
        )

    def test_input_file_item_uses_normalized_xml_data_url(self):
        original_reader = COMMON.read_uploaded_file
        COMMON.read_uploaded_file = lambda _file_ref: {
            "name": "report.xml",
            "contentType": "application/xml",
            "bytes": b"<ClinicalDocument />",
        }
        try:
            item = COMMON.to_input_file_item(
                {"name": "report.xml", "key": "documents/report.xml"}
            )
        finally:
            COMMON.read_uploaded_file = original_reader

        self.assertTrue(item["file_data"].startswith("data:text/xml;base64,"))


if __name__ == "__main__":
    unittest.main()
