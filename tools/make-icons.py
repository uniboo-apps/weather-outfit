"""アイコン生成スクリプト（案C: 青地に白Tシャツのミニマル版）。

    python tools/make-icons.py

で favicon.ico / icons/*.png / apple-touch-icon.png を作り直す。
必要なのは Pillow のみ（pip install pillow）。

用途ごとに余白を変えている：
- favicon 系（16〜64px）: タブで潰れないよう余白を詰め、角を丸める（透過あり）。
- icon-192/512（purpose="any"）と apple-touch-icon: 全面ベタ・角丸なし。
  角丸は iOS / Android のランチャー側が付けるので、こちらでは付けない。
- icon-maskable-192/512（purpose="maskable"）: Android の円形マスクで切られないよう
  中央 80%（安全領域）に収める。
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S, SS = 64, 12                      # 設計単位 / スーパーサンプル倍率
N = S * SS

BLUE = (74, 144, 217, 255)          # theme_color と同じ #4a90d9
WHITE = (255, 255, 255, 255)


def px(v):
    return v * SS


def draw_tee(draw, scale, cy=32.0, cx=32.0):
    """Tシャツのシルエットをキャンバス中央に描く。"""
    def p(x, y):
        return (px(cx + (x - 32) * scale), px(cy + (y - 39) * scale))

    body = [
        p(23, 20), p(9, 27), p(15, 39), p(20, 36),
        p(20, 58), p(44, 58), p(44, 36), p(49, 39),
        p(55, 27), p(41, 20),
    ]
    draw.polygon(body, fill=WHITE)
    # 輪郭を太線でなぞって角を丸める
    draw.line(body + [body[0]], fill=WHITE, width=int(px(2.2 * scale)), joint='curve')
    # 襟ぐりを背景色でくり抜く
    nx, ny = p(32, 19)
    rx, ry = px(9.5 * scale), px(8.5 * scale)
    draw.ellipse([nx - rx, ny - ry, nx + rx, ny + ry], fill=BLUE)


def render(scale, corner_radius):
    im = Image.new('RGBA', (N, N), BLUE)
    d = ImageDraw.Draw(im)
    # 図形の重心は襟ぐりのぶん下寄りになるので、光学中心にわずかに上げる
    draw_tee(d, scale, cy=31.2)
    if corner_radius:
        mask = Image.new('L', (N, N), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, N - 1, N - 1], radius=px(corner_radius), fill=255)
        im.putalpha(mask)
    return im


# タブ用（余白少なめ・角丸）
small = render(scale=1.12, corner_radius=13)
# purpose="any" / iOS ホーム画面用（全面ベタ・角丸は OS 側が付ける）
full = render(scale=1.08, corner_radius=0)
# purpose="maskable" 用（Android の円形マスクで切られないよう中央 80% の安全領域に収める）
masked = render(scale=0.92, corner_radius=0)

ico_sizes = [16, 32, 48, 64]
frames = [small.resize((s, s), Image.LANCZOS) for s in ico_sizes]
frames[-1].save(ROOT / 'favicon.ico', format='ICO',
                sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])

written = ['favicon.ico']


def save(im, size, relpath, rgb=True):
    path = ROOT / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.resize((size, size), Image.LANCZOS)
    # iOS は透過部分を黒く塗り潰すので、ホーム画面用は RGB（不透明）で保存する。
    # 角丸のタブ用アイコンだけ透過を残す。
    written.append(relpath)
    (out.convert('RGB') if rgb else out).save(path)


save(small, 32, 'icons/icon-32.png', rgb=False)
save(full, 192, 'icons/icon-192.png')
save(full, 512, 'icons/icon-512.png')
save(masked, 192, 'icons/icon-maskable-192.png')
save(masked, 512, 'icons/icon-maskable-512.png')
save(full, 180, 'apple-touch-icon.png')          # iPhone / iPad ホーム画面
print('wrote ' + ', '.join(written))
