# Security Policy

## Supported Versions

Currently, only the latest `master` branch is supported with security updates. 

## Reporting a Vulnerability

Security and privacy are the highest priorities for the NoAI extension. Because this extension injects CSS into webpages and intercepts network requests, any vulnerability that allows arbitrary code execution or data leakage is treated as critical.

If you discover a security vulnerability within this extension, please **do not open a public issue**. 

Instead, please responsibly disclose it by emailing the maintainer directly. You should receive a response within 48 hours.

### What to include in your report
- A description of the vulnerability.
- Steps to reproduce the issue (including any malicious payloads).
- The browsers and versions you tested on.
- The potential impact (e.g., cross-site scripting, arbitrary CSS injection, filter list poisoning).

### Out of Scope
The following are generally considered out of scope for security bounties/reports:
- Bugs in the upstream community filter lists (e.g., a filter rule breaking a website's layout). Report these to the respective upstream repositories.
- Vulnerabilities that require physical access to the user's machine.
- Theoretical attacks without a demonstrable exploit.
