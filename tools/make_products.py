"""Builds products.js for the app from the master table БЖУ продуктов.xlsx.

Run after the table changes: python tools/make_products.py
"""
import json
import pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = ROOT.parent / 'БЖУ продуктов.xlsx'

ws = openpyxl.load_workbook(TABLE, data_only=True)['БЖУ продуктов']
products = []
for r in ws.iter_rows(min_row=5, values_only=True):
    if not r[1]:
        continue
    products.append({
        'cat': r[0], 'n': r[1], 'brand': r[2] or '', 'freq': r[3] or '',
        'base': r[4], 'u': r[5], 'p': r[6], 'f': r[7], 'c': r[8], 'k': r[9],
    })
text = 'window.PRODUCTS = ' + json.dumps(products, ensure_ascii=False, indent=0) + ';\n'
(ROOT / 'products.js').write_text(text, encoding='utf-8')
print(len(products), 'products')
