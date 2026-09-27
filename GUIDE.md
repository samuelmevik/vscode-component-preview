# React Component Preview — Comprehensive Guide

> Live, in-editor preview of React components with SCSS, comment-based mock data, and Redux support.

---

## Table of Contents

- [1. Quick Start](#1-quick-start)
- [2. The `@preview` Comment System](#2-the-preview-comment-system)
  - [2.1 Basic Syntax](#21-basic-syntax)
  - [2.2 Named Variants](#22-named-variants)
  - [2.3 Multiple Variants](#23-multiple-variants-per-component)
  - [2.4 YAML Field Reference](#24-yaml-field-reference)
  - [2.5 Props — Primitives, Objects, Arrays](#25-props--primitives-objects-and-arrays)
  - [2.6 Props — Callback Functions](#26-props--callback-functions)
  - [2.7 Props — Auto-Mocked Callbacks](#27-props--auto-mocked-callbacks)
  - [2.8 Props — Children](#28-props--children)
  - [2.9 Props — Component References](#29-props--component-references)
  - [2.10 Redux Store — Mock Store](#210-redux-store--mock-store-no-storepath)
  - [2.11 Redux Store — Real Store](#211-redux-store--real-store-with-storepath)
  - [2.12 Redux Store — Slice Shorthand](#212-redux-store--slice-shorthand)
  - [2.13 Viewport & Device Frames](#213-viewport--device-frames)
  - [2.14 Wrapper Components](#214-wrapper-components)
  - [2.15 Variant Inheritance](#215-variant-inheritance)
  - [2.16 JSDoc-Style Comments](#216-jsdoc-style-comments)
  - [2.17 Empty `@preview`](#217-empty-preview-no-yaml)
  - [2.18 YAML Parse Errors](#218-yaml-parse-error-handling)
- [3. How Comments Are Parsed (Internals)](#3-how-comments-are-parsed-internals)
  - [3.1 Stage 1 — AST Scanning](#31-stage-1--ast-scanning)
  - [3.2 Stage 2 — Comment Parsing](#32-stage-2--comment-parsing)
  - [3.3 Cursor-Based Targeting](#33-cursor-based-targeting)
- [4. Component Detection](#4-component-detection)
- [5. CodeLens](#5-codelens)
- [6. Preview Panel & Webview](#6-preview-panel--webview)
- [7. Vite Dev Server & HMR](#7-vite-dev-server--hmr)
- [8. Canvas Controls](#8-canvas-controls)
- [9. Theme System](#9-theme-system)
- [10. Lock / Unlock](#10-lock--unlock)
- [11. Action & Event Inspector Panel](#11-action--event-inspector-panel)
  - [11.1 Redux Tab](#111-redux-tab)
  - [11.2 Network Tab](#112-network-tab)
  - [11.3 Console Tab](#113-console-tab)
  - [11.4 Callbacks Tab](#114-callbacks-tab)
  - [11.5 Errors Tab](#115-errors-tab)
  - [11.6 Inspector Features](#116-inspector-features)
- [12. Runtime Error Handling & Diagnostics](#12-runtime-error-handling--diagnostics)
- [13. Source Navigation](#13-source-navigation)
- [14. Workspace Aliases & tsconfig Paths](#14-workspace-aliases--tsconfig-paths)
- [15. Configuration Reference](#15-configuration-reference)
- [16. Commands & Keybindings](#16-commands--keybindings)

---

## 1. Quick Start

1. Open any `.jsx` or `.tsx` file with an exported React component.
2. Press **`Ctrl+Alt+P`** (macOS: `Cmd+Alt+P`) — the preview panel opens beside your editor.
3. The extension auto-detects your components and renders the one nearest to your cursor.
4. Add `@preview` comments above any component to supply props, Redux state, and more.

**Minimal example — no comments needed:**

```tsx
// The extension detects this as a component and renders it with empty props.
export const HelloWorld = () => <h1>Hello, World!</h1>;
```

**With a `@preview` comment:**

```tsx
/* @preview
props:
  name: "Alice"
*/
export const Greeting = ({ name }) => <h1>Hello, {name}!</h1>;
```

---

## 2. The `@preview` Comment System

The `@preview` comment is the core feature. It lets you declare exactly how a component should be rendered — including its props, Redux state, viewport size, and wrapping context — all as YAML written inside a block comment directly above the component.

### 2.1 Basic Syntax

Place a `/* ... */` block comment containing `@preview` **immediately before** the component declaration:

```tsx
/* @preview
props:
  label: "Click Me"
  variant: "primary"
*/
export const Button: React.FC<ButtonProps> = ({ label, variant }) => {
  return <button className={variant}>{label}</button>;
};
```

**Rules:**

- `@preview` is **case-insensitive** (`@Preview`, `@PREVIEW` all work)
- Everything after the `@preview` line is parsed as **YAML**
- The comment must be a **block comment** (`/* ... */`), not a line comment (`//`)
- The comment must appear **before** the component it describes (as a leading comment)

### 2.2 Named Variants

Give a variant a descriptive name by adding it after `@preview:` (with a colon):

```tsx
/* @preview: Primary Active
props:
  label: "Save Changes"
  variant: "primary"
  disabled: false
*/
export const Button = ({ label, variant, disabled }) => { ... };
```

If you don't provide a name:
- The first variant is automatically named **`"Default"`**
- Subsequent unnamed variants get **`"Variant 2"`**, **`"Variant 3"`**, etc.

### 2.3 Multiple Variants per Component

Define **multiple `@preview` blocks** before a single component. Each becomes a clickable **tab** in the preview panel:

```tsx
/* @preview: Primary Button
props:
  label: "Save Changes"
  variant: "primary"
  disabled: false
*/
/* @preview: Danger Button
props:
  label: "Delete Account"
  variant: "danger"
  disabled: false
*/
/* @preview: Disabled State
props:
  label: "Processing..."
  variant: "primary"
  disabled: true
*/
export const Button: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  disabled = false,
  onClick,
}) => {
  return (
    <button
      className={`btn ${variant} ${disabled ? 'disabled' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
};
```

**Result:** The preview panel shows three tabs: "Primary Button", "Danger Button", and "Disabled State". Click any tab to instantly switch the rendered variant.

You can also put **multiple `@preview` annotations inside a single comment block** — the parser splits on each `@preview` keyword:

```tsx
/**
 * @preview: Light Mode
 * props:
 *   theme: "light"
 *
 * @preview: Dark Mode
 * props:
 *   theme: "dark"
 */
export const ThemeDemo = ({ theme }) => <div className={theme}>Hello</div>;
```

### 2.4 YAML Field Reference

Each `@preview` block supports these top-level YAML fields:

| Field | Type | Description |
|---|---|---|
| `props` | `object` | Props to pass to the component |
| `children` | `any` | Shorthand for `props.children` |
| `store` / `state` | `object` | Preloaded Redux state tree |
| `storePath` / `storeFile` | `string` | Relative or aliased path to your Redux store module |
| `slice` | `string` | Target a specific Redux slice name |
| `viewport` | `object` or `string` | Device frame dimensions (`{ width, height }`) or preset name |
| `wrapperPath` / `wrapper` | `string` | Path to a wrapper component to wrap around the preview |

### 2.5 Props — Primitives, Objects, and Arrays

All standard YAML data types work:

```tsx
/* @preview: Full Example
props:
  # Strings
  title: "My Dashboard"
  placeholder: "Search..."

  # Numbers
  count: 42
  price: 19.99

  # Booleans
  isActive: true
  disabled: false

  # Null
  error: null

  # Nested objects
  user:
    name: "Jane Doe"
    email: "jane@example.com"
    role: "admin"
    address:
      city: "New York"
      zip: "10001"

  # Arrays (inline)
  tags: ["react", "typescript", "vscode"]

  # Arrays of objects (block)
  items:
    - id: "1"
      name: "Widget A"
      price: 29.99
    - id: "2"
      name: "Widget B"
      price: 39.99
    - id: "3"
      name: "Widget C"
      price: 49.99
*/
export const Dashboard: React.FC<DashboardProps> = ({ title, count, user, items, tags }) => {
  return (
    <div>
      <h1>{title}</h1>
      <p>Count: {count}</p>
      <p>User: {user.name} ({user.role})</p>
      <ul>
        {items.map(item => <li key={item.id}>{item.name} - ${item.price}</li>)}
      </ul>
      <div>{tags.map(t => <span key={t}>#{t} </span>)}</div>
    </div>
  );
};
```

### 2.6 Props — Callback Functions

There are three ways to define callback props:

#### Inline arrow functions (evaluated at runtime):

```tsx
/* @preview: With Inline Handler
props:
  label: "Submit"
  onClick: "(e) => console.log('clicked!', e.target)"
  onSubmit: "async (data) => fetch('/api/submit', { method: 'POST' })"
*/
export const ActionButton = ({ label, onClick, onSubmit }) => { ... };
```

#### Reference to an exported function in the same file:

```tsx
export function handleSave(data: any) {
  console.log('Saving:', data);
  return fetch('/api/save', { method: 'POST', body: JSON.stringify(data) });
}

/* @preview: With File Export
props:
  label: "Save"
  onSave: handleSave
*/
export const SaveButton = ({ label, onSave }) => {
  return <button onClick={() => onSave({ id: 1 })}>{label}</button>;
};
```

When you reference an exported function, the extension wraps it with action logging — every call shows up in the **Action Panel** with its arguments and return value.

### 2.7 Props — Auto-Mocked Callbacks

Any `on*` prop that the component reads but is **not explicitly defined** in the `@preview` block is **automatically intercepted**:

```tsx
/* @preview: Auto-Mock Demo
props:
  label: "Click Me"
  # onClick is NOT defined here...
*/
export const Button = ({ label, onClick, onChange, onHover }) => {
  // onClick, onChange, and onHover all work!
  // They are auto-proxied: when called, they log to the Action Panel.
  return (
    <button
      onClick={onClick}
      onChange={onChange}
      onMouseEnter={onHover}
    >
      {label}
    </button>
  );
};
```

**Result:** Clicking the button logs `onClick()` in the Action Panel with the `SyntheticEvent` details. No crash, no `undefined is not a function`. This also works for `onChange`, `onSubmit`, `onSelect`, and every other `on*` callback.

### 2.8 Props — Children

Children can be specified in three ways:

#### Simple text:
```tsx
/* @preview
props:
  children: "Hello World"
*/
export const Card = ({ children }) => <div className="card">{children}</div>;
```

#### Top-level shorthand (equivalent to `props.children`):
```tsx
/* @preview
children: "Hello World"
*/
export const Card = ({ children }) => <div className="card">{children}</div>;
```

#### HTML markup (rendered via `dangerouslySetInnerHTML`):
```tsx
/* @preview
props:
  children: "<span>Save <strong>Now</strong> <em>please</em></span>"
*/
export const Banner = ({ children }) => <div className="banner">{children}</div>;
```

#### Array of children with component references:
```tsx
export const Header = () => <header>Header</header>;
export const Footer = () => <footer>Footer</footer>;

/* @preview
props:
  children:
    - Header
    - Footer
*/
export const Layout = ({ children }) => <div className="layout">{children}</div>;
```

When children items are strings matching an export name from the file, they are resolved to `React.createElement(ExportedComponent)`.

### 2.9 Props — Component References

Any prop value that is a string matching an exported identifier from the same file is resolved automatically:

```tsx
export const SparkleIcon = () => <svg>...</svg>;
export const CheckIcon = () => <svg>...</svg>;

/* @preview
props:
  icon: SparkleIcon
  endIcon: CheckIcon
  label: "Fancy Button"
*/
export const IconButton = ({ icon, endIcon, label }) => (
  <button>
    {icon} {label} {endIcon}
  </button>
);
```

**Rules:**
- PascalCase string values matching an export → rendered as `<Component />`
- camelCase function exports → wrapped as callable with logging
- Non-function exports → passed as-is

### 2.10 Redux Store — Mock Store (no `storePath`)

If your component uses `useSelector`/`useDispatch` but you only need mock read-only state, provide just a `store` field:

```tsx
/* @preview: Logged In Admin
store:
  auth:
    isLoggedIn: true
    user:
      name: "Sarah Connor"
      email: "sarah@skynet.com"
      role: "admin"
*/
export const UserProfile: React.FC = () => {
  const auth = useSelector((state: RootState) => state.auth);
  const dispatch = useDispatch();

  return (
    <div>
      <h2>{auth.user?.name}</h2>
      <span>{auth.user?.role}</span>
      <button onClick={() => dispatch({ type: 'auth/logout' })}>
        Sign Out
      </button>
    </div>
  );
};
```

The extension creates a lightweight Redux store pre-loaded with your mock state. The component renders normally — `useSelector` returns data from the mock tree, and `dispatch()` calls are logged in the Action Panel but don't mutate state.

### 2.11 Redux Store — Real Store (with `storePath`)

Point to your actual Redux store module to get a fully functional store with real reducers, middleware, and RTK Query:

```tsx
/* @preview: Admin User
storePath: "./store"
store:
  auth:
    isLoggedIn: true
    user:
      name: "Sarah Connor"
      email: "sarah.connor@sky.net"
      role: "admin"
*/
/* @preview: Regular Member
storePath: "./store"
store:
  auth:
    isLoggedIn: true
    user:
      name: "John Doe"
      email: "john.doe@example.com"
      role: "member"
*/
export const UserProfile: React.FC = () => {
  const dispatch = useDispatch();
  const auth = useSelector((state: RootState) => state.auth);
  // Dispatching real actions works — reducers run, state updates, UI re-renders.
  return ( ... );
};
```

**How store resolution works:**

The extension imports your store module and looks for exports in this order:

1. **Specific export** (if using hash syntax): `storePath: "./store#createTestStore"`
2. **`setupStore`** — recommended factory function
3. **`createStore`** / **`createTestStore`**
4. **`store`** — singleton instance
5. **`default`** — default export
6. Any export with `.dispatch` and `.getState` methods (auto-detected store instance)
7. Any function export (assumed to be a factory)

**Recommended store factory pattern:**

```ts
// store.ts
export const setupStore = (preloadedState?: Partial<RootState>) => {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
    },
    preloadedState: preloadedState as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(myMiddleware),
  });
};
```

The `store` field in your `@preview` comment is passed as `preloadedState` to this factory. Reducers, middleware, and RTK Query all work normally.

**Full RTK Query example with live HTTP requests:**

```tsx
/* @preview: RTK Query Live Explorer
storePath: "./catStore"
props:
  title: "Cat Gallery"
*/
/* @preview: Preloaded Redux State
storePath: "./catStore"
store:
  catGallery:
    selectedTag: "cute"
    saysText: "Redux Toolkit is Awesome!"
    requestCount: 9
    favorites:
      - id: "SW2Cs8h9cHWMmyTu"
        url: "https://cataas.com/cat/SW2Cs8h9cHWMmyTu"
        tags: ["cute", "orange", "fluffy"]
        likedAt: "10:30 AM"
      - id: "4y6Hyu0uzVZcEx89"
        url: "https://cataas.com/cat/4y6Hyu0uzVZcEx89"
        tags: ["tabby"]
        likedAt: "10:35 AM"
props:
  title: "Preloaded Redux State"
*/
export const CatGallery: React.FC<CatGalleryProps> = ({ title }) => {
  const dispatch = useDispatch();
  const [triggerGetCat, { data, isFetching }] = useLazyGetRandomCatQuery();
  // ...
};
```

### 2.12 Redux Store — Slice Shorthand

If your state shape is simple, use the `slice` field to avoid nesting:

```tsx
/* @preview: With Slice Shorthand
storePath: "./store"
slice: "auth"
store:
  isLoggedIn: true
  user:
    name: "Jane"
    role: "admin"
*/
export const Profile = () => {
  const auth = useSelector((state: any) => state.auth);
  return <div>{auth.user.name}</div>;
};
```

This is equivalent to writing:

```yaml
store:
  auth:
    isLoggedIn: true
    user:
      name: "Jane"
      role: "admin"
```

The `slice` field wraps your `store` object inside `{ [slice]: store }`.

### 2.13 Viewport & Device Frames

Render the component inside a bordered device frame with fixed dimensions:

#### Custom dimensions:
```tsx
/* @preview: iPhone SE
viewport:
  width: 375
  height: 667
props:
  title: "Mobile View"
*/
export const ResponsiveLayout = ({ title }) => { ... };
```

#### Only width (height auto):
```tsx
/* @preview: Narrow Container
viewport:
  width: 320
props:
  title: "Narrow"
*/
export const Card = ({ title }) => { ... };
```

#### Preset string names:
```tsx
/* @preview: Mobile
viewport: "mobile"
*/
/* @preview: Tablet
viewport: "tablet"
*/
/* @preview: Desktop
viewport: "desktop"
*/
export const ResponsivePage = () => { ... };
```

**Built-in presets:**

| Preset | Width | Height |
|---|---|---|
| `mobile` | 375 | 667 |
| `tablet` | 768 | 1024 |
| `desktop` | 1280 | 800 |

The device frame shows a badge with the dimensions (e.g., "Mobile (375 × 667)"). You can also switch presets on-the-fly from the preview toolbar.

#### Combining viewport with Redux state:

```tsx
/* @preview: Mobile Device Frame
storePath: "./catStore"
viewport:
  width: 375
  height: 667
store:
  catGallery:
    selectedTag: null
    saysText: "Mobile RTK Query 🐾"
    requestCount: 2
    favorites:
      - id: "98qvAp6CYXZMLztN"
        url: "https://cataas.com/cat/98qvAp6CYXZMLztN"
        tags: ["kitten", "small"]
        likedAt: "11:00 AM"
props:
  title: "Mobile View"
*/
export const CatGallery: React.FC<CatGalleryProps> = ({ title }) => { ... };
```

### 2.14 Wrapper Components

Wrap the previewed component in a theme provider, layout, or any other wrapper:

```tsx
// ThemeProvider.tsx
export default function ThemeProvider({ children }) {
  return <div className="dark-theme" data-theme="dark">{children}</div>;
}
```

```tsx
/* @preview: With Theme Provider
wrapperPath: "./ThemeProvider"
props:
  title: "Themed Component"
*/
export const Card = ({ title }) => <div className="card">{title}</div>;
```

**Resolution order for the wrapper module:**
1. `default` export
2. `Wrapper` named export
3. First function export found

To **opt out** of an inherited wrapper:

```yaml
wrapperPath: "none"
```

### 2.15 Variant Inheritance

When multiple variants are defined for the same component, `storePath` and `wrapperPath` **inherit forward** from the first variant that defines them:

```tsx
/* @preview: Default View
storePath: "./catStore"
wrapperPath: "./ThemeProvider"
props:
  title: "Default"
*/
/* @preview: Filtered View
props:
  title: "Filtered"
store:
  catGallery:
    selectedTag: "orange"
*/
/* @preview: No Store At All
storePath: "none"
wrapperPath: "none"
props:
  title: "Simple Render"
*/
export const CatGallery = ({ title }) => { ... };
```

**Result:**
- **"Default View"** — uses `./catStore` store + `./ThemeProvider` wrapper
- **"Filtered View"** — **inherits** `./catStore` + `./ThemeProvider` automatically
- **"No Store At All"** — explicitly opts out with `"none"` for both

This saves you from repeating `storePath` on every variant.

### 2.16 JSDoc-Style Comments

`@preview` works inside JSDoc-style comments too. Leading `*` characters are stripped automatically:

```tsx
/**
 * My fancy button component.
 *
 * @preview: Primary
 * props:
 *   label: "Save"
 *   variant: "primary"
 *
 * @preview: Secondary
 * props:
 *   label: "Cancel"
 *   variant: "secondary"
 */
export const Button = ({ label, variant }) => { ... };
```

### 2.17 Empty `@preview` (No YAML)

An `@preview` with no YAML body creates a variant with **empty props and empty store** — useful for components with sensible defaults:

```tsx
/* @preview */
export const Logo = () => <img src="/logo.svg" alt="Logo" />;
```

```tsx
/* @preview: Just the defaults */
export const Footer = ({ year = 2024 }) => <footer>© {year}</footer>;
```

### 2.18 YAML Parse Error Handling

If the YAML has syntax errors, the extension doesn't crash — instead it:

1. Shows a **"Comment YAML Parsing Error"** card in the preview canvas with the exact error message
2. Provides a **clickable "Open Comment in Editor"** button that navigates to the comment location
3. The variant still appears in the tab bar (so you can see it needs fixing)

```tsx
/* @preview: Broken YAML
props:
  items:
    - name "missing colon here"
    - value: ok
*/
export const List = ({ items }) => { ... };
```

**Result in preview:**
```
Comment YAML Parsing Error
YAML Syntax Error: Implicit map keys need to be on a single line at line 2, column 1

[Open Comment in Editor (List.tsx:1)]
```

---

## 3. How Comments Are Parsed (Internals)

### 3.1 Stage 1 — AST Scanning

The file `src/parser/astScanner.ts` uses the **TypeScript Compiler API** (`ts.createSourceFile`) to parse your file and walk the AST:

```
Source Text (.tsx / .jsx)
         ↓
   ts.createSourceFile()
         ↓
   AST Walk (visit each node)
         ↓
   Identify component nodes:
     - FunctionDeclaration
     - ClassDeclaration
     - VariableStatement (arrow/function expression)
     - ExportAssignment
         ↓
   For each component:
     1. Extract leading comments via ts.getLeadingCommentRanges()
     2. Record name, line numbers, export status
     3. Pass comments → Stage 2
```

**Why TypeScript AST instead of regex?** Regex can't reliably distinguish components from constants, handle multiline comments, or track export modifiers. The AST approach correctly handles all of these.

### 3.2 Stage 2 — Comment Parsing

The file `src/parser/commentParser.ts` takes the raw comment strings and produces structured `PreviewVariant` objects:

```
Raw comment string: "/* @preview: My Variant\nprops:\n  label: \"Hello\" */"
         ↓
   Strip comment wrappers: "/*", "*/", leading "* " (JSDoc asterisks)
         ↓
   Split on "@preview" boundaries (handles multiple in one comment)
         ↓
   Extract variant name from "@preview: My Variant"
         ↓
   Dedent YAML (remove common leading whitespace)
         ↓
   Parse YAML via yaml library
         ↓
   Map to PreviewVariant:
     { name, props, store, storePath, slice, viewport, wrapperPath }
         ↓
   Apply inheritance (storePath, wrapperPath cascade from first variant)
```

**The dedent step** is crucial — it strips common indentation so your YAML works regardless of how deeply indented the comment is in your source code.

### 3.3 Cursor-Based Targeting

When you open the preview, the scanner checks your **current cursor position**:

```
Cursor on line 45
         ↓
   For each scanned component:
     if (cursorLine >= component.commentStartLine &&
         cursorLine <= component.endLine)
       → This is the target component
         ↓
   If no match, fallback priority:
     1. Default export
     2. First named export
     3. First component in file
```

This means you can have **multiple components in one file** and preview whichever one your cursor is in. Moving your cursor to a different component automatically switches the preview (unless locked).

---

## 4. Component Detection

The AST scanner detects these component patterns:

| Pattern | Example | Name Resolution |
|---|---|---|
| Named function | `export function Button() {}` | `Button` |
| Default unnamed function | `export default function() {}` | Uses filename |
| Arrow function variable | `export const Button = () => {}` | `Button` |
| Typed FC | `export const Button: React.FC<Props> = ...` | `Button` |
| Typed FunctionComponent | `const X: React.FunctionComponent = ...` | `X` |
| Call expression variable | `export const Button = React.memo(() => {})` | `Button` |
| Class component | `export class Button extends Component {}` | `Button` |
| Export assignment (id) | `export default Button` | `Button` |
| Export assignment (call) | `export default React.memo(Button)` | `Button` |
| Export assignment (arrow) | `export default () => <div/>` | Uses filename |

**Exclusion rule:** Identifiers that are ALL_CAPS or SCREAMING_SNAKE_CASE (like `const PRESETS = ...`) are **not** treated as components.

---

## 5. CodeLens

When enabled (default: `true`), interactive CodeLens buttons appear on the **component name line**:

```
▶ Preview <Button />     ◐ 3 Variants (Primary, Danger, Disabled)
export const Button: React.FC<ButtonProps> = ({ ... }) => { ... };
```

| Button | Meaning |
|---|---|
| `▶ Preview <Button />` | Click to preview this component |
| `👁 Previewing <Button />` | This component is currently being previewed |
| `◐ 3 Variants (Primary, Danger, …)` | Number of `@preview` variants defined |
| `◐ Variant: Mobile View` | Single named variant (non-"Default") |
| `🔒 Locked (Click to Unlock)` | Preview is locked to this component |

CodeLens refreshes automatically when you save the file or when the preview state changes.

---

## 6. Preview Panel & Webview

The preview renders in a VS Code Webview panel that opens in `ViewColumn.Beside`. Architecture:

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   VS Code Extension     │     │   Webview Panel         │
│   (extension.ts)        │     │   (iframe)              │
│                         │     │                         │
│   PreviewManager        │◄───►│   Vite Dev Server       │
│     ├─ ViteServer       │     │   /__preview__          │
│     ├─ AST Scanner      │     │     └─ Harness.tsx      │
│     ├─ Comment Parser   │     │       ├─ Canvas         │
│     └─ CodeLens Provider│     │       ├─ Toolbar        │
│                         │     │       ├─ ErrorBoundary  │
│   postMessage ◄────────►│     │       ├─ Redux Provider │
│                         │     │       └─ ActionPanel    │
└─────────────────────────┘     └─────────────────────────┘
```

The Vite server generates a **virtual entry module** at `/__preview_entry__.tsx` that:
1. Imports your component from `/@fs/path/to/YourComponent.tsx`
2. Imports the Harness renderer
3. Imports any `storePath` and `wrapperPath` modules
4. Passes all variant data, props, and modules to the Harness

---

## 7. Vite Dev Server & HMR

The extension runs an embedded **Vite dev server** (default port `4545`) with:

- **`@vitejs/plugin-react`** for JSX/TSX + React Fast Refresh
- **Sass/SCSS** preprocessor built-in (CSS Modules work out of the box)
- **tsconfig/jsconfig path aliases** auto-resolved
- **Bundled React fallback** if your workspace lacks `node_modules/react`

**Hot Module Replacement behavior:**

| Change Type | HMR Behavior |
|---|---|
| Edit within same component | ✅ Fast Refresh — **preserves React state** (inputs, useState) |
| Switch to different component | Full virtual entry reload — clean state |
| Switch to different file | Full virtual entry reload — clean state |
| Edit a different file (imported dep) | Vite HMR cascade — preserves state if possible |
| Save `.scss` / CSS Module | Instant CSS hot update — no React re-render |

**Example — state preservation:**

```tsx
/* @preview
props:
  placeholder: "Type here..."
*/
export const SearchBox = ({ placeholder }) => {
  const [query, setQuery] = useState('');
  // Type "hello" in the input...
  // Edit the component's JSX and save...
  // → "hello" is still in the input! (React Fast Refresh)
  return (
    <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder={placeholder}
    />
  );
};
```

---

## 8. Canvas Controls

The preview Harness provides a Figma-like canvas:

### Viewport Preset Buttons

| Icon | Preset | Dimensions |
|---|---|---|
| ⬜ | Responsive | Full width (no frame) |
| 📱 | Mobile | 375 × 667 |
| 📋 | Tablet | 768 × 1024 |
| 🖥 | Desktop | 1280 × 800 |

### Camera / Zoom Navigation

| Action | Input |
|---|---|
| Zoom in/out | Scroll wheel (with focal point under cursor) |
| Zoom in/out | `+` / `-` toolbar buttons |
| Horizontal pan | `Shift + Scroll` or trackpad swipe |
| Pan (drag) | Space + drag, Middle-click drag, Alt + drag, or drag background |
| Toggle pan mode | `H` key (persistent until `H` or `Esc`) |
| Reset camera | `Ctrl+0`, double-click background, or click the `↺` button |
| Fit to screen | `⬜` button — auto-scales to fit visible area |

**Zoom range:** 10% → 500%

When the camera is not at the default position, a **floating indicator pill** shows the current coordinates and zoom level with a reset button.

> **Smart scroll handling:** If your component has scrollable content (e.g., an `overflow: auto` list), scroll events pass through to the component instead of zooming the canvas. Canvas zoom only activates when `Ctrl`/`Cmd` or `Space` is held.

### Additional Toolbar Buttons

| Button | Action |
|---|---|
| `↻` Reset State | Cleanly remounts the component with initial props/state |
| Theme toggle | Cycles: Auto → Dark → Light → Checkerboard |
| Lock/Unlock | Pins preview to current component |
| Stop | Stops the Vite server |

---

## 9. Theme System

The canvas background theme has four modes:

| Theme | Behavior |
|---|---|
| `auto` | **Syncs** with your VS Code color theme — switch VS Code to light and the preview follows |
| `dark` | Always dark background |
| `light` | Always light background |
| `checkerboard` | Transparency pattern — great for components with transparent backgrounds |

The theme persists across sessions via `localStorage`.

**Configuration via settings:**

```json
{
  "componentPreview.theme": "auto"
}
```

---

## 10. Lock / Unlock

By default, the preview **follows your cursor** — switch files or move your cursor and the preview updates. Lock pins it:

| Method | Action |
|---|---|
| `Ctrl+Alt+L` / `Cmd+Alt+L` | Toggle lock/unlock |
| Preview toolbar Lock button | Toggle lock/unlock |
| CodeLens "Locked" indicator | Click to unlock |

**When locked:**
- Panel title shows: `🔒 Preview: <Button />`
- Switching files doesn't change the preview
- Saves to the locked file still trigger HMR updates
- Saves to other files don't affect the preview

---

## 11. Action & Event Inspector Panel

A collapsible drawer at the bottom of the preview with five filterable tabs:

### 11.1 Redux Tab

Captures **every Redux action** dispatched through the store:

```
⚡ catGallery/setSelectedTag         10:30:15 AM
   Payload: "orange"
   Changed Slices: catGallery
   ────────────────────────
⚡ catApi/executeQuery/fulfilled      10:30:16 AM
   Endpoint: getRandomCat
   Query Args: { tag: "orange", says: "", timestamp: 1695... }
   Status: fulfilled
   Changed Slices: catApi, catGallery
```

**Features:**
- Shows **changed slices** after each action (detected by shallow reference comparison)
- RTK Query actions show **endpoint name**, **query args**, and **async status** (pending/fulfilled/rejected)
- **Live Store State** button: expand to inspect the full current Redux state tree
- **Replay Action**: re-dispatch any previously logged action
- **Custom Action**: dispatch arbitrary actions with a JSON payload editor

### 11.2 Network Tab

Intercepts all `fetch()` and `XMLHttpRequest` calls:

```
🌐 GET https://cataas.com/cat?json=true&tag=orange    200 OK    142ms
   Request Headers: { Accept: "application/json" }
   Response Headers: { Content-Type: "application/json" }
   Response Body: { id: "SW2Cs8h9cHWMmyTu", url: "...", tags: [...] }
```

**Features:**
- Pending requests show a spinner and update in-place when completed
- Status code color-coded (green 2xx, yellow 3xx, red 4xx/5xx)
- **Copy as cURL**: generate a ready-to-paste `curl` command
- **Copy as Fetch**: generate a JavaScript `fetch()` snippet
- Request/response headers displayed in collapsible sections
- Response body shown as expandable JSON tree

**Internal requests are filtered out** — Vite HMR, `/@fs/`, `/__preview_api/`, and `node_modules` requests don't clutter the panel.

### 11.3 Console Tab

Intercepts `console.log`, `console.warn`, `console.error`, `console.info`, `console.table`, and `console.dir`:

```
📋 [LOG]   Setting selected tag: "orange"         10:30:15 AM
📋 [WARN]  Deprecated prop used                   10:30:16 AM
📋 [ERROR] Failed to load image                   10:30:17 AM
```

**Features:**
- Objects are displayed as expandable JSON tree views
- `console.table()` data rendered as a formatted table
- **Console expression evaluator**: type JavaScript expressions to execute in the preview context

Console output is also forwarded to the VS Code **Output Channel** (`Component Preview`).

### 11.4 Callbacks Tab

Logs every invocation of `on*` callback props:

```
📻 onClick()              10:30:15 AM
   Payload: [SyntheticEvent click]

📻 onChange()              10:30:16 AM
   Payload: "new search text"

📻 onSave -> handleSave() 10:30:17 AM
   Payload: { id: 1, name: "Widget A" }
```

This covers:
- Explicitly defined callback props
- Auto-mocked callbacks (undeclared `on*` props)
- Callbacks referencing exported functions (shows `→ exportName()`)

### 11.5 Errors Tab

Aggregates all runtime errors:

```
⚠ Runtime Exception: Cannot read property 'map' of undefined
   Location: CatGallery.tsx:45
   Stack: at CatGallery (CatGallery.tsx:45:12)
          at renderWithHooks (react-dom.development.js:...)
```

Each error has a **"Jump to Source"** button that opens the exact file and line in VS Code.

### 11.6 Inspector Features

Features shared across all tabs:

| Feature | Description |
|---|---|
| **Search** | Filter logs by text content |
| **Group Similar** | Collapse duplicate/similar entries |
| **Preserve Log** | Keep logs across component remounts and variant switches |
| **Sort Order** | Toggle newest-first / oldest-first |
| **Pin** | Pin important entries to the top |
| **Copy** | Copy any log payload as JSON |
| **Resize** | Drag the drawer border to resize height |
| **Expand/Collapse** | Fullscreen or minimize the panel |
| **JSON Tree View** | Expandable/collapsible tree with syntax highlighting and search |

---

## 12. Runtime Error Handling & Diagnostics

The extension has a three-layer error catching system:

### Layer 1 — Error Boundary (Render Errors)

When a component throws during render:

```
┌─────────────────────────────────────────────────┐
│ ⚠ Component Render Error          Button.tsx:29 │
│                                                 │
│ Cannot read properties of undefined             │
│ (reading 'map')                                 │
│                                                 │
│ [↗ Open <Button /> in Editor (Button.tsx:29)]   │
│                                                 │
│ Stack Frames in Your Code:                      │
│   Button         Button.tsx:29    [↗ Jump]      │
│   renderCard     CardList.tsx:15  [↗ Jump]      │
│                                                 │
│ ▶ Show Stack Details                            │
│                                                 │
│ [↻ Retry Render]  [↺ Reset Component]           │
└─────────────────────────────────────────────────┘
```

### Layer 2 — Runtime Error Interceptor (Event Handlers & Async)

Catches errors from `onClick` handlers, `useEffect`, Promises, and `window.onerror`:

- **Floating toast** in the bottom-right of the canvas
- Shows error message, function name, and source location
- "Jump to Source" button with sourcemap-resolved coordinates
- Dismissable with ✕ button

### Layer 3 — VS Code Diagnostics

Errors with resolved locations become VS Code Diagnostics:

- **Squiggly red underlines** at the error location in your source editor
- Errors show up in the **Problems panel** (`Ctrl+Shift+M`)
- Diagnostics are cleared on save or when the component re-renders successfully

**Sourcemap resolution:** All error locations are mapped back to your original `.tsx`/`.jsx` source using Vite's sourcemaps — never the compiled JavaScript.

---

## 13. Source Navigation

Every "Open in Editor" / "Jump to Source" link triggers intelligent source navigation:

1. **Vite path resolution**: Strips `/@fs/`, `http://127.0.0.1:4545/`, URL encodings
2. **Sourcemap resolution**: Maps transpiled line/column to original source coordinates
3. **Windows normalization**: Handles drive letters (`c:` → `C:`), forward/back slashes
4. **Workspace search**: If the path doesn't resolve directly, searches workspace for the filename
5. **Smart column placement**: Opens the editor at the correct column (reuses existing tab if open)
6. **Center viewport**: Centers the editor scroll position on the target line

---

## 14. Workspace Aliases & tsconfig Paths

The extension reads `tsconfig.json` (or `jsconfig.json`) and configures Vite aliases automatically:

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"],
      "@components/*": ["components/*"],
      "@utils": ["utils/index.ts"]
    }
  }
}
```

These imports all work in previewed components:

```tsx
import Button from '@components/Button';       // ✅ Resolved
import { formatDate } from '@utils';           // ✅ Resolved
import styles from '@/styles/global.module.scss'; // ✅ Resolved
```

If your workspace doesn't have `react` or `react-dom` in `node_modules`, the extension falls back to its own bundled copies.

---

## 15. Configuration Reference

All settings live under `componentPreview.*`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `componentPreview.port` | `number` | `4545` | Port for the background Vite dev server |
| `componentPreview.autoOpenOnSave` | `boolean` | `false` | Automatically open/refresh preview when saving `.jsx`/`.tsx` files |
| `componentPreview.stopServerOnClose` | `boolean` | `false` | Stop the Vite server when the preview panel is closed |
| `componentPreview.lockEditorGroup` | `boolean` | `true` | Lock the preview editor group so other files don't replace it |
| `componentPreview.enableCodeLens` | `boolean` | `true` | Show CodeLens buttons above component declarations |
| `componentPreview.theme` | `string` | `"auto"` | Canvas theme: `"auto"`, `"dark"`, `"light"`, `"checkerboard"` |

**Example `settings.json`:**

```json
{
  "componentPreview.port": 5000,
  "componentPreview.theme": "dark",
  "componentPreview.enableCodeLens": true,
  "componentPreview.autoOpenOnSave": false,
  "componentPreview.stopServerOnClose": true,
  "componentPreview.lockEditorGroup": true
}
```

---

## 16. Commands & Keybindings

| Command | Keybinding | Description |
|---|---|---|
| **Open Component Preview** | `Ctrl+Alt+P` / `Cmd+Alt+P` | Open the preview panel for the current file |
| **Refresh Preview** | `Ctrl+Alt+R` / `Cmd+Alt+R` | Force refresh the preview |
| **Lock / Unlock** | `Ctrl+Alt+L` / `Cmd+Alt+L` | Toggle lock on the current component |
| **Preview Component** | *(via CodeLens)* | Open preview for a specific named component |
| **Start Preview Server** | *(command palette)* | Start the Vite server manually |
| **Stop Preview Server** | *(command palette / status bar)* | Stop the Vite server |
| **Restart Preview Server** | *(command palette)* | Restart the Vite server |
| **Open in External Browser** | *(command palette / toolbar)* | Open preview in your default browser |

All commands are available in the **Command Palette** (`Ctrl+Shift+P`) under the **"Component Preview"** category.

**Editor title bar buttons** (visible when a `.jsx`/`.tsx` file is active):
- ▶ **Open Preview**
- ↻ **Refresh**
- 🌐 **Open in Browser** (when server is running)
- 🔒 **Lock/Unlock**
- ⏹ **Stop Server** (when server is running)
