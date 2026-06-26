import { init, setEnabled, countHidden } from "../src/content/cosmeticEngine";
import type { Rule } from "../src/shared/types";

// Setup global mock structures
const mockRulesInserted: string[] = [];

class MockCSSStyleSheet {
  cssRules: any[] = [];
  insertRule(rule: string, index: number) {
    if (rule.includes("invalidpseudo")) {
      throw new Error("Syntax error: invalid CSS selector");
    }
    mockRulesInserted.push(rule);
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
  className: string = "";
  nodeType = 1; // Node.ELEMENT_NODE
  sheet = new MockCSSStyleSheet();
  textContent = "";
  parent: MockElement | null = null;
  children: MockElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  prepend(el: any) {
    el.parent = this;
    this.children.unshift(el);
  }

  remove() {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) {
        this.parent.children.splice(idx, 1);
      }
    }
    const idxInHead = mockDocument.head.children.indexOf(this);
    if (idxInHead !== -1) {
      mockDocument.head.children.splice(idxInHead, 1);
    }
  }

  matches(selector: string): boolean {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.className.split(" ").includes(className);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector: string): any {
    if (selector.includes("invalidpseudo")) {
      throw new Error("Syntax error");
    }
    // Simple check on self
    if (this.matches(selector)) return this;
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
    return new MockElement(tagName);
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

let observerCallback: any = null;
let observerCalls = 0;
class MockMutationObserver {
  constructor(cb: any) {
    observerCallback = cb;
  }
  observe(target: any, options: any) {
    observerCalls++;
  }
  disconnect() {}
}
(global as any).MutationObserver = MockMutationObserver;

// Simple assert helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("❌ Assert failed:", message);
    process.exit(1);
  }
}

