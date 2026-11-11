"""
Draws the LINE rich menu (the button panel under the chat): assets/richmenu.png

    python scripts/make-richmenu-image.py

LINE's large rich menu is 2500 x 1686 px. We draw a 3 x 2 grid; the tap areas
in scripts/richmenu.mjs use exactly the same grid.
Fonts: Leelawadee UI (Thai, ships with Windows) and Segoe UI Emoji.
"""
import os

from PIL import Image, ImageDraw, ImageFont

W, H, COLS, ROWS = 2500, 1686, 3, 2
FONTS = r"C:\Windows\Fonts"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "richmenu.png")

BUTTONS = [  # (emoji, Thai, English, tile colour)
    ("💸", "หารบิล", "Split bill", "#0F766E"),
    ("👀", "ใครยังไม่จ่าย", "Who hasn't paid", "#115E59"),
    ("💰", "QR รับเงิน", "Get paid", "#134E4A"),
    ("😷", "ค่าฝุ่น PM2.5", "Air quality", "#1E3A8A"),
    ("☔", "ฝน & อากาศ", "Rain & weather", "#1E40AF"),
    ("⚙", "ตั้งค่า", "Settings", "#374151"),
]

thai = ImageFont.truetype(os.path.join(FONTS, "LeelaUIb.ttf"), 112)
eng = ImageFont.truetype(os.path.join(FONTS, "LeelawUI.ttf"), 64)
emoji = ImageFont.truetype(os.path.join(FONTS, "seguiemj.ttf"), 109)  # Segoe emoji renders crisply at 109

img = Image.new("RGB", (W, H), "#0b1f1e")
d = ImageDraw.Draw(img)
cw, ch = W // COLS, H // ROWS
gap = 10

for i, (icon, th, en, colour) in enumerate(BUTTONS):
    x0, y0 = (i % COLS) * cw, (i // COLS) * ch
    d.rounded_rectangle([x0 + gap, y0 + gap, x0 + cw - gap, y0 + ch - gap], radius=48, fill=colour)
    cx = x0 + cw // 2

    # Emoji, scaled up from its native size for a big icon
    e = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
    ImageDraw.Draw(e).text((120, 120), icon, font=emoji, embedded_color=True, anchor="mm")
    e = e.crop(e.getbbox())  # trim, then scale the icon itself to a fixed height
    e = e.resize((round(e.width * 280 / e.height), 280), Image.LANCZOS)
    img.paste(e, (cx - e.width // 2, y0 + 130), e)

    d.text((cx, y0 + 545), th, font=thai, fill="white", anchor="mm")
    d.text((cx, y0 + 680), en, font=eng, fill="#cbd5e1", anchor="mm")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT, optimize=True)
print("saved", os.path.normpath(OUT), f"{os.path.getsize(OUT) // 1024} KB")
