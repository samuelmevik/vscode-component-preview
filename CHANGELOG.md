# Changelog

All notable changes to the "vscode-component-preview" extension will be documented in this file.

## [0.1.0] - 2026-09-25

### Added
- **Instant In-Editor Preview**: Live previewing of JSX and TSX React components in a dedicated webview pane.
- **Responsive Viewport Presets**: Quickly toggle between Responsive, Mobile (375 × 667), Tablet (768 × 1024), and Desktop (1280 × 800), or custom comment-defined viewports.
- **Canvas Theme Modes**: Switch between Dark, Light, and Transparency Checkerboard backgrounds.
- **Canvas Zoom Controls**: Zoom in, zoom out, or reset zoom level for pixel-perfect inspection.
- **Component Dropdown Selector**: Easily switch between all exported components in the current file directly from the preview header.
- **Comment-Driven Mock Data**: Define mock `props`, `store`, `slice`, and `viewport` directly in YAML `@preview` comments.
- **Custom Provider Decorators (`wrapperPath`)**: Wrap preview components in global app context providers or decorators.
- **Full Redux & RTK Support**: Real store instantiation with sagas, middlewares, thunks, or zero-config mock stores.
- **Console & Action Inspector**: Bottom drawer displaying live logs, Redux dispatches, and callback events with search filtering and copy-to-clipboard.
- **Server Lifecycle Control**: Start, stop, or restart background Vite dev server via editor title bar, status bar, command palette, or in-preview header.
- **Keyboard Shortcuts**: Added shortcuts for Open Preview (`Ctrl+Alt+P` / `Cmd+Alt+P`), Toggle Lock (`Ctrl+Alt+L` / `Cmd+Alt+L`), and Refresh (`Ctrl+Alt+R` / `Cmd+Alt+R`).
- **SCSS & CSS Modules**: Native hot-reloading for `.scss` and `*.module.scss` files.
