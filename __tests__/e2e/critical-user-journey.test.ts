// __tests__/e2e/critical-user-journey.test.ts
import { test, expect, Page } from '@playwright/test';

// Since we have perfMonitor, let's use the actual targets
const PERF_TARGETS = {
  quickLog: { median: 7000, p95: 10000 },
  markTaken: { median: 500, p95: 1000 },
  pdfGenerate: { median: 2000, p95: 3000 }
};

test.describe('Critical User Journey', () => {
  test.beforeEach(async ({ page }) => {
    // iPhone 12 viewport
    await page.setViewportSize({ width: 390, height: 844 });
    
    // CPU throttling for realistic mobile performance
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  });

  test('7-second symptom logging p95 ≤ 10s', async ({ page }) => {
    const logTimes: number[] = [];
    
    for (let i = 0; i < 5; i++) {
      const startTime = Date.now();
      
      await page.goto('http://localhost:3000');
      
      // New mobile UI - symptoms are immediately visible
      await page.click('button:has-text("Headache")');
      await page.click('button:has-text("Fatigue")');
      
      // Click Next to go to severity
      await page.click('button:has-text("Next")');
      
      // Select Medium severity
      await page.click('button:has-text("Medium")');
      
      // Skip context
      await page.click('button:has-text("Skip")');
      
      // Wait for success toast
      await page.waitForSelector('text=/Logged in/', { timeout: 5000 });
      
      const elapsed = Date.now() - startTime;
      logTimes.push(elapsed);
      
      await page.waitForTimeout(500);
    }
    
    const p95 = Math.max(...logTimes);
    console.log(`P95 time: ${p95}ms`);
    expect(p95).toBeLessThan(10000);
  });

  test('Medication due and marking flow', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    
    // Go to Medications tab
    await page.click('button[role="tab"]:has-text("Meds")');
    
    // Add a medication if none exist
    const noMedsMessage = await page.locator('text=/No medications added/').isVisible();
    if (noMedsMessage) {
      await page.click('button:has-text("Add Medication")');
      await page.fill('input[name="medicationName"]', 'Test Med');
      await page.fill('input[name="dosage"]', '100mg');
      await page.selectOption('select[name="frequency"]', 'daily');
      await page.click('button:has-text("Save")');
    }
    
    // Go back to Log tab to see "Due Now" strip
    await page.click('button[role="tab"]:has-text("Log")');
    
    // Check if medication shows as due
    const dueCard = await page.locator('text=/Due Now/').isVisible();
    if (dueCard) {
      const markTakenStart = Date.now();
      await page.click('button:has-text("Taken")');
      await page.waitForSelector('text=/Marked as taken/');
      const markTakenDuration = Date.now() - markTakenStart;
      
      expect(markTakenDuration).toBeLessThan(PERF_TARGETS.markTaken.p95);
      console.log(`Mark taken completed in ${markTakenDuration}ms`);
    }
  });

  test.skip('Offline mode works after first visit', async ({ page, context }) => {
    // First visit online
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 5000 }).catch(() => {
      console.log('Service worker not available in dev mode');
    });
    
    // Go offline
    await context.setOffline(true);
    
    // App should still work
    await page.reload();
    await expect(page.locator('text=myHealthyAgent')).toBeVisible();
    
    // Test Log offline
    await page.click('button:has-text("Log Symptoms")');
    await page.click('button:has-text("Headache")');
    await page.click('button:has-text("Save")');
    
    // Should save locally
    await expect(page.locator('text=/Logged/')).toBeVisible();
    
    // Go back online
    await context.setOffline(false);
  });

  test('Visit report generation', async ({ page }) => {
    await page.goto('http://localhost:3000');
    
    // New mobile UI - symptoms are directly visible
    await page.click('button:has-text("Fatigue")');
    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Medium")');
    await page.click('button:has-text("Skip")');
    await page.waitForSelector('text=/Logged/');
    
    // Navigate to History tab to verify
    await page.click('button:has-text("History")');
    await page.waitForSelector('text=/Fatigue/');
    
    // Go back to Log tab  
    await page.click('button:has-text("Log")');
    
    // Use the original VisitReport component (more reliable for testing)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    const pdfStart = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Generate Visit Report")')
    ]);
    const pdfDuration = Date.now() - pdfStart;
    
    expect(download).toBeTruthy();
    expect(download.suggestedFilename()).toContain('Report');
    expect(pdfDuration).toBeLessThan(PERF_TARGETS.pdfGenerate.p95);
    console.log(`PDF generated in ${pdfDuration}ms`);
  });
});
