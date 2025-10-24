
export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'error' | 'status' | 'jwt-warning' | 'ws-event';
  message: string;
}

// WebSocket Proxy Service Types
export enum WebSocketProxyStatus {
  IDLE = 'IDLE', // Initial state, or after explicit disconnect
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING', // Attempting to reconnect
  DISCONNECTED = 'DISCONNECTED', // Unexpectedly lost connection
  ERROR = 'ERROR', // Connection error or other WebSocket error
}

// Messages sent from Client (this app) to WebSocket Server
export interface WSPingMessage {
  type: "ping";
}

export interface WSHttpResponsePayload {
  status: number;
  headers: Record<string, string>;
  body: string; // response.text()
}
export interface WSHttpResponseMessage {
  id: string; // from the original http_request
  type: "http_response";
  payload: WSHttpResponsePayload;
}

export interface WSStreamStartPayload {
  status: number;
  headers: Record<string, string>;
}
export interface WSStreamStartMessage {
  id: string; // from the original http_request
  type: "stream_start";
  payload: WSStreamStartPayload;
}

export interface WSStreamChunkPayload {
  data: string; // decoded chunk
}
export interface WSStreamChunkMessage {
  id: string; // from the original http_request
  type: "stream_chunk";
  payload: WSStreamChunkPayload;
}

export interface WSStreamEndPayload {} // Can be empty
export interface WSStreamEndMessage {
  id: string; // from the original http_request
  type: "stream_end";
  payload: WSStreamEndPayload;
}

export interface WSErrorPayload {
  code: string; // e.g., "FETCH_ERROR", "HTTP_ERROR", "STREAM_ERROR"
  message: string;
  http_response?: { // Optional: if it's an HTTP error, include details
    status: number;
    headers: Record<string, string>;
    body: string;
  };
}
export interface WSErrorMessage {
  id: string; // from the original http_request
  type: "error";
  payload: WSErrorPayload;
}

export type WSClientSentMessage = WSPingMessage | WSHttpResponseMessage | WSStreamStartMessage | WSStreamChunkMessage | WSStreamEndMessage | WSErrorMessage;


// Messages received by Client (this app) from WebSocket Server
export interface WSHttpRequestPayload {
  method: string; // "GET", "POST", etc.
  url: string;
  headers: Record<string, string>;
  body?: string; // Should be a JSON string if present
}
export interface WSHttpRequestMessage {
  id: string; // Unique request ID
  type: "http_request";
  payload: WSHttpRequestPayload;
}

export interface WSPongMessage {
  type: "pong";
}

export type WSServerSentMessage = WSHttpRequestMessage | WSPongMessage;
