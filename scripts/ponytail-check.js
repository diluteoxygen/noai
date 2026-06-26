// ponytail-check.js
// ponytail: laziest, simplest self-contained check script

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Compile cosmeticEngine.ts for Node environment
const tempJs = path.join(__dirname, 'cosmeticEngine.tmp.js');
try {
  execSync(`npx esbuild src/content/cosmeticEngine.ts --bundle --platform=node --outfile="${tempJs}"`, { stdio: 'ignore' });
} catch (err) {
  console.error("Failed to compile cosmeticEngine:", err);
  process.exit(1);
}

// 2. Setup mock DOM
const mockRulesInserted = [];
class MockCSSStyleSheet {
  constructor() {
    this.cssRules = [];
  }
  insertRule(rule, index) {
    if (rule.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    mockRulesInserted.push(rule);
    this.cssRules.splice(index, 0, rule);
    return index;
  }
  deleteRule(index) {
    this.cssRules.splice(index, 1);
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = '';
    this.className = '';
    this.nodeType = 1;
    this.sheet = new MockCSSStyleSheet();
    this.textContent = '';
    this.children = [];
  }
  prepend(el) {
    this.children.unshift(el);
  }
  remove() {
    const idx = mockDocument.head.children.indexOf(this);
    if (idx !== -1) mockDocument.head.children.splice(idx, 1);
  }
  matches(selector) {
    if (selector.includes("invalidpseudo")) throw new Error("Syntax error");
    if (selector.startsWith('.')) return this.className === selector.slice(1);
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelector(selector) {
    if (selector.includes("invalidpseudo")) throw new Error("Syntax error");
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const sub = child.querySelector(selector);
      if (sub) return sub;
    }
    return null;
  }
}

const mockDocument = {
  head: new MockElement("head"),
  documentElement: new MockElement("html"),
  getElementById(id) {
    if (id === "noai-rules") {
      return mockDocument.head.children.find(c => c.id === id) || null;
    }
    return null;
  },
  createElement(tagName) {
    const el = new MockElement(tagName);
    return el;
  },
  querySelector(selector) {
    if (selector.includes("invalidpseudo")) throw new Error("Syntax error");
    return mockDocument.head.querySelector(selector) || mockDocument.documentElement.querySelector(selector);
  },
  querySelectorAll(selector) {
    if (selector.includes("invalidpseudo")) throw new Error("Syntax error");
    const res = [];
    const traverse = (el) => {
      if (el.matches(selector)) res.push(el);
      for (const child of el.children) traverse(child);
    };
    traverse(mockDocument.documentElement);
    return res;
  }
};

global.document = mockDocument;
global.Node = { ELEMENT_NODE: 1 };

let observerCallback = null;
class MockMutationObserver {
  constructor(cb) {
    observerCallback = cb;
  }
  observe() {}
  disconnect() {}
}
global.MutationObserver = MockMutationObserver;

// Load the compiled engine
const engine = require(tempJs);

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ Assert failed: ${msg}`);
    try { fs.unlinkSync(tempJs); } catch {}
    process.exit(1);
  }
}

async function run() {
  console.log("Running ponytail self-check...");

  // Setup initial DOM
  const target = new MockElement("div");
  target.id = "target";
  mockDocument.documentElement.children.push(target);

  const rules = [
    { selector: "invalidpseudo", hostname: "google.com", isException: false, category: "searchSummaries", sourceListId: "1" },
    { selector: "#target", hostname: null, isException: false, category: "searchSummaries", sourceListId: "1" }, // generic in DOM
    { selector: ".late-ad", hostname: null, isException: false, category: "searchSummaries", sourceListId: "1" } // generic not in DOM
  ];

  engine.init(rules, true, true);

  // Requirement 1: Resilient CSS Injection (invalid rule skipped, others injected)
  assert(mockRulesInserted.includes("#target { display: none !important; }"), "Resilient CSS Injection: target should be injected");
  assert(!mockRulesInserted.some(r => r.includes("invalidpseudo")), "Resilient CSS Injection: invalid selector must be skipped");

  // Requirement 2: Accurate Generic Rule Application
  assert(!mockRulesInserted.some(r => r.includes(".late-ad")), "Generic Rule: .late-ad not yet in DOM, must not be injected");

  // Requirement 3: MutationObserver triggers matching within 200ms
  const adNode = new MockElement("div");
  adNode.className = "late-ad";
  mockDocument.documentElement.children.push(adNode);

  assert(observerCallback !== null, "MutationObserver callback must be set");
  observerCallback([{ addedNodes: [adNode] }]);

  await new Promise(r => setTimeout(r, 180));
  assert(mockRulesInserted.includes(".late-ad { display: none !important; }"), "MutationObserver: .late-ad must be injected after callback");

  // Cleanup temp file
  fs.unlinkSync(tempJs);
  console.log("✅ Ponytail check passed successfully!");
}

run().catch(err => {
  console.error(err);
  try { fs.unlinkSync(tempJs); } catch {}
  process.exit(1);
});
