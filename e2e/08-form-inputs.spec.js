/**
 * Number and date fields must stay plain text inputs.
 *
 * Both native types turn into OS widgets inside an Android WebView, and stop
 * being editable text nodes: `type="number"` is exposed as a spinbutton that
 * only accepts ACTION_SET_PROGRESS, and `type="date"` opens the system date
 * picker. Either one makes the field impossible to fill from a native runner,
 * and neither shows up as a fault in a browser — which is why it is asserted
 * here rather than left to the device suite.
 */
import { test, expect } from '@playwright/test';
import { TESTIDS, fieldError } from '../shared/testIds.js';
import { login, DEMO } from './helpers.js';

test.describe('Form inputs stay automatable', () => {
  test('amount and tenure are text fields with a numeric keypad', async ({ page }) => {
    await login(page, DEMO.customer);
    await page.goto('/app/apply');

    for (const id of [TESTIDS.apply.amountInput, TESTIDS.apply.tenureInput]) {
      const field = page.getByTestId(id);
      await expect(field).toHaveAttribute('type', 'text');
      await expect(field).toHaveAttribute('inputmode', 'numeric');
    }

    // Non-digits are dropped, so callers still only ever see a number.
    await page.getByTestId(TESTIDS.apply.amountInput).fill('80000');
    await expect(page.getByTestId(TESTIDS.apply.amountInput)).toHaveValue('80000');
  });

  test('date of birth is typed, not picked', async ({ page }) => {
    await login(page, DEMO.customer);
    await page.goto('/app/apply');

    await page.getByTestId(TESTIDS.apply.amountInput).fill('80000');
    await page.getByTestId(TESTIDS.apply.tenureInput).fill('24');
    await page.getByTestId(TESTIDS.apply.purposeSelect).selectOption({ index: 1 });
    await page.getByTestId(TESTIDS.apply.next).click();

    await page.getByTestId(TESTIDS.apply.employmentTypeSelect).selectOption({ index: 1 });
    await page.getByTestId(TESTIDS.apply.incomeInput).fill('60000');
    await page.getByTestId(TESTIDS.apply.next).click();

    const dob = page.getByTestId(TESTIDS.apply.dobInput);
    await expect(dob).toBeVisible();

    // An OS picker would be type="date".
    await expect(dob).toHaveAttribute('type', 'text');
    await expect(dob).toHaveAttribute('inputmode', 'numeric');
    await expect(dob).toHaveAttribute('placeholder', 'YYYY-MM-DD');

    // Digits alone are enough — separators are inserted, value stays ISO.
    await dob.fill('19950615');
    await expect(dob).toHaveValue('1995-06-15');

    // A full ISO date, typed or pasted, lands unchanged.
    await dob.fill('');
    await dob.fill('1990-01-02');
    await expect(dob).toHaveValue('1990-01-02');

    // A partial date is refused rather than passed on as a valid one: an
    // invalid Date is NaN, and NaN fails every age comparison silently.
    await dob.fill('');
    await dob.fill('19950');
    await page.getByTestId(TESTIDS.apply.submit).click();
    await expect(page.getByTestId(fieldError('dob'))).toBeVisible();
  });
});
