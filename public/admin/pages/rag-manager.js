/**
 * RAG Manager Page
 * Manages vector embeddings, indexing, and semantic search
 */

let ragNodes = []
let ragIsBuilding = false
let ragFilterText = ''
let ragQueryText = ''

async function initRagManager() {
  ragFilterText = ''
  ragQueryText = ''

  await loadRagState()
  setupRagControls()
}

async function loadRagState() {
  try {
    const res = await window.apiClient.get('/api/v2/rag/nodes')
    if (res) {
      ragNodes = res.nodes || []
      ragIsBuilding = res.building || false
      renderRagNodes()
      updateRebuildButtonState()
    }
  } catch (e) {
    window.showToast('Failed to load RAG index details: ' + e.message, 'error')
  }
}

function setupRagControls() {
  const queryBtn = document.getElementById('rag-query-btn')
  if (queryBtn) {
    queryBtn.onclick = runSemanticQuery
  }

  const rebuildBtn = document.getElementById('rag-rebuild-btn')
  if (rebuildBtn) {
    rebuildBtn.onclick = triggerRebuild
  }

  const filterInput = document.getElementById('rag-filter')
  if (filterInput) {
    filterInput.oninput = (e) => {
      ragFilterText = e.target.value.toLowerCase().trim()
      renderRagNodes()
    }
  }
}

function updateRebuildButtonState() {
  const btn = document.getElementById('rag-rebuild-btn')
  if (!btn) return

  if (ragIsBuilding) {
    btn.disabled = true
    btn.textContent = '[REBUILDING INDEX...]'
    btn.style.color = '#fbbf24'
    btn.style.borderColor = 'rgba(251,191,36,0.3)'
    btn.style.background = 'rgba(251,191,36,0.08)'
  } else {
    btn.disabled = false
    btn.textContent = '[TRIGGER REBUILD]'
    btn.style.color = '#60a5fa'
    btn.style.borderColor = 'rgba(96,165,250,0.3)'
    btn.style.background = 'rgba(96,165,250,0.08)'
  }
}

async function triggerRebuild() {
  if (ragIsBuilding) return

  if (
    !confirm(
      'Are you sure you want to rebuild the embedding index? This will re-fetch data files and generate vector embeddings.',
    )
  )
    return

  try {
    const res = await window.apiClient.post('/api/v2/rag/rebuild', {})
    if (res && res.ok) {
      window.showToast('Embedding rebuild triggered successfully', 'success')
      ragIsBuilding = true
      updateRebuildButtonState()

      // Poll index state until building is done
      let pollCount = 0
      const poll = setInterval(async () => {
        pollCount++
        try {
          const check = await window.apiClient.get('/api/v2/rag/nodes')
          if (check) {
            ragIsBuilding = check.building || false
            if (!ragIsBuilding || pollCount > 30) {
              clearInterval(poll)
              await loadRagState()
              window.showToast('Embedding rebuild completed', 'success')
            }
          }
        } catch {}
      }, 3000)
    }
  } catch (e) {
    window.showToast('Rebuild failed: ' + e.message, 'error')
  }
}

function renderRagNodes() {
  const tbody = document.getElementById('rag-table-body')
  const countEl = document.getElementById('rag-node-count')
  if (!tbody) return

  let filtered = ragNodes
  if (ragFilterText) {
    filtered = ragNodes.filter(
      (node) =>
        node.source.toLowerCase().includes(ragFilterText) ||
        node.text.toLowerCase().includes(ragFilterText),
    )
  }

  if (countEl) {
    countEl.textContent = `Total indexed corpus segments: ${filtered.length} nodes`
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;color:#64748b;padding:2rem;">
          No indexed corpus segments found. Click "Trigger Rebuild" to index data files.
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = filtered
    .map(
      (n, i) => `
    <tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:#a78bfa;white-space:nowrap;">${window.esc(n.source)}</td>
      <td style="color:#e2e8f0;font-size:12px;">${window.esc(n.text.slice(0, 120))}${n.text.length > 120 ? '...' : ''}</td>
      <td style="white-space:nowrap;text-align:center;">
        ${
          n.hasEmbedding
            ? `<span style="color:#4ade80;font-weight:700;font-size:10px;background:rgba(74,222,128,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(74,222,128,0.2);">ACTIVE</span>`
            : `<span style="color:#f87171;font-weight:700;font-size:10px;background:rgba(248,113,113,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(248,113,113,0.2);">INACTIVE</span>`
        }
      </td>
      <td style="font-family:var(--font-mono);font-size:11px;color:#94a3b8;text-align:center;">${n.dimensions || 0}d</td>
    </tr>
  `,
    )
    .join('')
}

async function runSemanticQuery() {
  const queryEl = document.getElementById('rag-query-input')
  const resultsEl = document.getElementById('rag-results-display')
  if (!queryEl || !resultsEl) return

  const query = queryEl.value.trim()
  if (!query) {
    window.showToast('Please enter a semantic search query', 'warning')
    return
  }

  resultsEl.innerHTML = `<div style="color:#64748b;font-family:var(--font-mono);font-size:12px;">[RUNNING SEMANTIC QUERY ROUTER...]</div>`

  try {
    const res = await window.apiClient.get(`/api/v2/rag/search?query=${encodeURIComponent(query)}`)
    if (res && res.context) {
      // Format the returned semantic text beautifully
      let escaped = window.esc(res.context)

      // Parse out references and sources
      escaped = escaped.replace(
        /(\[\d+\] Source: [^\n]+)/g,
        '<strong style="color:#a78bfa;font-family:var(--font-mono);font-size:12px;">$1</strong>',
      )
      escaped = escaped.replace(
        /(Semantic retrieval context [^\n]+)/g,
        '<div style="color:#60a5fa;font-weight:bold;margin-bottom:10px;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;">$1</div>',
      )
      escaped = escaped.split('\n').join('<br>')

      resultsEl.innerHTML = `<div style="color:#e2e8f0;font-size:13px;line-height:1.6;font-family:monospace;background:rgba(0,0,0,0.2);padding:15px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);max-height:400px;overflow-y:auto;">${escaped}</div>`
    } else {
      resultsEl.innerHTML = `<div style="color:#64748b;font-family:var(--font-mono);font-size:12px;">[NO RELEVANT SEMANTIC CONTEXT RETURNED (Similarity thresholds not met)]</div>`
    }
  } catch (e) {
    resultsEl.innerHTML = `<div style="color:#ef4444;font-family:var(--font-mono);font-size:12px;">[ERROR RUNNING SEMANTIC SEARCH] ${window.esc(e.message)}</div>`
  }
}

window.initRagManager = initRagManager
