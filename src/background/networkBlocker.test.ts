import Module from "module";

// We mock chrome and browser globally before running the tests.
declare const global: any;

let storageStore: Record<string, any> = {};
let dynamicRules: any[] = [];
let lastUpdatedRules: { removeRuleIds: number[]; addRules?: any[] } | null = null;

// Mock webextension-polyfill and chrome
const mockBrowser: any = {
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        const result: Record<string, any> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          result[k] = storageStore[k];
        }
        return result;
      },
      set: async (obj: Record<string, any>) => {
        Object.assign(storageStore, obj);
      }
    }
  },
  runtime: {
    id: "mock-id",
    getURL: (path: string) => `chrome-extension://mock-id/${path}`
  }
};
mockBrowser.default = mockBrowser;

// Hijack require to return mockBrowser when webextension-polyfill is requested
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "webextension-polyfill") {
    return mockBrowser;
  }
  return originalRequire.apply(this, arguments);
};

const mockChrome = {
  runtime: {
    id: "mock-id"
  },
  declarativeNetRequest: {
    getDynamicRules: async () => {
      return dynamicRules;
    },
    updateDynamicRules: async (options: { removeRuleIds: number[]; addRules?: any[] }) => {
      lastUpdatedRules = options;
      // Apply the update to our mock dynamicRules
      dynamicRules = dynamicRules.filter((r) => !options.removeRuleIds.includes(r.id));
      if (options.addRules) {
        dynamicRules.push(...options.addRules);
      }
    }
  }
};

global.chrome = mockChrome;
global.browser = mockBrowser;

// Now we import the network blocker functions
const { updateDeclarativeRules, addTempAllowedDomain } = require("./networkBlocker");

// Helper to assert
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("❌ Assert failed:", message);
    process.exit(1);
  }
}

