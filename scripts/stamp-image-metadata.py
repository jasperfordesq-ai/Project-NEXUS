#!/usr/bin/env python3
"""
stamp-image-metadata.py

Writes Project NEXUS XMP + tEXt metadata into PNG and JPEG images.
Strips existing tool-generated metadata (Canva attribution chunks etc.)
and replaces with canonical NEXUS copyright / authorship data.

Third-party logos (timebank partnership) are skipped.

Usage:
    python scripts/stamp-image-metadata.py [--dry-run]
"""

import struct, zlib, sys, os, re
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv

# ---------------------------------------------------------------------------
# Image-specific metadata overrides
# ---------------------------------------------------------------------------
IMAGES = {
    # react-frontend
    "react-frontend/public/images/powered-by-project-nexus-dark.png": {
        "title": "Project NEXUS – Powered By (Dark Mode)",
        "description": "Official Project NEXUS 'Powered By' attribution logo, dark-mode variant.",
    },
    "react-frontend/public/images/powered-by-project-nexus-light.png": {
        "title": "Project NEXUS – Powered By (Light Mode)",
        "description": "Official Project NEXUS 'Powered By' attribution logo, light-mode variant.",
    },
    "react-frontend/public/images/project-nexus-logo.png": {
        "title": "Project NEXUS Logo",
        "description": "Official Project NEXUS wordmark and icon logo.",
    },
    "react-frontend/public/icons/icon-192.png": {
        "title": "Project NEXUS App Icon 192×192",
        "description": "PWA / home-screen icon for the Project NEXUS community platform.",
    },
    "react-frontend/public/icons/icon-512.png": {
        "title": "Project NEXUS App Icon 512×512",
        "description": "PWA / home-screen icon for the Project NEXUS community platform.",
    },
}

# Shared fields applied to every NEXUS image
SHARED = {
    "author":    "Jasper Ford",
    "copyright": "© 2024–2026 Jasper Ford. Licensed under AGPL-3.0-or-later.",
    "url":       "https://project-nexus.ie",
    "keywords":  "Project NEXUS, timebanking, community platform, open source, AGPL, multi-tenant",
    "software":  "Project NEXUS",
}

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# PNG helpers
# ---------------------------------------------------------------------------

def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF

def read_png_chunks(data: bytes):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', "Not a PNG"
    i = 8
    chunks = []
    while i < len(data):
        length = struct.unpack(">I", data[i:i+4])[0]
        ctype  = data[i+4:i+8]
        body   = data[i+8:i+8+length]
        # skip CRC (4 bytes)
        chunks.append((ctype, body))
        i += 12 + length
    return chunks

def make_chunk(ctype: bytes, body: bytes) -> bytes:
    crc = crc32(ctype + body)
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", crc)

def build_text_chunk(keyword: str, value: str) -> bytes:
    """Standard tEXt chunk (Latin-1). Falls back gracefully for ASCII-only."""
    kw  = keyword.encode("latin-1")
    val = value.encode("latin-1", errors="replace")
    return make_chunk(b"tEXt", kw + b"\x00" + val)

def build_itxt_chunk(keyword: str, value: str) -> bytes:
    """iTXt chunk (UTF-8, uncompressed) for non-Latin-1 content."""
    kw    = keyword.encode("latin-1")
    text  = value.encode("utf-8")
    # keyword \0 compression_flag(0) compression_method(0) language_tag \0 translated_keyword \0 text
    body  = kw + b"\x00\x00\x00\x00\x00" + text
    return make_chunk(b"iTXt", body)

def build_xmp_chunk(meta: dict) -> bytes:
    """Build a minimal XMP iTXt chunk with dc: and xmpRights: namespaces."""
    title  = meta.get("title", "")
    desc   = meta.get("description", "")
    author = meta.get("author", "")
    copy_  = meta.get("copyright", "")
    url    = meta.get("url", "")
    kw     = meta.get("keywords", "")

    subject_items = "".join(f"<rdf:li>{k.strip()}</rdf:li>" for k in kw.split(","))
    xmp = f"""<?xpacket begin='﻿' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
 <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
  <rdf:Description rdf:about=''
   xmlns:dc='http://purl.org/dc/elements/1.1/'
   xmlns:xmpRights='http://ns.adobe.com/xap/1.0/rights/'
   xmlns:xmp='http://ns.adobe.com/xap/1.0/'>
   <dc:title><rdf:Alt><rdf:li xml:lang='x-default'>{title}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang='x-default'>{desc}</rdf:li></rdf:Alt></dc:description>
   <dc:creator><rdf:Seq><rdf:li>{author}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang='x-default'>{copy_}</rdf:li></rdf:Alt></dc:rights>
   <dc:subject><rdf:Bag>{subject_items}</rdf:Bag></dc:subject>
   <xmpRights:WebStatement>{url}</xmpRights:WebStatement>
   <xmpRights:Marked>True</xmpRights:Marked>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end='r'?>"""
    keyword = "XML:com.adobe.xmp"
    kw_b    = keyword.encode("latin-1")
    body    = kw_b + b"\x00\x00\x00\x00\x00" + xmp.encode("utf-8")
    return make_chunk(b"iTXt", body)

SKIP_CHUNK_TYPES = {b"tEXt", b"iTXt", b"zTXt"}

