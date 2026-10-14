/**
 * ============================================================================
 * PUENTE AUTOMÁTICO DE GARANTÍAS MOBILIARIAS PARA UBICA-RICK (v6.2)
 * ============================================================================
 * INSTRUCCIONES RÁPIDAS (SOLO SE HACE 1 VEZ):
 * 1. Entra a https://script.google.com y toca en "Nuevo proyecto".
 * 2. Borra lo que haya en el editor y pega todo este código.
 * 3. Arriba a la derecha toca en "Implementar" -> "Nueva implementación".
 * 4. En "Selecciona el tipo" (icono de engranaje ⚙️) elige "Aplicación web".
 * 5. En "Quién tiene acceso" selecciona: "Cualquier persona" (Anyone).
 * 6. Toca "Implementar", copia la "URL de la aplicación web" (termina en /exec)
 *    y pégala en UBICA-RICK en el botón "⚙️ Puente".
 * ============================================================================
 */

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var placa = (params.placa || params.NumeroBien || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

  if (!placa) {
    return responderJson({
      ok: false,
      error: "Debes enviar el parámetro ?placa=LRW205"
    });
  }

  try {
    var resultado = consultarPlacaEnGarantiasMobiliarias(placa);
    return responderJson(resultado);
  } catch (err) {
    return responderJson({
      ok: false,
      placa: placa,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function responderJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function consultarPlacaEnGarantiasMobiliarias(placa) {
  var baseHost = "https://www.garantiasmobiliarias.com.co";
  var urlConsulta = baseHost + "/rgm/Garantias/ConsultaGarantia.aspx?NumeroBien=" + encodeURIComponent(placa.toLowerCase()) + "&ConsultaOficial=false";
  var ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var cookiesMap = {};

  function guardarCookiesDeRespuesta(resp) {
    if (!resp) return;
    var headers = resp.getAllHeaders();
    if (!headers) return;
    var setCookies = headers["Set-Cookie"] || headers["set-cookie"];
    if (!setCookies) return;
    var lista = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (var i = 0; i < lista.length; i++) {
      var parte = String(lista[i]).split(";")[0].trim();
      var eq = parte.indexOf("=");
      if (eq > 0) {
        var k = parte.substring(0, eq).trim();
        var v = parte.substring(eq + 1).trim();
        cookiesMap[k] = v;
      }
    }
  }

  function obtenerCookieHeader() {
    var pares = [];
    for (var k in cookiesMap) {
      if (cookiesMap.hasOwnProperty(k)) {
        pares.push(k + "=" + cookiesMap[k]);
      }
    }
    return pares.join("; ");
  }

  function fetchConSesion(url, opcionesExtra) {
    var urlActual = url;
    var opts = opcionesExtra || {};
    for (var hop = 0; hop < 6; hop++) {
      var reqHeaders = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9"
      };
      var ck = obtenerCookieHeader();
      if (ck) reqHeaders["Cookie"] = ck;
      if (opts.headers) {
        for (var h in opts.headers) {
          reqHeaders[h] = opts.headers[h];
        }
      }

      var paramsFetch = {
        method: opts.method || "get",
        headers: reqHeaders,
        followRedirects: false,
        muteHttpExceptions: true
      };
      if (opts.payload) {
        paramsFetch.payload = opts.payload;
      }

      var resp = UrlFetchApp.fetch(urlActual, paramsFetch);
      guardarCookiesDeRespuesta(resp);
      var code = resp.getResponseCode();

      if (code === 301 || code === 302 || code === 303 || code === 307 || code === 308) {
        var hAll = resp.getAllHeaders();
        var loc = hAll["Location"] || hAll["location"];
        if (!loc) return resp;
        if (loc.indexOf("http") !== 0) {
          if (loc.indexOf("/") === 0) loc = baseHost + loc;
          else loc = baseHost + "/rgm/Garantias/" + loc.replace(/^\.\//, "");
        }
        urlActual = loc;
        opts = { method: "get", headers: { "Referer": url } };
        continue;
      }
      return resp;
    }
    return null;
  }

  // PASO 1: Abrir ConsultaGarantia.aspx con el NumeroBien (placa)
  var resp1 = fetchConSesion(urlConsulta, { method: "get" });
  if (!resp1) {
    return { ok: false, placa: placa, error: "Sin respuesta de Garantías Mobiliarias en Paso 1" };
  }

  var html1 = resp1.getContentText("UTF-8");

  // PASO 1.5: Si la página cargó el formulario pero aún no ejecutó el botón Consultar, disparar la consulta por serial
  if (!/Detalle\s+de\s+la\s+Garant|20\d{14,18}/i.test(html1)) {
    var btnConsultarInfo = extraerBotonConsultarInicial(html1, placa);
    if (btnConsultarInfo) {
      var payloadConsulta = construirPayloadAspNet(html1, btnConsultarInfo.target, btnConsultarInfo.argument, btnConsultarInfo.extraFields);
      var respCons = fetchConSesion(urlConsulta, {
        method: "post",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": urlConsulta
        },
        payload: payloadConsulta
      });
      if (respCons) {
        html1 = respCons.getContentText("UTF-8");
      }
    }
  }

  var datosFolio = parsearTextoGarantias(html1, placa);
  if (datosFolio && (datosFolio.marca || datosFolio.linea || datosFolio.modelo)) {
    datosFolio.ok = true;
    return datosFolio;
  }

  // PASO 2: Extraer la acción en la columna Acciones (después de Formulario Registral de Ejecución / Inscripción)
  var accionFila = extraerAccionTablaGarantias(html1, baseHost);
  var html2 = "";

  if (accionFila && accionFila.type === "url") {
    var resp2 = fetchConSesion(accionFila.url, {
      method: "get",
      headers: { "Referer": urlConsulta }
    });
    if (resp2) html2 = resp2.getContentText("UTF-8");
  } else if (accionFila && (accionFila.type === "postback" || accionFila.type === "image" || accionFila.type === "submit")) {
    var extraF = {};
    if (accionFila.type === "image" && accionFila.name) {
      extraF[accionFila.name + ".x"] = "10";
      extraF[accionFila.name + ".y"] = "10";
    } else if (accionFila.type === "submit" && accionFila.name) {
      extraF[accionFila.name] = accionFila.value || "";
    }
    var payloadPaso2 = construirPayloadAspNet(html1, accionFila.target || "", accionFila.argument || "", extraF);
    var respPost = fetchConSesion(urlConsulta, {
      method: "post",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": urlConsulta
      },
      payload: payloadPaso2
    });
    if (respPost) {
      var txtPost = respPost.getContentText("UTF-8");
      var mRedir = txtPost.match(/pageRedirect\|\|([^|]+)/i);
      if (mRedir && mRedir[1]) {
        var uRedir = decodeURIComponent(mRedir[1]);
        if (uRedir.indexOf("http") !== 0) {
          uRedir = uRedir.indexOf("/") === 0 ? (baseHost + uRedir) : (baseHost + "/rgm/Garantias/" + uRedir);
        }
        var respRedir = fetchConSesion(uRedir, { method: "get", headers: { "Referer": urlConsulta } });
        if (respRedir) html2 = respRedir.getContentText("UTF-8");
      } else {
        html2 = txtPost;
        var subAccion = extraerAccionTablaGarantias(html2, baseHost);
        if (subAccion && subAccion.type === "url" && !/A[ñn]o\s+Correspondiente/i.test(html2)) {
          var respDet2 = fetchConSesion(subAccion.url, { method: "get", headers: { "Referer": urlConsulta } });
          if (respDet2) html2 = respDet2.getContentText("UTF-8");
        }
      }
    }
  }

  if (html2) {
    var datosDetalle = parsearTextoGarantias(html2, placa);
    if (datosDetalle) {
      if (datosFolio) {
        if (!datosDetalle.acreedor && datosFolio.acreedor) datosDetalle.acreedor = datosFolio.acreedor;
        if (!datosDetalle.garante && datosFolio.garante) datosDetalle.garante = datosFolio.garante;
        if (!datosDetalle.cedula && datosFolio.cedula) datosDetalle.cedula = datosFolio.cedula;
      }
      datosDetalle.ok = Boolean(datosDetalle.marca || datosDetalle.linea || datosDetalle.modelo || datosDetalle.garante);
      return datosDetalle;
    }
  }

  if (datosFolio && (datosFolio.acreedor || datosFolio.garante)) {
    datosFolio.ok = true;
    return datosFolio;
  }

  return {
    ok: false,
    placa: placa,
    error: "No se encontraron registros activos de Garantías Mobiliarias para la placa " + placa
  };
}

function extraerBotonConsultarInicial(html, placa) {
  if (!html) return null;
  var extra = {};
  var reInp = /<input\b[^>]*>/gi;
  var m;
  var submitName = "";
  var submitVal = "Consultar";
  while ((m = reInp.exec(html)) !== null) {
    var tag = m[0];
    var mName = tag.match(/name\s*=\s*["']([^"']+)["']/i);
    if (!mName) continue;
    var nm = mName[1];
    if (/NumeroBien|Serial|Placa|txtBien/i.test(nm)) {
      extra[nm] = placa.toLowerCase();
    }
    if (/btnConsultar|ibtnConsultar|Consultar/i.test(nm)) {
      var mType = tag.match(/type\s*=\s*["']?([^"'\s>]+)/i);
      var tp = mType ? mType[1].toLowerCase() : "submit";
      if (tp === "image") {
        extra[nm + ".x"] = "12";
        extra[nm + ".y"] = "12";
      } else {
        submitName = nm;
        var mv = tag.match(/value\s*=\s*["']([^"']*)["']/i);
        if (mv) submitVal = mv[1];
      }
    }
  }
  if (submitName) extra[submitName] = submitVal;
  var mPbCons = html.match(/__doPostBack\(\s*(?:'|&#39;|")([^'"&]*(?:btnConsultar|lnkConsultar|Consultar)[^'"&]*)(?:'|&#39;|")\s*,\s*(?:'|&#39;|")([^'"&]*)(?:'|&#39;|")\s*\)/i);
  if (mPbCons) {
    return { target: mPbCons[1], argument: mPbCons[2] || "", extraFields: extra };
  }
  if ( Object.keys(extra).length > 0 ) {
    return { target: "", argument: "", extraFields: extra };
  }
  return null;
}

function extraerAccionTablaGarantias(html, baseHost) {
  if (!html) return null;
  // 1. Buscar primero cualquier enlace directo a ResultadoConsultaGarantias.aspx en toda la respuesta
  var mUrlGlobal = html.match(/(?:href|window\.open)\s*=\s*["']([^"']*ResultadoConsultaGarantias\.aspx\?[^"']+)["']/i);
  if (mUrlGlobal && mUrlGlobal[1]) {
    var u = mUrlGlobal[1].replace(/&amp;/g, "&").trim();
    if (u.indexOf("http") !== 0) {
      u = u.indexOf("/") === 0 ? (baseHost + u) : (baseHost + "/rgm/Garantias/" + u.replace(/^\.\//, ""));
    }
    return { type: "url", url: u };
  }

  // 2. Recortar desde la tabla "Detalle de la Garantía" o desde el primer Folio de 17 dígitos para NO tocar enlaces de la cabecera
  var idxTabla = html.search(/Detalle\s+de\s+la\s+Garant|Folio\s+Electr|\b20\d{14,18}\b/i);
  var sub = idxTabla !== -1 ? html.substring(idxTabla) : html;

  // En la tabla, "Formulario Registral de Ejecución" (columna 6) está ANTES de la columna "Acciones" (columna 7)
  var idxForm = sub.search(/Formulario\s+Registral\s+de\s+(?:Ejecuci|Inscripci|Modificaci)/i);
  var zonaAcciones = idxForm !== -1 ? sub.substring(idxForm, idxForm + 2600) : sub.substring(0, 4500);

  // 2A. __doPostBack en la columna Acciones (después de Formulario Registral)
  var mPb = zonaAcciones.match(/__doPostBack\(\s*(?:'|&#39;|")([^'"&]+)(?:'|&#39;|")\s*,\s*(?:'|&#39;|")([^'"&]*)(?:'|&#39;|")\s*\)/i);
  if (mPb && mPb[1]) {
    return { type: "postback", target: mPb[1], argument: mPb[2] || "" };
  }

  // 2B. <input type="image" name="..."> en la columna Acciones
  var mImg = zonaAcciones.match(/<input\b[^>]*type\s*=\s*["']?image["']?[^>]*name\s*=\s*["']([^"']+)["'][^>]*>/i) ||
             zonaAcciones.match(/<input\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']?image["']?[^>]*>/i);
  if (mImg && mImg[1]) {
    return { type: "image", name: mImg[1] };
  }

  // 2C. <input type="submit" name="..."> en la columna Acciones
  var mSub = zonaAcciones.match(/<input\b[^>]*type\s*=\s*["']?submit["']?[^>]*name\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (mSub && mSub[1]) {
    var mVal = mSub[0].match(/value\s*=\s*["']([^"']*)["']/i);
    return { type: "submit", name: mSub[1], value: mVal ? mVal[1] : "" };
  }

  return null;
}

function construirPayloadAspNet(html, eventTarget, eventArgument, extraFieldsMap) {
  var campos = {};
  var reInput = /<input\b[^>]*>/gi;
  var m;
  while ((m = reInput.exec(html)) !== null) {
    var tag = m[0];
    var mType = tag.match(/type\s*=\s*["']?([^"'\s>]+)/i);
    var tipo = mType ? mType[1].toLowerCase() : "text";
    if (tipo === "submit" || tipo === "button" || tipo === "image" || tipo === "reset") continue;
    var mName = tag.match(/name\s*=\s*["']([^"']+)["']/i);
    if (!mName) continue;
    var name = mName[1];
    if (tipo === "radio" || tipo === "checkbox") {
      if (!/\bchecked\b/i.test(tag)) continue;
    }
    var mVal = tag.match(/value\s*=\s*["']([^"']*)["']/i);
    var val = mVal ? mVal[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
    campos[name] = val;
  }
  campos["__EVENTTARGET"] = eventTarget || "";
  campos["__EVENTARGUMENT"] = eventArgument || "";
  if (extraFieldsMap) {
    for (var ek in extraFieldsMap) {
      if (extraFieldsMap.hasOwnProperty(ek)) {
        campos[ek] = extraFieldsMap[ek];
      }
    }
  }
  var partes = [];
  for (var k in campos) {
    if (campos.hasOwnProperty(k)) {
      partes.push(encodeURIComponent(k) + "=" + encodeURIComponent(campos[k]));
    }
  }
  return partes.join("&");
}

function parsearTextoGarantias(rawHtml, placaFallback) {
  if (!rawHtml) return null;
  var limpio = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, function(_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/\s+/g, " ")
    .trim();

  var res = {
    placa: placaFallback || "",
    marca: "",
    linea: "",
    modelo: "",
    color: "",
    acreedor: "",
    garante: "",
    cedula: ""
  };

  var palabrasIgnorarMarca = ["NUMERO", "NÚMERO", "DE", "SERIAL", "FABRICANTE", "AÑO", "ANO", "MODELO", "PLACA", "TIPO", "BIEN", "VEHICULO", "VEHÍCULO", "DESCRIPCION", "DESCRIPCIÓN", "NO", "EXISTEN", "SERVICIO", "PARTICULAR", "PUBLICO", "PÚBLICO"];

  var mPlaca1 = limpio.match(/Placa\s*:?\s*([A-Z]{3}\d{2}[0-9A-Z])/i);
  var mPlaca2 = limpio.match(/A[ñn]o\s+Correspondiente\s+al\s+Modelo\s*:?\s*(?:19\d{2}|20\d{2})\s+(?:Placa\s*:?\s*)?([A-Z]{3}\d{2}[0-9A-Z])/i);
  if (mPlaca1) res.placa = mPlaca1[1].toUpperCase();
  else if (mPlaca2) res.placa = mPlaca2[1].toUpperCase();

  var mMarcaVeh = limpio.match(/Veh[ií]culo\s*:\s*([A-Z0-9\-\s]{2,22}?)(?=\s*(?:Placa|Modelo|L[ií]nea|Chasis|Color|Servicio|Vin|Motor|Serie|$))/i);
  var mMarcaLin = limpio.match(/Marca\s*:?\s*([A-Z0-9\-\s]{2,22}?)(?=\s*(?:N[uú]mero\s+de\s+Serial|Fabricante|A[ñn]o\s+Correspondiente|Placa|L[ií]nea|Modelo|Color|Tipo|Descripci|Chasis|Motor|Serie|,|$))/i);
  var mFab = limpio.match(/Fabricante\s*:?\s*([A-Z0-9\-\s]{2,22}?)(?=\s*(?:A[ñn]o\s+Correspondiente|Placa|Descripci|L[ií]nea|Modelo|Color|N[uú]mero)|,|$)/i);

  function validarMarca(cand) {
    if (!cand) return "";
    var c = cand.trim().toUpperCase().replace(/[^A-Z0-9\-\s]/g, "").trim();
    if (!c || c.length < 2 || c.length > 22) return "";
    if (palabrasIgnorarMarca.indexOf(c) !== -1) return "";
    if (/N[UÚ]MERO\s+DE\s+SERIAL|FABRICANTE|A[ÑN]O\s+CORRESPONDIENTE|DESCRIPCI|GARANTIA/i.test(c)) return "";
    var tokens = c.split(/\s+/).filter(function(t) {
      return t.length < 13 && !/^\d{4,}$/.test(t) && palabrasIgnorarMarca.indexOf(t) === -1;
    });
    return tokens.join(" ").trim();
  }

  res.marca = validarMarca(mMarcaVeh && mMarcaVeh[1]) ||
              validarMarca(mMarcaLin && mMarcaLin[1]) ||
              validarMarca(mFab && mFab[1]);

  var mMod1 = limpio.match(/A[ñn]o\s+Correspondiente\s+al\s+Modelo\s*:?\s*(19\d{2}|20\d{2})/i);
  var mMod2 = limpio.match(/Modelo\s*:?\s*(19\d{2}|20\d{2})/i);
  if (mMod1) res.modelo = mMod1[1];
  else if (mMod2) res.modelo = mMod2[1];

  var mCol = limpio.match(/Color\s*:?\s*([A-ZÁÉÍÓÚÑ\s]{3,24}?)(?=\s*(?:Tipo\s+de\s+Servicio|T\.\s*Servicio|Servicio|L[ií]nea|Chasis|Vin|Motor|Serie|Tipo|Modelo|Marca|Placa|No\s+existen|,|\.|$))/i);
  if (mCol && mCol[1]) {
    var colCand = mCol[1].trim().toUpperCase();
    if (!/^(?:TIPO|SERVICIO|PARTICULAR|PUBLICO|PÚBLICO|CHASIS|MOTOR)$/.test(colCand)) {
      res.color = colCand;
    }
  }

  var mLinDirecta = limpio.match(/L[ií]nea\s*:?\s*([A-Z0-9\-\s\.\/]{1,30}?)(?=\s*(?:Tipo\s+de\s+Servicio|T\.\s*Servicio|Servicio|Color|Chasis|Vin|Motor|Serie|Modelo|Marca|Placa|No\s+existen|Informaci[oó]n\s+General|,|\.|$))/i);
  if (mLinDirecta && mLinDirecta[1]) {
    var linCand = mLinDirecta[1].trim().toUpperCase();
    if (linCand && !/^(?:TIPO|DE|SERVICIO|NO|EXISTEN|PARTICULAR|PUBLICO)$/.test(linCand)) {
      res.linea = linCand;
    }
  }

  if (!res.linea) {
    var mDesc = limpio.match(/Descripci[oó]n\s+del\s+Bien\s*:?\s*(.+?)(?=\s*(?:Tipo\s+de\s+Servicio|No\s+existen|Informaci[oó]n\s+General|Bienes\s+Garantizados|$))/i);
    if (mDesc && mDesc[1]) {
      var descStr = mDesc[1].trim();
      var mLinInDesc = descStr.match(/L[ií]nea\s*:?\s*([A-Z0-9\-\s\.\/]{1,30}?)(?=\s*(?:Tipo|Color|Chasis|Vin|Motor|Serie|Servicio|,|\.|$))/i);
      if (mLinInDesc && mLinInDesc[1]) {
        res.linea = mLinInDesc[1].trim().toUpperCase();
      } else if (!/^(?:GARANTIA|GARANTÍA|CONTRATO|PAGARE|PAGARÉ|PRENDA)\b/i.test(descStr)) {
        if (descStr.indexOf(",") !== -1) {
          var partes = descStr.split(",").map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean);
          var coloresConocidos = ["BLANCO", "NEGRO", "GRIS", "PLATA", "PLATEADO", "ROJO", "AZUL", "VERDE", "AMARILLO", "BEIGE", "CAFE", "MARRON", "DORADO", "NARANJA", "VINOTINTO"];
          var ignorarEnDesc = ["PUBLICO", "PÚBLICO", "PARTICULAR", "OFICIAL", "VEHICULO", "VEHÍCULO", "AUTOMOVIL", "AUTOMÓVIL", "CAMIONETA", "CAMION", "CAMIÓN", "FURGON", "FURGÓN", "MOTOCICLETA", "CAMPERO", "PICKUP", "PICK-UP"];
          var partesLinea = [];
          for (var pi = 0; pi < partes.length; pi++) {
            var pt = partes[pi];
            var esCol = false;
            for (var ci = 0; ci < coloresConocidos.length; ci++) {
              if (pt === coloresConocidos[ci] || pt.indexOf(coloresConocidos[ci] + " ") === 0) {
                esCol = true;
                break;
              }
            }
            if (esCol) {
              if (!res.color) res.color = pt;
            } else if (ignorarEnDesc.indexOf(pt) === -1 && pt !== res.marca && pt !== res.modelo && pt !== res.placa && !/^(?:GARANTIA|CHASIS|MOTOR|SERIE|VIN)/.test(pt)) {
              partesLinea.push(pt);
            }
          }
          if (partesLinea.length > 0) {
            res.linea = partesLinea.slice(0, 2).join(" ");
          }
        } else if (descStr.length >= 2 && descStr.length <= 35 && !/Veh[ií]culo|Chasis|Motor|Placa/i.test(descStr)) {
          res.linea = descStr.toUpperCase();
        }
      }
    }
  }

  var mFolioRow = limpio.match(/\b(20\d{14,18})\s+([A-ZÑÁÉÍÓÚ\s\.]+?(?:FINANCIAMIENTO|S\.A\.S\.|S\.A\.|BIC|BANCAMIA|BANCO[A-ZÑÁÉÍÓÚ\s]*|FINANZAUTO[A-ZÑÁÉÍÓÚ\s]*|SUFI[A-ZÑÁÉÍÓÚ\s]*|GM\s*FINANCIAL[A-ZÑÁÉÍÓÚ\s\.]*|RCI[A-ZÑÁÉÍÓÚ\s]*|MOBILIZE[A-ZÑÁÉÍÓÚ\s]*|OCCIDENTE[A-ZÑÁÉÍÓÚ\s]*|REPONER[A-ZÑÁÉÍÓÚ\s\.]*))\s+([A-ZÑÁÉÍÓÚ\s]{5,45}?)\s+(\d{6,12})\b/i);
  if (mFolioRow) {
    res.acreedor = mFolioRow[2].trim().toUpperCase();
    res.garante = mFolioRow[3].trim().toUpperCase();
    res.cedula = mFolioRow[4].trim();
  } else {
    var mAcSec = limpio.match(/Acreedores\s+Garantizados[\s\S]{0,160}?Raz[oó]n\s+Social\s+o\s+Nombre\s*\.?\s*([A-ZÁÉÍÓÚÑ0-9\s\.]{3,65}?)(?=\s*(?:Tipo\s+Identificaci|N[uú]mero\s+de\s+Identificaci|NIT|Tel[eé]fono|$))/i);
    if (mAcSec && mAcSec[1]) res.acreedor = mAcSec[1].trim().toUpperCase();
    var mDeudSec = limpio.match(/(?:Deudores\s+y\s+Garantes|\bDEUDOR\b)[\s\S]{0,160}?Raz[oó]n\s+Social\s+o\s+Nombre\s*\.?\s*([A-ZÁÉÍÓÚÑ\s\.]{4,50}?)(?=\s*(?:Tel[eé]fono|Celular|Correo|Tipo\s+Identificaci|CEDULA|NIT|N[uú]mero|$))/i);
    if (mDeudSec && mDeudSec[1]) res.garante = mDeudSec[1].trim().toUpperCase();
    var mCedSec = limpio.match(/(?:Deudores\s+y\s+Garantes|\bDEUDOR\b)[\s\S]{0,280}?N[uú]mero\s+de\s+Identificaci[oó]n\s*\.?\s*(\d{6,12})\b/i);
    if (mCedSec && mCedSec[1]) res.cedula = mCedSec[1].trim();
  }

  return res;
}
