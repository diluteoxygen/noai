import browser from "webextension-polyfill";

let isActive = false;
let highlightedElement: HTMLElement | null = null;

const OVERLAY_STYLE_ID = "noai-eraser-styles";
const UI_CONTAINER_ID = "noai-eraser-ui";
const HIGHLIGHT_OVERLAY_ID = "noai-eraser-highlight-overlay";

let highlightOverlay: HTMLElement | null = null;

function injectStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    body.noai-eraser-active * {
      cursor: crosshair !important;
    }
    #${HIGHLIGHT_OVERLAY_ID} {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483646 !important; /* Just below UI container */
      outline: 2px solid #ffaa00 !important;
      background-color: rgba(255, 170, 0, 0.35) !important;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3) inset !important;
      transition: all 0.05s linear !important;
      display: none;
    }
    #${UI_CONTAINER_ID} {
      position: fixed !important;
      top: 50% !important;
      right: 20px !important;
      transform: translateY(-50%) !important;
      background: #1c1c1e !important;
      color: #f2f2f7 !important;
      padding: 16px 20px !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 16px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 16px !important;
      border: 1px solid #3a3a3c !important;
    }
    #${UI_CONTAINER_ID} span {
      font-weight: 600 !important;
      letter-spacing: 0.2px !important;
      white-space: nowrap !important;
    }
    #${UI_CONTAINER_ID} button {
      background: #3a3a3c !important;
      color: #f2f2f7 !important;
      border: none !important;
      border-radius: 8px !important;
      width: 64px !important;
      height: 64px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: background 0.15s ease, transform 0.1s ease !important;
    }
    #${UI_CONTAINER_ID} button:hover {
      background: #ff453a !important;
      transform: scale(1.05) !important;
    }
    #${UI_CONTAINER_ID} button:active {
      transform: scale(0.95) !important;
    }
  `;
  document.head.appendChild(style);

  if (!document.getElementById(HIGHLIGHT_OVERLAY_ID)) {
    highlightOverlay = document.createElement("div");
    highlightOverlay.id = HIGHLIGHT_OVERLAY_ID;
    document.documentElement.appendChild(highlightOverlay);
  } else {
    highlightOverlay = document.getElementById(HIGHLIGHT_OVERLAY_ID);
  }

  if (!document.getElementById(UI_CONTAINER_ID)) {
    const ui = document.createElement("div");
    ui.id = UI_CONTAINER_ID;
    
    const text = document.createElement("span");
    text.textContent = "AI Eraser";
    
    const btn = document.createElement("button");
    btn.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    btn.title = "Quit Eraser (Esc)";
    btn.addEventListener("click", stopEraser);
    
    ui.appendChild(text);
    ui.appendChild(btn);
    document.documentElement.appendChild(ui);
  }
}

function removeStyles() {
  const style = document.getElementById(OVERLAY_STYLE_ID);
  if (style) style.remove();
  const ui = document.getElementById(UI_CONTAINER_ID);
  if (ui) ui.remove();
  const overlay = document.getElementById(HIGHLIGHT_OVERLAY_ID);
  if (overlay) overlay.remove();
  highlightOverlay = null;
}

function stopEraser() {
  if (!isActive) return;
  isActive = false;
  document.body.classList.remove("noai-eraser-active");
  removeStyles();
  highlightedElement = null;
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("scroll", onScroll, true);
}

export function toggleEraser() {
  if (isActive) {
    stopEraser();
  } else {
    startEraser();
  }
}

function startEraser() {
  if (isActive) return;
  isActive = true;
  document.body.classList.add("noai-eraser-active");
  injectStyles();
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);
}

function updateOverlay() {
  if (!isActive || !highlightOverlay) return;
  if (!highlightedElement) {
    highlightOverlay.style.display = 'none';
    return;
  }
  const rect = highlightedElement.getBoundingClientRect();
  highlightOverlay.style.display = 'block';
  highlightOverlay.style.top = rect.top + 'px';
  highlightOverlay.style.left = rect.left + 'px';
  highlightOverlay.style.width = rect.width + 'px';
  highlightOverlay.style.height = rect.height + 'px';
}

function onScroll() {
  updateOverlay();
}

function onMouseMove(e: MouseEvent) {
  if (!isActive) return;
  const target = e.target as HTMLElement;
  if (target === highlightedElement) return;
  
  if (target && target.nodeType === Node.ELEMENT_NODE) {
    if (target.closest(`#${UI_CONTAINER_ID}`)) {
      highlightedElement = null;
      updateOverlay();
      return; 
    }
    highlightedElement = target;
    updateOverlay();
  }
}

function onClick(e: MouseEvent) {
  if (!isActive) return;
  
  const target = e.target as HTMLElement;
  if (target && target.closest(`#${UI_CONTAINER_ID}`)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  
  const selector = generateSelector(target);
  if (selector) {
    browser.runtime.sendMessage({
      type: "ADD_MY_RULE",
      selector,
      hostname: location.hostname
    }).catch(console.error);
  }
  
  stopEraser();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    stopEraser();
  }
}

// Resilient CSS selector generator
function generateSelector(el: HTMLElement): string | null {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

  // 1. If it has a valid, unique ID, use it.
  if (el.id && /^[a-zA-Z][\w\-]*$/.test(el.id)) {
    const idSelector = `#${el.id}`;
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch {}
  }

  const path: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== 'html' && current.tagName.toLowerCase() !== 'body') {
    let selector = current.tagName.toLowerCase();

    // Try to use ID if it's safe
    if (current.id && /^[a-zA-Z][\w\-]*$/.test(current.id)) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break; // Safe to stop climbing
    }

    // Filter dynamic utility classes
    const classes = Array.from(current.classList).filter(c => 
      !c.startsWith('css-') && !c.includes(':') && /^[a-zA-Z][\w\-]*$/.test(c)
    );

    if (classes.length > 0) {
      // Use up to 3 classes to avoid overly brittle selectors
      selector += `.${classes.slice(0, 3).join('.')}`;
    } else {
      // Fallback to nth-of-type
      let sibling = current.previousElementSibling;
      let index = 1;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }

  if (path.length === 0) return null;

  const fullSelector = path.join(' > ');
  
  try {
    if (document.querySelector(fullSelector)) {
      return fullSelector;
    }
  } catch (e) {
    // Selector generation syntax error
  }
  
  return null;
}
