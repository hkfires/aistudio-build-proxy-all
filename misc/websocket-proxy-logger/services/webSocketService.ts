
import {
  WebSocketProxyStatus,
  WSServerSentMessage,
  WSClientSentMessage,
  WSHttpRequestMessage,
  WSHttpResponseMessage,
  WSStreamStartMessage,
  WSStreamChunkMessage,
  WSStreamEndMessage,
  WSErrorMessage,
  WSPingMessage
} from '../types';
import { WEBSOCKET_PROXY_URL } from '../config'; // Import from new config file

const BASE_WEBSOCKET_URL = WEBSOCKET_PROXY_URL; // Use imported constant
const PING_INTERVAL_MS = 25 * 1000; // 25 seconds
const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30 * 1000;
const RECONNECT_JITTER_MS = 500;


// Numeric constants for WebSocket readyState
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

let socket: WebSocket | null = null;
let currentStatus: WebSocketProxyStatus = WebSocketProxyStatus.IDLE;
let onStatusChangeCallback: ((status: WebSocketProxyStatus, details?: string) => void) | null = null;
let pingIntervalId: number | null = null;
let reconnectTimeoutId: number | null = null;
let currentReconnectDelay = RECONNECT_INITIAL_DELAY_MS;
let explicitClose = false;
let currentJwtToken: string | null = null;

function updateStatus(newStatus: WebSocketProxyStatus, details?: string) {
  if (currentStatus === newStatus && !details) return; 
  currentStatus = newStatus;
  if (onStatusChangeCallback) {
    onStatusChangeCallback(currentStatus, details);
  }
  console.log(`WebSocket Proxy Status: ${currentStatus}${details ? ` - ${details}` : ''}`);
}

function sendToServer(message: WSClientSentMessage) {
  if (socket && socket.readyState === WS_OPEN) {
    try {
      const messageString = JSON.stringify(message);
      socket.send(messageString);
      // console.log("WebSocket Proxy: Sent message", message);
    } catch (error) {
      console.error("WebSocket Proxy: Error serializing message for sending:", error, message);
    }
  } else {
    console.warn("WebSocket Proxy: Cannot send message, socket not open.", message);
  }
}

async function handleHttpRequest(request: WSHttpRequestMessage) {
  const { id, payload } = request;
  let { method, url, headers, body } = payload; 

  if (method === 'GET') {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.endsWith('/v1beta/models') || parsedUrl.pathname.endsWith('/v1beta/models/')) {
        if (parsedUrl.searchParams.has('key')) {
          parsedUrl.searchParams.delete('key');
          url = parsedUrl.toString();
          console.log(`WebSocket Proxy: Modified URL for ${id} to remove 'key' param: ${url}`);
        }
      }
    } catch (e) {
      console.error(`WebSocket Proxy: Error parsing URL for modification for request ID ${id}: ${url}`, e);
    }
  }


  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (method !== 'GET' && method !== 'HEAD') {
    if (body !== undefined && body !== null) {
        fetchOptions.body = body;
    }
  }


  try {
    const response = await fetch(url, fetchOptions);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (response.body && typeof response.body.getReader === 'function') { 
      const streamStartMessage: WSStreamStartMessage = {
        id,
        type: "stream_start",
        payload: { status: response.status, headers: responseHeaders },
      };
      sendToServer(streamStartMessage);

      const reader = response.body.getReader();
      const decoder = new TextDecoder(); 

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkData = decoder.decode(value, { stream: true }); 
        const streamChunkMessage: WSStreamChunkMessage = {
          id,
          type: "stream_chunk",
          payload: { data: chunkData },
        };
        sendToServer(streamChunkMessage);
      }
      const finalChunk = decoder.decode();
      if (finalChunk) {
         const streamChunkMessage: WSStreamChunkMessage = {
          id,
          type: "stream_chunk",
          payload: { data: finalChunk },
        };
        sendToServer(streamChunkMessage);
      }


      const streamEndMessage: WSStreamEndMessage = {
        id,
        type: "stream_end",
        payload: {},
      };
      sendToServer(streamEndMessage);

    } else {
      const responseBodyText = await response.text();
      const httpResponseMessage: WSHttpResponseMessage = {
        id,
        type: "http_response",
        payload: {
          status: response.status,
          headers: responseHeaders,
          body: responseBodyText,
        },
      };
      sendToServer(httpResponseMessage);
    }
  } catch (error) {
    console.error(`WebSocket Proxy: Fetch error for request ID ${id} (${method} ${url}):`, error);
    const errorMessage: WSErrorMessage = {
      id,
      type: "error",
      payload: {
        code: "FETCH_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    if (error instanceof Response && error.status) { 
        errorMessage.payload.code = "HTTP_ERROR";
        errorMessage.payload.http_response = {
            status: error.status,
            headers: {}, 
            body: await error.text().catch(() => "Could not read error body"),
        };
    }
    sendToServer(errorMessage);
  }
}


