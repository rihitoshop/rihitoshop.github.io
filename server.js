const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// La clave de API vive en una variable de entorno en Render, nunca en este archivo.
const API_KEY = process.env.GAMESKINBO_API_KEY;
const API_BASE = "https://api.gameskinbo.com/ff-info/get";

async function buscarJugador(uid) {
  const resp = await fetch(API_BASE + "?uid=" + uid, {
    headers: { "x-api-key": API_KEY }
  });

  if (resp.status === 401) return { tipo: "sin_clave" };
  if (resp.status === 429) return { tipo: "limite" };
  if (resp.status === 402) return { tipo: "id_invalido" };
  if (!resp.ok) return { tipo: "error" };

  const data = await resp.json();
  if (!data || !data.AccountInfo || !data.AccountInfo.AccountName) {
    return { tipo: "no_encontrado" };
  }

  return {
    tipo: "ok",
    nickname: data.AccountInfo.AccountName,
    region: data.AccountInfo.AccountRegion
  };
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
    return res.status(502).json({ error: "No se pudo contactar al servicio de verificación." });
  }

  if (resultado.tipo === "ok") {
    return res.json({ nickname: resultado.nickname, region: resultado.region });
  }
  if (resultado.tipo === "limite") {
    return res.status(429).json({ error: "Se alcanzó el límite mensual de consultas. Intenta más tarde." });
  }
  if (resultado.tipo === "sin_clave") {
    return res.status(500).json({ error: "Clave de API inválida o faltante." });
  }

  return res.status(404).json({ error: "No se encontró ningún jugador con ese ID." });
});

app.get("/", function (req, res) {
  res.send("Backend de RIHITO SHOP funcionando ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor escuchando en el puerto " + PORT);
});