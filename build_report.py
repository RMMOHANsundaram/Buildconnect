"""Build the BuildConnect project report .docx."""

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION

from report_lib import (
    new_doc, setup_section, add_page_field, set_pgnum_start,
    build_cover, build_bonafide, build_toc, render,
)
from report_content import COVER, BONAFIDE, TOC_ROWS, ALL_CHAPTERS

OUT = "BuildConnect_Project_Report.docx"


def main():
    doc = new_doc()

    # ---- front matter (section 0: unnumbered) ----
    build_cover(doc, COVER)
    doc.add_page_break()
    build_bonafide(doc, BONAFIDE)
    doc.add_page_break()
    build_toc(doc, "TABLE OF CONTENT", TOC_ROWS)

    # ---- chapters (section 1: page numbers restart at 1) ----
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    setup_section(sec)
    set_pgnum_start(sec, 1)
    sec.footer.is_linked_to_previous = False
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_page_field(fp)

    for idx, chapter in enumerate(ALL_CHAPTERS):
        render(doc, chapter, chapter_break=(idx > 0))

    doc.save(OUT)
    print("saved:", OUT)


if __name__ == "__main__":
    main()