function onSocketOpen() {
  updateStatus(WebSocketProxyStatus.CONNECTED);
  currentReconnectDelay = RECONNECT_INITIAL_DELAY_MS; 
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  startPing();
}

function onSocketMessage(event: MessageEvent) {
  try {
    const message = JSON.parse(event.data as string) as WSServerSentMessage;

    switch (message.type) {
      case "http_request":
        handleHttpRequest(message as WSHttpRequestMessage);
        break;
      case "pong":
        break;
      default:
        console.warn("WebSocket Proxy: Received unknown message type", message);
    }
  } catch (error) {
    console.error("WebSocket Proxy: Error parsing message from server or handling it:", error, event.data);
  }
}

function onSocketError(event: Event) {
  console.error("WebSocket Proxy: Socket error:", event);
}

function onSocketClose(event: CloseEvent) {
  stopPing();
  if (reconnectTimeoutId) { 
    return;
  }

  if (explicitClose) {
    updateStatus(WebSocketProxyStatus.IDLE, `Connection closed by client. Code: ${event.code}`);
    explicitClose = false; 
  } else {
    updateStatus(WebSocketProxyStatus.DISCONNECTED, `Connection closed. Code: ${event.code}, Reason: ${event.reason || 'N/A'}`);
    scheduleReconnect();
  }
  socket = null;
}

function startPing() {
  stopPing(); 
  pingIntervalId = window.setInterval(() => {
    const pingMsg: WSPingMessage = { type: "ping" };
    sendToServer(pingMsg);
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
}

function scheduleReconnect() {
  if (explicitClose || !currentJwtToken) { 
    updateStatus(WebSocketProxyStatus.IDLE, "Reconnection not attempted (explicit close or no token).");
    return;
  }
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId); 
  }

  const delayWithJitter = currentReconnectDelay + Math.random() * RECONNECT_JITTER_MS;
  updateStatus(WebSocketProxyStatus.RECONNECTING, `Attempting to reconnect in ${Math.round(delayWithJitter / 1000)}s...`);

  reconnectTimeoutId = window.setTimeout(() => {
    reconnectTimeoutId = null; 
    if (currentJwtToken) { 
        connect(currentJwtToken);
    } else {
        updateStatus(WebSocketProxyStatus.IDLE, "Reconnect aborted: JWT token became unavailable.");
    }
  }, delayWithJitter);

  currentReconnectDelay = Math.min(currentReconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
}


function connect(jwtToken: string) {
  if (!jwtToken) { // This check is still useful if connect is somehow called directly with a null/empty token
    updateStatus(WebSocketProxyStatus.ERROR, "JWT Token is required to connect.");
    return;
  }
  currentJwtToken = jwtToken; 

  if (socket && (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING)) {
    console.log("WebSocket Proxy: Already connected or connecting.");
    return;
  }

  explicitClose = false;
  updateStatus(WebSocketProxyStatus.CONNECTING);

  // Use BASE_WEBSOCKET_URL which is now derived from config.ts
  const wsUrl = `${BASE_WEBSOCKET_URL}?auth_token=${jwtToken}`;
  console.log(`WebSocket Proxy: Attempting to connect to ${wsUrl}`);

  try {
    socket = new WebSocket(wsUrl);
  } catch (error) {
    console.error("WebSocket Proxy: Instantiation error:", error);
    updateStatus(WebSocketProxyStatus.ERROR, `Failed to instantiate WebSocket: ${error instanceof Error ? error.message : String(error)}`);
    scheduleReconnect(); 
    return;
  }

  socket.onopen = onSocketOpen;
  socket.onmessage = onSocketMessage;
  socket.onerror = onSocketError;
  socket.onclose = onSocketClose;
}

function disconnect() {
  explicitClose = true;
  currentJwtToken = null; 
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  stopPing();
  if (socket) {
    if (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING) {
      socket.close(1000, "Client initiated disconnect"); 
    } else {
      onSocketClose({ code: 1000, reason: "Client initiated disconnect on non-open socket", wasClean: true } as CloseEvent);
    }
  } else {
     updateStatus(WebSocketProxyStatus.IDLE, "Disconnected (no active socket).");
  }
  socket = null; 
}

function setOnStatusChange(callback: ((status: WebSocketProxyStatus, details?: string) => void) | null) {
  onStatusChangeCallback = callback;
  if (onStatusChangeCallback) {
    onStatusChangeCallback(currentStatus);
  }
}

export const webSocketProxyManager = {
  connect,
  disconnect,
  setOnStatusChange,
};
