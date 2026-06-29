## 2024-10-18 - React.memo on List Components

**Learning:** GameRow and its child components (GameRowActions, GameRowProfileMenu, RunningAppsStrip) inside GameList re-rendered whenever any game's running status updated, since the parent re-rendered the whole list.
**Action:** Wrapped list components with React.memo() to ensure that only the components with updated props re-render, preventing unnecessary reconciliation across the entire game list.
