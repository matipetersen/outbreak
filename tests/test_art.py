import json
import os
import unittest

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "art")


def names(era):
    with open(os.path.join(ART, f"atlas_{era}.json")) as fh:
        return set(json.load(fh)["sprites"])


class Atlases(unittest.TestCase):
    def test_every_set_has_the_same_sprite_names(self):
        base = names("modern")
        for era in ("medieval", "scifi"):
            self.assertEqual(names(era), base, era)

    def test_the_scifi_set_is_its_own_art(self):
        from PIL import Image
        a, b = Image.open(os.path.join(ART, "atlas_scifi.png")), Image.open(os.path.join(ART, "atlas_modern.png"))
        self.assertNotEqual(a.tobytes(), b.tobytes())


class AppIcon(unittest.TestCase):
    def test_the_home_screen_icons_exist_and_are_opaque_squares(self):
        from PIL import Image
        for size in (512, 192, 180, 32):
            im = Image.open(os.path.join(ART, "icons", f"icon-{size}.png"))
            self.assertEqual(im.size, (size, size))
            self.assertEqual(im.mode, "RGB", "no transparency: iOS fills it with black")
