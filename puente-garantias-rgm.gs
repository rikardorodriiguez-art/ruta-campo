/**
 * ============================================================================
 * PUENTE AUTOMÁTICO DE GARANTÍAS MOBILIARIAS PARA UBICA-RICK (v6.2)
 * ============================================================================
 * INSTRUCCIONES RÁPIDAS (PARA ACTUALIZAR TU PUENTE):
 * 1. Abre tu proyecto en https://script.google.com
 * 2. Borra el código anterior y pega todo este código nuevo.
 * 3. Toca el icono de Guardar (💾).
 * 4. Arriba a la derecha toca en "Implementar" -> "Nueva implementación"
 *    (o "Gestionar implementaciones" -> Editar ✏️ -> "Nueva versión").
 * 5. Toca "Implementar".
 * ============================================================================
 */

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var urlDirecta = (params.url || "").toString().trim();
  var placa = (params.placa || params.NumeroBien || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

  if (urlDirecta && urlDirecta.indexOf("garantiasmobiliarias.com.co") !== -1) {
    var mPl = urlDirecta.match(/NumeroBien=([a-zA-Z0-9]+)/i);
    if (mPl && mPl[1] && !placa) {
      placa = mPl[1].toUpperCase();
    }
    if (/ResultadoConsultaGarantias\.aspx/i.test(urlDirecta)) {
      try {
        var respDir = UrlFetchApp.fetch(urlDirecta, {
          method: "get",
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-CO,es;q=0.9"
          },
          muteHttpExceptions: true
        });
        var htmlDir = respDir.getContentText("UTF-8");
        var datosDir = parsearTextoGarantias(htmlDir, placa);
        if (datosDir) {
          datosDir.ok = Boolean(datosDir.marca || datosDir.linea || datosDir.modelo || datosDir.garante);
          return responderJson(datosDir);
        }
      } catch (errDir) {}
    }
  }

  if (!placa) {
    return responderJson({
      ok: false,
      error: "Debes enviar el parámetro ?placa=JYY140"
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
    for (var hk in headers) {
      if (headers.hasOwnProperty(hk) && hk.toLowerCase() === "set-cookie") {
        var setCookies = headers[hk];
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
        "Accept-Language": "es-CO,es;q=0.9",
        "Origin": baseHost
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
        var loc = "";
        for (var lk in hAll) {
          if (hAll.hasOwnProperty(lk) && lk.toLowerCase() === "location") {
            loc = hAll[lk];
            break;
          }
        }
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

  // PASO 1.5: Solo si NO hay ningún Folio de 17 dígitos ni Formulario Registral en html1, disparar el botón Consultar
  if (!/\b20\d{14,18}\b|Formulario\s+Registral/i.test(html1)) {
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

  // PASO 2: Extraer el primer icono de la columna Acciones (en la fila de Formulario Registral de Ejecución)
  var accionesCandidatas = extraerAccionesTablaGarantias(html1, baseHost);
  var html2 = "";

  for (var ai = 0; ai < accionesCandidatas.length; ai++) {
    var accionFila = accionesCandidatas[ai];
    if (accionFila.type === "url") {
      var resp2 = fetchConSesion(accionFila.url, {
        method: "get",
        headers: { "Referer": urlConsulta }
      });
      if (resp2) html2 = resp2.getContentText("UTF-8");
    } else {
      var extraF = {};
      if (accionFila.name) {
        if (accionFila.type === "image") {
          extraF[accionFila.name + ".x"] = "10";
          extraF[accionFila.name + ".y"] = "10";
        } else if (accionFila.type === "submit") {
          extraF[accionFila.name] = accionFila.value || "";
        }
      }
      var payloadPaso2 = construirPayloadAspNet(html1, accionFila.target || "", accionFila.argument || "", extraF);

      // Intento 2A: Con X-MicrosoftAjax: Delta=true para capturar pageRedirect directo
      var respDelta = fetchConSesion(urlConsulta, {
        method: "post",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-MicrosoftAjax": "Delta=true",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": urlConsulta
        },
        payload: payloadPaso2
      });
      if (respDelta) {
        var txtDelta = respDelta.getContentText("UTF-8");
        var uRedir = extraerUrlRedireccionRgm(txtDelta, baseHost);
        if (uRedir) {
          var respRedir = fetchConSesion(uRedir, { method: "get", headers: { "Referer": urlConsulta } });
          if (respRedir) html2 = respRedir.getContentText("UTF-8");
        } else if (/A[ñn]o\s+Correspondiente|Bienes\s+Garantizados\s*\(\s*Por\s+serial\s*\)/i.test(txtDelta)) {
          html2 = txtDelta;
        }
      }

      // Intento 2B: POST estándar siguiendo redirección 302
      if (!html2 || !/A[ñn]o\s+Correspondiente|Bienes\s+Garantizados\s*\(\s*Por\s+serial\s*\)/i.test(html2)) {
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
          var uRedir2 = extraerUrlRedireccionRgm(txtPost, baseHost);
          if (uRedir2) {
            var respRedir2 = fetchConSesion(uRedir2, { method: "get", headers: { "Referer": urlConsulta } });
            if (respRedir2) html2 = respRedir2.getContentText("UTF-8");
          } else {
            html2 = txtPost;
          }
        }
      }
    }

    if (html2) {
      var datosDetalle = parsearTextoGarantias(html2, placa);
      if (datosDetalle && (datosDetalle.marca || datosDetalle.linea || datosDetalle.modelo)) {
        if (datosFolio) {
          if (!datosDetalle.acreedor && datosFolio.acreedor) datosDetalle.acreedor = datosFolio.acreedor;
          if (!datosDetalle.garante && datosFolio.garante) datosDetalle.garante = datosFolio.garante;
          if (!datosDetalle.cedula && datosFolio.cedula) datosDetalle.cedula = datosFolio.cedula;
        }
        datosDetalle.ok = true;
        return datosDetalle;
      }
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

function extraerUrlRedireccionRgm(texto, baseHost) {
  if (!texto) return "";
  var mRedir = texto.match(/pageRedirect\|\|([^|]+)/i);
  if (mRedir && mRedir[1]) {
    var u = decodeURIComponent(mRedir[1]).replace(/&amp;/g, "&").trim();
    if (u.indexOf("http") !== 0) {
      u = u.indexOf("/") === 0 ? (baseHost + u) : (baseHost + "/rgm/Garantias/" + u);
    }
    return u;
  }
  var mUrl = texto.match(/((?:https?:\/\/[^"'\s|<>]+|\/rgm\/Garantias\/)?ResultadoConsultaGarantias\.aspx\?[^"'\s|<>]+)/i);
  if (mUrl && mUrl[1]) {
    var u2 = mUrl[1].replace(/&amp;/g, "&").trim();
    if (u2.indexOf("%3f") !== -1 || u2.indexOf("%3F") !== -1 || u2.indexOf("%26") !== -1) {
      try { u2 = decodeURIComponent(u2); } catch (e) {}
    }
    if (u2.indexOf("http") !== 0) {
      u2 = u2.indexOf("/") === 0 ? (baseHost + u2) : (baseHost + "/rgm/Garantias/" + u2.replace(/^\.\//, ""));
    }
    return u2;
  }
  return "";
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
  if (Object.keys(extra).length > 0) {
    return { target: "", argument: "", extraFields: extra };
  }
  return null;
}

function extraerAccionesTablaGarantias(html, baseHost) {
  var lista = [];
  if (!html) return lista;

  var uDir = extraerUrlRedireccionRgm(html, baseHost);
  if (uDir) {
    lista.push({ type: "url", url: uDir });
  }

  // Buscar todas las filas <tr> que tengan Folio Electrónico (20...) o Formulario Registral
  var filas = [];
  var reTr = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  var mTr;
  while ((mTr = reTr.exec(html)) !== null) {
    var trHtml = mTr[1];
    if (/\b20\d{14,18}\b/i.test(trHtml) || /Formulario\s+Registral/i.test(trHtml)) {
      filas.push(trHtml);
    }
  }

  // Ordenar filas priorizando "Formulario Registral de Ejecución" y la más reciente
  filas.sort(function(a, b) {
    var aEjec = /Ejecuci/i.test(a) ? 1 : 0;
    var bEjec = /Ejecuci/i.test(b) ? 1 : 0;
    return bEjec - aEjec;
  });

  if (filas.length === 0) {
    var idxTabla = html.search(/Detalle\s+de\s+la\s+Garant|Folio\s+Electr|\b20\d{14,18}\b/i);
    var sub = idxTabla !== -1 ? html.substring(idxTabla) : html;
    var idxForm = sub.search(/Formulario\s+Registral/i);
    filas.push(idxForm !== -1 ? sub.substring(idxForm, idxForm + 2500) : sub.substring(0, 3500));
  }

  for (var f = 0; f < filas.length; f++) {
    var fila = filas[f];
    var posForm = fila.search(/Formulario\s+Registral/i);
    var zonaAcciones = posForm !== -1 ? fila.substring(posForm) : fila;

    // Buscar TODOS los controles interactivos en zonaAcciones en el orden exacto en que aparecen
    var candidatosFila = [];

    var reImg = /<input\b[^>]*>/gi;
    var mI;
    while ((mI = reImg.exec(zonaAcciones)) !== null) {
      var tag = mI[0];
      var mTp = tag.match(/type\s*=\s*["']?([^"'\s>]+)/i);
      var tp = mTp ? mTp[1].toLowerCase() : "";
      var mNm = tag.match(/name\s*=\s*["']([^"']+)["']/i);
      if (!mNm) continue;
      var nm = mNm[1];
      var mPbOnClick = tag.match(/__doPostBack\(\s*(?:'|&#39;|"|\\')([^'"&\\]+)(?:'|&#39;|"|\\')\s*,\s*(?:'|&#39;|"|\\')([^'"&\\]*)(?:'|&#39;|"|\\')\s*\)/i) ||
                       tag.match(/WebForm_PostBackOptions\(\s*(?:'|&#39;|&quot;|")([^'"&]+)(?:'|&#39;|&quot;|")\s*,\s*(?:'|&#39;|&quot;|")([^'"&]*)(?:'|&#39;|&quot;|")/i);
      if (tp === "image") {
        candidatosFila.push({
          idx: mI.index,
          type: "image",
          name: nm,
          target: mPbOnClick ? mPbOnClick[1] : "",
          argument: mPbOnClick ? (mPbOnClick[2] || "") : ""
        });
      } else if (tp === "submit" || tp === "button") {
        var mVal = tag.match(/value\s*=\s*["']([^"']*)["']/i);
        candidatosFila.push({
          idx: mI.index,
          type: "submit",
          name: nm,
          value: mVal ? mVal[1] : "",
          target: mPbOnClick ? mPbOnClick[1] : "",
          argument: mPbOnClick ? (mPbOnClick[2] || "") : ""
        });
      }
    }

    var rePb = /__doPostBack\(\s*(?:'|&#39;|&quot;|"|\\')([^'"&\\]+)(?:'|&#39;|&quot;|"|\\')\s*,\s*(?:'|&#39;|&quot;|"|\\')([^'"&\\]*)(?:'|&#39;|&quot;|"|\\')\s*\)/gi;
    var mP;
    while ((mP = rePb.exec(zonaAcciones)) !== null) {
      candidatosFila.push({
        idx: mP.index,
        type: "postback",
        target: mP[1],
        argument: mP[2] || ""
      });
    }

    // Ordenar por posición en el HTML para que el PRIMER icono de Acciones ("Consultar Detalle") vaya primero
    candidatosFila.sort(function(x, y) { return x.idx - y.idx; });

    for (var ci = 0; ci < candidatosFila.length; ci++) {
      lista.push(candidatosFila[ci]);
    }
  }

  return lista;
}

function decodificarEntidadesHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function(_, d) { return String.fromCharCode(parseInt(d, 10)); });
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
    campos[name] = mVal ? decodificarEntidadesHtml(mVal[1]) : "";
  }

  var reSelect = /<select\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  var mSel;
  while ((mSel = reSelect.exec(html)) !== null) {
    var selName = mSel[1];
    var selBody = mSel[2];
    var mOptSel = selBody.match(/<option\b[^>]*selected[^>]*value\s*=\s*["']([^"']*)["']/i) ||
                  selBody.match(/<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*selected/i) ||
                  selBody.match(/<option\b[^>]*value\s*=\s*["']([^"']*)["']/i);
    campos[selName] = mOptSel ? decodificarEntidadesHtml(mOptSel[1]) : "";
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
  var mFab = limpio.match(/Fabricante\s*:?\s*([A-Z0-9\-\s]{2,22}?)(?=\s*(?:A[ñn]o\s+Correspondiente|Placa|Descripci|L[ií]nea|Modelo|Color|N[uú]mero|,|$))/i);

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
    var mAcSec = limpio.match(/Acreedores\s+Garantizados[\s\S]{0,200}?Raz[oó]n\s+Social\s+o\s+Nombre\s*\.?\s*([A-ZÁÉÍÓÚÑ0-9\s\.]{3,65}?)(?=\s*(?:Tipo\s+Identificaci|N[uú]mero\s+de\s+Identificaci|NIT|Tel[eé]fono|$))/i);
    if (mAcSec && mAcSec[1]) res.acreedor = mAcSec[1].trim().toUpperCase();
    var mDeudSec = limpio.match(/(?:Deudores\s+y\s+Garantes|\bDEUDOR\b)[\s\S]{0,200}?Raz[oó]n\s+Social\s+o\s+Nombre\s*\.?\s*([A-ZÁÉÍÓÚÑ\s\.]{4,50}?)(?=\s*(?:Tel[eé]fono|Celular|Correo|Tipo\s+Identificaci|CEDULA|NIT|N[uú]mero|$))/i);
    if (mDeudSec && mDeudSec[1]) res.garante = mDeudSec[1].trim().toUpperCase();
    var mCedSec = limpio.match(/(?:Deudores\s+y\s+Garantes|\bDEUDOR\b)[\s\S]{0,300}?N[uú]mero\s+de\s+Identificaci[oó]n\s*\.?\s*(\d{6,12})\b/i);
    if (mCedSec && mCedSec[1]) res.cedula = mCedSec[1].trim();
  }

  return res;
}
