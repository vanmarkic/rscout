/**
 * rscout Cloudflare Worker
 *
 * A proxy worker that enables additional search sources for rscout web.
 * Deploy this to Cloudflare Workers (free tier: 100k requests/day).
 *
 * Setup:
 * 1. Create a new Worker at https://workers.cloudflare.com/
 * 2. Copy this code into the worker
 * 3. Add secrets via Workers Settings > Variables:
 *    - BRAVE_API_KEY (optional): Your Brave Search API key
 *    - SERP_API_KEY (optional): Your SerpAPI key
 * 4. Deploy and copy the worker URL
 * 5. Paste the URL in rscout's Search Sources settings
 *
 * Endpoints:
 * - POST /          - Generic CORS proxy (for SearXNG, DuckDuckGo)
 * - GET /brave      - Brave Search API proxy
 * - GET /serp       - SerpAPI proxy
 * - GET /health     - Health check
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health check
      if (path === '/health') {
        return jsonResponse({
          status: 'ok',
          brave: !!env.BRAVE_API_KEY,
          serp: !!env.SERP_API_KEY,
        });
      }

      // Brave Search API proxy
      if (path === '/brave') {
        return await handleBraveSearch(url, env);
      }

      // SerpAPI proxy
      if (path === '/serp') {
        return await handleSerpSearch(url, env);
      }

      // Generic CORS proxy (POST with { url, method, headers })
      if (request.method === 'POST') {
        return await handleCorsProxy(request);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
};

/**
 * Brave Search API proxy
 * Requires BRAVE_API_KEY secret
 */
async function handleBraveSearch(url, env) {
  if (!env.BRAVE_API_KEY) {
    return jsonResponse({ error: 'Brave API key not configured' }, 503);
  }

  const query = url.searchParams.get('q');
  const count = url.searchParams.get('count') || '10';

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

  const response = await fetch(braveUrl, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': env.BRAVE_API_KEY,
    },
  });

  const data = await response.json();
  return jsonResponse(data);
}

/**
 * SerpAPI proxy
 * Requires SERP_API_KEY secret
 */
async function handleSerpSearch(url, env) {
  if (!env.SERP_API_KEY) {
    return jsonResponse({ error: 'SerpAPI key not configured' }, 503);
  }

  const query = url.searchParams.get('q');
  const num = url.searchParams.get('num') || '10';

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${num}&api_key=${env.SERP_API_KEY}`;

  const response = await fetch(serpUrl);
  const data = await response.json();
  return jsonResponse(data);
}

/**
 * Generic CORS proxy
 * Accepts POST with JSON body: { url, method?, headers? }
 */
async function handleCorsProxy(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { url: targetUrl, method = 'GET', headers = {} } = body;

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing url in request body' }, 400);
  }

  // Security: Only allow specific domains
  const allowedDomains = [
    'searx.be',
    'search.bus-hit.me',
    'searx.tiekoetter.com',
    'search.ononoki.org',
    'lite.duckduckgo.com',
    'api.duckduckgo.com',
    'html.duckduckgo.com',
  ];

  const targetDomain = new URL(targetUrl).hostname;
  const isAllowed = allowedDomains.some(domain =>
    targetDomain === domain || targetDomain.endsWith('.' + domain)
  );

  if (!isAllowed) {
    return jsonResponse({
      error: 'Domain not allowed',
      domain: targetDomain,
      allowed: allowedDomains,
    }, 403);
  }

  // Make the proxied request
  const response = await fetch(targetUrl, {
    method,
    headers: {
      'User-Agent': 'rscout/1.0 (https://github.com/vanmarkic/rscout)',
      ...headers,
    },
  });

  // Get response body
  const contentType = response.headers.get('content-type') || '';
  let responseBody;

  if (contentType.includes('application/json')) {
    responseBody = await response.json();
    return jsonResponse(responseBody);
  } else {
    responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
      },
    });
  }
}

/**
 * Helper to create JSON responses with CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}
