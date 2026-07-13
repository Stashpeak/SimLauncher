## 2024-05-24 - GameRow list items memoization

**Learning:** GameList creates new inline closures (e.g. \`onToggleEditor\`, \`onCloseEditor\`) and arrays (\`runningAppIcons\`) on every render. Because of this, shallow equality checks in standard \`React.memo\` would fail and cause O(N) re-renders when only one game's state changed.
**Action:** Always provide a custom \`arePropsEqual\` comparator to \`memo\` when mapping over complex arrays with inline functions, and manually deep-compare only the props that actually change output (e.g. primitives, or deep comparing array items).