async function runTests() {
  console.log("=== STARTING DECLARATIVE NET REQUEST VERIFICATION ===");

  // Reset state
  storageStore = {};
  dynamicRules = [];
  lastUpdatedRules = null;

  // Test Case 1: Filtering mode is NOT 2 (e.g. 1) -> No rules should be active
  storageStore.settings = {
    filteringMode: 1, // Not 2
    perSiteOverrides: {}
  };
  storageStore.networkDomainsMap = {
    "list1": ["ai-service.com", "another-ai.org"]
  };

  // Add some existing dynamic rule to see if it gets removed
  dynamicRules = [{ id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["old.com"] } }];

  await updateDeclarativeRules();

  assert(lastUpdatedRules !== null, "updateDeclarativeRules should have updated rules");
  assert(lastUpdatedRules!.removeRuleIds.includes(1), "Should remove existing rules when filtering mode !== 2");
  assert(!lastUpdatedRules!.addRules || lastUpdatedRules!.addRules.length === 0, "Should not add rules when filtering mode !== 2");
  assert(dynamicRules.length === 0, "Dynamic rules should be empty now");

  console.log("✅ Test 1: Filtering mode !== 2 removes all rules passed.");

  // Test Case 2: Filtering mode IS 2, but blocked domains is empty
  storageStore.settings = {
    filteringMode: 2,
    perSiteOverrides: {}
  };
  storageStore.networkDomainsMap = {};

  dynamicRules = [{ id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["old.com"] } }];
  lastUpdatedRules = null;

  await updateDeclarativeRules();

  assert(lastUpdatedRules !== null, "updateDeclarativeRules should have run");
  assert(lastUpdatedRules!.removeRuleIds.includes(1), "Should remove existing rules when blocked domains is empty");
  assert(!lastUpdatedRules!.addRules || lastUpdatedRules!.addRules.length === 0, "Should not add rules when blocked domains is empty");

  console.log("✅ Test 2: Filtering mode === 2 but empty domain list removes all rules passed.");

  // Test Case 3: Filtering mode IS 2, blocked domains present, no site overrides
  storageStore.settings = {
    filteringMode: 2,
    perSiteOverrides: {}
  };
  storageStore.networkDomainsMap = {
    "list1": ["ai-service.com", "another-ai.org"]
  };
  dynamicRules = [];
  lastUpdatedRules = null;

  await updateDeclarativeRules();

  assert(lastUpdatedRules !== null, "updateDeclarativeRules should have run");
  assert(lastUpdatedRules!.addRules !== undefined, "Should add rules");
  // There should be 2 rules: one block (id 1, priority 1) and one redirect (id 2, priority 2)
  assert(lastUpdatedRules!.addRules!.length === 2, `Should add 2 rules, got ${lastUpdatedRules!.addRules!.length}`);

  const blockRule = lastUpdatedRules!.addRules!.find(r => r.id === 1);
  const redirectRule = lastUpdatedRules!.addRules!.find(r => r.id === 2);

  assert(blockRule !== undefined, "Block rule (id 1) should be present");
  assert(blockRule.priority === 1, "Block rule priority must be 1");
  assert(blockRule.action.type === "block", "Block rule action must be 'block'");
  assert(blockRule.condition.requestDomains.includes("ai-service.com"), "Block rule condition should contain blocked domains");
  assert(blockRule.condition.requestDomains.includes("another-ai.org"), "Block rule condition should contain blocked domains");
  assert(blockRule.condition.excludeInitiatorDomains.length === 0, "No excluded domains initially");
  assert(blockRule.condition.resourceTypes.includes("sub_frame"), "Block rule resourceTypes should contain sub_frame");
  assert(!blockRule.condition.resourceTypes.includes("main_frame"), "Block rule resourceTypes must NOT contain main_frame");

  assert(redirectRule !== undefined, "Redirect rule (id 2) should be present");
  assert(redirectRule.priority === 2, "Redirect rule priority must be 2");
  assert(redirectRule.action.type === "redirect", "Redirect rule action must be 'redirect'");
  assert(redirectRule.action.redirect.regexSubstitution.includes("blocked.html"), "Redirect action must point to blocked.html page");
  assert(redirectRule.condition.regexFilter === "^https?://.*", "Redirect rule condition regexFilter must be ^https?://.*");
  assert(redirectRule.condition.resourceTypes.length === 1 && redirectRule.condition.resourceTypes[0] === "main_frame", "Redirect rule resourceTypes must only contain main_frame");
  assert(redirectRule.condition.requestDomains.includes("ai-service.com"), "Redirect rule requestDomains must contain blocked domains");

  console.log("✅ Test 3: Standard rule generation (block and redirect) passed.");

  // Test Case 4: Exclusion domains / Site overrides & Temp allowed domains
  storageStore.settings = {
    filteringMode: 2,
    perSiteOverrides: {
      "allowed-site.com": true,
      "blocked-site.com": false // not allowed
    }
  };
  storageStore.networkDomainsMap = {
    "list1": ["ai-service.com"]
  };
  addTempAllowedDomain("temp-allowed.com");
  dynamicRules = [];
  lastUpdatedRules = null;

  await updateDeclarativeRules();

  assert(lastUpdatedRules !== null, "updateDeclarativeRules should have run");
  const checkBlockRule = lastUpdatedRules!.addRules!.find(r => r.id === 1);
  const checkRedirectRule = lastUpdatedRules!.addRules!.find(r => r.id === 2);

  assert(checkBlockRule.condition.excludeInitiatorDomains.includes("allowed-site.com"), "Should exclude allowed-site.com");
  assert(checkBlockRule.condition.excludeInitiatorDomains.includes("temp-allowed.com"), "Should exclude temp-allowed.com");
  assert(!checkBlockRule.condition.excludeInitiatorDomains.includes("blocked-site.com"), "Should NOT exclude blocked-site.com");

  assert(checkRedirectRule.condition.excludeRequestDomains.includes("allowed-site.com"), "Should exclude allowed-site.com on redirect rule");
  assert(checkRedirectRule.condition.excludeRequestDomains.includes("temp-allowed.com"), "Should exclude temp-allowed.com on redirect rule");

  console.log("✅ Test 4: Exclusion domains (per-site override and temporary allowed) passed.");

  // Test Case 5: Rule chunking (more than 200 domains)
  const largeDomainList: string[] = [];
  for (let i = 0; i < 250; i++) {
    largeDomainList.push(`domain-${i}.com`);
  }
  storageStore.settings = {
    filteringMode: 2,
    perSiteOverrides: {}
  };
  storageStore.networkDomainsMap = {
    "largeList": largeDomainList
  };
  dynamicRules = [];
  lastUpdatedRules = null;

  await updateDeclarativeRules();

  assert(lastUpdatedRules !== null, "updateDeclarativeRules should have run");
  assert(lastUpdatedRules!.addRules!.length === 4, `Should generate 4 rules for 2 chunks, got ${lastUpdatedRules!.addRules!.length}`);

  const chunk0_block = lastUpdatedRules!.addRules!.find(r => r.id === 1);
  const chunk0_redirect = lastUpdatedRules!.addRules!.find(r => r.id === 2);
  const chunk1_block = lastUpdatedRules!.addRules!.find(r => r.id === 3);
  const chunk1_redirect = lastUpdatedRules!.addRules!.find(r => r.id === 4);

  assert(chunk0_block !== undefined && chunk0_block.condition.requestDomains.length === 200, "Chunk 0 block rule should have 200 domains");
  assert(chunk0_redirect !== undefined && chunk0_redirect.condition.requestDomains.length === 200, "Chunk 0 redirect rule should have 200 domains");
  assert(chunk1_block !== undefined && chunk1_block.condition.requestDomains.length === 50, "Chunk 1 block rule should have 50 domains");
  assert(chunk1_redirect !== undefined && chunk1_redirect.condition.requestDomains.length === 50, "Chunk 1 redirect rule should have 50 domains");

  console.log("✅ Test 5: Chunking of large domain lists (>200) passed.");

  console.log("=== ALL DECLARATIVE NET REQUEST VERIFICATION TESTS PASSED! ===");
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
