// ============================================================
// RIHITO SHOP - Backend
// Maneja: registro con codigo de 6 digitos, login, olvide mi
// contraseña, saldo de usuarios, y panel de administrador.
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- Configuracion (viene de variables de entorno en Render) ----------
const {
  DATABASE_URL,       // cadena de conexion de Supabase
  JWT_SECRET,          // texto secreto para firmar sesiones
  RESEND_API_KEY,      // clave de Resend
  EMAIL_FROM,          // remitente de los correos, ej: RIHITO SHOP <onboarding@resend.dev>
  ADMIN_USER,          // usuario del panel de administrador
  ADMIN_PASSWORD,      // contraseña del panel de administrador
  HLGAMING_USERUID,    // credenciales para verificar el ID de jugador de Free Fire
  HLGAMING_APIKEY,
  PORT = 3000
} = process.env;

const HLGAMING_API_BASE = "https://proapis.hlgamingofficial.com/main/games/freefire/account/api";
const HLGAMING_REGION = "na";
const HLGAMING_REGIONES_PERMITIDAS = ["NA", "US"];

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(RESEND_API_KEY);

// ---------- Crear tablas si no existen ----------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      verified BOOLEAN DEFAULT FALSE,
      balance NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL, -- 'signup' o 'reset'
      password_hash TEXT,     -- solo se usa para 'signup', se guarda temporalmente
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Tablas listas.');
}
initDb().catch(err => console.error('Error creando tablas:', err));

// ---------- Utilidades ----------
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digitos
}

async function enviarCodigo(email, codigo, tipo) {
  const asunto = tipo === 'signup'
    ? 'Tu código de verificación - RIHITO SHOP'
    : 'Recuperar contraseña - RIHITO SHOP';

  const mensaje = tipo === 'signup'
    ? `Tu código para verificar tu cuenta es: <strong>${codigo}</strong><br>Este código vence en 15 minutos.`
    : `Tu código para restablecer tu contraseña es: <strong>${codigo}</strong><br>Este código vence en 15 minutos.`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: asunto,
    html: `<div style="font-family:sans-serif;font-size:16px">${mensaje}</div>`
  });
}

function firmarToken(usuario) {
  return jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const data = jwt.verify(token, JWT_SECRET);
    if (data.admin !== true) throw new Error('no admin');
    next();
  } catch {
    return res.status(401).json({ error: 'No autorizado' });
  }
}

