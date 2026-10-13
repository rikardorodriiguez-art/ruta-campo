#!/usr/bin/env python3
"""
gemini_extractor.py - Extractor Inteligente de Reportes y Tablas Vehiculares con Gemini Vision para UBICA-RICK.

Uso:
    python3 gemini_extractor.py --image ruta/a/foto.jpg --key TU_GEMINI_API_KEY
    python3 gemini_extractor.py --folder ruta/a/fotos/ --key TU_GEMINI_API_KEY
"""

import sys
import os
import json
import base64
import argparse
import urllib.request
import urllib.error

PROMPT_SISTEMA = """Eres el extractor oficial de reportes vehiculares y de clientes para UBICA-RICK en Colombia.
Analiza la imagen adjunta y extrae ÚNICAMENTE un objeto JSON válido con este formato exacto sin texto adicional:
{
  "placa": "Placa del vehículo si aparece o vacía",
  "titular": "Nombre completo del titular si aparece en Información Básica del Cliente, o vacío",
  "cedula": "Número de cédula/ID si aparece, o vacío",
  "celulares": "Los dos primeros números celulares de 10 dígitos que inicien en 3 separados por ' - ' (OMITIR teléfonos fijos de 7 dígitos o con prefijos 604/606/601)",
  "direcciones": [
    "Dirección 1 con ciudad",
    "Dirección 2 con ciudad"
  ]
}

REGLAS OBLIGATORIAS DE EXTRACCIÓN:
1. En la tabla de direcciones, toma ÚNICAMENTE las filas donde la segunda fecha (ÚLTIMO REPORTE) sea del año 2026 en adelante (>= 2026).
2. La columna de estado (P. ACTIVO) debe decir 'SI'. Si dice 'NO', descarta la fila inmediatamente.
3. Máximo 4 direcciones vigentes.
4. Si la fecha es de 2025 o anterior (ej. 2015 a 2025), descarta la fila.
5. Omitir teléfonos fijos completamente y tomar solo los dos primeros números celulares.
6. Une cada dirección con su respectivo municipio (ej: 'KM 7 ZIPAQUIRA NEMOCON CA LOTE 6, ZIPAQUIRA' o 'KR 48 # 58 - 57, BELLO').
Responde ÚNICAMENTE con el bloque JSON."""

def extraer_con_gemini(ruta_imagen, api_key):
    if not os.path.exists(ruta_imagen):
        print(f"Error: No se encontró el archivo {ruta_imagen}")
        return None

    # Leer imagen y codificar en Base64
    with open(ruta_imagen, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    ext = os.path.splitext(ruta_imagen)[1].lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"

    payload = {
        "contents": [{
            "parts": [
                {"text": PROMPT_SISTEMA},
                {
                    "inline_data": {
                        "mime_type": mime,
                        "data": img_b64
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json"
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            texto_json = res_data["candidates"][0]["content"]["parts"][0]["text"]
            limpio = texto_json.replace("```json", "").replace("```", "").strip()
            return json.loads(limpio)
    except urllib.error.HTTPError as e:
        print(f"Error HTTP en Gemini API ({e.code}): {e.read().decode('utf-8')}")
        return None
    except Exception as e:
        print(f"Error procesando imagen: {e}")
        return None

def formatear_para_ubica_rick(datos, placa_fallback=""):
    placa = datos.get("placa") or placa_fallback or "SIN_PLACA"
    titular = datos.get("titular", "")
    cedula = datos.get("cedula", "")
    celulares = datos.get("celulares", "-")
    direcciones = datos.get("direcciones", [])

    titular_str = f"Titular: {titular}" if titular else ""
    if cedula and titular_str:
        titular_str += f" (C.C. {cedula})"
    elif cedula:
        titular_str = f"C.C. {cedula}"

    texto_app = f"PLACA: {placa}\n"
    texto_app += f"MARCA: -\nLÍNEA: -\nMODELO: -\nCOLOR: -\n"
    texto_app += f"SOAT: SI | TECNO: SI\n"
    texto_app += f"CELULARES: {celulares}\n"
    if titular_str:
        texto_app += f"NOTAS: {titular_str}\n"

    for idx, d in enumerate(direcciones[:4]):
        texto_app += f"DIRECCIÓN {idx + 1}: {d}\n"

    return texto_app

def main():
    parser = argparse.ArgumentParser(description="Extractor Gemini AI para UBICA-RICK")
    parser.add_argument("--image", help="Ruta de la imagen a procesar")
    parser.add_argument("--folder", help="Carpeta con múltiples imágenes")
    parser.add_argument("--key", required=True, help="Google Gemini API Key (aistudio.google.com)")
    parser.add_argument("--placa", default="", help="Placa asignada al reporte (opcional)")
    args = parser.parse_args()

    if args.image:
        print(f"\n🔍 Procesando: {args.image}...")
        datos = extraer_con_gemini(args.image, args.key)
        if datos:
            print("\n✅ Datos extraídos por Gemini:")
            print(json.dumps(datos, indent=2, ensure_ascii=False))
            print("\n📋 Formato listo para pegar en UBICA-RICK (Opción 1 o 5):")
            print("-" * 50)
            print(formatear_para_ubica_rick(datos, args.placa))
            print("-" * 50)
    elif args.folder:
        archivos = [os.path.join(args.folder, f) for f in os.listdir(args.folder) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        print(f"\n📁 Procesando {len(archivos)} imágenes en carpeta {args.folder}...")
        todos = []
        for a in archivos:
            print(f"-> Analizando {os.path.basename(a)}...")
            d = extraer_con_gemini(a, args.key)
            if d:
                todos.append(d)
        print(f"\n✅ Total extraídos: {len(todos)}")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
