"""Concatenate web/src/*.js (in order), inline data/company.json, and inject into template.html -> index.html (one self-contained page)."""
import json
from pathlib import Path
here = Path(__file__).parent
data = json.loads((here.parent / "data" / "company.json").read_text(encoding="utf-8"))
js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((here / "src").glob("*.js")))
js = js.replace("__DATA__", json.dumps(data, ensure_ascii=False))
(here / "main.js").write_text(js, encoding="utf-8")
(here / "index.html").write_text((here / "template.html").read_text(encoding="utf-8").replace("/*MAIN*/", js), encoding="utf-8")
print(f"mini4wd/web/index.html rebuilt ({len(js) // 1024} KB JS)")
