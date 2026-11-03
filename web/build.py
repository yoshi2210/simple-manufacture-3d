"""Inline data/plant.json and main.js into template.html -> index.html (single self-contained page)."""
import json
from pathlib import Path
here = Path(__file__).parent
plant = json.loads((here.parent / "data" / "plant.json").read_text(encoding="utf-8"))
js = (here / "main.js").read_text(encoding="utf-8").replace("__PLANT__", json.dumps(plant, ensure_ascii=False))
(here / "index.html").write_text((here / "template.html").read_text(encoding="utf-8").replace("/*MAIN*/", js), encoding="utf-8")
print("web/index.html rebuilt")
