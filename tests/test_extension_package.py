"""Check that the folder users select in Chrome is a clean extension package."""

import json
from pathlib import Path
import unittest


PACKAGE = Path(__file__).resolve().parents[1] / "extension"


class ExtensionPackageTests(unittest.TestCase):
    def test_loadable_folder_has_no_reserved_or_python_files(self):
        self.assertTrue((PACKAGE / "manifest.json").is_file())
        for path in PACKAGE.rglob("*"):
            self.assertFalse(path.name.startswith(("_", ".")), path)
            self.assertNotIn(path.suffix, {".py", ".pyc"}, path)

    def test_manifest_resources_are_inside_package(self):
        manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest_version"], 3)
        self.assertTrue((PACKAGE / manifest["background"]["service_worker"]).is_file())
        self.assertTrue((PACKAGE / "content.js").is_file())
        for group in manifest.get("web_accessible_resources", []):
            for resource in group["resources"]:
                self.assertTrue((PACKAGE / resource).is_file(), resource)


if __name__ == "__main__":
    unittest.main()
