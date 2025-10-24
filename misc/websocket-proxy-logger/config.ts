// =====================================================================================
// IMPORTANT: WebSocket Connection Configuration
// =====================================================================================
// Please update the following values before running the application.
// These settings are essential for connecting to your WebSocket Proxy service.
//
// If JWT_TOKEN is not required by your WebSocket proxy, you can set it to null.
// However, if your proxy *does* require a token, ensure a valid token string is provided.
// =====================================================================================

/**
 * The JWT token required for authenticating with the WebSocket Proxy service.
 * Set to `null` if your WebSocket proxy does not require JWT authentication.
 *
 * @example "your-super-secret-jwt-token"
 * @example null
 */
export const JWT_TOKEN: string | null = "valid-token-user-1";

/**
 * The full URL of your WebSocket Proxy service.
 *
 * @example "ws://127.0.0.1:5345/v1/ws"
 * @example "wss://your-proxy.example.com/v1/ws"
 */
export const WEBSOCKET_PROXY_URL: string = "ws://127.0.0.1:5345/v1/ws";
