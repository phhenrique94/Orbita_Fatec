# Leitor de Fichas — módulo Ferida (Gestão Saúde)
# Serviço local de OCR calibrado para a "FICHA DE AVALIAÇÃO DA FERIDA"
# do ambulatório (frente: cabeçalho/dimensões/tecido/bordas/pele adjacente/
# exsudato; verso: sinais de infecção/biofilme/Enfermeira + conduta).
# Os dados NÃO saem desta máquina.
#
# Detecção de opções assinaladas, dois sinais combinados por LINHA:
#  1. Marca no texto lido: "(X) ...", "X Granulação" (padrão ( ) do verso).
#  2. Tinta na região do checkbox à esquerda do primeiro item da linha,
#     comparada com as demais linhas do MESMO grupo (baseline = menor taxa
#     do grupo — autocalibra por digitalização).

import base64
import io
import re
import unicodedata

from flask import Flask, jsonify, request
from PIL import Image
import numpy as np

app = Flask(__name__)

_reader = None  # carregado sob demanda (o primeiro uso baixa os modelos)


def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["pt"], gpu=False, verbose=False)
    return _reader


def sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()


def decodificar_imagem(data_url: str):
    if not data_url.startswith("data:image/"):
        raise ValueError("imagem inválida")
    b64 = data_url.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    maior = max(img.size)
    if maior > 2200:
        fator = 2200 / maior
        img = img.resize((int(img.width * fator), int(img.height * fator)))
    arr = np.array(img)
    cinza = arr.mean(axis=2)
    return arr, cinza


# ==========================================
# OCR → itens e linhas com posição
# ==========================================

def itens_ocr(reader, arr):
    itens = []
    for pts, txt, conf in reader.readtext(arr):
        txt = (txt or "").strip()
        if not txt:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        itens.append({
            "texto": txt,
            "norm": sem_acento(txt),
            "x0": x0, "x1": x1, "y0": y0, "y1": y1,
            "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
            "h": max(y1 - y0, 8),
        })
    itens.sort(key=lambda i: (i["cy"], i["cx"]))
    return itens


def agrupar_linhas(itens):
    """Agrupa itens na mesma linha visual (tolerância pela altura) e
    ordena cada linha da esquerda para a direita."""
    linhas = []
    for it in sorted(itens, key=lambda i: i["cy"]):
        destino = None
        for ln in linhas:
            if abs(it["cy"] - ln["cy"]) < max(10.0, (it["h"] + ln["h"]) / 2 * 0.6):
                destino = ln
                break
        if destino:
            destino["itens"].append(it)
            n = len(destino["itens"])
            destino["cy"] = (destino["cy"] * (n - 1) + it["cy"]) / n
            destino["h"] = max(destino["h"], it["h"])
        else:
            linhas.append({"cy": it["cy"], "h": it["h"], "itens": [it]})
    for ln in linhas:
        ln["itens"].sort(key=lambda i: i["x0"])
        ln["texto"] = " ".join(i["texto"] for i in ln["itens"])
        ln["norm"] = sem_acento(ln["texto"])
        ln["item0"] = ln["itens"][0]
    return sorted(linhas, key=lambda l: l["cy"])


def achar(itens, *fragmentos):
    for frag in fragmentos:
        for it in itens:
            if frag in it["norm"]:
                return it
    return None


def linha_completa(itens, ancora):
    mesmos = [i for i in itens if abs(i["cy"] - ancora["cy"]) < ancora["h"] * 0.9]
    mesmos.sort(key=lambda i: i["x0"])
    return " ".join(i["texto"] for i in mesmos)


def limpar_valor(v):
    if not v:
        return None
    v = re.sub(r"[_]{2,}", " ", v)
    v = v.strip(" :_.-\t")
    return v if len(v) >= 2 else None


def data_iso(txt):
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})", txt or "")
    if not m:
        return None
    d, mes, a = int(m.group(1)), int(m.group(2)), m.group(3)
    ano = int(a) if len(a) == 4 else (2000 + int(a) if int(a) < 50 else 1900 + int(a))
    if not (1 <= d <= 31 and 1 <= mes <= 12 and 1900 <= ano <= 2100):
        return None
    return f"{ano:04d}-{mes:02d}-{d:02d}"


# ==========================================
# Detecção de opções assinaladas
# ==========================================

