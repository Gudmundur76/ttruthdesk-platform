#!/usr/bin/env node
// /tmp/cbm-bridge.mjs — HTTP-to-MCP bridge for codebase-memory-mcp
// Handles session lifecycle automatically. Each SSE connection gets isolated stdio process.

import http from 'http';
import { spawn } from 'child_process';
import { URL } from 'url';
import { randomUUID } from 'crypto';

const PORT = process.env.MCP_PORT || 8811;
const MCP_BINARY = process.env.MCP_BINARY || 'codebase-memory-mcp';

// Store active sessions
const sessions = new Map();

// MCP JSON-RPC request wrapper
function mcpRequest(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
    params,
  };
}

// Spawn MCP child process for a session
function createSession(sessionId) {
  const child = spawn(MCP_BINARY, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.env.MCP_CWD || '/home/ubuntu',
  });

  let buffer = '';
  const pending = new Map();

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const pendingReq = pending.get(msg.id);
        if (pendingReq) {
          pending.delete(msg.id);
          pendingReq.resolve(msg);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  });

  child.stderr.on('data', (d) => {
    console.error(`[mcp ${sessionId}]`, d.toString().trim());
  });

  child.on('exit', (code) => {
    console.log(`[mcp ${sessionId}] exited with code ${code}`);
    sessions.delete(sessionId);
  });

  const session = {
    id: sessionId,
    child,
    pending,
    request: (method, params) => {
      return new Promise((resolve, reject) => {
        const req = mcpRequest(method, params);
        pending.set(req.id, { resolve, reject, timer: setTimeout(() => {
          pending.delete(req.id);
          reject(new Error(`Timeout: ${method}`));
        }, 30000) });
        child.stdin.write(JSON.stringify(req) + '\n');
      });
    },
  };

  // Initialize the MCP connection
  session.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'evolva-bridge', version: '1.0.0' },
  }).then(() => {
    // Send initialized notification
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  });

  sessions.set(sessionId, session);
  return session;
}

// HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE endpoint
  if (url.pathname === '/sse') {
    const sessionId = randomUUID();
    const session = createSession(sessionId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send endpoint event
    res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

    // Keepalive
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      session.child.kill();
      sessions.delete(sessionId);
      console.log(`[sse] Session ${sessionId} closed`);
    });

    return;
  }

  // Message endpoint
  if (url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found. Connect to /sse first.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        const session = sessions.get(sessionId);

        // Notifications have no id — fire and forget, no response expected
        if (!msg.id) {
          session.child.stdin.write(JSON.stringify(msg) + '\n');
          res.writeHead(202);
          res.end();
          return;
        }

        const result = await session.request(msg.method, msg.params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      sessions: sessions.size,
      uptime: process.uptime(),
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found. Use /sse or /message?sessionId=<id>');
});

server.listen(PORT, () => {
  console.log(`[bridge] codebase-memory-mcp HTTP bridge on port ${PORT}`);
  console.log(`[bridge] SSE: http://localhost:${PORT}/sse`);
  console.log(`[bridge] Health: http://localhost:${PORT}/health`);
});
