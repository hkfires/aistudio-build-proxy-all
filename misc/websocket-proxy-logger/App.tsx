
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogEntry, WebSocketProxyStatus } from './types';
import { webSocketProxyManager } from './services/webSocketService';
import { JWT_TOKEN } from './config'; // Import from new config file

const MAX_AUTO_CONNECT_TRIES = 3;

const App: React.FC = () => {
  const [logMessages, setLogMessages] = useState<LogEntry[]>([]);
  const [webSocketStatus, setWebSocketStatus] = useState<WebSocketProxyStatus>(WebSocketProxyStatus.IDLE);
  const [webSocketStatusDetails, setWebSocketStatusDetails] = useState<string | undefined>(undefined);
  const [jwtToken, setJwtToken] = useState<string | null>(null);

  const [autoConnectTryCount, setAutoConnectTryCount] = useState(0);
  const [initialAutoConnectSequenceDone, setInitialAutoConnectSequenceDone] = useState(false);
  
  const isAttemptingAutoConnectCurrently = useRef(false);
  const webSocketStatusRef = useRef<WebSocketProxyStatus>(webSocketStatus);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [logMessages]);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogMessages(prevLogs => [
      ...prevLogs,
      {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        timestamp: new Date().toISOString(),
        type,
        message,
      },
    ]);
  }, []);

  const handleClearLogs = useCallback(() => {
    setLogMessages([]);
    // Add a log entry to indicate logs were cleared, this will be the only log after clearing.
    // If you prefer a completely empty log area, you can remove the next line.
    addLog('Log display cleared by user.', 'info');
  }, [addLog]);

  useEffect(() => {
    // Use JWT_TOKEN from config.ts
    if (!JWT_TOKEN) {
      addLog("JWT_TOKEN is not configured in config.ts. WebSocket Proxy connection will not be possible if the server requires it.", 'jwt-warning');
    }
    setJwtToken(JWT_TOKEN); // This can be null, and the connect logic handles null JWT.
  }, [addLog]);

  // Update ref whenever webSocketStatus changes
  useEffect(() => {
    webSocketStatusRef.current = webSocketStatus;
  }, [webSocketStatus]);

  const handleWebSocketConnect = useCallback(() => {
    if (!jwtToken) { // jwtToken state is derived from JWT_TOKEN in config
      addLog('Cannot connect WebSocket Proxy: JWT_TOKEN is not configured in config.ts or is null. Please configure it if required by the server.', 'error');
      setWebSocketStatus(WebSocketProxyStatus.ERROR);
      setWebSocketStatusDetails("JWT_TOKEN is not available from config.ts.");
      if(isAttemptingAutoConnectCurrently.current) {
        const nextAttemptCount = autoConnectTryCount + 1;
        setAutoConnectTryCount(nextAttemptCount);
        if (nextAttemptCount >= MAX_AUTO_CONNECT_TRIES) {
          addLog(`Auto-connect failed after ${nextAttemptCount} attempts (JWT missing from config). No more automatic retries.`, 'error');
          isAttemptingAutoConnectCurrently.current = false;
          setInitialAutoConnectSequenceDone(true);
        }
      }
      return;
    }
    
    if (webSocketStatusRef.current !== WebSocketProxyStatus.CONNECTED && webSocketStatusRef.current !== WebSocketProxyStatus.CONNECTING) {
      if (!isAttemptingAutoConnectCurrently.current) {
         addLog('User initiated connection to WebSocket Proxy...', 'info');
      }
      webSocketProxyManager.connect(jwtToken);
    }
  }, [jwtToken, addLog, autoConnectTryCount]);


  const handleWebSocketDisconnect = useCallback(() => {
    isAttemptingAutoConnectCurrently.current = false; 
    setInitialAutoConnectSequenceDone(true); 
    
    if (webSocketStatusRef.current === WebSocketProxyStatus.CONNECTED || 
        webSocketStatusRef.current === WebSocketProxyStatus.CONNECTING || 
        webSocketStatusRef.current === WebSocketProxyStatus.RECONNECTING) {
      addLog('Attempting to disconnect WebSocket Proxy (user initiated)...', 'info');
      webSocketProxyManager.disconnect();
    }
  }, [addLog]);


  useEffect(() => {
    if (jwtToken && !initialAutoConnectSequenceDone && autoConnectTryCount === 0 && 
        (webSocketStatusRef.current === WebSocketProxyStatus.IDLE || webSocketStatusRef.current === WebSocketProxyStatus.ERROR) && 
        !isAttemptingAutoConnectCurrently.current ) {
      
      addLog(`Initiating auto-connection to WebSocket... (Attempt 1/${MAX_AUTO_CONNECT_TRIES})`, 'info');
      isAttemptingAutoConnectCurrently.current = true;
      handleWebSocketConnect();
    }
  }, [jwtToken, initialAutoConnectSequenceDone, autoConnectTryCount, handleWebSocketConnect, addLog]);
  

  useEffect(() => {
    const statusChangeCallback = (status: WebSocketProxyStatus, details?: string) => {
      const previousStatus = webSocketStatusRef.current;
      
      setWebSocketStatus(status);
      setWebSocketStatusDetails(details);
      
      const statusMessageContent = `WebSocket Proxy Status: ${status}${details ? ` - ${details}` : ''}`;
      addLog(statusMessageContent, status === WebSocketProxyStatus.ERROR ? 'error' : 'status');

      if (isAttemptingAutoConnectCurrently.current) {
        if (status === WebSocketProxyStatus.CONNECTED) {
          addLog('Auto-connect successful.', 'status');
          isAttemptingAutoConnectCurrently.current = false;
          setInitialAutoConnectSequenceDone(true);
          setAutoConnectTryCount(0); 
        } else if (
          (previousStatus === WebSocketProxyStatus.CONNECTING || previousStatus === WebSocketProxyStatus.RECONNECTING) &&
          (status === WebSocketProxyStatus.DISCONNECTED || status === WebSocketProxyStatus.ERROR)
        ) {
          const nextAttemptCount = autoConnectTryCount + 1;
          setAutoConnectTryCount(nextAttemptCount);

          if (nextAttemptCount < MAX_AUTO_CONNECT_TRIES) {
            addLog(`Auto-connect attempt ${nextAttemptCount} failed. Retrying... (Attempt ${nextAttemptCount + 1}/${MAX_AUTO_CONNECT_TRIES})`, 'info');
            setTimeout(() => {
              if (isAttemptingAutoConnectCurrently.current && 
                  webSocketStatusRef.current !== WebSocketProxyStatus.CONNECTED &&
                  webSocketStatusRef.current !== WebSocketProxyStatus.CONNECTING) {
                handleWebSocketConnect();
              } else if (!isAttemptingAutoConnectCurrently.current) {
                setInitialAutoConnectSequenceDone(true);
              }
            }, 1000); 
          } else {
            addLog(`Auto-connect failed after ${MAX_AUTO_CONNECT_TRIES} attempts. No more automatic retries.`, 'error');
            isAttemptingAutoConnectCurrently.current = false;
            setInitialAutoConnectSequenceDone(true);
          }
        }
      } else if (status === WebSocketProxyStatus.CONNECTED) {
        setInitialAutoConnectSequenceDone(true); 
        setAutoConnectTryCount(0); 
      }
    };
    
    webSocketProxyManager.setOnStatusChange(statusChangeCallback);

    return () => {
      webSocketProxyManager.setOnStatusChange(null);
    };
  }, [addLog, autoConnectTryCount, handleWebSocketConnect]);
  
  const getLogEntryColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':
      case 'jwt-warning':
        return 'text-red-400';
      case 'status':
        return 'text-sky-300';
      case 'info':
      case 'ws-event':
        return 'text-gray-300';
      default:
        return 'text-gray-100';
    }
  };

  const getWebSocketStatusText = () => {
    let text = `${webSocketStatus}`;
    if (webSocketStatusDetails) {
      text += ` - ${webSocketStatusDetails}`;
    }
    return text;
  };

  const getWebSocketStatusIndicatorClass = (status: WebSocketProxyStatus): string => {
    switch (status) {
      case WebSocketProxyStatus.CONNECTED:
        return 'bg-green-500';
      case WebSocketProxyStatus.CONNECTING:
      case WebSocketProxyStatus.RECONNECTING:
        return 'bg-yellow-500';
      case WebSocketProxyStatus.DISCONNECTED:
      case WebSocketProxyStatus.ERROR:
        return 'bg-red-500';
      case WebSocketProxyStatus.IDLE:
      default:
        return 'bg-gray-500';
    }
  };
  
  const wsStatusText = getWebSocketStatusText();
  const isWsConnecting = webSocketStatus === WebSocketProxyStatus.CONNECTING;
  const isWsReconnecting = webSocketStatus === WebSocketProxyStatus.RECONNECTING;
  const isWsConnected = webSocketStatus === WebSocketProxyStatus.CONNECTED;

  const canConnectManually = !isWsConnected && !isWsConnecting && !isWsReconnecting;
  const canDisconnectManually = isWsConnected || isWsConnecting || isWsReconnecting;


  return (
    <div className="flex flex-col h-screen bg-gray-800 text-gray-100">
      {/* Row 1: WS Controls - Enhanced Styling */}
      <div className="p-2 border-b border-gray-700 flex items-center justify-between text-lg bg-gray-850">
        <div 
          className="flex items-center text-gray-300"
          title={wsStatusText}
          aria-live="polite"
        >
          <span 
            className={`w-3 h-3 rounded-full mr-2 inline-block flex-shrink-0 ${getWebSocketStatusIndicatorClass(webSocketStatus)}`}
            aria-hidden="true"
          ></span>
          <span>WS: {webSocketStatus}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              isAttemptingAutoConnectCurrently.current = false; 
              setInitialAutoConnectSequenceDone(true); 
              handleWebSocketConnect();
            }}
            disabled={!canConnectManually || isAttemptingAutoConnectCurrently.current} 
            className="px-4 py-1.5 text-lg border border-gray-600 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Connect WebSocket Proxy"
            aria-label="Connect WebSocket Proxy"
          >
            Connect
          </button>
          <button
            onClick={handleWebSocketDisconnect}
            disabled={!canDisconnectManually}
            className="px-4 py-1.5 text-lg border border-gray-600 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Disconnect WebSocket Proxy"
            aria-label="Disconnect WebSocket Proxy"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Row 2: Logs */}
      <div className="relative flex-grow p-2 sm:p-4 overflow-y-auto bg-gray-900 log-area">
        {logMessages.length > 0 && (
          <button
            onClick={handleClearLogs}
            className="absolute top-2 right-2 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded shadow-md z-10"
            title="Clear all logs"
            aria-label="Clear all logs"
          >
            Clear Logs
          </button>
        )}
        {logMessages.length === 0 && (
          <div className="text-center text-gray-500 italic mt-4">Log is empty. Connect to WebSocket to see messages.</div>
        )}
        {logMessages.map((log) => (
          <div key={log.id} className={`mb-1.5 p-1.5 rounded text-xs font-mono break-all ${getLogEntryColor(log.type)}`}>
            <span className="text-gray-500 mr-2">
              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.{new Date(log.timestamp).getMilliseconds().toString().padStart(3, '0')}
            </span>
            <span className="font-semibold mr-1">[{log.type.toUpperCase()}]</span>
            <span>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default App;
