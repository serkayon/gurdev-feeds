# Generate professional invoices as PDF — Navy/Gold theme matching production report.

from datetime import date
from io import BytesIO
 
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    HRFlowable, Image, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle,
)

from .timezone import app_now
 
 
# Handle generate invoice pdf.

def generate_invoice_pdf(
    dispatch_entry,
    products,
    company_name    = "SERKAYON FEED MILL",
    company_tagline = "Industrial Intelligence",
    company_address = "Trichy, Tamil Nadu, India",
    company_city    = "620001",
    company_phone   = "(+91) 9876543210",
    company_fax     = "(+91) 9876543210",
):
    # ── Palette (navy/gold — same as production report) ───────────────────────
    NAVY       = HexColor("#0D2545")
    NAVY_LIGHT = HexColor("#1A3A6B")
    GOLD       = HexColor("#C8922A")
    GOLD_LIGHT = HexColor("#F5E6C8")
    GOLD_BG    = HexColor("#FDF8EE")
    GREY_DARK  = HexColor("#3D3D3D")
    GREY_MID   = HexColor("#6B6B6B")
    GREY_LIGHT = HexColor("#F2F4F7")
    RULE       = HexColor("#D9DDE6")
    WHITE      = HexColor("#FFFFFF")
 
    # ── Document setup ────────────────────────────────────────────────────────
    buffer = BytesIO()
    PAGE_W, PAGE_H = A4
    MARGIN = 18 * mm
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN,  bottomMargin=MARGIN,
    )
    W = doc.width   # usable width
    story = []
 
    # ── Style factory ─────────────────────────────────────────────────────────

    def S(name, **kw):
        base = getSampleStyleSheet()["Normal"]
        return ParagraphStyle(name, parent=base, **kw)
 
    # Handle safe.

    def _safe(v, fallback="—"):
        if v in (None, "", 0):
            return fallback
        return str(v)
 
    # ── Derived values ────────────────────────────────────────────────────────
    inv_date = (dispatch_entry.date.strftime("%d %B %Y")
                if hasattr(dispatch_entry.date, "strftime")
                else str(dispatch_entry.date))
    dispatch_code = str(getattr(dispatch_entry, "dispatch_code", "") or "").strip()
    if not dispatch_code:
        dispatch_code = "DPX00000"
    inv_no   = f"INV-{dispatch_code}"
 
    # ══════════════════════════════════════════════════════════════════════════
    #  SECTION 1 — HEADER BAR  (navy block with company + INVOICE badge)
    # ══════════════════════════════════════════════════════════════════════════
    # Left: white company name + gold tagline inside navy cell
    # Right: "INVOICE" large + gold inv number
 
    co_name_p = Paragraph(
        company_name.upper(),
        S("CN", fontSize=15, fontName="Helvetica-Bold", textColor=WHITE),
    )
    co_tag_p = Paragraph(
        company_tagline,
        S("CT", fontSize=8, fontName="Helvetica", textColor=GOLD_LIGHT, leading=12),
    )
    co_addr_p = Paragraph(
        f"{company_address} · {company_city}",
        S("CA", fontSize=7.5, textColor=HexColor("#AAC4D8"), leading=11),
    )
    co_phone_p = Paragraph(
        f"Phone {company_phone}   |   Fax {company_fax}",
        S("CP", fontSize=7.5, textColor=HexColor("#AAC4D8"), leading=11),
    )
 
    inv_lbl_p = Paragraph(
        "INVOICE",
        S("IL", fontSize=26, fontName="Helvetica-Bold", textColor=WHITE, alignment=TA_RIGHT),
    )
    inv_no_p = Paragraph(
        inv_no,
        S("IN", fontSize=10, fontName="Helvetica-Bold", textColor=GOLD, alignment=TA_RIGHT),
    )
    inv_date_p = Paragraph(
        inv_date,
        S("ID", fontSize=8.5, textColor=GOLD_LIGHT, alignment=TA_RIGHT),
    )
 
    header_tbl = Table(
        [[
            [co_name_p, Spacer(1, 3), co_tag_p, Spacer(1, 5), co_addr_p, co_phone_p],
            [inv_lbl_p, Spacer(1, 4), inv_no_p, inv_date_p],
        ]],
        colWidths=[W * 0.58, W * 0.42],
    )
    header_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",   (0, 0), (0, -1),  14),
        ("RIGHTPADDING",  (0, 0), (0, -1),  8),
        ("LEFTPADDING",   (1, 0), (1, -1),  8),
        ("RIGHTPADDING",  (1, 0), (1, -1),  14),
        ("TOPPADDING",    (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    story.append(header_tbl)
 
    # Gold accent stripe under header
    story.append(Table(
        [[""]],
        colWidths=[W],
        rowHeights=[3],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), GOLD)]),
    ))
    story.append(Spacer(1, 6 * mm))
 
    # ══════════════════════════════════════════════════════════════════════════
    #  SECTION 2 — BILL TO / SHIP TO  +  INVOICE META
    # ══════════════════════════════════════════════════════════════════════════
    lbl_s  = S("Lbl",  fontSize=7,   fontName="Helvetica-Bold", textColor=NAVY,      leading=10)
    pname_s= S("PN",   fontSize=9.5, fontName="Helvetica-Bold", textColor=GREY_DARK, leading=13)
    val_s  = S("Val",  fontSize=8.5, textColor=GREY_MID, leading=12)
    mlbl_s = S("ML",   fontSize=7.5, fontName="Helvetica-Bold", textColor=GREY_MID,  alignment=TA_RIGHT)
    mval_s = S("MV",   fontSize=8.5, fontName="Helvetica-Bold", textColor=NAVY,      alignment=TA_RIGHT)
 
    # Handle addr block.

    def _addr_block(heading, name, address=None, pincode=None, phone=None):
        lines = [Paragraph(heading, lbl_s), Paragraph(name, pname_s)]
        if address:  lines.append(Paragraph(address, val_s))
        if pincode:  lines.append(Paragraph(f"Pin: {pincode}", val_s))
        if phone:    lines.append(Paragraph(f"Ph: {phone}", val_s))
        return lines
 
    bill_block = _addr_block(
        "BILL TO",
        dispatch_entry.party_name,
        getattr(dispatch_entry, "party_address", None),
        getattr(dispatch_entry, "pincode",       None),
        getattr(dispatch_entry, "party_phone",   None),
    )
    ship_block = _addr_block(
        "SHIP TO",
        dispatch_entry.party_name,
        getattr(dispatch_entry, "party_address", None),
        getattr(dispatch_entry, "pincode",       None),
        getattr(dispatch_entry, "party_phone",   None),
    )
 
    # Invoice meta box (right column)
    meta_rows = [
        [Paragraph("INVOICE #",      mlbl_s), Paragraph(inv_no,   mval_s)],
        [Paragraph("DATE",           mlbl_s), Paragraph(inv_date, mval_s)],
        [Paragraph("P.O. NUMBER",    mlbl_s), Paragraph(_safe(getattr(dispatch_entry, "po_number", "")),   mval_s)],
        [Paragraph("VEHICLE NO.",    mlbl_s), Paragraph(_safe(getattr(dispatch_entry, "vehicle_no", "")),  mval_s)],
        [Paragraph("SALESPERSON",    mlbl_s), Paragraph(_safe(getattr(dispatch_entry, "salesperson", "")), mval_s)],
        [Paragraph("PAYMENT TERMS",  mlbl_s), Paragraph(_safe(getattr(dispatch_entry, "terms", "As Agreed")), mval_s)],
    ]
    meta_t = Table(meta_rows, colWidths=[W * 0.16, W * 0.18])
    meta_t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), GOLD_BG),
        ("LINEBELOW",     (0, 0), (-1, -2), 0.4, RULE),
        ("BACKGROUND",    (0, -1), (-1, -1), GOLD_LIGHT),
        ("LINEABOVE",     (0, -1), (-1, -1), 1.5, GOLD),
        ("BOX",           (0, 0),  (-1, -1), 0.8, GOLD),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 7),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
 
    addr_tbl = Table(
        [[bill_block, ship_block, meta_t]],
        colWidths=[W * 0.32, W * 0.34, W * 0.34],
    )
    addr_tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (1, -1),  0),
        ("RIGHTPADDING", (0, 0), (1, -1),  10),
        ("LEFTPADDING",  (2, 0), (2, -1),  0),
        ("RIGHTPADDING", (2, 0), (2, -1),  0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LINEBEFORE",   (0, 0), (0, -1),  3, NAVY),
        ("LINEBEFORE",   (1, 0), (1, -1),  3, GOLD),
    ]))
    story.append(addr_tbl)
    story.append(Spacer(1, 5 * mm))
 
    # ── Notes / Special Instructions ─────────────────────────────────────────
    if getattr(dispatch_entry, "notes", None):
        notes_tbl = Table(
            [[Paragraph(
                f"<b>SPECIAL INSTRUCTIONS:</b>  {dispatch_entry.notes}",
                S("NT", fontSize=8, textColor=GREY_DARK, leading=11),
            )]],
            colWidths=[W],
        )
        notes_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), GOLD_BG),
            ("BOX",           (0, 0), (-1, -1), 0.5, GOLD),
            ("LINEBEFORE",    (0, 0), (0, -1),  3, GOLD),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ]))
        story.append(notes_tbl)
        story.append(Spacer(1, 4 * mm))
 
    # ══════════════════════════════════════════════════════════════════════════
    #  SECTION 3 — LINE ITEMS TABLE
    # ══════════════════════════════════════════════════════════════════════════
    #  Columns: # | Description | Bags | Wt/Bag (kg) | Total Wt (kg) | Unit Price | Amount
    col_w = [
        W * 0.05,   # #
        W * 0.28,   # Description
        W * 0.09,   # Bags
        W * 0.11,   # Wt/Bag
        W * 0.12,   # Total Wt
        W * 0.155,  # Unit Price
        W * 0.155,  # Amount
    ]
    hdrs = ["#", "DESCRIPTION", "BAGS", "WT/BAG\n(KG)", "TOTAL WT\n(KG)", "UNIT PRICE\n(₹/KG)", "AMOUNT\n(₹)"]
 
    hdr_s  = S("IH", fontSize=7.5, fontName="Helvetica-Bold", textColor=WHITE, alignment=TA_CENTER)
    idx_s  = S("IX", fontSize=8.5, textColor=GREY_MID, alignment=TA_CENTER)
    desc_s = S("DS", fontSize=8.5, textColor=GREY_DARK, leading=11)
    num_s  = S("NS", fontSize=8.5, textColor=GREY_DARK, alignment=TA_RIGHT)
    ctr_s  = S("CS", fontSize=8.5, textColor=GREY_DARK, alignment=TA_CENTER)
    amt_s  = S("AS", fontSize=8.5, fontName="Helvetica-Bold", textColor=NAVY, alignment=TA_RIGHT)
 
    items_data = [[Paragraph(h, hdr_s) for h in hdrs]]
 
    total_weight = 0.0
    total_bags   = 0
    subtotal     = 0.0
    price        = getattr(dispatch_entry, "price", None) or 0
 
    if products:
        for i, product in enumerate(products, 1):
            wt         = float(product.total_weight)
            bags       = int(product.num_bags)
            wpb        = float(product.weight_per_bag)
            line_amt   = wt * price
            total_weight += wt
            total_bags   += bags
            subtotal     += line_amt
            items_data.append([
                Paragraph(str(i),                  idx_s),
                Paragraph(product.product_type,    desc_s),
                Paragraph(str(bags),               ctr_s),
                Paragraph(f"{wpb:.2f}",            num_s),
                Paragraph(f"{wt:.2f}",             num_s),
                Paragraph(f"₹ {price:.2f}" if price else "—", num_s),
                Paragraph(f"₹ {line_amt:.2f}" if price else f"{wt:.2f} kg", amt_s),
            ])
 
    # Pad to minimum 6 data rows for clean layout
    min_rows = 6
    while len(items_data) - 1 < min_rows:
        items_data.append([Paragraph("", idx_s)] + [Paragraph("", desc_s)] * 6)
 
    items_tbl = Table(items_data, colWidths=col_w, repeatRows=1)
    row_count  = len(items_data)
 
    item_cmds = [
        # Header
        ("BACKGROUND",    (0, 0), (-1, 0),  NAVY),
        ("LINEBELOW",     (0, 0), (-1, 0),  2,   GOLD),
        ("TOPPADDING",    (0, 0), (-1, 0),  8),
        ("BOTTOMPADDING", (0, 0), (-1, 0),  8),
        ("VALIGN",        (0, 0), (-1, 0),  "MIDDLE"),
        # Data rows
        ("TOPPADDING",    (0, 1), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
        ("VALIGN",        (0, 1), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",   (1, 0), (1, -1),  8),
        ("RIGHTPADDING",  (2, 0), (-1, -1), 8),
        # Grid
        ("LINEBELOW",     (0, 1), (-1, -1), 0.4, RULE),
        ("LINEBEFORE",    (1, 0), (-1, -1), 0.4, RULE),
        ("BOX",           (0, 0), (-1, -1), 0.8, NAVY),
    ]
    # Alternating row backgrounds
    for i in range(1, row_count):
        bg = GREY_LIGHT if i % 2 == 0 else WHITE
        item_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
 
    items_tbl.setStyle(TableStyle(item_cmds))
    story.append(items_tbl)
    story.append(Spacer(1, 0))
 
    # ══════════════════════════════════════════════════════════════════════════
    #  SECTION 4 — TOTALS BLOCK  (right-aligned)
    # ══════════════════════════════════════════════════════════════════════════
    tl_s  = S("TL",  fontSize=8.5, textColor=GREY_MID,  alignment=TA_RIGHT)
    tv_s  = S("TV",  fontSize=8.5, fontName="Helvetica-Bold", textColor=GREY_DARK, alignment=TA_RIGHT)
    ttl_s = S("TTL", fontSize=11,  fontName="Helvetica-Bold", textColor=WHITE, alignment=TA_RIGHT)
    ttv_s = S("TTV", fontSize=11,  fontName="Helvetica-Bold", textColor=WHITE, alignment=TA_RIGHT)
 
    sum_col_w = [W * 0.20, W * 0.17]
    sum_rows  = [
        [Paragraph("SUBTOTAL",       tl_s), Paragraph(f"₹ {subtotal:.2f}",      tv_s)],
        [Paragraph("TOTAL WEIGHT",   tl_s), Paragraph(f"{total_weight:.2f} kg",  tv_s)],
        [Paragraph("TOTAL BAGS",     tl_s), Paragraph(str(total_bags),            tv_s)],
        [Paragraph("TOTAL DUE",      ttl_s), Paragraph(f"₹ {subtotal:.2f}",      ttv_s)],
    ]
    sum_t = Table(sum_rows, colWidths=sum_col_w)
    sum_t.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("BACKGROUND",    (0, 0), (-1, -2), GOLD_BG),
        ("LINEBELOW",     (0, 0), (-1, -2), 0.4, RULE),
        ("BACKGROUND",    (0, -1), (-1, -1), NAVY),
        ("LINEABOVE",     (0, -1), (-1, -1), 2,   GOLD),
        ("BOX",           (0, 0),  (-1, -1), 0.8, NAVY),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
 
    spacer_w = W - sum(sum_col_w)
    outer = Table([[None, sum_t]], colWidths=[spacer_w, sum(sum_col_w)])
    outer.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(outer)
    story.append(Spacer(1, 6 * mm))
 
    # ══════════════════════════════════════════════════════════════════════════
    #  SECTION 5 — FOOTER  (terms + signature)
    # ══════════════════════════════════════════════════════════════════════════
    # Thin gold rule
    story.append(Table(
        [[""]],
        colWidths=[W],
        rowHeights=[2],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), GOLD)]),
    ))
    story.append(Spacer(1, 4 * mm))
 
    terms_lbl_s = S("TrL", fontSize=7.5, fontName="Helvetica-Bold", textColor=NAVY)
    terms_txt_s = S("TrT", fontSize=7.5, textColor=GREY_MID, leading=12)
    sig_lbl_s   = S("SgL", fontSize=7.5, fontName="Helvetica-Bold", textColor=NAVY,     alignment=TA_RIGHT)
    sig_line_s  = S("SgN", fontSize=9,   textColor=GREY_MID,                            alignment=TA_RIGHT)
    sig_co_s    = S("SgC", fontSize=7.5, textColor=GREY_MID,                            alignment=TA_RIGHT)
 
    footer_tbl = Table(
        [[
            [
                Paragraph("TERMS & CONDITIONS", terms_lbl_s),
                Spacer(1, 4),
                Paragraph("1. Payment terms as agreed upon.", terms_txt_s),
                Paragraph("2. Goods once sold cannot be returned.", terms_txt_s),
                Paragraph("3. All disputes subject to local jurisdiction.", terms_txt_s),
                Paragraph("4. This is a computer-generated invoice.", terms_txt_s),
            ],
            [
                Paragraph("For " + company_name.upper(), sig_lbl_s),
                Spacer(1, 30),
                Paragraph("________________________________", sig_line_s),
                Paragraph("Authorized Signatory", sig_co_s),
            ],
        ]],
        colWidths=[W * 0.60, W * 0.40],
    )
    footer_tbl.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LINEBEFORE",   (0, 0), (0, -1),  3, NAVY),
        ("LEFTPADDING",  (0, 0), (0, -1),  8),
    ]))
    story.append(footer_tbl)
    story.append(Spacer(1, 4 * mm))
 
    # Bottom timestamp strip
    ts_tbl = Table(
        [[Paragraph(
            f"Generated on {app_now().strftime('%d-%m-%Y %H:%M:%S')}   |   {company_name}   |   {inv_no}",
            S("TS", fontSize=6.5, textColor=HexColor("#AAAAAA"), alignment=TA_CENTER),
        )]],
        colWidths=[W],
    )
    ts_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), GREY_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BOX",           (0, 0), (-1, -1), 0.4, RULE),
    ]))
    story.append(ts_tbl)
 
    doc.build(story)
    buffer.seek(0)
    return buffer
 
