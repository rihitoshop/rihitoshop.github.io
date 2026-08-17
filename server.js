const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const API_KEY = process.env.GAMESKINBO_API_KEY;
const API_BASE = "https://api.gameskinbo.com/ff-info/get";

// Intenta una consulta puntual, opcionalmente indicando una región específica.
async function intentarConsulta(uid, region) {
  const url = API_BASE + "?uid=" + uid + (region ? "&region=" + region : "");
  const resp = await fetch(url, {
    headers: { "x-api-key": API_KEY }
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    data = null;
  }

  if (resp.ok && data && data.AccountInfo && data.AccountInfo.AccountName) {
    return {
      tipo: "ok",
      nickname: data.AccountInfo.AccountName,
      region: data.AccountInfo.AccountRegion
    };
  }

  const mensajeReal = data && data.error ? data.error : ("Error HTTP " + resp.status);
  return { tipo: "error", status: resp.status, mensaje: mensajeReal };
}

// Prueba primero sin región (orden por defecto), y si falla, prueba cada región de
// Norte/Sudamérica explícitamente antes de rendirse.
async function buscarJugador(uid) {
  const primerIntento = await intentarConsulta(uid, null);
  if (primerIntento.tipo === "ok") return primerIntento;

  // Si fue límite de uso o clave inválida, no tiene caso reintentar con otras regiones.
  if (primerIntento.status === 429 || primerIntento.status === 401) {
    return primerIntento;
  }

  const regionesAmericanas = ["NA", "US", "SAC", "BR"];
  let ultimoError = primerIntento;

  for (const region of regionesAmericanas) {
    const intento = await intentarConsulta(uid, region);
    if (intento.tipo === "ok") return intento;
    if (intento.status === 429 || intento.status === 401) return intento;
    ultimoError = intento;
  }

  return ultimoError;
}

app.get("/api/verificar-id/:uid", async function (req, res) {
  const uid = req.params.uid;

  if (!/^\d+$/.test(uid)) {
    return res.status(400).json({ error: "ID inválido, solo se permiten números." });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: "Falta configurar la clave de API en el servidor." });
  }

  let resultado;
  try {
    resultado = await buscarJugador(uid);
  } catch (e) {
    return res.status(502).json({ error: "No se pudo contactar al servicio de verificación: " + e.message });
  }

  if (resultado.tipo === "ok") {
    return res.json({ nickname: resultado.nickname, region: resultado.region });
  }

  return res.status(resultado.status || 502).json({ error: resultado.mensaje });
});

app.get("/", function (req, res) {
  res.send("Backend de RIHITO SHOP funcionando ✅");
});

// Endpoint temporal de depuración: muestra el código HTTP y la respuesta
// cruda de GameSkinbo, sin interpretar nada. Bórralo cuando ya no lo necesites.
app.get("/api/debug/:uid", async function (req, res) {
  const uid = req.params.uid;
  const region = req.query.region || null;
  const url = API_BASE + "?uid=" + uid + (region ? "&region=" + region : "");

  try {
    const resp = await fetch(url, {
      headers: { "x-api-key": API_KEY }
    });
    const textoCrudo = await resp.text();

    res.json({
      url_consultada: url,
      status_http: resp.status,
      status_text: resp.statusText,
      respuesta_cruda: textoCrudo
    });
  } catch (e) {
    res.status(500).json({ error: "Fallo al conectar: " + e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor escuchando en el puerto " + PORT);
});