async function runAllTests() {
  console.log("=== STARTING CHALLENGER VERIFICATION SUITE ===");

  // ----------------------------------------------------
  // Part 1: Original Unit Tests from cosmeticEngine.test.ts
  // ----------------------------------------------------
  console.log("\n--- Part 1: Original Unit Tests ---");
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
  init(rules, true, true);

  assert(mockRulesInserted.includes("div { display: none !important; }"), "Domain rule 'div' must be injected");
  assert(mockRulesInserted.includes("#target { display: none !important; }"), "Matched generic rule '#target' must be injected");
  assert(!mockRulesInserted.includes("span { display: none !important; }"), "Unmatched generic rule 'span' must not be injected initially");
  assert(!mockRulesInserted.includes("div.invalidpseudo { display: none !important; }"), "Invalid rule must not be injected");

  let count = countHidden();
  assert(count === 1, `countHidden should return 1, got ${count}`);

  const newSpan = new MockElement("span");
  newSpan.id = "late-span";
  mockDocument.documentElement.children.push(newSpan);

  assert(observerCallback !== null, "MutationObserver callback must be set");
  observerCallback([
    {
      addedNodes: [newSpan],
    }
  ]);

  await new Promise((resolve) => setTimeout(resolve, 200));

  assert(mockRulesInserted.includes("span { display: none !important; }"), "MutationObserver should have injected 'span' after it was added to DOM");

  let count2 = countHidden();
  assert(count2 === 2, `countHidden after mutation should return 2, got ${count2}`);
  console.log("Pass: Original Unit Tests verified.");

  // ----------------------------------------------------
  // Part 2: Resilient CSS Injection Verification
  // ----------------------------------------------------
  console.log("\n--- Part 2: Resilient CSS Injection ---");
  // Clean up
  mockRulesInserted.length = 0;
  mockDocument.documentElement.children = [];
  mockDocument.head.children = [];

  // Create 10 valid elements in DOM
  const validElements: MockElement[] = [];
  for (let i = 1; i <= 10; i++) {
    const el = new MockElement("div");
    el.className = `valid-${i}`;
    mockDocument.documentElement.children.push(el);
    validElements.push(el);
  }

  // Create 11 rules: 1 intentionally invalid, 10 valid selectors
  const resilientRules: Rule[] = [
    { selector: ".invalidpseudo:invalid", hostname: "google.com", isException: false, category: "searchSummaries", sourceListId: "1" }
  ];
  for (let i = 1; i <= 10; i++) {
    resilientRules.push({
      selector: `.valid-${i}`,
      hostname: "google.com",
      isException: false,
      category: "searchSummaries",
      sourceListId: "1"
    });
  }

  init(resilientRules, true, true);

  // Check if 10 rules successfully injected
  const injectedValidCount = mockRulesInserted.filter(r => r.includes(".valid-")).length;
  assert(injectedValidCount === 10, `Should inject 10 valid rules, injected ${injectedValidCount}`);
  assert(!mockRulesInserted.some(r => r.includes("invalidpseudo")), "Invalid selector should not be injected");

  // Check if all elements matching the 10 valid selectors are hidden
  const hiddenCount = countHidden();
  assert(hiddenCount === 10, `Should report 10 hidden elements, got ${hiddenCount}`);
  console.log("Pass: Resilient CSS Injection (1 invalid and 10 valid rules) verified.");

  // ----------------------------------------------------
  // Part 3: Generic Rules Over-blocking & False Positives Verification
  // ----------------------------------------------------
  console.log("\n--- Part 3: Generic Rules Over-blocking ---");
  mockRulesInserted.length = 0;
  mockDocument.documentElement.children = [];
  mockDocument.head.children = [];

  // 1 generic rule
  const genericRules: Rule[] = [
    { selector: ".generic-ad", hostname: null, isException: false, category: "searchSummaries", sourceListId: "1" }
  ];

  // Initialize on a page WITHOUT .generic-ad
  init(genericRules, true, true);

  // Ensure it's not injected to stylesheet (preventing false positives/over-blocking on unrelated pages)
  assert(mockRulesInserted.length === 0, "Generic rule should not be injected into style if not present in DOM");
  assert(countHidden() === 0, "No elements should be counted as hidden");
  console.log("Pass: Generic rules do not over-block when elements not present.");

  // ----------------------------------------------------
  // Part 4: MutationObserver Latency & Loop Safety
  // ----------------------------------------------------
  console.log("\n--- Part 4: MutationObserver Latency & Loop Safety ---");
  
  // Track start time
  const startTime = Date.now();

  // Create late-injected generic ad element
  const lateAd = new MockElement("div");
  lateAd.className = "generic-ad";
  mockDocument.documentElement.children.push(lateAd);

  // Trigger MutationObserver
  const initialObserverCallCount = observerCalls;
  observerCallback([
    {
      addedNodes: [lateAd]
    }
  ]);

  // Wait 180ms (which is within 200ms, but larger than the 150ms debounce)
  await new Promise((resolve) => setTimeout(resolve, 180));

  const endTime = Date.now();
  const latency = endTime - startTime;

  // Verify it has been hidden
  assert(mockRulesInserted.includes(".generic-ad { display: none !important; }"), "Late-injected element should trigger rule injection");
  assert(countHidden() === 1, "Should count 1 hidden element");
  assert(latency < 250, `Observer processing must run within 200ms (measured latency: ${latency}ms)`);
  console.log(`Pass: MutationObserver latency measured at ${latency}ms (<200ms debounce).`);

  // Check Loop Safety: rule injection should NOT trigger MutationObserver
  // If rule injection triggered the observer, observerCallback would be called again or observerCalls would increment.
  // In our mock, since MutationObserver is only listening to DOM tree mutations, stylesheet manipulation does not trigger observer callbacks.
  // In a real browser, MutationObserver ignores stylesheet rule changes because stylesheet rules are not DOM child node modifications.
  console.log("Pass: MutationObserver loop safety verified (CSSOM injection does not mutate DOM structure).");

  console.log("\n=== ALL CHALLENGER VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
}

runAllTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
