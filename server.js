require('dotenv').config(); // Carga .env si estás en local (opcional)
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Detectar si estamos conectando a un host remoto o local
const dbHost = process.env.MYSQLHOST || process.env.DB_HOST || "localhost";
const isLocal = dbHost === "localhost" || dbHost === "127.0.0.1";

// Configuración de conexión (acepta URL completa o variables separadas)
const poolConfig = (process.env.DATABASE_URL || process.env.MYSQL_URL)
  ? {
      uri: process.env.DATABASE_URL || process.env.MYSQL_URL,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    }
  : {
      host: dbHost,
      user: process.env.MYSQLUSER || process.env.DB_USER || "root",
      password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "",
      database: process.env.MYSQLDATABASE || process.env.DB_NAME || "railway",
      port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // La mayoría de MySQL en la nube exigen SSL; en local se desactiva
      ssl: isLocal ? false : { rejectUnauthorized: false }
    };

const conexion = mysql.createPool(poolConfig);

// Verificación de conexión con logs detallados
conexion.getConnection((err, conn) => {
  if (err) {
    console.error("⚠️ Error de conexión a MySQL:");
    console.error(`   -> Host destino: ${dbHost}`);
    console.error(`   -> Código: ${err.code || "N/A"}`);
    console.error(`   -> Mensaje: ${err.message}`);
  } else {
    console.log(`✅ Conectado exitosamente a MySQL en: ${dbHost}`);
    conn.release();
  }
});

app.get("/", (req, res) => {
  res.send("Servidor de Cocina Escolar funcionando correctamente");
});

// --- RUTA: BUSCAR ESTUDIANTE ---
app.get("/estudiantes/buscar/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const query = "SELECT * FROM estudiantes WHERE codigo_barra = ?";

  conexion.query(query, [codigo], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length > 0) {
      res.json({ existe: true, estudiante: results[0] });
    } else {
      res.json({ existe: false });
    }
  });
});

// --- RUTA: REGISTRAR ESTUDIANTE ---
app.post("/estudiantes", (req, res) => {
  const { nombre, carnet, codigo_barra } = req.body;
  const query = "INSERT INTO estudiantes (nombre, carnet, codigo_barra) VALUES (?, ?, ?)";
  conexion.query(query, [nombre, carnet, codigo_barra], (err, result) => {
    if (err) {
      console.error("Error al insertar:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ status: "ok", mensaje: "Registrado con éxito" });
  });
});

// --- RUTA: REGISTRAR RETIRO ---
app.post("/retiro", (req, res) => {
  const { estudiante_id, utensilio_id } = req.body;

  conexion.query("SELECT id FROM estudiantes WHERE codigo_barra = ?", [estudiante_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length > 0) {
      const realId = results[0].id;
      const sqlInsert = `
        INSERT INTO movimientos (estudiante_id, utensilio_id, fecha_retiro) 
        VALUES (?, (SELECT id FROM utensilios WHERE tipo = ? LIMIT 1), NOW())
      `;
      conexion.query(sqlInsert, [realId, utensilio_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "ok" });
      });
    } else {
      res.status(404).json({ status: "error", mensaje: "Estudiante no encontrado" });
    }
  });
});

// --- RUTA: REGISTRAR DEVOLUCIÓN ---
app.put("/devolucion/:id", (req, res) => {
  const sql = "UPDATE movimientos SET fecha_devolucion = NOW() WHERE id = ?";
  conexion.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.message });
    res.json({ status: "ok", mensaje: "Devolución registrada" });
  });
});

// --- RUTA: INFORME DIARIO ---
app.get("/informe", (req, res) => {
  const sql = `
    SELECT u.tipo, COUNT(*) AS entregados
    FROM movimientos m
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE DATE(m.fecha_retiro) = CURDATE()
    GROUP BY u.tipo;
  `;
  conexion.query(sql, (err, resultados) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.message });
    res.json(resultados);
  });
});

// --- RUTA: PENDIENTES ---
app.get("/pendientes/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const sql = `
    SELECT m.id, u.tipo, m.fecha_retiro
    FROM movimientos m
    JOIN estudiantes e ON m.estudiante_id = e.id
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE e.codigo_barra = ? AND m.fecha_devolucion IS NULL;
  `;
  conexion.query(sql, [codigo], (err, resultados) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.message });
    res.json(resultados);
  });
});

// --- RUTA: INFORME HISTÓRICO POR FECHA ---
app.get("/informe/:fecha", (req, res) => {
  const fecha = req.params.fecha;
  const sql = `
    SELECT u.tipo, COUNT(*) AS entregados
    FROM movimientos m
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE DATE(m.fecha_retiro) = ?
    GROUP BY u.tipo;
  `;
  conexion.query(sql, [fecha], (err, resultados) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.message });
    res.json(resultados);
  });
});

// --- RUTA: LISTAR UTENSILIOS ---
app.get("/utensilios", (req, res) => {
  conexion.query("SELECT id, tipo, cantidad FROM utensilios ORDER BY tipo", (err, resultados) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.message });
    res.json(resultados);
  });
});

// --- RUTA: AGREGAR UTENSILIO ---
app.post("/utensilios", (req, res) => {
  const { tipo, cantidad } = req.body;
  const sql = "INSERT INTO utensilios (tipo, cantidad) VALUES (?, ?)";
  conexion.query(sql, [tipo, cantidad], (err, resultado) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.sqlMessage || err.message });
    res.json({ status: "ok", mensaje: "Utensilio agregado" });
  });
});

// --- RUTA: EDITAR UTENSILIO ---
app.put("/utensilios/:id", (req, res) => {
  const { tipo, cantidad } = req.body;
  const id = req.params.id;
  const sql = "UPDATE utensilios SET tipo=?, cantidad=? WHERE id=?";
  conexion.query(sql, [tipo, cantidad, id], (err, resultado) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.sqlMessage || err.message });
    res.json({ status: "ok", mensaje: "Utensilio actualizado" });
  });
});

// --- RUTA: ELIMINAR UTENSILIO ---
app.delete("/utensilios/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM utensilios WHERE id=?";
  conexion.query(sql, [id], (err, resultado) => {
    if (err) return res.status(500).json({ status: "error", mensaje: err.sqlMessage || err.message });
    res.json({ status: "ok", mensaje: "Utensilio eliminado" });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
