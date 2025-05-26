import { Hono } from 'hono';
import { StoreClient } from '../services/dashboard/store-client.ts';

export class DashboardRoutes {
  private hono: Hono;
  private client: StoreClient;

  constructor() {
    this.hono = new Hono();
    this.client = new StoreClient();
    this.setupRoutes();
  }

  private generateHTML(title: string, content: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        .status-badge { @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium; }
        .status-created { @apply bg-blue-100 text-blue-800; }
        .status-queued { @apply bg-yellow-100 text-yellow-800; }
        .status-delivered { @apply bg-green-100 text-green-800; }
        .status-failed { @apply bg-red-100 text-red-800; }
        
        .loader {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: rgba(255, 255, 255, 0.9);
          z-index: 9999;
          padding: 1rem;
          text-align: center;
        }
        
        .loader.active {
          display: block;
        }
        
        .spinner {
          display: inline-block;
          width: 40px;
          height: 40px;
          border: 3px solid rgba(59, 130, 246, 0.3);
          border-radius: 50%;
          border-top-color: rgb(59, 130, 246);
          animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
    </style>
    <script>
      // Show loader when navigating
      document.addEventListener('DOMContentLoaded', function() {
        const links = document.querySelectorAll('a[href^="/dashboard"]');
        const loader = document.createElement('div');
        loader.className = 'loader';
        loader.innerHTML = '<div class="spinner"></div><div class="mt-2 text-sm text-gray-600">Loading...</div>';
        document.body.appendChild(loader);
        
        links.forEach(link => {
          link.addEventListener('click', function(e) {
            if (!e.ctrlKey && !e.metaKey) {
              loader.classList.add('active');
            }
          });
        });
        
        // Hide loader when page loads
        window.addEventListener('pageshow', function() {
          loader.classList.remove('active');
        });
      });
    </script>
</head>
<body class="bg-gray-50 min-h-screen">
    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <a href="/dashboard">
          <div class="flex items-center gap-4 mb-6">
              <img src="/done.jpg" alt="Done Logo" class="h-12 w-12 rounded-lg shadow-sm">
              <div>
                  <h1 class="text-2xl font-bold text-gray-900">Done Dashboard</h1>
                  <small class="text-gray-500">Message Queue on Deno Deploy</small>
              </div>
          </div>
          </a>
  
        ${content}
    </main>
</body>
</html>
    `;
  }

  private setupRoutes() {
    // Dashboard overview
    this.hono.get('/', async (c) => {
      try {
        const stats = await this.client.getStats();
        const deliveryRate = stats.total > 0 ? ((stats.sent / stats.total) * 100).toFixed(1) : '0.0';
        const errorRate = stats.total > 0 ? (((stats.dlq + stats.failed) / stats.total) * 100).toFixed(1) : '0.0';

        const content = `
          <div class="px-4 py-0 sm:px-0">
            <!-- Tab Navigation -->
            <div class="mb-6">
              <div class="border-b border-gray-200">
                <nav class="-mb-px flex space-x-8" aria-label="Tabs">
                  <a href="/dashboard" class="border-indigo-500 text-indigo-600 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Overview
                  </a>
                  <a href="/dashboard/messages" class="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Messages
                  </a>
                </nav>
              </div>
            </div>
            
            <!-- Main Dashboard Layout -->

            <!-- All Message States -->
            <div class="mb-6">
              <div class="bg-white shadow rounded-lg p-6">
                <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                  <div class="text-center">
                    <div class="text-2xl font-bold text-blue-600">${stats.created}</div>
                    <div class="text-sm text-gray-500">Created</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-yellow-600">${stats.queued}</div>
                    <div class="text-sm text-gray-500">Queued</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-purple-600">${stats.deliver}</div>
                    <div class="text-sm text-gray-500">Delivering</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-green-600">${stats.sent}</div>
                    <div class="text-sm text-gray-500">Sent</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-orange-600">${stats.retry}</div>
                    <div class="text-sm text-gray-500">Retry</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-red-600">${stats.dlq}</div>
                    <div class="text-sm text-gray-500">DLQ</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-gray-600">${stats.archived}</div>
                    <div class="text-sm text-gray-500">Archived</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex gap-6">
              <!-- Left Side: Charts and Content -->
              <div class="flex-1 space-y-6">

                <!-- 7-Day Trend Chart -->
                <div class="bg-white shadow rounded-lg p-6">
                  <h2 class="text-lg font-medium text-gray-900 mb-4">7-Day Message Trend</h2>
                  <div id="trendChart"></div>
                </div>
                
                <!-- Hourly State Changes Chart -->
                <div class="bg-white shadow rounded-lg p-6">
                  <h2 class="text-lg font-medium text-gray-900 mb-4">Today's Message States</h2>
                  <div id="stateChart"></div>
                </div>
              </div>

              <!-- Right Side: Stats Cards -->
              <div class="w-80 flex-shrink-0">
                <div class="space-y-4 sticky top-6">
                  
                  <!-- Time Period Stats -->
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-blue-50 text-blue-600 p-3 rounded-md">
                        <span class="text-lg">📅</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Last 24 Hours</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.last24h.toLocaleString()}</dd>
                        <dd class="text-sm text-gray-600">New messages</dd>
                      </div>
                    </div>
                  </div>
                  
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-blue-50 text-blue-600 p-3 rounded-md">
                        <span class="text-lg">📊</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Last 7 Days</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.last7d.toLocaleString()}</dd>
                        <dd class="text-sm text-gray-600">Weekly activity</dd>
                      </div>
                    </div>
                  </div>

