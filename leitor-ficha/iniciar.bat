@echo off
rem Inicia o Leitor de Fichas (OCR local) — módulo Ferida
rem Limpa o PYTHONPATH (o VLibras define um global que quebra o venv)
cd /d "%~dp0"
set PYTHONPATH=
set PYTHONHOME=
if not exist .venv\Scripts\python.exe (
    echo Ambiente nao instalado. Rode antes:
    echo   py -3.13 -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)
echo Leitor de Fichas rodando em http://127.0.0.1:5001 (Ctrl+C para parar)
.venv\Scripts\python.exe app.py
