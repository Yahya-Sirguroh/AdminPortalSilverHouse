import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import csvParser from "csv-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // <--- IMPORTANT: parse JSON bodies
app.use(express.static(__dirname));

app.use(
  session({
    secret: "csv_viewer_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// Login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Handle login
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "admin123") {
    req.session.authenticated = true;
    res.redirect("/dashboard");
  } else {
    res.send(`
      <h3>❌ Invalid credentials.</h3>
      <a href="/login">🔁 Try again</a>
    `);
  }
});

// Protected Dashboard page
app.get("/dashboard", (req, res) => {
  if (!req.session.authenticated) {
    return res.redirect("/login");
  }
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// API route to fetch CSV data (current or selected month)
app.get("/api/logs", (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { year, month } = req.query;
  const now = new Date();
  const selectedYear = year || now.getFullYear().toString();
  const selectedMonth = month
    ? String(month).padStart(2, "0")
    : String(now.getMonth() + 1).padStart(2, "0");

  const csvFilePath = path.join(
    "D:",
    "Freelance",
    "SilverHouseLoginPg",
    "logs",
    `login_log_${selectedYear}-${selectedMonth}.csv`
  );

  console.log("📂 Loading file:", csvFilePath);

  if (!fs.existsSync(csvFilePath)) {
    console.warn("⚠️ CSV file not found for this month:", csvFilePath);
    return res.json([]); // no data
  }

  const results = [];
  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      console.log(`✅ Loaded ${results.length} records`);
      res.json(results);
    })
    .on("error", (err) => {
      console.error("❌ CSV read error:", err);
      res.status(500).json({ error: "Error reading CSV file" });
    });
});

// API route to download CSV (keeps same behavior; can be updated later)
app.get("/api/download", async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).send("Unauthorized");
  }

  const { year, month } = req.query;
  const selectedYear = year || new Date().getFullYear();
  const selectedMonth =
    month || String(new Date().getMonth() + 1).padStart(2, "0");

  const csvFilePath = path.join(
    "D:",
    "Freelance",
    "SilverHouseLoginPg",
    "logs",
    `login_log_${selectedYear}-${selectedMonth}.csv`
  );

  if (!fs.existsSync(csvFilePath)) {
    return res.status(404).send("CSV file not found.");
  }

  try {
    // Read CSV → JSON
    const rows = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Logs");

    if (rows.length > 0) {
      // Add header
      sheet.columns = Object.keys(rows[0]).map((key) => ({
        header: key,
        key: key,
        width: 20,
      }));

      // Add data rows
      rows.forEach((r) => sheet.addRow(r));
    }

    // Excel Download Headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=login_log_${selectedYear}-${selectedMonth}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Error generating Excel file.");
  }
});


// Logout & root redirect
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});
app.get("/", (req, res) => res.redirect("/login"));

// Machine IDs storage file
const machineFile = path.join(__dirname, "machine-ids.txt");
if (!fs.existsSync(machineFile)) fs.writeFileSync(machineFile, "");

// GET all machines
app.get("/api/machines", (req, res) => {
  try {
    const data = fs.readFileSync(machineFile, "utf-8").trim();
    const ids = data ? data.split("\n").filter(Boolean) : [];
    res.json(ids);
  } catch (err) {
    console.error("Read machine file error:", err);
    res.status(500).json([]);
  }
});

// ADD new machine ID
app.post("/api/machines", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing ID" });

  const data = fs.readFileSync(machineFile, "utf-8").trim();
  const ids = data ? data.split("\n").filter(Boolean) : [];

  if (ids.includes(id)) return res.status(400).json({ error: "ID already exists" });

  ids.push(id);
  fs.writeFileSync(machineFile, ids.join("\n"));
  res.json({ success: true });
});

// EDIT machine ID
app.post("/api/machines/edit", (req, res) => {
  const { oldID, newID } = req.body;
  if (!oldID || !newID) return res.status(400).json({ error: "Missing parameters" });

  const data = fs.readFileSync(machineFile, "utf-8").trim();
  let ids = data ? data.split("\n").filter(Boolean) : [];
  const idx = ids.indexOf(oldID);
  if (idx === -1) return res.status(404).json({ error: "ID not found" });

  // avoid duplicate
  if (ids.includes(newID) && newID !== oldID) return res.status(400).json({ error: "New ID already exists" });

  ids[idx] = newID;
  fs.writeFileSync(machineFile, ids.join("\n"));
  res.json({ success: true });
});

// DELETE machine ID
app.post("/api/machines/delete", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing ID" });

  const data = fs.readFileSync(machineFile, "utf-8").trim();
  let ids = data ? data.split("\n").filter(Boolean) : [];
  ids = ids.filter((x) => x !== id);
  fs.writeFileSync(machineFile, ids.join("\n"));
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SilverHouse CSV Viewer running at: http://localhost:${PORT}`);
});