                  <!-- Primary Stats -->
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-blue-50 text-blue-600 p-3 rounded-md">
                        <span class="text-lg">📨</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Total Messages</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.total.toLocaleString()}</dd>
                      </div>
                    </div>
                  </div>
                  
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-green-50 text-green-600 p-3 rounded-md">
                        <span class="text-lg">✅</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Sent</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.sent.toLocaleString()}</dd>
                        <dd class="text-sm text-gray-600">${deliveryRate}% success rate</dd>
                      </div>
                    </div>
                  </div>
                  
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-red-50 text-red-600 p-3 rounded-md">
                        <span class="text-lg">❌</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Failed</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.failed.toLocaleString()}</dd>
                        <dd class="text-sm text-gray-600">${errorRate}% failure rate</dd>
                      </div>
                    </div>
                  </div>
                  
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-yellow-50 text-yellow-600 p-3 rounded-md">
                        <span class="text-lg">⏳</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Pending</dt>
                        <dd class="text-lg font-medium text-gray-900">${(stats.created + stats.queued).toLocaleString()}</dd>
                        <dd class="text-sm text-gray-600">Created + Queued</dd>
                      </div>
                    </div>
                  </div>
                  
                  <div class="bg-white overflow-hidden shadow rounded-lg p-8">
                    <div class="flex items-center">
                      <div class="flex-shrink-0 bg-gray-50 text-gray-600 p-3 rounded-md">
                        <span class="text-lg">💾</span>
                      </div>
                      <div class="ml-5 w-0 flex-1">
                        <dt class="text-sm font-medium text-gray-500">Storage Type</dt>
                        <dd class="text-lg font-medium text-gray-900">${stats.storageType}</dd>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <script>
              const chartSize = 390;

              // Dashboard Stats Data
              const stats = ${JSON.stringify(stats)};
              
              // 7-Day Trend Chart
              const trendData = stats.trend7d;
              
              const incomingTrace = {
                x: trendData.map(d => d.date),
                y: trendData.map(d => d.incoming),
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Incoming Messages',
                line: { color: 'rgb(59, 130, 246)', width: 2 },
                marker: { size: 6 },
                hovertemplate: '<b>%{x|%b %d}</b><br>Incoming: %{y}<extra></extra>'
              };
              
              const sentTrace = {
                x: trendData.map(d => d.date),
                y: trendData.map(d => d.sent),
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Sent Messages',
                line: { color: 'rgb(34, 197, 94)', width: 2 },
                marker: { size: 6 },
                hovertemplate: '<b>%{x|%b %d}</b><br>Sent: %{y}<extra></extra>'
              };
              
              // Calculate failed messages for trend
              const failedTrace = {
                x: trendData.map(d => d.date),
                y: trendData.map(d => (d.incoming || 0) - (d.sent || 0)),
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Failed Messages',
                line: { color: 'rgb(239, 68, 68)', width: 2, dash: 'dot' },
                marker: { size: 6 },
                hovertemplate: '<b>%{x|%b %d}</b><br>Failed: %{y}<extra></extra>'
              };
              
              const trendLayout = {
                margin: { t: 0, r: 0, l: 40, b: 40 },
                xaxis: {
                  title: '',
                  type: 'date',
                  tickformat: '%b %d',
                  gridcolor: 'rgba(0, 0, 0, 0.05)'
                },
                yaxis: {
                  title: 'Messages',
                  rangemode: 'tozero',
                  gridcolor: 'rgba(0, 0, 0, 0.05)'
                },
                legend: {
                  x: 0,
                  y: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.8)'
                },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                height: chartSize
              };
              
              const config = {
                responsive: true,
                displayModeBar: false,
                staticPlot: false
              };
              
              Plotly.newPlot('trendChart', [incomingTrace, sentTrace, failedTrace], trendLayout, config);
              
              // Hourly State Changes Chart
              const hourlyStateData = stats.hourlyStateChanges || [];
              console.log('Dashboard: hourlyStateChanges data:', hourlyStateData);
              const hours = Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0') + ':00');
              
              // Create traces for each state
              const stateTraces = [
                {
                  name: 'Created',
                  x: hours,
                  y: hourlyStateData.map(h => h.created || 0),
                  type: 'bar',
                  marker: { color: 'rgb(59, 130, 246)' },
                  hovertemplate: '<b>%{x}</b><br>Created: %{y}<extra></extra>'
                },
                {
                  name: 'Queued',
                  x: hours,
                  y: hourlyStateData.map(h => h.queued || 0),
                  type: 'bar',
                  marker: { color: 'rgb(250, 204, 21)' },
                  hovertemplate: '<b>%{x}</b><br>Queued: %{y}<extra></extra>'
                },
                {
                  name: 'Delivering',
                  x: hours,
                  y: hourlyStateData.map(h => h.delivering || 0),
                  type: 'bar',
                  marker: { color: 'rgb(147, 51, 234)' },
                  hovertemplate: '<b>%{x}</b><br>Delivering: %{y}<extra></extra>'
                },
                {
                  name: 'Sent',
                  x: hours,
                  y: hourlyStateData.map(h => h.sent || 0),
                  type: 'bar',
                  marker: { color: 'rgb(34, 197, 94)' },
                  hovertemplate: '<b>%{x}</b><br>Sent: %{y}<extra></extra>'
                },
                {
                  name: 'Retry',
                  x: hours,
                  y: hourlyStateData.map(h => h.retry || 0),
                  type: 'bar',
                  marker: { color: 'rgb(251, 146, 60)' },
                  hovertemplate: '<b>%{x}</b><br>Retry: %{y}<extra></extra>'
                },
                {
                  name: 'Failed',
                  x: hours,
                  y: hourlyStateData.map(h => h.failed || 0),
                  type: 'bar',
                  marker: { color: 'rgb(239, 68, 68)' },
                  hovertemplate: '<b>%{x}</b><br>Failed: %{y}<extra></extra>'
                },
                {
                  name: 'DLQ',
                  x: hours,
                  y: hourlyStateData.map(h => h.dlq || 0),
                  type: 'bar',
                  marker: { color: 'rgb(127, 29, 29)' },
                  hovertemplate: '<b>%{x}</b><br>DLQ: %{y}<extra></extra>'
                }
              ];
              
              const stateLayout = {
                margin: { t: 20, r: 20, l: 50, b: 60 },
                xaxis: {
                  title: 'Hour of Day',
                  tickangle: -45
                },
                yaxis: {
                  title: 'Number of State Changes',
                  rangemode: 'tozero',
                  gridcolor: 'rgba(0, 0, 0, 0.05)'
                },
                barmode: 'group',
                bargap: 0.15,
                bargroupgap: 0.1,
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                height: chartSize,
                showlegend: true,
                legend: {
                  orientation: 'h',
                  x: 0,
                  y: -0.2
                }
              };
              
              Plotly.newPlot('stateChart', stateTraces, stateLayout, config);
              
              // Hourly Activity Chart (if we have hourly data)
              const hourlyData = stats.hourlyActivity || [];
              if (Array.isArray(hourlyData) && hourlyData.some(v => v > 0)) {
                const hourLabels = Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0') + ':00');
                
                const hourlyTrace = {
                  x: hourLabels,
                  y: hourlyData,
                  type: 'bar',
                  marker: {
                    color: hourlyData.map(v => {
                      if (v === 0) return 'rgba(156, 163, 175, 0.3)';
                      if (v > 50) return 'rgb(239, 68, 68)';
                      if (v > 20) return 'rgb(251, 146, 60)';
                      if (v > 10) return 'rgb(250, 204, 21)';
                      return 'rgb(59, 130, 246)';
                    })
                  },
                  text: hourlyData.map(v => v > 0 ? v.toString() : ''),
                  textposition: 'outside',
                  hovertemplate: '<b>%{x}</b><br>Activity: %{y}<extra></extra>'
                };
                
                const hourlyLayout = {
                  margin: { t: 20, r: 20, l: 50, b: 60 },
                  xaxis: {
                    title: 'Hour of Day',
                    tickangle: -45
                  },
                  yaxis: {
                    title: 'Total Activity',
                    rangemode: 'tozero'
                  },
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor: 'rgba(0,0,0,0)',
                  height: 300
                };
                
                Plotly.newPlot('hourlyActivityChart', [hourlyTrace], hourlyLayout, config);
              }
            </script>
          </div>
        `;

        return c.html(this.generateHTML('Dashboard - Done', content));
      } catch (error) {
        console.error('Dashboard error:', error);
        const content = `
          <div class="px-4 py-6 sm:px-0">
            <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        `;
        return c.html(this.generateHTML('Error - Done Dashboard', content));
      }
    });

    // Messages list
    this.hono.get('/messages', async (c) => {
      try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = 25;
        const offset = (page - 1) * limit;

        const result = await this.client.getMessages({ limit, offset });
        const { messages, total } = result;

        // Calculate pagination info
        const totalPages = Math.ceil(total / limit);
        const pagination = {
          total,
          page,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        };

        const messagesHTML = messages && messages.length > 0
          ? messages.map((msg) => `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
              <a href="/dashboard/message/${msg.id}?page=${page}" class="text-blue-600 hover:text-blue-900">
                ${msg.id && msg.id.length > 20 ? msg.id.substring(0, 20) + '...' : msg.id || 'N/A'}
              </a>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span class="status-badge status-${msg.status.toLowerCase()}">${msg.status}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
              ${msg.url && msg.url.length > 30 ? msg.url.substring(0, 30) + '...' : msg.url || 'N/A'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${msg.retry_count}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              ${new Date(msg.created_at).toLocaleString()}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              ${new Date(msg.publish_at).toLocaleString()}
            </td>
          </tr>
        `).join('')
          : '';

        const content = `
          <div class="px-4 py-0 sm:px-0">
            <!-- Tab Navigation -->
            <div class="mb-8">
              <div class="border-b border-gray-200">
                <nav class="-mb-px flex space-x-8" aria-label="Tabs">
                  <a href="/dashboard" class="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Overview
                  </a>
                  <a href="/dashboard/messages" class="border-indigo-500 text-indigo-600 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Messages
                  </a>
                </nav>
              </div>
            </div>
            
            <div class="mb-8">
              <h1 class="text-2xl font-bold text-gray-900">Messages</h1>
              <p class="mt-1 text-sm text-gray-600">Showing ${messages.length} messages</p>
            </div>

            <div class="bg-white shadow overflow-hidden sm:rounded-md">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Retries</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Publish At</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    ${messagesHTML || '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No messages found</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
            
            ${
          pagination
            ? `
            <!-- Pagination -->
            <div class="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div class="flex-1 flex justify-between sm:hidden">
                ${
              pagination.hasPrev
                ? `
                  <a href="/dashboard/messages?page=${
                  page - 1
                }" class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Previous
                  </a>
                `
                : ''
            }
                ${
              pagination.hasNext
                ? `
                  <a href="/dashboard/messages?page=${
                  page + 1
                }" class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Next
                  </a>
                `
                : ''
            }
              </div>
              <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p class="text-sm text-gray-700">
                    Showing
                    <span class="font-medium">${(page - 1) * limit + 1}</span>
                    to
                    <span class="font-medium">${Math.min(page * limit, pagination.total)}</span>
                    of
                    <span class="font-medium">${pagination.total}</span>
                    results
                  </p>
                </div>
                <div>
                  <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    ${
              pagination.hasPrev
                ? `
                      <a href="/dashboard/messages?page=${
                  page - 1
                }" class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                        <span class="sr-only">Previous</span>
                        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      </a>
                    `
                : ''
            }
                    
                    ${
              Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                const pageNum = i + 1;
                const isActive = pageNum === page;
                return `
                        <a href="/dashboard/messages?page=${pageNum}" 
                           class="relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                  isActive ? 'z-10 bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                }">
                          ${pageNum}
                        </a>
                      `;
              }).join('')
            }
                    
                    ${
              pagination.totalPages > 5
                ? `
                      <span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                        ...
                      </span>
                    `
                : ''
            }
                    
                    ${
              pagination.hasNext
                ? `
                      <a href="/dashboard/messages?page=${
                  page + 1
                }" class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                        <span class="sr-only">Next</span>
                        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                        </svg>
                      </a>
                    `
                : ''
            }
                  </nav>
                </div>
              </div>
            </div>
            `
            : ''
        }
          </div>
        `;

        return c.html(this.generateHTML('Messages - Done Dashboard', content));
      } catch (error) {
        console.error('Messages error:', error);
        const content = `
          <div class="px-4 py-6 sm:px-0">
            <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        `;
        return c.html(this.generateHTML('Error - Done Dashboard', content));
      }
    });

    // Individual message detail
    this.hono.get('/message/:id', async (c) => {
      try {
        const messageId = c.req.param('id');
        const page = c.req.query('page') || '1';
        const [message, logs] = await Promise.all([
          this.client.getMessage(messageId),
          this.client.getMessageLogs(messageId),
        ]);

        if (!message) {
          const content = `
            <div class="px-4 py-6 sm:px-0">
              <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                <strong>Error:</strong> Message not found
              </div>
              <div class="mt-4">
                <a href="/dashboard/messages?page=${page}" class="text-blue-600 hover:text-blue-900">← Back to Messages</a>
              </div>
            </div>
          `;
          return c.html(this.generateHTML('Message Not Found - Done Dashboard', content), 404);
        }

        const getStatusBadge = (status: string) => {
          const colors = {
            'CREATED': 'bg-blue-100 text-blue-800',
            'QUEUED': 'bg-yellow-100 text-yellow-800',
            'DELIVER': 'bg-purple-100 text-purple-800',
            'SENT': 'bg-green-100 text-green-800',
            'RETRY': 'bg-orange-100 text-orange-800',
            'DLQ': 'bg-red-100 text-red-800',
            'ARCHIVED': 'bg-gray-100 text-gray-800',
            'FAILED': 'bg-red-100 text-red-800',
          };
          return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';
        };

        const formatDate = (dateString: string) => {
          return new Date(dateString).toLocaleString();
        };

        const formatPayload = (payload: unknown) => {
          return JSON.stringify(payload, null, 2);
        };

        const formatHeaders = (headers: unknown) => {
          return JSON.stringify(headers, null, 2);
        };

        const content = `
          <div class="px-4 py-6 sm:px-0">
            <!-- Tab Navigation -->
            <div class="mb-8">
              <div class="border-b border-gray-200">
                <nav class="-mb-px flex space-x-8" aria-label="Tabs">
                  <a href="/dashboard" class="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Overview
                  </a>
                  <a href="/dashboard/messages" class="border-indigo-500 text-indigo-600 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
                    Messages
                  </a>
                </nav>
              </div>
            </div>
            
            <div class="mb-8 flex justify-between items-start">
              <!-- Action Buttons -->
              <div class="flex gap-3">
                <form method="POST" action="/dashboard/message/${message.id}/recreate?page=${page}">
                  <button
                    type="submit"
                    onclick="return confirm('Are you sure you want to recreate this message? This will create a new message with the same payload.')"
                    class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    🔄 Recreate Message
                  </button>
                </form>
                <a href="/dashboard/messages?page=${page}" class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500">
                  ← Back to Messages
                </a>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <!-- Main Content (2/3 width) -->
              <div class="lg:col-span-2 space-y-6">
                <div class="bg-white shadow rounded-lg p-6">
                  <h2 class="text-lg font-medium text-gray-900 mb-4">ID ${message.id}</h2>
                <dl class="space-y-3">
                  <div>
                    <dt class="text-sm font-medium text-gray-500">Status</dt>
                    <dd class="mt-1">
                      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(message.status)}">
                        ${message.status}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm font-medium text-gray-500">URL</dt>
                    <dd class="mt-1 text-sm text-gray-900 break-all">${message.url}</dd>
                  </div>
                  <div>
                    <dt class="text-sm font-medium text-gray-500">Retry Count</dt>
                    <dd class="mt-1 text-sm text-gray-900">${message.retry_count}</dd>
                  </div>
                  <div>
                    <dt class="text-sm font-medium text-gray-500">Created At</dt>
                    <dd class="mt-1 text-sm text-gray-900">${formatDate(message.created_at)}</dd>
                  </div>
                  <div>
                    <dt class="text-sm font-medium text-gray-500">Publish At</dt>
                    <dd class="mt-1 text-sm text-gray-900">${formatDate(message.publish_at)}</dd>
                  </div>
                  ${
          message.updated_at
            ? `
                  <div>
                    <dt class="text-sm font-medium text-gray-500">Updated At</dt>
                    <dd class="mt-1 text-sm text-gray-900">${formatDate(message.updated_at)}</dd>
                  </div>
                  `
            : ''
        }
                </dl>
              </div>

              <div class="bg-white shadow rounded-lg p-6">
                <h2 class="text-lg font-medium text-gray-900 mb-4">Headers</h2>
                ${
          message.headers && Object.keys(message.headers).length > 0
            ? `
                  <pre class="bg-gray-50 rounded p-4 text-sm overflow-x-auto"><code>${formatHeaders(message.headers)}</code></pre>
                `
            : '<p class="text-sm text-gray-500">No custom headers</p>'
        }
              </div>

              <div class="bg-white shadow rounded-lg p-6">
                <h2 class="text-lg font-medium text-gray-900 mb-4">Payload</h2>
                <pre class="bg-gray-50 rounded p-4 text-sm overflow-x-auto"><code>${formatPayload(message.payload)}</code></pre>
              </div>
            </div>

            <!-- Message History (1/3 width - floating right) -->
            <div class="lg:col-span-1">
              <div class="sticky top-6">
              <h2 class="text-lg font-medium text-gray-900 mb-4">Message History</h2>
              ${
          logs.length > 0
            ? `
                <div class="flow-root">
                  <ul role="list" class="-mb-8">
                    ${
              logs.map((log, index) => {
                const isLast = index === logs.length - 1;
                const eventDate = new Date(log.created_at);
                let eventDescription = '';
                let eventIcon = '';
                let iconBg = 'bg-gray-400';

                switch (log.type) {
                  case 'STORE_CREATE_EVENT':
                    eventDescription = 'Message created';
                    eventIcon = '✨';
                    iconBg = 'bg-blue-500';
                    break;
                  case 'STORE_UPDATE_EVENT':
                    if (log.before_data && log.after_data) {
                      const before = log.before_data as any;
                      const after = log.after_data as any;
                      if (before.status !== after.status) {
                        eventDescription = `Status changed from ${before.status} to ${after.status}`;

                        // Choose icon based on new status
                        switch (after.status) {
                          case 'QUEUED':
                            eventIcon = '⏱️';
                            iconBg = 'bg-yellow-500';
                            break;
                          case 'DELIVER':
                            eventIcon = '🚀';
                            iconBg = 'bg-purple-500';
                            break;
                          case 'SENT':
                            eventIcon = '✅';
                            iconBg = 'bg-green-500';
                            break;
                          case 'RETRY':
                            eventIcon = '🔄';
                            iconBg = 'bg-orange-500';
                            break;
                          case 'DLQ':
                            eventIcon = '❌';
                            iconBg = 'bg-red-500';
                            break;
                          default:
                            eventIcon = '📝';
                            iconBg = 'bg-gray-500';
                        }
                      } else {
                        eventDescription = 'Message updated';
                        eventIcon = '📝';
                        iconBg = 'bg-gray-500';
                      }
                    }
                    break;
                  default:
                    eventDescription = log.type.replace(/_/g, ' ').toLowerCase();
                    eventIcon = '📋';
                    iconBg = 'bg-gray-400';
                }

                return `
                        <li>
                          <div class="relative pb-8">
                            ${!isLast ? '<span class="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true"></span>' : ''}
                            <div class="relative flex space-x-3">
                              <div>
                                <span class="${iconBg} h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white">
                                  <span class="text-white text-sm">${eventIcon}</span>
                                </span>
                              </div>
                              <div class="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                <div>
                                  <p class="text-sm text-gray-900">${eventDescription}</p>
                                  ${
                  log.after_data && (log.after_data as any).last_errors
                    ? `
                                    <p class="mt-1 text-sm text-red-600">
                                      Error: ${((log.after_data as any).last_errors[0] || {}).message || 'Unknown error'}
                                    </p>
                                  `
                    : ''
                }
                                </div>
                                <div class="whitespace-nowrap text-right text-sm text-gray-500">
                                  <time datetime="${eventDate.toISOString()}">${eventDate.toLocaleString()}</time>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      `;
              }).join('')
            }
                  </ul>
                </div>
              `
            : '<p class="text-sm text-gray-500">No history available</p>'
        }
              </div>
            </div>
          </div>
        </div>
        `;

        return c.html(this.generateHTML(`Message ${message.id} - Done Dashboard`, content));
      } catch (error) {
        console.error('Message detail error:', error);
        const content = `
          <div class="px-4 py-6 sm:px-0">
            <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}
            </div>
          </div>
        `;
        return c.html(this.generateHTML('Error - Done Dashboard', content));
      }
    });

    // Handle message recreation
    this.hono.post('/message/:id/recreate', async (c) => {
      try {
        const messageId = c.req.param('id');
        const page = c.req.query('page') || '1';
        const message = await this.client.getMessage(messageId);

        if (!message) {
          return c.text('Message not found', 404);
        }

        const result = await this.client.recreateMessage(message);
        const content = `
          <div class="px-4 py-6 sm:px-0">
            <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-6">
              <strong>Success!</strong> Message recreated with ID: ${result.id}
              <br />
              <small>Scheduled for: ${new Date(result.publish_at).toLocaleString()}</small>
            </div>
            <div class="flex space-x-4">
              <a href="/dashboard/message/${messageId}?page=${page}" class="text-blue-600 hover:text-blue-900">← Back to Original Message</a>
              <a href="/dashboard/message/${result.id}?page=${page}" class="text-blue-600 hover:text-blue-900">View New Message →</a>
            </div>
          </div>
        `;
        return c.html(this.generateHTML('Message Recreated - Done Dashboard', content));
      } catch (error) {
        const messageId = c.req.param('id');
        const page = c.req.query('page') || '1';
        const content = `
          <div class="px-4 py-6 sm:px-0">
            <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
              <strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}
            </div>
            <a href="/dashboard/message/${messageId}?page=${page}" class="text-blue-600 hover:text-blue-900">← Back to Message</a>
          </div>
        `;
        return c.html(this.generateHTML('Recreation Failed - Done Dashboard', content));
      }
    });
  }

  getBasePath(): string {
    return '/dashboard';
  }

  getRoutes(): Hono {
    return this.hono;
  }
}
