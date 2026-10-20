// Instalación (en la carpeta del proyecto):
//   npm init -y
//   npm install express mysql2 cors dotenv
// Ejecución:
//   node server.js

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Puerto: usa el de la nube (Render lo inyecta automáticamente) o 3000 en local
const PORT = process.env.PORT || 3000;

// Conexión a MySQL / TiDB Cloud:
// Usamos createPool para evitar caídas por inactividad (típico en TiDB Serverless).
// Si DB_HOST está presente (estamos en Render/TiDB), se activa SSL automáticamente.
// Si no existe (desarrollo local con XAMPP), conecta a localhost sin SSL.
const conexion = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 4000, // TiDB Cloud usa el puerto 4000 por defecto
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "pase_in",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_HOST ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : false,
});

// Verificación inicial de conexión
conexion.getConnection((error, conn) => {
  if (error) {
    console.error("⚠️ Error al conectar con la base de datos:");
    console.error(`   -> Host: ${process.env.DB_HOST || "localhost"}`);
    console.error(`   -> Mensaje: ${error.message}`);
    return;
  }
  console.log(`✅ Conectado exitosamente a la base de datos en: ${process.env.DB_HOST || "localhost"}`);
  conn.release();
});

// Ruta base de prueba
app.get("/", (req, res) => {
  res.send("Servidor de Cocina Escolar funcionando correctamente");
});

// ---------------- GESTIÓN DE ESTUDIANTES ----------------

// Buscar estudiante por su código de barras
app.get("/estudiantes/buscar/:codigo", (req, res) => {
  const { codigo } = req.params;
  const sql = "SELECT * FROM estudiantes WHERE codigo_barra = ?";

  conexion.query(sql, [codigo], (error, results) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }

    if (results.length > 0) {
      res.json({ existe: true, estudiante: results[0] });
    } else {
      res.json({ existe: false });
    }
  });
});

// Registrar un nuevo estudiante
app.post("/estudiantes", (req, res) => {
  const { nombre, carnet, codigo_barra } = req.body;

  if (!nombre || !codigo_barra) {
    return res.status(400).json({ mensaje: "El nombre y el código de barras son obligatorios" });
  }

  const sql = "INSERT INTO estudiantes (nombre, carnet, codigo_barra) VALUES (?, ?, ?)";

  conexion.query(sql, [nombre, carnet || null, codigo_barra], (error) => {
    if (error) {
      console.error("Error al registrar estudiante:", error);
      return res.status(500).json({ error: error.message });
    }
    res.json({ status: "ok", mensaje: "Estudiante registrado con éxito" });
  });
});

// ---------------- MOVIMIENTOS (RETIROS Y DEVOLUCIONES) ----------------

// Registrar retiro de utensilio
app.post("/retiro", (req, res) => {
  const { estudiante_id, utensilio_id } = req.body; // estudiante_id es el código de barras

  if (!estudiante_id || !utensilio_id) {
    return res.status(400).json({ mensaje: "Código de estudiante y utensilio son requeridos" });
  }

  const sqlBuscar = "SELECT id FROM estudiantes WHERE codigo_barra = ?";
  conexion.query(sqlBuscar, [estudiante_id], (error, results) => {
    if (error) return res.status(500).json({ error: error.message });

    if (results.length === 0) {
      return res.status(404).json({ status: "error", mensaje: "Estudiante no encontrado" });
    }

    const realId = results[0].id;
    const sqlInsert = `
      INSERT INTO movimientos (estudiante_id, utensilio_id, fecha_retiro) 
      VALUES (?, (SELECT id FROM utensilios WHERE tipo = ? LIMIT 1), NOW())
    `;

    conexion.query(sqlInsert, [realId, utensilio_id], (errInsert) => {
      if (errInsert) return res.status(500).json({ error: errInsert.message });
      res.json({ status: "ok", mensaje: "Retiro registrado correctamente" });
    });
  });
});

// Registrar devolución por ID de movimiento
app.put("/devolucion/:id", (req, res) => {
  const { id } = req.params;
  const sql = "UPDATE movimientos SET fecha_devolucion = NOW() WHERE id = ?";

  conexion.query(sql, [id], (error) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.message });
    res.json({ status: "ok", mensaje: "Devolución registrada" });
  });
});

// Listar retiros pendientes por código de barras
app.get("/pendientes/:codigo", (req, res) => {
  const { codigo } = req.params;
  const sql = `
    SELECT m.id, u.tipo, m.fecha_retiro
    FROM movimientos m
    JOIN estudiantes e ON m.estudiante_id = e.id
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE e.codigo_barra = ? AND m.fecha_devolucion IS NULL
  `;

  conexion.query(sql, [codigo], (error, resultados) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.message });
    res.json(resultados);
  });
});

// ---------------- INFORMES ----------------

// Informe diario de entregas
app.get("/informe", (req, res) => {
  const sql = `
    SELECT u.tipo, COUNT(*) AS entregados
    FROM movimientos m
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE DATE(m.fecha_retiro) = CURDATE()
    GROUP BY u.tipo
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.message });
    res.json(resultados);
  });
});

// Informe histórico por fecha específica (YYYY-MM-DD)
app.get("/informe/:fecha", (req, res) => {
  const { fecha } = req.params;
  const sql = `
    SELECT u.tipo, COUNT(*) AS entregados
    FROM movimientos m
    JOIN utensilios u ON m.utensilio_id = u.id
    WHERE DATE(m.fecha_retiro) = ?
    GROUP BY u.tipo
  `;

  conexion.query(sql, [fecha], (error, resultados) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.message });
    res.json(resultados);
  });
});

// ---------------- CATÁLOGO DE UTENSILIOS ----------------

// Listar inventario de utensilios
app.get("/utensilios", (req, res) => {
  const sql = "SELECT id, tipo, cantidad FROM utensilios ORDER BY tipo";

  conexion.query(sql, (error, resultados) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.message });
    res.json(resultados);
  });
});

// Agregar nuevo tipo de utensilio
app.post("/utensilios", (req, res) => {
  const { tipo, cantidad } = req.body;
  const sql = "INSERT INTO utensilios (tipo, cantidad) VALUES (?, ?)";

  conexion.query(sql, [tipo, cantidad], (error) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.sqlMessage || error.message });
    res.json({ status: "ok", mensaje: "Utensilio agregado" });
  });
});

// Editar utensilio existente
app.put("/utensilios/:id", (req, res) => {
  const { id } = req.params;
  const { tipo, cantidad } = req.body;
  const sql = "UPDATE utensilios SET tipo = ?, cantidad = ? WHERE id = ?";

  conexion.query(sql, [tipo, cantidad, id], (error) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.sqlMessage || error.message });
    res.json({ status: "ok", mensaje: "Utensilio actualizado" });
  });
});

// Eliminar utensilio
app.delete("/utensilios/:id", (req, res) => {
  const { id } = req.params;
  const sql = "DELETE FROM utensilios WHERE id = ?";

  conexion.query(sql, [id], (error) => {
    if (error) return res.status(500).json({ status: "error", mensaje: error.sqlMessage || error.message });
    res.json({ status: "ok", mensaje: "Utensilio eliminado" });
  });
});

// "0.0.0.0" permite conexiones en red local (pruebas) y en la nube (Render)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