RE_MARCA_PARENTESES = re.compile(r"^[\(\[]\s*[xX✗✘×vV✓+]{1,2}\s*[\)\]]")
RE_PARENTESES_VAZIO = re.compile(r"^[\(\[]\s*[\)\]]")
RE_MARCA_PREFIXO = re.compile(r"^[xX✗✘×☒⊠]{1,2}\s*[\)\]]?\s+\S")


def taxa_tinta(cinza, item, h_ref=None):
    """Fração de pixels escuros na região do checkbox, à esquerda do item.
    h_ref: altura de referência do GRUPO — o checkbox impresso tem tamanho
    fixo; usar a altura própria de cada rótulo distorce a comparação."""
    h = h_ref or item["h"]
    x1 = int(item["x0"] - 1.7 * h)
    x2 = int(item["x0"] + 0.25 * h)
    y1 = int(item["cy"] - 0.65 * h)
    y2 = int(item["cy"] + 0.65 * h)
    alt, larg = cinza.shape
    x1, x2 = max(0, x1), min(larg, x2)
    y1, y2 = max(0, y1), min(alt, y2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    regiao = cinza[y1:y2, x1:x2]
    return float((regiao < 140).mean())


def opcoes_por_linha(itens, mapa, y_min, y_max, x_min=None, x_max=None):
    """Localiza as opções impressas (por LINHA visual) dentro de uma faixa
    vertical e coluna opcional. mapa: [(fragmento, canonico)] — 1º que casar vence."""
    filtrados = [i for i in itens
                 if y_min <= i["cy"] < y_max
                 and (x_min is None or i["cx"] >= x_min)
                 and (x_max is None or i["cx"] < x_max)]
    achados = []
    usados = set()
    for ln in agrupar_linhas(filtrados):
        norm = re.sub(r"^[\(\[\)\]xX✗✘×☒⊠oO0□·\s\-–]+", "", ln["norm"])
        for frag, canonico in mapa:
            if frag in norm and canonico not in usados:
                achados.append((canonico, ln))
                usados.add(canonico)
                break
    return achados


def detectar_marcados(cinza, candidatos):
    """candidatos: [(canonico, linha)] do MESMO grupo.
    Sinal 1: marca no texto da linha. Sinal 2: tinta relativa (baseline = menor)."""
    marcados = set()
    pendentes = []
    for canonico, ln in candidatos:
        t = ln["texto"].strip()
        if RE_MARCA_PARENTESES.match(t) or RE_MARCA_PREFIXO.match(t):
            marcados.add(canonico)
            continue
        if RE_PARENTESES_VAZIO.match(t):
            continue  # "( )" lido explicitamente vazio
        pendentes.append((canonico, ln["item0"]))
    if pendentes:
        alturas = sorted(it["h"] for _, it in pendentes)
        h_ref = alturas[len(alturas) // 2]  # mediana do grupo
        taxas = [(canonico, taxa_tinta(cinza, it, h_ref)) for canonico, it in pendentes]
        menor = min(t for _, t in taxas)
        limite = max(0.055, menor * 1.5 + 0.015)
        for canonico, t in taxas:
            if t > limite:
                marcados.add(canonico)
    return marcados


# ==========================================
# Extração — FRENTE
# ==========================================

MAPA_TECIDO = [
    ("granulacao nao saudavel", "Granulação não saudável"),
    ("hipergranulacao", "Hipergranulação"),
    ("necrose", "Necrose de coagulação"),
    ("esfacelo", "Esfacelo"),
    ("granulacao", "Granulação"),
]

MAPA_BORDAS = [
    ("maceracao", "Maceração"),
    ("hiperqueratose", "Hiperqueratose"),
    ("descolamento", "Descolamento"),
    ("epibole", "Epíbole"),
    ("integra", "Íntegra"),
]

MAPA_PELE = [
    ("eczema", "Eczema/descamação"),
    ("hiperpigmentacao", "Hiperpigmentação"),
    ("hiperemiada", "Hiperemiada"),
    ("ressecada", "Ressecada"),
    ("integra", "Íntegra"),
]

# Todos os 6 tipos do papel existem no sistema
MAPA_EXSUDATO_TIPO = [
    ("serosanguinolento", "Serosanguinolento"),
    ("seropurulento", "Seropurulento"),
    ("hemopurulento", "Hemopurulento"),
    ("sanguinolento", "Sanguinolento"),
    ("purulento", "Purulento"),
    ("seroso", "Seroso"),
]

# Cor/consistência derivadas da tabela "Características" impressa na ficha
DERIVA_EXSUDATO = {
    "Seroso": ("Claro", "Aquosa"),
    "Serosanguinolento": ("Rosado", "Aquosa"),
    "Sanguinolento": ("Avermelhado", "Espessa"),
    "Purulento": ("Amarelado", "Espessa"),
    "Seropurulento": ("Amarelado", "Leitosa"),
    "Hemopurulento": ("Avermelhado", "Espessa"),
}

MAPA_QUANTIDADE = [
    ("ausente", "Ausente"),
    ("pequena", "Pequena"),
    ("moderada", "Moderada"),
    ("grande", "Grande"),
]


def dim_valor(itens, *frags):
    """Valor numérico da célula da tabela de dimensões: número dentro do
    próprio item do rótulo ou o item numérico mais próximo à direita, na
    mesma linha. Usa a ocorrência mais ALTA do rótulo (a tabela fica no topo)."""
    lab = None
    for frag in frags:
        cands = [i for i in itens if frag in i["norm"]]
        if cands:
            lab = min(cands, key=lambda i: i["cy"])
            break
    if not lab:
        return None
    m = re.search(r"[^0-9]{0,4}(\d+[.,]?\d*)", lab["norm"].split(frags[0])[-1])
    if m:
        try:
            v = float(m.group(1).replace(",", "."))
            if 0 <= v < 1000:
                return v
        except ValueError:
            pass
    mesma_linha = [i for i in itens if i is not lab
                   and abs(i["cy"] - lab["cy"]) < max(lab["h"], i["h"]) * 0.9
                   and i["x0"] >= lab["x1"] - 6
                   and i["x0"] - lab["x1"] < 200]
    for i in sorted(mesma_linha, key=lambda i: i["x0"]):
        m = re.match(r"^[\s:]*(\d+[.,]?\d*)\s*(cm)?$", i["texto"].strip(), re.I)
        if m:
            try:
                v = float(m.group(1).replace(",", "."))
                if 0 <= v < 1000:
                    return v
            except ValueError:
                pass
    return None


def extrair_frente(itens, cinza, resultado, notas):
    # --- Cabeçalho: NOME ... DATA na mesma linha; MUNICÍPIO abaixo
    it_nome = achar(itens, "nome")
    if it_nome:
        linha = linha_completa(itens, it_nome)
        norm = sem_acento(linha)
        m = re.search(r"nome\s*:?\s*(.*?)(?:\bdata\b|$)", norm)
        if m:
            resultado["paciente"]["nome"] = limpar_valor(linha[m.start(1):m.end(1)])
        m = re.search(r"\bdata\b\s*:?\s*(.+)$", norm)
        if m:
            resultado["dataAtendimento"] = data_iso(linha[m.start(1):])

    it_mun = achar(itens, "municipio")
    if it_mun:
        linha = linha_completa(itens, it_mun)
        m = re.search(r"municipio\s*:?\s*(.+)$", sem_acento(linha))
        if m:
            resultado["paciente"]["municipio"] = limpar_valor(linha[m.start(1):])

    if not resultado["dataAtendimento"]:
        for it in itens[:12]:
            d = data_iso(it["texto"])
            if d:
                resultado["dataAtendimento"] = d
                break

    # --- Dimensões (tabela 2x2, busca posicional)
    resultado["dimensoes"]["comprimento"] = dim_valor(itens, "comprimento")
    resultado["dimensoes"]["largura"] = dim_valor(itens, "largura")
    resultado["dimensoes"]["profundidade"] = dim_valor(itens, "profundidade")
    resultado["dimensoes"]["descolamento"] = dim_valor(itens, "descolamento")

    # --- Localização
    it_loc = achar(itens, "localizacao")
    if it_loc:
        linha = linha_completa(itens, it_loc)
        m = re.search(r"localizacao\s*:?\s*(.+)$", sem_acento(linha))
        if m:
            resultado["localizacao"] = limpar_valor(linha[m.start(1):])

    # --- Seções de opções
    it_tecido = achar(itens, "tipo de tecido")
    it_bordas = achar(itens, "bordas da ferida")
    it_pele = achar(itens, "pele adjacente")
    it_exsud = achar(itens, "exsudato")
    y_fim = max(i["y1"] for i in itens) + 10

    if it_tecido:
        y2 = it_bordas["cy"] if it_bordas else (it_exsud["cy"] if it_exsud else y_fim)
        cand = opcoes_por_linha(itens, MAPA_TECIDO, it_tecido["cy"] + 1, y2)
        resultado["tecido"] = sorted(detectar_marcados(cinza, cand))

    if it_bordas:
        y2 = it_exsud["cy"] if it_exsud else y_fim
        meio = it_pele["x0"] - 10 if it_pele else None
        cand = opcoes_por_linha(itens, MAPA_BORDAS, it_bordas["cy"] + 1, y2, x_max=meio)
        resultado["bordas"] = sorted(detectar_marcados(cinza, cand))

        if it_pele:
            cand_pele = opcoes_por_linha(itens, MAPA_PELE, it_pele["cy"] + 1, y2, x_min=it_pele["x0"] - 10)
            resultado["peleAdjacente"] = sorted(detectar_marcados(cinza, cand_pele))

    if it_exsud:
        # Âncora da coluna "Quantidade:" (com dois-pontos = a coluna de checkbox;
        # a tabela de indicadores repete a palavra sem os dois-pontos, à esquerda)
        qtd_items = [i for i in itens if "quantidade" in i["norm"] and i["cy"] > it_exsud["cy"] - 5]
        com_dp = [i for i in qtd_items if ":" in i["texto"]]
        it_qtd = (com_dp or qtd_items or [None])[0]

        # Tipo (coluna esquerda da tabela de exsudato)
        x_max_tipo = it_qtd["x0"] - 15 if it_qtd else None
        cand_tipo = opcoes_por_linha(itens, MAPA_EXSUDATO_TIPO, it_exsud["cy"] + 1, y_fim, x_max=x_max_tipo)
        marcados = sorted(detectar_marcados(cinza, cand_tipo))
        if marcados:
            tipo = marcados[0]
            resultado["exsudato"]["tipo"] = tipo
            if tipo in DERIVA_EXSUDATO:
                cor, consistencia = DERIVA_EXSUDATO[tipo]
                resultado["exsudato"]["cor"] = cor
                resultado["exsudato"]["consistencia"] = consistencia
            if len(marcados) > 1:
                notas.append("Mais de um tipo de exsudato parece assinalado: "
                             + ", ".join(marcados) + " — confirme.")

        # Quantidade: só a coluna da âncora "Quantidade:" (filtra por x ANTES
        # de agrupar linhas, senão a opção herda a tinta da coluna vizinha)
        cand_q = []
        if it_qtd:
            y2_q = it_qtd["cy"] + it_qtd["h"] * 10
            cand_q = opcoes_por_linha(itens, MAPA_QUANTIDADE, it_qtd["cy"] + 1, y2_q,
                                      x_min=it_qtd["x0"] - 15)
        marc_q = detectar_marcados(cinza, cand_q)
        if len(marc_q) == 1:
            resultado["exsudato"]["quantidade"] = next(iter(marc_q))
        elif len(marc_q) > 1:
            notas.append("Mais de uma quantidade de exsudato parece assinalada: "
                         + ", ".join(sorted(marc_q)) + " — confirme.")


# ==========================================
# Extração — VERSO
# ==========================================

MAPA_INF_SUP = [
    ("tecido inviavel", "Tecido inviável > 50%"),
    ("dor nova", "Dor nova ou crescente"),
    ("atraso da cicatrizacao", "Atraso na cicatrização"),
    ("atraso na cicatrizacao", "Atraso na cicatrização"),
    ("exsudato", "Exsudato aumentado"),
    ("odor", "Odor"),
]

MAPA_INF_PROF = [
    ("aumento no tamanho", "Aumento no tamanho / lesões satélites"),
    ("lesoes satelites", "Aumento no tamanho / lesões satélites"),
    ("exposicao ossea", "Exposição óssea"),
    ("temperatura", "Aumento da temperatura"),
    ("edema", "Edema"),
    ("eritema", "Eritema > 2 cm"),
]


def extrair_verso(itens, cinza, resultado, notas):
    it_sup = achar(itens, "infeccao superficial", "superficial")
    it_prof = achar(itens, "infeccao profunda", "profunda")
    it_bio = achar(itens, "biofilme no leito", "identificacao do biofilme", "biofilme")
    it_enf = achar(itens, "enfermeira")
    y_fim = max(i["y1"] for i in itens) + 10

    if it_sup:
        y1 = it_sup["cy"] + 1
        y2 = it_bio["cy"] if it_bio else y_fim
        meio = it_prof["x0"] - 10 if it_prof else None
        cand_sup = opcoes_por_linha(itens, MAPA_INF_SUP, y1, y2, x_max=meio)
        resultado["infeccaoSuperficial"] = sorted(detectar_marcados(cinza, cand_sup))
        if it_prof:
            cand_prof = opcoes_por_linha(itens, MAPA_INF_PROF, y1, y2, x_min=it_prof["x0"] - 10)
            resultado["infeccaoProfunda"] = sorted(detectar_marcados(cinza, cand_prof))

    # --- Biofilme: □ Sim □ Não na linha do título (par avaliado por item)
    if it_bio:
        cand_bio = []
        for it in itens:
            if abs(it["cy"] - it_bio["cy"]) < it_bio["h"] * 1.6:
                norm = re.sub(r"^[^a-z]+", "", it["norm"])
                if norm.startswith("sim"):
                    cand_bio.append(("Sim", {"texto": it["texto"], "item0": it}))
                elif norm.startswith("nao"):
                    cand_bio.append(("Não", {"texto": it["texto"], "item0": it}))
        marc = detectar_marcados(cinza, cand_bio)
        if "Sim" in marc and "Não" not in marc:
            resultado["biofilme"] = True
        elif "Não" in marc and "Sim" not in marc:
            resultado["biofilme"] = False

    # --- Conduta: linhas manuscritas após "Enfermeira (o):"
    if it_enf:
        linha = linha_completa(itens, it_enf)
        m = re.search(r"enfermeira\s*[\(\)o0]*\s*:?\s*(.+)$", sem_acento(linha))
        if m:
            nome_enf = limpar_valor(linha[m.start(1):])
            if nome_enf:
                notas.append(f"Enfermeira(o) na ficha: {nome_enf}")

        abaixo = [i for i in itens if i["cy"] > it_enf["cy"] + it_enf["h"]]
        if abaixo:
            partes = [ln["texto"] for ln in agrupar_linhas(abaixo)]
            txt = re.sub(r"[_]{2,}", " ", " ".join(partes)).strip()
            if len(txt) >= 4:
                resultado["conduta"] = txt


# ==========================================
# Rotas
# ==========================================

@app.get("/saude")
def saude():
    return jsonify({"status": "ok", "servico": "leitor-ficha"})


@app.post("/ler-ficha")
def ler_ficha():
    body = request.get_json(silent=True) or {}
    imagens = body.get("imagens")
    if not isinstance(imagens, list) or not (1 <= len(imagens) <= 2):
        return jsonify({"error": "Envie 1 ou 2 imagens (frente e verso da ficha)."}), 400

    resultado = {
        "paciente": {"nome": None, "dataNascimento": None, "municipio": None},
        "dataAtendimento": None,
        "localizacao": None,
        "dimensoes": {"comprimento": None, "largura": None, "profundidade": None, "descolamento": None},
        "tecido": [],
        "bordas": [],
        "peleAdjacente": [],
        "exsudato": {"tipo": None, "cor": None, "consistencia": None, "quantidade": None},
        "infeccaoSuperficial": [],
        "infeccaoProfunda": [],
        "biofilme": None,
        "dor": {"presente": None, "escala": None},  # não existe na ficha de papel — preenchimento manual
        "conduta": None,
        "observacoes": None,
    }
    notas = []
    texto_completo = []

    try:
        reader = get_reader()
        for data_url in imagens:
            arr, cinza = decodificar_imagem(data_url)
            itens = itens_ocr(reader, arr)
            if not itens:
                continue
            texto_pagina = "\n".join(ln["texto"] for ln in agrupar_linhas(itens))
            norm_pagina = sem_acento(texto_pagina)

            if "infeccao" in norm_pagina or "biofilme" in norm_pagina:
                extrair_verso(itens, cinza, resultado, notas)
                texto_completo.append("--- VERSO ---\n" + texto_pagina)
            else:
                extrair_frente(itens, cinza, resultado, notas)
                texto_completo.append("--- FRENTE ---\n" + texto_pagina)

        if not texto_completo:
            return jsonify({"error": "Não foi possível ler texto nas imagens."}), 422

        obs = []
        if notas:
            obs.append("⚠ " + "\n⚠ ".join(notas))
        obs.append("Texto lido da ficha (OCR) — use para conferir:\n" + "\n\n".join(texto_completo))
        resultado["observacoes"] = "\n\n".join(obs)

        return jsonify({"dados": resultado})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Falha no OCR: {e}"}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001)
