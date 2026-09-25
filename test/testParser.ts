import * as fs from 'fs';
import * as path from 'path';
import { scanComponents } from '../src/parser/astScanner';

function test() {
  console.log('--- Testing AST Scanner on Button.tsx ---');
  const buttonPath = path.resolve(__dirname, '../sample-workspace/Button.tsx');
  const buttonCode = fs.readFileSync(buttonPath, 'utf8');
  const buttonResult = scanComponents(buttonCode, buttonPath);

  console.log(`Found ${buttonResult.components.length} components.`);
  const btn = buttonResult.targetComponent;
  if (!btn) {
    console.error('Target component not found!');
    process.exit(1);
  }

  console.log(`Target: ${btn.name}`);
  console.log(`Variants count: ${btn.meta.variants.length}`);
  btn.meta.variants.forEach((v) => {
    console.log(`- Variant [${v.name}]:`, JSON.stringify(v.props));
  });

  console.log('\n--- Testing AST Scanner on UserProfile.tsx (Redux) ---');
  const profilePath = path.resolve(__dirname, '../sample-workspace/UserProfile.tsx');
  const profileCode = fs.readFileSync(profilePath, 'utf8');
  const profileResult = scanComponents(profileCode, profilePath);

  console.log(`Found ${profileResult.components.length} components.`);
  const profile = profileResult.targetComponent;
  if (!profile) {
    console.error('Profile target component not found!');
    process.exit(1);
  }

  console.log(`Target: ${profile.name}`);
  console.log(`Variants count: ${profile.meta.variants.length}`);
  profile.meta.variants.forEach((v) => {
    console.log(`- Variant [${v.name}]: storePath = ${v.storePath}, store =`, JSON.stringify(v.store));
  });

  console.log('\n--- Testing Children Prop Handling ---');
  const cardSnippet = `
  /* @preview: With Top-Level Children
  children: "Top level card text"
  props:
    title: "Card 1"
  */
  /* @preview: With Props Children
  props:
    title: "Card 2"
    children: "<span>Inner HTML</span>"
  */
  export const Card: React.FC<{ title: string; children?: React.ReactNode }> = () => null;
  `;
  const cardResult = scanComponents(cardSnippet, 'Card.tsx');
  const cardComp = cardResult.targetComponent;
  if (!cardComp || cardComp.meta.variants.length !== 2) {
    console.error('Card component parsing failed!');
    process.exit(1);
  }
  console.log('- Variant 1 children:', cardComp.meta.variants[0].props?.children);
  console.log('- Variant 2 children:', cardComp.meta.variants[1].props?.children);
  if (cardComp.meta.variants[0].props?.children !== 'Top level card text' ||
    cardComp.meta.variants[1].props?.children !== '<span>Inner HTML</span>') {
    console.error('Children assertion failed!');
    process.exit(1);
  }

  console.log('\n--- Testing storePath Handling ---');
  const storeSnippet = `
  /* @preview: Admin User
  storePath: "../store"
  store:
    auth:
      isLoggedIn: true
  */
  /* @preview: Inherited Store
  store:
    auth:
      isLoggedIn: false
  */
  /* @preview: Custom Named Store
  storePath: "./authStore#setupAuth"
  */
  /* @preview: Explicit Mock Store
  storePath: none
  store:
    auth: null
  */
  export const UserWidget: React.FC = () => null;
  `;
  const storeResult = scanComponents(storeSnippet, 'UserWidget.tsx');
  const storeComp = storeResult.targetComponent;
  if (!storeComp || storeComp.meta.variants.length !== 4) {
    console.error('storePath component parsing failed!');
    process.exit(1);
  }
  console.log('- Variant 1 storePath:', storeComp.meta.variants[0].storePath);
  console.log('- Variant 2 storePath (inherited):', storeComp.meta.variants[1].storePath);
  console.log('- Variant 3 storePath:', storeComp.meta.variants[2].storePath);
  console.log('- Variant 4 storePath (explicit none):', storeComp.meta.variants[3].storePath);

  if (
    storeComp.meta.variants[0].storePath !== '../store' ||
    storeComp.meta.variants[1].storePath !== '../store' ||
    storeComp.meta.variants[2].storePath !== './authStore#setupAuth' ||
    storeComp.meta.variants[3].storePath !== undefined
  ) {
    console.error('storePath assertion failed!');
    process.exit(1);
  }

  console.log('\n--- Testing Class Components and Anonymous Arrow Default Exports ---');
  const advancedSnippet = `
  /* @preview: Class Component Variant
  props:
    title: "Class Widget"
  wrapper: "./AppWrapper"
  viewport:
    width: 375
    height: 667
  */
  export class ClassWidget extends React.Component<{ title: string }> {
    render() { return <h1>{this.props.title}</h1>; }
  }

  /* @preview: Arrow Default Export
  props:
    count: 42
  */
  export default () => <div>Arrow</div>;
  `;
  const advResult = scanComponents(advancedSnippet, 'AdvancedView.tsx');
  if (advResult.components.length !== 2) {
    console.error(`Expected 2 components in advancedSnippet, got ${advResult.components.length}`);
    process.exit(1);
  }

  const classComp = advResult.components.find((c) => c.name === 'ClassWidget');
  if (!classComp || classComp.meta.variants[0].wrapperPath !== './AppWrapper') {
    console.error('ClassWidget or wrapperPath assertion failed!');
    process.exit(1);
  }
  console.log('- Class component detected:', classComp.name);
  console.log('- Class wrapperPath:', classComp.meta.variants[0].wrapperPath);
  console.log('- Class viewport:', classComp.meta.variants[0].viewport);

  const arrowComp = advResult.components.find((c) => c.name === 'AdvancedView');
  if (!arrowComp || !arrowComp.isDefaultExport) {
    console.error('Anonymous arrow default export assertion failed!');
    process.exit(1);
  }
  console.log('- Anonymous arrow default export detected:', arrowComp.name);

  console.log('\n--- Testing AST Scanner on CatGallery.tsx (Multi-component with Redux & RTK Query) ---');
  const catGalleryPath = path.resolve(__dirname, '../sample-workspace/CatGallery.tsx');
  const catGalleryCode = fs.readFileSync(catGalleryPath, 'utf8');
  const catGalleryResult = scanComponents(catGalleryCode, catGalleryPath);

  console.log(`Found ${catGalleryResult.components.length} components in CatGallery.tsx.`);
  console.log('All scanned component names:', catGalleryResult.components.map((c) => c.name));
  const expectedComps = [
    'CatImageCard',
    'CatTagSelector',
    'CatSaysInput',
    'CatFavoritesDrawer',
    'CatStatsBar',
    'CatGallery',
  ];
  for (const name of expectedComps) {
    const found = catGalleryResult.components.find((c) => c.name === name);
    if (!found) {
      console.error(`Component ${name} not found in CatGallery.tsx!`);
      process.exit(1);
    }
    console.log(`- Component [${found.name}]: ${found.meta.variants.length} variant(s), isDefault: ${found.isDefaultExport}`);
  }

  const mainComp = catGalleryResult.targetComponent;
  if (!mainComp || mainComp.name !== 'CatGallery') {
    console.error('Target component in CatGallery.tsx is not CatGallery!');
    process.exit(1);
  }
  if (mainComp.meta.variants.length !== 4) {
    console.error(`Expected 4 variants for CatGallery, got ${mainComp.meta.variants.length}`);
    process.exit(1);
  }

  // Verify storePath and preloaded state
  const variant1 = mainComp.meta.variants[0];
  const variant2 = mainComp.meta.variants[1];
  console.log('- CatGallery Variant 1 storePath:', variant1.storePath);
  console.log('- CatGallery Variant 2 storePath:', variant2.storePath, 'favorites count in store:', variant2.store?.catGallery?.favorites?.length);
  if (variant1.storePath !== './catStore' || variant2.storePath !== './catStore') {
    console.error('CatGallery storePath assertion failed!');
    process.exit(1);
  }
  if (variant2.store?.catGallery?.favorites?.length !== 2) {
    console.error('CatGallery preloaded favorites assertion failed!');
    process.exit(1);
  }

  console.log('\n✅ All parser tests passed successfully!');
}

test();
