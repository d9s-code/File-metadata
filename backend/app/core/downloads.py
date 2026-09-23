from urllib.parse import quote


def attachment_disposition(filename: str) -> str:
    """RFC 6266 Content-Disposition: an ASCII fallback for old clients plus
    the UTF-8 name, since HTTP headers themselves must be Latin-1."""
    ascii_fallback = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in filename)
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
