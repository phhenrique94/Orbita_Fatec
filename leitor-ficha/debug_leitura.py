# Depuração: mostra os itens OCR em ordem e a taxa de tinta de cada opção
import sys
import base64

from app import (get_reader, decodificar_imagem, itens_ocr, taxa_tinta,
                 opcoes_na_faixa, achar, MAPA_TECIDO, MAPA_BORDAS, MAPA_PELE,
                 MAPA_EXSUDATO_TIPO, MAPA_QUANTIDADE, MAPA_INF_SUP, MAPA_INF_PROF)

caminho = sys.argv[1]
with open(caminho, "rb") as f:
    data_url = "data:image/png;base64," + base64.b64encode(f.read()).decode()

arr, cinza = decodificar_imagem(data_url)
itens = itens_ocr(get_reader(), arr)

print("=== ITENS OCR (ordem cy,cx) ===")
for it in itens:
    print(f"  y={it['cy']:6.0f} x={it['x0']:5.0f}..{it['x1']:5.0f} h={it['h']:3.0f} | {it['texto']!r}")

print("\n=== TAXAS DE TINTA POR OPÇÃO ===")
y_fim = max(i["y1"] for i in itens) + 10
grupos = [
    ("tecido", MAPA_TECIDO, achar(itens, "tipo de tecido")),
    ("bordas", MAPA_BORDAS, achar(itens, "bordas da ferida")),
    ("pele", MAPA_PELE, achar(itens, "pele adjacente")),
    ("exsudato-tipo", MAPA_EXSUDATO_TIPO, achar(itens, "exsudato")),
    ("quantidade", MAPA_QUANTIDADE, achar(itens, "exsudato")),
    ("inf-sup", MAPA_INF_SUP, achar(itens, "superficial")),
    ("inf-prof", MAPA_INF_PROF, achar(itens, "profunda")),
]
for nome, mapa, hdr in grupos:
    if not hdr:
        continue
    cand = opcoes_na_faixa(itens, mapa, hdr["cy"] + 1, y_fim)
    print(f"--- {nome} (header y={hdr['cy']:.0f}) ---")
    for canonico, it in cand:
        print(f"  tinta={taxa_tinta(cinza, it):.3f} x0={it['x0']:5.0f} | {canonico} | texto={it['texto']!r}")
