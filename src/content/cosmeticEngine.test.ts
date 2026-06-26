import type { Rule } from "../shared/types";

// Mocking browser globals
const mockRulesInserted: string[] = [];

const sendMessageMock = async (msg: any) => {
  if (msg && msg.type === "INJECT_USER_CSS") {
    if (msg.remove) {
      const rulesToRemove = msg.css.split("\n").map((r: string) => r.trim()).filter(Boolean);
      for (const rule of rulesToRemove) {
        const idx = mockRulesInserted.findIndex(r => r.trim() === rule);
        if (idx !== -1) {
          mockRulesInserted.splice(idx, 1);
        }
      }
    } else {
      const rulesToAdd = msg.css.split("\n").map((r: string) => r.trim()).filter(Boolean);
      for (const rule of rulesToAdd) {
        mockRulesInserted.push(rule);
      }
    }
  }
};

(global as any).browser = {
  runtime: {
    id: "mock-id",
    sendMessage: sendMessageMock
  }
};
(global as any).chrome = (global as any).browser;

class MockCSSStyleSheet {
  cssRules: any[] = [];
  insertRule(rule: string, index: number) {
    if (rule.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    if (!rule.endsWith(" {}")) {
      mockRulesInserted.push(rule);
    }
    this.cssRules.splice(index, 0, rule);
    return index;
  }
  deleteRule(index: number) {
    this.cssRules.splice(index, 1);
  }
}

class MockElement {
  id: string = "";
  tagName: string;
  nodeType = 1; // Node.ELEMENT_NODE
  sheet = new MockCSSStyleSheet();
  textContent = "";
  children: MockElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  prepend(el: any) {
    this.children.unshift(el);
  }

  remove() {
    const idx = mockDocument.head.children.indexOf(this);
    if (idx !== -1) {
      mockDocument.head.children.splice(idx, 1);
    }
  }

  matches(selector: string): boolean {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    if (selector.startsWith(".") || selector.startsWith("#")) {
      // ponytail: simplified mock matches, class/id maps to id. Use proper parsing if full selector engine required.
      return this.id === selector.slice(1);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector: string): any {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
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
  getElementById(id: string) {
    if (id === "noai-rules") {
      return mockDocument.head.children.find((c) => c.id === id) || null;
    }
    return null;
  },
  createElement(tagName: string) {
    const el = new MockElement(tagName);
    return el;
  },
  querySelector(selector: string) {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    const inHead = mockDocument.head.querySelector(selector);
    if (inHead) return inHead;
    const inDoc = mockDocument.documentElement.querySelector(selector);
    if (inDoc) return inDoc;
    return null;
  },
  querySelectorAll(selector: string) {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    const results: any[] = [];
    const traverse = (el: MockElement) => {
      if (el.matches(selector)) results.push(el);
      for (const child of el.children) {
        traverse(child);
      }
    };
    traverse(mockDocument.documentElement);
    return results;
  }
};

// Expose globals
(global as any).document = mockDocument;
(global as any).Node = { ELEMENT_NODE: 1 };
(global as any).window = global;
(global as any).CSSStyleSheet = MockCSSStyleSheet;

let observerCallback: any = null;
class MockMutationObserver {
  constructor(cb: any) {
    observerCallback = cb;
  }
  observe(target: any, options: any) {}
  disconnect() {}
}
(global as any).MutationObserver = MockMutationObserver;

// Now dynamically require cosmeticEngine to avoid hoisting
const { init, setEnabled, countHidden } = require("./cosmeticEngine");

// Simple assert helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("❌ Assert failed:", message);
    process.exit(1);
  }
}

async function runTests() {
  console.log("Starting cosmetic filter engine unit tests...");

  // Setup initial DOM state
  const targetDiv = new MockElement("div");
  targetDiv.id = "target";
  mockDocument.documentElement.children.push(targetDiv);

  const rules: Rule[] = [
    { selector: "div", hostname: "google.com", isException: false, category: "searchSummaries", sourceListId: "1" },
    { selector: "span", hostname: null, isException: false, category: "chatAssistants", sourceListId: "1" }, // generic, not in DOM
    { selector: "div.invalidpseudo", hostname: "google.com", isException: false, category: "searchSummaries", sourceListId: "1" }, // invalid CSS rules
    { selector: "#target", hostname: null, isException: false, category: "searchSummaries", sourceListId: "1" }, // generic, in DOM
  ];

  mockRulesInserted.length = 0;
  await init(rules, 1, true);

  // R1 & R2: Domain rules and matched generic rules should be injected.
  // Invalid rule (invalidpseudo) should not cause crash.
  assert(mockRulesInserted.includes("div { display: none !important; }"), "Domain rule 'div' must be injected");
  assert(mockRulesInserted.includes("#target { display: none !important; }"), "Matched generic rule '#target' must be injected");
  assert(!mockRulesInserted.includes("span { display: none !important; }"), "Unmatched generic rule 'span' must not be injected initially");
  assert(!mockRulesInserted.includes("div.invalidpseudo { display: none !important; }"), "Invalid rule must not be injected");

  // R4: countHidden should return 1 (only targetDiv matches)
  const count = countHidden();
  assert(count === 1, `countHidden should return 1, got ${count}`);

  // R3: Simulate mutation adding 'span' to DOM
  const newSpan = new MockElement("span");
  newSpan.id = "late-span";
  mockDocument.documentElement.children.push(newSpan);

  // Trigger MutationObserver callback
  assert(observerCallback !== null, "MutationObserver callback must be set");
  observerCallback([
    {
      addedNodes: [newSpan],
    }
  ]);

  // Wait for debounce timer (150ms) to run
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Now 'span' should be injected
  assert(mockRulesInserted.includes("span { display: none !important; }"), "MutationObserver should have injected 'span' after it was added to DOM");

  // countHidden should now match targetDiv and newSpan (2 elements)
  const count2 = countHidden();
  assert(count2 === 2, `countHidden after mutation should return 2, got ${count2}`);

  console.log("✅ All cosmetic filter engine tests passed successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
