// Task 19, test H1: the hello example page on Chrome's fake microphone.
// Task 21: the body moved to hello-check.ts, shared with site.spec.ts. Title and expectations are unchanged.
import { test } from '@playwright/test';
import { checkHelloPage, HELLO_TEST_TIMEOUT_MS } from './hello-check';

const HELLO_PAGE_URL = '/examples/hello/index.html';

test('hello page: the fake microphone gives the pattern and the sounds as text, with no request leaving localhost', async ({ page, baseURL }) => {
  test.setTimeout(HELLO_TEST_TIMEOUT_MS);
  await checkHelloPage(page, baseURL as string, HELLO_PAGE_URL);
});
