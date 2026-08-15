const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const REGIONES = ["NA", "SAC", "US", "BR", "IND", "SG", "RU", "ID", "TH", "VN", "ME", "EU", "PK", "CIS", "TW", "BD"];
const API_BASE = "https://free-ff-api-src-5plp.onrender.com/api/v1/account";

async function consultarRegion(uid, region, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);

  try {
    const resp = await fetch(API_BASE + "?region=" + region + "&uid=" + uid, {
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const data = await resp.json();
    if (data && data.basicInfo && data.basicInfo.nickname) {
      return {
        nickname: data.basicInfo.nickname,
        region: data.basicInfo.region || region
      };
    }
    return null;
  } catch (err) {
    clearTimeout(timer);
    return null;
  }
}

async function buscarJugador(uid) {
  const intentos = REGIONES.map(function (region) {
    return consultarRegion(uid, region, 4000);
  });

  const resultados = await Promise.allSettled(intentos);

  for (const r of resultados) {
    if (r.status === "fulfilled" && r.value) {
      return r.value;
    }
  }
  return null;
}

app.get("/api/verificar-id/:uid", async function (req, res) {
  const uid = req.params.uid;

  if (!/^\d+$/.test(uid)) {
    return res.status(400).json({ error: "ID inválido, solo se permiten números." });
  }

  const jugador = await buscarJugador(uid);

  if (!jugador) {
    return res.status(404).json({ error: "No se encontró ningún jugador con ese ID." });
  }

  res.json(jugador);
});

app.get("/", function (req, res) {
  res.send("Backend de RIHITO SHOP funcionando ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor escuchando en el puerto " + PORT);
});