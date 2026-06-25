/**
 * Economy Page
 * Displays NDC leaderboard with Discord usernames and admin balance editor
 * Also allows customization of economy parameters
 */

let _econData = []
let _econUserCache = {}
let _econConfig = {}

async function initEconomy() {
  await loadEconomyConfig()
  await loadEconomyLeaderboard()

  const search = document.getElementById('economy-search')
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      renderEconomyTable(
        !q
          ? _econData
          : _econData.filter((r) => {
              const info = _econUserCache[r.userId]
              return (
                r.userId.includes(q) ||
                (info?.username ?? '').toLowerCase().includes(q) ||
                (info?.displayName ?? '').toLowerCase().includes(q)
              )
            }),
      )
    })
  }
}

async function loadEconomyLeaderboard() {
  const tbody = document.querySelector('#economy-table tbody')
  if (!tbody) return
  tbody.innerHTML =
    '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">Loading…</td></tr>'
  try {
    const r = await window.apiClient.getEconomyLeaderboard(50)
    if (!r.ok) throw new Error(r.error)
    _econData = r.data || []

    const ids = _econData.map((r) => r.userId)
    if (ids.length) {
      const resolved = await window.apiClient.resolveUsers(ids).catch(() => ({ ok: false }))
      if (resolved.ok) _econUserCache = { ..._econUserCache, ...resolved.data }
    }

    renderEconomyTable(_econData)
  } catch (e) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="6" style="color:#f87171;padding:1rem;">${e.message}</td></tr>`
  }
}

function renderEconomyTable(data) {
  const tbody = document.querySelector('#economy-table tbody')
  if (!tbody) return
  if (!data.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">No economy data yet. Members earn NDC via /daily and /work.</td></tr>'
    return
  }
  const medals = ['1.', '2.', '3.']
  tbody.innerHTML = data
    .map((r, i) => {
      const info = _econUserCache[r.userId]
      const avatar = info?.avatarUrl
        ? `<img src="${escapeAttr(info.avatarUrl)}" style="width:22px;height:22px;border-radius:50%;margin-right:6px;vertical-align:middle;" />`
        : ''
      const nameBlock = info
        ? `<span style="cursor:pointer;" onclick="openMemberCard('${escapeAttr(r.userId)}')">${avatar}<span style="color:#e2e8f0;font-weight:500;">${escapeHtml(info.displayName)}</span>
         <span style="color:#64748b;font-size:11px;margin-left:4px;">@${escapeHtml(info.username)}</span>
         <br><code style="font-size:10px;color:#475569;">${escapeHtml(r.userId)}</code></span>`
        : `<code style="font-size:11px;color:#94a3b8;cursor:pointer;" onclick="openMemberCard('${escapeAttr(r.userId)}')">${escapeHtml(r.userId)}</code>`
      return `<tr>
      <td style="color:#94a3b8;font-size:12px;vertical-align:middle;">${medals[i] ?? (i + 1) + '.'}</td>
      <td style="vertical-align:middle;line-height:1.4;">${nameBlock}</td>
      <td style="text-align:right;vertical-align:middle;font-weight:700;color:#f5c542;">${(r.balance ?? 0).toLocaleString()}</td>
      <td style="text-align:right;vertical-align:middle;color:#94a3b8;">${(r.bank ?? 0).toLocaleString()}</td>
      <td style="text-align:right;vertical-align:middle;font-weight:700;color:#34d399;">${(r.total ?? 0).toLocaleString()}</td>
      <td style="vertical-align:middle;">
        <button class="btn btn-sm" onclick="editBalance('${escapeAttr(r.userId)}', ${r.balance ?? 0})">Edit</button>
      </td>
    </tr>`
    })
    .join('')
}

window.editBalance = async (userId, currentBalance) => {
  const info = _econUserCache[userId]
  const label = info ? `${info.displayName} (@${info.username})` : userId.slice(0, 12) + '…'
  const input = prompt(
    `Set wallet balance for ${label}\nCurrent: ${currentBalance.toLocaleString()} NDC`,
    currentBalance,
  )
  if (input === null) return
  const amount = parseInt(input, 10)
  if (isNaN(amount) || amount < 0) {
    showToast('Invalid amount', 'error')
    return
  }
  try {
    const r = await window.apiClient.setEconomyBalance(userId, amount)
    if (r.ok) {
      showToast(`Balance set to ${amount.toLocaleString()} NDC`, 'success')
      await loadEconomyLeaderboard()
    } else {
      showToast('Failed: ' + r.error, 'error')
    }
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

// Economy Configuration Management
async function loadEconomyConfig() {
  const root = document.getElementById('economy-config-root')
  if (!root) return
  try {
    const res = await window.apiClient.getEconomyConfig()
    if (!res.ok) throw new Error(res.error || 'Failed to load config')
    _econConfig = res.data || {}
    renderEconomyConfig()
  } catch (e) {
    root.innerHTML = `<div style="color:#f87171;padding:1rem;">Failed to load economy config: ${escapeHtml(e.message)}</div>`
  }
}

function renderEconomyConfig() {
  const root = document.getElementById('economy-config-root')
  if (!root) return

  const groups = [
    {
      title: 'Daily & Work',
      fields: [
        { key: 'dailyAmount', label: 'Daily Reward (NDC)', type: 'number' },
        { key: 'workMin', label: 'Work Min Reward (NDC)', type: 'number' },
        { key: 'workMax', label: 'Work Max Reward (NDC)', type: 'number' },
      ],
    },
    {
      title: 'Gambling',
      fields: [
        { key: 'gambleJackpotChance', label: 'Jackpot Chance (0-1)', type: 'number', step: 0.01 },
        { key: 'gambleJackpotMultiplier', label: 'Jackpot Multiplier (×)', type: 'number' },
        { key: 'gambleWinChance', label: 'Win Chance (0-1)', type: 'number', step: 0.01 },
        { key: 'gambleWinMin', label: 'Win Multiplier Min (×)', type: 'number', step: 0.1 },
        { key: 'gambleWinMax', label: 'Win Multiplier Max (×)', type: 'number', step: 0.1 },
      ],
    },
    {
      title: 'Crime',
      fields: [
        {
          key: 'crimeSuccessChance',
          label: 'Crime Success Chance (0-1)',
          type: 'number',
          step: 0.01,
        },
        { key: 'crimeMinReward', label: 'Crime Min Reward (NDC)', type: 'number' },
        { key: 'crimeMaxReward', label: 'Crime Max Reward (NDC)', type: 'number' },
        { key: 'crimeCatchChance', label: 'Crime Caught Chance (0-1)', type: 'number', step: 0.01 },
        { key: 'crimeFineMin', label: 'Crime Fine Min (NDC)', type: 'number' },
        { key: 'crimeFineMax', label: 'Crime Fine Max (NDC)', type: 'number' },
      ],
    },
    {
      title: 'Heist',
      fields: [
        {
          key: 'heistSuccessChance',
          label: 'Heist Success Chance (0-1)',
          type: 'number',
          step: 0.01,
        },
        { key: 'heistMinReward', label: 'Heist Min Reward (NDC)', type: 'number' },
        { key: 'heistMaxReward', label: 'Heist Max Reward (NDC)', type: 'number' },
        { key: 'heistCatchChance', label: 'Heist Caught Chance (0-1)', type: 'number', step: 0.01 },
        { key: 'heistFineMin', label: 'Heist Fine Min (NDC)', type: 'number' },
        { key: 'heistFineMax', label: 'Heist Fine Max (NDC)', type: 'number' },
      ],
    },
    {
      title: 'Rob',
      fields: [
        { key: 'robStealPercentMin', label: 'Rob Steal % Min (0-1)', type: 'number', step: 0.01 },
        { key: 'robStealPercentMax', label: 'Rob Steal % Max (0-1)', type: 'number', step: 0.01 },
        { key: 'robMinVictimBalance', label: 'Rob Victim Min Balance (NDC)', type: 'number' },
      ],
    },
    {
      title: 'Hunt',
      fields: [
        { key: 'huntMinReward', label: 'Hunt Min Reward (NDC)', type: 'number' },
        { key: 'huntMaxReward', label: 'Hunt Max Reward (NDC)', type: 'number' },
        { key: 'huntCooldownMin', label: 'Hunt Cooldown (minutes)', type: 'number' },
      ],
    },
    {
      title: 'Fish',
      fields: [
        { key: 'fishMinReward', label: 'Fish Min Reward (NDC)', type: 'number' },
        { key: 'fishMaxReward', label: 'Fish Max Reward (NDC)', type: 'number' },
        { key: 'fishCooldownMin', label: 'Fish Cooldown (minutes)', type: 'number' },
      ],
    },
    {
      title: 'Mine',
      fields: [
        { key: 'mineMinReward', label: 'Mine Min Reward (NDC)', type: 'number' },
        { key: 'mineMaxReward', label: 'Mine Max Reward (NDC)', type: 'number' },
        { key: 'mineCooldownMin', label: 'Mine Cooldown (minutes)', type: 'number' },
      ],
    },
  ]

  let html = '<div style="display:grid;gap:2rem;margin-bottom:2rem;">'
  for (const group of groups) {
    html += `<div style="background:rgba(15,18,40,0.6);border:1px solid rgba(148,163,184,0.15);border-radius:8px;padding:1.5rem;">
      <h3 style="color:#e2e8f0;font-size:14px;font-weight:700;margin:0 0 1rem 0;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(group.title)}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">`
    for (const field of group.fields) {
      const value = _econConfig[field.key] ?? ''
      const step = field.step ?? 1
      html += `<div>
        <label style="font-size:11px;color:#64748b;display:block;margin-bottom:0.4rem;text-transform:uppercase;">${escapeHtml(field.label)}</label>
        <input type="${field.type}" value="${value}" step="${step}" id="econ-${field.key}"
          style="width:100%;padding:0.5rem;background:#0a0e1f;border:1px solid rgba(148,163,184,0.2);border-radius:4px;color:#e2e8f0;font-size:13px;">
      </div>`
    }
    html += '</div></div>'
  }
  html += '</div>'
  html +=
    '<button onclick="saveEconomyConfig()" style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#22c55e;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:700;">Save Configuration</button>'
  root.innerHTML = html
}

window.saveEconomyConfig = async () => {
  const keys = [
    'dailyAmount',
    'workMin',
    'workMax',
    'gambleJackpotChance',
    'gambleJackpotMultiplier',
    'gambleWinChance',
    'gambleWinMin',
    'gambleWinMax',
    'crimeSuccessChance',
    'crimeMinReward',
    'crimeMaxReward',
    'crimeCatchChance',
    'crimeFineMin',
    'crimeFineMax',
    'heistSuccessChance',
    'heistMinReward',
    'heistMaxReward',
    'heistCatchChance',
    'heistFineMin',
    'heistFineMax',
    'robStealPercentMin',
    'robStealPercentMax',
    'robMinVictimBalance',
    'huntMinReward',
    'huntMaxReward',
    'huntCooldownMin',
    'fishMinReward',
    'fishMaxReward',
    'fishCooldownMin',
    'mineMinReward',
    'mineMaxReward',
    'mineCooldownMin',
  ]
  const config = {}
  for (const key of keys) {
    const el = document.getElementById(`econ-${key}`)
    if (el) {
      const val = parseFloat(el.value)
      if (!isNaN(val)) config[key] = val
    }
  }
  try {
    const res = await window.apiClient.setEconomyConfig(config)
    if (res.ok) {
      window.showToast('Economy configuration saved', 'success')
      _econConfig = res.data || {}
    } else {
      window.showToast('Failed to save: ' + (res.error || 'unknown error'), 'error')
    }
  } catch (e) {
    window.showToast('Error: ' + e.message, 'error')
  }
}

window.switchEconomyTab = (tab) => {
  // Hide all tabs (explicit display + class)
  document.querySelectorAll('.econ-tab-content').forEach((el) => {
    el.classList.remove('active')
    el.style.display = 'none'
  })
  document.querySelectorAll('.econ-tab-btn').forEach((el) => el.classList.remove('active'))

  // Show selected tab
  const content = document.getElementById(`etab-${tab}`)
  if (content) {
    content.classList.add('active')
    content.style.display = 'block'
    const btn = document.querySelector(`.econ-tab-btn[data-etab="${tab}"]`)
    if (btn) btn.classList.add('active')

    if (tab === 'config') {
      loadEconomyConfig()
    } else if (tab === 'leaderboard') {
      loadEconomyLeaderboard()
    }
  }
}

window.initEconomy = initEconomy
window.loadEconomyLeaderboard = loadEconomyLeaderboard
