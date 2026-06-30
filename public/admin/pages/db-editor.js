/**
 * Database Editor Page
 * Premium SQLite direct table viewer and inline editor
 */

let dbCurrentTable = ''
let dbTablesList = []
let dbColumns = []
let dbRows = []
let dbTotalRows = 0
const dbLimit = 25
let dbOffset = 0

async function initDbEditor() {
  dbCurrentTable = ''
  dbColumns = []
  dbRows = []
  dbTotalRows = 0
  dbOffset = 0

  await loadDbTables()
  setupDbEditorControls()
}

async function loadDbTables() {
  try {
    const res = await window.apiClient.get('/api/v2/db/tables')
    if (res && res.tables) {
      dbTablesList = res.tables
      renderTablesDropdown()
    }
  } catch (e) {
    window.showToast('Failed to load database tables: ' + e.message, 'error')
  }
}

function renderTablesDropdown() {
  const select = document.getElementById('db-table-select')
  if (!select) return

  select.innerHTML =
    '<option value="" disabled selected>Select a table...</option>' +
    dbTablesList
      .map((t) => `<option value="${window.esc(t)}">${window.esc(t).toUpperCase()}</option>`)
      .join('')
}

function setupDbEditorControls() {
  const select = document.getElementById('db-table-select')
  if (select) {
    select.onchange = (e) => {
      dbCurrentTable = e.target.value
      dbOffset = 0
      loadTableData()
    }
  }

  const searchInput = document.getElementById('db-search-input')
  if (searchInput) {
    searchInput.oninput = (e) => {
      const term = e.target.value.toLowerCase().trim()
      filterDbRows(term)
    }
  }
}

