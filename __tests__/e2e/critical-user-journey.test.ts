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
    const timings: number[] = [];
    
    // Run 10 iterations for p95 calculation
    for (let i = 0; i < 10; i++) {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
      
      const startTime = Date.now();
      
      // Click Log Symptoms button (Log tab is default)
      await page.click('button:has-text("Log Symptoms")');
      
      // Select 2-3 symptoms
      const symptoms = ['Headache', 'Fatigue', 'Nausea'];
      const numSymptoms = Math.floor(Math.random() * 2) + 1;
      
      for (let j = 0; j < numSymptoms; j++) {
        const symptomButton = page.locator(`button:has-text("${symptoms[j]}")`).first();
        await symptomButton.click();
      }
      
      // Adjust severity
      await page.locator('input[type="range"]').fill('3');
      
      // Save
      await page.click('button:has-text("Save")');
      
      // Wait for success toast
      await page.waitForSelector('text=/Logged in/', { timeout: 15000 });
      
      const duration = Date.now() - startTime;
      timings.push(duration);
      
      console.log(`Iteration ${i + 1}: ${duration}ms`);
      
      // Small delay before next iteration
      await page.waitForTimeout(500);
    }
    
    // Calculate statistics
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length * 0.5)];
    const p95 = timings[Math.floor(timings.length * 0.95)];
    
    console.log(`Quick Log Stats - Median: ${median}ms, p95: ${p95}ms`);
    
    expect(median).toBeLessThan(PERF_TARGETS.quickLog.median);
    expect(p95).toBeLessThan(PERF_TARGETS.quickLog.p95);
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
    await page.waitForLoadState('networkidle');
    
    // Ensure we have some data
    await page.click('button:has-text("Log Symptoms")');
    await page.click('button:has-text("Fatigue")');
    await page.click('button:has-text("Save")');
    await page.waitForSelector('text=/Logged/');
    
    const pdfStart = Date.now();
    await page.click('button:has-text("Generate Visit Report")');
    
    // Wait for PDF generation
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    const download = await downloadPromise;
    const pdfDuration = Date.now() - pdfStart;
    
    expect(download.suggestedFilename()).toContain('Report');
    expect(pdfDuration).toBeLessThan(PERF_TARGETS.pdfGenerate.p95);
    console.log(`PDF generated in ${pdfDuration}ms`);
  });
});
