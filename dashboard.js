let allData = [];
let filteredData = [];
let columns = { user: "", date: "", location: "" };

// Pagination settings
let currentPage = 1;
let rowsPerPage = 10;

/* ---------------------- SIMPLE LOADING SCREEN WITH SPINNER ---------------------- */
// <<< UPDATED WITH SPINNER >>>
function showLoader() {
  let l = document.getElementById("loaderOverlay");

  if (!l) {
    l = document.createElement("div");
    l.id = "loaderOverlay";
    l.style.position = "fixed";
    l.style.top = 0;
    l.style.left = 0;
    l.style.width = "100%";
    l.style.height = "100%";
    l.style.background = "rgba(0,0,0,0.5)";
    l.style.display = "flex";
    l.style.alignItems = "center";
    l.style.justifyContent = "center";
    l.style.zIndex = "9999";

    l.innerHTML = `
      <div style="
        display:flex;
        flex-direction:column;
        align-items:center;
        padding:25px;
        background:#1e293b;
        color:white;
        font-size:18px;
        border-radius:12px;
        box-shadow:0 0 15px rgba(0,0,0,0.3);
      ">
        <div class="spinner" style="
          width:40px;
          height:40px;
          border:4px solid #4b5563;
          border-top-color:#38bdf8;
          border-radius:50%;
          animation:spin 0.8s linear infinite;
          margin-bottom:10px;
        "></div>
        Loading logs...
      </div>
    `;

    // Add CSS animation for spinner
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(l);
  }

  l.style.display = "flex";
}

function hideLoader() {
  const l = document.getElementById("loaderOverlay");
  if (l) l.style.display = "none";
}

/* ---------------------- Logs loading/pagination/filtering ---------------------- */

// Fetch logs from server by selected month and year
async function loadLogs(year, month) {

  showLoader(); // <<< ADDED FOR LOADING >>>

  try {
    const res = await fetch(`/api/logs?year=${year}&month=${month}`);
    const data = await res.json();

    allData = Array.isArray(data) ? data : [];
    filteredData = [...allData];
    detectColumns(allData);
    populateFilters(allData);
    currentPage = 1;
    renderTable();
  } catch (err) {
    console.error(err);
    document.getElementById("tableBody").innerHTML =
      "<tr><td colspan='5'>⚠️ Error loading CSV data.</td></tr>";
  }

  hideLoader(); // <<< ADDED FOR LOADING >>>
}

/* 🔍 Detect column names dynamically */
function detectColumns(data) {
  if (!data || !data.length) {
    columns = { user: "", date: "", location: "" };
    return;
  }
  const keys = Object.keys(data[0]).map((k) => k.toLowerCase());
  columns.user = keys.find((k) => k.includes("user") || k.includes("name")) || keys[0];
  columns.date = keys.find((k) => k.includes("date") || k.includes("time")) || keys[1];
  columns.location = keys.find((k) => k.includes("loc")) || "";
}

/* 🧩 Populate dropdown filters */
function populateFilters(data) {
  const users = [...new Set(data.map((r) => r[findKey(r, columns.user)]))].filter(Boolean);
  const dates = [
    ...new Set(
      data
        .map((r) => {
          const rawDate = r[findKey(r, columns.date)];
          if (!rawDate) return null;
          const d = String(rawDate).split(" ")[0];
          return d.includes("/") || d.includes("-") ? d : null;
        })
        .filter(Boolean)
    ),
  ];
  const locations = columns.location
    ? [...new Set(data.map((r) => r[findKey(r, columns.location)]))].filter(Boolean)
    : [];

  populateSelect("filterUser", users);
  populateSelect("filterDate", dates);
  populateSelect("filterLocation", locations);
}

function populateSelect(id, values) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = `<option value="">Filter by ${id.replace("filter", "")}</option>`;
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

function findKey(obj, match) {
  if (!obj) return undefined;
  return Object.keys(obj).find((k) => k.toLowerCase() === match);
}