async function loadTableData() {
  if (!dbCurrentTable) return

  const tbody = document.getElementById('db-table-body')
  const thead = document.getElementById('db-table-headers')
  if (!tbody || !thead) return

  tbody.innerHTML =
    '<tr><td colspan="10" style="text-align:center;color:#64748b;padding:2rem;">Loading table records...</td></tr>'
  thead.innerHTML = ''

  try {
    const res = await window.apiClient.get(
      `/api/v2/db/query?table=${dbCurrentTable}&limit=${dbLimit}&offset=${dbOffset}`,
    )
    if (res) {
      dbColumns = res.columns || []
      dbRows = res.rows || []
      dbTotalRows = res.total || 0

      window.lastDbRowsFetched = JSON.parse(JSON.stringify(dbRows))

      renderTableHeader()
      renderTableBody()
      renderPaginationControls()
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" style="color:#f87171;padding:1.5rem;text-align:center;">Failed to query table: ${window.esc(e.message)}</td></tr>`
  }
}

function renderTableHeader() {
  const thead = document.getElementById('db-table-headers')
  if (!thead) return

  thead.innerHTML = `
    ${dbColumns
      .map(
        (c) => `
      <th style="padding:.75rem 1rem;font-family:var(--font-mono);font-size:11px;text-align:left;white-space:nowrap;user-select:none;">
        ${window.esc(c.name)}
        <span style="color:#64748b;font-weight:normal;font-size:9px;">(${window.esc(c.type)})</span>
        ${c.isPrimary ? '<span style="color:#fbbf24;font-size:9px;" title="Primary Key">PK</span>' : ''}
      </th>
    `,
      )
      .join('')}
    <th style="padding:.75rem 1rem;font-family:var(--font-mono);font-size:11px;text-align:center;width:100px;">ACTIONS</th>
  `
}

function renderTableBody(rowsToRender = dbRows) {
  const tbody = document.getElementById('db-table-body')
  if (!tbody) return

  if (rowsToRender.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${dbColumns.length + 1}" style="text-align:center;color:#64748b;padding:2rem;">No records found.</td></tr>`
    return
  }

  tbody.innerHTML = rowsToRender
    .map((row) => {
      const rowJson = window.esc(JSON.stringify(row))
      return `
      <tr data-row-json='${rowJson}' style="border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.015)'" onmouseout="this.style.background='transparent'">
        ${dbColumns
          .map((col) => {
            const val = row[col.name]
            const isPk = col.isPrimary
            return `
            <td style="padding:.6rem 1rem;font-size:12px;color:#e2e8f0;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;"
                ondblclick="editDbCell(JSON.parse(this.closest(&quot;tr&quot;).dataset.rowJson), '${window.esc(col.name)}')"
                title="Double click to edit cell value"
                style="cursor:pointer;">
              ${val === null ? '<span style="color:#475569;font-style:italic;">NULL</span>' : window.esc(String(val))}
            </td>
          `
          })
          .join('')}
        <td style="text-align:center;white-space:nowrap;padding:.6rem 1rem;">
          <button class="btn btn-sm" onclick="editDbRowDirect(JSON.parse(this.closest('tr').dataset.rowJson))" style="margin-right:4px;">Edit</button>
          <button class="btn btn-sm" onclick="deleteDbRowDirect(JSON.parse(this.closest('tr').dataset.rowJson))" style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
        </td>
      </tr>
    `
    })
    .join('')
}

function filterDbRows(term) {
  if (!term) {
    renderTableBody(dbRows)
    return
  }

  const filtered = dbRows.filter((row) => {
    return Object.values(row).some(
      (val) => val !== null && String(val).toLowerCase().includes(term),
    )
  })

  renderTableBody(filtered)
}

function renderPaginationControls() {
  const container = document.getElementById('db-pagination')
  if (!container) return

  const start = dbOffset + 1
  const end = Math.min(dbOffset + dbLimit, dbTotalRows)
  const total = dbTotalRows

  const canPrev = dbOffset > 0
  const canNext = dbOffset + dbLimit < dbTotalRows

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:15px;color:var(--text-secondary);font-size:12px;padding:0 5px;">
      <div>
        Showing <strong style="color:#e2e8f0;">${start}-${end}</strong> of <strong style="color:#e2e8f0;">${total}</strong> records
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm" onclick="changeDbOffset(${-dbLimit})" ${canPrev ? '' : 'disabled'}>&lt; Prev</button>
        <button class="btn btn-sm" onclick="changeDbOffset(${dbLimit})" ${canNext ? '' : 'disabled'}>Next &gt;</button>
      </div>
    </div>
  `
}

window.changeDbOffset = (delta) => {
  dbOffset = Math.max(0, dbOffset + delta)
  loadTableData()
}

window.editDbCell = (row, columnName) => {
  if (!row) return

  const col = dbColumns.find((c) => c.name === columnName)
  if (!col) return

  openEditModal(row, col)
}

window.editDbRowDirect = (row) => {
  if (!row) return

  // Edit the first non-primary column
  const col = dbColumns.find((c) => !c.isPrimary) || dbColumns[0]
  if (!col) return

  openEditModal(row, col)
}

function getPrimaryKeyValues(row) {
  const pkVals = {}
  dbColumns.forEach((c) => {
    if (c.isPrimary) {
      pkVals[c.name] = row[c.name]
    }
  })

  // If no primary key is explicitly defined, use all values as search constraints
  if (Object.keys(pkVals).length === 0) {
    dbColumns.forEach((c) => {
      pkVals[c.name] = row[c.name]
    })
  }
  return pkVals
}

function openEditModal(row, col) {
  const val = row[col.name]
  const pKeys = getPrimaryKeyValues(row)

  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;gap:1.2rem;'
  body.innerHTML = `
    <div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:.3rem;letter-spacing:0.05em;">Table: <code style="color:#a78bfa;">${dbCurrentTable}</code></div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:.3rem;letter-spacing:0.05em;">Target Column: <code style="color:#60a5fa;">${col.name}</code> (${col.type})</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:.8rem;letter-spacing:0.05em;">Primary Constraints: <code>${JSON.stringify(pKeys)}</code></div>
    </div>
    <div>
      <label style="font-size:11px;color:#64748b;text-transform:uppercase;display:block;margin-bottom:.4rem;">Cell Value</label>
      <textarea id="db-edit-val" style="width:100%;height:100px;padding:.6rem;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:#0a0e1f;color:#e2e8f0;font-family:monospace;font-size:13px;resize:vertical;">${val === null ? '' : window.esc(String(val))}</textarea>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-top:.4rem;cursor:pointer;">
        <input type="checkbox" id="db-val-null" ${val === null ? 'checked' : ''} onchange="toggleNullCheckbox(this.checked)">
        Set Cell to NULL
      </label>
    </div>
  `

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;width:100%;'
  footer.innerHTML = `
    <button onclick="uiCloseModal('db-edit-modal')" style="background:transparent;border:1px solid rgba(148,163,184,0.3);color:#94a3b8;padding:.4rem 1rem;border-radius:6px;cursor:pointer;">Cancel</button>
    <button id="db-save-cell-btn" style="background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.4);color:#60a5fa;padding:.4rem 1rem;border-radius:6px;cursor:pointer;font-weight:700;">[SAVE CHANGES]</button>
  `

  window.uiOpenModal({
    id: 'db-edit-modal',
    title: 'Edit Database Cell',
    body,
    footer,
    width: '520px',
  })

  const saveBtn = document.getElementById('db-save-cell-btn')
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const isNull = document.getElementById('db-val-null')?.checked
      const rawVal = document.getElementById('db-edit-val')?.value

      let finalVal = isNull ? null : rawVal

      // Parse values according to SQLite types to ensure type safety
      if (finalVal !== null) {
        if (col.type === 'INTEGER') {
          const parsed = parseInt(rawVal, 10)
          if (isNaN(parsed)) {
            window.showToast(`Invalid value for INTEGER column "${col.name}": "${rawVal}" is not a number`, 'error')
            return
          }
          finalVal = parsed
        } else if (col.type === 'REAL' || col.type === 'NUMERIC') {
          const parsed = parseFloat(rawVal)
          if (isNaN(parsed)) {
            window.showToast(`Invalid value for ${col.type} column "${col.name}": "${rawVal}" is not a number`, 'error')
            return
          }
          finalVal = parsed
        }
      }

      const updatedValues = {}
      updatedValues[col.name] = finalVal

      try {
        const res = await window.apiClient.patch('/api/v2/db/row', {
          table: dbCurrentTable,
          primaryKeys: pKeys,
          updatedValues,
        })

        if (res && res.ok) {
          window.showToast('Database record updated successfully', 'success')
          window.uiCloseModal('db-edit-modal')
          loadTableData()
        } else {
          window.showToast('Update failed: ' + (res?.error || 'Unknown error'), 'error')
        }
      } catch (e) {
        window.showToast('Update failed: ' + e.message, 'error')
      }
    }
  }
}

window.toggleNullCheckbox = (checked) => {
  const textarea = document.getElementById('db-edit-val')
  if (textarea) {
    textarea.disabled = checked
    if (checked) textarea.value = ''
  }
}

window.deleteDbRowDirect = async (row) => {
  if (!row) return

  const pKeys = getPrimaryKeyValues(row)

  if (
    !confirm(
      `Are you sure you want to permanently delete this record from ${dbCurrentTable.toUpperCase()}? This action is IRREVERSIBLE!\n\nTarget record key constraints:\n${JSON.stringify(pKeys)}`,
    )
  )
    return

  try {
    const res = await window.apiClient.request('DELETE', '/api/v2/db/row', {
      table: dbCurrentTable,
      primaryKeys: pKeys,
    })

    if (res && res.ok) {
      window.showToast('Record deleted successfully from database', 'success')
      loadTableData()
    } else {
      window.showToast('Deletion failed: ' + (res?.error || 'Unknown error'), 'error')
    }
  } catch (e) {
    window.showToast('Deletion failed: ' + e.message, 'error')
  }
}

window.initDbEditor = initDbEditor