// ============================================================
// REGISTRO - Paso 1: pedir codigo
// ============================================================
app.post('/api/signup/request-code', async (req, res) => {
  try {
    const { email, password, confirmPassword } = req.body;
    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existe = await pool.query('SELECT id FROM users WHERE email = $1 AND verified = TRUE', [email]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Ese correo ya tiene una cuenta creada' });
    }

    const codigo = generarCodigo();
    const hash = await bcrypt.hash(password, 10);
    const expira = new Date(Date.now() + 15 * 60 * 1000);

    // borrar codigos anteriores de signup para ese correo
    await pool.query(`DELETE FROM verification_codes WHERE email = $1 AND purpose = 'signup'`, [email]);

    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, password_hash, expires_at)
       VALUES ($1, $2, 'signup', $3, $4)`,
      [email, codigo, hash, expira]
    );

    await enviarCodigo(email, codigo, 'signup');
    res.json({ ok: true, message: 'Código enviado al correo' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// REGISTRO - Paso 2: confirmar codigo y crear cuenta
// ============================================================
app.post('/api/signup/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Faltan datos' });

    const result = await pool.query(
      `SELECT * FROM verification_codes
       WHERE email = $1 AND code = $2 AND purpose = 'signup' AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [email, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Código incorrecto o vencido' });
    }

    const registro = result.rows[0];

    // crear el usuario (o actualizarlo si ya existia sin verificar)
    const existente = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    let usuario;
    if (existente.rows.length > 0) {
      const upd = await pool.query(
        `UPDATE users SET password_hash = $1, verified = TRUE WHERE email = $2 RETURNING *`,
        [registro.password_hash, email]
      );
      usuario = upd.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, verified, balance)
         VALUES ($1, $2, TRUE, 0) RETURNING *`,
        [email, registro.password_hash]
      );
      usuario = ins.rows[0];
    }

    await pool.query('DELETE FROM verification_codes WHERE email = $1 AND purpose = $2', [email, 'signup']);

    const token = firmarToken(usuario);
    res.json({ ok: true, token, balance: usuario.balance, email: usuario.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// LOGIN
// ============================================================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND verified = TRUE', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    const usuario = result.rows[0];
    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
    }

    const token = firmarToken(usuario);
    res.json({ ok: true, token, balance: usuario.balance, email: usuario.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// OLVIDE MI CONTRASEÑA - Paso 1: pedir codigo
// ============================================================
app.post('/api/forgot-password/request-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el correo' });

    const existe = await pool.query('SELECT id FROM users WHERE email = $1 AND verified = TRUE', [email]);
    if (existe.rows.length === 0) {
      // no revelamos si el correo existe o no, por seguridad
      return res.json({ ok: true, message: 'Si el correo existe, se envió un código' });
    }

    const codigo = generarCodigo();
    const expira = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(`DELETE FROM verification_codes WHERE email = $1 AND purpose = 'reset'`, [email]);
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, expires_at)
       VALUES ($1, $2, 'reset', $3)`,
      [email, codigo, expira]
    );

    await enviarCodigo(email, codigo, 'reset');
    res.json({ ok: true, message: 'Si el correo existe, se envió un código' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// OLVIDE MI CONTRASEÑA - Paso 2: verificar codigo y cambiar contraseña
// ============================================================
app.post('/api/forgot-password/reset', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Faltan datos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const result = await pool.query(
      `SELECT * FROM verification_codes
       WHERE email = $1 AND code = $2 AND purpose = 'reset' AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [email, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Código incorrecto o vencido' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
    await pool.query('DELETE FROM verification_codes WHERE email = $1 AND purpose = $2', [email, 'reset']);

    res.json({ ok: true, message: 'Contraseña actualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// SALDO - consultar (usuario logueado)
// ============================================================
app.get('/api/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT email, balance FROM users WHERE id = $1', [req.usuario.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(result.rows[0]);
});

// ============================================================
// SALDO - descontar por una compra (usuario logueado)
// ============================================================
app.post('/api/spend', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const monto = Number(amount);
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const result = await pool.query('SELECT balance FROM users WHERE id = $1', [req.usuario.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const saldoActual = Number(result.rows[0].balance);
    if (saldoActual < monto) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const upd = await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [monto, req.usuario.id]
    );

    res.json({ ok: true, balance: upd.rows[0].balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// ADMIN - login del panel
// ============================================================
app.post('/api/admin/login', (req, res) => {
  const { user, password } = req.body;
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ ok: true, token });
  }
  res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// ============================================================
// ADMIN - buscar usuario por correo
// ============================================================
app.get('/api/admin/user', requireAdmin, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Falta el correo' });
  const result = await pool.query('SELECT id, email, balance, verified, created_at FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(result.rows[0]);
});

// ============================================================
// ADMIN - agregar saldo a un usuario
// ============================================================
app.post('/api/admin/add-balance', requireAdmin, async (req, res) => {
  try {
    const { email, amount } = req.body;
    const monto = Number(amount);
    if (!email || !monto || monto <= 0) return res.status(400).json({ error: 'Datos inválidos' });

    const result = await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE email = $2 RETURNING email, balance',
      [monto, email]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ============================================================
// VERIFICAR ID DE JUGADOR (Free Fire) - via HL Gaming
// ============================================================
async function buscarJugador(uid) {
  const url =
    HLGAMING_API_BASE +
    "?sectionName=AllData" +
    "&PlayerUid=" + uid +
    "&region=" + HLGAMING_REGION +
    "&useruid=" + HLGAMING_USERUID +
    "&api=" + HLGAMING_APIKEY;

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

  const nickname = accountInfo && (accountInfo.AccountName || accountInfo.nickname);
  const regionReal = accountInfo && accountInfo.AccountRegion;

  if (resp.ok && nickname && HLGAMING_REGIONES_PERMITIDAS.includes((regionReal || "").toUpperCase())) {
    return { tipo: "ok", nickname: nickname, region: regionReal };
  }

  return { tipo: "error", status: 400, mensaje: "Región no disponible" };
}

app.get("/api/verificar-id/:uid", async function (req, res) {
  const uid = req.params.uid;

  if (!/^\d+$/.test(uid)) {
    return res.status(400).json({ error: "ID inválido, solo se permiten números." });
  }

  if (!HLGAMING_USERUID || !HLGAMING_APIKEY) {
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

// ---------- Ruta de prueba ----------
app.get('/', (req, res) => {
  res.send('Backend de RIHITO SHOP funcionando correctamente.');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});