/* 🪄 Render table with pagination */
function renderTable() {
  const tableHead = document.getElementById("tableHead");
  const tableBody = document.getElementById("tableBody");
  const tableFooter = document.getElementById("pagination");

  if (filteredData.length > 0) {
    const headers = Object.keys(filteredData[0]);
    tableHead.innerHTML = `<tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>`;

    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageData = filteredData.slice(start, end);

    tableBody.innerHTML = pageData
      .map(
        (row) =>
          `<tr>${headers.map((h) => `<td>${row[h] ?? ""}</td>`).join("")}</tr>`
      )
      .join("");

    renderPagination();
  } else {
    tableHead.innerHTML = "";
    tableBody.innerHTML = "<tr><td colspan='5'>No results found.</td></tr>";
    if (tableFooter) tableFooter.innerHTML = "";
  }
}

/* 📄 Pagination controls */
function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));
  const pagination = document.getElementById("pagination");

  if (!pagination || totalPages <= 1) {
    if (pagination) pagination.innerHTML = "";
    return;
  }

  pagination.innerHTML = `
    <button ${currentPage === 1 ? "disabled" : ""} onclick="goToPage(1)">⏮ First</button>
    <button ${currentPage === 1 ? "disabled" : ""} onclick="goToPage(${currentPage - 1})">◀ Prev</button>
    <span>Page ${currentPage} of ${totalPages}</span>
    <button ${currentPage === totalPages ? "disabled" : ""} onclick="goToPage(${currentPage + 1})">Next ▶</button>
    <button ${currentPage === totalPages ? "disabled" : ""} onclick="goToPage(${totalPages})">Last ⏭</button>
    <select id="rowsPerPage" onchange="changeRowsPerPage(this.value)">
      <option value="10" ${rowsPerPage == 10 ? "selected" : ""}>10</option>
      <option value="25" ${rowsPerPage == 25 ? "selected" : ""}>25</option>
      <option value="50" ${rowsPerPage == 50 ? "selected" : ""}>50</option>
    </select>
  `;
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderTable();
}

function changeRowsPerPage(value) {
  rowsPerPage = parseInt(value, 10);
  currentPage = 1;
  renderTable();
}

/* 🧭 Apply filters & search */
function applyFilters() {
  const search = (document.getElementById("search")?.value || "").toLowerCase();
  const user = document.getElementById("filterUser")?.value || "";
  const date = document.getElementById("filterDate")?.value || "";
  const location = document.getElementById("filterLocation")?.value || "";

  filteredData = allData.filter((row) => {
    const keys = Object.keys(row);
    const matchSearch = keys.some((k) =>
      String(row[k]).toLowerCase().includes(search)
    );

    const matchUser = !user || String(row[findKey(row, columns.user)]) === user;

    const rawDate = row[findKey(row, columns.date)];
    const onlyDate = rawDate ? String(rawDate).split(" ")[0] : "";
    const matchDate = !date || onlyDate === date;

    const matchLoc =
      !location || String(row[findKey(row, columns.location)]) === location;

    return matchSearch && matchUser && matchDate && matchLoc;
  });

  currentPage = 1;
  renderTable();
}

/* ---------------------- Event listeners for filters ---------------------- */
document.getElementById("search")?.addEventListener("input", applyFilters);
document.getElementById("filterUser")?.addEventListener("change", applyFilters);
document.getElementById("filterDate")?.addEventListener("change", applyFilters);
document.getElementById("filterLocation")?.addEventListener("change", applyFilters);
document.getElementById("logout")?.addEventListener("click", () => {
  window.location.href = "/logout";
});

/* 📅 Month-Year filter logic */
const monthPicker = document.getElementById("filterMonth");
const currentDate = new Date();
if (monthPicker) {
  monthPicker.value = `${currentDate.getFullYear()}-${String(
    currentDate.getMonth() + 1
  ).padStart(2, "0")}`;
  monthPicker.addEventListener("change", (e) => {
    const [year, month] = e.target.value.split("-");
    loadLogs(year, month);
  });
}

