#!/usr/bin/env tsx
/**
 * Debug script: investigate why challenge iframe reCAPTCHA is not extracted.
 * 
 * Tests:
 * 1. extractIframesInBrowser() — what iframe elements are found in DOM?
 * 2. page.frames() — what frames does Playwright see?
 * 3. URL matching — does DOM iframe src match Playwright frame URL?
 * 4. extractDomTreeFromFrame() — can we extract DOM from challenge iframe?
 * 
 * Usage: npx tsx packages/mcp-server/scripts/debug-iframes.ts
 */

import { chromium } from 'playwright';
import { extractIframesInBrowser } from '../src/tools/getSnapshot.js';

async function debugIframes() {
  console.log('🔍 Starting iframe debug session...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to reCAPTCHA demo
  console.log('📄 Navigating to reCAPTCHA demo...');
  await page.goto('https://www.google.com/recaptcha/api2/demo');
  await page.waitForLoadState('networkidle');
  console.log('✅ Page loaded\n');

  // Wait for reCAPTCHA iframe to appear
  console.log('⏳ Waiting for reCAPTCHA iframe...');
  await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });
  console.log('✅ reCAPTCHA iframe found\n');

  // Test 1: extractIframesInBrowser()
  console.log('=== Test 1: extractIframesInBrowser() ===');
  const iframeElements = await page.evaluate(extractIframesInBrowser);
  console.log(`Found ${iframeElements.length} iframe elements:`);
  for (const iframe of iframeElements) {
    console.log(`  - URL: ${iframe.url}`);
    console.log(`    Name: ${iframe.name}, ID: ${iframe.id}`);
    console.log(`    Rect: ${JSON.stringify(iframe.rect)}`);
  }
  console.log();

  // Test 2: page.frames()
  console.log('=== Test 2: page.frames() ===');
  const frames = page.frames();
  console.log(`Playwright sees ${frames.length} frames:`);
  for (let i = 0; i <frames.length; i++) {
    const frame = frames[i];
    console.log(`  [${i}] URL: ${frame.url()}`);
    console.log(`      Name: ${frame.name()}`);
  }
  console.log();

  // Test 3: URL matching
  console.log('=== Test 3: URL matching ===');
  for (const iframeInfo of iframeElements) {
    console.log(`\nDOM iframe URL: ${iframeInfo.url}`);
    
    // Try to find matching Playwright frame
    const matchingFrame = frames.find(f => f.url() === iframeInfo.url);
    if (matchingFrame) {
      console.log(`  ✅ Match found at index ${frames.indexOf(matchingFrame)}`);
    } else {
      console.log(`  ❌ No exact match found`);
      
      // Try partial match
      const partialMatch = frames.find(f => 
        f.url().includes(iframeInfo.url) || 
        iframeInfo.url.includes(f.url())
      );
      if (partialMatch) {
        console.log(`  ⚠️  Partial match: ${partialMatch.url()}`);
      }
      
      // Try by name
      const nameMatch = frames.find(f => f.name() === iframeInfo.name);
      if (nameMatch) {
        console.log(`  ⚠️  Name match: ${nameMatch.url()}`);
      }
    }
  }
  console.log();

  // Test 4: Try to click checkbox and wait for challenge iframe
  console.log('=== Test 4: Click checkbox and wait for challenge iframe ===');
  const checkboxFrame = frames.find(f => f.url().includes('recaptcha') && f.url().includes('anchor'));
  if (checkboxFrame) {
    console.log('Found checkbox frame, attempting to click...');
    try {
      const checkbox = await checkboxFrame.locator('#recaptcha-anchor').first();
      await checkbox.click({ timeout: 5000 });
      console.log('✅ Checkbox clicked');
      
      // Wait for challenge iframe
      console.log('⏳ Waiting for challenge iframe...');
      await page.waitForTimeout(2000);
      
      // Re-run tests
      console.log('\n--- After click ---');
      const iframeElementsAfter = await page.evaluate(extractIframesInBrowser);
      console.log(`Found ${iframeElementsAfter.length} iframe elements:`);
      for (const iframe of iframeElementsAfter) {
        console.log(`  - URL: ${iframe.url}`);
      }
      
      const framesAfter = page.frames();
      console.log(`\nPlaywright sees ${framesAfter.length} frames:`);
      for (let i = 0; i <framesAfter.length; i++) {
        const frame = framesAfter[i];
        console.log(`  [${i}] URL: ${frame.url()}`);
      }
      
      // Look for challenge iframe
      const challengeFrame = framesAfter.find(f => 
        f.url().includes('recaptcha') && 
        (f.url().includes('bframe') || f.url().includes('challenge'))
      );
      if (challengeFrame) {
        console.log(`\n✅ Challenge iframe found at index ${framesAfter.indexOf(challengeFrame)}`);
        console.log(`   URL: ${challengeFrame.url()}`);
        
        // Try to extract DOM
        console.log('\n=== Test 5: Extract DOM from challenge iframe ===');
        try {
          const domTree = await challengeFrame.evaluate(() => {
            return {
              title: document.title,
              bodyChildren: document.body.children.length,
              firstChildTag: document.body.children[0]?.tagName,
            };
          });
          console.log('✅ DOM extraction successful:');
          console.log(`   Title: ${domTree.title}`);
          console.log(`   Body children: ${domTree.bodyChildren}`);
          console.log(`   First child: ${domTree.firstChildTag}`);
        } catch (error) {
          console.log(`❌ DOM extraction failed: ${error}`);
        }
      } else {
        console.log('\n❌ Challenge iframe not found');
      }
    } catch (error) {
      console.log(`❌ Failed to click checkbox: ${error}`);
    }
  } else {
    console.log('❌ Checkbox frame not found');
  }

  await browser.close();
  console.log('\n🏁 Debug session complete');
}

debugIframes().catch(console.error);