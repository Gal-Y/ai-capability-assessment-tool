from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "demo" / "synthetic-radiology-report.pdf"


def wrapped_lines(text, font_name, font_size, max_width):
    words = text.split()
    lines = []
    current = []
    for word in words:
        candidate = " ".join([*current, word])
        if current and stringWidth(candidate, font_name, font_size) > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines


def draw_wrapped(pdf, text, x, y, width, font_name="Helvetica", font_size=10, leading=14):
    pdf.setFont(font_name, font_size)
    for line in wrapped_lines(text, font_name, font_size, width):
        pdf.drawString(x, y, line)
        y -= leading
    return y


def draw_label_value(pdf, label, value, x, y, value_x):
    pdf.setFillColor(colors.HexColor("#5B616B"))
    pdf.setFont("Helvetica-Bold", 7.5)
    pdf.drawString(x, y, label.upper())
    pdf.setFillColor(colors.HexColor("#171A1F"))
    pdf.setFont("Helvetica", 9.5)
    pdf.drawString(value_x, y - 0.5, value)


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    page_width, page_height = A4
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    pdf.setTitle("Synthetic Chest X-ray Report")
    pdf.setAuthor("UNSW Thesis Demo")
    pdf.setSubject("Synthetic radiology companion report for CDA-to-FHIR evaluation")

    pdf.setFillColor(colors.HexColor("#F3F1EB"))
    pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    pdf.setStrokeColor(colors.Color(0.45, 0.45, 0.45, alpha=0.07))
    pdf.setLineWidth(0.25)
    for y in range(18, int(page_height), 29):
        pdf.line(8 * mm, y, page_width - 8 * mm, y + 1.2)

    pdf.saveState()
    pdf.translate(page_width / 2, page_height / 2)
    pdf.rotate(-0.55)
    pdf.translate(-page_width / 2, -page_height / 2)

    left = 19 * mm
    right = page_width - 19 * mm
    content_width = right - left

    pdf.setFillColor(colors.HexColor("#E5E2DA"))
    pdf.roundRect(left - 2 * mm, 14 * mm, content_width + 4 * mm, page_height - 28 * mm, 2 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.roundRect(left, 16 * mm, content_width, page_height - 32 * mm, 1.5 * mm, fill=1, stroke=0)

    top = page_height - 23 * mm
    pdf.setFillColor(colors.HexColor("#565B64"))
    pdf.setFont("Courier", 7.2)
    pdf.drawString(left + 5 * mm, top, "FAX TRANSMISSION COPY  |  11 AUG 2026 10:48  |  PAGE 1 OF 1")
    pdf.setStrokeColor(colors.HexColor("#B9BDC5"))
    pdf.line(left + 5 * mm, top - 3 * mm, right - 5 * mm, top - 3 * mm)

    logo_y = top - 18 * mm
    pdf.setFillColor(colors.HexColor("#203650"))
    pdf.roundRect(left + 5 * mm, logo_y - 1 * mm, 13 * mm, 13 * mm, 2 * mm, fill=1, stroke=0)
    pdf.setStrokeColor(colors.white)
    pdf.setLineWidth(1.3)
    pdf.circle(left + 11.5 * mm, logo_y + 5.5 * mm, 3.3 * mm, fill=0, stroke=1)
    pdf.line(left + 8.8 * mm, logo_y + 5.5 * mm, left + 14.2 * mm, logo_y + 5.5 * mm)
    pdf.line(left + 11.5 * mm, logo_y + 2.8 * mm, left + 11.5 * mm, logo_y + 8.2 * mm)

    pdf.setFillColor(colors.HexColor("#1E2938"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(left + 22 * mm, logo_y + 7 * mm, "HARBOUR DIAGNOSTIC IMAGING")
    pdf.setFillColor(colors.HexColor("#6F7680"))
    pdf.setFont("Helvetica", 7.7)
    pdf.drawString(left + 22 * mm, logo_y + 1.5 * mm, "RADIOLOGY REPORT  |  ARCHIVE EXPORT")

    badge_x = right - 42 * mm
    pdf.setFillColor(colors.HexColor("#F4F5F6"))
    pdf.roundRect(badge_x, logo_y, 34 * mm, 10 * mm, 1.5 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#4C525B"))
    pdf.setFont("Helvetica-Bold", 7)
    pdf.drawCentredString(badge_x + 17 * mm, logo_y + 6.1 * mm, "FINAL REPORT")
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(badge_x + 17 * mm, logo_y + 2.3 * mm, "SYNTHETIC RECORD")

    grid_top = logo_y - 9 * mm
    grid_height = 30 * mm
    pdf.setFillColor(colors.HexColor("#F7F7F5"))
    pdf.rect(left + 5 * mm, grid_top - grid_height, content_width - 10 * mm, grid_height, fill=1, stroke=0)
    pdf.setStrokeColor(colors.HexColor("#D4D6D9"))
    pdf.setLineWidth(0.45)
    pdf.rect(left + 5 * mm, grid_top - grid_height, content_width - 10 * mm, grid_height, fill=0, stroke=1)
    pdf.line(left + 5 * mm, grid_top - 10 * mm, right - 5 * mm, grid_top - 10 * mm)
    pdf.line(left + 5 * mm, grid_top - 20 * mm, right - 5 * mm, grid_top - 20 * mm)
    pdf.line(left + 94 * mm, grid_top, left + 94 * mm, grid_top - grid_height)

    draw_label_value(pdf, "Patient", "Alex Sample", left + 8 * mm, grid_top - 6.4 * mm, left + 29 * mm)
    draw_label_value(pdf, "DOB", "14/03/1982", left + 99 * mm, grid_top - 6.4 * mm, left + 111 * mm)
    draw_label_value(pdf, "Patient ID", "SYN-RAD-001", left + 8 * mm, grid_top - 16.4 * mm, left + 31 * mm)
    draw_label_value(pdf, "Ref", "HR-26-00184", left + 99 * mm, grid_top - 16.4 * mm, left + 111 * mm)
    draw_label_value(pdf, "Requested by", "Dr Taylor", left + 8 * mm, grid_top - 26.4 * mm, left + 35 * mm)
    draw_label_value(pdf, "Study", "CXR 2V", left + 99 * mm, grid_top - 26.4 * mm, left + 114 * mm)

    y = grid_top - grid_height - 11 * mm
    pdf.setFillColor(colors.HexColor("#1B2430"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(left + 7 * mm, y, "CLINICAL")
    y -= 6 * mm
    pdf.setFillColor(colors.HexColor("#252A31"))
    y = draw_wrapped(
        pdf,
        "Persistent cough, approximately three weeks. No prior imaging supplied with the archive export.",
        left + 7 * mm,
        y,
        content_width - 14 * mm,
        font_size=9.5,
        leading=13,
    )

    y -= 4 * mm
    pdf.setFillColor(colors.HexColor("#1B2430"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(left + 7 * mm, y, "REPORT")
    y -= 6 * mm
    pdf.setFillColor(colors.HexColor("#252A31"))
    y = draw_wrapped(
        pdf,
        "PA and lateral chest radiographs obtained. The cardiomediastinal silhouette is within normal limits. No focal air-space opacity or pleural effusion is identified. No acute osseous abnormality is visible on these images.",
        left + 7 * mm,
        y,
        content_width - 14 * mm,
        font_size=9.5,
        leading=14,
    )

    y -= 5 * mm
    pdf.setFillColor(colors.HexColor("#F1F3F5"))
    pdf.roundRect(left + 6 * mm, y - 21 * mm, content_width - 12 * mm, 24 * mm, 1.5 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#1B2430"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(left + 10 * mm, y - 4 * mm, "IMPRESSION")
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(left + 10 * mm, y - 12 * mm, "No acute cardiopulmonary abnormality.")

    signature_y = y - 39 * mm
    pdf.setStrokeColor(colors.HexColor("#AEB3BA"))
    pdf.line(left + 8 * mm, signature_y + 11 * mm, left + 78 * mm, signature_y + 11 * mm)
    pdf.setFillColor(colors.HexColor("#2F343B"))
    pdf.setFont("Helvetica-Oblique", 12)
    pdf.drawString(left + 11 * mm, signature_y + 3 * mm, "Maya Chen")
    pdf.setFont("Helvetica", 7.2)
    pdf.setFillColor(colors.HexColor("#626872"))
    pdf.drawString(left + 11 * mm, signature_y - 2.5 * mm, "MBBS FRANZCR  |  electronically signed 11/08/2026 10:42")

    pdf.setFillColor(colors.HexColor("#ECEEF0"))
    pdf.roundRect(right - 64 * mm, signature_y - 5 * mm, 56 * mm, 22 * mm, 1.5 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#525862"))
    pdf.setFont("Courier-Bold", 6.7)
    pdf.drawString(right - 60 * mm, signature_y + 10 * mm, "TECHNICAL ARCHIVE FOOTER")
    pdf.setFont("Courier", 6.2)
    pdf.drawString(right - 60 * mm, signature_y + 4.5 * mm, "MODALITY: DX   BODY: CHEST")
    pdf.drawString(right - 60 * mm, signature_y - 1 * mm, "ACC: HR-26-00184")

    footer_y = 27 * mm
    pdf.setStrokeColor(colors.HexColor("#D1D3D6"))
    pdf.line(left + 5 * mm, footer_y + 9 * mm, right - 5 * mm, footer_y + 9 * mm)
    pdf.setFillColor(colors.HexColor("#6A7079"))
    pdf.setFont("Courier", 6.2)
    pdf.drawString(left + 6 * mm, footer_y + 3 * mm, "DICOM STUDY UID  1.2.826.0.1.3680043.10.1000.14")
    pdf.drawRightString(right - 6 * mm, footer_y + 3 * mm, "ARCHIVE COPY / NOT A LIVE CLINICAL RECORD")

    pdf.restoreState()

    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
