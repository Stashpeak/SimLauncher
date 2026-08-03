## 2025-05-18 - Input fields should use semantic labels for clickable targets
**Learning:** Found that some inputs (like the HEX color input in ColorPickerPopover) had adjacent text indicating the field's purpose, but were not semantically linked as `<label>`s. This prevented users from clicking the text to focus the field.
**Action:** Always wrap adjacent visual text labels and their inputs in a semantic `<label>` element instead of a generic `<div>` wrapper to improve mouse and touch interaction targets.
