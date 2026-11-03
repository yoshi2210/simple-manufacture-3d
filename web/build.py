"""Inline main.js into template.html -> index.html (single self-contained page)."""
from pathlib import Path
here = Path(__file__).parent
(here / "index.html").write_text((here / "template.html").read_text(encoding="utf-8").replace("/*MAIN*/", (here / "main.js").read_text(encoding="utf-8")), encoding="utf-8")
print("web/index.html rebuilt")