/* 🔄 Initial load (current month) */
loadLogs(
  currentDate.getFullYear(),
  String(currentDate.getMonth() + 1).padStart(2, "0")
);

/* ---------------------- Machine ID Manager ---------------------- */

// (UNCHANGED BELOW THIS POINT)

/* ---------------------- Machine ID Manager ---------------------- */

// Elements
const modal = document.getElementById("machineModal");
const openBtn = document.getElementById("manageMachineIDBtn");
const closeBtn = document.getElementById("closeModal");
const saveBtn = document.getElementById("saveMachineBtn");
const machineInput = document.getElementById("machineInput");
const searchInput = document.getElementById("machineSearch");
const machineList = document.getElementById("machineList");

let machineIDs = [];
let editingID = null;

// Open popup
openBtn?.addEventListener("click", async () => {
  if (!modal) return;
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  await loadMachineIDs();
});

// Close popup
closeBtn?.addEventListener("click", () => {
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  editingID = null;
  machineInput.value = "";
  saveBtn.textContent = "Add";
});

// Load Machine IDs from server
async function loadMachineIDs() {
  try {
    const res = await fetch("/api/machines");
    const ids = await res.json();
    machineIDs = Array.isArray(ids) ? ids : [];
    renderMachineList(machineIDs);
  } catch (err) {
    console.error("Failed to load machine IDs:", err);
    machineList.innerHTML = "<li>Error loading machine IDs</li>";
  }
}

// Render Machine ID List (uses ID values, not array index)
function renderMachineList(list) {
  machineList.innerHTML = "";

  if (!list || list.length === 0) {
    machineList.innerHTML = "<li>No Machine IDs saved.</li>";
    return;
  }

  list.forEach((id) => {
    const li = document.createElement("li");
    li.className = "machine-list-item";

    // const left = document.createElement("span");
    // left.textContent = id;

    const left = document.createElement("span");
    left.className = "machine-text";
    left.textContent = id;
    left.title = id;   // tooltip when hovering

    const actions = document.createElement("div");
    actions.className = "machine-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditID(id));

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteMachineID(id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(actions);
    machineList.appendChild(li);
  });
}

// Search Machine IDs (client-side)
searchInput?.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  const filtered = machineIDs.filter((m) => m.toLowerCase().includes(term));
  renderMachineList(filtered);
});

// Add or Save Edit Machine ID
saveBtn?.addEventListener("click", async () => {
  const id = (machineInput.value || "").trim();
  if (!id) return alert("Enter Machine ID!");

  try {
    if (editingID) {
      // Edit flow
      const res = await fetch("/api/machines/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldID: editingID, newID: id })
      });
      const j = await res.json();
      if (j.error) return alert(j.error);
      editingID = null;
      saveBtn.textContent = "Add";
    } else {
      // Add flow - avoid duplicate on client
      if (machineIDs.includes(id)) {
        alert("Machine ID already exists.");
      } else {
        const res = await fetch("/api/machines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        });
        const j = await res.json();
        if (j.error) return alert(j.error);
      }
    }

    machineInput.value = "";
    await loadMachineIDs();
  } catch (err) {
    console.error("Save machine id failed:", err);
    alert("Failed to save. See console.");
  }
});

// Start edit flow
function startEditID(id) {
  editingID = id;
  machineInput.value = id;
  saveBtn.textContent = "Save Edit";
}

// Delete by ID
async function deleteMachineID(id) {
  if (!confirm(`Delete Machine ID: ${id}?`)) return;
  try {
    const res = await fetch("/api/machines/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const j = await res.json();
    if (j.error) return alert(j.error);
    await loadMachineIDs();
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Failed to delete. See console.");
  }
}

document.getElementById("download")?.addEventListener("click", () => {
  const monthPicker = document.getElementById("filterMonth").value;

  if (!monthPicker) {
    alert("Please select a month first.");
    return;
  }

  const [year, month] = monthPicker.split("-");

  // Download Excel (.xlsx)
  window.location.href = `/api/download?year=${year}&month=${month}`;
});

