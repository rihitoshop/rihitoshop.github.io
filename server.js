const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const API_KEY = process.env.GAMESKINBO_API_KEY;
const API_BASE = "https://api.gameskinbo.com/ff-info/get";

async function buscarJugador(uid) {
  const resp = await fetch(API_BASE + "?uid=" + uid, {
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

  // Reenvía el mensaje y código real de GameSkinbo, sin disfrazarlo.
  return res.status(resultado.status || 502).json({ error: resultado.mensaje });
});

app.get("/", function (req, res) {
  res.send("Backend de RIHITO SHOP funcionando ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor escuchando en el puerto " + PORT);
});