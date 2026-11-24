"""Download Open Food Facts products sold in Russia into offru.json, the app's offline search base.

The live OFF search often answers 503 without CORS headers, so the phone sees an instant error.
The newer search.openfoodfacts.org works from a computer but not from a browser page,
so the computer fetches the Russian part once and the app searches it locally.

Run from the app folder: python tools/make_offru.py
Data: Open Food Facts, ODbL licence, https://world.openfoodfacts.org
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

sys.stdout.reconfigure(encoding='utf-8')
URL = 'https://search.openfoodfacts.org/search'
FIELDS = 'code,product_name,product_name_ru,brands,nutriments,quantity'
PAGE = 25  # answers over about 20 KB stall on the server side, 25 products stay well under that
FAILED = []
WINDOW = 10000  # the search engine pages through at most this many hits per query


def ask(q, page, size=PAGE, fields=FIELDS):
    url = URL + '?' + urllib.parse.urlencode({'q': q, 'page': page, 'page_size': size, 'fields': fields})
    for attempt in range(12):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'pitanie-app/1.0'}), timeout=8) as r:
                return json.load(r)
        except Exception as e:  # network hiccup or overload: wait and try again
            print('  retry', page, e)
            time.sleep(1 + attempt)
    raise RuntimeError('no answer for ' + q)


def page_hits(job):
    q, page = job
    try:
        return ask(q, page).get('hits', [])
    except RuntimeError:  # one stuck page is set aside and asked again at the end
        print('  skipped', q, page)
        FAILED.append(job)
        return []


def count(q):
    return ask(q, 1).get('count', 0)


def prefixes(p=''):
    """Barcode prefixes whose hit count fits the paging window."""
    q = f'countries_tags:"en:russia" AND code:{p}*' if p else 'countries_tags:"en:russia"'
    j = ask(q, 1, 1, 'code')  # only the count: a full page of the whole base hangs on the server
    if j.get('is_count_exact') and j['count'] <= WINDOW:
        return [(q, j['count'])]
    return [x for d in '0123456789' for x in prefixes(p + d)]


def text(v):
    if isinstance(v, dict):
        v = v.get('ru') or v.get('main') or next(iter(v.values()), '')
    if isinstance(v, list):
        v = v[0] if v else ''
    return ' '.join(str(v or '').replace('&quot;', '"').split())


def row(x):
    t = x.get('nutriments') or {}
    num = lambda k: float(t.get(k) or 0)
    p, f, c = num('proteins_100g'), num('fat_100g'), num('carbohydrates_100g')
    k = t.get('energy-kcal_100g')
    if k in (None, ''):
        k = num('energy_100g') / 4.184 if t.get('energy_100g') else p * 4 + f * 9 + c * 4
    k = float(k)
    name = text(x.get('product_name_ru')) or text(x.get('product_name'))
    brands = x.get('brands') or ''
    brand = text(brands if isinstance(brands, list) else brands.split(','))
    if not name or k <= 0 or k > 950 or p + f + c > 102 or min(p, f, c) < 0:
        return None
    return [name, brand, round(p, 1), round(f, 1), round(c, 1), round(k), text(x.get('quantity'))[:20]]


def main():
    queries = prefixes()
    print(len(queries), 'queries,', sum(n for _, n in queries), 'products')
    out, seen = [], set()
    jobs = [(q, page) for q, n in queries for page in range(1, (n + PAGE - 1) // PAGE + 1)]
    # Pages are asked four at a time: single pages sometimes hang for half a minute on the server.
    with ThreadPoolExecutor(4) as pool:
        for i, hits in enumerate(pool.map(page_hits, jobs), 1):
            for x in hits:
                r = row(x)
                key = (r[0].lower(), r[1].lower(), r[5]) if r else None
                if r and key not in seen:
                    seen.add(key)
                    out.append(r)
            if i % 20 == 0 or i == len(jobs):
                print(f'{i}/{len(jobs)} pages -> {len(out)} products')
    # Second chance for the pages the server did not give, one at a time.
    for job in list(FAILED):
        FAILED.remove(job)
        for x in page_hits(job):
            r = row(x)
            key = (r[0].lower(), r[1].lower(), r[5]) if r else None
            if r and key not in seen:
                seen.add(key)
                out.append(r)
    print('second pass done,', len(FAILED), 'pages still missing ->', len(out))
    out.sort(key=lambda r: (r[0].lower(), r[1].lower()))
    with open('offru.json', 'w', encoding='utf-8') as fh:
        json.dump({'date': date.today().isoformat(), 'source': 'Open Food Facts, ODbL', 'cols': ['n', 'brand', 'p', 'f', 'c', 'k', 'qty'], 'items': out},
                  fh, ensure_ascii=False, separators=(',', ':'))
    print('saved', len(out), 'products')


if __name__ == '__main__':
    main()
