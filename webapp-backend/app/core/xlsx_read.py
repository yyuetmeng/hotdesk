"""Minimal .xlsx reader (Office Open XML) for uploads, so imports need no extra dependency.

read_xlsx(data) -> rows of the first sheet: strings, floats (numbers and Excel date serials) or None for empty
cells. Fully empty rows are dropped; with numbered=True each row comes as (Excel row number, cells).
Handles shared strings (what Excel writes), inline strings (what app.core.xlsx writes) and formula results.
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
MAX_PART_BYTES = 50 * 1024 * 1024          # refuse zip bombs: no part may unpack to more than this


def _part(z: zipfile.ZipFile, name: str) -> bytes:
    info = z.getinfo(name)
    if info.file_size > MAX_PART_BYTES:
        raise ValueError("the file is too large")
    return z.read(name)


def _text(node) -> str:
    return "".join(t.text or "" for t in node.iter(f"{{{NS['m']}}}t"))


def _column(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref or "")
    n = 0
    for ch in letters.group(0) if letters else "A":
        n = n * 26 + ord(ch) - 64
    return n - 1


def _first_sheet(z: zipfile.ZipFile) -> str:
    try:
        book = ET.fromstring(_part(z, "xl/workbook.xml"))
        rid = book.find("m:sheets/m:sheet", NS).get(REL_ID)
        rels = ET.fromstring(_part(z, "xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == rid)
        return target.lstrip("/") if target.startswith("/") else f"xl/{target}"
    except (KeyError, AttributeError, StopIteration):
        return "xl/worksheets/sheet1.xml"


def read_xlsx(data: bytes, numbered: bool = False) -> list:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = [_text(si) for si in ET.fromstring(_part(z, "xl/sharedStrings.xml")).findall("m:si", NS)]
        sheet = ET.fromstring(_part(z, _first_sheet(z)))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise ValueError("this is not an Excel .xlsx file")
    out = []
    for i, row in enumerate(sheet.iterfind("m:sheetData/m:row", NS)):
        cells = {}
        for c in row.iterfind("m:c", NS):
            kind, v = c.get("t"), c.find("m:v", NS)
            if kind == "s":
                value = shared[int(v.text)] if v is not None and v.text and int(v.text) < len(shared) else None
            elif kind == "inlineStr":
                is_ = c.find("m:is", NS)
                value = _text(is_) if is_ is not None else None
            elif kind in ("str", "b"):
                value = v.text if v is not None else None
            elif kind == "e" or v is None or v.text is None:
                value = None
            else:
                try:
                    value = float(v.text)
                except ValueError:
                    value = v.text
            if isinstance(value, str) and not value.strip():
                value = None
            cells[_column(c.get("r"))] = value
        if not any(v is not None for v in cells.values()):
            continue
        values = [cells.get(k) for k in range(max(cells) + 1)]
        number = int(row.get("r") or i + 1)
        out.append((number, values) if numbered else values)
    return out
