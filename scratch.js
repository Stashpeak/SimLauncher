const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/renderer/src/**/*.tsx');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content.replace(/\[var\(--([a-zA-Z0-9-]+)\)\]/g, '(--$1)');
  
  // also handle standard aria-label requirements for inputs without them found during audit
  if (file.includes('Toggle.tsx')) {
    newContent = newContent.replace('id?: string', 'id?: string\n  \'aria-label\'?: string');
    newContent = newContent.replace('export function Toggle({ checked, onChange, id', 'export function Toggle({ checked, onChange, id, \'aria-label\': ariaLabel');
    newContent = newContent.replace('id={id}', 'id={id}\n        aria-label={ariaLabel || id || \'Toggle\'}');
  }
  
  if (file.includes('SettingsView.tsx')) {
    newContent = newContent.replace('<input\n                    type="color"', '<input\n                    type="color"\n                    aria-label="Custom accent color"');
    newContent = newContent.replace('onChange={setKillOnClose} />', 'onChange={setKillOnClose} aria-label="Kill apps on close" />');
    newContent = newContent.replace('detail: checked }))\n                }} \n              />', 'detail: checked }))\n                }} \n                aria-label="Toggle accent glow background"\n              />');
  }

  // Also remove duplicate font classes in ProfileEditor and GameList
  if (file.includes('ProfileEditor.tsx')) {
    newContent = newContent.replace('font-semibold text-white transition-all duration-300 hover:opacity-90 neon-glow active:scale-95', 'text-white transition-all duration-300 hover:opacity-90 neon-glow active:scale-95');
    newContent = newContent.replace('transition-colors hover:bg-(--glass-border) font-medium active:scale-95', 'transition-colors hover:bg-(--glass-border) active:scale-95');
  }

  if (file.includes('GameList.tsx')) {
    newContent = newContent.replace('outline outline-2 outline-[#1b1921]', 'outline-2 outline outline-[#1b1921]');
  }

  if (content !== newContent) {
    fs.writeFileSync(file, newContent);
    console.log('Fixed ' + file);
  }
});
