# -*- coding: utf-8 -*-
"""Verify the generated report PDF: chapter pages, footers, fonts, spacing."""
import sys, re
import pymupdf

PDF = sys.argv[1] if len(sys.argv) > 1 else "BuildConnect_Project_Report.pdf"
doc = pymupdf.open(PDF)
print("TOTAL PAGES:", len(doc))

front = []          # chapter -> pdf page (1-based)
footers = {}        # pdf page -> footer text
fonts = set()
sizes = set()

for i, page in enumerate(doc):
    d = page.get_text("dict")
    page_footer = None
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                txt = s["text"].strip()
                if not txt:
                    continue
                fonts.add(s["font"])
                sizes.add(round(s["size"], 1))
                if s["bbox"][1] > 760:          # footer zone
                    page_footer = txt
                m = re.match(r"^CHAPTER (\d)$", txt)
                if m:
                    front.append((int(m.group(1)), i + 1))
    if page_footer:
        footers[i + 1] = page_footer

print("CHAPTER starts (chapter, pdf page, printed number):")
for ch, pg in front:
    print(f"  ch{ch}: pdf page {pg}  footer={footers.get(pg, '?')}")

# front matter footers must be absent
for pg in (1, 2, 3):
    print(f"front page {pg} footer: {footers.get(pg, '(none)')}")

print("fonts used:", sorted(fonts))
print("font sizes:", sorted(sizes))

# TOC actual values
toc_expected = {"1": None}
ch_pages = {str(ch): str(pg - 3) for ch, pg in front}  # section restarts after 3 front pages
print("computed TOC page numbers:", ch_pages)
