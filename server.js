const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const USERUID = process.env.HLGAMING_USERUID;
const API_KEY = process.env.HLGAMING_APIKEY;
const API_BASE = "https://proapis.hlgamingofficial.com/main/games/freefire/account/api";

// Tu tienda solo vende recargas de Norteamérica / Estados Unidos.
// Una sola consulta con region="na" ya cubre ambas: la API responde con la
// región real de la cuenta (NA o US) sin necesidad de pedirla aparte. Si el
// ID es de otra región (Brasil, India, etc.), esta consulta simplemente no
// encuentra la cuenta — así evitamos gastar consultas de más.
const REGION = "na";

async function buscarJugador(uid) {
  const url =
    API_BASE +
    "?sectionName=AllData" +
    "&PlayerUid=" + uid +
    "&region=" + REGION +
    "&useruid=" + USERUID +
    "&api=" + API_KEY;

  const resp = await fetch(url);

  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    data = null;
  }

  const accountInfo =
    (data && data.result && data.result.AccountInfo) ||
    (data && data.result && data.result.basicInfo) ||
    null;

  const nickname =
    accountInfo && (accountInfo.AccountName || accountInfo.nickname);

  if (resp.ok && nickname) {
    return {
      tipo: "ok",
      nickname: nickname,
      region: (accountInfo.AccountRegion || REGION)
    };
  }

  // Si no se encontró, es casi siempre porque el ID pertenece a otra región
  // (fuera del clúster NA/US), no porque el ID esté mal escrito.
  const mensajeReal = "Región no disponible. Esta tienda solo procesa IDs de Norteamérica y Estados Unidos.";

  return { tipo: "error", status: 400, mensaje: mensajeReal };
}

app.get("/api/verificar-id/:uid", async function (req, res) {
  const uid = req.params.uid;

  if (!/^\d+$/.test(uid)) {
    return res.status(400).json({ error: "ID inválido, solo se permiten números." });
  }

  if (!USERUID || !API_KEY) {
    return res.status(500).json({ error: "Falta configurar las credenciales de HL Gaming en el servidor." });
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
// cruda de HL Gaming, sin interpretar nada. Bórralo cuando ya no lo necesites.
app.get("/api/debug/:uid", async function (req, res) {
  const uid = req.params.uid;
  const region = req.query.region || REGION;
  const url =
    API_BASE +
    "?sectionName=AllData" +
    "&PlayerUid=" + uid +
    "&region=" + region +
    "&useruid=" + USERUID +
    "&api=" + API_KEY;

  try {
    const resp = await fetch(url);
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