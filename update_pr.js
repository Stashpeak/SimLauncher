const { execSync } = require('child_process');

// Fetch the PR text content required to pass the CI
const pr_body = `💡 **What:** Replaced the native \`disabled\` attribute with \`aria-disabled\` and a guarded \`onClick\` handler on the Check for Updates and Download & Install buttons in \`AboutSection.tsx\`.
🎯 **Why:** To prevent keyboard focus from being dropped to \`<body>\` when a user presses these buttons, fixing the issue described in item 1011.
♿ **Accessibility:** Keyboard and screen-reader users who activate an update check will now keep focus on the button while it is busy, instead of focus falling to the document body and forcing them to start tabbing from the beginning again.
Refs #1011

## Smoke check
- [x] **Needs no manual check.** <!-- smoke:none --> Reason: covered by new automated tests in tests/renderer/aboutSectionUpdatesFocus.test.tsx.
`;

const fs = require('fs');
fs.writeFileSync('pr_body.txt', pr_body);
