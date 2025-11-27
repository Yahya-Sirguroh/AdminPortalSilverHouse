// server.js (refactored to use FTP for logs + MachineIds with caching & local+FTP sync)
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import csvParser from "csv-parser";
import { Readable } from "stream";
import FTPHelper from "./ftpHelper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // parse JSON bodies
app.use(express.static(__dirname));

app.use(
  session({
    secret: "csv_viewer_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// --------------------------------------------------
// Configuration
// --------------------------------------------------
const FTP_LOGS_FOLDER = "/Logs";
const MACHINE_IDS_REMOTE = "/MachineIds.txt";
const LOCAL_MACHINE_FILE = path.join(__dirname, "machine-ids.txt");

// Cache settings
const LOG_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// In-memory caches
let logCache = {
  key: null,       // e.g. "2025-11"
  csvText: null,   // raw CSV text
  timestamp: 0
};

let machineIdsCache = {
  ids: [],         // array of strings
  timestamp: 0,
  ttl: 60 * 1000   // refresh from FTP every 60s (but we also keep local file)
};

// Ensure local machine file exists (local+FTP sync mode)
if (!fs.existsSync(LOCAL_MACHINE_FILE)) {
  try { fs.writeFileSync(LOCAL_MACHINE_FILE, "", "utf8"); } catch (e) {}
}

// Helper: load machine IDs into memory from local file (fast)
function loadMachineIdsFromLocal() {
  try {
    const data = fs.readFileSync(LOCAL_MACHINE_FILE, "utf8").trim();
    machineIdsCache.ids = data ? data.split("\n").map(s => s.trim()).filter(Boolean) : [];
    machineIdsCache.timestamp = Date.now();
    return machineIdsCache.ids;
  } catch (err) {
    machineIdsCache.ids = [];
    return [];
  }
}

// Helper: attempt to refresh local machine file from FTP at startup
async function trySyncMachineIdsFromFTP() {
  try {
    const content = await FTPHelper.readFile(MACHINE_IDS_REMOTE);
    if (content !== null) {
      // Overwrite local copy with FTP content (fast local writes)
      fs.writeFileSync(LOCAL_MACHINE_FILE, content, "utf8");
      loadMachineIdsFromLocal();
      console.log("✔ MachineIds synced from FTP -> local");
      return true;
    } else {
      // no remote file, keep local version
      loadMachineIdsFromLocal();
      console.log("ℹ No MachineIds.txt found on FTP, using local file");
      return false;
    }
  } catch (err) {
    loadMachineIdsFromLocal();
    console.warn("⚠ Could not sync MachineIds from FTP, using local file");
    return false;
  }
}

// Kick off one-time sync at startup (non-blocking)
trySyncMachineIdsFromFTP();

// Helper: ensure machineIdsCache is reasonably fresh (reads local, refreshes from FTP periodically)
async function getMachineIds() {
  const now = Date.now();
  // If cache is fresh (under TTL), use it
  if (machineIdsCache.ids && (now - machineIdsCache.timestamp) < machineIdsCache.ttl) {
    return machineIdsCache.ids;
  }

  // Otherwise, read local file first (fast)
  const local = loadMachineIdsFromLocal();
  machineIdsCache.timestamp = Date.now();

  // Launch background FTP refresh but don't block with it (improves speed for UI)
  (async () => {
    try {
      const remoteContent = await FTPHelper.readFile(MACHINE_IDS_REMOTE);
      if (remoteContent !== null) {
        fs.writeFileSync(LOCAL_MACHINE_FILE, remoteContent, "utf8");
        loadMachineIdsFromLocal();
        machineIdsCache.timestamp = Date.now();
        // console.log("MachineIds refreshed from FTP in background");
      }
    } catch (err) {
      // silent
    }
  })();

  return local;
}

// Helper: when admin updates machine ids, write local immediately and update FTP in background
async function writeMachineIds(newIdsArray) {
  const content = newIdsArray.join("\n");
  // 1) write local synchronously (so UI sees update immediately)
  fs.writeFileSync(LOCAL_MACHINE_FILE, content, "utf8");
  // 2) update in-memory cache
  machineIdsCache.ids = newIdsArray.slice();
  machineIdsCache.timestamp = Date.now();

  // 3) try to write to FTP in background (do not block request)
  (async () => {
    const ok = await FTPHelper.writeFile(MACHINE_IDS_REMOTE, content);
    if (ok) {
      // console.log("MachineIds uploaded to FTP");
    } else {
      console.warn("⚠ Failed to upload MachineIds to FTP (will keep local copy)");
    }
  })();

  return true;
}

// --------------------------------------------------
// Routes: Login + Dashboard pages (unchanged)
// --------------------------------------------------
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "admin123") {
    req.session.authenticated = true;
    res.redirect("/dashboard");
  } else {
    res.send(`<h3>❌ Invalid credentials.</h3><a href="/login">🔁 Try again</a>`);
  }
});

