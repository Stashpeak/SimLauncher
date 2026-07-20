## 2026-07-20 - Label Association in Settings/Editor Sections
**Learning:** Found that custom React inputs in the settings/profile editor (like `ProfileNameSection`) often use `<p>` tags for visual labels instead of semantic `<label>` elements linked to inputs with `id`.
**Action:** Always check custom components for programmatic label association using `useId()` and `htmlFor` to ensure screen reader accessibility and expanded click targets.