def stamp_png(path: Path, meta: dict) -> bool:
    original = path.read_bytes()
    chunks   = read_png_chunks(original)

    # Drop all existing text/metadata chunks
    kept = [(t, b) for t, b in chunks if t not in SKIP_CHUNK_TYPES]

    # Build new metadata chunks
    new_meta_chunks = []
    new_meta_chunks.append(build_text_chunk("Title",       meta["title"]))
    new_meta_chunks.append(build_text_chunk("Author",      meta["author"]))
    new_meta_chunks.append(build_itxt_chunk("Copyright",   meta["copyright"]))
    new_meta_chunks.append(build_text_chunk("Description", meta["description"]))
    new_meta_chunks.append(build_text_chunk("URL",         meta["url"]))
    new_meta_chunks.append(build_text_chunk("Keywords",    meta["keywords"]))
    new_meta_chunks.append(build_text_chunk("Software",    meta["software"]))
    new_meta_chunks.append(build_xmp_chunk(meta))

    # Insert metadata after IHDR (first chunk), before everything else
    ihdr = kept[0]
    rest = kept[1:]

    out = b'\x89PNG\r\n\x1a\n'
    out += make_chunk(ihdr[0], ihdr[1])
    for chunk_bytes in new_meta_chunks:
        out += chunk_bytes
    for (t, b) in rest:
        out += make_chunk(t, b)

    if out == original:
        print(f"  unchanged: {path.relative_to(REPO_ROOT)}")
        return False

    if not DRY_RUN:
        path.write_bytes(out)
    print(f"  {'[dry] ' if DRY_RUN else ''}stamped: {path.relative_to(REPO_ROOT)}")
    return True

# ---------------------------------------------------------------------------
# JPEG helpers (write XMP APP1 segment)
# ---------------------------------------------------------------------------

XMP_MARKER = b"http://ns.adobe.com/xap/1.0/\x00"

def stamp_jpeg(path: Path, meta: dict) -> bool:
    original = path.read_bytes()
    if original[:2] != b'\xff\xd8':
        print(f"  SKIP (not JPEG): {path.name}")
        return False

    # Strip existing XMP APP1 segments
    out = b'\xff\xd8'
    i = 2
    while i < len(original) - 1:
        if original[i] != 0xff:
            # Not a marker — append remainder and stop
            out += original[i:]
            break
        marker = original[i:i+2]
        if marker == b'\xff\xd9':  # EOI
            out += marker
            break
        if i + 4 > len(original):
            out += original[i:]
            break
        seg_len = struct.unpack(">H", original[i+2:i+4])[0]
        seg_data = original[i+2:i+2+seg_len]
        # Skip existing XMP APP1 segments
        is_xmp_app1 = (marker == b'\xff\xe1' and seg_data[2:2+len(XMP_MARKER)] == XMP_MARKER)
        if not is_xmp_app1:
            out += marker + seg_data
        i += 2 + seg_len

    # Build XMP packet
    title  = meta.get("title", "")
    desc   = meta.get("description", "")
    author = meta.get("author", "")
    copy_  = meta.get("copyright", "")
    url    = meta.get("url", "")
    kw     = meta.get("keywords", "")
    subject_items = "".join(f"<rdf:li>{k.strip()}</rdf:li>" for k in kw.split(","))

    xmp_body = f"""<?xpacket begin='﻿' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
 <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
  <rdf:Description rdf:about=''
   xmlns:dc='http://purl.org/dc/elements/1.1/'
   xmlns:xmpRights='http://ns.adobe.com/xap/1.0/rights/'
   xmlns:xmp='http://ns.adobe.com/xap/1.0/'>
   <dc:title><rdf:Alt><rdf:li xml:lang='x-default'>{title}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang='x-default'>{desc}</rdf:li></rdf:Alt></dc:description>
   <dc:creator><rdf:Seq><rdf:li>{author}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang='x-default'>{copy_}</rdf:li></rdf:Alt></dc:rights>
   <dc:subject><rdf:Bag>{subject_items}</rdf:Bag></dc:subject>
   <xmpRights:WebStatement>{url}</xmpRights:WebStatement>
   <xmpRights:Marked>True</xmpRights:Marked>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end='r'?>""".encode("utf-8")

    segment = XMP_MARKER + xmp_body
    seg_len = len(segment) + 2  # includes the 2-byte length field itself
    app1 = b'\xff\xe1' + struct.pack(">H", seg_len) + segment

    # Insert XMP APP1 right after SOI (\xff\xd8)
    result = b'\xff\xd8' + app1 + out[2:]

    if result == original:
        print(f"  unchanged: {path.relative_to(REPO_ROOT)}")
        return False

    if not DRY_RUN:
        path.write_bytes(result)
    print(f"  {'[dry] ' if DRY_RUN else ''}stamped: {path.relative_to(REPO_ROOT)}")
    return True

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Project NEXUS image metadata stamper {'(DRY RUN)' if DRY_RUN else ''}\n")
    changed = 0
    for rel_path, overrides in IMAGES.items():
        abs_path = REPO_ROOT / rel_path
        if not abs_path.exists():
            print(f"  MISSING: {rel_path}")
            continue
        meta = {**SHARED, **overrides}
        suffix = abs_path.suffix.lower()
        if suffix == ".png":
            if stamp_png(abs_path, meta):
                changed += 1
        elif suffix in (".jpg", ".jpeg"):
            if stamp_jpeg(abs_path, meta):
                changed += 1
        else:
            print(f"  SKIP (unsupported format): {rel_path}")

    print(f"\n{'Would update' if DRY_RUN else 'Updated'} {changed} image(s).")

if __name__ == "__main__":
    main()
