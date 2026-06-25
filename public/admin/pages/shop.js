/**
 * Shop Page
 * Manage NDC economy store items
 */

let _shopItems = []

async function initShop() {
  injectShopModal()
  await loadShopItems()
}

async function loadShopItems() {
  const tbody = document.querySelector('#shop-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getShopItems()
    if (!r.ok) throw new Error(r.error)
    _shopItems = r.data || []
    renderShopTable(_shopItems)
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderShopTable(items) {
  const tbody = document.querySelector('#shop-table tbody')
  if (!tbody) return
  if (!items.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:1.5rem;">No items yet. Click <strong>+ Add Item</strong> to create one.</td></tr>'
    return
  }
  tbody.innerHTML = items
    .map((item) => {
      const stock =
        item.stock === undefined
          ? '<span style="color:#64748b;">∞ Unlimited</span>'
          : item.stock === 0
            ? '<span style="color:#f87171;">Sold Out</span>'
            : `<span style="color:#34d399;">${item.stock} left</span>`
      const type =
        item.type === 'role'
          ? `<span style="color:#a78bfa;">Role</span>`
          : `<span style="color:#60a5fa;">Item</span>`
      const roleTag = item.roleId
        ? `<br><code style="font-size:10px;color:#64748b;">${escapeHtml(item.roleId)}</code>`
        : ''
      return `<tr>
      <td style="font-size:20px;text-align:center;">${escapeHtml(item.emoji || '')}</td>
      <td>
        <span style="color:#e2e8f0;font-weight:600;">${escapeHtml(item.name)}</span>
        <br><span style="color:#64748b;font-size:11px;">${escapeHtml(item.description || '-')}</span>
      </td>
      <td style="font-weight:700;color:#f5c542;text-align:right;">${item.price.toLocaleString()} NDC</td>
      <td>${type}${roleTag}</td>
      <td>${stock}</td>
      <td><code style="font-size:10px;color:#475569;">${escapeHtml(item.id)}</code></td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm" onclick="openShopEdit('${escapeAttr(item.id)}')" style="margin-right:4px;">Edit</button>
        <button class="btn btn-sm" onclick="deleteShopItem('${escapeAttr(item.id)}', '${escapeAttr(item.name)}')"
          style="color:#f87171;border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.08);">Delete</button>
      </td>
    </tr>`
    })
    .join('')
}

// ── Modal ───────────────────────────────────────────────────────────────────

function injectShopModal() {
  if (document.getElementById('shop-modal')) return
  const modal = document.createElement('div')
  modal.id = 'shop-modal'
  modal.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;align-items:center;justify-content:center;'
  modal.innerHTML = `
    <div style="background:#0f1228;border:1px solid rgba(96,165,250,0.25);border-radius:12px;padding:1.75rem;width:500px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h3 id="sm-title" style="margin:0 0 1.25rem;color:#e2e8f0;font-size:15px;"></h3>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <label style="display:flex;flex-direction:column;gap:4px;grid-column:1/-1;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Item Name *</span>
          <input id="sm-name" type="text" maxlength="50" placeholder="e.g. VIP Role"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Price (NDC) *</span>
          <input id="sm-price" type="number" min="1" placeholder="1000"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Emoji</span>
          <input id="sm-emoji" type="text" maxlength="8" placeholder="Optional"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        </label>
      </div>

      <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Description</span>
        <input id="sm-desc" type="text" maxlength="150" placeholder="Short description shown in /shop list"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Type</span>
          <select id="sm-type" onchange="smTypeChanged()"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;">
            <option value="item">Item (cosmetic)</option>
            <option value="role">Role reward</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Stock (blank = unlimited)</span>
          <input id="sm-stock" type="number" min="0" placeholder="Leave blank for unlimited"
            style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        </label>
      </div>

      <label id="sm-role-wrap" style="display:none;flex-direction:column;gap:4px;margin-bottom:1rem;">
        <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Role ID to grant</span>
        <input id="sm-roleid" type="text" placeholder="Paste Discord role ID"
          style="background:rgba(15,18,40,0.8);border:1px solid rgba(96,165,250,0.25);color:#e2e8f0;padding:0.5rem 0.65rem;border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;" />
        <span style="font-size:10px;color:#475569;">Right-click a role in Discord, then Copy ID (enable Developer Mode first)</span>
      </label>

      <div id="sm-error" style="display:none;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;padding:0.5rem 0.75rem;font-size:12px;color:#f87171;margin-bottom:1rem;"></div>

      <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
        <button class="btn" onclick="closeShopModal()" style="color:#64748b;border-color:rgba(100,116,139,0.3);">Cancel</button>
        <button class="btn" id="sm-save" onclick="saveShopItem()"
          style="background:rgba(245,197,66,0.15);border-color:rgba(245,197,66,0.4);color:#f5c542;">Save Item</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  document.addEventListener('click', (e) => {
    if (e.target === modal) closeShopModal()
  })
}

window.smTypeChanged = () => {
  const isRole = document.getElementById('sm-type').value === 'role'
  document.getElementById('sm-role-wrap').style.display = isRole ? 'flex' : 'none'
}

let _smEditId = null

window.openShopAdd = () => {
  _smEditId = null
  document.getElementById('sm-title').textContent = 'Add Shop Item'
  document.getElementById('sm-name').value = ''
  document.getElementById('sm-price').value = ''
  document.getElementById('sm-emoji').value = ''
  document.getElementById('sm-desc').value = ''
  document.getElementById('sm-type').value = 'item'
  document.getElementById('sm-stock').value = ''
  document.getElementById('sm-roleid').value = ''
  document.getElementById('sm-role-wrap').style.display = 'none'
  document.getElementById('sm-error').style.display = 'none'
  document.getElementById('sm-modal') // reset
  document.getElementById('shop-modal').style.display = 'flex'
}

window.openShopEdit = (id) => {
  const item = _shopItems.find((i) => i.id === id)
  if (!item) return
  _smEditId = id
  document.getElementById('sm-title').textContent = `Edit ${item.name}`
  document.getElementById('sm-name').value = item.name
  document.getElementById('sm-price').value = item.price
  document.getElementById('sm-emoji').value = item.emoji || ''
  document.getElementById('sm-desc').value = item.description || ''
  document.getElementById('sm-type').value = item.type
  document.getElementById('sm-stock').value = item.stock ?? ''
  document.getElementById('sm-roleid').value = item.roleId || ''
  document.getElementById('sm-role-wrap').style.display = item.type === 'role' ? 'flex' : 'none'
  document.getElementById('sm-error').style.display = 'none'
  document.getElementById('shop-modal').style.display = 'flex'
}

window.closeShopModal = () => {
  document.getElementById('shop-modal').style.display = 'none'
}

window.saveShopItem = async () => {
  const name = document.getElementById('sm-name').value.trim()
  const price = parseInt(document.getElementById('sm-price').value, 10)
  const emoji = document.getElementById('sm-emoji').value.trim() || undefined
  const description = document.getElementById('sm-desc').value.trim()
  const type = document.getElementById('sm-type').value
  const stockRaw = document.getElementById('sm-stock').value.trim()
  const stock = stockRaw === '' ? undefined : Math.max(0, parseInt(stockRaw, 10))
  const roleId = document.getElementById('sm-roleid').value.trim() || undefined

  const errEl = document.getElementById('sm-error')
  if (!name) {
    showErr('Item name is required.')
    return
  }
  if (isNaN(price) || price < 1) {
    showErr('Price must be at least 1 NDC.')
    return
  }
  if (type === 'role' && !roleId) {
    showErr('Role ID is required for role items.')
    return
  }

  const btn = document.getElementById('sm-save')
  btn.textContent = 'Saving…'
  btn.disabled = true
  errEl.style.display = 'none'

  const payload = {
    name,
    price,
    description,
    type,
    emoji,
    stock: stock ?? null,
    roleId: roleId ?? null,
  }

  try {
    let r
    if (_smEditId) {
      r = await window.apiClient.updateShopItem(_smEditId, payload)
    } else {
      r = await window.apiClient.addShopItem(payload)
    }
    if (!r.ok) throw new Error(r.error)
    showToast(_smEditId ? 'Item updated' : 'Item added', 'success')
    closeShopModal()
    await loadShopItems()
  } catch (e) {
    showErr(e.message)
  } finally {
    btn.textContent = 'Save Item'
    btn.disabled = false
  }

  function showErr(msg) {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }
}

window.deleteShopItem = async (id, name) => {
  if (!confirm(`Delete "${name}" from the shop? This cannot be undone.`)) return
  try {
    const r = await window.apiClient.deleteShopItem(id)
    if (!r.ok) throw new Error(r.error)
    showToast(`"${name}" removed from shop`, 'success')
    await loadShopItems()
  } catch (e) {
    showToast('Error: ' + e.message, 'error')
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

window.initShop = initShop
window.loadShopItems = loadShopItems
