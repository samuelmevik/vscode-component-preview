/**
 * HTML templates rendered inside the VS Code Webview panel.
 */

export function getWebviewContent(previewUrl: string, componentName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; frame-src * blob: data: http: https:; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #1e1e1e;
      position: relative;
    }
    #loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      background: #1e1e1e;
      z-index: 10;
      gap: 8px;
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-top-color: #007acc;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .ext-link {
      margin-top: 10px;
      font-size: 12px;
      color: #007acc;
      text-decoration: none;
    }
    .ext-link:hover {
      text-decoration: underline;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      position: absolute;
      top: 0;
      left: 0;
    }
  </style>
</head>
<body>
  <div id="loading-overlay">
    <div class="spinner"></div>
    <div>Loading preview for &lt;${componentName} /&gt;...</div>
    <a class="ext-link" href="${previewUrl}" target="_blank">Open in External Browser ↗</a>
  </div>
  <iframe 
    id="preview-iframe"
    src="${previewUrl}" 
    onload="document.getElementById('loading-overlay').style.display='none'"
  ></iframe>
  <script>
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('preview-iframe');

    // Forward messages from iframe (Harness) to VS Code extension host
    window.addEventListener('message', (event) => {
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'TOGGLE_LOCK' || event.data.type === 'STOP_SERVER' || event.data.type === 'CONSOLE_LOG') {
          vscode.postMessage(event.data);
        }
      }
    });

    // Forward messages from VS Code extension host to iframe (Harness)
    window.addEventListener('message', (event) => {
      if (iframe && iframe.contentWindow && event.source !== iframe.contentWindow) {
        iframe.contentWindow.postMessage(event.data, '*');
      }
    });
  </script>
</body>
</html>`;
}

export function getServerStoppedHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #1e1e1e;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-sizing: border-box;
      padding: 24px;
    }
    .card {
      background: #252526;
      border: 1px solid #3c3c3c;
      border-radius: 8px;
      padding: 32px 36px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 360px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    .icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
    }
    p {
      margin: 0 0 20px 0;
      font-size: 13px;
      color: #999999;
      line-height: 1.5;
    }
    .btn-start {
      background-color: #0e639c;
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background-color 0.15s ease;
    }
    .btn-start:hover {
      background-color: #1177bb;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛑</div>
    <h2>Preview Server Stopped</h2>
    <p>The background Vite preview server is currently turned off.</p>
    <button class="btn-start" id="start-btn">▶ Start Preview Server</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('start-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'START_SERVER' });
    });
  </script>
</body>
</html>`;
}
