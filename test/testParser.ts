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
    console.log(`- Variant [${v.name}]: store =`, JSON.stringify(v.store));
  });

  console.log('\n✅ All parser tests passed successfully!');
}

test();
