# Leitor de Fichas (OCR local) — módulo Ferida

Serviço Python que lê as fotos da ficha de papel (frente/verso) do módulo
Gestão Saúde → Ferida. Roda **localmente** — as imagens do paciente não saem
da máquina (LGPD).

## Instalação (uma vez)

```bash
cd leitor-ficha
py -3.13 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

> A instalação baixa o PyTorch (~200 MB) e, no primeiro uso, os modelos de
> OCR do EasyOCR (~80 MB).

## Rodar

Basta dar dois cliques em **`iniciar.bat`** (ou rodar `.venv\Scripts\python app.py`).

> ⚠️ Se o VLibras estiver instalado na máquina, ele define um `PYTHONPATH`
> global que quebra o venv — o `iniciar.bat` já limpa essa variável.

O serviço sobe em `http://127.0.0.1:5001`. A API do Órbita (Node) faz proxy
de `/api/ferida/ler-ficha` para cá — configure `LEITOR_FICHA_URL` no `.env`
se usar outra porta/host.

## O que ele extrai

- Campos manuscritos: nome, data de nascimento, município, data do
  atendimento, localização da ferida, dimensões (cm) e conduta.
- **Não detecta** quais opções impressas foram assinaladas (X/círculo) —
  tecido, bordas, exsudato, infecção e biofilme voltam vazios e o texto
  completo lido vai em "observações" para conferência. A enfermeira marca
  os chips na revisão.
