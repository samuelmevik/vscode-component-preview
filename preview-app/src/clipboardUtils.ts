/**
 * Utility to reliably copy text to the clipboard across different environments:
 * 1. Inside VS Code Webview iframe (bridged to VS Code host via postMessage to vscode.env.clipboard)
 * 2. Browser standard Navigator Clipboard API (wrapped in try/catch to absorb Permissions Policy restrictions)
 * 3. Document execCommand fallback (for restricted/older iframe contexts)
 * 4. Preview server HTTP endpoint fallback (/__preview_api/copy)
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  let postMessageSent = false;

  // 1. Post to parent window (VS Code Webview -> Extension Host -> vscode.env.clipboard.writeText)
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'COPY_TO_CLIPBOARD',
          payload: { text },
        },
        '*'
      );
      postMessageSent = true;
    }
  } catch {
    // Ignore cross-origin frame access errors
  }

  // 2. Try native Navigator Clipboard API inside a safe try/catch block
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Catch Permissions Policy NotAllowedError, unfocused document error, etc.
    }
  }

  // 3. Fallback to legacy document.execCommand('copy') with off-screen textarea
  try {
    if (typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        return true;
      }
    }
  } catch {
    // Ignore execCommand errors
  }

  // 4. Fallback to Vite server HTTP endpoint if available
  try {
    if (typeof fetch === 'function') {
      fetch('/__preview_api/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => {});
    }
  } catch {}

  // If in an iframe, the message was dispatched to the VS Code host
  return postMessageSent;
}
