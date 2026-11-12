from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs('build/windows/nsis/resources', exist_ok=True)
appicon = Image.open('build/appicon.png').convert('RGBA')

# 1. Welcome / Finish Page Left Banner (164x314 px)
w, h = 164, 314
banner = Image.new('RGB', (w, h), (18, 22, 34))
draw = ImageDraw.Draw(banner)

# Vertical dark gradient from (16, 20, 32) to (26, 34, 52)
for y in range(h):
    ratio = y / h
    r = int(16 + (30 - 16) * ratio)
    g = int(20 + (42 - 20) * ratio)
    b = int(34 + (66 - 34) * ratio)
    draw.line([(0, y), (w, y)], fill=(r, g, b))

# Subtle decorative accent lines at bottom
draw.line([(16, h - 35), (w - 16, h - 35)], fill=(45, 60, 95), width=1)
draw.line([(16, h - 33), (80, h - 33)], fill=(59, 130, 246), width=2)

# Place resized icon centered at top
icon_size = 80
icon_resized = appicon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
icon_x = (w - icon_size) // 2
icon_y = 48
banner.paste(icon_resized.convert('RGB'), (icon_x, icon_y), icon_resized)

# Save as standard 24-bit BMP
banner.save('build/windows/nsis/resources/welcome.bmp', 'BMP')
print("Generated welcome.bmp (164x314)")

# 2. Header Bitmap (150x57 px)
hw, hh = 150, 57
header = Image.new('RGB', (hw, hh), (255, 255, 255))
hdraw = ImageDraw.Draw(header)

# Gradient from white to subtle light blue/gray on right
for x in range(hw):
    ratio = x / hw
    r = int(255 - 12 * ratio)
    g = int(255 - 8 * ratio)
    b = int(255 - 2 * ratio)
    hdraw.line([(x, 0), (x, hh)], fill=(r, g, b))

h_icon_size = 44
h_icon_resized = appicon.resize((h_icon_size, h_icon_size), Image.Resampling.LANCZOS)
h_icon_x = hw - h_icon_size - 8
h_icon_y = (hh - h_icon_size) // 2
header.paste(h_icon_resized.convert('RGB'), (h_icon_x, h_icon_y), h_icon_resized)

header.save('build/windows/nsis/resources/header.bmp', 'BMP')
print("Generated header.bmp (150x57)")