app.get("/dashboard", (req, res) => {
  if (!req.session.authenticated) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// --------------------------------------------------
// Helper: Fetch CSV text from FTP with cache
// --------------------------------------------------
async function fetchCsvTextFromFTPWithCache(year, month) {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const now = Date.now();

  // return cached if same file and not expired
  if (logCache.key === key && (now - logCache.timestamp) < LOG_CACHE_TTL_MS && logCache.csvText) {
    return logCache.csvText;
  }

  // read from FTP
  const remotePath = `${FTP_LOGS_FOLDER}/login_log_${key}.csv`;
  const text = await FTPHelper.readFile(remotePath);

  if (text !== null) {
    logCache.key = key;
    logCache.csvText = text;
    logCache.timestamp = Date.now();
    return text;
  }

  // if not found on FTP, return null
  return null;
}

// Utility: parse CSV text -> array of objects using Readable stream (no temp files)
function parseCsvTextToRows(csvText) {
  return new Promise((resolve, reject) => {
    const rows = [];
    if (!csvText || !csvText.trim()) return resolve([]);
    const stream = new Readable();
    stream.push(csvText);
    stream.push(null);
    stream
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", (err) => reject(err));
  });
}

// API route to fetch CSV data (current or selected month) — optimized with cache
app.get("/api/logs", async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { year, month } = req.query;
  const now = new Date();
  const selectedYear = year || now.getFullYear().toString();
  const selectedMonth = month ? String(month).padStart(2, "0") : String(now.getMonth() + 1).padStart(2, "0");

  try {
    const csvText = await fetchCsvTextFromFTPWithCache(selectedYear, selectedMonth);

    if (!csvText) {
      // empty result (no file on FTP)
      return res.json([]);
    }

    const rows = await parseCsvTextToRows(csvText);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching/parsing CSV:", err);
    return res.status(500).json({ error: "Error reading CSV file" });
  }
});

// API route to download CSV as Excel (reads from cache if available)
app.get("/api/download", async (req, res) => {
  if (!req.session.authenticated) return res.status(401).send("Unauthorized");

  const { year, month } = req.query;
  const selectedYear = year || new Date().getFullYear();
  const selectedMonth = month || String(new Date().getMonth() + 1).padStart(2, "0");

  try {
    const csvText = await fetchCsvTextFromFTPWithCache(selectedYear, selectedMonth);
    if (!csvText) return res.status(404).send("CSV file not found.");

    const rows = await parseCsvTextToRows(csvText);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Logs");

    if (rows.length > 0) {
      sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
      rows.forEach((r) => sheet.addRow(r));
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=login_log_${selectedYear}-${selectedMonth}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Error generating Excel file.");
  }
});

// --------------------------------------------------
// Machine IDs endpoints (local + FTP sync)
// --------------------------------------------------

// GET all machines
app.get("/api/machines", async (req, res) => {
  try {
    const ids = await getMachineIds();
    res.json(ids);
  } catch (err) {
    console.error("Get machines error:", err);
    res.status(500).json([]);
  }
});

// ADD new machine ID
app.post("/api/machines", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing ID" });

    const ids = await getMachineIds();
    if (ids.includes(id)) return res.status(400).json({ error: "ID already exists" });

    ids.push(id);
    await writeMachineIds(ids);
    res.json({ success: true });
  } catch (err) {
    console.error("Add machine error:", err);
    res.status(500).json({ error: "Failed to add ID" });
  }
});

// EDIT machine ID
app.post("/api/machines/edit", async (req, res) => {
  try {
    const { oldID, newID } = req.body;
    if (!oldID || !newID) return res.status(400).json({ error: "Missing parameters" });

    let ids = await getMachineIds();
    const idx = ids.indexOf(oldID);
    if (idx === -1) return res.status(404).json({ error: "ID not found" });

    if (ids.includes(newID) && newID !== oldID) return res.status(400).json({ error: "New ID already exists" });

    ids[idx] = newID;
    await writeMachineIds(ids);
    res.json({ success: true });
  } catch (err) {
    console.error("Edit machine error:", err);
    res.status(500).json({ error: "Failed to edit ID" });
  }
});

// DELETE machine ID
app.post("/api/machines/delete", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing ID" });

    let ids = await getMachineIds();
    ids = ids.filter((x) => x !== id);
    await writeMachineIds(ids);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete machine error:", err);
    res.status(500).json({ error: "Failed to delete ID" });
  }
});

// Logout & root redirect
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});
app.get("/", (req, res) => res.redirect("/login"));

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SilverHouse CSV Viewer running at: http://localhost:${PORT}`);
});
