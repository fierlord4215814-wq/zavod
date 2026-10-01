import sys
import qrcode

if len(sys.argv) != 3:
    raise SystemExit('usage: create-qr.py <https-url> <output.png>')

url, output = sys.argv[1], sys.argv[2]
if not url.startswith('https://') or '?' in url or '#' in url:
    raise SystemExit('QR accepts only a clean HTTPS URL')

image = qrcode.make(url)
image.save(output)
