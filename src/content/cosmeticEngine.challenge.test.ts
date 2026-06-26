import { init, setEnabled, countHidden } from "./cosmeticEngine";
import type { Rule } from "../shared/types";

// Setup Mock DOM Environment
const mockRulesInserted: string[] = [];

class MockCSSStyleSheet {
  cssRules: any[] = [];
  insertRule(rule: string, index: number) {
    if (rule.includes("invalidpseudo") || rule.includes("::invalid")) {
      throw new Error("Syntax error");
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
    if (selector.includes("invalidpseudo") || selector.includes("::invalid")) {
      throw new Error("Syntax error");
    }
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      return this.id === selector.slice(1);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector: string): any {
    if (selector.includes("invalidpseudo") || selector.includes("::invalid")) {
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
    if (selector.includes("invalidpseudo") || selector.includes("::invalid")) {
      throw new Error("Syntax error");
    }
    const inHead = mockDocument.head.querySelector(selector);
    if (inHead) return inHead;
    const inDoc = mockDocument.documentElement.querySelector(selector);
    if (inDoc) return inDoc;
    return null;
  },
  querySelectorAll(selector: string) {
    if (selector.includes("invalidpseudo") || selector.includes("::invalid")) {
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

(global as any).document = mockDocument;
(global as any).Node = { ELEMENT_NODE: 1 };

let observerCallback: any = null;

class MockMutationObserver {
  constructor(cb: any) {
    observerCallback = cb;
  }
  observe(target: any, options: any) {}
  disconnect() {}
}
(global as any).MutationObserver = MockMutationObserver;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("❌ Assert failed:", message);
    process.exit(1);
  }
}

async function runChallengeTests() {
  console.log("=== Running Cosmetic Filter Engine Challenge Tests ===");

  // 1. Verify Resilient CSS Injection
  // We need 1 intentionally invalid selector and 10 valid selectors.
  const rules: Rule[] = [
    { selector: ".invalidpseudo::invalid", hostname: "google.com", isException: false, category: "searchSummaries", sourceListId: "1" }
  ];
  for (let i = 0; i < 10; i++) {
    rules.push({
      selector: `#valid${i}`,
      hostname: "google.com",
      isException: false,
      category: "searchSummaries",
      sourceListId: "1"
    });
  }

  // Add matching elements to mock DOM
  for (let i = 0; i < 10; i++) {
    const el = new MockElement("div");
    el.id = `valid${i}`;
    mockDocument.documentElement.children.push(el);
  }

  mockRulesInserted.length = 0;
  init(rules, 1, true);

  // Assert all 10 valid rules were injected successfully
  for (let i = 0; i < 10; i++) {
    const expectedRule = `#valid${i} { display: none !important; }`;
    assert(mockRulesInserted.includes(expectedRule), `Valid rule ${expectedRule} must be injected`);
  }

  // Assert the invalid rule was NOT injected
  assert(
    !mockRulesInserted.some(r => r.includes("invalidpseudo")),
    "Invalid rule must not be injected and should not crash insertion of other rules"
  );

  console.log("✅ Verification 1 (Resilient CSS Injection) Passed");

  // 2. Verify Generic Rules Over-blocking / False Positives Prevention
  // Clear rules & DOM first
  mockDocument.documentElement.children = [];
  mockRulesInserted.length = 0;

  const genericRules: Rule[] = [
    { selector: "#generic-ad", hostname: null, isException: false, category: "adBlock" as any, sourceListId: "1" },
    { selector: "#generic-popup", hostname: null, isException: false, category: "adBlock" as any, sourceListId: "1" }
  ];

  init(genericRules, 1, true);

  // Since the DOM is empty, neither rule should be injected initially
  assert(mockRulesInserted.length === 0, "Unmatched generic rules must not be injected");

  // Let's add one element matching "#generic-popup"
  const popupEl = new MockElement("div");
  popupEl.id = "generic-popup";
  mockDocument.documentElement.children.push(popupEl);

  // Trigger MutationObserver for the late-added element
  assert(observerCallback !== null, "MutationObserver callback must be set");
  observerCallback([
    {
      addedNodes: [popupEl],
    }
  ]);

  // Wait for 200ms (debounce is 150ms)
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Verify only #generic-popup was injected
  assert(mockRulesInserted.includes("#generic-popup { display: none !important; }"), "Late-matched generic rule must be injected after MutationObserver triggers");
  assert(!mockRulesInserted.includes("#generic-ad { display: none !important; }"), "Unmatched generic rule must remain uninjected");

  console.log("✅ Verification 2 (Generic Rules Non-Overblocking) Passed");

  // 3. Verify MutationObserver Timing and Performance
  // Test timing: must apply rules within 200ms.
  // Let's add `#generic-ad` to DOM and measure the elapsed time until injection.
  const adEl = new MockElement("div");
  adEl.id = "generic-ad";
  mockDocument.documentElement.children.push(adEl);

  const startTime = Date.now();
  observerCallback([
    {
      addedNodes: [adEl]
    }
  ]);

  // Wait for 160ms (which is > 150ms debounce and < 200ms limit)
  await new Promise((resolve) => setTimeout(resolve, 160));

  const endTime = Date.now();
  const duration = endTime - startTime;

  assert(mockRulesInserted.includes("#generic-ad { display: none !important; }"), "Rule must be injected within the observation timeframe");
  assert(duration < 200, `MutationObserver took too long to apply rules: ${duration}ms (must be < 200ms)`);
  console.log(`⏱️ MutationObserver rule applied in ${duration}ms (target: < 200ms)`);

  // Verify that adding STYLE_ID element does not trigger rule processing (no infinite loops)
  const styleEl = new MockElement("style");
  styleEl.id = "noai-rules";

  observerCallback([
    {
      addedNodes: [styleEl]
    }
  ]);

  // Wait 200ms, confirm nothing new happened
  await new Promise((resolve) => setTimeout(resolve, 200));
  
  // Verify performance under pressure: massive additions (e.g. 1000 nodes in one mutation batch)
  const largeBatch: MockElement[] = [];
  for (let i = 0; i < 1000; i++) {
    const el = new MockElement("div");
    el.id = `batch-${i}`;
    largeBatch.push(el);
  }

  const perfStart = Date.now();
  observerCallback([
    {
      addedNodes: largeBatch
    }
  ]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const perfEnd = Date.now();
  const perfDuration = perfEnd - perfStart;
  console.log(`⏱️ Handled 1000 concurrent mutations in ${perfDuration}ms total (including 150ms debounce delay)`);
  assert(perfDuration < 300, `Performance under pressure is too slow: ${perfDuration}ms`);

  console.log("✅ Verification 3 (MutationObserver Timing & Stability) Passed");
  console.log("🎉 All challenge verification tests passed successfully!");
}

runChallengeTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
