/**
 * Analytics Page
 * Displays charts and analytics data
 */

const charts = {}

async function initAnalytics() {
  if (!window.Chart) {
    showToast('Chart library failed to load, check console', 'error')
    console.error('[Telemetry] Chart.js not loaded. Hard-refresh the page (Ctrl+Shift+R).')
    return
  }
  await loadAnalyticsCharts()
}

async function loadAnalyticsCharts() {
  try {
    // Load messages chart
    await loadMessagesChart()
    // Load intents chart
    await loadIntentsChart()
    // Load models chart
    await loadModelsChart()
    // Load commands chart
    await loadCommandsChart()
  } catch (error) {
    console.error('Analytics error:', error)
    showToast(`Error loading analytics: ${error.message}`, 'error')
  }
}

async function loadMessagesChart() {
  try {
    const result = await window.apiClient.getAnalyticsMessages(30)
    if (!result.ok) throw new Error(result.error)

    const data = result.data
    const ctx = document.getElementById('chart-messages')
    if (!ctx) return

    if (charts.messages) charts.messages.destroy()

    charts.messages = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((d) => d.date),
        datasets: [
          {
            label: 'Messages',
            data: data.map((d) => d.count),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: true,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    })
  } catch (error) {
    console.error('Messages chart error:', error)
  }
}

async function loadIntentsChart() {
  try {
    const result = await window.apiClient.getAnalyticsIntents()
    if (!result.ok) throw new Error(result.error)

    const data = result.data
    const ctx = document.getElementById('chart-intents')
    if (!ctx) return

    if (charts.intents) charts.intents.destroy()

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

    charts.intents = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map((d) => d.intent),
        datasets: [
          {
            data: data.map((d) => d.percentage),
            backgroundColor: colors.slice(0, data.length),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
          },
        },
      },
    })
  } catch (error) {
    console.error('Intents chart error:', error)
  }
}

async function loadModelsChart() {
  try {
    const result = await window.apiClient.getAnalyticsModels()
    if (!result.ok) throw new Error(result.error)

    const data = result.data
    const ctx = document.getElementById('chart-models')
    if (!ctx) return

    if (charts.models) charts.models.destroy()

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']

    charts.models = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: data.map((d) => d.model),
        datasets: [
          {
            data: data.map((d) => d.percentage),
            backgroundColor: colors.slice(0, data.length),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
          },
        },
      },
    })
  } catch (error) {
    console.error('Models chart error:', error)
  }
}

async function loadCommandsChart() {
  try {
    const result = await window.apiClient.getAnalyticsCommands(10)
    if (!result.ok) throw new Error(result.error)

    const data = result.data
    const container = document.getElementById('commands-list')
    if (!container) return

    container.innerHTML = data
      .map(
        (cmd) => `
      <div class="command-item">
        <span class="command-name">${cmd.command}</span>
        <span class="command-count">${cmd.count}</span>
      </div>
    `,
      )
      .join('')
  } catch (error) {
    console.error('Commands error:', error)
  }
}

window.initAnalytics = initAnalytics
